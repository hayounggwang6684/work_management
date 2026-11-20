"""세관서류 PDF 저장소 / API 테스트"""
import base64
import sqlite3
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
sys.modules.setdefault('eel', types.SimpleNamespace(expose=lambda f: f))

import pytest

from PDM.backend import adapters, customs, customs_api, runtime
from PDM.backend import api as pdm_api  # noqa: F401  (customs_api 등록 경로 확인)
from PDM.backend.customs import CustomsError, CustomsStore
from PDM.backend.pdm_db import PdmDb

PDF = b'%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n'
CONTRACT = 'SH-2026-206-T'


@pytest.fixture
def store(tmp_path):
    return CustomsStore(PdmDb(tmp_path / 'pdm.db'), tmp_path / 'customs')


@pytest.fixture
def api_env(tmp_path, monkeypatch):
    work = tmp_path / 'work.db'
    conn = sqlite3.connect(work)
    conn.execute('CREATE TABLE work_records (date TEXT, record_number INT, contract_number TEXT, '
                 'company TEXT, ship_name TEXT, engine_model TEXT, location TEXT)')
    conn.execute("INSERT INTO work_records VALUES ('2026-11-16', 1, ?, '세안해운', 'SS T 7', 'AD196TI', '')", (CONTRACT,))
    conn.commit()
    conn.close()
    monkeypatch.setenv('PDM_WORK_DB_PATH', str(work))
    monkeypatch.setenv('PDM_DB_PATH', str(tmp_path / 'pdm.db'))
    monkeypatch.setattr(runtime, '_db', None)
    monkeypatch.setattr(customs_api, '_store', None)
    return tmp_path


def b64(data=PDF):
    return base64.b64encode(data).decode()


def as_user(monkeypatch, name, admin=False):
    monkeypatch.setattr(adapters, 'get_current_user', lambda: {'full_name': name})
    monkeypatch.setattr(adapters, 'can_manage_templates', lambda user=None: admin)


# ── 저장소 ────────────────────────────────────────────────────────────────

def test_add_stores_pdf_under_year_and_contract_folder(store, tmp_path):
    fid = store.add(CONTRACT, 'loading', 'a.pdf', PDF, '김철수')

    row, data = store.read(fid)
    assert data == PDF and row['kindLabel'] == '적재' and row['uploadedBy'] == '김철수'
    files = list((tmp_path / 'customs' / '2026' / CONTRACT).glob('loading_*.pdf'))
    assert len(files) == 1


def test_many_files_per_kind_are_allowed(store):
    ids = {store.add(CONTRACT, 'boarding', 'a.pdf', PDF, 'u') for _ in range(3)}

    assert len(ids) == 3 and len(store.list_for(CONTRACT)) == 3
    assert len(store.list_for(CONTRACT.lower())) == 3            # 계약번호 대소문자 무시


@pytest.mark.parametrize('name,data,message', [
    ('a.txt', PDF, 'PDF 파일'), ('a.pdf', b'hello', 'PDF 파일이 아닙니다'), ('a.pdf', b'', '빈 파일')])
def test_rejects_invalid_files(store, name, data, message):
    with pytest.raises(CustomsError, match=message):
        store.add(CONTRACT, 'loading', name, data, 'u')
    assert store.list_for(CONTRACT) == []


def test_rejects_oversized_file(store):
    with pytest.raises(CustomsError, match='너무 큽니다'):
        store.add(CONTRACT, 'loading', 'a.pdf', b'%PDF-' + b'0' * customs.MAX_PDF_BYTES, 'u')
    assert store.list_for(CONTRACT) == []


def test_rejects_unknown_kind_and_empty_contract(store):
    with pytest.raises(CustomsError):
        store.add(CONTRACT, 'passport', 'a.pdf', PDF, 'u')
    with pytest.raises(CustomsError):
        store.add('  ', 'loading', 'a.pdf', PDF, 'u')


def test_expiry_only_for_boarding_and_validated(store):
    a = store.add(CONTRACT, 'boarding', 'a.pdf', PDF, 'u', expiry='2026-11-23')
    b = store.add(CONTRACT, 'loading', 'b.pdf', PDF, 'u', expiry='2026-11-23')

    assert store.get(a)['expiryDate'] == '2026-11-23' and store.get(b)['expiryDate'] == ''
    for bad in ('2026-13-01', '23/11/2026', '2026-02-30'):
        with pytest.raises(CustomsError):
            store.add(CONTRACT, 'boarding', 'c.pdf', PDF, 'u', expiry=bad)


def test_file_name_path_parts_are_dropped_and_stored_name_is_generated(store, tmp_path):
    fid = store.add(CONTRACT, 'loading', '..\\..\\evil/../승선.pdf', PDF, 'u')

    assert store.get(fid)['fileName'] == '승선.pdf'
    assert all(p.is_relative_to(tmp_path / 'customs') for p in (tmp_path / 'customs').rglob('*.pdf'))


def test_delete_removes_record_and_file(store, tmp_path):
    fid = store.add(CONTRACT, 'loading', 'a.pdf', PDF, 'u')

    assert store.delete(fid) is True
    assert store.get(fid) is None and not list((tmp_path / 'customs').rglob('*.pdf'))
    assert store.delete(fid) is False


def test_read_refuses_path_outside_base_dir(store):
    fid = store.add(CONTRACT, 'loading', 'a.pdf', PDF, 'u')
    with store.db.connect() as conn:
        conn.execute("UPDATE pdm_customs_files SET stored_path = '../pdm.db' WHERE id = ?", (fid,))

    with pytest.raises(CustomsError, match='잘못된'):
        store.read(fid)


def test_read_reports_missing_file(store, tmp_path):
    fid = store.add(CONTRACT, 'loading', 'a.pdf', PDF, 'u')
    next((tmp_path / 'customs').rglob('*.pdf')).unlink()

    with pytest.raises(CustomsError, match='찾을 수 없'):
        store.read(fid)


def test_contract_year_falls_back_to_current_year():
    from datetime import date
    assert customs.contract_year('SH-2026-206-T') == 2026
    assert customs.contract_year('XYZ', today=date(2027, 1, 2)) == 2027


# ── API ──────────────────────────────────────────────────────────────────

def test_api_upload_list_download_roundtrip(api_env, monkeypatch):
    as_user(monkeypatch, '김철수')

    up = customs_api.pdm_customs_upload(CONTRACT, 'boarding', 'x.pdf', b64(), '2026-11-23')
    assert up['success'] and up['file']['expiryDate'] == '2026-11-23'

    listed = customs_api.pdm_customs_list(CONTRACT)['files']
    assert len(listed) == 1 and listed[0]['canDelete'] is True
    got = customs_api.pdm_customs_get_file(listed[0]['id'])
    assert base64.b64decode(got['data']) == PDF and got['fileName'] == 'x.pdf'
    assert (api_env / 'customs' / '2026' / CONTRACT).is_dir()                # pdm.db 와 같은 폴더 아래


def test_api_upload_requires_existing_work_contract(api_env, monkeypatch):
    as_user(monkeypatch, '김철수')

    r = customs_api.pdm_customs_upload('SH-2026-999-T', 'loading', 'x.pdf', b64())

    assert r['success'] is False and '작업현황' in r['message']


def test_api_upload_rejects_bad_base64_and_non_pdf(api_env, monkeypatch):
    as_user(monkeypatch, '김철수')

    assert customs_api.pdm_customs_upload(CONTRACT, 'loading', 'x.pdf', '###')['success'] is False
    assert customs_api.pdm_customs_upload(CONTRACT, 'loading', 'x.pdf', b64(b'not pdf'))['success'] is False


def test_api_delete_only_by_uploader_or_admin(api_env, monkeypatch):
    as_user(monkeypatch, '김철수')
    fid = customs_api.pdm_customs_upload(CONTRACT, 'loading', 'x.pdf', b64())['file']['id']

    as_user(monkeypatch, '이영희')
    assert customs_api.pdm_customs_list(CONTRACT)['files'][0]['canDelete'] is False
    denied = customs_api.pdm_customs_delete(fid)
    assert denied['success'] is False and '올린 사람' in denied['message']

    as_user(monkeypatch, '관리자', admin=True)
    assert customs_api.pdm_customs_delete(fid)['success'] is True
    assert customs_api.pdm_customs_list(CONTRACT)['files'] == []


def test_api_uploader_can_delete_own_file(api_env, monkeypatch):
    as_user(monkeypatch, '김철수')
    fid = customs_api.pdm_customs_upload(CONTRACT, 'loading', 'x.pdf', b64())['file']['id']

    assert customs_api.pdm_customs_delete(fid)['success'] is True


def test_api_functions_are_guarded():
    assert customs_api.pdm_customs_upload.__pdm_tier__ == 'write'
    assert customs_api.pdm_customs_delete.__pdm_tier__ == 'write'
    assert customs_api.pdm_customs_list.__pdm_tier__ == 'login'
    assert customs_api.pdm_customs_get_file.__pdm_tier__ == 'login'


# ── 승선신고서 만료일 읽기 ────────────────────────────────────────────────

from PDM.backend import customs_pdf  # noqa: E402

BOARDING_TEXT = ('승선 신고(수리)서 처리기간\n즉   시신고번호 : 2026-6018131019-U0138\n선     명 ANIVA 호출부호 UFPQ\n'
                 '승선기간 2026년 11월 16일 ~ 2026년 11월 23일\n승선사유\n')


def make_text_pdf(text: str) -> bytes:
    """한글 글자가 든 최소 PDF (실제 세관 출력본처럼 UniKS-UCS2-H 인코딩, 글꼴 미내장)."""
    lines = ''.join(f'1 0 0 1 50 {780 - i * 20} Tm <{line.encode("utf-16-be").hex()}> Tj\n' for i, line in enumerate(text.splitlines()))
    content = f'BT /F1 10 Tf\n{lines}ET'.encode('latin1')
    objs = [b'<</Type/Catalog/Pages 2 0 R>>', b'<</Type/Pages/Kids[3 0 R]/Count 1>>',
            b'<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
            b'<</Length %d>>\nstream\n' % len(content) + content + b'\nendstream',
            b'<</Type/Font/Subtype/Type0/BaseFont/Batang/Encoding/UniKS-UCS2-H/DescendantFonts[6 0 R]>>',
            b'<</Type/Font/Subtype/CIDFontType2/BaseFont/Batang/CIDSystemInfo<</Registry(Adobe)/Ordering(Korea1)/Supplement 1>>>>']
    out = b'%PDF-1.7\n'
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += b'%d 0 obj\n' % i + o + b'\nendobj\n'
    xref_at = len(out)
    out += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1)
    out += b''.join(b'%010d 00000 n \n' % off for off in offsets)
    return out + b'trailer\n<</Root 1 0 R/Size %d>>\nstartxref\n%d\n%%%%EOF\n' % (len(objs) + 1, xref_at)


def test_parse_boarding_text_reads_period_end_as_expiry():
    info = customs_pdf.parse_boarding_text(BOARDING_TEXT)

    assert info == {'expiryDate': '2026-11-23', 'startDate': '2026-11-16', 'reportNo': '2026-6018131019-U0138', 'shipName': 'ANIVA'}


@pytest.mark.parametrize('text,expected', [
    ('승선기간 2026.11.16 ~ 2026.12.02', '2026-12-02'),
    ('승 선 기 간 2026-11-16 ~ 2027-01-05', '2027-01-05'),
    ('승선기간 2026년 11월 16일 ~ 2026년 2월 30일', ''),         # 존재하지 않는 날짜
    ('승선기간 2026년 11월 23일 ~ 2026년 11월 16일', ''),        # 끝이 시작보다 앞
    ('승선사유 업무수행', '')])
def test_parse_boarding_text_variants(text, expected):
    assert customs_pdf.parse_boarding_text(text).get('expiryDate', '') == expected


def test_read_boarding_info_from_pdf_bytes():
    assert customs_pdf.read_boarding_info(make_text_pdf(BOARDING_TEXT))['expiryDate'] == '2026-11-23'


def test_read_boarding_info_never_raises_on_bad_input():
    assert customs_pdf.read_boarding_info(b'%PDF-1.4 garbage') == {}
    assert customs_pdf.read_boarding_info(b'') == {}


def test_api_upload_autofills_expiry_for_boarding_only(api_env, monkeypatch):
    as_user(monkeypatch, '김철수')
    pdf = make_text_pdf(BOARDING_TEXT)

    boarding = customs_api.pdm_customs_upload(CONTRACT, 'boarding', 'a.pdf', b64(pdf))
    loading = customs_api.pdm_customs_upload(CONTRACT, 'loading', 'b.pdf', b64(pdf))
    manual = customs_api.pdm_customs_upload(CONTRACT, 'boarding', 'c.pdf', b64(pdf), '2026-12-31')

    assert boarding['file']['expiryDate'] == '2026-11-23'
    assert loading['file']['expiryDate'] == ''
    assert manual['file']['expiryDate'] == '2026-12-31'           # 사용자가 고친 값이 우선


def test_api_inspect_returns_info_without_saving(api_env, monkeypatch):
    as_user(monkeypatch, '김철수')

    r = customs_api.pdm_customs_inspect('boarding', b64(make_text_pdf(BOARDING_TEXT)))

    assert r['success'] and r['info']['expiryDate'] == '2026-11-23'
    assert customs_api.pdm_customs_list(CONTRACT)['files'] == []
    assert customs_api.pdm_customs_inspect('boarding', b64(b'nope'))['success'] is False
    assert customs_api.pdm_customs_inspect('loading', b64())['info'] == {}


# ── 목록용 요약 ──────────────────────────────────────────────────────────

def test_summary_counts_by_kind_and_latest_boarding_expiry(store):
    store.add(CONTRACT, 'boarding', 'a.pdf', PDF, 'u', expiry='2026-11-23')
    store.add(CONTRACT, 'boarding', 'b.pdf', PDF, 'u', expiry='2026-12-05')
    store.add(CONTRACT, 'loading', 'c.pdf', PDF, 'u')

    s = store.summary_for([CONTRACT.lower(), 'SH-2026-999-T'])

    assert s[CONTRACT] == {'counts': {'boarding': 2, 'loading': 1}, 'total': 3, 'boardingExpiry': '2026-12-05'}
    assert 'SH-2026-999-T' not in s


def test_summary_handles_many_contracts(store):
    assert store.summary_for([f'SH-2026-{i:04d}-T' for i in range(1000)]) == {}


def test_list_projects_includes_customs_summary(api_env, monkeypatch):
    as_user(monkeypatch, '김철수')
    customs_api.pdm_customs_upload(CONTRACT, 'boarding', 'a.pdf', b64(), '2026-11-23')

    r = pdm_api.pdm_list_projects('2026-11-01', '2026-11-30')

    p = next(x for x in r['projects'] if x['contractNumber'] == CONTRACT)
    assert p['customs'] == {'counts': {'boarding': 1}, 'total': 1} and p['boardingExpiry'] == '2026-11-23'


# ── 소견서 (엑셀에서 작성해 PDF 로 올림, 국문/영문 구분) ────────────────────

def test_opinion_requires_language_and_stores_it(store):
    with pytest.raises(CustomsError, match='언어'):
        store.add(CONTRACT, 'opinion', 'o.pdf', PDF, 'u')
    with pytest.raises(CustomsError, match='언어'):
        store.add(CONTRACT, 'opinion', 'o.pdf', PDF, 'u', lang='fr')

    fid = store.add(CONTRACT, 'opinion', 'o.pdf', PDF, 'u', lang='en')

    assert store.get(fid)['lang'] == 'en' and store.get(fid)['langLabel'] == '영문' and store.get(fid)['kindLabel'] == '소견서'


def test_language_is_ignored_for_customs_kinds(store):
    fid = store.add(CONTRACT, 'loading', 'a.pdf', PDF, 'u', lang='ko')

    assert store.get(fid)['lang'] == ''


def test_api_upload_opinion_and_old_db_gets_lang_column(api_env, monkeypatch):
    as_user(monkeypatch, '김철수')
    r = customs_api.pdm_customs_upload(CONTRACT, 'opinion', 'o.pdf', b64(), '', '', 'ko')
    assert r['success'] and r['file']['langLabel'] == '국문'
    assert customs_api.pdm_customs_upload(CONTRACT, 'opinion', 'o.pdf', b64())['success'] is False


def test_migration_adds_lang_to_a_database_created_before_it_existed(tmp_path):
    path = tmp_path / 'pdm.db'
    conn = sqlite3.connect(path)
    conn.execute('CREATE TABLE pdm_customs_files (id INTEGER PRIMARY KEY, contract_number TEXT, kind TEXT, file_name TEXT, stored_path TEXT, '
                 "size_bytes INT, expiry_date TEXT DEFAULT '', note TEXT DEFAULT '', uploaded_by TEXT DEFAULT '', uploaded_at TEXT DEFAULT '')")
    conn.commit()
    conn.close()

    db = PdmDb(path)

    with db.connect() as c:
        assert 'lang' in {r['name'] for r in c.execute('PRAGMA table_info(pdm_customs_files)')}
