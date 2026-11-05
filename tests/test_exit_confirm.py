"""프로그램 종료 확인 — 예/아니오, 상자를 못 띄우는 환경에서는 종료를 막지 않는다"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.utils import exit_confirm


def test_yes_exits_and_no_cancels():
    assert exit_confirm.confirm_exit(lambda message, title: True) is True
    assert exit_confirm.confirm_exit(lambda message, title: False) is False


def test_the_dialog_text_warns_about_background_features():
    seen = {}
    exit_confirm.confirm_exit(lambda message, title: seen.update(m=message, t=title) or True)
    assert '완전히 종료' in seen['m'] and '텔레그램' in seen['m'] and seen['t'] == '금일작업현황 관리'


def test_failure_to_show_the_dialog_does_not_block_exiting():
    def broken(message, title):
        raise OSError('no windll')
    assert exit_confirm.confirm_exit(broken) is True
