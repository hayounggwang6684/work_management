"""web/pdm/ 이 PDM/web/ 의 복사본과 일치하는지 검사 — python tests/test_pdm_sync.py

어긋나면: python scripts/sync_pdm_web.py  (PDM/web 을 고친 뒤에는 항상 실행하고 web/pdm 도 함께 커밋)
"""
import importlib.util
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).parent.parent
spec = importlib.util.spec_from_file_location('sync_pdm_web', ROOT / 'scripts' / 'sync_pdm_web.py')
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


def test_web_pdm_matches_source():
    problems = sync.diff(ROOT / 'PDM' / 'web', ROOT / 'web' / 'pdm')
    assert not problems, "web/pdm 이 PDM/web 과 다릅니다 → python scripts/sync_pdm_web.py\n  " + "\n  ".join(problems)


def test_sync_copies_updates_and_removes_stale_files():
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = Path(tmp) / 'src', Path(tmp) / 'dst'
        src.mkdir()
        (src / 'a.js').write_text('A1\n', encoding='utf-8')
        (src / 'b.js').write_text('B\n', encoding='utf-8')
        (src / 'notes.md').write_text('무시', encoding='utf-8')
        assert sync.diff(src, dst)                                   # 처음엔 어긋남
        sync.sync(src, dst)
        assert sorted(p.name for p in dst.iterdir()) == ['a.js', 'b.js']      # .js 만 복사
        assert sync.diff(src, dst) == []
        (src / 'a.js').write_text('A2\n', encoding='utf-8')
        (src / 'b.js').unlink()
        assert len(sync.diff(src, dst)) == 2                         # 변경 + 삭제된 원본
        sync.sync(src, dst)
        assert (dst / 'a.js').read_text(encoding='utf-8') == 'A2\n' and not (dst / 'b.js').exists()


def test_line_endings_do_not_cause_false_differences():
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = Path(tmp) / 'src', Path(tmp) / 'dst'
        src.mkdir(); dst.mkdir()
        (src / 'a.js').write_bytes(b'x\ny\n')
        (dst / 'a.js').write_bytes(b'x\r\ny\r\n')                   # git autocrlf 로 CRLF 가 된 경우
        assert sync.diff(src, dst) == []


if __name__ == '__main__':
    for fn in [test_web_pdm_matches_source, test_sync_copies_updates_and_removes_stale_files, test_line_endings_do_not_cause_false_differences]:
        fn()
        print(f"  OK  {fn.__name__}")
    print("통과")
