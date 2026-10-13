"""계측 표준값 테스트 — 엑셀 붙여넣기 해석, 엔진명 매칭, 계측지 자동 채움, 저장소/API(권한 포함)"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
sys.modules.setdefault('eel', types.SimpleNamespace(expose=lambda f: f))      # 시스템 Python 에는 eel 이 없다

import pytest

from PDM.backend import adapters, api, measurement, runtime, standards, standards_api


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    monkeypatch.setenv('PDM_DB_PATH', str(tmp_path / 'pdm.db'))
    for name in ('_db', '_photos', '_standards'):
        monkeypatch.setattr(runtime, name, None)
    yield
    measurement.set_custom_provider(None)


def row(maker, model, **data):
    return {'maker': maker, 'model': model, 'data': data}


# ── 해석 ─────────────────────────────────────────────────────────────────────

def test_clean_value_removes_float_noise_and_keeps_text():
    assert standards.clean_value(96.10199999999999) == '96.102'
    assert standards.clean_value(0.0800000000000125) == '0.08'
    assert standards.clean_value(6.0) == '6'
    assert standards.clean_value(' ±0.1 ') == '±0.1'
    assert standards.clean_value(None) == ''


def test_parse_rows_skips_header_lines_and_maps_columns_in_order():
    text = '엔진모델\t\tCRANK PIN\n\t\t수축\nMAKER\tMODEL\tSTANDARD\nCUMMINS\tKTA38\t107.95\t0.05\t6\t165.1\t0.05\n\n'
    rows = standards.parse_rows(text)
    assert rows == [{'maker': 'CUMMINS', 'model': 'KTA38',
                     'data': {'crankpin_std': '107.95', 'crankpin_limit': '0.05', 'crankpin_n': '6', 'main_std': '165.1', 'main_limit': '0.05'}}]


def test_normalize_row_requires_model_and_drops_unknown_keys():
    with pytest.raises(ValueError):
        standards.normalize_row({'maker': 'X', 'model': '  '})
    out = standards.normalize_row({'maker': 'X', 'model': 'M1', 'data': {'crankpin_std': 5, 'bogus': 'z', 'main_std': ''}})
    assert out == {'maker': 'X', 'model': 'M1', 'data': {'crankpin_std': '5'}}


# ── 매칭 ─────────────────────────────────────────────────────────────────────

ROWS = [row('CUMMINS', 'KTA38'), row('CUMMINS', 'KTA19'), row('CATERPILLAR', '3512'), row('CATERPILLAR', '3512B'),
        row('DOOSAN', '180'), row('MAN', 'D2366'), row('DOOSAN', '2366'), row('DETROIT DISEL', '8V-71'),
        row('CATERPILLAR', '3406'), row('CATERPILLAR', '신형 3406')]


def model_of(engine):
    found = standards.match_engine(engine, ROWS)['standard']
    return found['model'] if found else None


@pytest.mark.parametrize('engine,expected', [
    ('CUMMINS KTA38', 'KTA38'), ('CUM KTA-38', 'KTA38'), ('M/E cummins kta 19', 'KTA19'),
    ('CAT 3512', '3512'), ('CATERPILLAR 3512B', '3512B'), ('MAN D2366', 'D2366'),
    ('DETROIT DIESEL 8V-71', '8V-71'), ('CAT 신형 3406', '신형 3406'),
])
def test_match_engine_finds_the_right_row(engine, expected):
    assert model_of(engine) == expected


@pytest.mark.parametrize('engine', ['FUSO 91A', 'DOOSAN DV15', 'YANMAR 6N18', '', 'KTA3'])
def test_match_engine_returns_nothing_for_unknown_engines(engine):
    assert model_of(engine) is None


def test_numeric_model_needs_the_maker_too():
    assert model_of('SOMETHING 180') is None          # 숫자만 있는 모델은 제조사가 없으면 안 맞춘다
    assert model_of('DOOSAN 180') == '180'


def test_ambiguous_match_is_not_picked_but_listed():
    found = standards.match_engine('CAT 3406', ROWS)
    assert found['standard']['model'] == '3406'      # '신형 3406' 은 '신형' 이 없어 제외 → 하나만 남음
    both = standards.match_engine('CAT 3406', [row('CATERPILLAR', '3406'), row('CATERPILLAR', '3406', crankpin_std='1')])
    assert both['standard'] is None and len(both['candidates']) == 2


# ── 계측지 채움 ──────────────────────────────────────────────────────────────

DATA = {'crankpin_std': '107.95', 'crankpin_limit': '0.05', 'main_std': '165.1', 'main_limit': '0.05',
        'liner_std': '158.77', 'liner_limit': '0.08', 'piston_std': '158.53', 'piston_limit': '0.233~0.271(사이 간극)',
        'conrod_original': '114.34', 'conrod_limit': '±0.1', 'conrod_torque': '240lb', 'pin': '46', 'bush': '46.01',
        'cam_std': '70.03', 'cam_limit': '69.94'}


def test_fill_patch_crankpin_uses_standard_limit_and_outer_base():
    p = standards.fill_patch('crankpin', DATA)
    assert p['spec'] == {'primary': {'standard': '107.95', 'limit': '0.05'}}
    assert p['unitBase'] == {'outDia': '107.95'}


def test_fill_patch_conrod_skips_non_numeric_torque_and_reports_it():
    p = standards.fill_patch('conrod', DATA)
    assert (p['original'], p['limit']) == ('114.34', '±0.1') and 'torque' not in p
    assert any('240lb' in n for n in p['notes'])


def test_fill_patch_skips_values_too_long_for_a_cell():
    p = standards.fill_patch('linerpiston', DATA)
    assert p['spec']['liner'] == {'standard': '158.77', 'limit': '0.08'}
    assert p['spec']['piston'] == {'standard': '158.53'}                     # 한계 '0.233~0.271(사이 간극)' 은 칸에 안 들어감
    assert any('0.233~0.271' in n for n in p['notes'])
    assert p['unitBase'] == {'linerDia': '158.77', 'pistonDia': '158.53'}


def test_fill_patch_for_other_forms_and_custom_forms():
    assert standards.fill_patch('pistonpin', DATA)['unitBase'] == {'pinDia': '46', 'bossBush': '46.01'}
    cam = standards.fill_patch('camshaft', DATA)
    assert cam['spec']['primary'] == {'standard': '70.03', 'limit': '69.94'} and cam['unitBase'] == {'outDia': '70.03'}
    assert standards.fill_patch('custom_ab12cd34', DATA) == {'spec': {}, 'unitBase': {}, 'notes': []}


def test_apply_patch_keeps_measurements_and_does_not_mutate():
    inst = measurement.default_instance('camshaft')
    inst['tables']['outDia'][0][0] = '5'
    out = standards.apply_patch(inst, standards.fill_patch('camshaft', DATA))
    assert out['spec']['primary']['standard'] == '70.03' and out['unitBase']['outDia'] == '70.03'
    assert out['tables']['outDia'][0][0] == '5'
    assert inst['spec']['primary']['standard'] == ''


@pytest.mark.parametrize('form_id', ['crankpin', 'mainjournal', 'conrod', 'linerpiston', 'pistonpin', 'camshaft'])
def test_every_fill_map_target_exists_in_the_form(form_id):
    form = {f['id']: f for f in measurement.load_templates()}[form_id]
    plan = standards.FILL_MAP[form_id]
    assert set(plan.get('spec', {})) <= {s['id'] for s in form.get('spec', [])}
    assert set(plan.get('base', {})) <= {t['id'] for t in form.get('tables', []) if t['unit']}
    inst = measurement.default_instance(form_id)
    assert set(plan.get('extra', {})) <= set(inst)


# ── 저장소 / 번들 표준값 ─────────────────────────────────────────────────────

def test_bundled_seed_is_loaded_once_and_not_reloaded_after_deleting():
    store = runtime.get_standards()
    rows = store.list()
    assert len(rows) >= 70 and any(r['model'] == 'KTA38' and r['maker'] == 'CUMMINS' for r in rows)
    for r in rows:
        store.delete(r['id'])
    runtime._standards = None
    assert runtime.get_standards().list() == []


def test_bundled_standards_match_real_engines():
    store = runtime.get_standards()
    assert store.match('CUMMINS KTA38')['standard']['data']['crankpin_std'] == '107.95'
    assert store.match('CAT 3512')['standard']['model'] == '3512'
    assert store.match('M/E CUMMINS NTA855')['standard']['data']['crankpin_std'] == '79.38'


def test_import_updates_existing_and_adds_new_without_wiping_other_columns():
    store = runtime.get_standards()
    text = 'CUMMINS\tKTA38\t110.5\nNEWMAKER\tZX9\t1.5\t0.07\n'
    result = store.import_rows(standards.parse_rows(text), 'tester')
    assert result == {'added': 1, 'updated': 1}
    kta = store.match('CUMMINS KTA38')['standard']['data']
    assert kta['crankpin_std'] == '110.5' and kta['main_std'] == '165.1'        # 붙여넣지 않은 칸은 유지
    assert store.match('NEWMAKER ZX9')['standard']['data']['crankpin_limit'] == '0.07'


# ── API ──────────────────────────────────────────────────────────────────────

def test_new_measurement_form_fills_standard_when_engine_is_known():
    r = api.pdm_new_measurement_form('crankpin', '', 'CUMMINS KTA38')
    assert r['success'] and r['matched'] == 'CUMMINS KTA38'
    assert r['form']['spec']['primary'] == {'standard': '107.95', 'limit': '0.05'} and r['form']['unitBase']['outDia'] == '107.95'


def test_new_measurement_form_without_engine_or_unknown_engine_keeps_defaults():
    assert api.pdm_new_measurement_form('crankpin')['matched'] is None
    r = api.pdm_new_measurement_form('crankpin', '', 'FUSO 91A')
    assert r['success'] and r['matched'] is None and r['form']['spec']['primary']['standard'] == '89.91'


def test_apply_standard_reports_candidates_and_missing_engine():
    assert standards_api.pdm_apply_standard('crankpin', '')['success'] is False
    r = standards_api.pdm_apply_standard('crankpin', 'FUSO 91A')
    assert r['success'] and r['matched'] is None and r['patch'] is None
    assert standards_api.pdm_apply_standard('nope', 'CUMMINS KTA38')['success'] is False


def test_only_admin_may_change_standards(monkeypatch):
    monkeypatch.setattr(adapters, 'check_access', lambda tier: '관리자만 가능합니다.' if tier == 'admin' else None)
    assert standards_api.pdm_save_standard({'model': 'X'})['authError'] is True
    assert standards_api.pdm_delete_standard(1)['authError'] is True
    assert standards_api.pdm_import_standards('A\tB')['authError'] is True
    assert standards_api.pdm_list_standards()['success'] is True and standards_api.pdm_apply_standard('crankpin', 'CAT 3512')['success']


def test_save_standard_validates_and_update_missing_row_fails():
    ok = standards_api.pdm_save_standard({'maker': 'A', 'model': 'B', 'data': {'crankpin_std': '1'}})
    assert ok['success'] and ok['row']['id']
    assert standards_api.pdm_save_standard({'maker': 'A', 'model': ''})['success'] is False
    assert standards_api.pdm_save_standard({'maker': 'A', 'model': 'B'}, 99999)['success'] is False
    assert standards_api.pdm_import_standards('only header\tMODEL')['success'] is False


# ── 검토 지적 사항 회귀 ──────────────────────────────────────────────────────

def test_duplicate_engine_is_rejected_on_save_and_nothing_is_half_imported():
    store = runtime.get_standards()
    with pytest.raises(ValueError):
        store.save({'maker': 'cummins', 'model': 'kta38'}, 'tester')              # 대소문자만 달라도 같은 엔진
    before = len(store.list())
    with pytest.raises(ValueError):
        store.import_rows([row('NEW', 'A1'), {'maker': 'X', 'model': ''}], 'tester')   # 두 번째 행이 잘못 → 첫 행도 반영되지 않음
    assert len(store.list()) == before


def test_standards_failure_does_not_block_creating_a_form(monkeypatch):
    def boom(*_):
        raise RuntimeError('db locked')
    monkeypatch.setattr(standards_api, 'standard_patch', boom)
    r = api.pdm_new_measurement_form('crankpin', '', 'CUMMINS KTA38')
    assert r['success'] and r['matched'] is None and r['form']['spec']['primary']['standard'] == '89.91'


def test_seed_runs_once_even_if_the_store_is_opened_twice():
    first = runtime.get_standards().list()
    runtime._standards = None
    assert len(runtime.get_standards().list()) == len(first)
