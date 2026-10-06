"""PDM 설정 Eel API — 출력 양식(로고/회사 정보/직인…)과 계측 양식 관리. 모두 dict 반환.

읽기는 누구나, 쓰기(저장/삭제)는 adapters.can_manage_templates() 가 True 인 사용자만 (전체 사용자에게 영향).
"""
import logging
from typing import Any, Dict, Optional

import eel

from PDM.backend import adapters, form_defs, layout, measurement
from PDM.backend.photo_service import PhotoError
from PDM.backend.runtime import fail, get_db

logger = logging.getLogger(__name__)
DENIED = '이 설정은 관리자만 변경할 수 있습니다.'


def _user_name() -> str:
    return adapters.get_current_user().get('full_name', '')


@eel.expose
def pdm_get_layout() -> Dict[str, Any]:
    try:
        return {'success': True, 'layout': layout.effective(get_db().get_layout())}
    except Exception as e:
        logger.exception('pdm_get_layout')
        return fail(f'출력 양식 조회 오류: {e}')


@eel.expose
def pdm_save_layout(new_layout: Dict[str, Any]) -> Dict[str, Any]:
    if not adapters.can_manage_templates():
        return fail(DENIED)
    try:
        saved = layout.validate(new_layout)
        get_db().save_layout(saved, _user_name())
        return {'success': True, 'layout': layout.effective(saved)}
    except (ValueError, PhotoError) as e:
        return fail(str(e))
    except Exception as e:
        logger.exception('pdm_save_layout')
        return fail(f'출력 양식 저장 오류: {e}')


@eel.expose
def pdm_save_form_def(definition: Dict[str, Any], form_id: Optional[str] = None) -> Dict[str, Any]:
    """사용자 정의 계측 양식 생성(form_id 없음) 또는 수정. 내장 양식은 수정할 수 없다."""
    if not adapters.can_manage_templates():
        return fail(DENIED)
    try:
        db = get_db()
        if form_id is not None and form_id not in {f['id'] for f in db.list_custom_forms()}:
            return fail('수정할 수 있는 사용자 정의 양식이 아닙니다.')
        form = {**form_defs.validate_definition(definition), 'id': form_id or form_defs.new_custom_id()}
        db.save_custom_form(form['id'], form, _user_name())
        return {'success': True, 'form': form}
    except (ValueError, PhotoError) as e:
        return fail(str(e))
    except Exception as e:
        logger.exception('pdm_save_form_def')
        return fail(f'양식 저장 오류: {e}')


@eel.expose
def pdm_preview_form_def(definition: Dict[str, Any]) -> Dict[str, Any]:
    """저장하지 않고 초안을 검증해 {form, instance} 로 돌려준다 (출력 미리보기용)."""
    try:
        form = form_defs.validate_definition(definition)
        return {'success': True, 'form': form, 'instance': measurement.preview_instance(form)}
    except (ValueError, PhotoError) as e:
        return fail(str(e))
    except Exception as e:
        logger.exception('pdm_preview_form_def')
        return fail(f'미리보기 오류: {e}')


@eel.expose
def pdm_delete_form_def(form_id: str) -> Dict[str, Any]:
    """사용자 정의 양식 삭제. 작성된 계측지가 쓰고 있으면 거부한다."""
    if not adapters.can_manage_templates():
        return fail(DENIED)
    try:
        db = get_db()
        if form_id not in {f['id'] for f in db.list_custom_forms()}:
            return fail('삭제할 수 있는 사용자 정의 양식이 아닙니다.')
        used = db.form_usage_count(form_id)
        if used:
            return fail(f'이 양식을 쓰는 계측지가 {used}건 있어 삭제할 수 없습니다. 먼저 해당 문서에서 항목을 제거하세요.')
        db.delete_custom_form(form_id)
        return {'success': True}
    except Exception as e:
        logger.exception('pdm_delete_form_def')
        return fail(f'양식 삭제 오류: {e}')
