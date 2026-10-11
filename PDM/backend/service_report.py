"""서비스레포트 헤더 구성 (순수 함수 — 작업현황 정보 + 작성자 → 헤더 dict)."""
from datetime import date
from typing import Any, Dict, List


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


# ── 저장 전 정규화 (서버 검증) ───────────────────────────────────────────────
TEXT_KEYS = ('vesselName', 'imoNo', 'engineType', 'serialNo', 'model', 'date', 'orderNo', 'reportedBy',
             'customer', 'requestedBy', 'location', 'period', 'subject')
MAX_TEXT_LEN = 100
MAX_SUMMARY_LINES = 60
MAX_SUMMARY_LINE_LEN = 200
MAX_REMARK_LEN = 2000
MAX_PAGE_TITLES = 100            # 사진 페이지 번호 0 ~ 99
PHOTOS_PER_PAGE_CHOICES = (6, 4)  # 6장 = 세로 2x3, 4장 = 가로 2x2


def _text(value: Any, limit: int) -> str:
    return ('' if value is None else str(value)).strip()[:limit]


def _summary(raw: Any) -> List[str]:
    """줄 목록만 허용(문자열 하나를 글자 단위로 쪼개지 않음). 앞 공백(하위 항목 들여쓰기)은 유지, 빈 줄은 제외."""
    if not isinstance(raw, list):
        return []
    lines = [('' if v is None else str(v)).rstrip()[:MAX_SUMMARY_LINE_LEN] for v in raw]
    return [line for line in lines if line.strip()][:MAX_SUMMARY_LINES]


def _page_titles(raw: Any) -> Dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    out = {}
    for key, value in raw.items():
        if str(key).isdigit() and int(key) < MAX_PAGE_TITLES and _text(value, MAX_TEXT_LEN):
            out[str(int(key))] = _text(value, MAX_TEXT_LEN)
    return out


def _photos_per_page(raw: Any) -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return PHOTOS_PER_PAGE_CHOICES[0]
    return value if value in PHOTOS_PER_PAGE_CHOICES else PHOTOS_PER_PAGE_CHOICES[0]


def normalize_header(header: Dict[str, Any]) -> Dict[str, Any]:
    """저장 전 검증/정리: 알려진 필드만 남기고 길이/줄 수를 제한한다 (공유 DB 비대화·오염 방지)."""
    out: Dict[str, Any] = {key: _text(header.get(key), MAX_TEXT_LEN) for key in TEXT_KEYS}
    out['summary'] = _summary(header.get('summary'))
    out['remark'] = _text(header.get('remark'), MAX_REMARK_LEN)
    out['pageTitles'] = _page_titles(header.get('pageTitles'))
    out['photosPerPage'] = _photos_per_page(header.get('photosPerPage'))
    return out
