# src/utils/erp_macro.py - ERP 입력 자동화 (선진종합시스템 2014)

import re
import time
import threading
import datetime
import ctypes
from ctypes import c_ushort
from typing import List, Dict, Any, Tuple

from .logger import logger


# ---------------------------------------------------------------------------
# Win32 메시지 상수
# ---------------------------------------------------------------------------
MCM_SETCURSEL  = 0x1002   # SysMonthCal32: 날짜 설정
WM_SETTEXT     = 0x000C   # Edit 컨트롤 텍스트 설정
WM_GETTEXT     = 0x000D
BM_CLICK       = 0x00F5   # 버튼 클릭

# 달력 관련 Windows 컨트롤 클래스명 목록 (우선순위 순)
CALENDAR_CLASSES = [
    'SysMonthCal32',        # WinAPI 표준 달력
    'SysDateTimePick32',    # WinAPI DateTimePicker
    'TDBDateTimePicker',    # Delphi 계열 ERP
    'TDateTimePicker',
    'TMonthCalendar',
    'MonthCalendar21',
    'TcxDateEdit',          # DevExpress
]


class SYSTEMTIME(ctypes.Structure):
    """Win32 SYSTEMTIME 구조체 (MCM_SETCURSEL에 사용)"""
    _fields_ = [
        ('wYear',         c_ushort),
        ('wMonth',        c_ushort),
        ('wDayOfWeek',    c_ushort),
        ('wDay',          c_ushort),
        ('wHour',         c_ushort),
        ('wMinute',       c_ushort),
        ('wSecond',       c_ushort),
        ('wMilliseconds', c_ushort),
    ]


class GUITHREADINFO(ctypes.Structure):
    """Win32 GUITHREADINFO 구조체 (크로스 프로세스 포커스 감지)"""
    _fields_ = [
        ('cbSize',        ctypes.c_ulong),
        ('flags',         ctypes.c_ulong),
        ('hwndActive',    ctypes.c_void_p),
        ('hwndFocus',     ctypes.c_void_p),
        ('hwndCapture',   ctypes.c_void_p),
        ('hwndMenuOwner', ctypes.c_void_p),
        ('hwndMoveSize',  ctypes.c_void_p),
        ('hwndCaret',     ctypes.c_void_p),
        ('rcCaret',       ctypes.c_long * 4),
    ]


class ERPMacro:
    """
    선진종합시스템 2014 ERP 자동 입력 클래스

    작동 방식:
    1. win32gui로 ERP 창을 찾아 포커스를 이동
    2. EnumChildWindows로 달력 컨트롤 발견 → MCM_SETCURSEL로 날짜 직접 설정
       (폴백: 달력 컨트롤 rect 기반 동적 좌표 클릭)
    3. Ctrl+N으로 신규 행 생성
    4. 계약번호 → Enter(팝업 자동 선택) → 작업내용 → 인원 → 동반자 입력
       (WM_SETTEXT 직접 입력 우선, 실패 시 pyperclip 폴백)
    5. Ctrl+S로 저장
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
        # 컨트롤 캐시 (run() 호출마다 갱신)
        self._controls_cache: List[Dict] = []
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
            self._log(f"필수 라이브러리 누락: {e}. pip install pyautogui pywin32")
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

        # 창 활성화 후 안정화 대기
        self._log("3초 후 입력을 시작합니다...")
        time.sleep(3)

        # 자식 컨트롤 탐색 (달력 컨트롤 포함)
        self._controls_cache = self._discover_controls(hwnd, win32gui)
        cal_hwnd, cal_class = self._find_calendar_control(self._controls_cache)
        if cal_hwnd:
            self._log(f"달력 컨트롤 발견: {cal_class} (hwnd={cal_hwnd})")
        else:
            self._log("달력 컨트롤 미발견 — 동적 rect 기반 좌표 폴백 사용")

        done = 0
        try:
            for day in dates_records:
                if self._stop_flag:
                    self._log("사용자 요청으로 매크로를 중단합니다.")
                    break

                date_str = day.get('date', '')
                records = day.get('records', [])
                if not date_str or not records:
                    continue

                self._log(f"[{date_str}] 날짜 이동 중...")
                self._navigate_to_date(date_str, hwnd, pyautogui, win32gui,
                                       cal_hwnd, cal_class)

                for rec in records:
                    if self._stop_flag:
                        break
                    contract = rec.get('contractNumber', '').strip()
                    work_content = rec.get('workContent', '').strip()
                    if not contract and not work_content:
                        continue

                    with self._lock:
                        self._status['current'] = f"{date_str} / {contract}"

                    self._enter_record(rec, pyautogui, hwnd, win32gui)
                    done += 1
                    with self._lock:
                        self._status['progress'] = done
                    self._log(f"  ✓ {contract} {work_content[:20]} 입력 완료")

                # 하루치 저장
                if not self._stop_flag:
                    if save_daily:
                        self._save(pyautogui)
                        self._log(f"[{date_str}] 저장 완료")
                    else:
                        self._log(f"[{date_str}] 입력 완료 (저장은 ERP에서 직접 Ctrl+S 하세요)")

        except Exception as e:
            logger.error(f"ERP 매크로 실행 오류: {e}")
            self._log(f"오류 발생: {e}")
        finally:
            self._set_status(running=False)
            self._log("매크로 종료.")

    # ------------------------------------------------------------------
    # Win32 컨트롤 탐색
    # ------------------------------------------------------------------

    def _discover_controls(self, parent_hwnd: int, win32gui) -> List[Dict]:
        """
        ERP 창의 모든 자식 컨트롤을 열거하여 반환.
        반환: [{'hwnd': int, 'cls': str, 'text': str, 'rect': tuple}, ...]
        """
        controls = []

        def _cb(hwnd, _):
            try:
                cls  = win32gui.GetClassName(hwnd)
                text = win32gui.GetWindowText(hwnd)
                rect = win32gui.GetWindowRect(hwnd)
                controls.append({'hwnd': hwnd, 'cls': cls, 'text': text, 'rect': rect})
            except Exception:
                pass
            return True

        try:
            win32gui.EnumChildWindows(parent_hwnd, _cb, None)
        except Exception as e:
            self._log(f"컨트롤 열거 오류: {e}")

        return controls

    def _find_calendar_control(self, controls: List[Dict]) -> Tuple[int, str]:
        """
        CALENDAR_CLASSES 우선순위 순으로 달력 컨트롤 탐색.
        반환: (hwnd, cls_name) — 미발견 시 (0, '')
        """
        cls_map: Dict[str, int] = {}
        for c in controls:
            cls_lower = c['cls'].lower()
            for cal_cls in CALENDAR_CLASSES:
                if cal_cls.lower() == cls_lower and cal_cls not in cls_map:
                    cls_map[cal_cls] = c['hwnd']

        for cal_cls in CALENDAR_CLASSES:
            if cal_cls in cls_map:
                return cls_map[cal_cls], cal_cls

        return 0, ''

    # ------------------------------------------------------------------
    # 날짜 이동
    # ------------------------------------------------------------------

    def _navigate_to_date(self, date_str: str, hwnd: int, pyautogui,
                          win32gui, cal_hwnd: int, cal_class: str):
        """
        1순위: MCM_SETCURSEL Win32 메시지로 달력 날짜 직접 설정
        2순위: 달력 컨트롤 rect 기반 동적 좌표 클릭
        """
        from datetime import date as _date
        try:
            target = _date.fromisoformat(date_str)
        except ValueError:
            self._log(f"날짜 형식 오류: {date_str}")
            return

        if cal_hwnd:
            ok = self._set_calendar_win32(cal_hwnd, cal_class, target)
            if ok:
                self._log(f"  MCM_SETCURSEL 성공: {date_str}")
                time.sleep(0.3)
                return
            else:
                self._log(f"  MCM_SETCURSEL 실패 — rect 기반 폴백 시도")
                self._fallback_click_date_by_rect(target, cal_hwnd, win32gui, pyautogui)
        else:
            # 달력 컨트롤 없음 (Mock ERP 등) — 임시 파일로 날짜 동기화 시도
            self._log(f"  달력 컨트롤 없음 — Mock 날짜 동기화 시도 ({date_str})")
            try:
                import os as _os
                _mock_date_file = _os.path.join(
                    _os.environ.get('TEMP', 'C:\\Windows\\Temp'), 'mock_erp_date.txt')
                with open(_mock_date_file, 'w', encoding='utf-8') as _f:
                    _f.write(date_str)
            except Exception:
                pass
            time.sleep(0.3)

    def _set_calendar_win32(self, cal_hwnd: int, cal_class: str,
                            target_date: 'datetime.date') -> bool:
        """
        Win32 MCM_SETCURSEL 메시지로 달력에 날짜 직접 설정.
        SysDateTimePick32는 DTM_SETSYSTEMTIME(0x1002) 동일 값 사용.
        """
        try:
            st = SYSTEMTIME()
            st.wYear  = target_date.year
            st.wMonth = target_date.month
            st.wDay   = target_date.day
            ret = ctypes.windll.user32.SendMessageW(
                cal_hwnd, MCM_SETCURSEL, 0, ctypes.byref(st)
            )
            return bool(ret)
        except Exception as e:
            self._log(f"  MCM_SETCURSEL 예외: {e}")
            return False

    def _fallback_click_date_by_rect(self, target_date: 'datetime.date',
                                      cal_hwnd: int, win32gui, pyautogui):
        """
        달력 컨트롤의 실제 rect를 GetWindowRect로 획득하여 동적 좌표 계산.
        하드코딩 상수 대신 실제 컨트롤 크기를 사용하므로 창 크기 변경에도 안정적.
        """
        try:
            from datetime import date as _date
            cal_rect = win32gui.GetWindowRect(cal_hwnd)
            left, top, right, bottom = cal_rect
            cal_w = right - left
            cal_h = bottom - top

            # 달력 컨트롤 내 헤더(월 제목) 영역 추정: 상단 약 15%
            header_h = int(cal_h * 0.15)
            # 요일 행 높이 추정: 상단 15~22%
            weekday_h = int(cal_h * 0.07)
            # 날짜 셀 영역: 나머지
            grid_top  = top + header_h + weekday_h
            grid_h    = cal_h - header_h - weekday_h
            cell_w    = cal_w // 7
            cell_h    = grid_h // 6  # 최대 6행

            # 1일의 요일 기준 열 오프셋 (일=0)
            first_weekday = _date(target_date.year, target_date.month, 1).weekday()
            sunday_offset = (first_weekday + 1) % 7
            cell_index    = sunday_offset + target_date.day - 1
            row = cell_index // 7
            col = cell_index % 7

            x = left + col * cell_w + cell_w // 2
            y = grid_top + row * cell_h + cell_h // 2

            self._log(f"  폴백 클릭: cal_rect={cal_rect}, ({x},{y})")
            pyautogui.click(int(x), int(y))
            time.sleep(0.4)
        except Exception as e:
            self._log(f"  폴백 클릭 오류: {e}")

    # ------------------------------------------------------------------
    # 레코드 입력
    # ------------------------------------------------------------------

    def _refocus_erp(self, hwnd: int, win32gui):
        """ERP 창이 포그라운드가 아니면 강제 재활성화 (AttachThreadInput 기법)"""
        user32   = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32
        if user32.GetForegroundWindow() == hwnd:
            return  # 이미 포그라운드 — 불필요한 전환 생략
        try:
            fg_hwnd  = win32gui.GetForegroundWindow()
            fg_tid   = user32.GetWindowThreadProcessId(fg_hwnd, None)
            our_tid  = kernel32.GetCurrentThreadId()
            attached = False
            if fg_tid and our_tid and fg_tid != our_tid:
                user32.AttachThreadInput(our_tid, fg_tid, True)
                attached = True
            win32gui.BringWindowToTop(hwnd)
            win32gui.SetForegroundWindow(hwnd)
            # SetFocus 생략 — 자식 위젯(Entry 등) 포커스 유지
            if attached:
                user32.AttachThreadInput(our_tid, fg_tid, False)
            time.sleep(0.15)
        except Exception:
            pass

    def _enter_record(self, record: dict, pyautogui, hwnd: int, win32gui):
        """
        신규 레코드 1건 입력 순서:
        Ctrl+N → 계약번호 입력 → 팝업 Enter → Right×3 → 작업내용
        → Right × 1 → 인원 → Right × 2 → 동반자
        텍스트 입력: WM_SETTEXT 우선, 실패 시 pyperclip 폴백
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

        # ── 헬퍼: 텍스트 입력 직전 포커스 재획득 후 입력 ──────────────────
        def _type(text: str, is_korean: bool = False):
            """ERP 포커스 재획득 후 텍스트 입력 (WM_SETTEXT → typewrite/pyperclip 폴백)"""
            self._refocus_erp(hwnd, win32gui)      # 매 필드마다 포커스 재획득
            time.sleep(0.1)
            focused = self._get_focused_hwnd(hwnd)
            if focused and self._set_text_to_control(focused, text):
                return  # WM_SETTEXT 성공
            # 폴백: 직접 키 입력 (typewrite / pyperclip+Ctrl+V)
            if is_korean:
                self._type_korean(text, pyautogui)
            else:
                pyautogui.typewrite(text, interval=0.04)

        # 1) ERP 창 포커스 확인 → 신규 행 생성
        self._refocus_erp(hwnd, win32gui)
        pyautogui.hotkey('ctrl', 'n')
        time.sleep(0.45)   # Entry 생성 대기

        # 2) 공사(계약번호) 필드 — 입력 후 팝업 Enter 선택
        if contract:
            _type(contract)
            time.sleep(0.7)   # 팝업 대기
            self._refocus_erp(hwnd, win32gui)
            pyautogui.press('enter')
            time.sleep(0.4)

        # 3) 우측 방향키 3번 → 작업내용 필드
        self._refocus_erp(hwnd, win32gui)
        pyautogui.press('right', presses=3, interval=0.08)
        if work_content:
            _type(work_content, is_korean=True)
            time.sleep(0.2)

        # 4) 우측 방향키 1번 → 인원 필드
        self._refocus_erp(hwnd, win32gui)
        pyautogui.press('right')
        if manpower_str and manpower_str != '0':
            _type(manpower_str)
            time.sleep(0.1)

        # 5) 담당자 건너뜀 → 우측 방향키 2번 → 동반자 필드
        self._refocus_erp(hwnd, win32gui)
        pyautogui.press('right', presses=2, interval=0.08)
        if workers_str:
            _type(workers_str, is_korean=True)
            time.sleep(0.2)

        # 다음 행으로 이동
        pyautogui.press('enter')
        time.sleep(0.2)

    def _save(self, pyautogui):
        """Ctrl+S로 저장"""
        pyautogui.hotkey('ctrl', 's')
        time.sleep(0.6)

    # ------------------------------------------------------------------
    # Win32 텍스트 입력
    # ------------------------------------------------------------------

    def _get_focused_hwnd(self, erp_hwnd: int) -> int:
        """
        ERP 프로세스의 포커스된 컨트롤 핸들 반환 (크로스 프로세스).
        GetGUIThreadInfo 사용 — 같은 스레드가 아니어도 동작.
        """
        try:
            tid = ctypes.windll.user32.GetWindowThreadProcessId(erp_hwnd, None)
            gti = GUITHREADINFO()
            gti.cbSize = ctypes.sizeof(GUITHREADINFO)
            ok = ctypes.windll.user32.GetGUIThreadInfo(tid, ctypes.byref(gti))
            if ok and gti.hwndFocus:
                return gti.hwndFocus
        except Exception:
            pass
        return 0

    def _set_text_to_control(self, ctrl_hwnd: int, text: str) -> bool:
        """
        WM_SETTEXT Win32 메시지로 컨트롤에 텍스트 직접 설정.
        실제로 반영됐는지 WM_GETTEXT로 검증함.
        tkinter Entry 등은 WM_SETTEXT가 내부 상태를 갱신하지 않아
        검증 실패 → False 반환 → 호출자가 typewrite 폴백 사용.
        """
        try:
            ret = ctypes.windll.user32.SendMessageW(ctrl_hwnd, WM_SETTEXT, 0, text)
            if not ret:
                return False
            # 실제로 반영됐는지 WM_GETTEXT로 재확인
            buf_size = len(text) + 4
            buf = ctypes.create_unicode_buffer(buf_size)
            ctypes.windll.user32.SendMessageW(ctrl_hwnd, WM_GETTEXT, buf_size, buf)
            return buf.value == text
        except Exception:
            return False

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
        """ERP 창 강제 포그라운드 전환 (AttachThreadInput 기법)

        Windows는 백그라운드 프로세스의 SetForegroundWindow를 기본 차단함.
        AttachThreadInput(our_tid, fg_tid) 로 우리 스레드를 현재 포그라운드
        스레드에 연결하면 포그라운드 잠금 없이 SetForegroundWindow 가능.
        """
        try:
            user32   = ctypes.windll.user32
            kernel32 = ctypes.windll.kernel32

            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
            time.sleep(0.2)

            # 현재 포그라운드 창의 스레드 ID
            fg_hwnd  = win32gui.GetForegroundWindow()
            fg_tid   = user32.GetWindowThreadProcessId(fg_hwnd, None)
            # 우리 스레드 ID (매크로 실행 스레드)
            our_tid  = kernel32.GetCurrentThreadId()

            # AttachThreadInput(our_tid, fg_tid) : 우리 스레드 → 포그라운드 스레드 연결
            # → 우리 스레드가 SetForegroundWindow 호출 시 잠금 우회
            attached = False
            if fg_tid and our_tid and fg_tid != our_tid:
                user32.AttachThreadInput(our_tid, fg_tid, True)
                attached = True

            win32gui.BringWindowToTop(hwnd)
            win32gui.SetForegroundWindow(hwnd)
            # SetFocus 호출 생략 — 창 내부의 기존 포커스 상태 유지
            # (SetFocus(main_hwnd)를 호출하면 Entry 등 자식 위젯 포커스가 깨짐)

            if attached:
                user32.AttachThreadInput(our_tid, fg_tid, False)

            self._log("창 활성화 완료")
        except Exception as e:
            self._log(f"창 활성화 경고: {e} (계속 진행)")
        time.sleep(0.5)

    def _get_window_rect(self, hwnd, win32gui) -> tuple:
        """창의 (left, top, right, bottom) 반환"""
        return win32gui.GetWindowRect(hwnd)

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
        팀장 + 본공 작업자 이름을 공백 구분 문자열로 반환.
        도급(업체명(이름)) / 일당(업체명[이름]) 패턴은 제외.
        """
        try:
            from ..business.calculations import extract_names
        except ImportError:
            return ''

        workers = []

        # 팀장 이름 추출
        if leader and leader.strip():
            for name, _ in extract_names(leader):
                if name:
                    workers.append(name)

        # 본공 작업자만 추출 (도급 / 일당 패턴 제외)
        if teammates and teammates.strip():
            text = teammates.strip()
            cleaned = re.sub(r'[^,]+\([^)]*\)', '', text)
            cleaned = re.sub(r'[^,]+\[[^\]]*\]', '', cleaned)
            for name, _ in extract_names(cleaned):
                if name:
                    workers.append(name)

        return ' '.join(workers)

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
