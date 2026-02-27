# src/main.py - 메인 애플리케이션

import subprocess
import sys
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

import eel

# 프로젝트 루트를 Python 경로에 추가
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.utils.logger import logger
from src.utils.config import config
from src.sync.cloud_sync import cloud_sync
from src.utils.patch_system import patch_system
from src.utils.update_manager import update_manager
from src.utils.telegram_notifier import telegram_notifier
import src.web.api  # API 함수들을 로드


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
    
    # 시작 시 클라우드 동기화 (스마트 동기화)
    if cloud_sync.enabled:
        logger.info("시작 시 클라우드 동기화 실행...")
        cloud_sync.auto_sync(direction='from_cloud')
    
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

    try:
        # 앱 실행
        logger.info(f"웹 UI 시작: http://localhost:{window_options['port']}")
        eel.start('index.html', **window_options)

    except KeyboardInterrupt:
        logger.info("사용자에 의해 종료됨")

    except Exception as e:
        logger.error(f"애플리케이션 오류: {e}")
        raise
    
    finally:
        # 텔레그램 봇 폴링 중단
        telegram_notifier.stop_polling()

        # 종료 시 클라우드 동기화
        if cloud_sync.enabled:
            logger.info("종료 시 클라우드 동기화 실행...")
            cloud_sync.sync_to_cloud()
        
        logger.info(f"{config.app_name} 종료")


if __name__ == '__main__':
    main()
