"""사진 처리(photo_service) / 슬롯 관리(photo_store) 테스트"""
import base64
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import pytest
from PIL import Image

from PDM.backend.pdm_db import PdmDb
from PDM.backend.photo_service import PhotoError, decode_b64, process_image
from PDM.backend.photo_store import MAX_SLOTS, PhotoStore, SlotOccupied


def make_png(w=3000, h=2000, mode='RGBA', fmt='PNG') -> bytes:
    buf = io.BytesIO()
    Image.new(mode, (w, h), (200, 30, 30, 128) if mode == 'RGBA' else (200, 30, 30)).save(buf, fmt)
    return buf.getvalue()


# ── photo_service ────────────────────────────────────────────────────────────

def test_process_downscales_long_edge_and_makes_thumb():
    out = process_image(make_png(3000, 2000))
    assert (out.width, out.height) == (1600, 1067)
    assert Image.open(io.BytesIO(out.image)).format == 'JPEG'
    assert max(Image.open(io.BytesIO(out.thumb)).size) == 320


def test_process_keeps_small_image_size():
    out = process_image(make_png(800, 600))
    assert (out.width, out.height) == (800, 600)


def test_process_applies_exif_orientation():
    img = Image.new('RGB', (400, 200), (10, 10, 10))
    exif = Image.Exif()
    exif[0x0112] = 6  # 90도 회전 필요
    buf = io.BytesIO()
    img.save(buf, 'JPEG', exif=exif)
    out = process_image(buf.getvalue())
    assert (out.width, out.height) == (200, 400)


def test_process_rejects_non_image():
    with pytest.raises(PhotoError):
        process_image(b'not an image at all')


def test_decode_b64_accepts_data_uri_and_rejects_garbage():
    raw = make_png(10, 10)
    b64 = base64.b64encode(raw).decode()
    assert decode_b64('data:image/png;base64,' + b64) == raw
    assert decode_b64(b64) == raw
    with pytest.raises(PhotoError):
        decode_b64('%%%not base64%%%')


def test_decode_b64_rejects_oversized(monkeypatch):
    monkeypatch.setattr('PDM.backend.photo_service.MAX_BYTES', 10)
    with pytest.raises(PhotoError):
        decode_b64(base64.b64encode(b'x' * 100).decode())


# ── photo_store ──────────────────────────────────────────────────────────────

@pytest.fixture
def store(tmp_path):
    db = PdmDb(tmp_path / 'pdm.db')
    doc_id = db.create_document('service_report', 'SH-1', 'S', 't', {}, 'u')
    return PhotoStore(db), doc_id


IMG = process_image(make_png(200, 100))


def slots(store_, doc_id):
    return {p['slotIndex']: p['id'] for p in store_.list_photos(doc_id)}


def fill(store_, doc_id, n):
    return [store_.add_photo(doc_id, i, IMG) for i in range(n)]


def test_add_and_list_ordered(store):
    s, doc = store
    s.add_photo(doc, 2, IMG)
    s.add_photo(doc, 0, IMG)
    assert [p['slotIndex'] for p in s.list_photos(doc)] == [0, 2]


def test_add_to_occupied_slot_raises(store):
    s, doc = store
    s.add_photo(doc, 0, IMG)
    with pytest.raises(SlotOccupied):
        s.add_photo(doc, 0, IMG)


def test_add_rejects_out_of_range_slot(store):
    s, doc = store
    with pytest.raises(ValueError):
        s.add_photo(doc, -1, IMG)
    with pytest.raises(ValueError):
        s.add_photo(doc, MAX_SLOTS, IMG)


def test_remove_with_pull_shifts_later_photos_forward(store):
    s, doc = store
    ids = fill(s, doc, 4)
    assert s.remove(doc, 1, pull=True) is True
    assert slots(s, doc) == {0: ids[0], 1: ids[2], 2: ids[3]}


def test_remove_keep_blank_leaves_gap(store):
    s, doc = store
    ids = fill(s, doc, 4)
    s.remove(doc, 1, pull=False)
    assert slots(s, doc) == {0: ids[0], 2: ids[2], 3: ids[3]}


def test_remove_empty_slot_is_noop(store):
    s, doc = store
    ids = fill(s, doc, 2)
    assert s.remove(doc, 5, pull=True) is False
    assert slots(s, doc) == {0: ids[0], 1: ids[1]}


def test_insert_blank_pushes_photos_back(store):
    s, doc = store
    ids = fill(s, doc, 3)
    s.insert_blank(doc, 1)
    assert slots(s, doc) == {0: ids[0], 2: ids[1], 3: ids[2]}


def test_insert_blank_on_empty_slot_still_shifts_later_photos(store):
    s, doc = store
    ids = fill(s, doc, 1)
    later = s.add_photo(doc, 5, IMG)
    s.insert_blank(doc, 3)
    assert slots(s, doc) == {0: ids[0], 6: later}


def test_insert_blank_cannot_push_past_max_slots(store):
    s, doc = store
    s.add_photo(doc, MAX_SLOTS - 1, IMG)
    with pytest.raises(ValueError):
        s.insert_blank(doc, 0)


def test_caption_roundtrip_and_images(store):
    s, doc = store
    pid = s.add_photo(doc, 0, IMG)
    s.set_caption(doc, pid, 'Turbo charger overhaul')
    assert s.list_photos(doc)[0]['caption'] == 'Turbo charger overhaul'
    assert s.get_image(pid) == IMG.image
    assert s.get_thumbs([pid])[pid] == IMG.thumb


def test_photos_are_scoped_per_document(store):
    s, doc = store
    other = s.db.create_document('service_report', 'SH-2', 'S', 't', {}, 'u')
    s.add_photo(doc, 0, IMG)
    s.add_photo(other, 0, IMG)
    assert len(s.list_photos(doc)) == 1 and len(s.list_photos(other)) == 1
    s.insert_blank(doc, 0)
    assert [p['slotIndex'] for p in s.list_photos(other)] == [0]


def test_set_caption_is_scoped_to_document(store):
    s, doc = store
    other = s.db.create_document('service_report', 'SH-2', 'S', 't', {}, 'u')
    pid = s.add_photo(doc, 0, IMG)
    assert s.set_caption(other, pid, 'hack') is False
    assert s.list_photos(doc)[0]['caption'] == ''
    assert s.set_caption(doc, pid, 'ok') is True


def test_touch_document_bumps_updated_at_and_user(store):
    s, doc = store
    before = s.db.get_document(doc)
    ts = s.db.touch_document(doc, '홍길동')
    after = s.db.get_document(doc)
    assert ts == after['updatedAt'] and ts > before['updatedAt'] and after['updatedBy'] == '홍길동'


# ── 인쇄용 축소 ──────────────────────────────────────────────────────────────

def test_resize_jpeg_limits_long_edge_keeps_aspect():
    from PDM.backend.photo_service import resize_jpeg
    big = process_image(make_png(3000, 2000)).image          # 1600x1067
    out = Image.open(io.BytesIO(resize_jpeg(big, 1000)))
    assert out.size == (1000, 667)


def test_resize_jpeg_returns_same_bytes_when_already_small_or_unlimited():
    from PDM.backend.photo_service import resize_jpeg
    small = process_image(make_png(800, 600)).image
    assert resize_jpeg(small, 1000) is small
    assert resize_jpeg(small, 0) is small


def test_resize_jpeg_rejects_garbage():
    from PDM.backend.photo_service import resize_jpeg
    with pytest.raises(PhotoError):
        resize_jpeg(b'nope', 500)


# ── 메모리 DoS 방어 ──────────────────────────────────────────────────────────

def test_rejects_image_with_too_many_pixels_before_decoding(monkeypatch):
    monkeypatch.setattr('PDM.backend.photo_service.MAX_PIXELS', 5000)
    big = make_png(100, 100, 'RGB')                       # 10,000 px > 5,000
    with pytest.raises(PhotoError):
        process_image(big)
    with pytest.raises(PhotoError):
        from PDM.backend.photo_service import resize_jpeg
        resize_jpeg(make_png(100, 100, 'RGB', 'JPEG'), 50)
    assert process_image(make_png(70, 70, 'RGB')).width == 70          # 4,900 px 는 통과


def test_asset_upload_also_enforces_pixel_limit(monkeypatch):
    from PDM.backend.photo_service import normalize_image_uri
    monkeypatch.setattr('PDM.backend.photo_service.MAX_PIXELS', 5000)
    uri = 'data:image/png;base64,' + base64.b64encode(make_png(100, 100, 'RGB')).decode()
    with pytest.raises(PhotoError):
        normalize_image_uri(uri, 800, keep_alpha=False)


def test_oversized_base64_is_rejected_before_it_is_decoded(monkeypatch):
    """디코딩(메모리 할당) 전에 문자열 길이로 먼저 거른다."""
    import PDM.backend.photo_service as ps
    monkeypatch.setattr(ps, 'MAX_BYTES', 30)
    called = []
    monkeypatch.setattr(ps.base64, 'b64decode', lambda *a, **k: called.append(1) or b'')
    with pytest.raises(PhotoError):
        ps.decode_b64('A' * 1000)
    assert not called


def test_decode_b64_requires_a_string():
    with pytest.raises(PhotoError):
        decode_b64(12345)
