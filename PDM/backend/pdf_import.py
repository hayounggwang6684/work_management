"""이 앱이 만든 서비스레포트/부품사진첩 PDF 를 읽어 문서 내용(헤더 칸, 작업 요약, 비고, 사진과 캡션)으로 되돌린다.

글자와 사진의 PDF 좌표를 쓴다: 사진 위치로 칸 번호를, 사진 바로 아래 글자로 캡션을 짝짓는다.
다른 프로그램으로 만든 PDF/스캔본은 양식이 달라 읽지 못한다 — PdfImportError(사용자에게 보여 줄 문장)를 낸다.
의존: pypdf (설치본 또는 vendor\)
"""
import io
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

MM = 72 / 25.4
MAX_PAGES = 120
MIN_PHOTO_EDGE = 200                  # 이보다 작은 이미지(로고/직인)는 사진이 아니다
LINE_TOLERANCE = 2.5                  # 같은 줄로 보는 y 차이 (pt)
FOOTER_MM = 19.7                      # 푸터(회사/주소/쪽번호)가 차지하는 아래쪽 높이 — 출력 배치(print_logic.js PHOTO_GEOMETRY)와 같다

# 사진 페이지 배치 (mm) — print_logic.js 의 PHOTO_GEOMETRY 와 같은 값
GEOMETRY = {
    6: {'page': (210, 297), 'photo': (70.4, 53.2), 'cols': (24.8, 114.2), 'rows': (40.8, 122.7, 204.6)},
    4: {'page': (297, 210), 'photo': (80, 60), 'cols': (53.5, 163.5), 'rows': (40, 114)},
}
HEADER_LABELS = {                         # 서비스레포트 첫 장 라벨 → 헤더 키 (sr_fields.js 와 같음)
    'Name of vessel': 'vesselName', 'IMO No.': 'imoNo', 'Engine Type': 'engineType', 'S/N': 'serialNo', 'Model': 'model', 'Date': 'date',
    'Order No.': 'orderNo', 'Reported by': 'reportedBy', 'Customer': 'customer', 'Requested by': 'requestedBy', 'Location': 'location',
    'Period': 'period', 'Subject': 'subject',
}
_LABEL_RE = re.compile(r'(?:(?<=\s)|^)(' + '|'.join(re.escape(k) for k in sorted(HEADER_LABELS, key=len, reverse=True)) + r')(?=\s|$)')


class PdfImportError(ValueError):
    """사용자에게 그대로 보여 줄 수 있는 PDF 읽기 오류."""


@dataclass
class Fragment:
    text: str
    x: float
    y: float


@dataclass
class Image:
    data: bytes
    x: float
    y: float
    w: float
    h: float


@dataclass
class Page:
    width: float
    height: float
    fragments: List[Fragment] = field(default_factory=list)
    images: List[Image] = field(default_factory=list)


@dataclass
class ParsedPhoto:
    data: bytes
    slot: int
    caption: str


@dataclass
class Parsed:
    header: Dict[str, Any]
    photos: List[ParsedPhoto]
    per_page: int


def _mul(a, b):
    return [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
            a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]]


def read_pages(data: bytes) -> List[Page]:
    """PDF → 쪽별 글자 조각(좌표)과 사진(좌표). 읽을 수 없으면 PdfImportError."""
    try:
        from PDM.backend.pypdf_loader import load_pdf_reader
        PdfReader = load_pdf_reader()
    except ImportError:
        raise PdfImportError('PDF 를 읽는 구성요소(pypdf)가 설치되어 있지 않습니다.')
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise PdfImportError('암호가 걸린 PDF 는 읽을 수 없습니다.')
        total = len(reader.pages)
        if total == 0 or total > MAX_PAGES:
            raise PdfImportError(f'PDF 쪽수가 올바르지 않습니다 ({total}쪽, 최대 {MAX_PAGES}쪽).')
        return [_read_page(p) for p in reader.pages]
    except PdfImportError:
        raise
    except Exception as e:
        raise PdfImportError(f'PDF 를 열 수 없습니다 ({type(e).__name__}).')


def _read_page(pg) -> Page:
    width, height = float(pg.mediabox.width), float(pg.mediabox.height)
    page = Page(width, height)
    placed: Dict[str, Tuple[float, float, float, float]] = {}

    def on_text(text, cm, tm, font_dict, font_size):
        if text and text.strip():
            m = _mul(tm, cm)
            page.fragments.append(Fragment(text, m[4], m[5]))

    def on_op(op, args, cm, tm):
        if op == b'Do' and args:
            placed.setdefault(str(args[0]).lstrip('/'), (cm[4], cm[5], abs(cm[0]), abs(cm[3])))

    pg.extract_text(visitor_text=on_text, visitor_operand_before=on_op)
    for img in pg.images:
        stem = img.name.rsplit('.', 1)[0]
        if stem in placed and img.name.lower().endswith(('.jpg', '.jpeg')):         # 사진은 JPEG, 로고/직인은 PNG
            x, y, w, h = placed[stem]
            if min(_size(img)) >= MIN_PHOTO_EDGE:
                page.images.append(Image(img.data, x, y, w, h))
    return page


def _size(img) -> Tuple[int, int]:
    try:
        return img.image.size
    except Exception:
        return (0, 0)


def to_lines(fragments: List[Fragment]) -> List[Tuple[float, str]]:
    """글자 조각 → 줄 [(y, 글) …] (위에서 아래로). 같은 줄의 조각은 x 순으로 공백으로 잇고 연속 공백은 하나로."""
    lines: List[List[Fragment]] = []
    for f in sorted(fragments, key=lambda f: -f.y):
        if lines and abs(lines[-1][0].y - f.y) <= LINE_TOLERANCE:
            lines[-1].append(f)
        else:
            lines.append([f])
    out = []
    for row in lines:
        text = re.sub(r'\s+', ' ', ' '.join(f.text for f in sorted(row, key=lambda f: f.x))).strip()
        if text:
            out.append((row[0].y, text))
    return out


def _body_lines(page: Page) -> List[str]:
    """푸터(회사/주소/쪽번호)를 뺀 본문 줄."""
    limit = FOOTER_MM * MM
    return [t for y, t in to_lines(page.fragments) if y > limit]


# ── 사진 ────────────────────────────────────────────────────────────────

def _nearest(value: float, options: Tuple[float, ...]) -> int:
    return min(range(len(options)), key=lambda i: abs(options[i] - value))


def _per_page(page: Page) -> int:
    return 4 if page.width > page.height else 6


def parse_photo_page(page: Page, per_page: int) -> Tuple[str, List[Tuple[int, bytes, str]]]:
    """사진 쪽 하나 → (챕터 제목, [(쪽 안 칸 번호, 사진 바이트, 캡션)])."""
    geo = GEOMETRY[per_page]
    if _per_page(page) != per_page:
        raise PdfImportError('사진 페이지의 크기(세로/가로)가 서로 다릅니다.')
    photos = []
    for img in page.images:
        col = _nearest(img.x / MM, geo['cols'])
        row = _nearest((page.height - (img.y + img.h)) / MM, geo['rows'])
        photos.append((row * 2 + col, img))
    # 캡션: 사진 바로 아래에서 가장 가까운 글 (같은 칸의 x 범위). 제목: 첫 줄 사진보다 위. 푸터는 제외.
    caption_of: Dict[int, List[Fragment]] = {}
    title: List[Fragment] = []
    top_limit = page.height - geo['rows'][0] * MM
    footer_limit = FOOTER_MM * MM
    for f in page.fragments:
        if f.y <= footer_limit:
            continue
        if f.y > top_limit:
            title.append(f)
            continue
        above = [(i, im) for i, im in enumerate(img for _, img in photos) if im.x - 2 <= f.x <= im.x + im.w + 2 and im.y >= f.y]
        if above:
            idx, _ = min(above, key=lambda p: p[1].y - f.y)
            caption_of.setdefault(idx, []).append(f)
    result = []
    for idx, (slot, img) in enumerate(photos):
        caption = ' '.join(t for _, t in to_lines(caption_of.get(idx, [])))
        result.append((slot, img.data, caption))
    return ' '.join(t for _, t in to_lines(title)), sorted(result, key=lambda r: r[0])


def parse_photos(pages: List[Page]) -> Tuple[Dict[str, str], List[ParsedPhoto], int]:
    """사진 쪽들 → (쪽 제목 {쪽 번호: 제목}, 사진 목록, 한 장당 사진 수). 사진 없는 쪽은 건너뛰고 사진 쪽끼리 0 번부터 번호를 새로 매긴다."""
    photo_pages = [p for p in pages if p.images]
    if not photo_pages:
        return {}, [], 6
    per_page = _per_page(photo_pages[0])
    titles: Dict[str, str] = {}
    photos: List[ParsedPhoto] = []
    for ordinal, page in enumerate(photo_pages):
        title, items = parse_photo_page(page, per_page)
        if title:
            titles[str(ordinal)] = title
        photos.extend(ParsedPhoto(data, ordinal * per_page + slot, caption) for slot, data, caption in items)
    return titles, photos, per_page


# ── 서비스레포트 ────────────────────────────────────────────────────────

def _split_labels(line: str) -> Dict[str, str]:
    """"Name of vessel 202 호정 IMO No." → {'vesselName': '202 호정', 'imoNo': ''} — 한 줄에 라벨이 여러 개일 수 있다."""
    matches = list(_LABEL_RE.finditer(line))
    out = {}
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(line)
        out[HEADER_LABELS[m.group(1)]] = line[m.end():end].strip()
    return out


def parse_service_report(pages: List[Page]) -> Parsed:
    first = _body_lines(pages[0]) if pages else []
    if not first or not any(l.lower().startswith('service report') for l in first) or not any('Name of vessel' in l for l in first):
        raise PdfImportError('서비스레포트 PDF 가 아닙니다 (첫 장에서 "Service report" 양식을 찾지 못했습니다). 이 앱에서 만든 서비스레포트 PDF 만 읽을 수 있습니다.')
    header: Dict[str, Any] = {}
    summary: List[str] = []
    remark: List[str] = []
    section = 'header'
    for page in pages:
        if page.images:                                   # 사진 쪽부터는 본문이 아니다
            break
        for line in _body_lines(page):
            if re.match(r'^■?\s*Summary of works(\s*\(continued\))?$', line, re.I):
                section = 'summary'
            elif re.match(r'^■?\s*Remark$', line, re.I):
                section = 'remark'
            elif section == 'header':
                header.update({k: v for k, v in _split_labels(line).items() if k not in header or v})
            elif section == 'summary':
                summary.append(line)
            else:
                remark.append(line)
    if not header.get('vesselName') and not header.get('orderNo') and not summary:
        raise PdfImportError('서비스레포트 PDF 에서 내용을 읽지 못했습니다 (선박명/주문번호/작업 요약이 모두 비어 있음).')
    titles, photos, per_page = parse_photos(pages)
    header.update({'summary': summary, 'remark': '\n'.join(remark), 'pageTitles': titles, 'photosPerPage': per_page})
    return Parsed(header, photos, per_page)


# ── 부품사진첩 ──────────────────────────────────────────────────────────

def parse_photo_album(pages: List[Page]) -> Parsed:
    if not any(p.images for p in pages):
        raise PdfImportError('부품사진첩 PDF 에서 사진을 찾지 못했습니다. 이 앱에서 만든 부품사진첩 PDF 만 읽을 수 있습니다.')
    first = _body_lines(pages[0]) if pages else []
    if any('Name of vessel' in l for l in first):
        raise PdfImportError('서비스레포트 PDF 입니다. 서비스레포트 화면에서 올려 주세요.')
    titles, photos, per_page = parse_photos(pages)
    return Parsed({'pageTitles': titles, 'photosPerPage': per_page}, photos, per_page)


PARSERS = {'service_report': parse_service_report, 'photo_album': parse_photo_album}


def parse_pdf(doc_type: str, data: bytes) -> Parsed:
    parser = PARSERS.get(doc_type)
    if parser is None:
        raise PdfImportError('이 종류의 문서는 아직 PDF 읽기를 지원하지 않습니다.')
    return parser(read_pages(data))
