"""기존 PDF(이 앱이 만든 서비스레포트/부품사진첩) 읽기 테스트"""
import io
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
sys.modules.setdefault('eel', types.SimpleNamespace(expose=lambda f: f))

import pytest
from PIL import Image as PILImage

from PDM.backend import pdf_import as P
from PDM.backend.pdf_import import Fragment, Image, Page, PdfImportError

MM = P.MM
W6, H6 = 210 * MM, 297 * MM
JPEG = b'\xff\xd8\xff-fake-'


def frag(text, x_mm, y_from_top_mm, h=H6):
    return Fragment(text, x_mm * MM, h - y_from_top_mm * MM)


def photo_page(photos, title='', per_page=6):
    """photos: [(slot, caption)] — 출력 배치 좌표에 사진과 캡션 글을 놓은 가짜 쪽."""
    geo = P.GEOMETRY[per_page]
    pw, ph = geo['page']
    page = Page(pw * MM, ph * MM)
    if title:
        page.fragments.append(frag(title, 60, 31, ph * MM / MM))
        page.fragments[-1] = Fragment(title, 60 * MM, (ph - 31) * MM)
    for slot, caption in photos:
        x, top = geo['cols'][slot % 2], geo['rows'][slot // 2]
        w, h = geo['photo']
        page.images.append(Image(JPEG + bytes([slot]), x * MM, (ph - top - h) * MM, w * MM, h * MM))
        if caption:
            page.fragments.append(Fragment(caption, (x + 10) * MM, (ph - top - 68) * MM))
    page.fragments += [Fragment('SUNJIN JONGHAP Co.,Ltd.', 28 * MM, 43), Fragment('Fax +82 51 414 8870', 160 * MM, 26)]
    return page


def text_page(lines, h=H6):
    page = Page(W6, h)
    for i, text in enumerate(lines):
        page.fragments.append(Fragment(text, 30 * MM, (260 - i * 6) * MM))
    page.fragments.append(Fragment('SUNJIN JONGHAP Co.,Ltd.', 28 * MM, 43))
    return page


FIRST = ['Service report', 'Name of vessel 202 호정 IMO No.', 'Engine Type NO.1 GENERATOR ENGINE S/N 22236760', 'Model CUM\' QSB7 Date 2026.10.13',
         'Order No. SH-2026-199-T Reported by 하영광', 'Customer 해양경찰부산정비창 Requested by', 'Location 공장', 'Period 2026.09.28 ~ 10.13',
         'Subject 울진 202정 총분해 수리', '■ Summary of works', '1. 엔진 오바홀', '- CYL HEAD 취외복구', '■ Remark', '※ 출고 중 사고']


# ── 헤더 줄 읽기 ──────────────────────────────────────────────────────────

def test_split_labels_handles_two_labels_and_empty_values():
    assert P._split_labels('Name of vessel 202 호정 IMO No.') == {'vesselName': '202 호정', 'imoNo': ''}
    assert P._split_labels('Order No. SH-2026-199-T Reported by 하영광') == {'orderNo': 'SH-2026-199-T', 'reportedBy': '하영광'}
    assert P._split_labels('Customer 해양경찰부산정비창 Requested by') == {'customer': '해양경찰부산정비창', 'requestedBy': ''}
    assert P._split_labels('Period 2026.09.28 ~ 10.13') == {'period': '2026.09.28 ~ 10.13'}


def test_to_lines_groups_by_y_and_collapses_spaces():
    lines = P.to_lines([Fragment('가공', 190, 531.4), Fragment("Cyl' block  liner ", 88, 531.4), Fragment('Valve', 88, 298.9)])

    assert [t for _, t in lines] == ["Cyl' block liner 가공", 'Valve']


# ── 서비스레포트 ──────────────────────────────────────────────────────────

def test_service_report_text_pages_become_header_summary_and_remark():
    pages = [text_page(FIRST), text_page(['■ Summary of works (continued)', '10. Turn over 작업', '- Cam shaft 신환'])]

    r = P.parse_service_report(pages)

    h = r.header
    assert (h['vesselName'], h['serialNo'], h['orderNo'], h['reportedBy'], h['customer'], h['subject']) == ('202 호정', '22236760', 'SH-2026-199-T', '하영광', '해양경찰부산정비창', '울진 202정 총분해 수리')
    assert h['imoNo'] == '' and h['requestedBy'] == '' and h['period'] == '2026.09.28 ~ 10.13'
    assert h['summary'] == ['1. 엔진 오바홀', '- CYL HEAD 취외복구', '10. Turn over 작업', '- Cam shaft 신환']
    assert h['remark'] == '※ 출고 중 사고' and r.photos == []


def test_photo_pages_give_slots_captions_titles_and_skip_footer():
    pages = [text_page(FIRST), photo_page([(0, '사진0'), (1, ''), (3, '사진3')], title='챕터1'), photo_page([(0, 'p2-0'), (5, 'p2-5')])]

    r = P.parse_service_report(pages)

    assert [(p.slot, p.caption) for p in r.photos] == [(0, '사진0'), (1, ''), (3, '사진3'), (6, 'p2-0'), (11, 'p2-5')]    # 빈 캡션/빈 칸 위치 유지, 두 번째 쪽은 6 부터
    assert r.header['pageTitles'] == {'0': '챕터1'} and r.header['photosPerPage'] == 6
    assert all('SUNJIN' not in p.caption and 'Fax' not in p.caption for p in r.photos)


def test_landscape_four_per_page_is_detected():
    pages = [text_page(FIRST), photo_page([(0, 'a'), (3, 'd')], per_page=4)]

    r = P.parse_service_report(pages)

    assert r.header['photosPerPage'] == 4 and [(p.slot, p.caption) for p in r.photos] == [(0, 'a'), (3, 'd')]


def test_mixed_orientations_are_rejected():
    with pytest.raises(PdfImportError, match='크기'):
        P.parse_photos([photo_page([(0, 'a')]), photo_page([(0, 'b')], per_page=4)])


def test_non_service_report_pages_are_rejected_with_a_clear_message():
    with pytest.raises(PdfImportError, match='서비스레포트 PDF 가 아닙니다'):
        P.parse_service_report([text_page(['RECORD OF MAIN JOURNAL & BEARING'])])


# ── 부품사진첩 ────────────────────────────────────────────────────────────

def test_photo_album_reads_photos_and_titles_only():
    r = P.parse_photo_album([photo_page([(0, 'a'), (2, 'c')], title='제목')])

    assert r.header == {'pageTitles': {'0': '제목'}, 'photosPerPage': 6} and [(p.slot, p.caption) for p in r.photos] == [(0, 'a'), (2, 'c')]


def test_photo_album_rejects_service_report_and_photo_less_pdfs():
    with pytest.raises(PdfImportError, match='서비스레포트 PDF'):
        P.parse_photo_album([text_page(FIRST), photo_page([(0, 'a')])])
    with pytest.raises(PdfImportError, match='사진을 찾지 못'):
        P.parse_photo_album([text_page(FIRST)])


def test_unsupported_type_and_garbage_pdf():
    with pytest.raises(PdfImportError, match='지원하지'):
        P.parse_pdf('measurement', b'%PDF-1.7')
    with pytest.raises(PdfImportError, match='열 수 없'):
        P.parse_pdf('service_report', b'%PDF-1.4 garbage')


# ── 실제 PDF 바이트 (좌표 읽기 계층) ─────────────────────────────────────

def make_pdf(captions):
    """사진 2장(JPEG) + 사진 아래 캡션이 있는 세로 A4 PDF."""
    def jpeg():
        buf = io.BytesIO()
        PILImage.new('RGB', (300, 225), (200, 30, 30)).save(buf, 'JPEG')
        return buf.getvalue()

    geo = P.GEOMETRY[6]
    ops, xobjs = [], []
    for i, caption in enumerate(captions):
        x, top = geo['cols'][i % 2] * MM, geo['rows'][i // 2]
        w, h = geo['photo'][0] * MM, geo['photo'][1] * MM
        ops.append(f'q {w:.1f} 0 0 {h:.1f} {x:.1f} {(297 - top) * MM - h:.1f} cm /Im{i} Do Q')
        ops.append(f'BT /F1 10 Tf {x + 20:.1f} {(297 - top - 68) * MM:.1f} Td ({caption}) Tj ET')
        xobjs.append(f'/Im{i} {5 + i} 0 R')
    ops.append(f'BT /F1 10 Tf {28 * MM:.1f} 40 Td (SUNJIN JONGHAP Co.,Ltd.) Tj ET')
    content = '\n'.join(ops).encode()
    objs = [b'<</Type/Catalog/Pages 2 0 R>>', b'<</Type/Pages/Kids[3 0 R]/Count 1>>',
            f'<</Type/Page/Parent 2 0 R/MediaBox[0 0 595.28 841.89]/Contents 4 0 R/Resources<</Font<</F1 {5 + len(captions)} 0 R>>/XObject<<{" ".join(xobjs)}>>>>>>'.encode(),
            b'<</Length %d>>\nstream\n' % len(content) + content + b'\nendstream']
    for _ in captions:
        data = jpeg()
        objs.append(b'<</Type/XObject/Subtype/Image/Width 300/Height 225/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length %d>>\nstream\n' % len(data) + data + b'\nendstream')
    objs.append(b'<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>')
    out, offsets = b'%PDF-1.7\n', []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += b'%d 0 obj\n' % i + o + b'\nendobj\n'
    xref = len(out)
    out += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1) + b''.join(b'%010d 00000 n \n' % o for o in offsets)
    return out + b'trailer\n<</Root 1 0 R/Size %d>>\nstartxref\n%d\n%%%%EOF\n' % (len(objs) + 1, xref)


def test_real_pdf_bytes_photos_and_captions_are_paired_by_position():
    r = P.parse_pdf('photo_album', make_pdf(['Left photo', 'Right photo']))

    assert [(p.slot, p.caption) for p in r.photos] == [(0, 'Left photo'), (1, 'Right photo')]
    assert all(p.data[:2] == b'\xff\xd8' for p in r.photos)                    # JPEG 그대로


SAMPLE = Path(r'C:\Users\admin\Documents\카카오톡 받은 파일\SH-2026-199-T_202 호정_서비스레포트.pdf')


@pytest.mark.skipif(not SAMPLE.exists(), reason='로컬 샘플 PDF 가 있는 PC 에서만')
def test_local_sample_service_report():
    r = P.parse_pdf('service_report', SAMPLE.read_bytes())

    assert r.header['orderNo'] == 'SH-2026-199-T' and r.header['serialNo'] == '22236760' and len(r.photos) == 44
    assert r.photos[0].caption == "Cyl' block liner sleeve 가공 및 삽입" and set(r.header['pageTitles']) == {'0', '7'}
