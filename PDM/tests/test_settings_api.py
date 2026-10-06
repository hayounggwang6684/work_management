"""설정 API(출력 양식/양식 관리) 테스트 — 권한, 검증 오류 응답, 사용 중 삭제 방지"""
import base64
import io
import sys
import types
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
sys.modules.setdefault('eel', types.SimpleNamespace(expose=lambda f: f))      # 시스템 Python 에는 eel 이 없다

import pytest
from PIL import Image

from PDM.backend import adapters, measurement, runtime
from PDM.backend import settings_api as S


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    monkeypatch.setenv('PDM_DB_PATH', str(tmp_path / 'pdm.db'))
    monkeypatch.setattr(runtime, '_db', None)
    monkeypatch.setattr(runtime, '_photos', None)
    yield
    measurement.set_custom_provider(None)


def definition(**over):
    d = {'label': '캠', 'title': 'RECORD OF CAM', 'sides': ['PORT'], 'spec': [{'label': 'CAM', 'standard': '1', 'limit': '2'}],
         'tables': [{'title': 'T', 'colLabel': 'No.', 'cols': 4, 'rowsKind': 'FA', 'role': 'plain'}]}
    d.update(over)
    return d


def png_uri():
    buf = io.BytesIO(); Image.new('RGB', (50, 50), 'red').save(buf, 'PNG')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def deny(monkeypatch):
    # 본체 연동 시와 같은 경로: guard → adapters.check_access. admin 등급만 거부, 조회(guest)는 허용
    monkeypatch.setattr(adapters, 'check_access', lambda tier: '이 설정은 관리자만 변경할 수 있습니다.' if tier == 'admin' else None)


def test_layout_defaults_then_save_and_read_back():
    assert S.pdm_get_layout()['layout']['company'] == 'SUNJIN JONGHAP Co.,Ltd.'
    r = S.pdm_save_layout({'company': 'ACME', 'photoFit': 'contain'})
    assert r['success'] and r['layout']['company'] == 'ACME'
    assert S.pdm_get_layout()['layout']['photoFit'] == 'contain'


def test_layout_validation_errors_are_reported_not_raised():
    r = S.pdm_save_layout({'photoFit': 'stretch'})
    assert r['success'] is False and 'cover' in r['message']
    assert S.pdm_save_layout({'logo': 'garbage'})['success'] is False


def test_layout_save_requires_manager(monkeypatch):
    deny(monkeypatch)
    r = S.pdm_save_layout({'company': 'X'})
    assert r['success'] is False and '관리자' in r['message']
    assert S.pdm_get_layout()['success'] is True            # 읽기는 누구나


def test_form_def_create_update_and_listing():
    r = S.pdm_save_form_def(definition())
    assert r['success'] and r['form']['id'].startswith('custom_')
    form_id = r['form']['id']
    assert form_id in [f['id'] for f in measurement.load_templates()]
    r2 = S.pdm_save_form_def(definition(label='캠 수정'), form_id)
    assert r2['success'] and r2['form']['id'] == form_id and r2['form']['label'] == '캠 수정'
    assert sum(1 for f in measurement.load_templates() if f['id'] == form_id) == 1


def test_form_def_cannot_overwrite_builtin_or_unknown():
    assert S.pdm_save_form_def(definition(), 'crankpin')['success'] is False
    assert S.pdm_save_form_def(definition(), 'custom_nope')['success'] is False


def test_form_def_invalid_definition_returns_message():
    r = S.pdm_save_form_def(definition(tables=[]))
    assert r['success'] is False and '표' in r['message']


def test_form_def_requires_manager(monkeypatch):
    deny(monkeypatch)
    assert S.pdm_save_form_def(definition())['success'] is False
    assert S.pdm_delete_form_def('custom_x')['success'] is False


def test_delete_blocked_while_documents_use_it_and_builtin_is_protected():
    form_id = S.pdm_save_form_def(definition())['form']['id']
    header = measurement.build_header({'contractNumber': 'SH-1', 'shipName': 'S'}, 'u', date(2026, 1, 1))
    header['forms'] = [measurement.default_instance(form_id, 'PORT')]
    doc = runtime.get_db().create_document('measurement', 'SH-1', 'S', 't', measurement.normalize_header(header), 'u')
    blocked = S.pdm_delete_form_def(form_id)
    assert blocked['success'] is False and '1' in blocked['message']
    runtime.get_db().delete_document(doc)
    assert S.pdm_delete_form_def(form_id)['success'] is True
    assert S.pdm_delete_form_def('crankpin')['success'] is False


def test_form_def_with_diagram_image():
    r = S.pdm_save_form_def(definition(diagramImage=png_uri()))
    assert r['success'] and r['form']['diagramImage'].startswith('data:image/png;base64,')
