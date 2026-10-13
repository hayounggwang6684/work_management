"""PDM 사진 Eel API (dict 반환). 변경 계열은 문서 최종 수정 정보를 갱신하고 updatedAt 을 돌려준다."""
import base64
import functools
import logging
import sqlite3
from typing import Any, Callable, Dict, List

import eel

from PDM.backend.guard import guarded
from PDM.backend import adapters
from PDM.backend.photo_service import PhotoError, decode_b64, process_image, resize_jpeg
from PDM.backend.photo_store import SlotOccupied
from PDM.backend.runtime import fail, get_db, get_photos

logger = logging.getLogger(__name__)


def _viewer() -> str:
    return adapters.get_current_user().get('full_name', '')


def _visible_doc(func: Callable) -> Callable:
    """첫 인자 doc_id 의 문서가 현재 사용자에게 보이는 경우에만 실행 (남의 임시 문서의 사진은 다루지 못한다)."""
    @functools.wraps(func)
    def wrapper(doc_id: int, *args: Any, **kwargs: Any) -> Any:
        if get_db().get_document(doc_id, _viewer()) is None:
            return fail('문서를 찾을 수 없습니다.')
        return func(doc_id, *args, **kwargs)
    return wrapper


def _data_uri(blob: bytes) -> str:
    return 'data:image/jpeg;base64,' + base64.b64encode(blob).decode('ascii')


def _touch(doc_id: int) -> str:
    return get_db().touch_document(doc_id, adapters.get_current_user().get('full_name', ''))


@eel.expose
@guarded('guest')
@_visible_doc
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
        return fail('사진 목록 중 오류가 발생했습니다.')


@eel.expose
@guarded('write')
@_visible_doc
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
        return fail('사진 입력 중 오류가 발생했습니다.')


@eel.expose
@guarded('guest')
def pdm_get_photo(photo_id: int, max_edge: int = 0) -> Dict[str, Any]:
    """저장된 이미지 (편집용: 전체 크기 / 인쇄용: max_edge 로 긴 변 제한)."""
    try:
        owner = get_db().document_of_photo(photo_id)
        if owner is None or get_db().get_document(owner, _viewer()) is None:
            return fail('사진을 찾을 수 없습니다.')
        return {'success': True, 'image': _data_uri(resize_jpeg(get_photos().get_image(photo_id), int(max_edge or 0)))}
    except KeyError:
        return fail('사진을 찾을 수 없습니다.')
    except Exception as e:
        logger.exception('pdm_get_photo')
        return fail('사진 조회 중 오류가 발생했습니다.')


@eel.expose
@guarded('write')
@_visible_doc
def pdm_update_photo(doc_id: int, photo_id: int, data: str) -> Dict[str, Any]:
    """편집(크기 조정/그리기)한 이미지로 교체. 최초 편집 시 원본을 보존한다."""
    try:
        img = process_image(decode_b64(data))
        if not get_photos().replace_image(doc_id, photo_id, img):
            return fail('사진을 찾을 수 없습니다.')
        return {'success': True, 'updatedAt': _touch(doc_id)}
    except PhotoError as e:
        return fail(str(e))
    except Exception as e:
        logger.exception('pdm_update_photo')
        return fail('사진 저장 중 오류가 발생했습니다.')


@eel.expose
@guarded('write')
@_visible_doc
def pdm_restore_photo_original(doc_id: int, photo_id: int) -> Dict[str, Any]:
    """편집 전 원본으로 되돌리기."""
    try:
        store = get_photos()
        original = store.get_original(doc_id, photo_id)
        if original is None:
            return fail('편집 이력이 없습니다.')
        img = process_image(original)
        if not store.restore_original(doc_id, photo_id, img.thumb, img.width, img.height):
            return fail('편집 이력이 없습니다.')
        return {'success': True, 'updatedAt': _touch(doc_id)}
    except Exception as e:
        logger.exception('pdm_restore_photo_original')
        return fail('원본 복원 중 오류가 발생했습니다.')


@eel.expose
@guarded('write')
@_visible_doc
def pdm_set_photo_caption(doc_id: int, photo_id: int, caption: str) -> Dict[str, Any]:
    try:
        if not get_photos().set_caption(doc_id, photo_id, (caption or '')[:200]):
            return fail('사진을 찾을 수 없습니다.')
        return {'success': True, 'updatedAt': _touch(doc_id)}
    except Exception as e:
        logger.exception('pdm_set_photo_caption')
        return fail('캡션 저장 중 오류가 발생했습니다.')


@eel.expose
@guarded('write')
@_visible_doc
def pdm_remove_photo(doc_id: int, slot_index: int, pull: bool, end_slot: int = None) -> Dict[str, Any]:
    """사진 제거. pull=True: 뒤 사진(end_slot 앞까지 = 같은 소제목 구간)을 당김 / False: 빈칸 유지."""
    try:
        if not get_photos().remove(doc_id, slot_index, bool(pull), end_slot):
            return fail('해당 칸에 사진이 없습니다.')
        return {'success': True, 'updatedAt': _touch(doc_id)}
    except Exception as e:
        logger.exception('pdm_remove_photo')
        return fail('사진 제거 중 오류가 발생했습니다.')


@eel.expose
@guarded('write')
@_visible_doc
def pdm_insert_blank_slot(doc_id: int, slot_index: int, end_slot: int = None) -> Dict[str, Any]:
    """새 항목: slot_index 에 빈칸을 끼우고 뒤 사진(end_slot 앞까지 = 같은 소제목 구간)을 한 칸씩 민다."""
    try:
        get_photos().insert_blank(doc_id, slot_index, end_slot)
        return {'success': True, 'updatedAt': _touch(doc_id)}
    except ValueError as e:
        return fail(str(e))
    except Exception as e:
        logger.exception('pdm_insert_blank_slot')
        return fail('새 항목 중 오류가 발생했습니다.')


@eel.expose
@guarded('write')
@_visible_doc
def pdm_insert_photo_page(doc_id: int, before_page: int, per_page: int) -> Dict[str, Any]:
    """before_page 앞에 빈 페이지를 끼운다 (뒤 사진과 저장된 페이지 제목이 한 페이지씩 밀림) — 앞 소제목 구간이 한 페이지 늘어날 때."""
    try:
        titles = get_photos().insert_page(doc_id, int(before_page), int(per_page))
        return {'success': True, 'pageTitles': titles, 'updatedAt': _touch(doc_id)}
    except ValueError as e:
        return fail(str(e))
    except Exception:
        logger.exception('pdm_insert_photo_page')
        return fail('페이지 추가 중 오류가 발생했습니다.')
