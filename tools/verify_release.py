"""Release package sanity checks for patch deployments."""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _read_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def check_settings_example(version: str, errors: list[str]) -> None:
    data = _read_json(ROOT / "config" / "settings.example.json")
    app_version = data.get("app", {}).get("version")
    update_version = data.get("update", {}).get("current_version")
    if app_version != version:
        errors.append(f"settings.example.json app.version is {app_version!r}, expected {version!r}")
    if update_version != version:
        errors.append(f"settings.example.json update.current_version is {update_version!r}, expected {version!r}")


def check_installer(version: str, errors: list[str]) -> None:
    text = _read_text(ROOT / "build_installer.iss")
    if f"AppVersion={version}" not in text and f"#define MyAppVersion \"{version}\"" not in text:
        errors.append("build_installer.iss AppVersion does not match")
    if f"OutputBaseFilename=WorkManagement_Setup_v{version}" not in text:
        errors.append("build_installer.iss OutputBaseFilename does not match")


def check_patch_zip(version: str, errors: list[str]) -> None:
    zip_path = ROOT / "patch_build" / f"patch_v{version}" / f"patch_v{version}.zip"
    if not zip_path.exists():
        errors.append(f"patch ZIP not found: {zip_path}")
        return

    wrapper = f"patch_v{version}/"
    with zipfile.ZipFile(zip_path, "r") as archive:
        names = archive.namelist()
        if not names or any(not name.startswith(wrapper) for name in names):
            errors.append(f"patch ZIP must contain a single {wrapper!r} wrapper")
        if f"{wrapper}config/settings.json" in names:
            errors.append("patch ZIP must not include config/settings.json")
        patch_name = f"{wrapper}patch.json"
        if patch_name not in names:
            errors.append("patch ZIP is missing patch.json")
            return
        patch_meta = json.loads(archive.read(patch_name).decode("utf-8"))
        if patch_meta.get("version") != version:
            errors.append(f"patch.json version is {patch_meta.get('version')!r}, expected {version!r}")


def check_version_format(version: str, errors: list[str]) -> None:
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        errors.append("version must look like 2.3.30")


def run(version: str) -> list[str]:
    errors: list[str] = []
    check_version_format(version, errors)
    check_settings_example(version, errors)
    check_installer(version, errors)
    check_patch_zip(version, errors)
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify patch release files before upload.")
    parser.add_argument("version", help="release version without v prefix, for example 2.3.30")
    args = parser.parse_args()

    errors = run(args.version)
    if errors:
        print("Release verification failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"Release verification passed for v{args.version}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
