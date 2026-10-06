"""PDM ↔ 본체 연동 글루 테스트 — python tests/test_pdm_bridge.py (venv: eel 필요)

확인: 서버 세션 기반 권한 판정이 PDM API 에 적용되는지, 경로가 본체 설정을 따르는지,
      PDM API 가 Eel 에 등록되는지, PDM 쪽 문제가 본체 기동을 막지 않는지.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from PDM.backend import adapters
from src.web import permissions as P
from src.web import pdm_bridge

ADMIN = {'user_id': 'a', 'full_name': '관리자', 'role': 'admin', 'can_write': 0}
WRITER = {'user_id': 'w', 'full_name': '작성자', 'role': 'user', 'can_write': 1}
READER = {'user_id': 'r', 'full_name': '조회자', 'role': 'user', 'can_write': 0}


def setup():
    adapters._hooks.clear()
    pdm_bridge.install()
    P.end_session()


def test_session_drives_access_decisions():
    setup()
    assert adapters.check_access('guest') is not None            # 세션 없음 → 거부 (로그인 필요)
    P.begin_guest_session()
    assert adapters.check_access('guest') is None                # 게스트는 조회 가능
    assert adapters.check_access('write') is not None            # 쓰기는 불가
    P.begin_session(READER)
    assert adapters.check_access('write') is not None
    P.begin_session(WRITER)
    assert adapters.check_access('write') is None
    assert adapters.check_access('admin') is not None
    assert adapters.can_manage_templates() is False
    P.begin_session(ADMIN)
    assert adapters.check_access('admin') is None
    assert adapters.can_manage_templates() is True
    P.end_session()


def test_current_user_comes_from_server_session():
    setup()
    assert adapters.get_current_user().get('full_name', '') == ''     # 세션 없으면 빈 사용자
    P.begin_session(WRITER)
    assert adapters.get_current_user()['full_name'] == '작성자'
    P.end_session()


def test_paths_follow_main_app_config():
    import os
    from src.utils.config import config
    setup()
    os.environ.pop('PDM_DB_PATH', None)
    os.environ.pop('PDM_WORK_DB_PATH', None)
    assert adapters._work_db_path() == Path(config.db_path)
    assert adapters.get_pdm_db_path() == Path(config.db_path).parent / 'pdm.db'


def test_pdm_api_is_exposed_through_main_api_and_denied_without_session():
    import eel
    import src.web.api  # noqa: F401  — 여기서 PDM 이 연결된다
    P.end_session()
    exposed = getattr(eel, '_exposed_functions', {})
    for name in ('pdm_ping', 'pdm_list_projects', 'pdm_save_document', 'pdm_save_layout'):
        assert name in exposed, f'{name} 이 Eel 에 등록되지 않음'
    r = exposed['pdm_list_projects']('2026-01-01', '2026-12-31', '')
    assert r['success'] is False and r.get('authError') is True     # 세션 없으면 거부, 예외 없음
    P.begin_session(READER)
    assert exposed['pdm_save_document'](1, '', 't', {})['authError'] is True       # 조회자는 쓰기 거부
    P.end_session()


def test_main_api_survives_pdm_failure():
    """PDM 연결이 실패해도 본체 api 모듈은 로드되어야 한다 (try/except 로 격리)."""
    from src.web import api
    assert hasattr(api, 'PDM_STATUS') and api.PDM_STATUS in ('ok', 'error')


if __name__ == '__main__':
    for fn in [test_session_drives_access_decisions, test_current_user_comes_from_server_session,
               test_paths_follow_main_app_config, test_pdm_api_is_exposed_through_main_api_and_denied_without_session,
               test_main_api_survives_pdm_failure]:
        fn()
        print(f"  OK  {fn.__name__}")
    P.end_session()
    print("통과")
