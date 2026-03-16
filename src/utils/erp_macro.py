# src/utils/erp_macro.py - ERP 입력 자동화 (선진종합시스템 2014)

import re
import time
import threading
import datetime
from typing import List, Dict, Any

from .logger import logger


class ERPMacro:
    """
    선진종합시스템 2014 ERP 자동 입력 클래스

    작동 방식:
    1. win32gui로 ERP 창을 찾아 포커스를 이동
    2. 왼쪽 달력에서 날짜를 클릭 (좌표 계산 방식)
    3. Ctrl+N으로 신규 행 생성
    4. 계약번호 → Enter(팝업 자동 선택) → 작업내용 → 인원 → 동반자 입력
    5. Ctrl+S로 저장
    """

    WINDOW_TITLE_KEYWORD = '선진종합시스템'

    # 달력 패널 좌표 상수 (ERP 창 기본 크기 기준)
    CAL_LEFT_OFFSET = 10    # 창 좌측에서 달력 시작 X 오프셋
    CAL_TOP_OFFSET  = 175   # 창 상단에서 달력 시작 Y 오프셋 (헤더 포함)
    MONTH_HEADER_H  = 46    # 월별 헤더 높이
    CELL_W          = 28    # 날짜 셀 너비
    CELL_H          = 18    # 날짜 셀 높이

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

    def run(self, dates_records: List[Dict]) -> None:
        """
        매크로 메인 루프 (백그라운드 스레드에서 호출)

        dates_records 형식:
            [{'date': 'YYYY-MM-DD', 'records': [{'contractNumber': ..., ...}]}, ...]
        """
        try:
            import pyautogui
            import win32gui
            import win32con
        except ImportError as e:
            self._set_status(running=False)
            self._log(f"필수 라이브러리 누락: {e}. pip install pyautogui pywin32")
            return

        self._stop_flag = False
        total = sum(len(d.get('records', [])) for d in dates_records)
        with self._lock:
            self._status.update({'running': True, 'progress': 0,
                                 'total': total, 'current': '', 'log': []})

        hwnd = self._find_erp_window(win32gui)
        if not hwnd:
            self._log("ERP 창을 찾을 수 없습니다. 선진종합시스템을 먼저 실행해 주세요.")
            self._set_status(running=False)
            return

        self._activate_window(hwnd, win32gui, win32con)
        pyautogui.FAILSAFE = True   # 마우스를 화면 모서리로 이동 시 중단
        pyautogui.PAUSE = 0.05      # 각 동작 사이 기본 딜레이

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
                self._navigate_to_date(date_str, hwnd, pyautogui, win32gui)

                for rec in records:
                    if self._stop_flag:
                        break
                    contract = rec.get('contractNumber', '').strip()
                    work_content = rec.get('workContent', '').strip()
                    if not contract and not work_content:
                        continue

                    with self._lock:
                        self._status['current'] = f"{date_str} / {contract}"

                    self._enter_record(rec, pyautogui)
                    done += 1
                    with self._lock:
                        self._status['progress'] = done
                    self._log(f"  ✓ {contract} {work_content[:20]} 입력 완료")

                # 하루치 저장
                if not self._stop_flag:
                    self._save(pyautogui)
                    self._log(f"[{date_str}] 저장 완료")

        except Exception as e:
            logger.error(f"ERP 매크로 실행 오류: {e}")
            self._log(f"오류 발생: {e}")
        finally:
            self._set_status(running=False)
            self._log("매크로 종료.")

    # ------------------------------------------------------------------
    # 내부 구현
    # ------------------------------------------------------------------

    def _find_erp_window(self, win32gui) -> int:
        """ERP 창 핸들 반환. 없으면 0."""
        result = []

        def _cb(hwnd, _):
            title = win32gui.GetWindowText(hwnd)
            if self.WINDOW_TITLE_KEYWORD in title and win32gui.IsWindowVisible(hwnd):
                result.append(hwnd)

        win32gui.EnumWindows(_cb, None)
        return result[0] if result else 0

    def _activate_window(self, hwnd, win32gui, win32con):
        """ERP 창을 최상위로 가져와 포커스 설정"""
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        win32gui.SetForegroundWindow(hwnd)
        time.sleep(0.6)

    def _get_window_rect(self, hwnd, win32gui) -> tuple:
        """창의 (left, top, right, bottom) 반환"""
        return win32gui.GetWindowRect(hwnd)

    def _get_calendar_cell_pos(self, target_date_str: str, hwnd, win32gui) -> tuple:
        """
        달력 패널에서 target_date의 절대 좌표 (x, y) 계산.

        선진종합시스템 달력은 창 왼쪽에 고정 배치되며 일요일 시작 기준.
        현재 화면에 표시된 첫 번째 달을 today.replace(day=1)로 가정.
        """
        from datetime import date as _date
        target = _date.fromisoformat(target_date_str)
        today = _date.today()
        first_visible = today.replace(day=1)

        month_offset = (target.year - first_visible.year) * 12 + \
                       (target.month - first_visible.month)

        # 해당 달 1일의 요일 → 일요일 기준 오프셋 (일=0, 월=1, ..., 토=6)
        first_weekday = _date(target.year, target.month, 1).weekday()  # 월=0..일=6
        sunday_offset = (first_weekday + 1) % 7  # 일요일=0 기준으로 변환

        cell_index = sunday_offset + target.day - 1
        row = cell_index // 7
        col = cell_index % 7

        MONTH_TOTAL_H = self.MONTH_HEADER_H + 7 * self.CELL_H

        rect = self._get_window_rect(hwnd, win32gui)
        win_left, win_top = rect[0], rect[1]

        x = win_left + self.CAL_LEFT_OFFSET + col * self.CELL_W + self.CELL_W // 2
        y = (win_top + self.CAL_TOP_OFFSET
             + month_offset * MONTH_TOTAL_H
             + self.MONTH_HEADER_H
             + row * self.CELL_H
             + self.CELL_H // 2)
        return int(x), int(y)

    def _navigate_to_date(self, date_str: str, hwnd, pyautogui, win32gui):
        """달력에서 해당 날짜 셀 클릭"""
        try:
            x, y = self._get_calendar_cell_pos(date_str, hwnd, win32gui)
            pyautogui.click(x, y)
            time.sleep(0.4)
        except Exception as e:
            self._log(f"날짜 이동 실패 ({date_str}): {e}")

    def _enter_record(self, record: dict, pyautogui):
        """
        신규 레코드 1건 입력 순서:
        Ctrl+N → 계약번호 타이핑 → 팝업 Enter → Right×3 → 작업내용
        → Right × 1 → 인원 → Right × 2 → 동반자
        """
        contract  = record.get('contractNumber', '').strip()
        work_content = record.get('workContent', '').strip()
        leader    = record.get('leader', '')
        teammates = record.get('teammates', '')

        # 본공 인원 계산
        in_house, _ = self._calc_in_house(leader, teammates)
        manpower_str = str(int(in_house)) if in_house == int(in_house) else str(in_house)

        # 동반자 이름 (공백 구분)
        workers_str = self._format_workers(leader, teammates)

        # 1) 신규 행 생성
        pyautogui.hotkey('ctrl', 'n')
        time.sleep(0.4)

        # 2) 공사(계약번호) 필드 — 계약번호 입력 후 팝업 선택
        if contract:
            pyautogui.typewrite(contract, interval=0.05)
            time.sleep(0.8)   # 팝업 대기
            pyautogui.press('enter')
            time.sleep(0.4)

        # 3) 우측 방향키 3번 → 작업내용 필드
        pyautogui.press('right', presses=3, interval=0.08)
        if work_content:
            # 한글 입력은 typewrite가 지원 안 됨 → pyperclip + paste 사용
            self._type_korean(work_content, pyautogui)
            time.sleep(0.2)

        # 4) 우측 방향키 1번 → 인원 필드
        pyautogui.press('right')
        if manpower_str and manpower_str != '0':
            pyautogui.typewrite(manpower_str, interval=0.05)
            time.sleep(0.1)

        # 5) 담당자 건너뜀 → 우측 방향키 2번 → 동반자 필드
        pyautogui.press('right', presses=2, interval=0.08)
        if workers_str:
            self._type_korean(workers_str, pyautogui)
            time.sleep(0.2)

        # 다음 행으로 이동 (Enter 또는 아래 방향키)
        pyautogui.press('enter')
        time.sleep(0.2)

    def _save(self, pyautogui):
        """Ctrl+S로 저장"""
        pyautogui.hotkey('ctrl', 's')
        time.sleep(0.6)

    def _type_korean(self, text: str, pyautogui):
        """
        한글/특수문자 포함 텍스트 입력.
        pyperclip으로 클립보드에 복사 후 Ctrl+V 붙여넣기.
        """
        try:
            import pyperclip
            pyperclip.copy(text)
            pyautogui.hotkey('ctrl', 'v')
        except ImportError:
            # pyperclip 없으면 typewrite로 폴백 (한글 깨질 수 있음)
            pyautogui.typewrite(text, interval=0.03)

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
            # 도급: 업체명(이름들) 제거
            cleaned = re.sub(r'[^,]+\([^)]*\)', '', text)
            # 일당: 업체명[이름들] 제거
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
