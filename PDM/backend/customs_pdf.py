"""승선신고서 PDF 에서 만료일(승선기간 끝날짜) 등을 읽는다. 읽지 못하면 빈 값 — 호출하는 쪽이 직접 입력을 받는다.

글자가 들어 있는 PDF(세관 시스템 출력본)만 읽을 수 있다. 스캔 이미지는 읽지 않는다.
의존: pypdf (설치본 또는 vendor\ — 둘 다 없으면 빈 값을 돌려주고 경고만 남긴다)
"""
import io
import logging
import re
from datetime import datetime
from typing import Dict, Optional

logger = logging.getLogger(__name__)
MAX_PAGES = 3                     # 신고수리서는 1장. 이상한 대용량 PDF 를 끝까지 읽지 않는다
_DATE = r'(\d{4})\s*(?:년|[.\-/])\s*(\d{1,2})\s*(?:월|[.\-/])\s*(\d{1,2})\s*일?'
_PERIOD = re.compile(r'승\s*선\s*기\s*간\s*' + _DATE + r'\s*[~∼～\-]\s*' + _DATE)
_REPORT_NO = re.compile(r'신\s*고\s*번\s*호\s*[:：]?\s*([0-9A-Za-z\-]+)')
_SHIP = re.compile(r'선\s*명\s+([^\s]+)')


def _iso(y: str, m: str, d: str) -> str:
    try:
        return datetime(int(y), int(m), int(d)).strftime('%Y-%m-%d')
    except ValueError:
        return ''


def parse_boarding_text(text: str) -> Dict[str, str]:
    """PDF 에서 뽑은 글자 → {'expiryDate', 'startDate', 'reportNo', 'shipName'} (찾은 것만)."""
    found: Dict[str, str] = {}
    period = _PERIOD.search(text or '')
    if period:
        start = _iso(*period.group(1, 2, 3))
        end = _iso(*period.group(4, 5, 6))
        if end and (not start or start <= end):                 # 끝날짜가 시작보다 앞이면 잘못 읽은 것
            found['expiryDate'] = end
            if start:
                found['startDate'] = start
    report = _REPORT_NO.search(text or '')
    if report:
        found['reportNo'] = report.group(1)
    ship = _SHIP.search(text or '')
    if ship:
        found['shipName'] = ship.group(1)
    return found


def extract_text(data: bytes) -> str:
    try:
        from PDM.backend.pypdf_loader import load_pdf_reader
        PdfReader = load_pdf_reader()
    except ImportError:
        logger.warning('pypdf 가 없어 PDF 글자를 읽지 못합니다.')
        return ''
    reader = PdfReader(io.BytesIO(data))
    return '\n'.join((page.extract_text() or '') for page in reader.pages[:MAX_PAGES])


def read_boarding_info(data: bytes) -> Dict[str, str]:
    """승선신고서 PDF 바이트 → 읽은 정보. 어떤 이유로든 실패하면 빈 dict (예외를 밖으로 내지 않는다)."""
    try:
        return parse_boarding_text(extract_text(data))
    except Exception:
        logger.warning('승선신고서 PDF 를 읽지 못했습니다.', exc_info=True)
        return {}
