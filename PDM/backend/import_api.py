"""불러오기 Eel API — 다른 주문의 같은 종류 문서에서 내용(+사진)을 가져온다. 작성자는 서버 세션에서 읽는다."""
import logging
from typing import Any, Dict

import eel

from PDM.backend import adapters
from PDM.backend.guard import guarded
from PDM.backend.import_doc import ImportError_, import_document
from PDM.backend.pdm_db import ConflictError
from PDM.backend.runtime import fail, get_db, get_photos

logger = logging.getLogger(__name__)
SEARCH_LIMIT = 50


def _viewer() -> str:
    return adapters.get_current_user().get('full_name', '')


@eel.expose
@guarded('write')
def pdm_search_import_sources(doc_type: str, query: str = '', exclude_id: int = 0) -> Dict[str, Any]:
    """불러올 문서 찾기: 같은 종류 문서를 계약번호/선박/파일 이름으로 검색 (최근 수정 순, 최대 50건)."""
    try:
        docs = get_db().search_documents(doc_type, query, _viewer(), int(exclude_id or 0), SEARCH_LIMIT)
        return {'success': True, 'documents': [{k: d[k] for k in ('id', 'docType', 'contractNumber', 'shipName', 'title', 'isPrivate', 'updatedBy', 'updatedAt')} for d in docs]}
    except Exception:
        logger.exception('pdm_search_import_sources')
        return fail('불러올 문서를 찾지 못했습니다.')


@eel.expose
@guarded('write')
def pdm_import_document(target_id: int, expected_updated_at: str, source_id: int) -> Dict[str, Any]:
    try:
        doc = import_document(get_db(), get_photos(), int(target_id), expected_updated_at, int(source_id), _viewer(), _viewer())
        return {'success': True, 'document': doc, 'copiedPhotos': doc['copiedPhotos']}
    except ConflictError as e:
        return fail(str(e), conflict=True)
    except ImportError_ as e:
        return fail(str(e))
    except ValueError as e:
        return fail(str(e))
    except Exception:
        logger.exception('pdm_import_document')
        return fail('불러오기 중 오류가 발생했습니다.')


# ── 기존 PDF 업로드 (이 앱이 만든 서비스레포트/부품사진첩 PDF 를 읽어 새 문서로) ─────────────────

TYPE_LABEL = {'service_report': '서비스레포트', 'photo_album': '부품사진첩', 'measurement': '계측지'}
MAX_CAPTION_LEN = 200
_PDF_ORDER_KEYS = ('orderNo',)           # 주문번호는 올린 주문의 것을 쓴다 (PDF 의 값은 무시)


def _header_from_pdf(doc_type: str, base: Dict[str, Any], parsed_header: Dict[str, Any]) -> Dict[str, Any]:
    """새 문서 헤더(주문 정보로 채워짐)에 PDF 에서 읽은 값을 덮어쓴다. 비어 있는 값은 주문 정보를 그대로 둔다."""
    header = dict(base)
    for key, value in parsed_header.items():
        if key in _PDF_ORDER_KEYS:
            continue
        if isinstance(value, str) and not value.strip() and header.get(key):
            continue
        header[key] = value
    return header


@eel.expose
@guarded('write')
def pdm_import_pdf(doc_type: str, contract_number: str, file_name: str, data: str) -> Dict[str, Any]:
    """PDF 를 읽어 선택한 주문의 새 문서(작성자 전용 임시)로 만든다. 읽지 못하면 recognitionError=True 와 이유를 돌려준다 (화면이 오류 보고 팝업을 띄운다)."""
    from PDM.backend import api as pdm_api
    from PDM.backend.customs import CustomsError, decode_base64, validate_pdf
    from PDM.backend.import_doc import NORMALIZERS
    from PDM.backend.pdf_import import PdfImportError, parse_pdf
    from PDM.backend.photo_service import PhotoError, process_image
    from PDM.backend.photo_store import SlotOccupied
    try:
        raw = decode_base64(data)
        validate_pdf(raw)
        parsed = parse_pdf(doc_type, raw)
    except PdfImportError as e:
        return fail(str(e), recognitionError=True)
    except CustomsError as e:
        return fail(str(e))
    except Exception as e:
        logger.exception('pdm_import_pdf: parse')
        return fail(f'PDF 를 읽는 중 오류가 발생했습니다 ({type(e).__name__}).', recognitionError=True)

    created = pdm_api.pdm_create_document(doc_type, contract_number)
    if not created.get('success'):
        return created
    doc = created['document']
    try:
        header = NORMALIZERS[doc_type](_header_from_pdf(doc_type, doc['header'], parsed.header))
        get_db().update_document(doc['id'], doc['updatedAt'], doc['title'], header, _viewer(), publish=False)
        added = skipped = 0
        for photo in parsed.photos:
            try:
                img = process_image(photo.data)
                photo_id = get_photos().add_photo(doc['id'], photo.slot, img)
                if photo.caption:
                    get_photos().set_caption(doc['id'], photo_id, photo.caption[:MAX_CAPTION_LEN])
                added += 1
            except (PhotoError, SlotOccupied, ValueError):
                skipped += 1
        if parsed.photos and not added:
            raise PdfImportError('PDF 의 사진을 하나도 읽지 못했습니다.')
        get_db().touch_document(doc['id'], _viewer())
        return {'success': True, 'document': get_db().get_document(doc['id'], _viewer()), 'photoCount': added, 'skippedPhotos': skipped}
    except PdfImportError as e:
        get_db().delete_document(doc['id'])                  # 반쯤 만들어진 문서를 남기지 않는다
        return fail(str(e), recognitionError=True)
    except Exception:
        logger.exception('pdm_import_pdf: build')
        get_db().delete_document(doc['id'])
        return fail('PDF 내용을 문서로 만드는 중 오류가 발생했습니다.', recognitionError=True)


@eel.expose
@guarded('write')
def pdm_report_import_error(doc_type: str, contract_number: str, file_name: str, data: str, error_text: str) -> Dict[str, Any]:
    """PDF 읽기 오류와 그 PDF 를 관리자에게 보낸다 — 화면 팝업에서 사용자가 [보내기]를 눌렀을 때만 호출한다."""
    from PDM.backend.customs import CustomsError, decode_base64, validate_pdf
    try:
        raw = decode_base64(data)
        validate_pdf(raw)
        user = adapters.get_current_user().get('full_name', '')
        caption = (f"[PDF 읽기 오류] {TYPE_LABEL.get(doc_type, doc_type)} · 주문 {contract_number}\n"
                   f"파일: {file_name}\n올린 사람: {user}\n오류: {(error_text or '')[:600]}")
        return adapters.send_error_report(caption, (file_name or 'report.pdf')[:120], raw)
    except CustomsError as e:
        return fail(str(e))
    except Exception:
        logger.exception('pdm_report_import_error')
        return fail('오류 보고를 보내지 못했습니다.')
