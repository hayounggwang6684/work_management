"""PDM 단독 실행: python PDM/pdm_main.py  (본체 앱과 무관하게 개발/테스트)"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import eel

import PDM.backend.api  # noqa: F401  (@eel.expose 등록)
from PDM.backend import adapters

adapters.enable_dev_mode()      # 단독 실행에는 본체 세션이 없으므로 권한 판정 없이 허용 (본체에서는 pdm_bridge 가 훅을 주입)

WEB_DIR = Path(__file__).resolve().parent / 'web'
PORT = 8765  # 본체 앱 포트와 겹치지 않게


def main() -> None:
    eel.init(str(WEB_DIR), allowed_extensions=['.js', '.html', '.css'])
    # --no-browser: 미리보기 도구/수동 접속용 (http://localhost:8765/pdm.html).
    # Eel 은 페이지가 모두 닫히면 종료하므로, 이 모드에서는 종료하지 않도록 빈 콜백을 건다.
    no_browser = '--no-browser' in sys.argv
    eel.start('pdm.html', port=PORT, size=(1280, 860), mode=None if no_browser else 'chrome',
              close_callback=(lambda *_: None) if no_browser else None)


if __name__ == '__main__':
    main()
