"""승선신고서 만료 임박 알림 API — 로그인 후 팝업이 호출한다 (쓰기 권한자에게만 보인다).

만료일은 PDM 의 세관서류(pdm.db), 준공 여부는 본체 작업현황 DB 에 있어서 둘을 여기서 합친다.
"""
from datetime import date, timedelta
from typing import Any, Dict

import eel

from ..business.boarding_alerts import WARN_DAYS, build_alerts
from ..business.project_status import AUTO_CLOSE_DAYS, resolve_status
from ..database.db_manager import db
from ..utils.logger import logger
from .permissions import require


def _contract_info(contracts: set, today: date) -> Dict[str, Dict[str, str]]:
    """계약번호(대문자) → {'status', 'shipName', 'company'}. 대시보드 보드와 같은 규칙(resolve_status)으로 준공 여부를 판정한다."""
    cutoff = (today - timedelta(days=AUTO_CLOSE_DAYS)).strftime('%Y-%m-%d')
    manual = {k.upper(): v for k, v in db.get_project_statuses().items()}
    board = {}
    for status in ('착수', '준공'):
        for bp in db.get_board_projects(status):
            if bp.get('contract_number'):
                board[bp['contract_number'].upper()] = status
    info = {}
    for contract in contracts:
        rows = db.execute_query(
            "SELECT MAX(date), MAX(company), MAX(ship_name) FROM work_records WHERE contract_number = ? COLLATE NOCASE", (contract,))
        end_date, company, ship = (rows[0] if rows else (None, None, None))
        key = contract.upper()
        info[key] = {'status': resolve_status(manual.get(key, ''), board.get(key, ''), end_date or '', cutoff),
                     'shipName': ship or '', 'company': company or ''}
    return info


@eel.expose
@require('write')
def get_boarding_expiry_alerts() -> Dict[str, Any]:
    """만료 3일 전~(지난 것 포함), 준공 전인 공사의 승선신고서 목록."""
    try:
        from PDM.backend.customs_api import get_store
        today = date.today()
        expiries = get_store().boarding_expiries((today + timedelta(days=WARN_DAYS)).strftime('%Y-%m-%d'))
        info = _contract_info({c for c, _ in expiries}, today) if expiries else {}
        return {'success': True, 'today': today.strftime('%Y-%m-%d'), 'alerts': build_alerts(expiries, info, today)}
    except Exception as e:
        logger.error(f"승선신고서 만료 알림 조회 실패: {e}", exc_info=True)
        return {'success': False, 'message': '승선신고서 만료 알림을 불러오지 못했습니다.', 'alerts': []}
