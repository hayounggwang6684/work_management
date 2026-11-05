"""문서 헤더 정규화에 쓰는 공용 도구 — 서비스레포트/부품사진첩/DB 가 한 곳을 본다."""
import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict

ENGINE_NAMES_PATH = Path(__file__).resolve().parent / 'templates' / 'engine_names.json'
MAX_TEXT_LEN = 100
MAX_PAGE_TITLES = 100            # 사진 페이지 번호 0 ~ 99
PHOTOS_PER_PAGE_CHOICES = (6, 4)  # 6장 = 세로 2x3, 4장 = 가로 2x2


def text(value: Any, limit: int) -> str:
    return ('' if value is None else str(value)).strip()[:limit]


def page_titles(raw: Any) -> Dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    out = {}
    for key, value in raw.items():
        if str(key).isdigit() and int(key) < MAX_PAGE_TITLES and text(value, MAX_TEXT_LEN):
            out[str(int(key))] = text(value, MAX_TEXT_LEN)
    return out


def photos_per_page(raw: Any) -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return PHOTOS_PER_PAGE_CHOICES[0]
    return value if value in PHOTOS_PER_PAGE_CHOICES else PHOTOS_PER_PAGE_CHOICES[0]


# ── 엔진 제조사 약어 → 풀네임 (작업현황에는 CUM', CAT 처럼 줄여 적는다) ───────────────────
# 약어 맵의 단일 원본은 templates/engine_names.json — 출력 화면(JS)도 pdm_get_layout 으로 같은 맵을 받는다.
@lru_cache(maxsize=1)
def engine_names() -> Dict[str, str]:
    with open(ENGINE_NAMES_PATH, encoding='utf-8') as f:
        return {str(k).upper(): str(v) for k, v in json.load(f).items()}


@lru_cache(maxsize=1)
def _abbr_pattern() -> 're.Pattern':
    return re.compile(r"\b(" + '|'.join(re.escape(k) for k in engine_names()) + r")\b['’.]?", re.IGNORECASE)


def expand_engine(value: str) -> str:
    """엔진 문자열의 제조사 약어를 풀네임으로 (예: "CUM' KTA19" → "CUMMINS KTA19"). 이미 풀네임이면 그대로."""
    return _abbr_pattern().sub(lambda m: engine_names()[m.group(1).upper()], value or '')
