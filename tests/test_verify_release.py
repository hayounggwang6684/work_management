import importlib.util
from pathlib import Path


def _load_module():
    path = Path(__file__).resolve().parents[1] / "tools" / "verify_release.py"
    spec = importlib.util.spec_from_file_location("verify_release", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_version_format_accepts_semver_patch():
    module = _load_module()
    errors = []

    module.check_version_format("2.3.30", errors)

    assert errors == []


def test_version_format_rejects_prefixed_tag():
    module = _load_module()
    errors = []

    module.check_version_format("v2.3.30", errors)

    assert errors
