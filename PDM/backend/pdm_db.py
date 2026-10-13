"""PDM 전용 SQLite (pdm.db). 모든 테이블은 pdm_ 접두사 — 본체 DB와 분리."""
import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

SCHEMA = '''
CREATE TABLE IF NOT EXISTS pdm_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_type TEXT NOT NULL,
    contract_number TEXT NOT NULL DEFAULT '',
    ship_name TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    header_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'draft',
    created_by TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pdm_documents_contract ON pdm_documents(contract_number);
CREATE TABLE IF NOT EXISTS pdm_sr_summary (
    doc_id INTEGER NOT NULL REFERENCES pdm_documents(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (doc_id, seq)
);
CREATE TABLE IF NOT EXISTS pdm_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id INTEGER NOT NULL REFERENCES pdm_documents(id) ON DELETE CASCADE,
    page_group INTEGER NOT NULL DEFAULT 0,
    slot_index INTEGER NOT NULL,
    caption TEXT NOT NULL DEFAULT '',
    image_blob BLOB,
    thumb_blob BLOB,
    original_blob BLOB,
    width INTEGER,
    height INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pdm_photos_doc ON pdm_photos(doc_id, page_group, slot_index);
CREATE TABLE IF NOT EXISTS pdm_measurements (
    doc_id INTEGER NOT NULL REFERENCES pdm_documents(id) ON DELETE CASCADE,
    form_type TEXT NOT NULL,
    side TEXT NOT NULL DEFAULT '',
    data_json TEXT NOT NULL DEFAULT '{}',
    remarks TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (doc_id, form_type, side)
);
CREATE TABLE IF NOT EXISTS pdm_print_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_type TEXT NOT NULL UNIQUE,
    layout_json TEXT NOT NULL DEFAULT '{}',
    updated_by TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS pdm_form_templates (
    id TEXT PRIMARY KEY,
    definition_json TEXT NOT NULL,
    updated_by TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS pdm_orders (
    contract_number TEXT PRIMARY KEY COLLATE NOCASE,
    company TEXT NOT NULL DEFAULT '',
    ship_name TEXT NOT NULL DEFAULT '',
    engine_model TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS pdm_summary_history (
    engine_model TEXT NOT NULL,
    text TEXT NOT NULL,
    use_count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (engine_model, text)
);
'''

DOC_TYPES = ('service_report', 'measurement', 'photo_album')
_NOW_MS = "strftime('%Y-%m-%d %H:%M:%f','now')"


class ConflictError(Exception):
    """다른 사용자가 먼저 저장함 (updated_at 불일치)."""


class PdmDb:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            conn.executescript(SCHEMA)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(str(self.path), timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA foreign_keys = ON')
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def create_document(self, doc_type: str, contract_number: str, ship_name: str,
                        title: str, header: Dict[str, Any], user: str) -> int:
        if doc_type not in DOC_TYPES:
            raise ValueError(f'알 수 없는 문서 종류: {doc_type}')
        with self.connect() as conn:
            cur = conn.execute(
                'INSERT INTO pdm_documents (doc_type, contract_number, ship_name, title, '
                'header_json, created_by, updated_by, created_at, updated_at) '
                f'VALUES (?,?,?,?,?,?,?,{_NOW_MS},{_NOW_MS})',
                (doc_type, contract_number, ship_name, title,
                 json.dumps(header, ensure_ascii=False), user, user))
            return int(cur.lastrowid)

    def get_document(self, doc_id: int) -> Optional[Dict[str, Any]]:
        with self.connect() as conn:
            row = conn.execute('SELECT * FROM pdm_documents WHERE id = ?', (doc_id,)).fetchone()
        return _doc_row(row) if row else None

    def list_documents(self, contract_number: str = '', doc_type: str = '') -> List[Dict[str, Any]]:
        sql, params = 'SELECT * FROM pdm_documents WHERE 1=1', []
        if contract_number:
            sql += ' AND contract_number = ?'
            params.append(contract_number)
        if doc_type:
            sql += ' AND doc_type = ?'
            params.append(doc_type)
        with self.connect() as conn:
            rows = conn.execute(sql + ' ORDER BY updated_at DESC, id DESC', params).fetchall()
        return [_doc_row(r) for r in rows]

    def update_document(self, doc_id: int, expected_updated_at: str, title: str,
                        header: Dict[str, Any], user: str) -> str:
        """낙관적 잠금: expected_updated_at 이 현재 값과 다르면 ConflictError. 새 updated_at 반환."""
        with self.connect() as conn:
            row = conn.execute('SELECT updated_at FROM pdm_documents WHERE id = ?', (doc_id,)).fetchone()
            if row is None:
                raise KeyError(doc_id)
            if row['updated_at'] != expected_updated_at:
                raise ConflictError(f'다른 사용자가 먼저 저장했습니다 ({row["updated_at"]})')
            new_ts = _next_ts(conn, row['updated_at'])
            # 확인과 갱신 사이에 다른 저장이 끼어들어도 덮어쓰지 않도록 조건부 UPDATE 로 한 번 더 막는다 (원자적)
            changed = conn.execute(
                'UPDATE pdm_documents SET title=?, header_json=?, updated_by=?, updated_at=? WHERE id=? AND updated_at=?',
                (title, json.dumps(header, ensure_ascii=False), user, new_ts, doc_id, expected_updated_at)).rowcount
            if not changed:
                raise ConflictError('다른 사용자가 먼저 저장했습니다.')
        return new_ts

    def touch_document(self, doc_id: int, user: str) -> str:
        """본문 외 변경(사진 등)도 최종 수정자/시각에 반영. 새 updated_at 반환."""
        with self.connect() as conn:
            row = conn.execute('SELECT updated_at FROM pdm_documents WHERE id = ?', (doc_id,)).fetchone()
            if row is None:
                raise KeyError(doc_id)
            new_ts = _next_ts(conn, row['updated_at'])
            conn.execute('UPDATE pdm_documents SET updated_by=?, updated_at=? WHERE id=?', (user, new_ts, doc_id))
        return new_ts

    # ── 사용자 정의 계측 양식 ───────────────────────────────────────────────────
    def list_custom_forms(self) -> List[Dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute('SELECT definition_json FROM pdm_form_templates ORDER BY rowid').fetchall()
        return [json.loads(r['definition_json']) for r in rows]

    def save_custom_form(self, form_id: str, definition: Dict[str, Any], user: str) -> None:
        with self.connect() as conn:
            conn.execute(
                'INSERT INTO pdm_form_templates (id, definition_json, updated_by, updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP) '
                'ON CONFLICT(id) DO UPDATE SET definition_json=excluded.definition_json, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP',
                (form_id, json.dumps(definition, ensure_ascii=False), user))

    def delete_custom_form(self, form_id: str) -> bool:
        with self.connect() as conn:
            return bool(conn.execute('DELETE FROM pdm_form_templates WHERE id = ?', (form_id,)).rowcount)

    def form_usage_count(self, form_id: str) -> int:
        """이 양식을 쓰는 계측지 문서 수 (사용 중이면 삭제를 막는 데 쓴다)."""
        with self.connect() as conn:
            rows = conn.execute("SELECT header_json FROM pdm_documents WHERE doc_type = 'measurement'").fetchall()
        return sum(1 for r in rows if any(f.get('formId') == form_id for f in json.loads(r['header_json']).get('forms', [])))

    # ── 출력 양식 설정 (전체 공유, 1행) ───────────────────────────────────────
    LAYOUT_KEY = 'default'

    def get_layout(self) -> Optional[Dict[str, Any]]:
        with self.connect() as conn:
            row = conn.execute('SELECT layout_json FROM pdm_print_templates WHERE doc_type = ?', (self.LAYOUT_KEY,)).fetchone()
        return json.loads(row['layout_json']) if row else None

    def save_layout(self, layout: Dict[str, Any], user: str) -> None:
        with self.connect() as conn:
            conn.execute(
                'INSERT INTO pdm_print_templates (doc_type, layout_json, updated_by, updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP) '
                'ON CONFLICT(doc_type) DO UPDATE SET layout_json=excluded.layout_json, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP',
                (self.LAYOUT_KEY, json.dumps(layout, ensure_ascii=False), user))

    def record_summary_history(self, engine_model: str, lines: List[str]) -> None:
        """엔진별 Summary 항목 사용 횟수 누적 (자동 제안용 데이터)."""
        model = (engine_model or '').strip()
        texts = [t.strip() for t in lines if t and t.strip()]
        if not model or not texts:
            return
        with self.connect() as conn:
            for text in texts:
                conn.execute(
                    'INSERT INTO pdm_summary_history (engine_model, text) VALUES (?, ?) '
                    'ON CONFLICT(engine_model, text) DO UPDATE SET use_count = use_count + 1',
                    (model, text))

    def get_summary_history(self, engine_model: str, limit: int = 50) -> List[str]:
        with self.connect() as conn:
            rows = conn.execute(
                'SELECT text FROM pdm_summary_history WHERE engine_model = ? '
                'ORDER BY use_count DESC, text LIMIT ?', ((engine_model or '').strip(), limit)).fetchall()
        return [r['text'] for r in rows]

    def document_counts(self, contract_numbers: List[str]) -> Dict[str, Dict[str, int]]:
        """계약번호별 문서 건수 {계약번호: {'service_report': n, 'measurement': m}} — 문서가 하나도 없는 계약번호는 빠진다."""
        if not contract_numbers:
            return {}
        marks = ','.join('?' * len(contract_numbers))
        with self.connect() as conn:
            rows = conn.execute(
                f'SELECT contract_number, doc_type, COUNT(*) AS n FROM pdm_documents '
                f'WHERE contract_number IN ({marks}) GROUP BY contract_number, doc_type', list(contract_numbers)).fetchall()
        counts: Dict[str, Dict[str, int]] = {}
        for r in rows:
            counts.setdefault(r['contract_number'], {t: 0 for t in DOC_TYPES})[r['doc_type']] = r['n']
        return counts

    # ── 판매용 독립 주문 (작업현황에 공사가 없는 건: 부품 판매 등) ──────────────────────
    def create_standalone_order(self, contract_number: str, company: str, ship_name: str, engine_model: str, user: str) -> None:
        """이미 있는 계약번호면 ValueError."""
        with self.connect() as conn:
            try:
                conn.execute("INSERT INTO pdm_orders (contract_number, company, ship_name, engine_model, created_by, created_at) "
                             "VALUES (?,?,?,?,?,datetime('now','localtime'))",
                             (contract_number, company, ship_name, engine_model, user))
            except sqlite3.IntegrityError:
                raise ValueError(f'이미 등록된 계약번호입니다: {contract_number}')

    def get_standalone_order(self, contract_number: str) -> Optional[Dict[str, Any]]:
        with self.connect() as conn:
            row = conn.execute('SELECT * FROM pdm_orders WHERE contract_number = ?', (contract_number,)).fetchone()
        return _order_info(row) if row else None

    def list_standalone_orders(self, start: str, end: str, like: str) -> List[Dict[str, Any]]:
        """등록일(로컬 날짜, start~end 포함)이 기간 안이고 계약번호/선박/업체가 like 패턴(SQL ESCAPE 백슬래시)에 맞는 판매용 주문. 최근 등록 순."""
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM pdm_orders WHERE date(created_at) BETWEEN ? AND ? "
                "AND (contract_number LIKE ? ESCAPE '\\' OR ship_name LIKE ? ESCAPE '\\' OR company LIKE ? ESCAPE '\\') "
                "ORDER BY created_at DESC, contract_number", (start, end, like, like, like)).fetchall()
        return [_order_info(r) for r in rows]

    def delete_document(self, doc_id: int) -> None:
        with self.connect() as conn:
            conn.execute('DELETE FROM pdm_documents WHERE id = ?', (doc_id,))


def _next_ts(conn: sqlite3.Connection, previous: str) -> str:
    """현재 시각(ms). 이전 값과 같으면 1ms 더해 항상 달라지게 한다 (낙관적 잠금 감지용)."""
    ts = conn.execute(f'SELECT {_NOW_MS}').fetchone()[0]
    if ts <= previous:
        ts = conn.execute("SELECT strftime('%Y-%m-%d %H:%M:%f', ?, '+0.001 seconds')", (previous,)).fetchone()[0]
    return ts


def _order_info(row: sqlite3.Row) -> Dict[str, Any]:
    """판매용 주문 → 작업현황 주문 정보와 같은 모양 (작업 기간/장소는 없음). registeredDate 는 로컬 등록일."""
    return {'contractNumber': row['contract_number'], 'company': row['company'], 'shipName': row['ship_name'],
            'engineModel': row['engine_model'], 'location': '', 'startDate': '', 'endDate': '',
            'registeredDate': row['created_at'][:10], 'standalone': True}


def _doc_row(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        'id': row['id'], 'docType': row['doc_type'], 'contractNumber': row['contract_number'],
        'shipName': row['ship_name'], 'title': row['title'], 'header': json.loads(row['header_json']),
        'status': row['status'], 'createdBy': row['created_by'], 'updatedBy': row['updated_by'],
        'createdAt': row['created_at'], 'updatedAt': row['updated_at'],
    }
