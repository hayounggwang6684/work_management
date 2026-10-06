"""권한 등급 데코레이터 / adapters 주입 지점 테스트"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
sys.modules.setdefault('eel', types.SimpleNamespace(expose=lambda f: f))

import pytest

from PDM.backend import adapters
from PDM.backend.guard import guarded


@pytest.fixture(autouse=True)
def clean_hooks():
    adapters._hooks.clear()
    yield
    adapters._hooks.clear()


@guarded('write')
def write_fn(x):
    return {'success': True, 'x': x}


def test_allows_everything_in_standalone_dev_mode():
    assert write_fn(1) == {'success': True, 'x': 1}


def test_fails_closed_when_no_hook_and_not_dev_mode():
    """본체 연결(훅 주입)이 빠진 채 PDM 이 먼저 import 되어도 무방비로 열리지 않아야 한다."""
    adapters._dev_mode = False
    r = write_fn(1)
    assert r['success'] is False and r['authError'] is True
    assert adapters.get_current_user() == {}                  # 가짜 관리자 사용자도 만들지 않는다
    adapters.configure(check_access=lambda tier: None)        # 훅이 주입되면 정상 동작
    assert write_fn(1)['success'] is True


def test_denies_with_dict_message_when_adapter_refuses():
    adapters.configure(check_access=lambda tier: f'{tier} 권한 필요')
    r = write_fn(1)
    assert r['success'] is False and 'write' in r['message'] and r['authError'] is True


def test_tier_is_passed_to_adapter_and_recorded_on_function():
    seen = []
    adapters.configure(check_access=lambda tier: seen.append(tier))
    write_fn(1)
    assert seen == ['write'] and write_fn.__pdm_tier__ == 'write'


def test_unknown_tier_is_rejected_at_decoration_time():
    with pytest.raises(ValueError):
        guarded('root')


def test_hooks_override_user_and_paths(tmp_path, monkeypatch):
    monkeypatch.delenv('PDM_DB_PATH', raising=False)
    monkeypatch.delenv('PDM_WORK_DB_PATH', raising=False)
    adapters.configure(current_user=lambda: {'full_name': '홍길동', 'role': 'user'},
                       pdm_db_path=lambda: tmp_path / 'p.db', work_db_path=lambda: tmp_path / 'w.db')
    assert adapters.get_current_user()['full_name'] == '홍길동'
    assert adapters.get_pdm_db_path() == tmp_path / 'p.db'
    assert adapters._work_db_path() == tmp_path / 'w.db'


def test_env_override_wins_over_hooks(tmp_path, monkeypatch):
    monkeypatch.setenv('PDM_DB_PATH', str(tmp_path / 'env.db'))
    adapters.configure(pdm_db_path=lambda: tmp_path / 'hook.db')
    assert adapters.get_pdm_db_path() == tmp_path / 'env.db'


def test_can_manage_templates_follows_admin_tier():
    assert adapters.can_manage_templates() is True
    adapters.configure(check_access=lambda tier: None if tier != 'admin' else '관리자만')
    assert adapters.can_manage_templates() is False


def test_every_exposed_pdm_api_declares_a_tier_and_writes_are_not_guest():
    """등급이 빠진 API 가 없어야 한다 — 본체에 붙었을 때 무방비로 노출되지 않도록."""
    from PDM.backend import api, photo_api, settings_api
    found = {}
    for mod in (api, photo_api, settings_api):
        for name in dir(mod):
            fn = getattr(mod, name)
            if name.startswith('pdm_') and callable(fn):
                assert hasattr(fn, '__pdm_tier__'), f'{name}: 권한 등급 없음'
                found[name] = fn.__pdm_tier__
    assert len(found) >= 22
    for name in ('pdm_create_document', 'pdm_save_document', 'pdm_add_photo', 'pdm_remove_photo', 'pdm_update_photo',
                 'pdm_restore_photo_original', 'pdm_set_photo_caption', 'pdm_insert_blank_slot'):
        assert found[name] == 'write', name
    for name in ('pdm_save_layout', 'pdm_save_form_def', 'pdm_delete_form_def', 'pdm_preview_form_def'):
        assert found[name] == 'admin', name
