"""세관서류(승선신고서/적재/하선/선용품 적재)와 소견서 PDF 저장소.

PDF 본체는 DB(BLOB)가 아니라 pdm.db 와 같은 폴더 아래 연도별 폴더에 파일로 둔다:
    <base_dir>/<연도>/<계약번호>/<종류>_<시각>_<난수>.pdf
DB(pdm_customs_files)에는 종류·원래 파일명·올린 사람·만료일 같은 메타데이터와 base_dir 기준 상대 경로만 기록한다.
"""
import base64
import binascii
import os
import re
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from PDM.backend.pdm_db import PdmDb

KINDS = {'boarding': '승선신고서', 'loading': '적재', 'unloading': '하선', 'ship_supplies': '선용품 적재', 'opinion': '소견서'}
CUSTOMS_KINDS = ('boarding', 'loading', 'unloading', 'ship_supplies')     # 통합조회의 세관서류 열 (소견서 제외)
LANG_KIND = 'opinion'                         # 국문/영문 구분을 기록하는 종류 (엑셀에서 작성해 PDF 로 올린다)
LANGS = {'ko': '국문', 'en': '영문'}
EXPIRY_KIND = 'boarding'                      # 만료일을 기록하는 종류
MAX_PDF_BYTES = 30 * 1024 * 1024
MAX_NAME_LEN = 120
MAX_NOTE_LEN = 200
_ISO_DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
_YEAR = re.compile(r'(?:^|-)((?:19|20)\d{2})(?:-|$)')
_UNSAFE = re.compile(r'[^0-9A-Za-z._-]')


class CustomsError(ValueError):
    """사용자에게 그대로 보여 줄 수 있는 입력 오류."""


def contract_year(contract_number: str, today: Optional[date] = None) -> int:
    """계약번호(SH-2026-206-T)의 연도. 없으면 오늘 연도."""
    m = _YEAR.search(contract_number or '')
    return int(m.group(1)) if m else (today or date.today()).year


def clean_file_name(name: str) -> str:
    base = os.path.basename((name or '').replace('\\', '/')).strip()
    if not base.lower().endswith('.pdf'):
        raise CustomsError('PDF 파일(.pdf)만 올릴 수 있습니다.')
    return base[:MAX_NAME_LEN]


def validate_pdf(data: bytes) -> None:
    if not data:
        raise CustomsError('빈 파일입니다.')
    if len(data) > MAX_PDF_BYTES:
        raise CustomsError(f'파일이 너무 큽니다 (최대 {MAX_PDF_BYTES // (1024 * 1024)}MB).')
    if not data.lstrip()[:5] == b'%PDF-':
        raise CustomsError('PDF 파일이 아닙니다.')


def decode_base64(text: str) -> bytes:
    if len(text or '') > MAX_PDF_BYTES * 4 // 3 + 16:
        raise CustomsError(f'파일이 너무 큽니다 (최대 {MAX_PDF_BYTES // (1024 * 1024)}MB).')
    try:
        return base64.b64decode(text or '', validate=True)
    except (binascii.Error, ValueError):
        raise CustomsError('파일 데이터가 올바르지 않습니다.')


def clean_expiry(kind: str, value: str) -> str:
    """승선신고서만 만료일(YYYY-MM-DD)을 기록한다. 다른 종류는 빈 값."""
    value = (value or '').strip()
    if kind != EXPIRY_KIND or not value:
        return ''
    if not _ISO_DATE.match(value):
        raise CustomsError('만료일은 YYYY-MM-DD 형식이어야 합니다.')
    try:
        datetime.strptime(value, '%Y-%m-%d')
    except ValueError:
        raise CustomsError('존재하지 않는 날짜입니다.')
    return value


def clean_lang(kind: str, value: str) -> str:
    """소견서만 국문(ko)/영문(en)을 기록한다. 다른 종류는 빈 값."""
    if kind != LANG_KIND:
        return ''
    value = (value or '').strip()
    if value not in LANGS:
        raise CustomsError('소견서의 언어(국문/영문)를 선택해 주세요.')
    return value


def _row(r) -> Dict[str, Any]:
    return {'id': r['id'], 'contractNumber': r['contract_number'], 'kind': r['kind'], 'kindLabel': KINDS.get(r['kind'], r['kind']),
            'fileName': r['file_name'], 'size': r['size_bytes'], 'expiryDate': r['expiry_date'], 'lang': r['lang'], 'langLabel': LANGS.get(r['lang'], ''), 'note': r['note'],
            'uploadedBy': r['uploaded_by'], 'uploadedAt': r['uploaded_at']}


class CustomsStore:
    def __init__(self, db: PdmDb, base_dir: Path):
        self.db = db
        self.base_dir = Path(base_dir)

    def _resolve(self, relative: str) -> Path:
        """DB 에 적힌 상대 경로 → 실제 경로. base_dir 밖이면 거부 (DB 가 변조돼도 다른 파일을 읽지 않게)."""
        base = self.base_dir.resolve()
        path = (base / relative).resolve()
        if base != path and base not in path.parents:
            raise CustomsError('잘못된 파일 경로입니다.')
        return path

    def add(self, contract_number: str, kind: str, file_name: str, data: bytes, user: str,
            expiry: str = '', note: str = '', lang: str = '') -> int:
        contract_number = (contract_number or '').strip()
        if not contract_number:
            raise CustomsError('계약번호가 없습니다.')
        if kind not in KINDS:
            raise CustomsError('알 수 없는 서류 종류입니다.')
        name = clean_file_name(file_name)
        validate_pdf(data)
        expiry = clean_expiry(kind, expiry)
        lang = clean_lang(kind, lang)
        relative = '/'.join([str(contract_year(contract_number)), _UNSAFE.sub('_', contract_number),
                             f"{kind}_{datetime.now():%Y%m%d%H%M%S}_{uuid.uuid4().hex[:6]}.pdf"])
        target = self._resolve(relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix('.tmp')
        tmp.write_bytes(data)
        os.replace(tmp, target)                        # 중간에 끊겨도 반쪽 파일이 남지 않게
        try:
            with self.db.connect() as conn:
                cur = conn.execute(
                    'INSERT INTO pdm_customs_files (contract_number, kind, file_name, stored_path, size_bytes, expiry_date, lang, note, uploaded_by, uploaded_at) '
                    "VALUES (?,?,?,?,?,?,?,?,?, datetime('now','localtime'))",
                    (contract_number, kind, name, relative, len(data), expiry, lang, (note or '')[:MAX_NOTE_LEN], user))
                return int(cur.lastrowid)
        except Exception:
            target.unlink(missing_ok=True)             # DB 기록이 실패하면 파일도 남기지 않는다
            raise

    def list_for(self, contract_number: str) -> List[Dict[str, Any]]:
        with self.db.connect() as conn:
            rows = conn.execute('SELECT * FROM pdm_customs_files WHERE contract_number = ? COLLATE NOCASE '
                                'ORDER BY uploaded_at DESC, id DESC', ((contract_number or '').strip(),)).fetchall()
        return [_row(r) for r in rows]

    def summary_for(self, contracts: List[str]) -> Dict[str, Dict[str, Any]]:
        """계약번호(대문자) → {'counts': {종류: 건수}, 'total': 전체 건수, 'boardingExpiry': 승선신고서 중 가장 늦은 만료일}. 서류가 없는 계약번호는 빠진다."""
        wanted = sorted({(c or '').strip().upper() for c in contracts if (c or '').strip()})
        out: Dict[str, Dict[str, Any]] = {}
        with self.db.connect() as conn:
            for i in range(0, len(wanted), 400):                      # SQLite 변수 개수 한도 안에서 나눠 조회
                chunk = wanted[i:i + 400]
                rows = conn.execute(
                    'SELECT upper(contract_number) AS cn, kind, COUNT(*) AS n, MAX(expiry_date) AS latest FROM pdm_customs_files '
                    f"WHERE upper(contract_number) IN ({','.join('?' * len(chunk))}) GROUP BY cn, kind", chunk).fetchall()
                for r in rows:
                    item = out.setdefault(r['cn'], {'counts': {}, 'total': 0, 'boardingExpiry': ''})
                    item['counts'][r['kind']] = r['n']
                    item['total'] += r['n']
                    if r['kind'] == EXPIRY_KIND:
                        item['boardingExpiry'] = r['latest'] or ''
        return out

    def boarding_expiries(self, until: str) -> List[Tuple[str, str]]:
        """승선신고서의 계약번호별 가장 늦은 만료일이 until(YYYY-MM-DD) 이하인 것 → [(계약번호, 만료일)]. 만료일이 없는 서류는 제외."""
        with self.db.connect() as conn:
            rows = conn.execute(
                'SELECT MAX(contract_number) AS cn, MAX(expiry_date) AS latest FROM pdm_customs_files '
                "WHERE kind = ? AND expiry_date != '' GROUP BY upper(contract_number) HAVING latest <= ? ORDER BY latest, cn",
                (EXPIRY_KIND, until)).fetchall()
        return [(r['cn'], r['latest']) for r in rows]

    def get(self, file_id: int) -> Optional[Dict[str, Any]]:
        with self.db.connect() as conn:
            r = conn.execute('SELECT * FROM pdm_customs_files WHERE id = ?', (file_id,)).fetchone()
        return _row(r) if r else None

    def read(self, file_id: int) -> Optional[Tuple[Dict[str, Any], bytes]]:
        with self.db.connect() as conn:
            r = conn.execute('SELECT * FROM pdm_customs_files WHERE id = ?', (file_id,)).fetchone()
        if r is None:
            return None
        path = self._resolve(r['stored_path'])
        if not path.is_file():
            raise CustomsError('저장된 파일을 찾을 수 없습니다. (파일이 이동되었거나 삭제됨)')
        return _row(r), path.read_bytes()

    def delete(self, file_id: int) -> bool:
        with self.db.connect() as conn:
            r = conn.execute('SELECT stored_path FROM pdm_customs_files WHERE id = ?', (file_id,)).fetchone()
            if r is None:
                return False
            conn.execute('DELETE FROM pdm_customs_files WHERE id = ?', (file_id,))
        self._resolve(r['stored_path']).unlink(missing_ok=True)     # 기록을 먼저 지우고 파일 삭제 (파일이 없어도 성공)
        return True
