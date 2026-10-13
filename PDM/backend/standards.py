"""엔진별 계측 표준값 — 목록(pdm_engine_standards), 엑셀 붙여넣기 가져오기, 엔진명 매칭, 계측지 자동 채움.

표준값 원본은 '계측 STANDARD.xlsx' 의 표준 시트(엔진 한 줄 = 한 행). 열 순서는 FIELDS 와 같고,
값은 현장에서 쓰던 그대로(문자열) 보관한다 — "±0.1", "65lb+90˚", "0.35~0.55" 같은 표기가 섞여 있어 숫자로 바꾸지 않는다.
계측지에는 칸에 들어갈 수 있는 값만 자동으로 넣고, 못 넣은 값은 notes 로 알려 준다.
"""
import json
import re
import sqlite3
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from PDM.backend.pdm_db import PdmDb

SEED_PATH = Path(__file__).resolve().parent / 'templates' / 'engine_standards.json'
MAX_VALUE_LEN = 60
MAX_CELL_LEN = 12           # 계측지 칸 한 개에 넣을 수 있는 글자 수 (measurement.MAX_CELL_LEN 과 같다)

# (키, 화면 이름, 묶음) — 엑셀 열(A~AP) 순서 그대로. maker/model 은 행의 이름표이고 나머지는 data 에 들어간다.
FIELDS: List[Tuple[str, str, str]] = [
    ('maker', 'MAKER', '엔진'), ('model', 'MODEL', '엔진'),
    ('crankpin_std', 'STANDARD', '크랭크핀 베어링'), ('crankpin_limit', 'LIMIT', '크랭크핀 베어링'), ('crankpin_n', '순번', '크랭크핀 베어링'),
    ('main_std', 'STANDARD', '메인저널'), ('main_limit', 'LIMIT', '메인저널'), ('main_n', '순번', '메인저널'),
    ('endplay', 'END PLAY Max', '크랭크샤프트'),
    ('block_bore', 'STANDARD', '실린더 블록'), ('block_n', '순번', '실린더 블록'), ('main_torque', '토크', '실린더 블록'),
    ('liner_std', 'LINER STANDARD', "실린더 라이너 & 피스톤"), ('liner_limit', 'LINER LIMIT', "실린더 라이너 & 피스톤"),
    ('piston_std', 'PISTON STANDARD', "실린더 라이너 & 피스톤"), ('piston_limit', 'PISTON LIMIT', "실린더 라이너 & 피스톤"),
    ('piston_n', '순번', "실린더 라이너 & 피스톤"),
    ('conrod_original', 'Original', '콘로드 빅엔드'), ('conrod_std', 'STANDARD', '콘로드 빅엔드'), ('conrod_limit', 'LIMIT', '콘로드 빅엔드'),
    ('conrod_n', '순번', '콘로드 빅엔드'), ('conrod_type', '타입', '콘로드 빅엔드'), ('conrod_torque', '체결 토크', '콘로드 빅엔드'),
    ('pin', 'PIN UNIT', '피스톤 핀 & 부시'), ('bush', 'BUSH UNIT', '피스톤 핀 & 부시'),
    ('cam_std', 'STANDARD', '캠샤프트'), ('cam_limit', 'LIMIT', '캠샤프트'), ('cam_n', '순번', '캠샤프트'), ('backlash', '기어 백래쉬', '캠샤프트'),
    ('ring1_std', '1st STD', '피스톤 링 홈 간극'), ('ring1_limit', '1st Limit', '피스톤 링 홈 간극'),
    ('ring2_std', '2nd STD', '피스톤 링 홈 간극'), ('ring2_limit', '2nd Limit', '피스톤 링 홈 간극'),
    ('ring3_std', '3rd STD', '피스톤 링 홈 간극'), ('ring3_limit', '3rd Limit', '피스톤 링 홈 간극'),
    ('oil_std', 'Oil STD', '피스톤 링 홈 간극'), ('oil_limit', 'Oil Limit', '피스톤 링 홈 간극'),
    ('head_torque', 'HEAD 토크', '토크/기타'), ('damper', 'Damper', '토크/기타'), ('flywheel', 'Flywheel', '토크/기타'),
    ('timing_gear', 'Timing gear', '토크/기타'), ('pulley', '크랭크 풀리', '토크/기타'),
]
DATA_KEYS = [k for k, _, _ in FIELDS if k not in ('maker', 'model')]
_COLUMN_KEYS = [k for k, _, _ in FIELDS]

# 엔진 문자열에서 흔히 줄여 쓰는 제조사명 → 표준값 시트의 제조사명
_MAKER_ALIASES = {'CAT': 'CATERPILLAR', 'CUM': 'CUMMINS', 'DD': 'DETROIT', 'DETROIT': 'DETROIT', 'MHI': 'MITSUBISHI'}
_TOKEN = re.compile(r'[A-Z]+|\d+(?:\.\d+)?|[가-힣]+')

SCHEMA = '''
CREATE TABLE IF NOT EXISTS pdm_engine_standards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    maker TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL,
    data_json TEXT NOT NULL DEFAULT '{}',
    updated_by TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pdm_engine_standards_key ON pdm_engine_standards(upper(maker), upper(model));
CREATE TABLE IF NOT EXISTS pdm_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
'''


# ── 값 정리 / 엑셀 붙여넣기 해석 ──────────────────────────────────────────────

def clean_value(value: Any) -> str:
    """셀 값 → 문자열. 엑셀 부동소수 찌꺼기(96.10199999999999)는 소수 4자리로 정리한다."""
    if value is None:
        return ''
    if isinstance(value, float):
        return f'{value:.4f}'.rstrip('0').rstrip('.') if value == value else ''
    return str(value).strip()[:MAX_VALUE_LEN]


def _is_header_row(cells: List[str]) -> bool:
    model = cells[1].strip().upper() if len(cells) > 1 else ''
    return model in ('', 'MODEL') or cells[0].strip().upper() in ('MAKER', '엔진모델')


def parse_rows(text: str) -> List[Dict[str, Any]]:
    """엑셀에서 복사한 탭/줄바꿈 텍스트 → [{maker, model, data}]. 열 순서는 FIELDS 와 같다 (머리글 줄은 건너뜀)."""
    rows = []
    for line in str(text).replace('\r', '').split('\n'):
        cells = line.split('\t')
        if len(cells) < 2 or _is_header_row(cells):
            continue
        values = [clean_value(c) for c in cells] + [''] * (len(_COLUMN_KEYS) - len(cells))
        item = dict(zip(_COLUMN_KEYS, values))
        rows.append({'maker': item.pop('maker'), 'model': item.pop('model'), 'data': {k: v for k, v in item.items() if v}})
    return rows


def normalize_row(raw: Dict[str, Any]) -> Dict[str, Any]:
    """저장 전 검증: 모델명 필수, 알 수 없는 키는 버림, 값은 문자열."""
    model = clean_value(raw.get('model'))
    if not model:
        raise ValueError('엔진 모델을 입력하세요.')
    data_in = raw.get('data') if isinstance(raw.get('data'), dict) else {}
    data = {k: clean_value(data_in.get(k)) for k in DATA_KEYS}
    return {'maker': clean_value(raw.get('maker')), 'model': model, 'data': {k: v for k, v in data.items() if v}}


# ── 엔진명 매칭 ───────────────────────────────────────────────────────────────

def _tokens(text: str) -> List[str]:
    return _TOKEN.findall(str(text or '').upper())


def _contains(haystack: List[str], needle: List[str]) -> bool:
    n = len(needle)
    return n > 0 and any(haystack[i:i + n] == needle for i in range(len(haystack) - n + 1))


def _maker_tokens(maker: str) -> List[str]:
    return [_MAKER_ALIASES.get(t, t) for t in _tokens(maker)]


def match_engine(engine: str, rows: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    """작업현황의 엔진 문자열(예: 'CUMMINS KTA38', 'CAT 3512') → 표준값 행.

    모델 토큰(글자/숫자 단위로 쪼갠 것)이 엔진 문자열 안에 연달아 들어 있어야 한다.
    숫자만으로 된 모델(180, 222, 2366 …)은 엉뚱한 엔진과 겹치기 쉬워 제조사도 함께 맞아야 한다.
    가장 긴 모델명이 이기고, 같은 길이로 둘 이상 남으면 고르지 않는다 (candidates 로만 알림).
    반환 {'standard': 행|None, 'candidates': [행…]}
    """
    engine_tokens = [_MAKER_ALIASES.get(t, t) for t in _tokens(engine)]
    scored = []
    for row in rows:
        model_tokens = _tokens(row['model'])
        if not _contains(engine_tokens, model_tokens):
            continue
        maker_ok = bool(row['maker']) and _contains(engine_tokens, _maker_tokens(row['maker']))
        if all(t.replace('.', '').isdigit() for t in model_tokens) and not maker_ok:
            continue
        scored.append((len(model_tokens) * 2 + (1 if maker_ok else 0), row))
    if not scored:
        return {'standard': None, 'candidates': []}
    best = max(s for s, _ in scored)
    top = [row for s, row in scored if s == best]
    return {'standard': top[0] if len(top) == 1 else None, 'candidates': top}


# ── 계측지 자동 채움 ──────────────────────────────────────────────────────────
# 양식 id → 채울 칸. spec: {규격 id: (표준 키, 한계 키)}, base: {표 id: 키}(Unit 기준값), extra: {입력 필드: 키}(콘로드 등)
FILL_MAP: Dict[str, Dict[str, Dict[str, Any]]] = {
    'crankpin': {'spec': {'primary': ('crankpin_std', 'crankpin_limit')}, 'base': {'outDia': 'crankpin_std'}},
    'mainjournal': {'spec': {'primary': ('main_std', 'main_limit')}, 'base': {'outDia': 'main_std'}},
    'conrod': {'extra': {'original': 'conrod_original', 'std': 'conrod_std', 'limit': 'conrod_limit', 'torque': 'conrod_torque'}},
    'linerpiston': {'spec': {'liner': ('liner_std', 'liner_limit'), 'piston': ('piston_std', 'piston_limit')},
                    'base': {'linerDia': 'liner_std', 'pistonDia': 'piston_std'}},
    'pistonpin': {'base': {'pinDia': 'pin', 'bossBush': 'bush'}},
    'camshaft': {'spec': {'primary': ('cam_std', 'cam_limit')}, 'base': {'outDia': 'cam_std'}},
}
_NUMERIC = re.compile(r'^-?\d+(?:\.\d+)?$')
_NUMERIC_ONLY = ('base', 'torque')      # Unit 기준값/체결 토크 칸은 숫자만 (글자가 섞인 표기는 notes 로)
_LABELS = {k: f'{g} {l}' for k, l, g in FIELDS}


def fill_patch(form_id: str, data: Dict[str, str]) -> Dict[str, Any]:
    """표준값 → 계측지 한 장에 넣을 값 {spec, unitBase, original/std/limit/torque, notes}. 매핑이 없는 양식(사용자 정의)은 빈 patch."""
    plan = FILL_MAP.get(form_id, {})
    patch: Dict[str, Any] = {'spec': {}, 'unitBase': {}}
    notes: List[str] = []

    def take(key: str, numeric: bool) -> Optional[str]:
        value = data.get(key, '')
        if not value:
            return None
        if len(value) > MAX_CELL_LEN or (numeric and not _NUMERIC.match(value)):
            notes.append(f'{_LABELS[key]}: {value}')
            return None
        return value

    for spec_id, (std_key, limit_key) in plan.get('spec', {}).items():
        entry = {k: v for k, v in (('standard', take(std_key, False)), ('limit', take(limit_key, False))) if v is not None}
        if entry:
            patch['spec'][spec_id] = entry
    for table_id, key in plan.get('base', {}).items():
        value = take(key, True)
        if value is not None:
            patch['unitBase'][table_id] = value
    for field, key in plan.get('extra', {}).items():
        value = take(key, field in _NUMERIC_ONLY)
        if value is not None:
            patch[field] = value
    patch['notes'] = list(dict.fromkeys(notes))
    return patch


def apply_patch(instance: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    """계측지 한 장(instance)에 fill_patch 결과를 반영한 새 dict. 측정값(표 안의 값)은 건드리지 않는다."""
    out = {**instance}
    if 'spec' in instance:
        out['spec'] = {sid: {**vals, **patch['spec'].get(sid, {})} for sid, vals in instance['spec'].items()}
    if 'unitBase' in instance:
        out['unitBase'] = {tid: patch['unitBase'].get(tid, base) for tid, base in instance['unitBase'].items()}
    for field in ('original', 'std', 'limit', 'torque'):
        if field in instance and field in patch:
            out[field] = patch[field]
    return out


# ── 저장소 ────────────────────────────────────────────────────────────────────

def _row(record) -> Dict[str, Any]:
    return {'id': record['id'], 'maker': record['maker'], 'model': record['model'], 'data': json.loads(record['data_json'] or '{}')}


class StandardsStore:
    def __init__(self, db: PdmDb):
        self._db = db
        with db.connect() as conn:
            conn.executescript(SCHEMA)
        self._seed_once()

    def _seed_once(self) -> None:
        """처음 한 번만 번들된 표준값(engine_standards.json)을 넣는다. 이후 수정/삭제는 DB 가 기준 (다시 덮어쓰지 않음)."""
        with self._db.connect() as conn:
            conn.execute('BEGIN IMMEDIATE')       # 두 PC 가 동시에 처음 열어도 한 번만 시드 (쓰기 잠금 후 확인)
            if conn.execute("SELECT 1 FROM pdm_meta WHERE key = 'standards_seeded'").fetchone():
                return
            if SEED_PATH.exists():
                seed = json.loads(SEED_PATH.read_text(encoding='utf-8'))
                conn.executemany('INSERT INTO pdm_engine_standards (maker, model, data_json, updated_by) VALUES (?,?,?,?)',
                                 [(r['maker'], r['model'], json.dumps(r['data'], ensure_ascii=False), '초기값') for r in seed['rows']])
            conn.execute("INSERT INTO pdm_meta (key, value) VALUES ('standards_seeded', '1')")

    def list(self) -> List[Dict[str, Any]]:
        with self._db.connect() as conn:
            return [_row(r) for r in conn.execute('SELECT * FROM pdm_engine_standards ORDER BY maker, model, id')]

    @staticmethod
    def _write(conn: sqlite3.Connection, row: Dict[str, Any], user: str, row_id: Optional[int]) -> int:
        blob = json.dumps(row['data'], ensure_ascii=False)
        try:
            if row_id is None:
                return int(conn.execute('INSERT INTO pdm_engine_standards (maker, model, data_json, updated_by) VALUES (?,?,?,?)',
                                        (row['maker'], row['model'], blob, user)).lastrowid)
            cur = conn.execute("UPDATE pdm_engine_standards SET maker=?, model=?, data_json=?, updated_by=?, "
                               "updated_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE id=?", (row['maker'], row['model'], blob, user, row_id))
        except sqlite3.IntegrityError:
            raise ValueError(f"이미 같은 엔진({row['maker']} {row['model']})이 등록되어 있습니다.")
        if cur.rowcount == 0:
            raise ValueError('수정할 표준값을 찾을 수 없습니다. 목록을 새로 고치세요.')
        return row_id

    def save(self, raw: Dict[str, Any], user: str, row_id: Optional[int] = None) -> Dict[str, Any]:
        row = normalize_row(raw)
        with self._db.connect() as conn:
            return {**row, 'id': self._write(conn, row, user, row_id)}

    def delete(self, row_id: int) -> None:
        with self._db.connect() as conn:
            conn.execute('DELETE FROM pdm_engine_standards WHERE id = ?', (row_id,))

    def import_rows(self, rows: List[Dict[str, Any]], user: str) -> Dict[str, int]:
        """붙여넣은 행을 반영: 같은 제조사+모델이 있으면 값을 갱신(붙여넣은 값이 있는 칸만 덮어씀), 없으면 추가.
        한 트랜잭션이라 중간에 실패하면 아무것도 반영되지 않는다."""
        added = updated = 0
        with self._db.connect() as conn:
            existing = {(r['maker'].upper(), r['model'].upper()): _row(r) for r in conn.execute('SELECT * FROM pdm_engine_standards')}
            for raw in rows:
                row = normalize_row(raw)
                key = (row['maker'].upper(), row['model'].upper())
                found = existing.get(key)
                if found:
                    merged = {**row, 'data': {**found['data'], **row['data']}}
                    self._write(conn, merged, user, found['id'])
                    existing[key] = {**found, **merged}
                    updated += 1
                else:
                    existing[key] = {**row, 'id': self._write(conn, row, user, None)}
                    added += 1
        return {'added': added, 'updated': updated}

    def match(self, engine: str) -> Dict[str, Any]:
        return match_engine(engine, self.list())
