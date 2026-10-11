"""사용자 정의 계측 양식 (크랭크핀형 격자: 규격표 + F/A x TB/PS 표 최대 3개 + Remarks). 서버측 검증. 장 수·장 구분(PORT/1호기…)은 문서에서 정한다.

화면에서 입력한 '단순 정의'(rowsKind, unitBase/unitOp, role …)를 measurement.py 가 쓰는 양식 구조로 정규화한다.
내장 양식(measurement_forms.json)은 읽기 전용이고, 사용자 정의 양식만 DB(pdm_form_templates)에 저장된다.
"""
import secrets
from typing import Any, Dict, List

from PDM.backend.photo_service import normalize_image_uri

DIAGRAM_MAX_EDGE = 1200
MAX_TABLES = 3
MAX_SPEC = 2
MAX_COLS = 8
ROLES = ('plain', 'outer', 'inner', 'clearance')
UNIQUE_ROLES = ('outer', 'inner', 'clearance')          # 자동 계산이 의존하므로 양식당 최대 1개
ROWS_BY_KIND = {'FA_TBPS': [['F', 'TB'], ['F', 'PS'], ['A', 'TB'], ['A', 'PS']], 'FA': [['F'], ['A']]}
SPEC_IDS = ('primary', 'clearance')


def new_custom_id() -> str:
    return 'custom_' + secrets.token_hex(4)


def _text(value: Any, name: str, limit: int, required: bool = False) -> str:
    out = ('' if value is None else str(value)).strip()[:limit]
    if required and not out:
        raise ValueError(f'{name}을(를) 입력하세요.')
    return out


def _spec(raw: Any) -> List[Dict[str, str]]:
    rows = raw if isinstance(raw, list) else []
    if not 1 <= len(rows) <= MAX_SPEC:
        raise ValueError(f'규격 행은 1~{MAX_SPEC}개여야 합니다.')
    return [{'id': SPEC_IDS[i], 'label': _text(r.get('label'), '규격 이름', 40, required=True),
             'standard': _text(r.get('standard'), 'STANDARD', 12), 'limit': _text(r.get('limit'), 'LIMIT', 12)}
            for i, r in enumerate(rows)]


def _table(index: int, t: Dict[str, Any]) -> Dict[str, Any]:
    role, kind = t.get('role', 'plain'), t.get('rowsKind')
    if role not in ROLES:
        raise ValueError(f'알 수 없는 표 종류: {role}')
    if kind not in ROWS_BY_KIND:
        raise ValueError('행 구성은 F/A x TB/PS 또는 F/A 여야 합니다.')
    if role in ('outer', 'inner') and kind != 'FA_TBPS':
        raise ValueError('외경/안지름 표는 행 구성이 F/A x TB/PS 여야 합니다 (클리어런스 자동 계산 때문).')
    if role == 'clearance' and kind != 'FA':
        raise ValueError('클리어런스 표는 행 구성이 F/A 여야 합니다.')
    try:
        cols = int(t.get('cols'))
    except (TypeError, ValueError):
        raise ValueError('열 수가 숫자가 아닙니다.')
    if not 1 <= cols <= MAX_COLS:
        raise ValueError(f'열 수는 1~{MAX_COLS}개여야 합니다.')
    unit = {'base': _text(t.get('unitBase'), '기준값', 12), 'op': t['unitOp']} if t.get('unitOp') in ('+', '-') else None
    return {'id': f't{index + 1}', 'title': _text(t.get('title'), '표 제목', 50, required=True),
            'colLabel': _text(t.get('colLabel'), '열 이름', 24), 'cols': cols,
            'rows': [list(r) for r in ROWS_BY_KIND[kind]], 'role': role, 'unit': unit}


def _tables(raw: Any) -> List[Dict[str, Any]]:
    rows = raw if isinstance(raw, list) else []
    if not 1 <= len(rows) <= MAX_TABLES:
        raise ValueError(f'표는 1~{MAX_TABLES}개여야 합니다.')
    tables = [_table(i, t) for i, t in enumerate(rows)]
    roles = [t['role'] for t in tables]
    for role in UNIQUE_ROLES:
        if roles.count(role) > 1:
            raise ValueError(f'"{role}" 종류의 표는 한 양식에 하나만 둘 수 있습니다.')
    return tables


def validate_definition(raw: Dict[str, Any]) -> Dict[str, Any]:
    """화면에서 받은 정의 → 저장/사용 가능한 양식 dict (id 는 저장할 때 부여)."""
    title = _text(raw.get('title'), '출력 제목', 60, required=True)
    image = raw.get('diagramImage')
    return {
        'label': _text(raw.get('label'), '이름', 40, required=True), 'title': title,
        'indexTitle': _text(raw.get('indexTitle'), '표지 목차 제목', 60) or title.replace('&', '').replace('  ', ' ').strip(),
        'code': _text(raw.get('code'), '양식 번호', 40), 'layout': 'journalGrid', 'diagram': '',
        'diagramImage': normalize_image_uri(image, DIAGRAM_MAX_EDGE, keep_alpha=False) if image else None,
        'spec': _spec(raw.get('spec')), 'tables': _tables(raw.get('tables')), 'custom': True,
    }
