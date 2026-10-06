"""PDM ↔ 본체(금일작업현황) 접점. 통합할 때 이 파일만 본체 쪽으로 교체한다.

접점 3개:
    get_current_user()   — 현재 로그인 사용자 (작성자)
    search_orders()/get_order_info() — 주문 검색 / 작업현황 헤더 정보 (읽기 전용)
    get_pdm_db_path()    — PDM 전용 DB 경로

단독 개발 중에는 본체 DB(work_management.db)를 읽기 전용(mode=ro)으로만 연다.
"""
import os
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional

_DEFAULT_DB_DIR = Path(os.environ.get('PDM_DB_DIR', r'C:\Users\admin\Desktop\db'))

# 단독 실행용 더미 사용자. 통합 시 서버 세션(src.web.permissions)으로 교체.
_DEV_USER = {'user_id': 'dev', 'full_name': '개발자', 'role': 'admin', 'can_write': True}


def get_current_user() -> Dict[str, Any]:
    """현재 사용자. 통합 시: 서버 세션에서 읽을 것 (JS 인자 신뢰 금지)."""
    return dict(_DEV_USER)


def can_manage_templates(user: Optional[Dict[str, Any]] = None) -> bool:
    """출력 양식/계측 양식처럼 전체 사용자에게 영향을 주는 설정을 바꿀 수 있는가. 통합 시: 서버 세션의 role == 'admin'."""
    return True


def get_pdm_db_path() -> Path:
    override = os.environ.get('PDM_DB_PATH')
    return Path(override) if override else _DEFAULT_DB_DIR / 'pdm.db'


def _work_db_path() -> Path:
    override = os.environ.get('PDM_WORK_DB_PATH')
    return Path(override) if override else _DEFAULT_DB_DIR / 'work_management.db'


def _open_readonly() -> Optional[sqlite3.Connection]:
    path = _work_db_path()
    if not path.exists():
        return None
    conn = sqlite3.connect(f'file:{path.as_posix()}?mode=ro', uri=True, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def search_orders(query: str, limit: int = 30) -> List[Dict[str, Any]]:
    """계약번호/선박/업체 부분일치로 주문 목록(계약번호 단위) 검색."""
    q = (query or '').strip()
    if not q:
        return []
    conn = _open_readonly()
    if conn is None:
        return []
    like = f'%{q}%'
    try:
        rows = conn.execute(
            "SELECT contract_number, MAX(company) AS company, MAX(ship_name) AS ship_name, "
            "       MAX(engine_model) AS engine_model, MIN(date) AS start_date, MAX(date) AS end_date "
            "FROM work_records "
            "WHERE contract_number != '' AND (contract_number LIKE ? OR ship_name LIKE ? OR company LIKE ?) "
            "GROUP BY contract_number ORDER BY MAX(date) DESC LIMIT ?",
            (like, like, like, limit),
        ).fetchall()
    finally:
        conn.close()
    return [_order_row(r) for r in rows]


def get_order_info(contract_number: str) -> Dict[str, Any]:
    """문서 헤더 자동 채움용 주문 정보. 없으면 {}."""
    cn = (contract_number or '').strip()
    if not cn:
        return {}
    conn = _open_readonly()
    if conn is None:
        return {}
    try:
        row = conn.execute(
            "SELECT contract_number, company, ship_name, engine_model, location, "
            "       (SELECT MIN(date) FROM work_records WHERE contract_number = ?) AS start_date, "
            "       (SELECT MAX(date) FROM work_records WHERE contract_number = ?) AS end_date "
            "FROM work_records WHERE contract_number = ? ORDER BY date DESC, record_number DESC LIMIT 1",
            (cn, cn, cn),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        return {}
    info = _order_row(row)
    info['location'] = row['location'] or ''
    return info


def _order_row(row: sqlite3.Row) -> Dict[str, Any]:
    keys = row.keys()
    return {
        'contractNumber': row['contract_number'] or '',
        'company': row['company'] or '',
        'shipName': row['ship_name'] or '',
        'engineModel': row['engine_model'] or '',
        'startDate': (row['start_date'] if 'start_date' in keys else '') or '',
        'endDate': (row['end_date'] if 'end_date' in keys else '') or '',
    }
