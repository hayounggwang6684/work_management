"""PDM Eel API. 모든 함수는 dict 반환 ({'success': bool, ...}).

작성자(created_by/updated_by)는 항상 adapters.get_current_user() 에서 가져온다 (JS 인자 신뢰 금지).
"""
import logging
from datetime import date
from typing import Any, Dict

import eel

from PDM.backend.guard import guarded
from PDM.backend import adapters
from PDM.backend.naming import default_title
from PDM.backend import measurement, photo_api, settings_api  # noqa: F401  (photo/settings_api: @eel.expose 등록)
from PDM.backend.pdm_db import ConflictError
from PDM.backend.runtime import fail as _fail, get_db
from PDM.backend.service_report import build_header, normalize_header as normalize_service_report_header

logger = logging.getLogger(__name__)
MAX_TITLE_LEN = 100


@eel.expose
@guarded('guest')
def pdm_ping() -> Dict[str, Any]:
    user = adapters.get_current_user()
    can_manage = adapters.can_manage_templates(user)
    info = {'success': True, 'user': user.get('full_name', ''), 'canManage': can_manage}
    if can_manage:
        info['dbPath'] = str(adapters.get_pdm_db_path())      # 서버 경로는 관리자에게만 알린다
    return info


@eel.expose
@guarded('guest')
def pdm_search_orders(query: str) -> Dict[str, Any]:
    try:
        return {'success': True, 'orders': adapters.search_orders(query)}
    except Exception as e:
        logger.exception('pdm_search_orders')
        return _fail('주문 검색 중 오류가 발생했습니다.')


@eel.expose
@guarded('guest')
def pdm_list_projects(start: str, end: str, query: str = '') -> Dict[str, Any]:
    """공사현황: 기간 안에 작업이 있는 주문 목록 + 주문별 서비스레포트/계측지 건수."""
    try:
        projects = adapters.list_projects(start, end, query)
        counts = get_db().document_counts([p['contractNumber'] for p in projects])
        for p in projects:
            c = counts.get(p['contractNumber'], {})
            p['docs'] = {'serviceReport': c.get('service_report', 0), 'measurement': c.get('measurement', 0)}
        return {'success': True, 'projects': projects}
    except ValueError as e:
        return _fail(str(e))
    except Exception as e:
        logger.exception('pdm_list_projects')
        return _fail('공사현황 조회 중 오류가 발생했습니다.')


@eel.expose
@guarded('guest')
def pdm_list_documents(contract_number: str = '', doc_type: str = '') -> Dict[str, Any]:
    try:
        return {'success': True, 'documents': get_db().list_documents(contract_number, doc_type)}
    except Exception as e:
        logger.exception('pdm_list_documents')
        return _fail('문서 목록 중 오류가 발생했습니다.')


@eel.expose
@guarded('write')
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
        return _fail('문서 생성 중 오류가 발생했습니다.')


@eel.expose
@guarded('guest')
def pdm_get_document(doc_id: int) -> Dict[str, Any]:
    try:
        doc = get_db().get_document(doc_id)
        return {'success': True, 'document': doc} if doc else _fail('문서를 찾을 수 없습니다.')
    except Exception as e:
        logger.exception('pdm_get_document')
        return _fail('문서 조회 중 오류가 발생했습니다.')


@eel.expose
@guarded('write')
def pdm_save_document(doc_id: int, expected_updated_at: str, title: str, header: Dict[str, Any]) -> Dict[str, Any]:
    try:
        user = adapters.get_current_user()
        current = get_db().get_document(doc_id)
        if current is None:
            return _fail('문서를 찾을 수 없습니다.')
        if not isinstance(header, dict):
            return _fail('문서 내용 형식이 올바르지 않습니다.')
        title = (title or '').strip()[:MAX_TITLE_LEN] or current['title']
        # 공유 DB 비대화/오염을 막기 위해 서버가 종류별로 검증·정리한다 (양식/구분 확인, 행·열 수 보정, 길이 제한)
        header = (measurement.normalize_header(header) if current['docType'] == 'measurement'
                  else normalize_service_report_header(header))
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
        return _fail('저장 중 오류가 발생했습니다.')


@eel.expose
@guarded('guest')
def pdm_summary_suggestions(engine_model: str) -> Dict[str, Any]:
    """같은 엔진 모델에서 자주 쓴 Summary 항목 (빈도순)."""
    try:
        return {'success': True, 'items': get_db().get_summary_history(engine_model)}
    except Exception as e:
        logger.exception('pdm_summary_suggestions')
        return _fail('제안 조회 중 오류가 발생했습니다.')


@eel.expose
@guarded('guest')
def pdm_measurement_templates() -> Dict[str, Any]:
    """계측지 항목 정의(양식 목록) — 입력 화면과 출력이 이 정의로 만들어진다."""
    try:
        return {'success': True, 'forms': measurement.load_templates()}
    except Exception as e:
        logger.exception('pdm_measurement_templates')
        return _fail('계측 항목 정의 중 오류가 발생했습니다.')


@eel.expose
@guarded('guest')
def pdm_new_measurement_form(form_id: str, label: str = '') -> Dict[str, Any]:
    """선택한 양식 한 장의 빈 입력 구조. 기본 규격/기준값이 채워져 있고 label 은 장 구분(선택)."""
    try:
        return {'success': True, 'form': measurement.default_instance(form_id, (label or '')[:measurement.MAX_LABEL_LEN])}
    except ValueError as e:
        return _fail(str(e))
