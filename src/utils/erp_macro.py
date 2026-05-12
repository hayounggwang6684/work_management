# src/utils/erp_macro.py - ERP 입력 자동화 (선진종합시스템 2014)

import re
import sys
import time
import threading
import datetime
import ctypes
from typing import List, Dict, Any

from .logger import logger



class ERPMacro:
    """
    선진종합시스템 2014 ERP 자동 입력 클래스

    작동 방식:
    Phase A: 사용자가 ERP 달력에서 날짜를 클릭하고 스페이스바를 눌러 좌표 기록
    Phase B: 기록한 좌표로 달력 날짜 클릭 → 첫 레코드 입력 (Tab×3 이동)
    Phase C: 이후 레코드 입력 (Ctrl+N → Left×6 이동)
    Phase D: 하루치 Ctrl+S 저장
    """

    WINDOW_TITLE_KEYWORD = '선진종합시스템'

    def __init__(self):
        self._stop_flag = False
        self._lock = threading.Lock()
        self._status: Dict[str, Any] = {
            'running': False,
            'progress': 0,
            'total': 0,
            'current': '',
            'log': [],
        }
        # 사용자가 수동 지정한 ERP 창 HWND (0이면 자동 탐색)
        self.forced_hwnd: int = 0

    # ------------------------------------------------------------------
    # 공개 인터페이스
    # ------------------------------------------------------------------

    def get_status(self) -> Dict[str, Any]:
        """현재 진행 상태 반환 (thread-safe 복사본)"""
        with self._lock:
            return dict(self._status)

    def stop(self):
        """실행 중인 매크로 중단 요청"""
        self._stop_flag = True
        self._log("중단 요청 수신 — 현재 작업 완료 후 중단됩니다.")

    def run(self, dates_records: List[Dict], save_daily: bool = True) -> None:
        """
        매크로 메인 루프 (백그라운드 스레드에서 호출)

        dates_records 형식:
            [{'date': 'YYYY-MM-DD', 'records': [{'contractNumber': ..., ...}]}, ...]

        save_daily: True(기본) → 하루치 입력 후 Ctrl+S 자동 저장
                    False → 저장 생략 (ERPDockWindow 팝업 사용 시)
        """
        # running=True + 로그 초기화를 먼저 (폴링이 즉시 상태 반영되도록)
        total = sum(len(d.get('records', [])) for d in dates_records)
        with self._lock:
            self._status.update({'running': True, 'progress': 0,
                                 'total': total, 'current': '', 'log': []})

        try:
            import pyautogui
            import win32gui
            import win32con
        except ImportError as e:
            self._log(f"필수 라이브러리 누락: {e}")
            self._log("자동 설치를 시작합니다... (30~60초 소요)")
            try:
                import subprocess
                subprocess.check_call(
                    [sys.executable, '-m', 'pip', 'install',
                     'pyautogui', 'pywin32', 'pyperclip', '-q'],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
                )
                self._log("설치 완료. 다시 시작해 주세요.")
            except Exception as install_err:
                self._log(f"자동 설치 실패: {install_err}")
                self._log("수동 설치: pip install pyautogui pywin32 pyperclip")
            self._set_status(running=False)
            return


        self._stop_flag = False
        hwnd = self._find_erp_window(win32gui)
        if not hwnd:
            # 진단: 현재 열린 창 제목 목록 로깅
            visible: list = []

            def _cb(h, _):
                t = win32gui.GetWindowText(h)
                if t and win32gui.IsWindowVisible(h):
                    visible.append(t[:40])

            win32gui.EnumWindows(_cb, None)
            self._log("ERP 창을 찾을 수 없습니다. 선진종합시스템을 먼저 실행해 주세요.")
            if visible:
                self._log(f"현재 열린 창 (진단): {', '.join(visible[:8])}")
            self._set_status(running=False)
            return

        self._log(f"ERP 창 발견: '{win32gui.GetWindowText(hwnd)}'")
        self._activate_window(hwnd, win32gui, win32con)
        pyautogui.FAILSAFE = True
        pyautogui.PAUSE = 0.05


        # ── Phase A: 달력 좌표 수집 ──────────────────────────────────────
        unique_dates = [d['date'] for d in dates_records if d.get('date') and d.get('records')]
        date_coords = self._phase_a_collect_coords(unique_dates, pyautogui)
        if not date_coords:
            self._log("좌표 입력이 취소되었습니다.")
            self._set_status(running=False)
            return
        self._log("─" * 40)
        self._log("모든 좌표 수집 완료. 입력을 시작합니다...")
        time.sleep(1)

        done = 0
        very_first = True  # 절대 첫 레코드 여부 (Phase B B06: Tab×3)
        first_day  = True  # 첫째 날 여부 (Phase B)
        try:
            for day in dates_records:
                if self._stop_flag:
                    self._log("사용자 요청으로 매크로를 중단합니다.")
                    break

                date_str = day.get('date', '')
                records = day.get('records', [])
                if not date_str or not records:
                    continue

                # ── Phase B B01~B03 / Phase C 달력 클릭 ───────────────
                self._phase_b_start_day(date_coords[date_str], pyautogui, hwnd, win32gui, win32con)

                first_rec_of_day = True  # 해당 날의 첫 레코드
                for idx, rec in enumerate(records):
                    if self._stop_flag:
                        break
                    contract = rec.get('contractNumber', '').strip()
                    work_content = rec.get('workContent', '').strip()
                    if not contract and not work_content:
                        continue

                    with self._lock:
                        self._status['current'] = f"{date_str} / {contract}"

                    # Phase B 첫 레코드 : use_tab3=True,  use_c02_1=False  (B06: Tab×3)
                    # Phase B 이후 레코드: use_tab3=False, use_c02_1=False  (Left×6)
                    # Phase C 첫 레코드 : use_tab3=False, use_c02_1=True   (C02-1 + Left×6)
                    # Phase C 이후 레코드: use_tab3=False, use_c02_1=False  (Left×6)
                    self._enter_record(rec, pyautogui, hwnd, win32gui,
                                       use_tab3=very_first,
                                       use_c02_1=(not first_day) and first_rec_of_day)
                    very_first       = False
                    first_rec_of_day = False
                    done += 1
                    with self._lock:
                        self._status['progress'] = done
                    self._log(f"  ✓ {contract} {work_content[:20]} 입력 완료")

                first_day = False
                # ── Phase D: 날짜 저장 (B19~B24 / D01~D06) ────────────
                if not self._stop_flag:
                    self._phase_d_save(pyautogui, hwnd, win32gui)
                    self._log(f"[{date_str}] 저장 완료")

        except Exception as e:
            logger.exception("ERP 매크로 실행 오류")
            self._log("오류 발생. 상세 내용은 로그를 확인하세요.")
        finally:
            self._set_status(running=False)
            self._log("매크로 종료.")

    # ------------------------------------------------------------------
    # Phase 메서드
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # 입력 헬퍼
    # ------------------------------------------------------------------

    def _force_foreground(self, hwnd: int, win32gui) -> bool:
        """
        Windows 포그라운드 잠금을 우회해 hwnd를 최전면으로 가져옴.

        1) keybd_event(Alt)  — 포그라운드 잠금 해제 트릭
        2) AttachThreadInput — 스레드 입력 큐 연결
        3) BringWindowToTop  — Z순서 상위로
        4) SetForegroundWindow
        5) SwitchToThisWindow (최후 수단)
        """
        user32   = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32

        # ── 1. Alt 키 누름/뗌으로 포그라운드 잠금 해제 ─────────────────
        VK_MENU          = 0x12
        KEYEVENTF_KEYUP  = 0x0002
        try:
            user32.keybd_event(VK_MENU, 0, 0, 0)
            user32.keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0)
        except Exception:
            pass

        # ── 2. AttachThreadInput ─────────────────────────────────────────
        fg_hwnd  = win32gui.GetForegroundWindow()
        fg_tid   = user32.GetWindowThreadProcessId(fg_hwnd, None)
        our_tid  = kernel32.GetCurrentThreadId()
        attached = False
        if fg_tid and our_tid and fg_tid != our_tid:
            try:
                user32.AttachThreadInput(our_tid, fg_tid, True)
                attached = True
            except Exception:
                pass

        # ── 3~4. BringWindowToTop + SetForegroundWindow ──────────────────
        try:
            win32gui.BringWindowToTop(hwnd)
        except Exception:
            pass
        ok = False
        try:
            win32gui.SetForegroundWindow(hwnd)
            ok = True
        except Exception:
            pass

        # ── 5. 최후 수단: SwitchToThisWindow ────────────────────────────
        if not ok:
            try:
                user32.SwitchToThisWindow(hwnd, True)
            except Exception:
                pass

        if attached:
            try:
                user32.AttachThreadInput(our_tid, fg_tid, False)
            except Exception:
                pass

        return user32.GetForegroundWindow() == hwnd

    def _refocus_erp(self, hwnd: int, win32gui):
        """ERP 창이 포그라운드가 아니면 강제 재활성화"""
        user32 = ctypes.windll.user32
        if user32.GetForegroundWindow() == hwnd:
            return  # 이미 포그라운드 — 불필요한 전환 생략
        self._force_foreground(hwnd, win32gui)
        time.sleep(0.15)

    def _enter_record(self, record: dict, pyautogui, hwnd: int, win32gui,
                      use_tab3: bool = False, use_c02_1: bool = False):
        """레코드 1건 입력.

        use_tab3=True   → Phase B 첫 레코드  (B06): Tab×3 으로 공사번호 칸 이동
        use_tab3=False  → Phase B/C 이후 레코드: Left×6 으로 공사번호 칸 이동
        use_c02_1=True  → Phase C 첫 레코드 전용: Left×6 전 Tab×1 추가 (C02-1)
        """
        contract     = record.get('contractNumber', '').strip()
        work_content = record.get('workContent', '').strip()
        leader       = record.get('leader', '')
        teammates    = record.get('teammates', '')

        # 본공 인원 계산
        in_house, _ = self._calc_in_house(leader, teammates)
        manpower_str = str(int(in_house)) if in_house == int(in_house) else str(in_house)

        # 동반자 이름 (공백 구분)
        workers_str = self._format_workers(leader, teammates)

        def _paste(text: str):
            """ERP 포커스 재획득 후 클립보드 경유 붙여넣기 (한글·숫자 모두 안전)"""
            if not text:
                return
            self._refocus_erp(hwnd, win32gui)
            self._type_korean(text, pyautogui)   # pyperclip → Ctrl+V

        # B04/C01: Ctrl+N — 신규 행 생성
        self._refocus_erp(hwnd, win32gui)
        pyautogui.hotkey('ctrl', 'n')
        # B05/C02: 0.5초 대기
        time.sleep(0.5)

        # C02-1: Tab×1 — Phase C 첫 레코드 전용 (해당 날의 첫 번째 레코드에만 적용)
        if use_c02_1:
            self._refocus_erp(hwnd, win32gui)
            pyautogui.press('tab')
            time.sleep(0.1)

        # B06/C03: 공사번호 칸 이동
        #   Phase B 첫 레코드 (use_tab3=True)  → Tab×3
        #   Phase B/C 이후 레코드 (use_tab3=False) → Left×6
        self._refocus_erp(hwnd, win32gui)
        if use_tab3:
            pyautogui.press('tab', presses=3, interval=0.08)
        else:
            pyautogui.press('left', presses=6, interval=0.07)
        # B07/C04: 0.15초 대기
        time.sleep(0.15)

        if contract:
            # B08/C05: Ctrl+V — 공사번호 붙여넣기
            _paste(contract)
            # B09/C06: Enter — 공사 팝업 호출
            self._refocus_erp(hwnd, win32gui)
            pyautogui.press('enter')
            # B10/C07: 1.0초 대기 (팝업 로드 대기)
            time.sleep(1.0)
            # B11/C08: Enter — 팝업 첫 항목 선택 (※ refocus_erp 호출 금지 — 팝업이 포그라운드여야 Enter가 먹힘)
            pyautogui.press('enter')
            # B12/C09: 0.4초 대기
            time.sleep(0.4)

        # B13/C10: Tab×3 — 작업내용 칸 이동
        self._refocus_erp(hwnd, win32gui)
        pyautogui.press('tab', presses=3, interval=0.08)
        # B14/C11: Ctrl+V — 작업내용 붙여넣기
        if work_content:
            _paste(work_content)
            time.sleep(0.15)

        # B15/C12: Tab — 인원 칸 이동
        self._refocus_erp(hwnd, win32gui)
        pyautogui.press('tab')
        # B16/C13: Ctrl+V — 인원 붙여넣기
        if manpower_str and manpower_str != '0':
            _paste(manpower_str)
            time.sleep(0.1)

        # B17/C14: Tab×2 — 동반자 칸 이동
        self._refocus_erp(hwnd, win32gui)
        pyautogui.press('tab', presses=2, interval=0.08)
        # B18/C15: Ctrl+V — 동반자 붙여넣기
        # 실 ERP에서 마지막 작업자 칸은 붙여넣기 직후 값 확정이 늦어 공란처럼
        # 남는 경우가 있어, 이동 타이밍은 유지하고 붙여넣기 후 대기만 늘린다.
        if workers_str:
            _paste(workers_str)
            time.sleep(0.4)

    def _wait_for_spacebar(self) -> bool:
        """스페이스바(확정) 또는 ESC(취소) 입력 대기 — win32api 폴링"""
        try:
            import win32api
        except ImportError:
            input()  # fallback: Enter키로 대체
            return True
        VK_SPACE  = 0x20
        VK_ESCAPE = 0x1B
        win32api.GetAsyncKeyState(VK_SPACE)   # 이전 상태 초기화
        win32api.GetAsyncKeyState(VK_ESCAPE)
        while not self._stop_flag:
            if win32api.GetAsyncKeyState(VK_SPACE) & 0x0001:
                time.sleep(0.1)  # 디바운스
                return True
            if win32api.GetAsyncKeyState(VK_ESCAPE) & 0x0001:
                return False
            time.sleep(0.05)
        return False

    def _phase_a_collect_coords(self, dates: list, pyautogui) -> dict:
        """Phase A: 날짜별 달력 좌표를 사용자에게 직접 입력받음 (A01~A04)"""
        self._log("─" * 40)
        self._log("달력 좌표 입력 모드")
        self._log(f"입력할 날짜 {len(dates)}개: {', '.join(dates)}")
        self._log("각 날짜를 ERP 달력에서 클릭 후 스페이스바를 누르세요 (ESC=취소)")
        coords = {}
        for date_str in dates:
            # A01: 날짜별 안내 로그
            self._log(f"📍 [{date_str}] ERP 달력에서 해당 날짜를 클릭하고 스페이스바를 누르세요")
            # A02: 스페이스바 / ESC 대기
            ok = self._wait_for_spacebar()
            if not ok:
                self._log("  좌표 입력 취소 (ESC)")
                return {}
            # A03: 마우스 현재 위치 기록
            x, y = pyautogui.position()
            # A04: 좌표 저장 로그
            coords[date_str] = (int(x), int(y))
            self._log(f"  → [{date_str}] 좌표 저장: ({int(x)}, {int(y)})")
        return coords

    def _phase_b_start_day(self, coord: tuple, pyautogui, hwnd: int, win32gui, win32con):
        """Phase B: 달력 날짜 클릭 → 입력 준비 (B01~B03)"""
        x, y = coord
        self._log(f"[달력 클릭] ({x}, {y})")
        # B01: ERP 창 활성화
        self._activate_window(hwnd, win32gui, win32con)
        # B02: 달력 저장 좌표 클릭
        pyautogui.click(x, y)
        # B03: 0.8초 대기
        time.sleep(0.8)

    def _phase_d_save(self, pyautogui, hwnd: int, win32gui):
        """Phase B 저장 (B19~B24) / Phase D 저장 (D01~D06) — 공통 루틴.

        _refocus_erp 없이 Ctrl+S를 보내면 Chrome이 포커스를 가져가
        '다른 이름으로 저장' 다이얼로그가 열리므로 반드시 refocus 먼저.
        """
        self._refocus_erp(hwnd, win32gui)
        # B19/D01: up×1 — 커서 이동 (방향키 위로)
        pyautogui.press('up')
        # B20/D02: 0.15초 대기
        time.sleep(0.15)
        self._refocus_erp(hwnd, win32gui)
        # B21/D03: Ctrl+S — 저장
        pyautogui.hotkey('ctrl', 's')
        # B22/D04: 0.8초 대기 (저장확인 팝업 로드)
        time.sleep(0.8)
        # B23/D05: Enter — 저장확인 팝업 닫기
        pyautogui.press('enter')
        # B24/D06: 0.3초 대기
        time.sleep(0.3)

    def _type_korean(self, text: str, pyautogui):
        """
        한글/특수문자 포함 텍스트 입력 (폴백).
        pyperclip으로 클립보드에 복사 후 Ctrl+V 붙여넣기.
        """
        try:
            import pyperclip
            pyperclip.copy(text)
            pyautogui.hotkey('ctrl', 'v')
        except ImportError:
            pyautogui.typewrite(text, interval=0.03)

    # ------------------------------------------------------------------
    # 창 관리
    # ------------------------------------------------------------------

    def _find_erp_window(self, win32gui) -> int:
        """ERP 창 핸들 반환. forced_hwnd 지정 시 우선 사용. 없으면 0."""
        if self.forced_hwnd and win32gui.IsWindow(self.forced_hwnd):
            return self.forced_hwnd

        result = []

        def _cb(hwnd, _):
            title = win32gui.GetWindowText(hwnd)
            if self.WINDOW_TITLE_KEYWORD in title and win32gui.IsWindowVisible(hwnd):
                result.append(hwnd)

        win32gui.EnumWindows(_cb, None)
        return result[0] if result else 0

    def _activate_window(self, hwnd, win32gui, win32con):
        """ERP 창 강제 포그라운드 전환"""
        try:
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
            time.sleep(0.2)
        except Exception:
            pass
        self._force_foreground(hwnd, win32gui)
        self._log("창 활성화 완료")
        time.sleep(0.5)

    # ------------------------------------------------------------------
    # 인원 / 이름 헬퍼
    # ------------------------------------------------------------------

    def _calc_in_house(self, leader: str, teammates: str):
        """본공/외주 공수 분리 (calculations.split_manpower_by_type 위임)"""
        try:
            from ..business.calculations import split_manpower_by_type
            return split_manpower_by_type(leader, teammates)
        except Exception:
            return 1.0, 0.0

    def _format_workers(self, leader: str, teammates: str) -> str:
        """
        ERP 동반자 칸에 붙여넣을 문자열 반환.

        - 직영 직원 (팀장 포함): HTML/별표 마크업 제거 + 직급 제거 후 이름만
        - 외주 도급 업체명(이름들): 원문 그대로 포함
        - 외주 일당 업체명[이름들]: 원문 그대로 포함
        인원 계산은 _calc_in_house 에서 별도 처리 (이 함수는 영향 없음)
        """
        # 제거할 직급 목록
        RANKS = {
            '사장', '부사장', '전무', '상무', '이사',
            '부장', '차장', '과장', '대리', '주임', '사원',
            '팀장', '반장', '수석', '선임', '책임', '연구원', '기사',
        }

        def _clean_name(raw: str) -> str:
            """마크업 제거 + 직급 제거 후 순수 이름 반환"""
            name = re.sub(r'<[^>]+>', '', raw).strip('*').strip()
            # 앞 직급: '과장 홍길동' → '홍길동'
            for rank in RANKS:
                if name.startswith(rank) and len(name) > len(rank):
                    candidate = name[len(rank):].strip()
                    if candidate:
                        name = candidate
                        break
            # 뒤 직급: '홍길동 과장' → '홍길동'
            for rank in RANKS:
                if name.endswith(rank) and len(name) > len(rank):
                    candidate = name[:-len(rank)].strip()
                    if candidate:
                        name = candidate
                        break
            return name

        in_house_parts: list = []   # 본사 직원 (팀장 포함)
        outsourced_parts: list = [] # 외주 (도급/일당) — 맨 끝에 붙임

        # ① 팀장 이름 (직급 제거) → 본사
        if leader and leader.strip():
            name = _clean_name(leader.strip())
            if name:
                in_house_parts.append(name)

        if not teammates or not teammates.strip():
            return ' '.join(in_house_parts)

        text = teammates.strip()
        matched_ranges: list = []

        # ② 외주 도급: 업체명(이름들) → 원문 그대로
        for m in re.compile(r'[^()\[\],]+\([^)]+\)').finditer(text):
            outsourced_parts.append(m.group(0).strip())
            matched_ranges.append((m.start(), m.end()))

        # ③ 외주 일당: 업체명[이름들] → 원문 그대로
        for m in re.compile(r'[^()\[\],]+\[[^\]]+\]').finditer(text):
            outsourced_parts.append(m.group(0).strip())
            matched_ranges.append((m.start(), m.end()))

        # ④ 본사 직원 (나머지): 직급 제거 후 이름만
        remaining = text
        for start, end in sorted(matched_ranges, reverse=True):
            remaining = remaining[:start] + remaining[end:]
        for raw in [p.strip() for p in remaining.split(',') if p.strip()]:
            name = _clean_name(raw)
            if name:
                in_house_parts.append(name)

        # 순서: 본사 직원 → 외주 (맨 끝)
        return ' '.join(in_house_parts + outsourced_parts)

    # ------------------------------------------------------------------
    # 로그 / 상태 헬퍼
    # ------------------------------------------------------------------

    def _log(self, msg: str):
        ts = datetime.datetime.now().strftime('%H:%M:%S')
        line = f"[{ts}] {msg}"
        logger.info(f"ERPMacro: {msg}")
        with self._lock:
            self._status['log'].append(line)
            if len(self._status['log']) > 200:
                self._status['log'] = self._status['log'][-200:]

    def _set_status(self, **kwargs):
        with self._lock:
            self._status.update(kwargs)


# 싱글톤 인스턴스
erp_macro = ERPMacro()
