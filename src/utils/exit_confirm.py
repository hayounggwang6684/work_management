"""프로그램 종료 전 확인 (Windows 메시지 상자). main.py 가 아니라 여기에 둬서 단독으로 테스트할 수 있다."""
from typing import Callable

TITLE = '금일작업현황 관리'
MESSAGE = '프로그램을 완전히 종료하시겠습니까?\n\n종료하면 텔레그램 알림, 자동 백업, 클라우드 동기화도 멈춥니다.'
_MB_YESNO, _MB_ICONQUESTION, _MB_TOPMOST, _IDYES = 0x4, 0x20, 0x40000, 6


def _message_box_yes(message: str, title: str) -> bool:
    import ctypes
    return ctypes.windll.user32.MessageBoxW(0, message, title, _MB_YESNO | _MB_ICONQUESTION | _MB_TOPMOST) == _IDYES


def confirm_exit(ask: Callable[[str, str], bool] = _message_box_yes) -> bool:
    """종료해도 되면 True. 확인 상자를 띄우지 못하면(비 Windows 등) 종료를 막지 않도록 True."""
    try:
        return bool(ask(MESSAGE, TITLE))
    except Exception:
        return True
