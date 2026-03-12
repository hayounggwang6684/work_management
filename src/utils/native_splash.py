"""
native_splash.py — 네이티브 tkinter 스플래시 화면
앱 실행 즉시 표시되어 공백 구간을 없애주는 Python 창.
웹 스플래시(splash.js)와 동일한 디자인 및 구동 방식 재현.
"""

import os
import sys
import threading
from pathlib import Path

# 임베디드 Python 배포 시 tcl/tk 폴더 위치를 환경변수로 지정
# (표준 Python 설치본은 자동으로 찾으므로 이미 있으면 덮어쓰지 않음)
def _setup_tcl_tk_path():
    """임베디드 Python에서 tcl8.6 / tk8.6 경로를 자동으로 설정."""
    python_dir = Path(sys.executable).parent
    tcl_dir = python_dir / "tcl8.6"
    tk_dir  = python_dir / "tk8.6"
    if tcl_dir.exists() and not os.environ.get('TCL_LIBRARY'):
        os.environ['TCL_LIBRARY'] = str(tcl_dir)
    if tk_dir.exists() and not os.environ.get('TK_LIBRARY'):
        os.environ['TK_LIBRARY'] = str(tk_dir)

_setup_tcl_tk_path()

try:
    import tkinter as tk
    from tkinter import font as tkfont
    _TK_OK = True
except Exception:
    _TK_OK = False

# 웹 splash.js의 STEPS 배열과 동일한 11단계
STEPS = [
    (5,   "⚙️ 엔진 예열 중...",            "기어 돌아가는 소리가 들리시나요?"),
    (15,  "🔧 렌치 찾는 중...",             "공구함 어디 뒀더라..."),
    (25,  "📋 작업일지 펼치는 중...",        "오늘도 열심히 해봅시다!"),
    (35,  "🚢 선박 현황 확인 중...",         "모든 배가 제자리에 있는지 확인합니다"),
    (45,  "🗄️ 데이터베이스 깨우는 중...",  "DB가 기지개를 켜고 있습니다"),
    (55,  "👷 작업자 명단 불러오는 중...",  "오늘 출근 체크!"),
    (65,  "📡 서버와 악수하는 중...",        "통신 채널 확보 중..."),
    (75,  "🔐 보안 점검 중...",             "자물쇠 꼭 잠겼나 확인합니다"),
    (85,  "🎨 화면 단장 중...",             "예쁘게 꾸며드리겠습니다"),
    (95,  "✅ 거의 다 됐습니다!",            "마지막 점검 중..."),
    (100, "🚀 준비 완료!",                  "출항 준비 완료입니다"),
]


class NativeSplash:
    """tkinter 기반 네이티브 스플래시 창 (웹 버전과 동일한 디자인)."""

    W, H = 580, 380

    # 배경 그래디언트
    BG_TOP = "#0f172a"   # 상단/하단 (매우 짙은 파란-검정)
    BG_MID = "#1e3a5f"   # 중앙 (진한 파란색)

    # 텍스트 색상
    C_WHITE = "#ffffff"   # 앱 이름
    C_BLUE3 = "#93c5fd"   # 영문 서브타이틀 (blue-300)
    C_BLUE2 = "#bfdbfe"   # 주 메시지    (blue-200)
    C_SL4   = "#94a3b8"   # 서브 메시지   (slate-400)
    C_SL5   = "#64748b"   # 퍼센트 텍스트 (slate-500)
    C_SL6   = "#475569"   # 버전 텍스트   (slate-600)

    # 프로그레스 바
    C_PB_BG = "#334155"   # 배경 (slate-700)
    C_PB_FG = "#60a5fa"   # 채우기 (blue-400, cyan-400 방향 근사)
    PB_W    = 288         # 프로그레스 바 너비(px)

    def __init__(self, app_name: str, version: str, logo_path: str = None):
        self._app_name    = app_name
        self._version     = version
        self._logo_path   = logo_path   # 현재 미사용 (향후 PIL 로고 옵션)
        self._root        = None
        self._canvas      = None
        self._ready       = threading.Event()
        self._step_idx    = 0
        self._current_pct = 0
        self._closed      = False
        # Canvas 동적 요소 ID
        self._msg_id  = None
        self._sub_id  = None
        self._pb_fg   = None
        self._pb_x    = 0
        self._pct_id  = None

    # ------------------------------------------------------------------
    # 공개 API
    # ------------------------------------------------------------------

    def start(self):
        """daemon 스레드에서 tkinter 창을 시작하고, 창이 뜰 때까지 대기."""
        if not _TK_OK:
            return
        t = threading.Thread(target=self._run, daemon=True)
        t.start()
        self._ready.wait(timeout=2.0)  # 최대 2초 대기

    def update(self, msg: str, pct: int = None):
        """
        외부(main.py)에서 호출 — 메시지·진행률을 특정 % 위치로 점프.
        auto-step은 계속 실행되며 이 %보다 낮은 단계는 건너뜀.
        """
        if not self._root or self._closed:
            return

        def _do():
            if self._closed:
                return
            target_pct = pct if pct is not None else self._current_pct
            # STEPS에서 target_pct 이상인 첫 단계로 step_idx 점프
            for i, (p, _m, _s) in enumerate(STEPS):
                if p >= target_pct:
                    self._step_idx = i
                    break
            self._apply_update(msg, STEPS[self._step_idx][2], target_pct)

        self._root.after(0, _do)

    def close(self):
        """600ms 페이드아웃 후 destroy — 웹 closeSplash()와 동일한 타이밍."""
        if not self._root or self._closed:
            return
        self._closed = True

        def _fade(alpha: float = 1.0):
            if alpha <= 0:
                try:
                    self._root.destroy()
                except Exception:
                    pass
                return
            try:
                self._root.attributes('-alpha', alpha)
                self._root.after(30, lambda: _fade(round(alpha - 0.05, 2)))
            except Exception:
                pass

        self._root.after(0, _fade)

    # ------------------------------------------------------------------
    # 내부 구현
    # ------------------------------------------------------------------

    def _run(self):
        """tkinter mainloop — daemon 스레드 내부에서 실행."""
        try:
            root = tk.Tk()
            self._root = root
            root.overrideredirect(True)          # 타이틀바 제거
            root.attributes('-topmost', True)    # 최상위 창

            # 화면 중앙 배치
            sw = root.winfo_screenwidth()
            sh = root.winfo_screenheight()
            x  = (sw - self.W) // 2
            y  = (sh - self.H) // 2
            root.geometry(f"{self.W}x{self.H}+{x}+{y}")

            self._build_ui(root)
            self._ready.set()                    # start() 대기 해제
            self._schedule_auto_step(root)       # 자동 진행 시작
            root.mainloop()
        except Exception:
            self._ready.set()

    def _build_ui(self, root: 'tk.Tk'):
        """UI 요소 생성 (Canvas 위에 모든 요소 배치)."""
        c = tk.Canvas(root, width=self.W, height=self.H,
                      bd=0, highlightthickness=0)
        c.pack(fill='both', expand=True)
        self._canvas = c

        # 1) 배경 그래디언트
        self._draw_gradient(c)

        # 2) 앱 이름 — "금일작업현황 관리" (흰색, 22pt Bold)
        fn_title = tkfont.Font(family="Malgun Gothic", size=22, weight="bold")
        c.create_text(self.W // 2, 110,
                      text=self._app_name,
                      fill=self.C_WHITE, font=fn_title, anchor='center')

        # 3) 영문 서브타이틀 — blue-300, 9pt
        fn_sub = tkfont.Font(family="Malgun Gothic", size=9)
        c.create_text(self.W // 2, 142,
                      text="WORK MANAGEMENT SYSTEM",
                      fill=self.C_BLUE3, font=fn_sub, anchor='center')

        # 4) 주 메시지 (동적) — blue-200, 11pt
        fn_msg = tkfont.Font(family="Malgun Gothic", size=11)
        self._msg_id = c.create_text(self.W // 2, 210,
                                     text=STEPS[0][1],
                                     fill=self.C_BLUE2, font=fn_msg,
                                     anchor='center')

        # 5) 서브 메시지 (동적) — slate-400, 9pt
        fn_sub2 = tkfont.Font(family="Malgun Gothic", size=9)
        self._sub_id = c.create_text(self.W // 2, 232,
                                     text=STEPS[0][2],
                                     fill=self.C_SL4, font=fn_sub2,
                                     anchor='center')

        # 6) 프로그레스 바 배경 (288×8, slate-700)
        pb_x = (self.W - self.PB_W) // 2
        self._pb_x = pb_x
        c.create_rectangle(pb_x, 258, pb_x + self.PB_W, 266,
                            fill=self.C_PB_BG, outline='')

        # 7) 프로그레스 바 채우기 (초기 0px)
        self._pb_fg = c.create_rectangle(pb_x, 258, pb_x, 266,
                                         fill=self.C_PB_FG, outline='')

        # 8) 퍼센트 텍스트 — slate-500, 8pt
        fn_pct = tkfont.Font(family="Malgun Gothic", size=8)
        self._pct_id = c.create_text(self.W // 2, 277,
                                     text="0%",
                                     fill=self.C_SL5, font=fn_pct,
                                     anchor='center')

        # 9) 버전 텍스트 (하단) — slate-600, 8pt
        fn_ver = tkfont.Font(family="Malgun Gothic", size=8)
        c.create_text(self.W // 2, self.H - 18,
                      text=f"v{self._version}\u00a0|\u00a0HA Engineering",
                      fill=self.C_SL6, font=fn_ver, anchor='center')

    def _draw_gradient(self, canvas: 'tk.Canvas'):
        """수직 그래디언트: BG_TOP → BG_MID → BG_TOP (웹 135° 그래디언트 재현)."""

        def _lerp(c1: str, c2: str, t: float) -> str:
            r = int(int(c1[1:3], 16) * (1 - t) + int(c2[1:3], 16) * t)
            g = int(int(c1[3:5], 16) * (1 - t) + int(c2[3:5], 16) * t)
            b = int(int(c1[5:7], 16) * (1 - t) + int(c2[5:7], 16) * t)
            return f'#{r:02x}{g:02x}{b:02x}'

        half = self.H // 2
        for y in range(self.H):
            t = y / half if y < half else (self.H - y) / half
            color = _lerp(self.BG_TOP, self.BG_MID, min(t, 1.0))
            canvas.create_line(0, y, self.W, y, fill=color)

    def _schedule_auto_step(self, root: 'tk.Tk'):
        """600ms마다 자동으로 다음 단계로 진행 (웹 startAutoProgress와 동일)."""

        def _step():
            if self._closed:
                return
            if self._step_idx < len(STEPS) - 1:
                self._step_idx += 1
                pct, msg, sub = STEPS[self._step_idx]
                if pct > self._current_pct:
                    self._apply_update(msg, sub, pct)
            root.after(600, _step)

        root.after(600, _step)

    def _apply_update(self, msg: str, sub: str, pct: int):
        """Canvas 요소 갱신 — tkinter mainloop 스레드 내에서만 호출."""
        c = self._canvas
        if c is None:
            return
        c.itemconfigure(self._msg_id, text=msg)
        c.itemconfigure(self._sub_id, text=sub)
        c.itemconfigure(self._pct_id, text=f"{pct}%")
        # 프로그레스 바 너비 갱신
        new_w = int(self.PB_W * pct / 100)
        c.coords(self._pb_fg,
                 self._pb_x, 258,
                 self._pb_x + new_w, 266)
        self._current_pct = pct
