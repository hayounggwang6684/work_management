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
