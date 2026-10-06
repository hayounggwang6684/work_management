"""공사현황(기간별 주문 목록) 테스트: 작업현황 조회 + PDM 문서 건수"""
import sqlite3
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
sys.modules.setdefault('eel', types.SimpleNamespace(expose=lambda f: f))

import pytest

from PDM.backend import adapters, runtime
from PDM.backend import api as pdm_api
from PDM.backend.pdm_db import PdmDb

ROWS = [
    # date, no, contract, company, ship, engine
    ('2026-05-20', 1, 'SH-2026-057-T', '세동상운', 'GL2030', 'CUMMINS KTA38'),
    ('2026-05-21', 1, 'SH-2026-057-T', '세동상운', 'GL2030', 'CUMMINS KTA38'),
    ('2026-06-23', 1, 'SH-2026-057-T', '세동상운', 'GL2030', 'CUMMINS KTA38'),
    ('2026-06-10', 1, 'SH-2026-100-T', '선진엔텍', '선진호', 'FUSO 91A'),
    ('2026-06-10', 2, 'SH-2026-100-T', '선진엔텍', '선진호', 'FUSO 91A'),     # 같은 날 두 행 → 작업일 1일
    ('2026-07-30', 1, 'SH-2026-200-T', '대한', '대한호', 'MAN'),
    ('2026-06-15', 1, '', '무계약', '미정', ''),                               # 계약번호 없음 → 제외
]


@pytest.fixture
def work_db(tmp_path, monkeypatch):
    path = tmp_path / 'work.db'
    conn = sqlite3.connect(path)
    conn.execute('CREATE TABLE work_records (date TEXT, record_number INT, contract_number TEXT, '
                 'company TEXT, ship_name TEXT, engine_model TEXT, location TEXT)')
    conn.executemany('INSERT INTO work_records (date, record_number, contract_number, company, ship_name, engine_model) VALUES (?,?,?,?,?,?)', ROWS)
    conn.commit()
    conn.close()
    monkeypatch.setenv('PDM_WORK_DB_PATH', str(path))
    monkeypatch.setenv('PDM_DB_PATH', str(tmp_path / 'pdm.db'))
    monkeypatch.setattr(runtime, '_db', None)
    monkeypatch.setattr(runtime, '_photos', None)
    return path


def contracts(rows):
    return [r['contractNumber'] for r in rows]


def test_lists_orders_with_work_in_range_latest_first(work_db):
    rows = adapters.list_projects('2026-06-01', '2026-06-30')
    assert contracts(rows) == ['SH-2026-057-T', 'SH-2026-100-T']        # 6/23 > 6/10 순
    assert 'SH-2026-200-T' not in contracts(rows) and '' not in contracts(rows)


def test_range_is_inclusive_and_counts_distinct_days_in_range(work_db):
    rows = {r['contractNumber']: r for r in adapters.list_projects('2026-05-21', '2026-06-10')}
    assert rows['SH-2026-057-T']['daysInRange'] == 1            # 5/21 만 (5/20, 6/23 은 범위 밖)
    assert rows['SH-2026-100-T']['daysInRange'] == 1            # 같은 날 두 행도 1일


def test_first_and_last_date_cover_the_whole_order_not_just_the_range(work_db):
    row = adapters.list_projects('2026-06-01', '2026-06-30')[0]
    assert (row['firstDate'], row['lastDate']) == ('2026-05-20', '2026-06-23')
    assert (row['company'], row['shipName'], row['engineModel']) == ('세동상운', 'GL2030', 'CUMMINS KTA38')


def test_query_filters_by_contract_ship_or_company(work_db):
    assert contracts(adapters.list_projects('2026-01-01', '2026-12-31', 'GL2030')) == ['SH-2026-057-T']
    assert contracts(adapters.list_projects('2026-01-01', '2026-12-31', '선진')) == ['SH-2026-100-T']
    assert contracts(adapters.list_projects('2026-01-01', '2026-12-31', '200-T')) == ['SH-2026-200-T']


@pytest.mark.parametrize('start,end', [('2026/06/01', '2026-06-30'), ('2026-06-01', ''), ('x', 'y'), ('2026-07-01', '2026-06-01')])
def test_invalid_range_raises(work_db, start, end):
    with pytest.raises(ValueError):
        adapters.list_projects(start, end)


def test_sql_injection_in_query_is_just_a_literal(work_db):
    assert adapters.list_projects('2026-01-01', '2026-12-31', "'; DROP TABLE work_records;--") == []
    assert len(adapters.list_projects('2026-01-01', '2026-12-31')) == 3


def test_missing_work_db_returns_empty(tmp_path, monkeypatch):
    monkeypatch.setenv('PDM_WORK_DB_PATH', str(tmp_path / 'nope.db'))
    assert adapters.list_projects('2026-01-01', '2026-12-31') == []


# ── PDM 문서 건수 ───────────────────────────────────────────────────────────

def test_document_counts_group_by_contract_and_type(tmp_path):
    db = PdmDb(tmp_path / 'pdm.db')
    db.create_document('service_report', 'A', '', 't', {}, 'u')
    db.create_document('service_report', 'A', '', 't2', {}, 'u')
    db.create_document('measurement', 'A', '', 'm', {}, 'u')
    db.create_document('measurement', 'B', '', 'm', {}, 'u')
    counts = db.document_counts(['A', 'B', 'C'])
    assert counts['A'] == {'service_report': 2, 'measurement': 1}
    assert counts['B'] == {'service_report': 0, 'measurement': 1}
    assert 'C' not in counts and db.document_counts([]) == {}


# ── API ────────────────────────────────────────────────────────────────────

def test_api_merges_projects_with_document_counts(work_db):
    runtime.get_db().create_document('service_report', 'SH-2026-057-T', 'GL2030', 't', {}, 'u')
    r = pdm_api.pdm_list_projects('2026-06-01', '2026-06-30', '')
    assert r['success'] and [p['contractNumber'] for p in r['projects']] == ['SH-2026-057-T', 'SH-2026-100-T']
    assert r['projects'][0]['docs'] == {'serviceReport': 1, 'measurement': 0}
    assert r['projects'][1]['docs'] == {'serviceReport': 0, 'measurement': 0}


def test_api_reports_bad_range_as_message(work_db):
    r = pdm_api.pdm_list_projects('bad', '2026-06-30', '')
    assert r['success'] is False and 'YYYY-MM-DD' in r['message']


def test_like_wildcards_in_query_are_literal(work_db):
    """검색어의 % 와 _ 는 와일드카드가 아니라 글자 그대로 취급한다."""
    assert adapters.list_projects('2026-01-01', '2026-12-31', '%') == []
    assert adapters.list_projects('2026-01-01', '2026-12-31', '_') == []
    assert adapters.search_orders('%') == [] and adapters.search_orders('_') == []
    assert len(adapters.list_projects('2026-01-01', '2026-12-31', 'SH-2026')) == 3        # 일반 부분일치는 그대로


def test_like_escape_matches_real_underscore_and_percent(tmp_path, monkeypatch):
    path = tmp_path / 'w.db'
    conn = sqlite3.connect(path)
    conn.execute('CREATE TABLE work_records (date TEXT, record_number INT, contract_number TEXT, company TEXT, ship_name TEXT, engine_model TEXT, location TEXT)')
    conn.execute("INSERT INTO work_records (date, record_number, contract_number, company, ship_name) VALUES ('2026-06-01', 1, 'SH-1', 'A_B', '100% 호')")
    conn.execute("INSERT INTO work_records (date, record_number, contract_number, company, ship_name) VALUES ('2026-06-02', 1, 'SH-2', 'AxB', '100 호')")
    conn.commit(); conn.close()
    monkeypatch.setenv('PDM_WORK_DB_PATH', str(path))
    assert contracts(adapters.list_projects('2026-01-01', '2026-12-31', 'A_B')) == ['SH-1']      # _ 는 'AxB' 에 맞지 않는다
    assert contracts(adapters.list_projects('2026-01-01', '2026-12-31', '100%')) == ['SH-1']
