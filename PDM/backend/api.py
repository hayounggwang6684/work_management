"""PDM Eel API. 모든 함수는 dict 반환 ({'success': bool, ...}).

작성자(created_by/updated_by)는 항상 adapters.get_current_user() 에서 가져온다 (JS 인자 신뢰 금지).
"""
import logging
from datetime import date
from typing import Any, Dict

import eel

from PDM.backend import adapters
from PDM.backend.naming import default_title
from PDM.backend import measurement, photo_api  # noqa: F401  (photo_api: @eel.expose 사진 API 등록)
from PDM.backend.pdm_db import ConflictError
from PDM.backend.runtime import fail as _fail, get_db
from PDM.backend.service_report import build_header

logger = logging.getLogger(__name__)


@eel.expose
def pdm_ping() -> Dict[str, Any]:
    user = adapters.get_current_user()
    return {'success': True, 'user': user.get('full_name', ''), 'dbPath': str(adapters.get_pdm_db_path())}


@eel.expose
def pdm_search_orders(query: str) -> Dict[str, Any]:
    try:
        return {'success': True, 'orders': adapters.search_orders(query)}
    except Exception as e:
        logger.exception('pdm_search_orders')
        return _fail(f'주문 검색 오류: {e}')


@eel.expose
def pdm_list_documents(contract_number: str = '', doc_type: str = '') -> Dict[str, Any]:
    try:
        return {'success': True, 'documents': get_db().list_documents(contract_number, doc_type)}
    except Exception as e:
        logger.exception('pdm_list_documents')
        return _fail(f'문서 목록 오류: {e}')


@eel.expose
def pdm_create_document(doc_type: str, contract_number: str) -> Dict[str, Any]:
    """작업현황에서 헤더 정보를 읽어 새 문서 생성. 작성자는 로그인 사용자."""
    try:
        user = adapters.get_current_user()
        info = adapters.get_order_info(contract_number)
        if not info:
            return _fail('작업현황에서 해당 주문을 찾을 수 없습니다.')
        reporter = user.get('full_name', '')
        header = (build_header(info, reporter, date.today()) if doc_type == 'service_report'
                  else measurement.build_header(info, reporter, date.today()))
        existing = [d['title'] for d in get_db().list_documents(info['contractNumber'], doc_type)]
        doc_id = get_db().create_document(
            doc_type, info['contractNumber'], info['shipName'],
            default_title(doc_type, info, existing), header, reporter)
        return {'success': True, 'document': get_db().get_document(doc_id)}
    except ValueError as e:
        return _fail(str(e))
    except Exception as e:
        logger.exception('pdm_create_document')
        return _fail(f'문서 생성 오류: {e}')


@eel.expose
def pdm_get_document(doc_id: int) -> Dict[str, Any]:
    try:
        doc = get_db().get_document(doc_id)
        return {'success': True, 'document': doc} if doc else _fail('문서를 찾을 수 없습니다.')
    except Exception as e:
        logger.exception('pdm_get_document')
        return _fail(f'문서 조회 오류: {e}')


@eel.expose
def pdm_save_document(doc_id: int, expected_updated_at: str, title: str, header: Dict[str, Any]) -> Dict[str, Any]:
    try:
        user = adapters.get_current_user()
        current = get_db().get_document(doc_id)
        if current is None:
            return _fail('문서를 찾을 수 없습니다.')
        if current['docType'] == 'measurement':
            header = measurement.normalize_header(header)     # 양식/구분 검증, 행·열 수 보정
        new_ts = get_db().update_document(doc_id, expected_updated_at, title, header, user.get('full_name', ''))
        get_db().record_summary_history(header.get('model', ''), header.get('summary', []))
        return {'success': True, 'updatedAt': new_ts}
    except ConflictError as e:
        return _fail(str(e), conflict=True)
    except ValueError as e:
        return _fail(str(e))
    except KeyError:
        return _fail('문서를 찾을 수 없습니다.')
    except Exception as e:
        logger.exception('pdm_save_document')
        return _fail(f'저장 오류: {e}')


@eel.expose
def pdm_summary_suggestions(engine_model: str) -> Dict[str, Any]:
    """같은 엔진 모델에서 자주 쓴 Summary 항목 (빈도순)."""
    try:
        return {'success': True, 'items': get_db().get_summary_history(engine_model)}
    except Exception as e:
        logger.exception('pdm_summary_suggestions')
        return _fail(f'제안 조회 오류: {e}')


@eel.expose
def pdm_measurement_templates() -> Dict[str, Any]:
    """계측지 항목 정의(양식 목록) — 입력 화면과 출력이 이 정의로 만들어진다."""
    try:
        return {'success': True, 'forms': measurement.load_templates()}
    except Exception as e:
        logger.exception('pdm_measurement_templates')
        return _fail(f'계측 항목 정의 오류: {e}')


@eel.expose
def pdm_new_measurement_form(form_id: str, side: str) -> Dict[str, Any]:
    """선택한 양식(예: 크랭크핀 PORT)의 빈 입력 구조. 기본 규격/기준값이 채워져 있다."""
    try:
        return {'success': True, 'form': measurement.default_instance(form_id, side)}
    except ValueError as e:
        return _fail(str(e))
