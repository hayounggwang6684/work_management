"""PDM Eel API. 모든 함수는 dict 반환 ({'success': bool, ...}).

작성자(created_by/updated_by)는 항상 adapters.get_current_user() 에서 가져온다 (JS 인자 신뢰 금지).
"""
import logging
import re
from datetime import date
from typing import Any, Dict

import eel

from PDM.backend.guard import guarded
from PDM.backend import adapters
from PDM.backend.naming import default_title
from PDM.backend import export_api, measurement, photo_album, photo_api, settings_api, standards, standards_api  # noqa: F401  (photo/settings/standards/export_api: @eel.expose 등록)
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


def _standalone_rows(start: str, end: str, query: str, known: set) -> list:
    """판매용 독립 주문을 공사 목록과 같은 모양의 행으로 (작업일 0, 기간 = 등록일). 작업현황에 같은 계약번호가 있으면 공사 쪽이 이긴다."""
    rows = get_db().list_standalone_orders(start, end, adapters.like_pattern((query or '').strip()))
    return [{'contractNumber': o['contractNumber'], 'company': o['company'], 'shipName': o['shipName'], 'engineModel': o['engineModel'],
             'firstDate': o['registeredDate'], 'lastDate': o['registeredDate'], 'daysInRange': 0, 'standalone': True}
            for o in rows if o['contractNumber'].upper() not in known]


def _order_info(contract_number: str) -> Dict[str, Any]:
    """문서 헤더용 주문 정보: 작업현황(공사) 우선, 없으면 판매용 독립 주문. 없으면 {}."""
    return adapters.get_order_info(contract_number) or get_db().get_standalone_order((contract_number or '').strip()) or {}


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
    """레포트관리: 기간 안에 작업이 있는 주문 + 같은 기간에 등록한 판매용 주문, 주문별 서비스레포트/계측지/부품사진첩 건수."""
    try:
        projects = adapters.list_projects(start, end, query)
        projects += _standalone_rows(start, end, query, {p['contractNumber'].upper() for p in projects})
        counts = get_db().document_counts([p['contractNumber'] for p in projects])
        for p in projects:
            c = counts.get(p['contractNumber'], {})
            p['docs'] = {'serviceReport': c.get('service_report', 0), 'measurement': c.get('measurement', 0), 'photoAlbum': c.get('photo_album', 0)}
        return {'success': True, 'projects': projects}
    except ValueError as e:
        return _fail(str(e))
    except Exception as e:
        logger.exception('pdm_list_projects')
        return _fail('레포트 목록 조회 중 오류가 발생했습니다.')


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
    """작업현황(없으면 판매용 주문)에서 헤더 정보를 읽어 새 문서 생성. 작성자는 로그인 사용자.
    부품사진첩은 판매용 주문이면 표지 포함, 공사와 연계된 주문이면 표지 없이 만든다."""
    try:
        user = adapters.get_current_user()
        info = _order_info(contract_number)
        if not info:
            return _fail('해당 주문을 찾을 수 없습니다.')
        reporter = user.get('full_name', '')
        today = date.today()
        if doc_type == 'service_report':
            header = build_header(info, reporter, today)
        elif doc_type == 'photo_album':
            header = photo_album.build_header(info, today, with_cover=bool(info.get('standalone')))
        else:
            header = measurement.build_header(info, reporter, today)
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


_CONTRACT_BAD = re.compile(r'[\x00-\x1f]')


def _order_fields(contract_number: str, company: str, ship_name: str, engine_model: str) -> tuple:
    """판매용 주문 입력 검증/정리 → (계약번호, 업체, 선박, 엔진). 잘못되면 ValueError(사용자용 메시지)."""
    cn, ship = (contract_number or '').strip(), (ship_name or '').strip()
    if not cn or _CONTRACT_BAD.search(cn) or len(cn) > 40:
        raise ValueError('계약번호를 입력하세요 (40자 이내).')
    if not ship:
        raise ValueError('선박명을 입력하세요.')
    return cn, (company or '').strip()[:100], ship[:100], (engine_model or '').strip()[:100]


@eel.expose
@guarded('write')
def pdm_create_standalone_order(contract_number: str, company: str, ship_name: str, engine_model: str) -> Dict[str, Any]:
    """판매용 주문(작업현황에 공사가 없는 건)을 등록하고 표지 포함 부품사진첩을 만들어 돌려준다."""
    try:
        cn, company, ship, engine = _order_fields(contract_number, company, ship_name, engine_model)
        if adapters.get_order_info(cn):
            return _fail('작업현황에 이미 있는 계약번호입니다. 레포트관리 목록에서 해당 공사의 우클릭 메뉴를 사용하세요.')
        user = adapters.get_current_user().get('full_name', '')
        try:
            get_db().create_standalone_order(cn, company, ship, engine, user)
        except ValueError:
            # 앞선 시도에서 주문만 등록되고 문서 생성이 실패한 경우(문서가 하나도 없음)에는 같은 주문으로 이어서 만든다
            existing = get_db().get_standalone_order(cn)
            if not existing or get_db().list_documents(existing['contractNumber']):
                raise
            cn = existing['contractNumber']          # 대소문자만 다르게 입력해도 등록된 표기를 쓴다
        return pdm_create_document('photo_album', cn)
    except ValueError as e:
        return _fail(str(e))
    except Exception:
        logger.exception('pdm_create_standalone_order')
        return _fail('주문 등록 중 오류가 발생했습니다.')


@eel.expose
@guarded('write')
def pdm_update_standalone_order(old_contract_number: str, contract_number: str, company: str, ship_name: str, engine_model: str) -> Dict[str, Any]:
    """판매용 주문 수정 (공사 주문은 수정할 수 없다). 계약번호를 바꾸면 그 주문의 문서도 함께 옮겨진다."""
    try:
        cn, company, ship, engine = _order_fields(contract_number, company, ship_name, engine_model)
        if adapters.get_order_info(cn):
            return _fail('작업현황에 이미 있는 계약번호입니다.')
        return {'success': True, 'order': get_db().update_standalone_order((old_contract_number or '').strip(), cn, company, ship, engine)}
    except KeyError:
        return _fail('판매용 주문만 수정할 수 있습니다 (찾을 수 없음). 목록을 새로 조회하세요.')
    except ValueError as e:
        return _fail(str(e))
    except Exception:
        logger.exception('pdm_update_standalone_order')
        return _fail('주문 수정 중 오류가 발생했습니다.')


@eel.expose
@guarded('write')
def pdm_delete_standalone_order(contract_number: str) -> Dict[str, Any]:
    """판매용 주문과 그 주문의 모든 문서(사진 포함)를 삭제한다 (되돌릴 수 없음 — 화면에서 확인을 받는다). 공사 주문은 삭제할 수 없다."""
    try:
        cn = (contract_number or '').strip()
        if adapters.get_order_info(cn):
            return _fail('작업현황에 있는 계약번호라 삭제할 수 없습니다 (문서가 공사와 연결되어 있습니다).')
        return {'success': True, 'deletedDocuments': get_db().delete_standalone_order(cn)}
    except KeyError:
        return _fail('판매용 주문만 삭제할 수 있습니다 (찾을 수 없음). 목록을 새로 조회하세요.')
    except Exception:
        logger.exception('pdm_delete_standalone_order')
        return _fail('주문 삭제 중 오류가 발생했습니다.')


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
        normalizers = {'measurement': measurement.normalize_header, 'photo_album': photo_album.normalize_header}
        header = normalizers.get(current['docType'], normalize_service_report_header)(header)
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
def pdm_new_measurement_form(form_id: str, label: str = '', engine: str = '') -> Dict[str, Any]:
    """선택한 양식 한 장의 빈 입력 구조. 기본 규격/기준값이 채워져 있고 label 은 장 구분(선택).
    engine(작업현황 엔진명)이 있고 계측 표준값이 있으면 규격/기준값을 표준값으로 채우며, matched/notes 로 결과를 알린다."""
    try:
        form = measurement.default_instance(form_id, (label or '')[:measurement.MAX_LABEL_LEN])
        try:
            found = standards_api.standard_patch(form_id, engine)
        except Exception:       # 표준값 쪽 문제(DB 잠김/번들 파일 손상 등)가 양식 추가를 막지 않게 — 빈 양식으로 계속
            logger.exception('pdm_new_measurement_form: standards')
            found = None
        if not found or not found['patch']:
            return {'success': True, 'form': form, 'matched': None, 'notes': []}
        return {'success': True, 'form': standards.apply_patch(form, found['patch']),
                'matched': found['matched'], 'notes': found['patch']['notes']}
    except ValueError as e:
        return _fail(str(e))
