# src/main.py - 메인 애플리케이션

import os
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

# 선택적 패키지 자동 설치 (현장 PC 대응)
_OPTIONAL_PACKAGES = ['xlrd']
for _pkg in _OPTIONAL_PACKAGES:
    try:
        __import__(_pkg)
    except ImportError:
        print(f"[설치] {_pkg} 패키지를 설치합니다...")
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', _pkg],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"[완료] {_pkg} 설치 완료")

# pystray / Pillow 자동 설치 (트레이 아이콘 기능)
try:
    import pystray
    from PIL import Image as PILImage
    _TRAY_AVAILABLE = True
except ImportError:
    try:
        print("[설치] pystray, Pillow 패키지를 설치합니다...")
        subprocess.check_call(
            [sys.executable, '-m', 'pip', 'install', 'pystray', 'Pillow', '-q'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        import pystray
        from PIL import Image as PILImage
        _TRAY_AVAILABLE = True
        print("[완료] pystray, Pillow 설치 완료")
    except Exception:
        _TRAY_AVAILABLE = False

import eel

# 프로젝트 루트를 Python 경로에 추가
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.utils.logger import logger
from src.utils.config import config
from src.sync.cloud_sync import cloud_sync
from src.utils.patch_system import patch_system
from src.utils.update_manager import update_manager
from src.utils.telegram_notifier import telegram_notifier
from src.utils.daily_scheduler import daily_scheduler
import src.web.api  # API 함수들을 로드


# ---------------------------------------------------------------------------
# 트레이 아이콘 — 전역 상태
# ---------------------------------------------------------------------------
_tray_preference: bool = False  # 기본값: 앱 완전 종료 (사용자가 설정에서 켜야 활성화)
_tray_icon = None               # pystray.Icon 인스턴스 (트레이 활성화 시 생성)


@eel.expose
def set_python_tray_mode(enabled: bool):
    """JS에서 로그인·설정변경 시 Python 전역 tray_preference 동기화"""
    global _tray_preference
    _tray_preference = bool(enabled)


def _do_full_cleanup():
    """앱 종료 전 정리 — finally 블록과 트레이 '종료' 메뉴 양쪽에서 호출"""
    try:
        telegram_notifier.stop_polling()
    except Exception:
        pass
    try:
        daily_scheduler.stop()
    except Exception:
        pass
    try:
        _exit_mode = cloud_sync.sync_mode
        if _exit_mode == 'company' and cloud_sync.enabled:
            logger.info("종료 시 클라우드 동기화 실행 [company]...")
            cloud_sync.sync_to_cloud()
        elif _exit_mode == 'external' and cloud_sync.enabled:
            logger.info("종료 시 클라우드 동기화 + 알림 생성 [external]...")
            cloud_sync.sync_to_cloud()
            cloud_sync.create_notification()
            cloud_sync.delete_lock()
    except Exception:
        pass
    logger.info(f"{config.app_name} 종료")


def _open_window_from_tray():
    """트레이 → 앱 창 다시 열기 (Eel과 동일한 브라우저 감지 + 동일한 플래그 사용)"""
    url = 'http://localhost:8686/index.html'
    w = config.get('ui.window_width', 1400)
    h = config.get('ui.window_height', 900)
    # Eel과 동일한 플래그 — disable-http-cache로 캐시 문제 방지
    extra_args = [f'--window-size={w},{h}', '--disable-http-cache']

    # Eel의 레지스트리 기반 find_path()로 실제 설치 경로 우선 탐색
    try:
        import eel.chrome as _eel_chrome
        import eel.edge as _eel_edge
        chrome_path = _eel_chrome.find_path()
        if chrome_path:
            subprocess.Popen([chrome_path, f'--app={url}'] + extra_args)
            return
        edge_path = _eel_edge.find_path()
        if edge_path:
            subprocess.Popen([edge_path, f'--app={url}'] + extra_args)
            return
    except Exception:
        pass

    # 폴백: 하드코딩 경로
    fallback_paths = [
        os.path.expandvars(r'%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe'),
        r'C:\Program Files\Google\Chrome\Application\chrome.exe',
        r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
        r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
        r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    ]
    for p in fallback_paths:
        if os.path.exists(p):
            subprocess.Popen([p, f'--app={url}'] + extra_args)
            return
    webbrowser.open(url)


def _tray_open(icon, item):
    threading.Thread(target=_open_window_from_tray, daemon=True).start()


def _tray_exit(icon, item):
    """트레이 '종료' 메뉴 → 완전 종료"""
    global _tray_icon
    if _tray_icon:
        _tray_icon.stop()
        _tray_icon = None
    _do_full_cleanup()
    os._exit(0)


def _ensure_tray_visible():
    """트레이 아이콘 생성 및 표시 (이미 표시 중이면 무시)"""
    global _tray_icon
    if _tray_icon is not None:
        return
    if not _TRAY_AVAILABLE:
        logger.warning("pystray 미사용 — 트레이 대신 앱 종료")
        _do_full_cleanup()
        os._exit(0)
        return
    try:
        icon_path = Path(__file__).parent.parent / 'assets' / 'icon.ico'
        image = PILImage.open(str(icon_path))
        menu = pystray.Menu(
            pystray.MenuItem('열기', _tray_open, default=True),   # 더블클릭 → 열기
            pystray.MenuItem('종료', _tray_exit),
        )
        _tray_icon = pystray.Icon('work_management', image, '금일작업현황 관리', menu)
        threading.Thread(target=_tray_icon.run, name='tray-icon', daemon=True).start()
        logger.info("트레이 아이콘 활성화")
    except Exception as e:
        logger.error(f"트레이 아이콘 생성 실패: {e}")
        _do_full_cleanup()
        os._exit(0)


def _close_callback(page, sockets):
    """Eel 창 닫힘 이벤트 — 마지막 창이 닫힐 때만 동작"""
    if sockets:   # 다른 창 아직 열려 있으면 무시
        return
    if _tray_preference and _TRAY_AVAILABLE:
        # sys.exit() 호출 안 함 → eel.start() 블로킹 유지
        # 텔레그램 폴링 · 일일 스케줄러 · 클라우드 동기화 백그라운드 계속 실행
        _ensure_tray_visible()
    else:
        _do_full_cleanup()
        os._exit(0)


def _detect_browser_mode() -> str:
    """사용 가능한 브라우저 모드 감지 (Chrome → Edge → default 순)"""
    import shutil
    import os

    # Chrome 경로 후보
    chrome_paths = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    ]
    for p in chrome_paths:
        if os.path.exists(p):
            return 'chrome'

    # Edge 경로 후보 (Chromium 기반 — Eel 호환)
    edge_paths = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    for p in edge_paths:
        if os.path.exists(p):
            return 'edge'

    # 그 외: 시스템 기본 브라우저 (탭으로 열림)
    return 'default'


def main():
    """메인 애플리케이션 실행"""
    logger.info("="*60)
    logger.info(f"{config.app_name} v{config.version} 시작")
    logger.info("="*60)

    # 패치 확인 및 적용 (GitHub에서 자동 다운로드 + 적용)
    try:
        logger.info("GitHub에서 패치 확인 및 자동 다운로드 중...")
        patch_result = update_manager.download_and_apply_patches()
        applied = patch_result.get('applied_count', 0)
        if applied > 0:
            logger.info(f"패치 {applied}개 적용 완료. 재시작 필요.")
        elif patch_result.get('downloaded_count', 0) > 0:
            logger.info(f"패치 {patch_result['downloaded_count']}개 다운로드됨.")
        else:
            # 다운로드할 것 없으면 로컬 patches/ 폴더만 재확인 (수동 설치 패치 대비)
            applied = patch_system.check_and_apply_patches()
            if applied > 0:
                logger.info(f"로컬 패치 {applied}개 적용 완료.")
        # 패치가 적용된 경우 자동 재시작 (Python 프로세스 교체 → 신코드 로드)
        if applied > 0:
            import json as _json
            marker = Path(__file__).parent.parent / "data" / "just_updated.json"
            marker.parent.mkdir(exist_ok=True)
            marker.write_text(_json.dumps({
                "applied_count": applied,
                "version": config.version
            }), encoding='utf-8')
            logger.info(f"패치 {applied}개 적용 완료. 자동 재시작...")
            # 새 Python 프로세스 시작 후 현재 프로세스 종료
            subprocess.Popen([sys.executable] + sys.argv)
            sys.exit(0)

        patch_system._startup_patches_applied = applied
    except Exception as e:
        logger.error(f"패치 확인/적용 오류: {e}")
        patch_system._startup_patches_applied = 0
        # GitHub 접근 실패 시 로컬 패치만 적용
        try:
            local = patch_system.check_and_apply_patches()
            if local > 0:
                import json as _json
                marker = Path(__file__).parent.parent / "data" / "just_updated.json"
                marker.parent.mkdir(exist_ok=True)
                marker.write_text(_json.dumps({
                    "applied_count": local,
                    "version": config.version
                }), encoding='utf-8')
                logger.info(f"로컬 패치 {local}개 적용 완료. 자동 재시작...")
                subprocess.Popen([sys.executable] + sys.argv)
                sys.exit(0)
            patch_system._startup_patches_applied = local
        except Exception as e2:
            logger.error(f"로컬 패치 적용 오류: {e2}")

    # Eel 초기화
    web_folder = Path(__file__).parent.parent / "web"
    eel.init(str(web_folder), allowed_extensions=['.js', '.html'])

    # 시작 시 클라우드 동기화 (sync_mode 기반)
    _sync_mode = cloud_sync.sync_mode
    if _sync_mode == 'company' and cloud_sync.enabled:
        if cloud_sync.check_notification():
            logger.info("외부 PC 변경 알림 감지 → 클라우드 DB 반영 후 시작")
            cloud_sync.sync_from_cloud()
            cloud_sync.delete_notification()
            # 클라우드 DB 덮어쓰기 후 관리자 계정 재보장
            from src.database.auth_manager import auth_manager as _am
            _am.ensure_admin_account()
        else:
            logger.info("변경 알림 없음 → 로컬 DB 그대로 사용 [company]")
    elif _sync_mode == 'external' and cloud_sync.enabled:
        logger.info("외부 PC 시작 → 클라우드 DB 자동 pull")
        cloud_sync.sync_from_cloud()
        # 클라우드 DB 덮어쓰기 후 관리자 계정 재보장
        from src.database.auth_manager import auth_manager as _am
        _am.ensure_admin_account()

    # 브라우저 모드 결정 (Chrome → Edge → 기본 브라우저 순으로 시도)
    browser_mode = _detect_browser_mode()
    logger.info(f"브라우저 모드: {browser_mode}")

    # 창 옵션
    window_options = {
        'mode': browser_mode,
        'host': 'localhost',
        'port': 8686,
        'size': (config.get('ui.window_width', 1400),
                config.get('ui.window_height', 900)),
        'position': 'center',
        'disable_cache': config.get('ui.enable_dev_tools', False)
    }

    # DB에서 텔레그램 설정 보완 로드 (다른 PC에서 settings.json에 토큰이 없을 때)
    if not config.get('telegram.bot_token', ''):
        from src.database.db_manager import db as _db
        db_token = _db.get_setting('telegram.bot_token', '')
        if db_token:
            db_enabled = _db.get_setting('telegram.enabled', 'false') == 'true'
            config.set('telegram.bot_token', db_token)
            config.set('telegram.enabled', db_enabled)
            logger.info("텔레그램 설정을 DB app_settings에서 로드했습니다.")

    # 텔레그램 봇 폴링 시작
    telegram_notifier.start_polling()

    # 일일 스케줄러 시작 (자동 백업 + 텔레그램 일일 요약)
    daily_scheduler.start()

    try:
        # 앱 실행
        logger.info(f"웹 UI 시작: http://localhost:{window_options['port']}")
        eel.start('index.html', close_callback=_close_callback, **window_options)

    except KeyboardInterrupt:
        logger.info("사용자에 의해 종료됨")

    except Exception as e:
        logger.error(f"애플리케이션 오류: {e}")
        import traceback as _tb
        try:
            from src.database.db_manager import db as _db
            _db.add_error_report('system', 'SYSTEM', config.version, 'startup', str(e), _tb.format_exc())
        except Exception:
            pass
        raise
    
    finally:
        # os._exit() 경로(트레이 '종료' 메뉴)에서는 이 블록이 실행되지 않음 — 정상
        _do_full_cleanup()


if __name__ == '__main__':
    main()
