"""사진 편집본 저장 / 원본 보존 / 복원 테스트"""
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import pytest
from PIL import Image

from PDM.backend.pdm_db import PdmDb
from PDM.backend.photo_service import process_image
from PDM.backend.photo_store import PhotoStore


def png(color, w=400, h=300) -> bytes:
    buf = io.BytesIO()
    Image.new('RGB', (w, h), color).save(buf, 'PNG')
    return buf.getvalue()


@pytest.fixture
def ctx(tmp_path):
    db = PdmDb(tmp_path / 'pdm.db')
    doc = db.create_document('service_report', 'SH-1', 'S', 't', {}, 'u')
    store = PhotoStore(db)
    pid = store.add_photo(doc, 0, process_image(png((0, 0, 255))))
    return store, doc, pid


def test_replace_image_keeps_original_and_updates_size_and_thumb(ctx):
    store, doc, pid = ctx
    before = store.get_image(pid)
    new = process_image(png((255, 0, 0), 200, 100))
    assert store.replace_image(doc, pid, new) is True
    assert store.get_image(pid) == new.image
    assert store.get_original(doc, pid) == before
    meta = store.list_photos(doc)[0]
    assert (meta['width'], meta['height'], meta['edited']) == (200, 100, True)
    assert store.get_thumbs([pid])[pid] == new.thumb


def test_second_edit_does_not_overwrite_first_original(ctx):
    store, doc, pid = ctx
    original = store.get_image(pid)
    store.replace_image(doc, pid, process_image(png((255, 0, 0))))
    store.replace_image(doc, pid, process_image(png((0, 255, 0))))
    assert store.get_original(doc, pid) == original


def test_replace_image_is_scoped_to_document(ctx):
    store, doc, pid = ctx
    other = store.db.create_document('service_report', 'SH-2', 'S', 't', {}, 'u')
    assert store.replace_image(other, pid, process_image(png((255, 0, 0)))) is False
    assert store.list_photos(doc)[0]['edited'] is False


def test_restore_original_brings_back_image_and_clears_edited(ctx):
    store, doc, pid = ctx
    original = store.get_image(pid)
    store.replace_image(doc, pid, process_image(png((255, 0, 0), 100, 50)))
    restored = process_image(store.get_original(doc, pid))
    assert store.restore_original(doc, pid, restored.thumb, restored.width, restored.height) is True
    assert store.get_image(pid) == original
    meta = store.list_photos(doc)[0]
    assert meta['edited'] is False and (meta['width'], meta['height']) == (400, 300)
    assert store.get_original(doc, pid) is None


def test_restore_without_edit_is_noop(ctx):
    store, doc, pid = ctx
    assert store.restore_original(doc, pid, b'x', 1, 1) is False
