# src/utils/erp_dock_window.py
# ERP 입력용 팝업 창 — tkinter + Win32 SetParent 마그넷 도킹

import ctypes
import threading
import time
import datetime
from typing import List, Dict, Tuple, Optional

from .logger import logger

try:
    import tkinter as tk
    from tkinter import ttk, scrolledtext
    _TK_AVAILABLE = True
except ImportError:
    _TK_AVAILABLE = False

# ---------------------------------------------------------------------------
# Win32 상수
# ---------------------------------------------------------------------------
GWL_STYLE     = -16
GWL_EXSTYLE   = -20
WS_CHILD      = 0x40000000
WS_VISIBLE    = 0x10000000
WS_CAPTION    = 0x00C00000  # WS_BORDER | WS_DLGFRAME
WS_THICKFRAME = 0x00040000
WS_SYSMENU    = 0x00080000
WS_MINIMIZEBOX= 0x00020000
WS_MAXIMIZEBOX= 0x00010000
SWP_NOMOVE    = 0x0002
SWP_NOSIZE    = 0x0001
SWP_FRAMECHANGED = 0x0020
HWND_TOP      = 0

# 제거할 스타일 비트 (도킹 시)
REMOVE_STYLES = WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX


class ERPDockWindow:
    """
    ERP 입력용 팝업 창 (tkinter + Win32 SetParent).

    사용 흐름:
      1. ERPDockWindow(dates_records).launch()  → 별도 스레드에서 tkinter 창 시작
      2. 사용자가 ERP 창을 도킹 영역으로 드래그 → 마그넷 스냅 (자동)
         또는 [🔗 ERP 창 연결] 버튼 클릭 → 즉시 도킹
      3. [▶ 입력 시작] 클릭 → erp_macro.run(save_daily=False) 실행
      4. 입력 완료 후 사용자가 ERP에서 직접 Ctrl+S 저장
    """

    WINDOW_TITLE_KW = '선진종합시스템'
    MAGNET_HIGHLIGHT_PX = 150   # 하이라이트 시작 거리(px)
    MAGNET_SNAP_PX      = 80    # 자동 스냅 거리(px)
    POLL_MS             = 300   # 마그넷 체크 주기(ms)
    STATUS_MS           = 1000  # 자동화 상태 폴링 주기(ms)

    # 색상 팔레트
    BG_MAIN    = '#1e2130'
    BG_DOCK    = '#0d1117'
    BG_CTRL    = '#1e2130'
    BG_LOG     = '#0d1117'
    FG_GREEN   = '#4ade80'
    FG_WHITE   = '#f1f5f9'
    FG_MUTED   = '#94a3b8'
    FG_RED     = '#f87171'
    FG_YELLOW  = '#fbbf24'
    BTN_BLUE   = '#3b82f6'
    BTN_GREEN  = '#16a34a'
    BTN_RED    = '#dc2626'
    BTN_GRAY   = '#475569'
    BORDER_IDLE     = '#334155'
    BORDER_NEAR     = '#3b82f6'
    BORDER_CONNECTED= '#4ade80'

    def __init__(self, dates_records: List[Dict]):
        self.dates_records = dates_records
        self._erp_hwnd:  int  = 0
        self._orig_style: int  = 0
        self._orig_parent: int = 0
        self._docked: bool     = False
        self._automation_running: bool = False

        # tkinter 위젯 참조 (스레드 내에서만 접근)
        self.root: Optional['tk.Tk'] = None
        self._dock_frame: Optional['tk.Frame'] = None
        self._status_label: Optional['tk.Label'] = None
        self._btn_connect: Optional['tk.Button'] = None
        self._btn_disconnect: Optional['tk.Button'] = None
        self._btn_start: Optional['tk.Button'] = None
        self._btn_stop: Optional['tk.Button'] = None
        self._progress_var: Optional['tk.DoubleVar'] = None
        self._progress_label: Optional['tk.Label'] = None
        self._log_widget: Optional['scrolledtext.ScrolledText'] = None
        self._info_label: Optional['tk.Label'] = None

    # ------------------------------------------------------------------
    # 공개 인터페이스
    # ------------------------------------------------------------------

    def launch(self):
        """별도 스레드에서 tkinter 창 실행 (메인 Eel 스레드 방해 없음)."""
        if not _TK_AVAILABLE:
            logger.error("tkinter를 사용할 수 없습니다.")
            return
        t = threading.Thread(target=self._run_tk, daemon=True)
        t.start()

    # ------------------------------------------------------------------
    # tkinter 창 초기화
    # ------------------------------------------------------------------

    def _run_tk(self):
        try:
            self.root = tk.Tk()
            self.root.title("ERP 입력 자동화")
            self.root.geometry("1440x900")
            self.root.minsize(900, 600)
            self.root.configure(bg=self.BG_MAIN)
            self._build_ui()
            self.root.after(self.POLL_MS, self._magnet_check)
            self.root.after(self.STATUS_MS, self._poll_status)
            self.root.protocol("WM_DELETE_WINDOW", self._on_close)
            self.root.mainloop()
        except Exception as e:
            logger.error(f"ERPDockWindow 실행 오류: {e}")

    def _build_ui(self):
        """좌: 도킹 패널 / 우: 컨트롤 패널."""
        self.root.grid_columnconfigure(0, weight=1)
        self.root.grid_columnconfigure(1, minsize=290, weight=0)
        self.root.grid_rowconfigure(0, weight=1)

        # ── 좌: 도킹 패널 ──────────────────────────────────────────────
        dock_outer = tk.Frame(self.root, bg=self.BORDER_IDLE, padx=2, pady=2)
        dock_outer.grid(row=0, column=0, sticky='nsew', padx=(8, 4), pady=8)

        self._dock_frame = tk.Frame(dock_outer, bg=self.BG_DOCK)
        self._dock_frame.pack(fill='both', expand=True)

        # 안내 텍스트 (도킹 전에만 표시)
        self._dock_hint = tk.Label(
            self._dock_frame,
            text="← ERP 창을 이 영역으로 드래그하거나\n[🔗 ERP 창 연결] 버튼을 누르세요",
            bg=self.BG_DOCK, fg=self.FG_MUTED,
            font=('맑은 고딕', 13), justify='center'
        )
        self._dock_hint.place(relx=0.5, rely=0.5, anchor='center')
        self._dock_outer = dock_outer  # 테두리 색 변경용

        # ── 우: 컨트롤 패널 ────────────────────────────────────────────
        ctrl = tk.Frame(self.root, bg=self.BG_CTRL, width=290)
        ctrl.grid(row=0, column=1, sticky='nsew', padx=(4, 8), pady=8)
        ctrl.pack_propagate(False)

        self._build_ctrl_panel(ctrl)

    def _build_ctrl_panel(self, parent: 'tk.Frame'):
        pad = {'padx': 12, 'pady': 4}

        # 연결 상태
        tk.Label(parent, text="ERP 연결 상태", bg=self.BG_CTRL,
                 fg=self.FG_MUTED, font=('맑은 고딕', 9)).pack(anchor='w', padx=12, pady=(16, 0))
        self._status_label = tk.Label(
            parent, text="● 연결 안됨",
            bg=self.BG_CTRL, fg=self.FG_RED,
            font=('맑은 고딕', 11, 'bold')
        )
        self._status_label.pack(anchor='w', padx=12, pady=(2, 8))

        # 구분선
        ttk.Separator(parent, orient='horizontal').pack(fill='x', padx=8)

        # 연결 버튼
        self._btn_connect = tk.Button(
            parent, text="🔗 ERP 창 연결",
            bg=self.BTN_BLUE, fg=self.FG_WHITE,
            font=('맑은 고딕', 10, 'bold'),
            relief='flat', cursor='hand2',
            command=self._connect_button
        )
        self._btn_connect.pack(fill='x', padx=12, pady=(12, 4))

        self._btn_disconnect = tk.Button(
            parent, text="🔌 연결 해제",
            bg=self.BTN_GRAY, fg=self.FG_WHITE,
            font=('맑은 고딕', 10),
            relief='flat', cursor='hand2',
            state='disabled',
            command=self._disconnect_button
        )
        self._btn_disconnect.pack(fill='x', padx=12, pady=(0, 8))

        # 구분선
        ttk.Separator(parent, orient='horizontal').pack(fill='x', padx=8)

        # 날짜/건수 정보
        total_days = len(self.dates_records)
        total_recs = sum(len(d.get('records', [])) for d in self.dates_records)
        self._info_label = tk.Label(
            parent,
            text=f"📅 {total_days}일치 / 총 {total_recs}건",
            bg=self.BG_CTRL, fg=self.FG_WHITE,
            font=('맑은 고딕', 10)
        )
        self._info_label.pack(anchor='w', padx=12, pady=(12, 8))

        # 입력 시작 / 중단 버튼
        self._btn_start = tk.Button(
            parent, text="▶ 입력 시작",
            bg=self.BTN_GREEN, fg=self.FG_WHITE,
            font=('맑은 고딕', 11, 'bold'),
            relief='flat', cursor='hand2',
            state='disabled',
            command=self._start_automation
        )
        self._btn_start.pack(fill='x', padx=12, pady=(0, 4))

        self._btn_stop = tk.Button(
            parent, text="■ 중단",
            bg=self.BTN_RED, fg=self.FG_WHITE,
            font=('맑은 고딕', 11, 'bold'),
            relief='flat', cursor='hand2',
            state='disabled',
            command=self._stop_automation
        )
        self._btn_stop.pack(fill='x', padx=12, pady=(0, 12))

        # 구분선
        ttk.Separator(parent, orient='horizontal').pack(fill='x', padx=8)

        # 진행 바
        prog_frame = tk.Frame(parent, bg=self.BG_CTRL)
        prog_frame.pack(fill='x', padx=12, pady=(10, 4))

        self._progress_var = tk.DoubleVar(value=0.0)
        style = ttk.Style()
        style.theme_use('default')
        style.configure('erp.Horizontal.TProgressbar',
                         troughcolor=self.BORDER_IDLE,
                         background=self.BTN_BLUE,
                         thickness=10)
        pb = ttk.Progressbar(prog_frame, variable=self._progress_var,
                              maximum=100, style='erp.Horizontal.TProgressbar')
        pb.pack(fill='x')

        self._progress_label = tk.Label(
            parent, text="대기 중",
            bg=self.BG_CTRL, fg=self.FG_MUTED,
            font=('맑은 고딕', 9)
        )
        self._progress_label.pack(anchor='w', padx=12)

        # 로그
        tk.Label(parent, text="로그", bg=self.BG_CTRL,
                 fg=self.FG_MUTED, font=('맑은 고딕', 9)).pack(anchor='w', padx=12, pady=(10, 2))
        self._log_widget = scrolledtext.ScrolledText(
            parent,
            bg=self.BG_LOG, fg=self.FG_GREEN,
            font=('Consolas', 9),
            wrap='word', state='disabled',
            relief='flat', padx=6, pady=4
        )
        self._log_widget.pack(fill='both', expand=True, padx=12, pady=(0, 12))

        # 저장 안내 (하단 고정)
        tk.Label(
            parent,
            text="⚠ 입력 완료 후 ERP에서 Ctrl+S 저장",
            bg=self.BG_CTRL, fg=self.FG_YELLOW,
            font=('맑은 고딕', 8), wraplength=260, justify='center'
        ).pack(side='bottom', pady=8)

    # ------------------------------------------------------------------
    # Win32 도킹
    # ------------------------------------------------------------------

    def _dock_erp(self, erp_hwnd: int):
        """Win32 SetParent로 ERP 창을 도킹 영역에 임베드."""
        user32 = ctypes.windll.user32

        # 기존 스타일 / 부모 저장
        self._orig_style  = user32.GetWindowLongW(erp_hwnd, GWL_STYLE)
        self._orig_parent = user32.GetParent(erp_hwnd) or 0

        # 스타일: 타이틀바/테두리 제거, WS_CHILD 추가
        new_style = (self._orig_style & ~REMOVE_STYLES) | WS_CHILD | WS_VISIBLE
        user32.SetWindowLongW(erp_hwnd, GWL_STYLE, new_style)

        # 도킹 패널 HWND 획득 (tkinter Frame.winfo_id() = Win32 HWND)
        self.root.update_idletasks()
        dock_hwnd = self._dock_frame.winfo_id()
        w = self._dock_frame.winfo_width()
        h = self._dock_frame.winfo_height()

        # SetParent + MoveWindow
        user32.SetParent(erp_hwnd, dock_hwnd)
        user32.MoveWindow(erp_hwnd, 0, 0, w, h, True)
        user32.SetWindowPos(erp_hwnd, HWND_TOP, 0, 0, w, h,
                            SWP_FRAMECHANGED)

        self._erp_hwnd = erp_hwnd
        self._docked   = True
        self._dock_hint.place_forget()  # 안내 텍스트 숨김

        self._log(f"ERP 창 연결됨 (hwnd={erp_hwnd}, {w}×{h})")
        self._update_status('connected')

    def _undock_erp(self):
        """도킹 해제: SetParent(None) + 원래 스타일 복원."""
        if not self._docked or not self._erp_hwnd:
            return
        user32 = ctypes.windll.user32

        # SetParent를 원래 부모(또는 데스크톱=0)로 복원
        user32.SetParent(self._erp_hwnd, self._orig_parent)
        user32.SetWindowLongW(self._erp_hwnd, GWL_STYLE, self._orig_style)

        # 화면 중앙으로 이동
        sw = user32.GetSystemMetrics(0)
        sh = user32.GetSystemMetrics(1)
        user32.MoveWindow(self._erp_hwnd,
                          sw // 4, sh // 4, sw // 2, sh // 2, True)
        user32.SetWindowPos(self._erp_hwnd, HWND_TOP,
                            sw // 4, sh // 4, sw // 2, sh // 2,
                            SWP_FRAMECHANGED)

        self._docked   = False
        self._erp_hwnd = 0
        # 안내 텍스트 재표시
        self._dock_hint.place(relx=0.5, rely=0.5, anchor='center')
        self._update_status('disconnected')
        self._log("ERP 창 연결 해제됨")

    # ------------------------------------------------------------------
    # 마그넷 스냅
    # ------------------------------------------------------------------

    def _magnet_check(self):
        """300ms 주기: ERP 창 위치 감시 → 근접 시 하이라이트/스냅."""
        try:
            if not self._docked:
                erp_hwnd = self._find_erp_window()
                if erp_hwnd:
                    erp_cx, erp_cy = self._get_window_center(erp_hwnd)
                    dock_cx, dock_cy = self._get_dock_center()
                    dist = ((erp_cx - dock_cx) ** 2 + (erp_cy - dock_cy) ** 2) ** 0.5
                    if dist < self.MAGNET_SNAP_PX:
                        self._dock_erp(erp_hwnd)
                        self._set_dock_border(self.BORDER_CONNECTED)
                    elif dist < self.MAGNET_HIGHLIGHT_PX:
                        self._set_dock_border(self.BORDER_NEAR)
                    else:
                        self._set_dock_border(self.BORDER_IDLE)
                else:
                    self._set_dock_border(self.BORDER_IDLE)
        except Exception:
            pass
        finally:
            if self.root:
                self.root.after(self.POLL_MS, self._magnet_check)

    # ------------------------------------------------------------------
    # 자동화 제어
    # ------------------------------------------------------------------

    def _start_automation(self):
        """▶ 입력 시작 버튼."""
        if not self._docked:
            self._log("ERP 창을 먼저 연결하세요.")
            return

        from .erp_macro import erp_macro
        if erp_macro.get_status()['running']:
            self._log("이미 실행 중입니다.")
            return

        erp_macro._stop_flag = False
        t = threading.Thread(
            target=erp_macro.run,
            args=(self.dates_records,),
            kwargs={'save_daily': False},
            daemon=True
        )
        t.start()
        self._automation_running = True

        self._btn_start.config(state='disabled')
        self._btn_stop.config(state='normal')
        self._log("자동 입력을 시작합니다...")

    def _stop_automation(self):
        """■ 중단 버튼."""
        from .erp_macro import erp_macro
        erp_macro.stop()
        self._log("중단 요청을 전송했습니다...")

    def _poll_status(self):
        """1초 주기: erp_macro 상태 폴링 → 진행 바 + 로그 갱신."""
        try:
            if self._automation_running:
                from .erp_macro import erp_macro
                st = erp_macro.get_status()
                self._update_progress(st)
                if not st['running']:
                    self._automation_running = False
                    self._btn_start.config(state='normal' if self._docked else 'disabled')
                    self._btn_stop.config(state='disabled')
                    has_err = any(
                        kw in l for l in st.get('log', [])
                        for kw in ('오류 발생', '라이브러리 누락', '찾을 수 없습니다')
                    )
                    if has_err:
                        self._log("── ⚠ 오류가 발생했습니다. 위 로그를 확인하세요. ──")
                    elif st.get('progress', 0) > 0:
                        self._log("── ✓ 입력 완료. ERP에서 Ctrl+S 로 저장하세요. ──")
                    else:
                        self._log("── 매크로가 종료되었습니다. ──")
        except Exception:
            pass
        finally:
            if self.root:
                self.root.after(self.STATUS_MS, self._poll_status)

    # ------------------------------------------------------------------
    # 버튼 콜백
    # ------------------------------------------------------------------

    def _connect_button(self):
        """[🔗 ERP 창 연결] 버튼."""
        erp_hwnd = self._find_erp_window()
        if not erp_hwnd:
            self._log("ERP 창을 찾을 수 없습니다. 선진종합시스템을 먼저 실행하세요.")
            return
        self._dock_erp(erp_hwnd)

    def _disconnect_button(self):
        """[🔌 연결 해제] 버튼."""
        self._undock_erp()

    def _on_close(self):
        """창 닫기: 도킹 중이면 해제 후 종료."""
        try:
            if self._docked:
                self._undock_erp()
            from .erp_macro import erp_macro
            if erp_macro.get_status()['running']:
                erp_macro.stop()
                time.sleep(0.5)
        except Exception:
            pass
        finally:
            if self.root:
                self.root.destroy()

    # ------------------------------------------------------------------
    # UI 상태 업데이트 (tkinter 스레드에서만 호출)
    # ------------------------------------------------------------------

    def _update_status(self, state: str):
        """연결 상태 레이블 + 버튼 활성화 상태 갱신."""
        if state == 'connected':
            if self._status_label:
                self._status_label.config(text="● 연결됨", fg=self.FG_GREEN)
            if self._btn_connect:
                self._btn_connect.config(state='disabled')
            if self._btn_disconnect:
                self._btn_disconnect.config(state='normal')
            if self._btn_start:
                self._btn_start.config(state='normal')
        else:
            if self._status_label:
                self._status_label.config(text="● 연결 안됨", fg=self.FG_RED)
            if self._btn_connect:
                self._btn_connect.config(state='normal')
            if self._btn_disconnect:
                self._btn_disconnect.config(state='disabled')
            if self._btn_start:
                self._btn_start.config(state='disabled')

    def _update_progress(self, st: Dict):
        """진행 바 + 진행 레이블 + 로그 갱신."""
        total    = st.get('total', 0)
        progress = st.get('progress', 0)
        current  = st.get('current', '')
        logs     = st.get('log', [])

        if total > 0 and self._progress_var:
            pct = round(progress / total * 100)
            self._progress_var.set(pct)
            if self._progress_label:
                self._progress_label.config(
                    text=f"진행: {progress} / {total} ({pct}%)  {current[:30]}"
                )
        if logs and self._log_widget:
            self._log_widget.config(state='normal')
            self._log_widget.delete('1.0', 'end')
            self._log_widget.insert('end', '\n'.join(logs))
            self._log_widget.see('end')
            self._log_widget.config(state='disabled')

    def _set_dock_border(self, color: str):
        """도킹 패널 외곽 테두리 색 변경."""
        if self._dock_outer:
            self._dock_outer.config(bg=color)

    def _log(self, msg: str):
        """로그 위젯에 한 줄 추가."""
        if not self._log_widget:
            return
        ts = datetime.datetime.now().strftime('%H:%M:%S')
        line = f"[{ts}] {msg}\n"
        try:
            self._log_widget.config(state='normal')
            self._log_widget.insert('end', line)
            self._log_widget.see('end')
            self._log_widget.config(state='disabled')
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Win32 / 좌표 헬퍼
    # ------------------------------------------------------------------

    def _find_erp_window(self) -> int:
        """선진종합시스템 가시 창 hwnd 반환. 없으면 0."""
        try:
            import win32gui
        except ImportError:
            return 0
        result = []

        def _cb(hwnd, _):
            t = win32gui.GetWindowText(hwnd)
            if self.WINDOW_TITLE_KW in t and win32gui.IsWindowVisible(hwnd):
                result.append(hwnd)

        try:
            win32gui.EnumWindows(_cb, None)
        except Exception:
            pass
        return result[0] if result else 0

    def _get_window_center(self, hwnd: int) -> Tuple[int, int]:
        """GetWindowRect → 창 중심 좌표."""
        try:
            import win32gui
            l, t, r, b = win32gui.GetWindowRect(hwnd)
            return (l + r) // 2, (t + b) // 2
        except Exception:
            return 0, 0

    def _get_dock_center(self) -> Tuple[int, int]:
        """도킹 패널의 화면 절대 중심 좌표."""
        if not self._dock_frame or not self.root:
            return 0, 0
        try:
            self.root.update_idletasks()
            x = self._dock_frame.winfo_rootx() + self._dock_frame.winfo_width()  // 2
            y = self._dock_frame.winfo_rooty() + self._dock_frame.winfo_height() // 2
            return x, y
        except Exception:
            return 0, 0
