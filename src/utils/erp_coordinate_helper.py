# src/utils/erp_coordinate_helper.py
# 좌표 기반 클릭/입력 헬퍼 — fallback 전용

import time
from datetime import date as _date


class CoordinateHelper:
    """
    좌표 기반 클릭/입력 헬퍼.
    주 수단이 아닌 fallback 전용으로만 사용.
    pyautogui / win32gui 는 호출 시점에 인자로 전달받아 lazy import 유지.
    """

    def click(self, x: int, y: int, pyautogui, delay: float = 0.1):
        """지정 좌표 단순 클릭."""
        pyautogui.click(int(x), int(y))
        time.sleep(delay)

    def click_in_rect(self, rect: tuple, pyautogui,
                      offset_ratio=(0.5, 0.5), delay: float = 0.1):
        """
        rect = (left, top, right, bottom) 기준으로 비율 좌표 클릭.
        offset_ratio=(0.5, 0.5) → 중앙 클릭.
        """
        left, top, right, bottom = rect
        x = left + (right - left) * offset_ratio[0]
        y = top  + (bottom - top) * offset_ratio[1]
        pyautogui.click(int(x), int(y))
        time.sleep(delay)

    def fallback_click_calendar_cell(self, cal_hwnd: int, target_date: '_date',
                                     win32gui, pyautogui, delay: float = 0.4) -> bool:
        """
        달력 컨트롤의 GetWindowRect 기반으로 목표 날짜 셀 동적 좌표 클릭.
        하드코딩 없이 컨트롤 실제 크기를 사용하므로 창 크기 변경에도 안정적.
        반환: True = 클릭 시도 완료, False = 예외 발생
        """
        try:
            cal_rect = win32gui.GetWindowRect(cal_hwnd)
            left, top, right, bottom = cal_rect
            cal_w = right - left
            cal_h = bottom - top

            # 헤더(월 제목) 영역: 상단 ~15%, 요일 행: 추가 ~7%
            header_h  = int(cal_h * 0.15)
            weekday_h = int(cal_h * 0.07)
            grid_top  = top + header_h + weekday_h
            grid_h    = cal_h - header_h - weekday_h
            cell_w    = cal_w // 7
            cell_h    = grid_h // 6  # 최대 6주

            # 1일 기준 일요일 시작 열 오프셋
            first_weekday  = _date(target_date.year, target_date.month, 1).weekday()
            sunday_offset  = (first_weekday + 1) % 7
            cell_index     = sunday_offset + target_date.day - 1
            row = cell_index // 7
            col = cell_index % 7

            x = left + col * cell_w + cell_w // 2
            y = grid_top + row * cell_h + cell_h // 2

            pyautogui.click(int(x), int(y))
            time.sleep(delay)
            return True
        except Exception:
            return False

    def type_text(self, text: str, pyautogui, interval: float = 0.03):
        """ASCII 텍스트 직접 타이핑 (한글 불가; 한글은 _type_korean 사용)."""
        pyautogui.typewrite(text, interval=interval)

    def type_korean(self, text: str, pyautogui):
        """
        한글/특수문자 포함 텍스트 입력.
        pyperclip으로 클립보드 복사 후 Ctrl+V 붙여넣기.
        """
        try:
            import pyperclip
            pyperclip.copy(text)
            pyautogui.hotkey('ctrl', 'v')
        except ImportError:
            pyautogui.typewrite(text, interval=0.03)


# 싱글톤 인스턴스 (필요 시 from .erp_coordinate_helper import coord_helper)
coord_helper = CoordinateHelper()
