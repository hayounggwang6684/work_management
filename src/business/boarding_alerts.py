"""승선신고서 만료 임박 알림 — 만료 WARN_DAYS 일 전부터, 준공 처리될 때까지 (만료일이 지나도 계속)."""
from datetime import date, datetime
from typing import Any, Dict, List, Tuple

WARN_DAYS = 3
DONE_STATUS = '준공'


def build_alerts(expiries: List[Tuple[str, str]], info: Dict[str, Dict[str, str]], today: date,
                 warn_days: int = WARN_DAYS) -> List[Dict[str, Any]]:
    """expiries: [(계약번호, 가장 늦은 승선 만료일 YYYY-MM-DD)], info[계약번호.upper()]: {'status', 'shipName', 'company'}.

    만료일이 today + warn_days 이내(이미 지난 것 포함)이고 준공이 아닌 공사만. 만료일이 이른 순. daysLeft 는 음수면 지난 일수.
    """
    alerts = []
    for contract, expiry in expiries:
        try:
            expiry_date = datetime.strptime(expiry, '%Y-%m-%d').date()
        except ValueError:
            continue
        days_left = (expiry_date - today).days
        detail = info.get(contract.upper(), {})
        if days_left > warn_days or detail.get('status', '') == DONE_STATUS:
            continue
        alerts.append({'contractNumber': contract, 'shipName': detail.get('shipName', ''), 'company': detail.get('company', ''),
                       'expiryDate': expiry, 'daysLeft': days_left})
    return sorted(alerts, key=lambda a: (a['expiryDate'], a['contractNumber']))
