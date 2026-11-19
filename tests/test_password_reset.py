"""비밀번호 초기화/변경 회귀 테스트 — python -m pytest tests/test_password_reset.py"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from src.database.auth_manager import AuthManager


@pytest.fixture()
def auth():
    with tempfile.TemporaryDirectory() as d:
        a = AuthManager(str(Path(d) / 'auth.db'))
        a.register_request('kim', 'oldpw1', '김철수')
        a.approve_user('kim', 'ha_admin')
        yield a


def test_reset_returns_temp_password_that_logs_in_and_flags_change(auth):
    temp = auth.reset_password('kim', 'ha_admin')

    assert temp and len(temp) == 8
    assert auth.authenticate('kim', 'oldpw1') == {'error': 'WRONG_PASSWORD'}
    user = auth.authenticate('kim', temp)
    assert user['must_change_password'] == 1


def test_reset_unknown_user_returns_none(auth):
    assert auth.reset_password('nobody', 'ha_admin') is None


def test_temp_passwords_are_not_repeated(auth):
    assert len({auth.reset_password('kim', 'ha_admin') for _ in range(20)}) == 20


def test_change_password_clears_flag_and_new_password_works(auth):
    temp = auth.reset_password('kim', 'ha_admin')

    assert auth.change_password('kim', temp, 'newpw99') == ''

    user = auth.authenticate('kim', 'newpw99')
    assert user['must_change_password'] == 0
    assert auth.authenticate('kim', temp) == {'error': 'WRONG_PASSWORD'}


def test_change_password_rejects_wrong_old_password(auth):
    assert auth.change_password('kim', 'wrong', 'newpw99') == '현재 비밀번호가 일치하지 않습니다.'
    assert auth.authenticate('kim', 'oldpw1')['user_id'] == 'kim'


def test_change_password_rejects_short_or_same_password(auth):
    assert '4자' in auth.change_password('kim', 'oldpw1', 'abc')
    assert '같습니다' in auth.change_password('kim', 'oldpw1', 'oldpw1')


def test_get_all_users_reports_must_change_flag(auth):
    auth.reset_password('kim', 'ha_admin')

    kim = next(u for u in auth.get_all_users() if u['user_id'] == 'kim')

    assert kim['must_change_password'] == 1
