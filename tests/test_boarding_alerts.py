"""승선신고서 만료 알림 / 공사 상태 판정 테스트"""
import sys
import tempfile
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from src.business.boarding_alerts import build_alerts
from src.business.project_status import resolve_status

TODAY = date(2026, 11, 20)
INFO = {'SH-1': {'status': '착수', 'shipName': 'A호', 'company': '가'}, 'SH-2': {'status': '준공', 'shipName': 'B호', 'company': '나'},
        'SH-3': {'status': '착수', 'shipName': 'C호', 'company': '다'}}


# ── 알림 대상 ────────────────────────────────────────────────────────────

def test_alert_starts_three_days_before_expiry():
    expiries = [('SH-1', '2026-11-23'), ('SH-3', '2026-11-24')]

    alerts = build_alerts(expiries, INFO, TODAY)

    assert [a['contractNumber'] for a in alerts] == ['SH-1']            # 3일 남음은 포함, 4일 남음은 아직
    assert alerts[0]['daysLeft'] == 3


def test_overdue_stays_until_completed():
    expiries = [('SH-1', '2026-11-10'), ('SH-2', '2026-11-10')]

    alerts = build_alerts(expiries, INFO, TODAY)

    assert [a['contractNumber'] for a in alerts] == ['SH-1']            # 준공된 공사(SH-2)는 알리지 않는다
    assert alerts[0]['daysLeft'] == -10


def test_sorted_by_expiry_and_carries_ship_and_company():
    alerts = build_alerts([('SH-3', '2026-11-22'), ('SH-1', '2026-11-18')], INFO, TODAY)

    assert [(a['contractNumber'], a['shipName'], a['company']) for a in alerts] == [('SH-1', 'A호', '가'), ('SH-3', 'C호', '다')]


def test_bad_dates_are_skipped_and_unknown_contract_is_not_done():
    alerts = build_alerts([('SH-1', '내일'), ('SH-9', '2026-11-21')], INFO, TODAY)

    assert [a['contractNumber'] for a in alerts] == ['SH-9']            # 상태 정보가 없으면 준공으로 보지 않는다


# ── 공사 상태 판정 (대시보드 보드와 공용) ────────────────────────────────

@pytest.mark.parametrize('manual,board,end,expected', [
    ('준공', '착수', '2026-11-20', '준공'),            # 수동 상태가 보드/자동보다 우선
    ('completed', '', '2026-11-20', '준공'),
    ('inProgress', '준공', '2026-01-01', '착수'),
    ('auto', '준공', '2026-11-20', '준공'),            # auto = 수동 상태 없음 → 보드 상태
    ('', '착수', '2026-01-01', '착수'),
    ('', '', '2026-11-20', '착수'),                    # 자동: 최근 작업 있음
    ('', '', '2026-11-01', '준공'),                    # 자동: 7일 넘게 작업 없음
    ('기타', '', '2026-11-20', '기타')])
def test_resolve_status_priority(manual, board, end, expected):
    assert resolve_status(manual, board, end, cutoff='2026-11-13') == expected


# ── 저장소: 승선신고서 최신 만료일 ──────────────────────────────────────

def test_store_boarding_expiries_uses_latest_per_contract():
    from PDM.backend.customs import CustomsStore
    from PDM.backend.pdm_db import PdmDb
    pdf = b'%PDF-1.7\n%%EOF\n'
    with tempfile.TemporaryDirectory() as d:
        store = CustomsStore(PdmDb(Path(d) / 'pdm.db'), Path(d) / 'customs')
        store.add('SH-2026-001-T', 'boarding', 'a.pdf', pdf, 'u', expiry='2026-11-10')
        store.add('SH-2026-001-T', 'boarding', 'b.pdf', pdf, 'u', expiry='2026-11-30')     # 연장 — 이게 현재 유효
        store.add('SH-2026-002-T', 'boarding', 'c.pdf', pdf, 'u', expiry='2026-11-21')
        store.add('SH-2026-003-T', 'boarding', 'd.pdf', pdf, 'u')                          # 만료일 없음 → 제외
        store.add('SH-2026-004-T', 'loading', 'e.pdf', pdf, 'u', expiry='2026-11-01')      # 승선신고서 아님 → 제외

        assert store.boarding_expiries('2026-11-23') == [('SH-2026-002-T', '2026-11-21')]
        assert store.boarding_expiries('2026-12-31') == [('SH-2026-002-T', '2026-11-21'), ('SH-2026-001-T', '2026-11-30')]
