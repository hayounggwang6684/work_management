"""사용자 정의 계측 양식: 검증 / 저장 / 병합 / 사용 중 삭제 방지 테스트"""
import base64
import io
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import pytest
from PIL import Image

from PDM.backend import form_defs as F
from PDM.backend import measurement as M
from PDM.backend.pdm_db import PdmDb


def raw_def(**over):
    base = {
        'label': '캠샤프트 저널', 'title': 'RECORD OF CAMSHAFT JOURNAL', 'code': 'SJ-200', 'sides': ['PORT', 'STBD'],
        'spec': [{'label': 'CAM JOURNAL\nOUT DIA', 'standard': '59.9', 'limit': '0.05'}],
        'tables': [
            {'title': 'CAM JOURNAL OUT DIA', 'colLabel': 'Journal\nNo.', 'cols': 6, 'rowsKind': 'FA_TBPS', 'role': 'outer', 'unitBase': '60', 'unitOp': '-'},
            {'title': 'CAM BEARING INNER DIA', 'colLabel': 'Bearing\nNo.', 'cols': 6, 'rowsKind': 'FA_TBPS', 'role': 'inner', 'unitBase': '', 'unitOp': '+'},
            {'title': 'CLEARANCE', 'colLabel': 'Journal\nNo.', 'cols': 6, 'rowsKind': 'FA', 'role': 'clearance'},
        ],
    }
    base.update(over)
    return base


def test_valid_definition_is_normalized_into_form_structure():
    f = F.validate_definition(raw_def())
    assert f['layout'] == 'journalGrid' and f['custom'] is True and f['indexTitle'] == 'RECORD OF CAMSHAFT JOURNAL'
    assert [t['id'] for t in f['tables']] == ['t1', 't2', 't3']
    assert f['tables'][0]['rows'] == [['F', 'TB'], ['F', 'PS'], ['A', 'TB'], ['A', 'PS']]
    assert f['tables'][2]['rows'] == [['F'], ['A']] and f['tables'][2]['unit'] is None
    assert f['tables'][0]['unit'] == {'base': '60', 'op': '-'} and f['tables'][1]['unit'] == {'base': '', 'op': '+'}
    assert [s['id'] for s in f['spec']] == ['primary'] and f['spec'][0]['standard'] == '59.9'
    assert f['sides'] == ['PORT', 'STBD']


@pytest.mark.parametrize('mutate', [
    lambda d: d.update(label=''),
    lambda d: d.update(title='  '),
    lambda d: d.update(tables=[]),
    lambda d: d.update(sides=[]),
    lambda d: d.update(sides=['A', 'A']),
    lambda d: d.update(sides=['A', 'B', 'C', 'D', 'E']),
    lambda d: d.update(sides=['X' * 13]),
    lambda d: d.update(spec=[]),
    lambda d: d.update(spec=[{'label': 'a'}] * 3),
    lambda d: d['tables'][0].update(cols=0),
    lambda d: d['tables'][0].update(cols=9),
    lambda d: d['tables'][0].update(rowsKind='XY'),
    lambda d: d['tables'][0].update(role='weird'),
    lambda d: d['tables'][1].update(role='outer'),                 # outer 중복
    lambda d: d['tables'][0].update(rowsKind='FA'),                # outer 는 F/A x TB/PS 여야 함
    lambda d: d['tables'][2].update(rowsKind='FA_TBPS'),           # clearance 는 F/A 여야 함
    lambda d: d['tables'].append(dict(d['tables'][0], role='plain')),   # 표 4개
])
def test_invalid_definitions_are_rejected(mutate):
    d = raw_def()
    mutate(d)
    with pytest.raises(ValueError):
        F.validate_definition(d)


def test_diagram_image_is_reencoded_and_optional():
    buf = io.BytesIO(); Image.new('RGB', (2400, 800), 'white').save(buf, 'PNG')
    uri = 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()
    f = F.validate_definition(raw_def(diagramImage=uri))
    img = Image.open(io.BytesIO(base64.b64decode(f['diagramImage'].split(',', 1)[1])))
    assert max(img.size) == F.DIAGRAM_MAX_EDGE
    assert F.validate_definition(raw_def())['diagramImage'] is None


@pytest.fixture
def db(tmp_path):
    d = PdmDb(tmp_path / 'pdm.db')
    M.set_custom_provider(d.list_custom_forms)
    yield d
    M.set_custom_provider(None)


def test_custom_forms_roundtrip_and_merge_into_templates(db):
    form = F.validate_definition(raw_def())
    form_id = F.new_custom_id()
    db.save_custom_form(form_id, {**form, 'id': form_id}, '관리자')
    ids = [f['id'] for f in M.load_templates()]
    assert ids[:3] == ['crankpin', 'mainjournal', 'conrod'] and form_id in ids      # 내장 → 사용자 정의 순
    inst = M.default_instance(form_id, 'PORT')
    assert [len(inst['tables']['t1']), len(inst['tables']['t1'][0])] == [4, 6]
    assert inst['spec']['primary']['standard'] == '59.9' and inst['unitBase'] == {'t1': '60', 't2': ''}


def test_documents_can_use_custom_forms_and_deleting_is_blocked_while_used(db):
    form = F.validate_definition(raw_def())
    form_id = F.new_custom_id()
    db.save_custom_form(form_id, {**form, 'id': form_id}, 'a')
    header = M.build_header({'contractNumber': 'SH-1', 'shipName': 'S'}, 'u', date(2026, 1, 1))
    header['forms'] = [M.default_instance(form_id, 'STBD')]
    doc = db.create_document('measurement', 'SH-1', 'S', 't', M.normalize_header(header), 'u')
    assert db.form_usage_count(form_id) == 1 and db.form_usage_count('other') == 0
    db.delete_document(doc)
    assert db.form_usage_count(form_id) == 0
    assert db.delete_custom_form(form_id) is True and db.delete_custom_form(form_id) is False
    assert form_id not in [f['id'] for f in M.load_templates()]


def test_builtin_tables_declare_roles():
    forms = {f['id']: f for f in M.load_templates()}
    assert [t['role'] for t in forms['crankpin']['tables']] == ['outer', 'inner', 'clearance']


def test_preview_instance_works_for_unsaved_definition():
    form = F.validate_definition(raw_def())                  # id 없음 — 저장 전 초안
    inst = M.preview_instance(form)
    assert inst['side'] == 'PORT' and inst['formId'] == form.get('id', '')
    assert len(inst['tables']['t1']) == 4 and inst['spec']['primary']['standard'] == '59.9'
