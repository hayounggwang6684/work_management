"""불러오기(다른 주문의 같은 종류 문서에서 내용 + 사진 가져오기) 테스트"""
import sys
import types
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
sys.modules.setdefault('eel', types.SimpleNamespace(expose=lambda f: f))

import pytest

from PDM.backend import measurement, photo_album
from PDM.backend.import_doc import ImportError_, import_document, merge_header
from PDM.backend.pdm_db import ConflictError, PdmDb
from PDM.backend.photo_service import ProcessedImage
from PDM.backend.photo_store import PhotoStore
from PDM.backend.service_report import build_header as sr_header

TODAY = date(2026, 11, 20)
INFO_A = {'contractNumber': 'SH-2026-001-T', 'shipName': 'A호', 'company': '가해운', 'engineModel': 'CUMMINS QSB7', 'location': '공장'}
INFO_B = {'contractNumber': 'SH-2026-002-T', 'shipName': 'B호', 'company': '나해운', 'engineModel': 'DOOSAN AD196TI', 'location': '선상'}


@pytest.fixture
def env(tmp_path):
    db = PdmDb(tmp_path / 'pdm.db')
    return db, PhotoStore(db)


def make_doc(db, doc_type, info, header, title='문서'):
    return db.create_document(doc_type, info['contractNumber'], info['shipName'], title, header, '김철수')


def add_photo(photos, doc_id, slot, caption, blob=b'IMG'):
    pid = photos.add_photo(doc_id, slot, ProcessedImage(image=blob + bytes([slot]), thumb=b'T' + bytes([slot]), width=10, height=20))
    with photos.db.connect() as conn:
        conn.execute('UPDATE pdm_photos SET caption=?, original_blob=? WHERE id=?', (caption, b'ORIG' + bytes([slot]), pid))


def sr_pair(db):
    src_header = {**sr_header(INFO_A, '김철수', TODAY), 'imoNo': '1234567', 'serialNo': 'S/N-A', 'subject': '총분해 수리',
                  'summary': ['1. 엔진 오바홀', '- CYL HEAD 취외복구'], 'remark': '비고 A', 'pageTitles': {'0': '분해'}, 'photosPerPage': 4}
    dst_header = {**sr_header(INFO_B, '이영희', TODAY), 'subject': '', 'summary': [], 'remark': ''}
    return make_doc(db, 'service_report', INFO_A, src_header, 'A 레포트'), make_doc(db, 'service_report', INFO_B, dst_header, 'B 레포트')


def test_merge_header_takes_content_but_keeps_order_info():
    src = {**sr_header(INFO_A, '김철수', TODAY), 'subject': 'S', 'summary': ['x'], 'remark': 'R', 'photosPerPage': 4}
    dst = {**sr_header(INFO_B, '이영희', TODAY), 'summary': ['old']}

    merged = merge_header('service_report', dst, src)

    assert (merged['subject'], merged['summary'], merged['remark'], merged['photosPerPage']) == ('S', ['x'], 'R', 4)
    for key in ('vesselName', 'orderNo', 'customer', 'model', 'location', 'period', 'date', 'reportedBy', 'imoNo', 'serialNo'):
        assert merged[key] == dst[key]
    assert dst['summary'] == ['old'] and merged['summary'] is not src['summary']          # 원본/현재 헤더는 그대로, 목록은 공유하지 않는다


def test_service_report_import_copies_content_and_photos_not_order_info(env):
    db, photos = env
    src_id, dst_id = sr_pair(db)
    add_photo(photos, src_id, 0, '캡션0')
    add_photo(photos, src_id, 3, '캡션3')
    add_photo(photos, dst_id, 1, '지워질 사진')
    expected = db.get_document(dst_id)['updatedAt']

    doc = import_document(db, photos, dst_id, expected, src_id, '이영희', '이영희')

    h = doc['header']
    assert h['summary'] == ['1. 엔진 오바홀', '- CYL HEAD 취외복구'] and h['remark'] == '비고 A' and h['subject'] == '총분해 수리'
    assert h['vesselName'] == 'B호' and h['orderNo'] == 'SH-2026-002-T' and h['customer'] == '나해운' and h['reportedBy'] == '이영희'
    assert doc['title'] == 'B 레포트' and doc['contractNumber'] == 'SH-2026-002-T' and doc['updatedBy'] == '이영희'
    assert doc['copiedPhotos'] == 2
    got = photos.list_photos(dst_id)
    assert [(p['slotIndex'], p['caption']) for p in got] == [(0, '캡션0'), (3, '캡션3')]       # 기존 사진은 대체됨
    assert len(photos.list_photos(src_id)) == 2                                                  # 원본은 그대로
    with db.connect() as conn:
        row = conn.execute('SELECT image_blob, thumb_blob, original_blob FROM pdm_photos WHERE doc_id=? AND slot_index=0', (dst_id,)).fetchone()
    assert (row['image_blob'], row['thumb_blob'], row['original_blob']) == (b'IMG\x00', b'T\x00', b'ORIG\x00')


def test_photo_album_import_keeps_cover_flag_and_order_info(env):
    db, photos = env
    src_id = make_doc(db, 'photo_album', INFO_A, {**photo_album.build_header(INFO_A, TODAY, with_cover=True), 'pageTitles': {'0': '장1'}, 'indexLines': ['INDEX 1']})
    dst_id = make_doc(db, 'photo_album', INFO_B, photo_album.build_header(INFO_B, TODAY, with_cover=False))
    add_photo(photos, src_id, 0, '사진')

    doc = import_document(db, photos, dst_id, db.get_document(dst_id)['updatedAt'], src_id, 'u', 'u')

    assert doc['header']['pageTitles'] == {'0': '장1'} and doc['header']['indexLines'] == ['INDEX 1']
    assert doc['header']['withCover'] is False and doc['header']['vesselName'] == 'B호'
    assert doc['copiedPhotos'] == 1


def test_measurement_import_copies_forms_but_not_header(env):
    db, photos = env
    form = measurement.default_instance('crankpin')
    form['gaugeNo'] = 'G-77'
    src_id = make_doc(db, 'measurement', INFO_A, {**measurement.build_header(INFO_A, '김철수', TODAY), 'forms': [form]})
    dst_id = make_doc(db, 'measurement', INFO_B, measurement.build_header(INFO_B, '이영희', TODAY))

    doc = import_document(db, photos, dst_id, db.get_document(dst_id)['updatedAt'], src_id, 'u', 'u')

    assert [f['gaugeNo'] for f in doc['header']['forms']] == ['G-77']
    assert doc['header']['workNo'] == 'SH-2026-002-T' and doc['header']['shipName'] == 'B호' and doc['header']['inspBy'] == '이영희'
    assert doc['copiedPhotos'] == 0


def test_conflict_leaves_photos_untouched(env):
    db, photos = env
    src_id, dst_id = sr_pair(db)
    add_photo(photos, src_id, 0, '원본')
    add_photo(photos, dst_id, 5, '내 사진')

    with pytest.raises(ConflictError):
        import_document(db, photos, dst_id, '1999-01-01 00:00:00.000', src_id, 'u', 'u')

    assert [p['caption'] for p in photos.list_photos(dst_id)] == ['내 사진']


def test_rejects_self_wrong_type_and_hidden_documents(env):
    db, photos = env
    src_id, dst_id = sr_pair(db)
    album_id = make_doc(db, 'photo_album', INFO_B, photo_album.build_header(INFO_B, TODAY, with_cover=False))
    private_id = db.create_document('service_report', 'SH-2026-003-T', 'C호', 'C', sr_header(INFO_A, 'x', TODAY), '다른 사람', private=True)
    ts = db.get_document(dst_id)['updatedAt']

    for source in (dst_id, album_id, private_id, 9999):
        with pytest.raises(ImportError_):
            import_document(db, photos, dst_id, ts, source, '이영희', '이영희')


def test_search_matches_contract_ship_or_title_same_type_only(env):
    db, _ = env
    src_id, dst_id = sr_pair(db)
    make_doc(db, 'photo_album', INFO_A, photo_album.build_header(INFO_A, TODAY, with_cover=False), 'A 사진첩')
    db.create_document('service_report', 'SH-2026-009-T', 'D호', 'D 임시', sr_header(INFO_A, 'x', TODAY), '다른 사람', private=True)

    by_ship = db.search_documents('service_report', 'A호', '이영희', exclude_id=dst_id)
    everything = db.search_documents('service_report', '', '이영희', exclude_id=dst_id)
    pct = db.search_documents('service_report', '%', '이영희')

    assert [d['id'] for d in by_ship] == [src_id]
    assert [d['id'] for d in everything] == [src_id]            # 자기 자신, 다른 종류, 남의 임시 문서는 제외
    assert pct == []                                              # % 는 와일드카드가 아니라 글자
