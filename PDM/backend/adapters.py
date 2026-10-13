"""PDM ↔ 본체(금일작업현황) 접점. 본체에 붙일 때는 이 파일을 고치지 않고 configure() 로 훅을 주입한다.

훅 (모두 선택 — 안 주면 단독 개발용 기본값):
    current_user  () -> dict   현재 로그인 사용자 (작성자). 서버 세션에서 읽을 것 (JS 인자 신뢰 금지)
    check_access  (tier) -> Optional[str]   권한 등급(guest/login/write/admin) 판정. 거부 사유 문장, 허용이면 None
    work_db_path  () -> Path   작업현황 DB (읽기 전용으로만 연다)
    pdm_db_path   () -> Path   PDM 전용 DB (pdm.db)
환경변수 PDM_DB_PATH / PDM_WORK_DB_PATH 는 훅보다 우선한다 (테스트/개발용). 훅이 없으면 거부가 기본이며 PDM_DEV_MODE=1 또는 enable_dev_mode() 로만 연다.
"""
import os
import re
import sqlite3
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

_DEFAULT_DB_DIR = Path(os.environ.get('PDM_DB_DIR', r'C:\Users\admin\Desktop\db'))

# 단독 실행용 더미 사용자
_DEV_USER = {'user_id': 'dev', 'full_name': '개발자', 'role': 'admin', 'can_write': True}

_hooks: Dict[str, Callable] = {}
_ISO_DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
MAX_PROJECTS = 500


_dev_mode = os.environ.get('PDM_DEV_MODE') == '1'


def configure(**hooks: Optional[Callable]) -> None:
    """통합 글루(본체 쪽 pdm_bridge)가 시작할 때 한 번 호출. None 인 훅은 무시."""
    _hooks.update({name: fn for name, fn in hooks.items() if fn is not None})


def enable_dev_mode() -> None:
    """단독 개발/테스트 전용: 권한 판정 훅이 없어도 모든 요청을 허용하고 더미 관리자 사용자를 쓴다.
    훅이 없는데 개발 모드도 아니면(= 본체 연결이 빠진 채 PDM 이 로드됨) 모든 요청을 거부한다 (fail-closed)."""
    global _dev_mode
    _dev_mode = True


def get_current_user() -> Dict[str, Any]:
    hook = _hooks.get('current_user')
    if hook:
        return dict(hook() or {})
    return dict(_DEV_USER) if _dev_mode else {}


def check_access(tier: str) -> Optional[str]:
    """등급을 만족하지 못하면 거부 사유, 만족하면 None."""
    hook = _hooks.get('check_access')
    if hook:
        return hook(tier)
    return None if _dev_mode else '권한 판정이 설정되지 않아 요청을 처리할 수 없습니다.'


def can_manage_templates(user: Optional[Dict[str, Any]] = None) -> bool:
    """출력 양식/계측 양식처럼 전체 사용자에게 영향을 주는 설정을 바꿀 수 있는가 (= admin 등급)."""
    return check_access('admin') is None


def get_pdm_db_path() -> Path:
    override = os.environ.get('PDM_DB_PATH')
    if override:
        return Path(override)
    hook = _hooks.get('pdm_db_path')
    return Path(hook()) if hook else _DEFAULT_DB_DIR / 'pdm.db'


def _work_db_path() -> Path:
    override = os.environ.get('PDM_WORK_DB_PATH')
    if override:
        return Path(override)
    hook = _hooks.get('work_db_path')
    return Path(hook()) if hook else _DEFAULT_DB_DIR / 'work_management.db'


def _open_readonly() -> Optional[sqlite3.Connection]:
    path = _work_db_path()
    if not path.exists():
        return None
    # URI(mode=ro) 는 쓰지 않는다: 경로에 '#' 가 있거나 네트워크 공유(UNC) 경로이면 열리지 않는다. query_only 로 쓰기만 막는다.
    conn = sqlite3.connect(str(path), timeout=10)
    conn.execute('PRAGMA query_only = ON')
    conn.row_factory = sqlite3.Row
    return conn


def _like(text: str) -> str:
    r"""부분일치 패턴. 사용자가 입력한 % _ \ 는 와일드카드가 아니라 글자 그대로 찾도록 이스케이프한다 (SQL 의 ESCAPE '\' 와 함께 사용)."""
    escaped = text.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
    return f'%{escaped}%'


def search_orders(query: str, limit: int = 30) -> List[Dict[str, Any]]:
    """계약번호/선박/업체 부분일치로 주문 목록(계약번호 단위) 검색."""
    q = (query or '').strip()
    if not q:
        return []
    conn = _open_readonly()
    if conn is None:
        return []
    like = _like(q)
    try:
        rows = conn.execute(
            "SELECT contract_number, MAX(company) AS company, MAX(ship_name) AS ship_name, "
            "       MAX(engine_model) AS engine_model, MIN(date) AS start_date, MAX(date) AS end_date "
            "FROM work_records "
            "WHERE contract_number != '' AND (contract_number LIKE ? ESCAPE '\\' OR ship_name LIKE ? ESCAPE '\\' OR company LIKE ? ESCAPE '\\') "
            "GROUP BY contract_number ORDER BY MAX(date) DESC LIMIT ?",
            (like, like, like, limit),
        ).fetchall()
    finally:
        conn.close()
    return [_order_row(r) for r in rows]


def list_projects(start: str, end: str, query: str = '', limit: int = MAX_PROJECTS) -> List[Dict[str, Any]]:
    """기간(start~end, 포함) 안에 작업기록이 하루라도 있는 주문을 계약번호 단위로. 최근 작업일이 늦은 순.

    firstDate/lastDate 는 그 주문의 전체 작업 기간, daysInRange 는 조회 기간 안의 작업일 수.
    계약번호가 빈 작업기록은 제외한다. 날짜가 잘못되었으면 ValueError.
    """
    if not (_ISO_DATE.match(start or '') and _ISO_DATE.match(end or '')):
        raise ValueError('기간은 YYYY-MM-DD 형식이어야 합니다.')
    if start > end:
        raise ValueError('시작일이 종료일보다 늦습니다.')
    conn = _open_readonly()
    if conn is None:
        return []
    like = _like((query or '').strip())
    try:
        rows = conn.execute(
            "WITH in_range AS ("
            "  SELECT contract_number, COUNT(DISTINCT date) AS days FROM work_records "
            "  WHERE contract_number != '' AND date BETWEEN ? AND ? "
            "    AND (contract_number LIKE ? ESCAPE '\\' OR ship_name LIKE ? ESCAPE '\\' OR company LIKE ? ESCAPE '\\') GROUP BY contract_number) "
            "SELECT w.contract_number, MAX(w.company) AS company, MAX(w.ship_name) AS ship_name, "
            "       MAX(w.engine_model) AS engine_model, MIN(w.date) AS start_date, MAX(w.date) AS end_date, r.days AS days "
            "FROM work_records w JOIN in_range r ON r.contract_number = w.contract_number "
            "GROUP BY w.contract_number ORDER BY MAX(w.date) DESC, w.contract_number LIMIT ?",
            (start, end, like, like, like, max(1, min(int(limit), MAX_PROJECTS))),
        ).fetchall()
    finally:
        conn.close()
    return [{**_order_row(r), 'firstDate': r['start_date'] or '', 'lastDate': r['end_date'] or '', 'daysInRange': r['days']} for r in rows]


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
