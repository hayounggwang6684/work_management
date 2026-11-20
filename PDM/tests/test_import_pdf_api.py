"""기존 PDF 업로드(pdm_import_pdf) / 오류 보고(pdm_report_import_error) API 테스트"""
import base64
import io
import sqlite3
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
sys.modules.setdefault('eel', types.SimpleNamespace(expose=lambda f: f))

import pytest
from PIL import Image as PILImage

from PDM.backend import adapters, customs_api, import_api, runtime
from PDM.backend import api as pdm_api  # noqa: F401
from PDM.backend.pdf_import import GEOMETRY, MM
from PDM.backend.runtime import get_db, get_photos

CONTRACT = 'SH-2026-206-T'


@pytest.fixture
def env(tmp_path, monkeypatch):
    work = tmp_path / 'work.db'
    conn = sqlite3.connect(work)
    conn.execute('CREATE TABLE work_records (date TEXT, record_number INT, contract_number TEXT, company TEXT, ship_name TEXT, engine_model TEXT, location TEXT)')
    conn.execute("INSERT INTO work_records VALUES ('2026-11-16', 1, ?, '세안해운', 'SS T 7', 'DOOSAN AD196TI', '공장')", (CONTRACT,))
    conn.commit()
    conn.close()
    monkeypatch.setenv('PDM_WORK_DB_PATH', str(work))
    monkeypatch.setenv('PDM_DB_PATH', str(tmp_path / 'pdm.db'))
    monkeypatch.setattr(runtime, '_db', None)
    monkeypatch.setattr(runtime, '_photos', None)
    monkeypatch.setattr(customs_api, '_store', None)
    monkeypatch.setattr(adapters, 'get_current_user', lambda: {'full_name': '하영광'})
    return tmp_path


def jpeg(color):
    buf = io.BytesIO()
    PILImage.new('RGB', (300, 225), color).save(buf, 'JPEG')
    return buf.getvalue()


def build_pdf(pages):
    """pages: [{'texts': [(x_pt, y_pt, str)], 'images': [(x, y, w, h, jpeg bytes)], 'size': (w, h)}] → PDF 바이트 (Helvetica 영문 글자)."""
    objs = []                                           # (번호는 1부터 순서대로)
    page_ids, font_id = [], None
    # 1 Catalog, 2 Pages, 3 Font, 이후 쪽마다 [Page, Contents, 이미지들…]
    objs += [b'<</Type/Catalog/Pages 2 0 R>>', None, b'<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>']
    for pg in pages:
        first = len(objs) + 1
        n_img = len(pg.get('images', []))
        ops = [f'q {w:.1f} 0 0 {h:.1f} {x:.1f} {y:.1f} cm /Im{i} Do Q' for i, (x, y, w, h, _) in enumerate(pg.get('images', []))]
        ops += [f'BT /F1 10 Tf {x:.1f} {y:.1f} Td ({t}) Tj ET' for x, y, t in pg.get('texts', [])]
        content = '\n'.join(ops).encode()
        xo = ' '.join(f'/Im{i} {first + 2 + i} 0 R' for i in range(n_img))
        w, h = pg.get('size', (595.28, 841.89))
        objs.append(f'<</Type/Page/Parent 2 0 R/MediaBox[0 0 {w} {h}]/Contents {first + 1} 0 R/Resources<</Font<</F1 3 0 R>>/XObject<<{xo}>>>>>>'.encode())
        objs.append(b'<</Length %d>>\nstream\n' % len(content) + content + b'\nendstream')
        for _, _, _, _, data in pg.get('images', []):
            objs.append(b'<</Type/XObject/Subtype/Image/Width 300/Height 225/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length %d>>\nstream\n' % len(data) + data + b'\nendstream')
        page_ids.append(first)
    objs[1] = f'<</Type/Pages/Kids[{" ".join(f"{i} 0 R" for i in page_ids)}]/Count {len(page_ids)}>>'.encode()
    out, offsets = b'%PDF-1.7\n', []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += b'%d 0 obj\n' % i + o + b'\nendobj\n'
    xref = len(out)
    out += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1) + b''.join(b'%010d 00000 n \n' % o for o in offsets)
    return out + b'trailer\n<</Root 1 0 R/Size %d>>\nstartxref\n%d\n%%%%EOF\n' % (len(objs) + 1, xref)


def photo_page_spec(captions, title=''):
    geo = GEOMETRY[6]
    images, texts = [], []
    for i, (color, caption) in enumerate(captions):
        x, top = geo['cols'][i % 2] * MM, geo['rows'][i // 2]
        w, h = geo['photo'][0] * MM, geo['photo'][1] * MM
        images.append((x, (297 - top) * MM - h, w, h, jpeg(color)))
        if caption:
            texts.append((x + 20, (297 - top - 68) * MM, caption))
    if title:
        texts.append((200, (297 - 31) * MM, title))
    texts.append((80, 40, 'SUNJIN JONGHAP Co.,Ltd.'))
    return {'images': images, 'texts': texts}


def text_page_spec(lines):
    return {'texts': [(60, 760 - i * 16, t) for i, t in enumerate(lines)] + [(80, 40, 'SUNJIN JONGHAP Co.,Ltd.')]}


SR_LINES = ['Service report', 'Name of vessel ANIVA IMO No. 9876543', 'Engine Type NO.1 GENERATOR S/N 22236760', 'Model CAT C32 Date 2026.10.13',
            'Order No. SH-OLD-999-T Reported by Kim', 'Customer OLD-CUSTOMER Requested by', 'Location Factory', 'Period 2026.09.28 ~ 10.13',
            'Subject Overhaul work', 'Summary of works', '1. Engine overhaul', '- Head removal', 'Remark', 'Note one']


def b64(data):
    return base64.b64encode(data).decode()


def sr_pdf():
    # 글머리 기호 ■ 는 Helvetica 로 못 쓰므로 테스트 PDF 에는 제목만 넣는다 (읽는 쪽은 ■ 가 있어도 없어도 된다)
    return build_pdf([text_page_spec(SR_LINES), photo_page_spec([((200, 30, 30), 'Cap A'), ((30, 200, 30), '')], title='Chapter One')])


def test_guards():
    assert import_api.pdm_import_pdf.__pdm_tier__ == 'write' and import_api.pdm_report_import_error.__pdm_tier__ == 'write'


def test_album_pdf_becomes_a_private_document_with_photos_and_captions(env):
    pdf = build_pdf([photo_page_spec([((200, 30, 30), 'Left'), ((30, 200, 30), 'Right')], title='Chapter')])

    r = import_api.pdm_import_pdf('photo_album', CONTRACT, 'old.pdf', b64(pdf))

    assert r['success'] and r['photoCount'] == 2 and r['skippedPhotos'] == 0
    doc = r['document']
    assert doc['docType'] == 'photo_album' and doc['isPrivate'] is True and doc['contractNumber'] == CONTRACT
    assert doc['header']['vesselName'] == 'SS T 7' and doc['header']['pageTitles'] == {'0': 'Chapter'}      # 주문 정보는 올린 주문 것
    assert [(p['slotIndex'], p['caption']) for p in get_photos().list_photos(doc['id'])] == [(0, 'Left'), (1, 'Right')]


def test_service_report_pdf_fills_form_keeps_order_number_and_photos(env):
    r = import_api.pdm_import_pdf('service_report', CONTRACT, 'sr.pdf', b64(sr_pdf()))

    assert r['success'] and r['photoCount'] == 2
    h = r['document']['header']
    assert (h['vesselName'], h['imoNo'], h['serialNo'], h['reportedBy'], h['subject'], h['period']) == ('ANIVA', '9876543', '22236760', 'Kim', 'Overhaul work', '2026.09.28 ~ 10.13')
    assert h['orderNo'] == CONTRACT                                  # PDF 의 SH-OLD-999-T 가 아니라 올린 주문
    assert h['customer'] == 'OLD-CUSTOMER' and h['requestedBy'] == '' and h['summary'] == ['1. Engine overhaul', '- Head removal'] and h['remark'] == 'Note one'
    assert h['pageTitles'] == {'0': 'Chapter One'}
    assert [(p['slotIndex'], p['caption']) for p in get_photos().list_photos(r['document']['id'])] == [(0, 'Cap A'), (1, '')]


def test_non_matching_pdf_reports_recognition_error_and_leaves_no_document(env):
    pdf = build_pdf([text_page_spec(['RECORD OF MAIN JOURNAL & BEARING'])])

    r = import_api.pdm_import_pdf('service_report', CONTRACT, 'x.pdf', b64(pdf))

    assert r['success'] is False and r['recognitionError'] is True and '서비스레포트 PDF 가 아닙니다' in r['message']
    assert get_db().list_documents(CONTRACT) == []


def test_bad_inputs_are_plain_errors_not_recognition_errors(env):
    assert import_api.pdm_import_pdf('service_report', CONTRACT, 'x.pdf', '###').get('recognitionError') is None
    assert import_api.pdm_import_pdf('service_report', CONTRACT, 'x.pdf', b64(b'not a pdf'))['success'] is False
    r = import_api.pdm_import_pdf('service_report', 'SH-2026-999-T', 'x.pdf', b64(sr_pdf()))
    assert r['success'] is False and get_db().list_documents('SH-2026-999-T') == []


def test_unsupported_type_is_a_recognition_error(env):
    r = import_api.pdm_import_pdf('measurement', CONTRACT, 'x.pdf', b64(sr_pdf()))

    assert r['success'] is False and r['recognitionError'] is True and '지원하지' in r['message']


def test_report_error_sends_pdf_and_description_via_hook(env, monkeypatch):
    sent = {}
    monkeypatch.setattr(adapters, '_hooks', {**adapters._hooks, 'report_error': lambda caption, name, data: sent.update(caption=caption, name=name, data=data) or {'success': True, 'message': 'ok'}})
    pdf = build_pdf([text_page_spec(['nothing'])])

    r = import_api.pdm_report_import_error('service_report', CONTRACT, 'old.pdf', b64(pdf), '서비스레포트 PDF 가 아닙니다')

    assert r == {'success': True, 'message': 'ok'}
    assert sent['data'] == pdf and sent['name'] == 'old.pdf' and CONTRACT in sent['caption'] and '하영광' in sent['caption'] and '아닙니다' in sent['caption']


def test_report_error_without_hook_or_with_bad_data_fails_safely(env, monkeypatch):
    monkeypatch.setattr(adapters, '_hooks', {k: v for k, v in adapters._hooks.items() if k != 'report_error'})
    assert import_api.pdm_report_import_error('service_report', CONTRACT, 'a.pdf', b64(b'%PDF-1.4 x'), 'e')['success'] is False
    assert import_api.pdm_report_import_error('service_report', CONTRACT, 'a.pdf', '###', 'e')['success'] is False
