"""텔레그램으로 파일(PDF) 보내기 — PDF 읽기 오류 보고 (네트워크는 가짜로 대체)"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from src.database.auth_manager import auth_manager
from src.utils import telegram_notifier as tn


class FakeResponse:
    def __init__(self, ok=True, status=200):
        self.status_code, self._ok, self.text = status, ok, ''

    def json(self):
        return {'ok': self._ok}


@pytest.fixture
def notifier(monkeypatch):
    n = tn.TelegramNotifier()
    n.bot_token, n.enabled = 'TOKEN', True
    return n


def test_sends_document_to_every_linked_admin(notifier, monkeypatch):
    posts = []
    monkeypatch.setattr(auth_manager, 'get_admin_telegram_chat_ids', lambda: ['111', '222'])
    monkeypatch.setattr(tn.requests, 'post', lambda url, data=None, files=None, timeout=None: posts.append((url, data, files)) or FakeResponse())

    r = notifier.send_document_to_admins('old.pdf', b'%PDF-1.4 x', '설명')

    assert r['success'] and r['sent'] == 2
    assert [p[1]['chat_id'] for p in posts] == ['111', '222'] and posts[0][0].endswith('/sendDocument')
    assert posts[0][2]['document'] == ('old.pdf', b'%PDF-1.4 x', 'application/pdf') and posts[0][1]['caption'] == '설명'


def test_reports_when_no_admin_is_linked_or_bot_is_off(notifier, monkeypatch):
    monkeypatch.setattr(auth_manager, 'get_admin_telegram_chat_ids', lambda: [])
    assert notifier.send_document_to_admins('a.pdf', b'x', 'c') == {'success': False, 'sent': 0, 'message': '텔레그램이 연결된 관리자가 없어 보내지 못했습니다. 관리자 계정에서 텔레그램 연결을 먼저 해 주세요.'}
    notifier.enabled = False
    assert notifier.send_document_to_admins('a.pdf', b'x', 'c')['success'] is False


def test_failure_of_every_send_is_reported(notifier, monkeypatch):
    monkeypatch.setattr(auth_manager, 'get_admin_telegram_chat_ids', lambda: ['111'])
    monkeypatch.setattr(tn.requests, 'post', lambda *a, **k: FakeResponse(ok=False, status=400))

    r = notifier.send_document_to_admins('a.pdf', b'x', 'c')

    assert r['success'] is False and r['sent'] == 0


def test_a_network_error_does_not_raise(notifier, monkeypatch):
    def boom(*a, **k):
        raise tn.requests.ConnectionError('down')
    monkeypatch.setattr(auth_manager, 'get_admin_telegram_chat_ids', lambda: ['111'])
    monkeypatch.setattr(tn.requests, 'post', boom)

    assert notifier.send_document_to_admins('a.pdf', b'x', 'c')['success'] is False
