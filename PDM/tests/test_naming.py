"""문서 파일 이름 생성 테스트"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from PDM.backend.naming import default_title, sanitize_filename

INFO = {'contractNumber': 'SH-2026-057-T', 'shipName': 'GL2030'}


def test_default_title_service_report():
    assert default_title('service_report', INFO, []) == 'SH-2026-057-T_GL2030_서비스레포트'


def test_default_title_measurement():
    assert default_title('measurement', INFO, []) == 'SH-2026-057-T_GL2030_계측지'


def test_duplicate_title_gets_numbered_suffix():
    base = 'SH-2026-057-T_GL2030_서비스레포트'
    assert default_title('service_report', INFO, [base]) == base + ' (2)'
    assert default_title('service_report', INFO, [base, base + ' (2)']) == base + ' (3)'


def test_sanitize_removes_windows_forbidden_chars():
    assert sanitize_filename('A/B:C*D?"E<F>G|H\\I') == 'ABCDEFGHI'


def test_sanitize_trims_and_falls_back_when_empty():
    assert sanitize_filename('  name. ') == 'name'
    assert sanitize_filename('///') == '문서'


def test_ship_name_with_forbidden_chars_is_sanitized():
    info = {'contractNumber': 'SH-1', 'shipName': 'A/B 호'}
    assert default_title('service_report', info, []) == 'SH-1_AB 호_서비스레포트'
