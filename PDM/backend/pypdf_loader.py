"""pypdf 불러오기 — 설치된 것이 있으면 그것을, 없으면 앱 폴더의 vendor\ 에 함께 배포한 것을 쓴다.

패치(ZIP)로만 업데이트한 PC 의 파이썬에는 pypdf 가 없으므로, 순수 파이썬인 pypdf 를 앱 폴더 안(vendor\pypdf)에 같이 배포한다.
"""
import sys
from pathlib import Path
from typing import Any

VENDOR_DIR = Path(__file__).resolve().parents[2] / 'vendor'


def load_pdf_reader() -> Any:
    """pypdf.PdfReader 를 돌려준다. 어디에도 없으면 ImportError."""
    try:
        from pypdf import PdfReader
    except ImportError:
        if VENDOR_DIR.is_dir() and str(VENDOR_DIR) not in sys.path:
            sys.path.append(str(VENDOR_DIR))                # 설치본이 우선 — 없을 때만 vendor
        from pypdf import PdfReader
    return PdfReader
