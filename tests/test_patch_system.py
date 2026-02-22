import json
from pathlib import Path

from src.utils.patch_system import PatchSystem


def _write_patch(base: Path, name: str, data: dict):
    d = base / name
    d.mkdir(parents=True, exist_ok=True)
    (d / "patch.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def test_find_available_patches_filters_by_current_version_only(tmp_path):
    ps = PatchSystem()
    ps.current_version = "1.1.0"
    ps.app_root = tmp_path
    ps.patches_dir = tmp_path / "patches"
    ps.applied_patches_file = tmp_path / "data" / "applied_patches.json"
    ps.patches_dir.mkdir(parents=True)
    ps.applied_patches_file.parent.mkdir(parents=True)

    _write_patch(ps.patches_dir, "old", {
        "id": "patch-v1.0.9", "version": "1.0.9", "files": []
    })
    _write_patch(ps.patches_dir, "need-newer", {
        "id": "patch-v1.2.0", "version": "1.2.0", "min_version": "1.2.0", "files": []
    })
    _write_patch(ps.patches_dir, "ok", {
        "id": "patch-v1.1.1", "version": "1.1.1", "min_version": "1.0.0", "files": []
    })

    available = ps.find_available_patches()
    assert [p["id"] for p in available] == ["patch-v1.1.1", "patch-v1.2.0"]


def test_find_available_patches_semver_order(tmp_path):
    ps = PatchSystem()
    ps.current_version = "1.1.0"
    ps.app_root = tmp_path
    ps.patches_dir = tmp_path / "patches"
    ps.applied_patches_file = tmp_path / "data" / "applied_patches.json"
    ps.patches_dir.mkdir(parents=True)
    ps.applied_patches_file.parent.mkdir(parents=True)

    _write_patch(ps.patches_dir, "b", {"id": "patch-v1.1.10", "version": "1.1.10", "files": []})
    _write_patch(ps.patches_dir, "a", {"id": "patch-v1.1.2", "version": "1.1.2", "files": []})

    available = ps.find_available_patches()
    assert [p["id"] for p in available] == ["patch-v1.1.2", "patch-v1.1.10"]


def test_check_and_apply_patches_respects_dynamic_min_version(tmp_path):
    ps = PatchSystem()
    ps.current_version = "1.1.0"
    ps.app_root = tmp_path
    ps.patches_dir = tmp_path / "patches"
    ps.applied_patches_file = tmp_path / "data" / "applied_patches.json"
    ps.patches_dir.mkdir(parents=True)
    ps.applied_patches_file.parent.mkdir(parents=True)

    _write_patch(ps.patches_dir, "p1", {"id": "patch-v1.1.1", "version": "1.1.1", "files": []})
    _write_patch(ps.patches_dir, "p2", {
        "id": "patch-v1.1.2", "version": "1.1.2", "min_version": "1.1.1", "files": []
    })

    applied = []

    def fake_apply(patch):
        applied.append(patch["id"])
        return True

    ps.apply_patch = fake_apply  # type: ignore[assignment]

    count = ps.check_and_apply_patches()

    assert count == 2
    assert applied == ["patch-v1.1.1", "patch-v1.1.2"]
    assert ps.current_version == "1.1.2"
