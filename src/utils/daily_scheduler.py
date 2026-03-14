# src/utils/daily_scheduler.py — 일일 자동 작업 스케줄러
# 60초 간격으로 시각을 확인해 자동 백업·텔레그램 일일 요약을 실행한다.

import threading
import time
from datetime import datetime

from .logger import logger
from .config import config


class DailyScheduler:
    """분 단위 일일 작업 스케줄러 (백그라운드 daemon 스레드)"""

    def __init__(self):
        self._running = False
        self._thread: threading.Thread = None
        self._ran_today: dict = {}   # task_key -> 'YYYY-MM-DD' (중복 실행 방지)

    def start(self):
        """스케줄러 백그라운드 스레드 시작 (이미 실행 중이면 무시)"""
        if self._thread and self._thread.is_alive():
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._run, name='daily-scheduler', daemon=True
        )
        self._thread.start()
        logger.info("일일 스케줄러 시작")

    def stop(self):
        """스케줄러 중단"""
        self._running = False

    # -------------------------------------------------------------------------
    # 내부 루프
    # -------------------------------------------------------------------------

    def _run(self):
        while self._running:
            try:
                self._tick()
            except Exception as e:
                logger.error(f"스케줄러 오류: {e}")
            time.sleep(60)

    def _tick(self):
        now = datetime.now()
        today = now.strftime('%Y-%m-%d')
        hm = now.strftime('%H:%M')

        # ── 자동 백업 ──────────────────────────────────────────────────────────
        backup_time = config.get('backup.auto_schedule_time', '')
        if backup_time and hm == backup_time and self._ran_today.get('backup') != today:
            self._ran_today['backup'] = today
            self._do_backup()

        # ── 일일 작업 요약 텔레그램 발송 (복수 시각 지원) ─────────────────────
        summary_times = config.get('telegram.daily_summary_times', [])
        if not summary_times:                         # 구버전 호환
            _single = config.get('telegram.daily_summary_time', '')
            if _single:
                summary_times = [_single]
        if isinstance(summary_times, str):
            summary_times = [summary_times]
        for _t in summary_times:
            _key = f'summary_{_t}'
            if _t and hm == _t and self._ran_today.get(_key) != today:
                self._ran_today[_key] = today   # 주말에도 마킹 (중복 방지)
                if now.isoweekday() <= 5:        # 평일(월=1~금=5)만 발송
                    self._do_daily_summary(today)
                else:
                    logger.info(f"일일 요약 건너뜀 (주말: {now.strftime('%A')})")

    # -------------------------------------------------------------------------
    # 실행 작업
    # -------------------------------------------------------------------------

    def _do_backup(self):
        try:
            from .settings_manager import settings_manager
            result = settings_manager.create_backup()
            if result.get('success'):
                logger.info(f"자동 백업 완료: {result.get('message', '')}")
            else:
                logger.error(f"자동 백업 실패: {result.get('message', '')}")
        except Exception as e:
            logger.error(f"자동 백업 오류: {e}")

    def _do_daily_summary(self, date: str):
        try:
            from .telegram_notifier import telegram_notifier
            if telegram_notifier.enabled and telegram_notifier.bot_token:
                telegram_notifier.send_daily_summary(date)
        except Exception as e:
            logger.error(f"일일 요약 발송 오류: {e}")


# 싱글톤 인스턴스
daily_scheduler = DailyScheduler()
