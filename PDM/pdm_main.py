"""PDM 단독 실행: python PDM/pdm_main.py  (본체 앱과 무관하게 개발/테스트)"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import eel

import PDM.backend.api  # noqa: F401  (@eel.expose 등록)

WEB_DIR = Path(__file__).resolve().parent / 'web'
PORT = 8765  # 본체 앱 포트와 겹치지 않게


def main() -> None:
    eel.init(str(WEB_DIR), allowed_extensions=['.js', '.html', '.css'])
    # --no-browser: 미리보기 도구/수동 접속용 (http://localhost:8765/pdm.html)
    mode = None if '--no-browser' in sys.argv else 'chrome'
    eel.start('pdm.html', port=PORT, size=(1280, 860), mode=mode)


if __name__ == '__main__':
    main()
