"""계측지: 항목 정의(templates/measurement_forms.json) 로딩, 기본 입력 구조, 서버측 정규화.

문서 헤더(header_json)에 공통 항목과 선택된 양식 목록(header['forms'], 출력 순서)이 들어간다.
셀 값은 모두 문자열(빈칸 허용) — 음수/소수 표기를 그대로 보존하고, 모양(행·열 수)은 정의에 맞춰 보정한다.
"""
import json
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

TEMPLATE_PATH = Path(__file__).resolve().parent / 'templates' / 'measurement_forms.json'
MAX_CELL_LEN = 12
MAX_TEXT_LEN = 100
MAX_REMARKS_LEN = 2000
PHASES = ('', 'before', 'after')
COMMON_TEXT_KEYS = ('workNo', 'inspDate', 'owner', 'shipName', 'inspBy', 'apprBy', 'makerType', 'coverEngine', 'coverShip')


@lru_cache(maxsize=1)
def _builtin_forms() -> List[Dict[str, Any]]:
    with open(TEMPLATE_PATH, encoding='utf-8') as f:
        return [{**form, 'builtin': True} for form in json.load(f)['forms']]


_custom_provider: Optional[Callable[[], List[Dict[str, Any]]]] = None


def set_custom_provider(provider: Optional[Callable[[], List[Dict[str, Any]]]]) -> None:
    """사용자 정의 양식을 돌려주는 함수 등록 (런타임이 DB 연결 후 한 번 호출). None 이면 내장 양식만."""
    global _custom_provider
    _custom_provider = provider


def load_templates() -> List[Dict[str, Any]]:
    """내장 양식 → 사용자 정의 양식 순."""
    custom = _custom_provider() if _custom_provider else []
    return [*_builtin_forms(), *custom]


def _forms_by_id() -> Dict[str, Dict[str, Any]]:
    return {form['id']: form for form in load_templates()}


def _form(form_id: str) -> Dict[str, Any]:
    try:
        return _forms_by_id()[form_id]
    except KeyError:
        raise ValueError(f'알 수 없는 계측 양식: {form_id}')


def _check_side(form: Dict[str, Any], side: str) -> None:
    if side not in form['sides']:
        raise ValueError(f"{form['id']} 양식에 없는 구분입니다: {side}")


def _blank_grid(rows: int, cols: int) -> List[List[str]]:
    return [[''] * cols for _ in range(rows)]


def default_instance(form_id: str, side: str) -> Dict[str, Any]:
    """양식 하나(예: 크랭크핀 PORT)의 빈 입력 구조. 규격·기준값은 정의의 기본값."""
    form = _form(form_id)
    _check_side(form, side)
    return _blank_instance(form, side)


def preview_instance(form: Dict[str, Any]) -> Dict[str, Any]:
    """저장 전 양식 초안(id 없을 수 있음)의 첫 구분 기준 빈 입력 구조 — 양식 관리 미리보기용."""
    return _blank_instance(form, form['sides'][0])


def _blank_instance(form: Dict[str, Any], side: str) -> Dict[str, Any]:
    base = {'formId': form.get('id', ''), 'side': side, 'phase': '', 'gaugeNo': ''}
    if form['layout'] == 'conrodGrid':
        cols = len(form['positions']) * len(form['subColumns'])
        return {**base, **form['defaults'], 'rowLabels': list(form['defaultRowLabels']),
                'cells': _blank_grid(form['rowCount'], cols)}
    return {
        **base,
        'spec': {s['id']: {'standard': s['standard'], 'limit': s['limit']} for s in form['spec']},
        'unitBase': {t['id']: t['unit']['base'] for t in form['tables'] if t['unit']},
        'tables': {t['id']: _blank_grid(len(t['rows']), t['cols']) for t in form['tables']},
        'remarks': '',
    }


def build_header(info: Dict[str, Any], inspector: str, today: date) -> Dict[str, Any]:
    """작업현황 정보로 계측지 공통 헤더를 채운다 (선택된 양식은 비어 있음)."""
    return {
        'workNo': info.get('contractNumber', ''), 'inspDate': today.isoformat(),
        'owner': info.get('company', ''), 'shipName': info.get('shipName', ''),
        'inspBy': inspector, 'apprBy': '', 'makerType': info.get('engineModel', ''),
        'coverEngine': info.get('engineModel', ''), 'coverShip': info.get('shipName', ''),
        'forms': [],
    }


# ── 정규화 ───────────────────────────────────────────────────────────────────

def _text(value: Any, limit: int) -> str:
    return ('' if value is None else str(value)).strip()[:limit]


def _grid(value: Any, rows: int, cols: int) -> List[List[str]]:
    """행/열 수를 정의에 맞추고(부족하면 빈칸, 넘치면 버림) 각 셀을 정리한 문자열로."""
    src = value if isinstance(value, list) else []
    out = []
    for r in range(rows):
        row = src[r] if r < len(src) and isinstance(src[r], list) else []
        out.append([_text(row[c], MAX_CELL_LEN) if c < len(row) else '' for c in range(cols)])
    return out


def _normalize_instance(raw: Dict[str, Any]) -> Dict[str, Any]:
    form = _form(_text(raw.get('formId'), MAX_TEXT_LEN))
    side = _text(raw.get('side'), MAX_TEXT_LEN)
    default = default_instance(form['id'], side)
    out = {'formId': form['id'], 'side': side,
           'phase': raw.get('phase') if raw.get('phase') in PHASES else '',
           'gaugeNo': _text(raw.get('gaugeNo'), MAX_TEXT_LEN)}
    if form['layout'] == 'conrodGrid':
        labels = raw.get('rowLabels') if isinstance(raw.get('rowLabels'), list) else default['rowLabels']
        out['rowLabels'] = [_text(labels[i], MAX_CELL_LEN) if i < len(labels) else '' for i in range(form['rowCount'])]
        out['cells'] = _grid(raw.get('cells'), form['rowCount'], len(form['positions']) * len(form['subColumns']))
        for key, dflt in form['defaults'].items():
            out[key] = _text(raw[key], MAX_CELL_LEN) if key in raw else dflt
        return out
    spec_in = raw.get('spec') if isinstance(raw.get('spec'), dict) else {}
    out['spec'] = {sid: {k: _text((spec_in.get(sid) or {}).get(k, v), MAX_CELL_LEN) for k, v in vals.items()}
                   for sid, vals in default['spec'].items()}
    base_in = raw.get('unitBase') if isinstance(raw.get('unitBase'), dict) else {}
    out['unitBase'] = {tid: _text(base_in.get(tid, v), MAX_CELL_LEN) for tid, v in default['unitBase'].items()}
    tables_in = raw.get('tables') if isinstance(raw.get('tables'), dict) else {}
    out['tables'] = {t['id']: _grid(tables_in.get(t['id']), len(t['rows']), t['cols']) for t in form['tables']}
    out['remarks'] = _text(raw.get('remarks'), MAX_REMARKS_LEN)
    return out


def normalize_header(header: Dict[str, Any]) -> Dict[str, Any]:
    """저장 전 검증/정리. 알 수 없는 양식·구분, 중복 항목은 ValueError."""
    out = {k: _text(header.get(k), MAX_TEXT_LEN) for k in COMMON_TEXT_KEYS}
    forms, seen = [], set()
    for raw in header.get('forms') or []:
        if not isinstance(raw, dict):
            raise ValueError('계측 항목 형식이 올바르지 않습니다.')
        inst = _normalize_instance(raw)
        key = (inst['formId'], inst['side'])
        if key in seen:
            raise ValueError(f'같은 계측 항목이 중복되었습니다: {key[0]} {key[1]}')
        seen.add(key)
        forms.append(inst)
    out['forms'] = forms
    return out
