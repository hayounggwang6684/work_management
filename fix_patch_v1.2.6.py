"""
fix_patch_v1.2.6.py
---------------------
v1.2.6 패치 적용 실패 후 "적용할 패치가 없다"로 멈춘 현장 PC 복구용 스크립트.

실행 방법: 앱 루트 폴더에서 python fix_patch_v1.2.6.py
그 다음 앱을 실행하면 v1.2.6 패치가 자동으로 다시 다운로드·적용됩니다.
"""

import json
import shutil
from pathlib import Path

app_root = Path(__file__).parent

# 1) downloaded_patches.json 에서 patch_v1.2.6.zip 항목 제거
dp_file = app_root / "data" / "downloaded_patches.json"
if dp_file.exists():
    with open(dp_file, encoding="utf-8") as f:
        data = json.load(f)
    before = data.get("downloaded", [])
    after  = [x for x in before if "1.2.6" not in x]
    data["downloaded"] = after
    with open(dp_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    removed = set(before) - set(after)
    print(f"downloaded_patches 정리: {removed if removed else '항목 없음 (이미 깨끗)'}")
else:
    print("downloaded_patches.json 없음 (건너뜀)")

# 2) 잘못 풀린 patches/ 루트 파일/폴더 제거
patches_root = app_root / "patches"
to_remove = ["patch.json", "src", "web"]   # 잘못된 위치에 생긴 파일들

for name in to_remove:
    target = patches_root / name
    if target.is_dir():
        shutil.rmtree(target)
        print(f"폴더 삭제: {target}")
    elif target.is_file():
        target.unlink()
        print(f"파일 삭제: {target}")

# 3) 잘못 생성된 patches/patch_v1.2.6/ 폴더도 있으면 제거 (빈 폴더 또는 내용 없는 경우)
bad_dir = patches_root / "patch_v1.2.6"
if bad_dir.exists():
    shutil.rmtree(bad_dir)
    print(f"폴더 삭제: {bad_dir}")

print()
print("완료! 이제 앱을 실행하면 v1.2.6 패치가 자동으로 다시 적용됩니다.")
