"""PDM 계측 표준값 Eel API — 엔진별 표준값 목록/수정/가져오기, 계측지에 표준값 적용. 모두 dict 반환.

읽기/적용은 guest 등급(계측지 작성자 모두), 목록 수정·가져오기·삭제는 admin 등급 (모든 사용자의 계측지에 영향).
"""
import logging
from typing import Any, Dict, Optional

import eel

from PDM.backend.guard import guarded
from PDM.backend import adapters, measurement, standards
from PDM.backend.runtime import fail, get_standards

logger = logging.getLogger(__name__)
MAX_IMPORT_CHARS = 400_000


def _user_name() -> str:
    return adapters.get_current_user().get('full_name', '')


def standard_patch(form_id: str, engine: str) -> Optional[Dict[str, Any]]:
    """엔진명으로 표준값을 찾아 계측지 한 장에 넣을 값. 못 찾거나 후보가 여럿이면 None (candidates 개수만 알림)."""
    if not (engine or '').strip():
        return None
    found = get_standards().match(engine)
    if not found['standard']:
        return {'matched': None, 'candidates': [f"{c['maker']} {c['model']}".strip() for c in found['candidates']], 'patch': None}
    row = found['standard']
    return {'matched': f"{row['maker']} {row['model']}".strip(), 'candidates': [], 'patch': standards.fill_patch(form_id, row['data'])}


@eel.expose
@guarded('guest')
def pdm_apply_standard(form_id: str, engine: str) -> Dict[str, Any]:
    """계측지 한 장에 넣을 표준값 patch. 화면이 spec/unitBase/콘로드 값만 골라 덮어쓴다 (측정값은 그대로)."""
    try:
        measurement.default_instance(form_id)           # 존재하는 양식인지 확인
        result = standard_patch(form_id, engine)
        if result is None:
            return fail('엔진 정보가 없습니다. 계측지 공통 정보의 MAKER/TYPE(엔진)을 입력하세요.')
        return {'success': True, **result}
    except ValueError as e:
        return fail(str(e))
    except Exception:
        logger.exception('pdm_apply_standard')
        return fail('표준값 적용 중 오류가 발생했습니다.')


@eel.expose
@guarded('guest')
def pdm_list_standards() -> Dict[str, Any]:
    try:
        return {'success': True, 'rows': get_standards().list(),
                'fields': [{'key': k, 'label': label, 'group': group} for k, label, group in standards.FIELDS if k not in ('maker', 'model')]}
    except Exception:
        logger.exception('pdm_list_standards')
        return fail('표준값 목록 조회 중 오류가 발생했습니다.')


@eel.expose
@guarded('admin')
def pdm_save_standard(row: Dict[str, Any], row_id: Optional[int] = None) -> Dict[str, Any]:
    try:
        return {'success': True, 'row': get_standards().save(row, _user_name(), row_id)}
    except ValueError as e:
        return fail(str(e))
    except Exception:
        logger.exception('pdm_save_standard')
        return fail('표준값 저장 중 오류가 발생했습니다.')


@eel.expose
@guarded('admin')
def pdm_delete_standard(row_id: int) -> Dict[str, Any]:
    try:
        get_standards().delete(int(row_id))
        return {'success': True}
    except Exception:
        logger.exception('pdm_delete_standard')
        return fail('표준값 삭제 중 오류가 발생했습니다.')


@eel.expose
@guarded('admin')
def pdm_import_standards(text: str) -> Dict[str, Any]:
    """엑셀에서 복사한 표준 시트(열 순서 동일)를 반영 — 같은 제조사+모델은 갱신, 없으면 추가."""
    try:
        if len(text or '') > MAX_IMPORT_CHARS:
            return fail('붙여넣은 내용이 너무 큽니다.')
        rows = standards.parse_rows(text or '')
        if not rows:
            return fail('가져올 행이 없습니다. 엑셀의 표준 시트를 (엔진모델 열부터) 복사해 붙여넣으세요.')
        return {'success': True, **get_standards().import_rows(rows, _user_name())}
    except ValueError as e:
        return fail(str(e))
    except Exception:
        logger.exception('pdm_import_standards')
        return fail('표준값 가져오기 중 오류가 발생했습니다.')
