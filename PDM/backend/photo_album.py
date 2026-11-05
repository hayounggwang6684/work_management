"""부품사진첩(엔진 작업 사진첩) 헤더 — 서비스레포트의 사진 페이지만 + 선택적 표지.

공사와 연계된 문서는 표지가 필요 없고(withCover=False), 판매용 독립 주문은 표지가 함께 나온다(withCover=True).
표지의 INDEX 는 사진 페이지 제목과 장 수로 화면에서 자동으로 만든다 (여기에는 저장하지 않는다).
"""
from datetime import date
from typing import Any, Dict

from PDM.backend.header_utils import MAX_TEXT_LEN, expand_engine, page_titles, photos_per_page, text

MAX_ENGINE_LEN = 200            # 표지 엔진 칸은 2줄(줄바꿈 허용)
MAX_INDEX_LINES = 6             # 표지 INDEX 칸에 들어가는 줄 수
MAX_INDEX_LEN = 100


def build_header(info: Dict[str, Any], today: date, with_cover: bool) -> Dict[str, Any]:
    return {
        'orderNo': info.get('contractNumber', ''),
        'customer': info.get('company', ''),
        'vesselName': info.get('shipName', ''),
        'model': expand_engine(info.get('engineModel', '')),          # 서비스레포트와 같이 제조사 약어를 풀네임으로
        'location': info.get('location', ''),
        'workDate': today.strftime('%Y.%m.%d'),
        'withCover': with_cover,
        'pageTitles': {},
        'photosPerPage': 6,
        'indexLines': [],             # 표지 INDEX 를 직접 쓴 줄들. 비어 있으면 챕터 제목으로 자동 생성
    }


def normalize_header(header: Dict[str, Any]) -> Dict[str, Any]:
    """저장 전 검증/정리: 알려진 필드만, 길이 제한."""
    out: Dict[str, Any] = {key: text(header.get(key), MAX_TEXT_LEN) for key in ('orderNo', 'customer', 'vesselName', 'location', 'workDate')}
    out['model'] = text(header.get('model'), MAX_ENGINE_LEN)
    out['withCover'] = header.get('withCover') is True
    out['pageTitles'] = page_titles(header.get('pageTitles'))
    out['photosPerPage'] = photos_per_page(header.get('photosPerPage'))
    raw = header.get('indexLines') if isinstance(header.get('indexLines'), list) else []
    out['indexLines'] = [text(line, MAX_INDEX_LEN) for line in raw if text(line, MAX_INDEX_LEN)][:MAX_INDEX_LINES]
    return out
