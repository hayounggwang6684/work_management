"""서비스레포트 헤더 구성 (순수 함수 — 작업현황 정보 + 작성자 → 헤더 dict)."""
from datetime import date
from typing import Any, Dict


def _dotted(iso: str) -> str:
    return iso.replace('-', '.')


def format_period(start: str, end: str) -> str:
    """'2026.05.20 ~ 06.23' 형식. 같은 해면 종료일의 연도 생략, 하루면 단일 날짜."""
    if not start or not end:
        return _dotted(start or end or '')
    if start == end:
        return _dotted(start)
    if start[:4] == end[:4]:
        return f'{_dotted(start)} ~ {_dotted(end[5:])}'
    return f'{_dotted(start)} ~ {_dotted(end)}'


def build_header(info: Dict[str, Any], reported_by: str, today: date) -> Dict[str, Any]:
    """작업현황에서 읽을 수 있는 항목은 채우고, 없는 항목(IMO/S/N/요청자 등)은 빈 값으로 둔다."""
    return {
        'vesselName': info.get('shipName', ''),
        'imoNo': '',
        'engineType': '',
        'serialNo': '',
        'model': info.get('engineModel', ''),
        'date': today.strftime('%Y.%m.%d'),
        'orderNo': info.get('contractNumber', ''),
        'reportedBy': reported_by,
        'customer': info.get('company', ''),
        'requestedBy': '',
        'location': info.get('location', ''),
        'period': format_period(info.get('startDate', ''), info.get('endDate', '')),
        'subject': '',
        'summary': [],
        'remark': '',
    }
