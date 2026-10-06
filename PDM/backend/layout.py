"""출력 양식 설정 — 로고/회사 정보/제목/사진 채움 방식/직인. 모든 사용자가 같은 설정을 쓴다 (pdm_print_templates).

DB 에는 사용자가 바꾼 값만 저장하고, 없는 값은 DEFAULTS 로 채운다. 이미지는 null 이면 화면의 내장 기본 이미지(로고/직인)를 쓴다.
"""
from typing import Any, Dict, Optional

from PDM.backend.photo_service import normalize_image_uri

MAX_TEXT_LEN = 100
LOGO_MAX_EDGE = 1200
SEAL_MAX_EDGE = 800
PHOTO_FITS = ('cover', 'contain')

DEFAULTS: Dict[str, Any] = {
    'company': 'SUNJIN JONGHAP Co.,Ltd.',
    'address': '#3, 41 Daepyoeng ro, Yeongdo-gu, Busan,',
    'tel': '+82 51 414 7300',
    'fax': '+82 51 414 8870',
    'srTitle': 'Service report',
    'photoFit': 'cover',
    'logo': None,
    'seal': {'enabled': False, 'image': None, 'x': 84.4, 'y': 231.9, 'w': 38.2},   # 원본 양식의 직인 위치/크기(mm)
}
_TEXT_KEYS = ('company', 'address', 'tel', 'fax', 'srTitle')
_SEAL_RANGES = {'x': (0.0, 210.0), 'y': (0.0, 297.0), 'w': (5.0, 150.0)}


def _text(value: Any, default: str) -> str:
    return default if value is None else str(value).strip()[:MAX_TEXT_LEN]


def _seal(raw: Any) -> Dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    base = DEFAULTS['seal']
    out: Dict[str, Any] = {'enabled': bool(raw.get('enabled', False))}
    for key, (lo, hi) in _SEAL_RANGES.items():
        try:
            value = float(raw.get(key, base[key]))
        except (TypeError, ValueError):
            raise ValueError(f'직인 {key} 값이 숫자가 아닙니다.')
        if not lo <= value <= hi:
            raise ValueError(f'직인 {key} 값은 {lo:g}~{hi:g} 범위여야 합니다.')
        out[key] = round(value, 1)
    out['image'] = normalize_image_uri(raw['image'], SEAL_MAX_EDGE, keep_alpha=True) if raw.get('image') else None
    return out


def validate(raw: Dict[str, Any]) -> Dict[str, Any]:
    """저장 전 검증/정리. 잘못된 값은 ValueError/PhotoError."""
    out: Dict[str, Any] = {key: _text(raw.get(key), DEFAULTS[key]) for key in _TEXT_KEYS}
    fit = raw.get('photoFit', DEFAULTS['photoFit'])
    if fit not in PHOTO_FITS:
        raise ValueError('사진 채움 방식은 cover 또는 contain 이어야 합니다.')
    out['photoFit'] = fit
    out['logo'] = normalize_image_uri(raw['logo'], LOGO_MAX_EDGE, keep_alpha=False) if raw.get('logo') else None
    out['seal'] = _seal(raw.get('seal'))
    return out


def effective(saved: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """저장된 값(없을 수 있음)을 기본값 위에 얹은 최종 설정."""
    saved = saved or {}
    merged = {**DEFAULTS, **{k: v for k, v in saved.items() if k != 'seal'}}
    merged['seal'] = {**DEFAULTS['seal'], **(saved.get('seal') or {})}
    return merged
