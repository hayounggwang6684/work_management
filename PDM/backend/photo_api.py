"""PDM 사진 Eel API (dict 반환). 변경 계열은 문서 최종 수정 정보를 갱신하고 updatedAt 을 돌려준다."""
import base64
import logging
import sqlite3
from typing import Any, Dict, List

import eel

from PDM.backend import adapters
from PDM.backend.photo_service import PhotoError, decode_b64, process_image
from PDM.backend.photo_store import SlotOccupied
from PDM.backend.runtime import fail, get_db, get_photos

logger = logging.getLogger(__name__)


def _data_uri(blob: bytes) -> str:
    return 'data:image/jpeg;base64,' + base64.b64encode(blob).decode('ascii')


def _touch(doc_id: int) -> str:
    return get_db().touch_document(doc_id, adapters.get_current_user().get('full_name', ''))


@eel.expose
def pdm_list_photos(doc_id: int, known_ids: List[int] = None) -> Dict[str, Any]:
    """사진 목록. 썸네일은 클라이언트가 이미 가진 id(known_ids)는 생략해 전송량을 줄인다."""
    try:
        store = get_photos()
        photos = store.list_photos(doc_id)
        known = set(known_ids or [])
        thumbs = store.get_thumbs([p['id'] for p in photos if p['id'] not in known])
        return {'success': True,
                'photos': [{**p, **({'thumb': _data_uri(thumbs[p['id']])} if p['id'] in thumbs else {})}
                           for p in photos]}
    except Exception as e:
        logger.exception('pdm_list_photos')
        return fail(f'사진 목록 오류: {e}')


@eel.expose
def pdm_add_photo(doc_id: int, slot_index: int, data: str) -> Dict[str, Any]:
    """slot_index 칸에 사진 입력 (base64/data URI). 이미 사진이 있는 칸은 거부."""
    try:
        img = process_image(decode_b64(data))
        photo_id = get_photos().add_photo(doc_id, slot_index, img)
        return {'success': True, 'updatedAt': _touch(doc_id),
                'photo': {'id': photo_id, 'slotIndex': slot_index, 'caption': '', 'width': img.width,
                          'height': img.height, 'edited': False, 'thumb': _data_uri(img.thumb)}}
    except SlotOccupied:
        return fail('이미 사진이 있는 칸입니다.')
    except (PhotoError, ValueError) as e:
        return fail(str(e))
    except (sqlite3.IntegrityError, KeyError):
        return fail('문서를 찾을 수 없습니다.')
    except Exception as e:
        logger.exception('pdm_add_photo')
        return fail(f'사진 입력 오류: {e}')


@eel.expose
def pdm_get_photo(photo_id: int) -> Dict[str, Any]:
    """저장된 전체 크기 이미지 (편집/출력용)."""
    try:
        return {'success': True, 'image': _data_uri(get_photos().get_image(photo_id))}
    except KeyError:
        return fail('사진을 찾을 수 없습니다.')
    except Exception as e:
        logger.exception('pdm_get_photo')
        return fail(f'사진 조회 오류: {e}')


@eel.expose
def pdm_set_photo_caption(doc_id: int, photo_id: int, caption: str) -> Dict[str, Any]:
    try:
        if not get_photos().set_caption(doc_id, photo_id, (caption or '')[:200]):
            return fail('사진을 찾을 수 없습니다.')
        return {'success': True, 'updatedAt': _touch(doc_id)}
    except Exception as e:
        logger.exception('pdm_set_photo_caption')
        return fail(f'캡션 저장 오류: {e}')


@eel.expose
def pdm_remove_photo(doc_id: int, slot_index: int, pull: bool) -> Dict[str, Any]:
    """사진 제거. pull=True: 뒤 사진을 당김 / False: 빈칸 유지."""
    try:
        if not get_photos().remove(doc_id, slot_index, bool(pull)):
            return fail('해당 칸에 사진이 없습니다.')
        return {'success': True, 'updatedAt': _touch(doc_id)}
    except Exception as e:
        logger.exception('pdm_remove_photo')
        return fail(f'사진 제거 오류: {e}')


@eel.expose
def pdm_insert_blank_slot(doc_id: int, slot_index: int) -> Dict[str, Any]:
    """새 항목: slot_index 에 빈칸을 끼우고 뒤 사진을 한 칸씩 민다."""
    try:
        get_photos().insert_blank(doc_id, slot_index)
        return {'success': True, 'updatedAt': _touch(doc_id)}
    except ValueError as e:
        return fail(str(e))
    except Exception as e:
        logger.exception('pdm_insert_blank_slot')
        return fail(f'새 항목 오류: {e}')
