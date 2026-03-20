"""
Mock ERP Window — 선진종합시스템 2014 테스트용
=============================================
실제 ERP가 없는 환경에서 erp_macro.py를 테스트하기 위한 Mock 창.

실행:
    python tools/mock_erp.py

특징:
- 창 제목: "작업일지등록 - 선진종합시스템 2014"
- 좌측: tkinter 달력 (erp_macro의 비례 좌표 계산과 동일한 비율)
- 우측: 그리드 (Ctrl+N → 행 추가, Right/Enter → 열 이동, Ctrl+S → 저장)
- 계약번호 Enter → 팝업 → Enter 선택
- 로그 패널: 매크로 동작 실시간 기록
"""

import sys
import ctypes
import tkinter as tk
from tkinter import ttk, messagebox
import calendar
import datetime

# DPI 설정 (고해상도 모니터)
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(1)
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

# ──────────────────────────────────────────────
# 로그 콜백 (스레드 안전)
# ──────────────────────────────────────────────
_app_instance = None   # 싱글톤

def fire_log(msg: str):
    if _app_instance:
        _app_instance.append_log(msg)


# ──────────────────────────────────────────────
# 메인 앱
# ──────────────────────────────────────────────
class MockERPApp:
    TITLE = '작업일지등록 - 선진종합시스템 2014'

    # 그리드 열 정의: (헤더, 너비)
    COLUMNS = [
        ('작업일',   80),
        ('순번',     50),
        ('공사',    130),
        ('선시',     60),
        ('선박',     80),
        ('작업내용', 160),
        ('인원',     50),
        ('담당자',   80),
        ('동반자',  160),
    ]

    # 매크로가 편집하는 실제 열 인덱스 (0-based)
    # 공사=2, 작업내용=5, 인원=6, 동반자=8
    EDIT_COLS = [2, 5, 6, 8]

    def __init__(self, root: tk.Tk):
        global _app_instance
        _app_instance = self

        self.root = root
        self.root.title(self.TITLE)
        self.root.geometry('1300x800')
        self.root.configure(bg='#f0f0f0')
        self.root.protocol('WM_DELETE_WINDOW', self._on_close)

        # 상태
        self._edit_row   = None
        self._edit_col   = 0      # EDIT_COLS 인덱스
        self._edit_entry = None
        self._hint_id    = None
        self._selected_date = datetime.date.today()
        self._cal_year   = datetime.date.today().year
        self._cal_month  = datetime.date.today().month

        self._build_ui()

    # ─────────────────────────────────────────
    # UI 빌드
    # ─────────────────────────────────────────
    def _build_ui(self):
        # ── 상단 필터 바 ──
        self._build_filter_bar()

        # ── 메인 영역 ──
        pane = tk.PanedWindow(self.root, orient=tk.HORIZONTAL,
                               bg='#c8c8c8', sashwidth=5, sashrelief=tk.RAISED)
        pane.pack(fill=tk.BOTH, expand=True, padx=0, pady=0)

        # 좌: 달력
        self._cal_frame = tk.Frame(pane, bg='white', width=290)
        self._cal_frame.pack_propagate(False)
        pane.add(self._cal_frame, minsize=290)

        # 우: 그리드
        right_frame = tk.Frame(pane, bg='white')
        pane.add(right_frame, minsize=600)
        self._build_grid(right_frame)

        # ── 로그 패널 (하단) ──
        self._build_log_panel()

        # ── 상태바 ──
        self._status_var = tk.StringVar(value='대기중 — Ctrl+N: 신규 행  |  Ctrl+S: 저장')
        tk.Label(self.root, textvariable=self._status_var, anchor='w',
                 relief=tk.SUNKEN, bg='#e0e0e0', font=('맑은 고딕', 9),
                 padx=6).pack(side=tk.BOTTOM, fill=tk.X)

        # 달력 렌더
        self.root.update_idletasks()
        self._draw_calendar()

        # 키바인딩
        self.root.bind('<Control-n>', self._on_ctrl_n)
        self.root.bind('<Control-N>', self._on_ctrl_n)
        self.root.bind('<Control-s>', self._on_ctrl_s)
        self.root.bind('<Control-S>', self._on_ctrl_s)

        # 시작 로그
        self.append_log('▶ Mock ERP 준비 완료')
        self.append_log('  창 제목: ' + self.TITLE)
        self.append_log('  Ctrl+N: 신규 행  |  Ctrl+S: 저장  |  Enter/→: 다음 열')

    def _build_filter_bar(self):
        bar = tk.Frame(self.root, bg='#dce4ee', height=34)
        bar.pack(fill=tk.X)
        bar.pack_propagate(False)

        def lbl(text):
            return tk.Label(bar, text=text, bg='#dce4ee', font=('맑은 고딕', 9))
        def btn(text, cmd=None):
            return tk.Button(bar, text=text, font=('맑은 고딕', 8),
                             relief=tk.GROOVE, width=5, bg='#c8d4e0',
                             command=cmd or (lambda: None))

        lbl('자사구분:').pack(side=tk.LEFT, padx=(8, 2))
        cb = ttk.Combobox(bar, values=['선진종합'], width=10, font=('맑은 고딕', 9))
        cb.set('선진종합')
        cb.pack(side=tk.LEFT, padx=2, pady=5)

        today = datetime.date.today()
        lbl('기간:').pack(side=tk.LEFT, padx=(10, 2))
        e1 = tk.Entry(bar, width=12, font=('맑은 고딕', 9)); e1.pack(side=tk.LEFT, padx=2, pady=5)
        e1.insert(0, today.replace(day=1).strftime('%Y-%m-%d'))
        lbl('~').pack(side=tk.LEFT)
        e2 = tk.Entry(bar, width=12, font=('맑은 고딕', 9)); e2.pack(side=tk.LEFT, padx=2, pady=5)
        e2.insert(0, today.strftime('%Y-%m-%d'))

        for t in ['◀', '▶', '당월', '전체']:
            btn(t).pack(side=tk.LEFT, padx=1, pady=5)

        cb2 = ttk.Combobox(bar, values=['공사', '전체'], width=8, font=('맑은 고딕', 9))
        cb2.set('공사'); cb2.pack(side=tk.LEFT, padx=4, pady=5)

    def _build_grid(self, parent):
        cols = [c[0] for c in self.COLUMNS]
        self.tree = ttk.Treeview(parent, columns=cols, show='headings',
                                  selectmode='browse')
        for name, width in self.COLUMNS:
            self.tree.heading(name, text=name)
            self.tree.column(name, width=width, minwidth=30, anchor='center')

        vsb = ttk.Scrollbar(parent, orient='vertical', command=self.tree.yview)
        self.tree.configure(yscrollcommand=vsb.set)
        vsb.pack(side=tk.RIGHT, fill=tk.Y)
        self.tree.pack(fill=tk.BOTH, expand=True)

        # 안내 행
        self._hint_id = self.tree.insert('', 'end',
            values=('', '', '* Click here to add a new row', '', '', '', '', '', ''),
            tags=('hint',))
        self.tree.tag_configure('hint', foreground='#888888')

        self.tree.bind('<Double-1>', self._on_double_click)

        style = ttk.Style()
        style.configure('Treeview', font=('맑은 고딕', 9), rowheight=22)
        style.configure('Treeview.Heading', font=('맑은 고딕', 9, 'bold'))

    def _build_log_panel(self):
        frame = tk.LabelFrame(self.root, text=' 매크로 로그 ',
                               font=('맑은 고딕', 9), bg='#f0f0f0', height=150)
        frame.pack(fill=tk.X, side=tk.BOTTOM, padx=4, pady=(0, 2))
        frame.pack_propagate(False)

        self._log_text = tk.Text(frame, font=('Consolas', 9),
                                  bg='#1e1e1e', fg='#cccccc',
                                  wrap=tk.NONE, state=tk.DISABLED)
        sb = ttk.Scrollbar(frame, command=self._log_text.yview)
        self._log_text.configure(yscrollcommand=sb.set)
        sb.pack(side=tk.RIGHT, fill=tk.Y)
        self._log_text.pack(fill=tk.BOTH, expand=True)

    # ─────────────────────────────────────────
    # 달력 (비례 레이아웃 — erp_macro 좌표 계산과 동일)
    # ─────────────────────────────────────────
    def _draw_calendar(self):
        """
        비율 배분 (erp_macro._fallback_click_date_by_rect와 동일):
          헤더  15%  (월/년 + 이전/다음 버튼)
          요일  7%   (일 월 화 수 목 금 토)
          그리드 78% (7열 × 6행)
        """
        for w in self._cal_frame.winfo_children():
            w.destroy()

        y, m = self._cal_year, self._cal_month
        self._cal_frame.update_idletasks()

        # ── 헤더 (15%) ──
        hdr = tk.Frame(self._cal_frame, bg='#3a6fa0')
        hdr.place(relx=0, rely=0, relwidth=1, relheight=0.15)
        tk.Button(hdr, text='◀', bg='#3a6fa0', fg='white', relief=tk.FLAT,
                  font=('맑은 고딕', 11, 'bold'),
                  activebackground='#2a5f90', activeforeground='white',
                  command=self._prev_month).place(relx=0, rely=0, relwidth=0.14, relheight=1)
        tk.Label(hdr, text=f'{m}월  {y}', bg='#3a6fa0', fg='white',
                 font=('맑은 고딕', 10, 'bold')).place(
                 relx=0.14, rely=0, relwidth=0.72, relheight=1)
        tk.Button(hdr, text='▶', bg='#3a6fa0', fg='white', relief=tk.FLAT,
                  font=('맑은 고딕', 11, 'bold'),
                  activebackground='#2a5f90', activeforeground='white',
                  command=self._next_month).place(relx=0.86, rely=0, relwidth=0.14, relheight=1)

        # ── 요일 헤더 (7%) ──
        dow_frame = tk.Frame(self._cal_frame, bg='#dce8f4')
        dow_frame.place(relx=0, rely=0.15, relwidth=1, relheight=0.07)
        for i, d in enumerate(['일', '월', '화', '수', '목', '금', '토']):
            fg = '#cc2222' if i == 0 else ('#2222cc' if i == 6 else '#333333')
            tk.Label(dow_frame, text=d, bg='#dce8f4', fg=fg,
                     font=('맑은 고딕', 8, 'bold')).place(
                     relx=i / 7, rely=0, relwidth=1 / 7, relheight=1)

        # ── 날짜 그리드 (78%) ──
        grid = tk.Frame(self._cal_frame, bg='white')
        grid.place(relx=0, rely=0.22, relwidth=1, relheight=0.78)

        _, days_in_month = calendar.monthrange(y, m)
        first_wd = datetime.date(y, m, 1).weekday()   # 0=Mon
        sunday_offset = (first_wd + 1) % 7             # 변환: 0=Sun

        for day in range(1, days_in_month + 1):
            idx = sunday_offset + day - 1
            row = idx // 7
            col = idx % 7
            d_obj = datetime.date(y, m, day)
            is_today = (d_obj == datetime.date.today())
            is_sel   = (d_obj == self._selected_date)

            if is_sel:
                bg = '#ffdd44'
            elif is_today:
                bg = '#cce4ff'
            elif col == 0:
                bg = '#fff0f0'
            elif col == 6:
                bg = '#f0f0ff'
            else:
                bg = 'white'

            fg = '#cc2222' if col == 0 else ('#2222cc' if col == 6 else '#111111')
            tk.Button(
                grid, text=str(day), bg=bg, fg=fg,
                relief=tk.FLAT, font=('맑은 고딕', 9),
                activebackground='#aaccff',
                command=lambda d=d_obj: self._select_date(d)
            ).place(relx=col / 7, rely=row / 6, relwidth=1 / 7, relheight=1 / 6)

        # Today 버튼 (최하단 고정)
        btn_frame = tk.Frame(self._cal_frame, bg='#f0f0f0', height=28)
        btn_frame.place(relx=0, rely=0.93, relwidth=1, relheight=0.07)
        tk.Button(btn_frame, text='Today', font=('맑은 고딕', 9),
                  relief=tk.GROOVE, bg='#e0e8f0',
                  command=lambda: self._select_date(datetime.date.today())
                  ).place(relx=0.25, rely=0.1, relwidth=0.5, relheight=0.8)

    def _select_date(self, d: datetime.date):
        self._selected_date = d
        self._cal_year  = d.year
        self._cal_month = d.month
        self._draw_calendar()
        self.append_log(f'📅 날짜 선택: {d.strftime("%Y-%m-%d")}')
        self._set_status(f'선택 날짜: {d.strftime("%Y-%m-%d")}  —  Ctrl+N: 신규 행 추가')

    def _prev_month(self):
        d = datetime.date(self._cal_year, self._cal_month, 1) - datetime.timedelta(days=1)
        self._cal_year, self._cal_month = d.year, d.month
        self._draw_calendar()

    def _next_month(self):
        d = datetime.date(self._cal_year, self._cal_month, 28) + datetime.timedelta(days=7)
        self._cal_year, self._cal_month = d.year, d.month
        self._draw_calendar()

    # ─────────────────────────────────────────
    # 그리드 편집
    # ─────────────────────────────────────────
    def _on_ctrl_n(self, event=None):
        """Ctrl+N — 새 행 추가"""
        self._remove_hint()
        date_str = self._selected_date.strftime('%Y-%m-%d')
        row_count = len(self.tree.get_children())
        row_id = self.tree.insert('', 'end',
                    values=(date_str, row_count + 1, '', '', '', '', '', '', ''))
        self.tree.see(row_id)
        self.append_log(f'➕ Ctrl+N → 신규 행 #{row_count + 1} ({date_str})')
        self.root.after(50, lambda: self._start_edit(row_id, edit_idx=0))

    def _on_ctrl_s(self, event=None):
        """Ctrl+S — 저장"""
        self._commit_edit()
        count = len(self.tree.get_children())
        self.append_log(f'💾 Ctrl+S → 저장 완료 ({count}건)')
        self._set_status(f'저장됨 ({count}건)')
        messagebox.showinfo('저장', f'{count}건이 저장되었습니다.', parent=self.root)

    def _on_double_click(self, event):
        item = self.tree.identify_row(event.y)
        col  = self.tree.identify_column(event.x)
        if not item or item == self._hint_id:
            self._on_ctrl_n()
            return
        col_idx = int(col.replace('#', '')) - 1   # 0-based 실제 열
        # EDIT_COLS 중 가장 가까운 인덱스
        edit_idx = min(range(len(self.EDIT_COLS)),
                       key=lambda i: abs(self.EDIT_COLS[i] - col_idx))
        self._start_edit(item, edit_idx=edit_idx)

    def _start_edit(self, row_id, edit_idx: int):
        """편집 Entry 오버레이 표시"""
        self._commit_edit()
        if not self.tree.exists(row_id):
            return

        self._edit_row = row_id
        self._edit_col = edit_idx
        tree_col = self.EDIT_COLS[edit_idx]   # 실제 열 인덱스

        self.tree.selection_set(row_id)
        self.tree.update_idletasks()
        bbox = self.tree.bbox(row_id, f'#{tree_col + 1}')
        if not bbox:
            return

        x, y, w, h = bbox
        cur_vals = self.tree.item(row_id)['values']
        cur_val  = cur_vals[tree_col] if cur_vals and len(cur_vals) > tree_col else ''

        self._edit_entry = tk.Entry(self.tree, font=('맑은 고딕', 9),
                                     relief=tk.SOLID, bd=1,
                                     highlightbackground='#2288ff',
                                     highlightthickness=1)
        self._edit_entry.insert(0, str(cur_val) if cur_val else '')
        self._edit_entry.select_range(0, tk.END)
        self._edit_entry.place(x=x, y=y, width=w + 1, height=h)
        self._edit_entry.focus_set()

        col_name = self.COLUMNS[tree_col][0]
        hint = '계약번호 입력 후 Enter → 팝업' if tree_col == self.EDIT_COLS[0] else f'Enter: 다음 열  |  Esc: 취소'
        self._set_status(f'편집 중: [{col_name}]  —  {hint}')
        self.append_log(f'  ✏ [{col_name}] 편집 활성화')

        self._edit_entry.bind('<Return>', lambda e: self._on_enter())
        self._edit_entry.bind('<Right>',  lambda e: self._on_enter())
        self._edit_entry.bind('<Tab>',    lambda e: (self._on_enter(), 'break'))
        self._edit_entry.bind('<Escape>', lambda e: self._cancel_edit())

    def _on_enter(self):
        """현재 셀 값 저장 + 다음 셀로 이동 (또는 팝업)"""
        if not self._edit_row or not self.tree.exists(self._edit_row):
            return
        if not self._edit_entry:
            return

        tree_col = self.EDIT_COLS[self._edit_col]
        val = self._edit_entry.get()
        col_name = self.COLUMNS[tree_col][0]

        # 값 저장
        vals = list(self.tree.item(self._edit_row)['values'])
        while len(vals) < len(self.COLUMNS):
            vals.append('')
        vals[tree_col] = val
        self.tree.item(self._edit_row, values=vals)
        self.append_log(f'  ✎ {col_name}: "{val}"')

        row_id     = self._edit_row
        next_idx   = self._edit_col + 1

        # 공사 열 → 계약 팝업
        if tree_col == self.EDIT_COLS[0] and val.strip():
            self._commit_edit()
            self._show_contract_popup(val.strip(), row_id, next_idx)
            return

        self._commit_edit()
        if next_idx < len(self.EDIT_COLS):
            self.root.after(50, lambda: self._start_edit(row_id, edit_idx=next_idx))
        else:
            self.append_log('✅ 행 입력 완료')
            self._set_status('입력 완료 — Ctrl+N: 신규 행  |  Ctrl+S: 저장')

    def _commit_edit(self):
        if self._edit_entry:
            try:
                self._edit_entry.destroy()
            except Exception:
                pass
            self._edit_entry = None
        self._edit_row = None
        self._edit_col = 0

    def _cancel_edit(self):
        self._commit_edit()
        self._set_status('편집 취소')

    def _show_contract_popup(self, contract_text: str, row_id, next_idx: int):
        """계약 선택 팝업 (실제 ERP의 공사 팝업 시뮬레이션)"""
        self.append_log(f'  📋 계약 팝업 표시: "{contract_text}"')

        dlg = tk.Toplevel(self.root)
        dlg.title('공사 선택')
        dlg.geometry('380x170')
        dlg.resizable(False, False)
        dlg.transient(self.root)
        dlg.grab_set()

        tk.Label(dlg, text='공사를 선택하세요:', font=('맑은 고딕', 10),
                 anchor='w', padx=12).pack(fill=tk.X, pady=(12, 2))

        lb = tk.Listbox(dlg, font=('맑은 고딕', 10), height=3, activestyle='dotbox')
        lb.insert(0, f'선진종합 - {contract_text}')
        lb.selection_set(0)
        lb.pack(fill=tk.X, padx=12, pady=4)

        def confirm(_event=None):
            self.append_log(f'  📋 팝업 → "{contract_text}" Enter 선택')
            dlg.destroy()
            if self.tree.exists(row_id):
                self.root.after(80, lambda: self._start_edit(row_id, edit_idx=next_idx))

        tk.Button(dlg, text='선택  (Enter)', font=('맑은 고딕', 10),
                  command=confirm, default=tk.ACTIVE,
                  bg='#3a6fa0', fg='white', relief=tk.FLAT,
                  padx=16).pack(pady=6)
        dlg.bind('<Return>', confirm)
        lb.focus_set()

    def _remove_hint(self):
        if self._hint_id and self.tree.exists(self._hint_id):
            self.tree.delete(self._hint_id)
            self._hint_id = None

    # ─────────────────────────────────────────
    # 로그
    # ─────────────────────────────────────────
    def append_log(self, msg: str):
        ts   = datetime.datetime.now().strftime('%H:%M:%S')
        line = f'[{ts}] {msg}\n'

        def _do():
            self._log_text.config(state=tk.NORMAL)
            self._log_text.insert(tk.END, line)
            self._log_text.see(tk.END)
            self._log_text.config(state=tk.DISABLED)
        try:
            self.root.after(0, _do)
        except Exception:
            pass

    def _set_status(self, msg: str):
        self._status_var.set(msg)

    def _on_close(self):
        self.root.destroy()


# ──────────────────────────────────────────────
# 진입점
# ──────────────────────────────────────────────
def main():
    root = tk.Tk()
    app  = MockERPApp(root)
    root.mainloop()


if __name__ == '__main__':
    main()
