"""권한 게이트 회귀 테스트 — python tests/test_permissions.py

깨지면 안 되는 것: 등급 판정, 반환 타입에 맞는 거부값, api.py 145개 배선.
"""
import sys
from pathlib import Path
from typing import Any, Dict, List

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.web import permissions as P

ADMIN = {'user_id': 'a', 'role': 'admin', 'can_write': 0}          # can_write=0 이어도 admin 은 통과해야 함
WRITER = {'user_id': 'w', 'role': 'user', 'can_write': 1}
READER = {'user_id': 'r', 'role': 'user', 'can_write': 0}
ERPER = {'user_id': 'e', 'role': 'user', 'can_write': 1, 'erp_input': 1}


@P.require('guest')
def d_guest() -> Dict[str, Any]: return {'success': True}


@P.require('login')
def d_login() -> Dict[str, Any]: return {'success': True}


@P.require('write')
def d_write() -> Dict[str, Any]: return {'success': True}


@P.require('admin')
def d_admin() -> Dict[str, Any]: return {'success': True}


@P.require('erp')
def d_erp() -> Dict[str, Any]: return {'success': True}


@P.require('public')
def d_public() -> Dict[str, Any]: return {'success': True}


def ok(r) -> bool:
    return not (isinstance(r, dict) and r.get('auth_error'))


def session(kind):
    P.end_session()
    if kind == 'guest':
        P.begin_guest_session()
    elif kind:
        P.begin_session(kind)


def test_matrix():
    # (세션, guest, login, write, admin, erp)
    cases = [
        (None,   False, False, False, False, False),
        ('guest', True, False, False, False, False),
        (READER,  True,  True, False, False, False),
        (WRITER,  True,  True,  True, False, False),
        (ADMIN,   True,  True,  True,  True, False),
        (ERPER,   True,  True,  True, False,  True),
    ]
    for sess, g, l, w, a, e in cases:
        session(sess)
        label = sess if isinstance(sess, str) else (sess or {}).get('user_id', 'none')
        assert ok(d_guest()) == g, f"{label}: guest"
        assert ok(d_login()) == l, f"{label}: login"
        assert ok(d_write()) == w, f"{label}: write"
        assert ok(d_admin()) == a, f"{label}: admin"
        assert ok(d_erp()) == e, f"{label}: erp"
        assert ok(d_public()), f"{label}: public 은 항상 통과"


def test_denial_matches_return_type():
    """dict 가 아닌 함수에 dict 를 돌려주면 JS 의 .map()/.trim() 이 터진다."""

    @P.require('admin')
    def as_list() -> List[Dict[str, Any]]: return [{'x': 1}]

    @P.require('admin')
    def as_str() -> str: return 'v'

    @P.require('admin')
    def as_bool() -> bool: return True

    session(READER)
    assert as_list() == []
    assert as_str() == ''
    assert as_bool() is False


def test_api_wiring():
    """@eel.expose 145개가 전부 게이트를 통과하도록 배선돼 있는지."""
    from src.web import api

    exposed = [n for n in dir(api)
               if callable(getattr(api, n, None)) and hasattr(getattr(api, n), '__auth_tier__')]
    assert len(exposed) >= 145, f"보호된 함수 {len(exposed)}개 — 배선 누락"

    expect = {
        'load_work_records': 'guest',
        'save_work_records': 'write',
        'admin_delete_user': 'admin',
        'admin_merge_vendor_companies': 'admin',
        'admin_preview_merge_vendor_companies': 'admin',
        'get_employee_directory': 'login',   # 전화번호·주소 → 게스트 차단
        'load_vacation_data': 'guest',       # 일일 작업 탭에 같이 보이는 화면
        'save_vacation_data': 'write',       # 조회는 게스트, 저장은 쓰기 권한
        'authenticate': 'public',
        'start_erp_macro': 'erp',
    }
    for name, tier in expect.items():
        got = getattr(api, name).__auth_tier__
        assert got == tier, f"{name}: {got} (기대 {tier})"


def test_logout_clears():
    session(ADMIN)
    assert ok(d_admin())
    P.end_session()
    assert not ok(d_admin())


if __name__ == '__main__':
    for fn in [test_matrix, test_denial_matches_return_type, test_api_wiring, test_logout_clears]:
        fn()
        print(f"  OK  {fn.__name__}")
    P.end_session()
    print("통과")
