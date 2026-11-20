"""DB 저장 위치 변경 — 폴더를 입력해도 그 폴더가 저장 위치가 되어야 한다 (예전에는 parent 가 저장되어 DB 와 pdm.db 가 한 단계 위에 생겼다)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from src.utils import settings_manager as sm
from src.utils.settings_manager import SettingsManager, normalize_db_path


@pytest.fixture
def env(tmp_path, monkeypatch):
    old = tmp_path / 'old' / 'work_management.db'
    old.parent.mkdir()
    old.write_bytes(b'OLD-DB')
    monkeypatch.setattr(type(sm.config), 'db_path', property(lambda self: old))
    saved = {}
    manager = SettingsManager()
    monkeypatch.setattr(manager, '_update_config_file', lambda key, value: saved.__setitem__(key, value))
    return manager, saved, tmp_path


# ── 경로 정규화 ──────────────────────────────────────────────────────────

def test_existing_folder_means_db_inside_it(tmp_path):
    assert normalize_db_path(str(tmp_path)) == tmp_path / 'work_management.db'


def test_path_without_db_extension_is_a_folder(tmp_path):
    assert normalize_db_path(str(tmp_path / 'newfolder')) == tmp_path / 'newfolder' / 'work_management.db'


def test_db_file_path_is_kept(tmp_path):
    assert normalize_db_path(str(tmp_path / 'x.db')) == tmp_path / 'x.db'


def test_quotes_spaces_and_trailing_slash_are_cleaned(tmp_path):
    assert normalize_db_path(f' "{tmp_path}\\" ') == tmp_path / 'work_management.db'


# ── 변경 동작 ────────────────────────────────────────────────────────────

def test_entering_an_existing_folder_stores_that_folder_not_its_parent(env):
    manager, saved, tmp_path = env
    target = tmp_path / 'db'
    target.mkdir()

    result = manager.update_local_db_path(str(target))

    assert result['success'] and result['path'] == str(target / 'work_management.db')
    assert saved == {'database.local_path': str(target)}                 # 상위 폴더(tmp_path)가 아니다
    assert (target / 'work_management.db').read_bytes() == b'OLD-DB'       # 현재 DB 를 새 폴더로 복사


def test_entering_a_new_folder_creates_it_and_copies_db(env):
    manager, saved, tmp_path = env

    result = manager.update_local_db_path(str(tmp_path / 'brand' / 'new'))

    assert result['success'] and saved == {'database.local_path': str(tmp_path / 'brand' / 'new')}
    assert (tmp_path / 'brand' / 'new' / 'work_management.db').exists()


def test_existing_db_in_folder_is_used_not_overwritten(env):
    manager, saved, tmp_path = env
    target = tmp_path / 'db'
    target.mkdir()
    (target / 'work_management.db').write_bytes(b'KEEP')

    result = manager.update_local_db_path(str(target))

    assert result['used_existing'] is True and saved == {'database.local_path': str(target)}
    assert (target / 'work_management.db').read_bytes() == b'KEEP'


def test_file_path_still_works(env):
    manager, saved, tmp_path = env

    result = manager.update_local_db_path(str(tmp_path / 'dest' / 'work_management.db'))

    assert result['success'] and saved == {'database.local_path': str(tmp_path / 'dest')}


def test_current_settings_show_where_pdm_files_live(env):
    manager, _, tmp_path = env

    s = manager.get_current_settings()

    assert s['pdm_db_path'] == str(tmp_path / 'old' / 'pdm.db') and s['customs_dir'] == str(tmp_path / 'old' / 'customs')
