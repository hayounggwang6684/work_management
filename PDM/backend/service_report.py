"""서비스레포트 헤더 구성 (순수 함수 — 작업현황 정보 + 작성자 → 헤더 dict)."""
from datetime import date
from typing import Any, Dict, List

from PDM.backend.header_utils import MAX_TEXT_LEN, expand_engine, page_titles, photos_per_page, text  # noqa: F401  (expand_engine: 기존 import 경로 유지)

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
        'model': expand_engine(info.get('engineModel', '')),
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
# 길게 쓰는 항목(작업명/장소/업체/선박 등)은 100자에서 잘리지 않게 한다 — 출력은 칸에 맞춰 글자를 줄여 준다
LONG_TEXT_KEYS = ('vesselName', 'customer', 'requestedBy', 'location', 'period', 'subject')
MAX_LONG_TEXT_LEN = 300
MAX_SUMMARY_LINES = 60
MAX_SUMMARY_LINE_LEN = 200
MAX_REMARK_LEN = 2000


def _summary(raw: Any) -> List[str]:
    """줄 목록만 허용(문자열 하나를 글자 단위로 쪼개지 않음). 앞 공백(하위 항목 들여쓰기)은 유지, 빈 줄은 제외."""
    if not isinstance(raw, list):
        return []
    lines = [('' if v is None else str(v)).rstrip()[:MAX_SUMMARY_LINE_LEN] for v in raw]
    return [line for line in lines if line.strip()][:MAX_SUMMARY_LINES]


def normalize_header(header: Dict[str, Any]) -> Dict[str, Any]:
    """저장 전 검증/정리: 알려진 필드만 남기고 길이/줄 수를 제한한다 (공유 DB 비대화·오염 방지)."""
    out: Dict[str, Any] = {key: text(header.get(key), MAX_LONG_TEXT_LEN if key in LONG_TEXT_KEYS else MAX_TEXT_LEN) for key in TEXT_KEYS}
    out['summary'] = _summary(header.get('summary'))
    out['remark'] = text(header.get('remark'), MAX_REMARK_LEN)
    out['pageTitles'] = page_titles(header.get('pageTitles'))
    out['photosPerPage'] = photos_per_page(header.get('photosPerPage'))
    return out
