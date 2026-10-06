"""출력 양식 설정(layout) 검증 / 이미지 정규화 / 저장 테스트"""
import base64
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import pytest
from PIL import Image

from PDM.backend import layout as L
from PDM.backend.pdm_db import PdmDb
from PDM.backend.photo_service import PhotoError


def png_uri(w=300, h=200, mode='RGBA', color=(255, 0, 0, 128)) -> str:
    buf = io.BytesIO()
    Image.new(mode, (w, h), color).save(buf, 'PNG')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def test_defaults_when_nothing_saved():
    out = L.effective(None)
    assert out['photoFit'] == 'cover' and out['srTitle'] == 'Service report'
    assert out['logo'] is None and out['seal']['enabled'] is False and out['seal']['image'] is None


def test_validate_trims_and_limits_text():
    out = L.validate({'company': '  ACME  ', 'address': 'a' * 500, 'tel': '1', 'fax': '2', 'srTitle': 'T'})
    assert out['company'] == 'ACME' and len(out['address']) == L.MAX_TEXT_LEN


def test_validate_rejects_bad_photo_fit():
    with pytest.raises(ValueError):
        L.validate({'photoFit': 'stretch'})


def test_validate_seal_geometry_ranges():
    ok = L.validate({'seal': {'enabled': True, 'x': 84.4, 'y': 231.9, 'w': 38}})['seal']
    assert (ok['enabled'], ok['x'], ok['y'], ok['w']) == (True, 84.4, 231.9, 38.0)
    for bad in ({'x': -1}, {'x': 211}, {'y': 298}, {'w': 2}, {'w': 151}, {'x': 'abc'}):
        with pytest.raises(ValueError):
            L.validate({'seal': {'enabled': True, 'x': 10, 'y': 10, 'w': 30, **bad}})


def test_validate_image_is_reencoded_and_resized():
    out = L.validate({'logo': png_uri(3000, 1000), 'seal': {'enabled': True, 'x': 1, 'y': 1, 'w': 30, 'image': png_uri(400, 400)}})
    logo = Image.open(io.BytesIO(base64.b64decode(out['logo'].split(',', 1)[1])))
    assert logo.format == 'PNG' and max(logo.size) == L.LOGO_MAX_EDGE
    seal = Image.open(io.BytesIO(base64.b64decode(out['seal']['image'].split(',', 1)[1])))
    assert seal.mode == 'RGBA'                                     # 직인은 투명도 유지


def test_validate_rejects_non_image_and_oversized():
    with pytest.raises(PhotoError):
        L.validate({'logo': 'data:image/png;base64,' + base64.b64encode(b'not an image').decode()})
    with pytest.raises(PhotoError):
        L.validate({'logo': 'not a data uri'})


def test_effective_merges_overrides_over_defaults():
    saved = L.validate({'company': 'X Co.', 'photoFit': 'contain'})
    out = L.effective(saved)
    assert out['company'] == 'X Co.' and out['photoFit'] == 'contain' and out['tel'] == L.DEFAULTS['tel']


def test_db_roundtrip_and_overwrite(tmp_path):
    db = PdmDb(tmp_path / 'pdm.db')
    assert db.get_layout() is None
    db.save_layout({'company': 'A'}, '홍길동')
    db.save_layout({'company': 'B'}, '김철수')
    assert db.get_layout() == {'company': 'B'}
