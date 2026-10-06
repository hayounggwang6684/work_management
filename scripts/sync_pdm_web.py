"""PDM/web/*.js → web/pdm/ 복사.

본체 Eel 은 web/ 폴더 하나의 .js/.html 만 서빙하므로, PDM 화면 스크립트를 web/pdm/ 에 복사해 둔다.
PDM/web 이 원본이다 — web/pdm 은 직접 고치지 말고 이 스크립트로만 갱신한다.

    python scripts/sync_pdm_web.py           # 복사 (오래된 파일은 삭제)
    python scripts/sync_pdm_web.py --check   # 어긋나면 종료 코드 1 (복사하지 않음)
"""
import argparse
import shutil
import sys
from pathlib import Path
from typing import List

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'PDM' / 'web'
TARGET = ROOT / 'web' / 'pdm'


def _normalized(path: Path) -> bytes:
    """줄바꿈 차이(CRLF/LF)는 같은 내용으로 본다 — git autocrlf 때문에 생기는 오탐 방지."""
    return path.read_bytes().replace(b'\r\n', b'\n')


def diff(source: Path = SOURCE, target: Path = TARGET) -> List[str]:
    """어긋난 항목 설명 목록 (비어 있으면 일치)."""
    src = {p.name: p for p in source.glob('*.js')}
    dst = {p.name: p for p in target.glob('*.js')} if target.exists() else {}
    problems = [f'없음: {n}' for n in sorted(src.keys() - dst.keys())]
    problems += [f'원본에 없는 파일: {n}' for n in sorted(dst.keys() - src.keys())]
    problems += [f'내용 다름: {n}' for n in sorted(src.keys() & dst.keys()) if _normalized(src[n]) != _normalized(dst[n])]
    return problems


def sync(source: Path = SOURCE, target: Path = TARGET) -> None:
    target.mkdir(parents=True, exist_ok=True)
    wanted = {p.name for p in source.glob('*.js')}
    for stale in target.glob('*.js'):
        if stale.name not in wanted:
            stale.unlink()
    for name in wanted:
        shutil.copyfile(source / name, target / name)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--check', action='store_true', help='복사하지 않고 일치 여부만 검사')
    args = parser.parse_args()
    problems = diff()
    if args.check:
        for p in problems:
            print(p)
        return 1 if problems else 0
    sync()
    print(f'동기화 완료: {len(list(SOURCE.glob("*.js")))}개 파일 → {TARGET.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
