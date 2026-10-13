"""부품사진첩(엔진 작업 사진첩) 헤더 — 서비스레포트의 사진 페이지만 + 선택적 표지.

공사와 연계된 문서는 표지가 필요 없고(withCover=False), 판매용 독립 주문은 표지가 함께 나온다(withCover=True).
표지의 INDEX 는 사진 페이지 제목과 장 수로 화면에서 자동으로 만든다 (여기에는 저장하지 않는다).
"""
from datetime import date
from typing import Any, Dict

from PDM.backend.service_report import MAX_TEXT_LEN, _page_titles, _photos_per_page, _text

MAX_ENGINE_LEN = 200            # 표지 엔진 칸은 2줄(줄바꿈 허용)


def build_header(info: Dict[str, Any], today: date, with_cover: bool) -> Dict[str, Any]:
    return {
        'orderNo': info.get('contractNumber', ''),
        'customer': info.get('company', ''),
        'vesselName': info.get('shipName', ''),
        'model': info.get('engineModel', ''),
        'location': info.get('location', ''),
        'workDate': today.strftime('%Y.%m.%d'),
        'withCover': with_cover,
        'pageTitles': {},
        'photosPerPage': 6,
    }


def normalize_header(header: Dict[str, Any]) -> Dict[str, Any]:
    """저장 전 검증/정리: 알려진 필드만, 길이 제한."""
    out: Dict[str, Any] = {key: _text(header.get(key), MAX_TEXT_LEN) for key in ('orderNo', 'customer', 'vesselName', 'location', 'workDate')}
    out['model'] = _text(header.get('model'), MAX_ENGINE_LEN)
    out['withCover'] = header.get('withCover') is True
    out['pageTitles'] = _page_titles(header.get('pageTitles'))
    out['photosPerPage'] = _photos_per_page(header.get('photosPerPage'))
    return out
