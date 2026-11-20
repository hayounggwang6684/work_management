"""세관서류 Eel API. 올리기/삭제는 쓰기 권한, 보기/다운로드는 로그인 사용자. 삭제는 올린 사람 또는 관리자만.

작성자는 항상 adapters.get_current_user() 에서 가져온다 (JS 인자 신뢰 금지). 모든 함수는 dict 반환.
"""
import base64
import logging
from pathlib import Path
from typing import Any, Dict

import eel

from PDM.backend import adapters, runtime
from PDM.backend.customs import CustomsError, CustomsStore, EXPIRY_KIND, KINDS, decode_base64, validate_pdf
from PDM.backend.customs_pdf import read_boarding_info
from PDM.backend.guard import guarded

logger = logging.getLogger(__name__)
_store: CustomsStore = None
_store_key: Path = None


def get_store() -> CustomsStore:
    """저장 폴더는 pdm.db 와 같은 폴더의 customs\\ . DB 경로가 바뀌면(테스트/설정 변경) 새로 만든다."""
    global _store, _store_key
    db = runtime.get_db()
    if _store is None or _store.db is not db or _store_key != db.path:
        _store = CustomsStore(db, db.path.parent / 'customs')
        _store_key = db.path
    return _store


def _user_name() -> str:
    return adapters.get_current_user().get('full_name', '')


def _can_delete(row: Dict[str, Any]) -> bool:
    return adapters.can_manage_templates() or (bool(_user_name()) and row['uploadedBy'] == _user_name())


@eel.expose
@guarded('login')
def pdm_customs_kinds() -> Dict[str, Any]:
    return {'success': True, 'kinds': [{'key': k, 'label': v} for k, v in KINDS.items()]}


@eel.expose
@guarded('login')
def pdm_customs_list(contract_number: str) -> Dict[str, Any]:
    try:
        files = get_store().list_for(contract_number)
        return {'success': True, 'files': [{**f, 'canDelete': _can_delete(f)} for f in files]}
    except Exception:
        logger.exception('pdm_customs_list')
        return runtime.fail('세관서류 목록을 불러오지 못했습니다.')


@eel.expose
@guarded('write')
def pdm_customs_inspect(kind: str, data: str) -> Dict[str, Any]:
    """올리기 전에 PDF 를 검사하고, 승선신고서면 만료일 등을 읽어 돌려준다 (화면이 날짜 칸을 미리 채우는 용도). 저장은 하지 않는다."""
    try:
        pdf = decode_base64(data)
        validate_pdf(pdf)
        info = read_boarding_info(pdf) if kind == EXPIRY_KIND else {}
        return {'success': True, 'info': info}
    except CustomsError as e:
        return runtime.fail(str(e))
    except Exception:
        logger.exception('pdm_customs_inspect')
        return runtime.fail('PDF 를 검사하지 못했습니다.')


@eel.expose
@guarded('write')
def pdm_customs_upload(contract_number: str, kind: str, file_name: str, data: str, expiry: str = '', note: str = '', lang: str = '') -> Dict[str, Any]:
    try:
        if not adapters.get_order_info(contract_number):          # 공사(작업현황에 있는 계약번호)에만 올릴 수 있다
            return runtime.fail('작업현황에 없는 계약번호입니다.')
        pdf = decode_base64(data)
        if kind == EXPIRY_KIND and not (expiry or '').strip():       # 만료일을 안 보냈으면 PDF 에서 읽어 채운다 (못 읽으면 빈 값)
            expiry = read_boarding_info(pdf).get('expiryDate', '')
        file_id = get_store().add(contract_number, kind, file_name, pdf, _user_name(), expiry, note, lang)
        logger.info('세관서류 업로드: %s %s id=%s by %s', contract_number, kind, file_id, _user_name())
        return {'success': True, 'file': get_store().get(file_id)}
    except CustomsError as e:
        return runtime.fail(str(e))
    except Exception:
        logger.exception('pdm_customs_upload')
        return runtime.fail('세관서류를 저장하지 못했습니다.')


@eel.expose
@guarded('login')
def pdm_customs_get_file(file_id: int) -> Dict[str, Any]:
    try:
        found = get_store().read(int(file_id))
        if found is None:
            return runtime.fail('파일을 찾을 수 없습니다.')
        row, data = found
        return {'success': True, 'fileName': row['fileName'], 'data': base64.b64encode(data).decode('ascii')}
    except CustomsError as e:
        return runtime.fail(str(e))
    except Exception:
        logger.exception('pdm_customs_get_file')
        return runtime.fail('파일을 불러오지 못했습니다.')


@eel.expose
@guarded('write')
def pdm_customs_delete(file_id: int) -> Dict[str, Any]:
    try:
        row = get_store().get(int(file_id))
        if row is None:
            return runtime.fail('파일을 찾을 수 없습니다.')
        if not _can_delete(row):
            return runtime.fail('올린 사람과 관리자만 삭제할 수 있습니다.')
        get_store().delete(row['id'])
        logger.info('세관서류 삭제: id=%s by %s', row['id'], _user_name())
        return {'success': True}
    except Exception:
        logger.exception('pdm_customs_delete')
        return runtime.fail('파일을 삭제하지 못했습니다.')
