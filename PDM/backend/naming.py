"""문서 파일 이름 규칙 (순수 함수). 이름은 우클릭 메뉴 목록과 PDF 저장 이름으로 쓰인다."""
import re
from typing import Any, Dict, Iterable

TYPE_LABEL = {'service_report': '서비스레포트', 'measurement': '계측지'}
_FORBIDDEN = re.compile(r'[\\/:*?"<>|]')
_FALLBACK = '문서'


def sanitize_filename(name: str) -> str:
    """Windows 파일명 금지 문자 제거, 앞뒤 공백/마침표 제거. 비면 '문서'."""
    cleaned = _FORBIDDEN.sub('', name or '').strip().strip('.').strip()
    return cleaned or _FALLBACK


def default_title(doc_type: str, info: Dict[str, Any], existing: Iterable[str]) -> str:
    """'계약번호_선박명_종류'. 이미 있으면 ' (2)', ' (3)' ... 을 붙인다."""
    base = sanitize_filename(
        f"{info.get('contractNumber', '')}_{info.get('shipName', '')}_{TYPE_LABEL.get(doc_type, doc_type)}")
    taken = set(existing)
    if base not in taken:
        return base
    n = 2
    while f'{base} ({n})' in taken:
        n += 1
    return f'{base} ({n})'
