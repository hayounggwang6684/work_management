"""계측지 항목 정의 / 입력 정규화 / 헤더 구성 테스트"""
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import pytest

from PDM.backend import measurement as M

INFO = {'contractNumber': 'SH-2026-179-T', 'company': '선진엔텍', 'shipName': '선진호',
        'engineModel': 'M/E FUSSO 91A', 'location': '부산', 'startDate': '2026-09-10', 'endDate': '2026-09-16'}


def test_templates_define_the_three_forms_without_fixed_sides():
    forms = M.load_templates()
    assert [f['id'] for f in forms] == ['crankpin', 'mainjournal', 'conrod']
    assert all('sides' not in f for f in forms)           # PORT/STBD 고정 구분은 없다 — 장 수와 라벨을 사용자가 정한다


def test_default_journal_instance_matches_template_dimensions():
    inst = M.default_instance('crankpin')
    assert (inst['formId'], inst['label'], inst['phase'], inst['gaugeNo']) == ('crankpin', '', '', '')
    assert 'side' not in inst
    assert inst['spec']['primary'] == {'standard': '89.91', 'limit': '0.05'}
    assert inst['unitBase'] == {'outDia': '89.91', 'innerDia': ''}
    assert [len(inst['tables'][t]) for t in ('outDia', 'innerDia', 'clearance')] == [4, 4, 2]
    assert all(len(r) == 8 for rows in inst['tables'].values() for r in rows)
    assert inst['remarks'] == ''


def test_default_conrod_instance():
    inst = M.default_instance('conrod', '2호기')
    assert inst['label'] == '2호기'
    assert inst['rowLabels'][:4] == ['L1', 'L2', 'L3', 'L4'] and len(inst['rowLabels']) == 12
    assert len(inst['cells']) == 12 and all(len(r) == 8 for r in inst['cells'])
    assert (inst['torque'], inst['original'], inst['std'], inst['limit']) == ('', '95', '', '')


def test_default_instance_rejects_unknown_form():
    with pytest.raises(ValueError):
        M.default_instance('nope')


def test_build_header_maps_work_info():
    h = M.build_header(INFO, '허종회', date(2026, 9, 16))
    assert h['workNo'] == 'SH-2026-179-T' and h['inspDate'] == '2026-09-16'
    assert (h['owner'], h['shipName'], h['inspBy'], h['makerType']) == ('선진엔텍', '선진호', '허종회', 'M/E FUSSO 91A')
    assert h['apprBy'] == '' and h['forms'] == []
    assert h['coverEngine'] == 'M/E FUSSO 91A' and h['coverShip'] == '선진호'


def test_normalize_pads_trims_and_cleans_cells():
    header = M.build_header(INFO, 'u', date(2026, 9, 16))
    inst = M.default_instance('crankpin')
    inst['tables']['outDia'] = [['2', ' 3 ', 4, None]]            # 짧은 행/표, 숫자·None 섞임
    inst['tables']['innerDia'][0][0] = 'x' * 50                    # 너무 긴 값
    header['forms'] = [inst]
    out = M.normalize_header(header)
    t = out['forms'][0]['tables']
    assert t['outDia'][0] == ['2', '3', '4', '', '', '', '', '']
    assert len(t['outDia']) == 4 and all(len(r) == 8 for r in t['outDia'])
    assert len(t['innerDia'][0][0]) == M.MAX_CELL_LEN


def test_normalize_rejects_unknown_form():
    header = M.build_header(INFO, 'u', date(2026, 9, 16))
    header['forms'] = [{'formId': 'nope'}]
    with pytest.raises(ValueError):
        M.normalize_header(header)
    header['forms'] = ['not a dict']
    with pytest.raises(ValueError):
        M.normalize_header(header)


def test_same_form_can_appear_on_several_pages_with_own_data():
    """1호기·2호기처럼 같은 양식을 여러 장 넣는 경우 — 장마다 입력값과 라벨이 독립이다."""
    header = M.build_header(INFO, 'u', date(2026, 9, 16))
    a, b = M.default_instance('crankpin', '1호기'), M.default_instance('crankpin', '2호기')
    a['tables']['outDia'][0][0] = '2'
    b['tables']['outDia'][0][0] = '9'
    header['forms'] = [a, b]
    out = M.normalize_header(header)['forms']
    assert [f['label'] for f in out] == ['1호기', '2호기']
    assert [f['tables']['outDia'][0][0] for f in out] == ['2', '9']


def test_page_count_limits():
    header = M.build_header(INFO, 'u', date(2026, 9, 16))
    header['forms'] = [M.default_instance('crankpin') for _ in range(M.MAX_PER_FORM + 1)]
    with pytest.raises(ValueError):
        M.normalize_header(header)
    header['forms'] = [M.default_instance(fid) for fid in ('crankpin', 'mainjournal', 'conrod') for _ in range(M.MAX_PER_FORM)]
    assert len(M.normalize_header(header)['forms']) == 3 * M.MAX_PER_FORM


def test_legacy_side_is_read_as_label_and_label_is_capped():
    header = M.build_header(INFO, 'u', date(2026, 9, 16))
    header['forms'] = [{'formId': 'crankpin', 'side': 'PORT'}, {'formId': 'crankpin', 'label': 'x' * 100}]
    out = M.normalize_header(header)['forms']
    assert out[0]['label'] == 'PORT' and 'side' not in out[0]
    assert len(out[1]['label']) == M.MAX_LABEL_LEN


def test_normalize_fills_missing_parts_from_defaults_and_fixes_phase():
    header = M.build_header(INFO, 'u', date(2026, 9, 16))
    header['forms'] = [{'formId': 'conrod', 'phase': 'bogus', 'torque': 12}]
    out = M.normalize_header(header)['forms'][0]
    assert out['phase'] == '' and out['torque'] == '12'
    assert out['original'] == '95' and len(out['cells']) == 12


def test_normalize_keeps_order_and_limits_common_text():
    header = M.build_header(INFO, 'u', date(2026, 9, 16))
    header['owner'] = 'o' * 500
    header['forms'] = [M.default_instance('conrod', '2호기'), M.default_instance('crankpin', '1호기')]
    out = M.normalize_header(header)
    assert [(f['formId'], f['label']) for f in out['forms']] == [('conrod', '2호기'), ('crankpin', '1호기')]
    assert len(out['owner']) == M.MAX_TEXT_LEN
