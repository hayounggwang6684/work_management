"""
build_patch.py - 표준 패치 ZIP 빌드 스크립트

사용법:
    python build_patch.py <version> <file1> [<file2> ...]

예시:
    python build_patch.py 1.3.5 web/js/splash.js src/utils/update_manager.py

출력:
    patch_build/patch_v<version>/patch_v<version>.zip

규칙 (재발 방지):
    ★ 패치 ZIP 안에는 반드시 'patch_v<version>/' 래퍼 폴더가 최상위에 있어야 함.
    ★ _extract_patch_zip()이 top_dirs == {1개} 인 경우에만 올바르게 폴더를 추출함.
    ★ 이 스크립트 대신 직접 zipfile.write()로 빌드하면 래퍼 폴더가 누락될 수 있음.
"""

import sys
import json
import zipfile
import shutil
from pathlib import Path


def build_patch(version: str, source_files: list[str]):
    repo_root = Path(__file__).parent
    patch_name = f"patch_v{version}"
    patch_dir = repo_root / "patch_build" / patch_name
    zip_path = patch_dir / f"{patch_name}.zip"

    # 패치 디렉토리 생성
    patch_dir.mkdir(parents=True, exist_ok=True)

    # patch.json 생성
    files_list = []
    for src in source_files:
        files_list.append({"source": src, "target": src})

    patch_json = {
        "version": version,
        "description": f"v{version} 패치",
        "files": files_list
    }
    patch_json_path = patch_dir / "patch.json"
    with open(patch_json_path, "w", encoding="utf-8") as f:
        json.dump(patch_json, f, indent=2, ensure_ascii=False)

    # ZIP 빌드 — 반드시 patch_vX.X.X/ 래퍼 폴더 포함
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        # patch.json
        zf.write(patch_json_path, f"{patch_name}/patch.json")

        # 소스 파일들
        for src in source_files:
            src_path = repo_root / src
            if not src_path.exists():
                print(f"[경고] 파일 없음: {src_path}")
                continue
            arcname = f"{patch_name}/{src}"
            zf.write(src_path, arcname)
            print(f"  추가: {arcname}")

    # 검증: 최상위 폴더가 정확히 1개인지 확인
    with zipfile.ZipFile(zip_path, "r") as zf:
        names = zf.namelist()
        top_dirs = set()
        for name in names:
            parts = name.split("/")
            if parts[0]:
                top_dirs.add(parts[0])
        assert len(top_dirs) == 1 and top_dirs.pop() == patch_name, \
            f"ZIP 구조 오류: top_dirs={top_dirs} (반드시 {{'{patch_name}'}} 이어야 함)"

    print(f"\nOK 패치 ZIP 빌드 완료: {zip_path}")
    print(f"  내부 구조:")
    for name in names:
        print(f"    {name}")

    # 소스 파일들을 patch_dir에도 복사 (GitHub Release 에셋 외 로컬 참조용)
    for src in source_files:
        src_path = repo_root / src
        if src_path.exists():
            dest = patch_dir / Path(src).name
            shutil.copy2(src_path, dest)

    return zip_path


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        print("오류: 버전과 파일 목록이 필요합니다.")
        print("예시: python build_patch.py 1.3.5 web/js/splash.js src/utils/update_manager.py")
        sys.exit(1)

    version = sys.argv[1]
    files = sys.argv[2:]

    print(f"패치 빌드: v{version}")
    print(f"파일 목록: {files}")
    print()

    build_patch(version, files)
