"""다른 주문의 같은 종류 문서에서 내용을 불러온다 (불러오기).

주문 정보(선박·엔진·주문번호·고객사·장소·기간·작성일·작성자 등)는 불러오지 않고 현재 문서의 것을 그대로 둔다.
내용(작업 요약, 비고, 제목, 사진과 설명, 계측값 …)만 가져온다. 사진도 함께 복사한다.
"""
import copy
from typing import Any, Callable, Dict, Optional

from PDM.backend import measurement, photo_album
from PDM.backend.pdm_db import PdmDb
from PDM.backend.photo_store import PhotoStore
from PDM.backend.service_report import normalize_header as normalize_service_report_header

# 불러오는 헤더 항목 (나머지는 모두 주문 정보라 현재 문서 값을 유지한다)
CONTENT_KEYS = {
    'service_report': ('subject', 'summary', 'remark', 'pageTitles', 'photosPerPage'),
    'photo_album': ('pageTitles', 'photosPerPage', 'indexLines'),
    'measurement': ('forms',),
}
NORMALIZERS: Dict[str, Callable[[Dict[str, Any]], Dict[str, Any]]] = {
    'service_report': normalize_service_report_header,
    'photo_album': photo_album.normalize_header,
    'measurement': measurement.normalize_header,
}
HAS_PHOTOS = ('service_report', 'photo_album')


class ImportError_(ValueError):
    """사용자에게 그대로 보여 줄 수 있는 불러오기 오류."""


def merge_header(doc_type: str, target_header: Dict[str, Any], source_header: Dict[str, Any]) -> Dict[str, Any]:
    """현재 문서 헤더에 원본의 내용 항목만 덮어쓴 새 헤더 (원본/현재 헤더는 바꾸지 않는다)."""
    merged = dict(target_header)
    for key in CONTENT_KEYS[doc_type]:
        if key in source_header:
            merged[key] = copy.deepcopy(source_header[key])
    return merged


def import_document(db: PdmDb, photos: PhotoStore, target_id: int, expected_updated_at: str, source_id: int,
                    user: str, viewer: str) -> Dict[str, Any]:
    """source 의 내용(+사진)을 target 에 덮어쓴다. 새 updated_at 을 포함한 target 문서를 돌려준다. 충돌이면 pdm_db.ConflictError."""
    if target_id == source_id:
        raise ImportError_('같은 문서에서는 불러올 수 없습니다.')
    target = db.get_document(target_id, viewer)
    source = db.get_document(source_id, viewer)
    if target is None or source is None:
        raise ImportError_('문서를 찾을 수 없습니다.')
    if target['docType'] != source['docType'] or target['docType'] not in CONTENT_KEYS:
        raise ImportError_('같은 종류의 문서에서만 불러올 수 있습니다.')
    doc_type = target['docType']
    header = NORMALIZERS[doc_type](merge_header(doc_type, target['header'], source['header']))
    db.update_document(target_id, expected_updated_at, target['title'], header, user, publish=False)      # 충돌이면 ConflictError, 사진은 건드리기 전
    copied = photos.replace_with_copy(source_id, target_id) if doc_type in HAS_PHOTOS else 0
    if copied:
        db.touch_document(target_id, user)
    result = db.get_document(target_id, viewer)
    result['copiedPhotos'] = copied
    return result
