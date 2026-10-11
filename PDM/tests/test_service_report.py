"""서비스레포트 헤더 생성 / Summary 이력 테스트"""
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import pytest

from PDM.backend.pdm_db import PdmDb
from PDM.backend.service_report import build_header, format_period

INFO = {
    'contractNumber': 'SH-2026-057-T', 'company': '세동상운', 'shipName': 'GL2030',
    'engineModel': 'CUMMINS KTA38', 'location': '통영 야나세',
    'startDate': '2026-05-20', 'endDate': '2026-06-23',
}


def test_period_same_year_shortens_end():
    assert format_period('2026-05-20', '2026-06-23') == '2026.05.20 ~ 06.23'


def test_period_different_year_keeps_full_end():
    assert format_period('2025-12-30', '2026-01-02') == '2025.12.30 ~ 2026.01.02'


def test_period_single_day_and_missing():
    assert format_period('2026-05-20', '2026-05-20') == '2026.05.20'
    assert format_period('', '') == ''


def test_build_header_maps_work_info_and_user():
    h = build_header(INFO, '이성찬 대리', date(2026, 7, 23))
    assert h['vesselName'] == 'GL2030' and h['orderNo'] == 'SH-2026-057-T'
    assert h['model'] == 'CUMMINS KTA38' and h['customer'] == '세동상운'
    assert h['reportedBy'] == '이성찬 대리' and h['date'] == '2026.07.23'
    assert h['period'] == '2026.05.20 ~ 06.23' and h['location'] == '통영 야나세'


def test_build_header_leaves_manual_fields_blank():
    h = build_header(INFO, 'u', date(2026, 7, 23))
    assert h['imoNo'] == '' and h['serialNo'] == '' and h['requestedBy'] == ''
    assert h['summary'] == [] and h['remark'] == ''


@pytest.fixture
def db(tmp_path):
    return PdmDb(tmp_path / 'pdm.db')


def test_summary_history_counts_repeats_and_ignores_blank(db):
    db.record_summary_history('KTA38', ['T/C 오버홀', '  ', 'T/C 오버홀', 'Fuel injector 테스트'])
    db.record_summary_history('KTA38', ['T/C 오버홀'])
    assert db.get_summary_history('KTA38') == ['T/C 오버홀', 'Fuel injector 테스트']
    assert db.get_summary_history('OTHER') == []


# ── 저장 전 정규화 (서버 검증) ───────────────────────────────────────────────

from PDM.backend.service_report import normalize_header


def full_header(**over):
    h = build_header({'contractNumber': 'SH-1', 'shipName': 'S', 'company': 'C', 'engineModel': 'M'}, 'u', date(2026, 1, 1))
    h.update(over)
    return h


def test_normalize_keeps_known_fields_and_drops_unknown_keys():
    out = normalize_header(full_header(evil={'x': 1}, subject='  제목  '))
    assert 'evil' not in out and out['subject'] == '제목' and out['orderNo'] == 'SH-1'


def test_normalize_caps_text_summary_remark_and_page_titles():
    out = normalize_header(full_header(
        subject='s' * 500, remark='r' * 10000,
        summary=['  1. 항목'] + ['x' * 999] * 100 + ['', '   '],
        pageTitles={'0': 'p' * 500, '1': 'ok', 'abc': 'bad', '999': 'out of range'}))
    assert len(out['subject']) == 100 and len(out['remark']) == 2000
    assert len(out['summary']) == 60 and out['summary'][0] == '  1. 항목'.rstrip()   # 앞 공백(들여쓰기)은 유지
    assert all(len(line) <= 200 for line in out['summary'])
    assert out['pageTitles'] == {'0': 'p' * 100, '1': 'ok'}


def test_normalize_summary_must_be_a_list_of_strings():
    assert normalize_header(full_header(summary='문자열 하나'))['summary'] == []     # 글자 단위로 쪼개지 않는다
    assert normalize_header(full_header(summary=[1, None, '정상']))['summary'] == ['1', '정상']


def test_normalize_survives_garbage_values():
    out = normalize_header({'summary': {'a': 1}, 'pageTitles': ['x'], 'remark': None, 'vesselName': 5})
    assert out['summary'] == [] and out['pageTitles'] == {} and out['remark'] == '' and out['vesselName'] == '5'


def test_photos_per_page_is_limited_to_the_supported_layouts():
    assert normalize_header(full_header())['photosPerPage'] == 6                  # 기본값
    assert normalize_header(full_header(photosPerPage=4))['photosPerPage'] == 4    # 가로 2x2
    assert normalize_header(full_header(photosPerPage='4'))['photosPerPage'] == 4  # 문자열로 와도 정수로
    for bad in (5, 0, 99, -1, None, 'abc', [], {}):
        assert normalize_header(full_header(photosPerPage=bad))['photosPerPage'] == 6
