"""PDM 엑셀 내보내기 Eel API — 문서를 .xlsx 로 만들어 base64 로 돌려준다 (화면이 파일로 저장). 읽기 등급(guest)."""
import base64
import logging
from typing import Any, Dict

import eel

from PDM.backend.guard import guarded
from PDM.backend import excel_export, layout, measurement
from PDM.backend.naming import sanitize_filename
from PDM.backend.runtime import fail, get_db, get_photos

logger = logging.getLogger(__name__)
MAX_XLSX_BYTES = 80 * 1024 * 1024        # 이보다 크면 전송하지 않는다 (사진 수십 장 + 여유)


@eel.expose
@guarded('guest')
def pdm_export_excel(doc_id: int) -> Dict[str, Any]:
    try:
        doc = get_db().get_document(doc_id)
        if doc is None:
            return fail('문서를 찾을 수 없습니다.')
        photos = get_photos().list_photos(doc_id) if doc['docType'] != 'measurement' else []
        data = excel_export.build_workbook(doc, photos, get_photos().get_image, measurement.load_templates(),
                                           layout.effective(get_db().get_layout()))
        if len(data) > MAX_XLSX_BYTES:
            return fail('엑셀 파일이 너무 큽니다. 사진 수를 줄여 주세요.')
        return {'success': True, 'filename': sanitize_filename(doc['title']) + '.xlsx', 'data': base64.b64encode(data).decode('ascii')}
    except ValueError as e:
        return fail(str(e))
    except Exception:
        logger.exception('pdm_export_excel')
        return fail('엑셀 만들기 중 오류가 발생했습니다.')
