"""PDM DB / adapters 테스트 — python -m pytest PDM/tests"""
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import pytest

from PDM.backend import adapters
from PDM.backend.pdm_db import ConflictError, PdmDb


@pytest.fixture
def db(tmp_path):
    return PdmDb(tmp_path / 'pdm.db')


@pytest.fixture
def work_db(tmp_path, monkeypatch):
    path = tmp_path / 'work.db'
    conn = sqlite3.connect(path)
    conn.execute('CREATE TABLE work_records (date TEXT, record_number INT, contract_number TEXT, '
                 'company TEXT, ship_name TEXT, engine_model TEXT, location TEXT)')
    conn.executemany('INSERT INTO work_records VALUES (?,?,?,?,?,?,?)', [
        ('2026-05-20', 1, 'SH-2026-057-T', '세동상운', 'GL2030', 'CUMMINS KTA38', '통영'),
        ('2026-06-23', 1, 'SH-2026-057-T', '세동상운', 'GL2030', 'CUMMINS KTA38', '통영 야나세'),
        ('2026-09-16', 1, 'SH-2026-179-T', '선진엔텍', '선진호', 'FUSO 91A', '부산'),
    ])
    conn.commit()
    conn.close()
    monkeypatch.setenv('PDM_WORK_DB_PATH', str(path))
    return path


def test_creates_pdm_tables_only(db):
    with db.connect() as conn:
        names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {'pdm_documents', 'pdm_photos', 'pdm_measurements'} <= names
    assert all(n.startswith('pdm_') or n.startswith('sqlite_') for n in names)


def test_document_roundtrip(db):
    doc_id = db.create_document('service_report', 'SH-1', '선진호', 't', {'a': '한글'}, '홍길동')
    doc = db.get_document(doc_id)
    assert doc['header'] == {'a': '한글'} and doc['createdBy'] == '홍길동'


def test_rejects_unknown_doc_type(db):
    with pytest.raises(ValueError):
        db.create_document('bogus', 'SH-1', '', '', {}, 'u')


def test_optimistic_lock_conflict(db):
    doc_id = db.create_document('service_report', 'SH-1', '', '', {}, 'u')
    ts = db.get_document(doc_id)['updatedAt']
    new_ts = db.update_document(doc_id, ts, 'v2', {}, 'a')
    assert new_ts != ts
    with pytest.raises(ConflictError):
        db.update_document(doc_id, ts, 'v3', {}, 'b')  # 오래된 ts


def test_delete_cascades_photos(db):
    doc_id = db.create_document('service_report', 'SH-1', '', '', {}, 'u')
    with db.connect() as conn:
        conn.execute('INSERT INTO pdm_photos (doc_id, slot_index) VALUES (?, 0)', (doc_id,))
    db.delete_document(doc_id)
    with db.connect() as conn:
        assert conn.execute('SELECT COUNT(*) FROM pdm_photos').fetchone()[0] == 0


def test_search_orders_groups_by_contract(work_db):
    res = adapters.search_orders('GL2030')
    assert len(res) == 1
    assert res[0]['contractNumber'] == 'SH-2026-057-T'
    assert (res[0]['startDate'], res[0]['endDate']) == ('2026-05-20', '2026-06-23')


def test_get_order_info_uses_latest_row_and_period(work_db):
    info = adapters.get_order_info('SH-2026-057-T')
    assert info['location'] == '통영 야나세'
    assert info['startDate'] == '2026-05-20' and info['endDate'] == '2026-06-23'


def test_missing_order_and_blank_query(work_db):
    assert adapters.get_order_info('NOPE') == {}
    assert adapters.search_orders('  ') == []


def test_work_db_is_read_only(work_db):
    conn = adapters._open_readonly()
    with pytest.raises(sqlite3.OperationalError):
        conn.execute("INSERT INTO work_records (date) VALUES ('x')")
    conn.close()
