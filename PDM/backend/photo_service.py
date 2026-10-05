"""사진 업로드 처리 — 디코드·검증·EXIF 회전·리사이즈·썸네일 (Pillow). 순수 함수."""
import base64
import binascii
import io
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_EDGE = 1600        # 저장 이미지 긴 변
THUMB_EDGE = 320       # 화면 목록용 썸네일 긴 변
MAX_BYTES = 30 * 1024 * 1024
JPEG_QUALITY = 80
THUMB_QUALITY = 72


class PhotoError(ValueError):
    """사용자에게 그대로 보여줄 수 있는 사진 처리 오류."""


@dataclass(frozen=True)
class ProcessedImage:
    image: bytes
    thumb: bytes
    width: int
    height: int


def decode_b64(data: str) -> bytes:
    """base64 또는 data URI → bytes. 크기 제한/형식 검증."""
    payload = data.split(',', 1)[1] if data.startswith('data:') else data
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        raise PhotoError('사진 데이터가 올바르지 않습니다.')
    if len(raw) > MAX_BYTES:
        raise PhotoError(f'사진이 너무 큽니다 (최대 {MAX_BYTES // 1024 // 1024}MB).')
    return raw


def _to_jpeg(img: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    img.save(buf, 'JPEG', quality=quality, optimize=True)
    return buf.getvalue()


def _flatten_rgb(img: Image.Image) -> Image.Image:
    """투명 배경은 흰색으로 합성 (JPEG 은 알파 불가)."""
    if img.mode in ('RGBA', 'LA', 'P'):
        rgba = img.convert('RGBA')
        bg = Image.new('RGB', rgba.size, (255, 255, 255))
        bg.paste(rgba, mask=rgba.split()[3])
        return bg
    return img.convert('RGB')


def process_image(raw: bytes) -> ProcessedImage:
    try:
        with Image.open(io.BytesIO(raw)) as src:
            img = ImageOps.exif_transpose(src)
            img = _flatten_rgb(img)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise PhotoError('이미지 파일이 아니거나 읽을 수 없는 형식입니다.')

    full = img.copy()
    full.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
    thumb = img.copy()
    thumb.thumbnail((THUMB_EDGE, THUMB_EDGE), Image.LANCZOS)
    return ProcessedImage(_to_jpeg(full, JPEG_QUALITY), _to_jpeg(thumb, THUMB_QUALITY), *full.size)


def resize_jpeg(data: bytes, max_edge: int) -> bytes:
    """긴 변이 max_edge 보다 크면 줄인 JPEG 반환. 이미 작거나 max_edge<=0 이면 원본 bytes 를 그대로 돌려준다."""
    if max_edge <= 0:
        return data
    try:
        with Image.open(io.BytesIO(data)) as src:
            if max(src.size) <= max_edge:
                return data
            img = src.convert('RGB')
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise PhotoError('이미지 파일이 아니거나 읽을 수 없는 형식입니다.')
    img.thumbnail((max_edge, max_edge), Image.LANCZOS)
    return _to_jpeg(img, 85)
