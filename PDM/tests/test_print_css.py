"""본체 인쇄 CSS 와의 충돌 방지 — 본체 index.html 에 `body * { visibility: hidden }` (연차 보고서 인쇄용)가 있어
PDM 출력이 백지로 나온 적이 있다 (v3.0.3). PDM 인쇄 영역은 이를 명시적으로 덮어써야 한다."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent


def test_pdm_print_area_overrides_the_main_apps_hide_everything_print_rule():
    main_css = (ROOT / 'web' / 'index.html').read_text(encoding='utf-8')
    pdm_js = (ROOT / 'PDM' / 'web' / 'print_view.js').read_text(encoding='utf-8')
    if 'body * { visibility: hidden; }' in main_css:
        assert '#pdmPrint, #pdmPrint * { visibility: visible !important; }' in pdm_js
