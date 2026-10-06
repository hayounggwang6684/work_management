"""API 모듈들이 공유하는 지연 초기화 DB 핸들과 실패 응답 헬퍼."""
from typing import Any, Dict

from PDM.backend import adapters, measurement
from PDM.backend.pdm_db import PdmDb
from PDM.backend.photo_store import PhotoStore

_db: PdmDb = None
_photos: PhotoStore = None


def get_db() -> PdmDb:
    global _db
    if _db is None:
        _db = PdmDb(adapters.get_pdm_db_path())
        measurement.set_custom_provider(_db.list_custom_forms)     # 계측 양식 목록에 사용자 정의 양식을 합친다
    return _db


def get_photos() -> PhotoStore:
    global _photos
    if _photos is None:
        _photos = PhotoStore(get_db())
    return _photos


def fail(message: str, **extra: Any) -> Dict[str, Any]:
    return {'success': False, 'message': message, **extra}
