# src/sync/cloud_sync.py - 클라우드 동기화 (Google Drive / NAS / 공유 폴더)
#
# sync_mode 기반 단방향 명시적 동기화:
#   "company"    — 회사 PC: 시작 시 알림 있으면 pull, 저장/종료 시 push (알림 없음)
#   "external"   — 외부 PC: 시작 시 자동 pull, 수정/종료 시 push + 알림 생성
#   "standalone" — 클라우드 미사용 (기본값)

import json
import os
import shutil
from pathlib import Path
from datetime import datetime
from typing import Optional
from ..utils.logger import logger
from ..utils.config import config


class CloudSync:
    """
    클라우드 동기화 관리
    
    Google Drive, Dropbox, OneDrive 등의 클라우드 저장소와 동기화
    실제로는 클라우드 폴더에 DB 파일을 복사하는 방식으로 동작
    """
    
    NOTIFICATION_FILE = "sync_notification.json"
    LOCK_FILE         = "sync_lock.json"

    def __init__(self):
        self.enabled = config.cloud_sync_enabled
        self.local_db_path = config.db_path
        self.cloud_folder = self._get_cloud_folder()
        self.last_sync = None

        mode = self.sync_mode
        if self.enabled and self.cloud_folder:
            logger.info(f"클라우드 동기화 활성화 [{mode}]: {self.cloud_folder}")
        else:
            logger.info(f"클라우드 동기화 비활성화 [mode={mode}]")

    # ─────────────────────────────────────────────
    # sync_mode 프로퍼티
    # ─────────────────────────────────────────────

    @property
    def sync_mode(self) -> str:
        """현재 동기화 모드: 'company' | 'external' | 'standalone'"""
        return config.get('database.sync_mode', 'standalone')
    
    def _get_cloud_folder(self) -> Optional[Path]:
        """
        클라우드 폴더 경로 가져오기
        
        사용자가 Google Drive, OneDrive, Dropbox 등을 설치하면
        로컬 컴퓨터에 동기화 폴더가 생성됨
        """
        # 설정에서 클라우드 경로 가져오기
        cloud_path = config.get('database.cloud_path')
        
        if cloud_path and os.path.exists(cloud_path):
            return Path(cloud_path)
        
        # 자동 감지 시도
        home = Path.home()
        
        # Google Drive 경로들
        google_drive_paths = [
            home / "Google Drive",
            home / "GoogleDrive",
            home / "G드라이브",
        ]
        
        # OneDrive 경로들
        onedrive_paths = [
            home / "OneDrive",
            home / "OneDrive - Personal",
        ]
        
        # Dropbox 경로들
        dropbox_paths = [
            home / "Dropbox",
        ]
        
        # 모든 가능한 경로 확인
        for path in google_drive_paths + onedrive_paths + dropbox_paths:
            if path.exists():
                work_folder = path / "WorkManagement"
                work_folder.mkdir(parents=True, exist_ok=True)
                logger.info(f"클라우드 폴더 자동 감지: {work_folder}")
                return work_folder
        
        return None
    
    def sync_to_cloud(self) -> bool:
        """로컬 DB를 클라우드로 동기화 (업로드)"""
        if not self.enabled or not self.cloud_folder:
            return False
        
        try:
            if not self.local_db_path.exists():
                logger.warning(f"로컬 DB 파일이 없습니다: {self.local_db_path}")
                return False
            
            # 클라우드 경로
            cloud_db_path = self.cloud_folder / self.local_db_path.name
            
            # 백업 생성 (하루에 한 번만)
            if cloud_db_path.exists():
                today = datetime.now().strftime('%Y%m%d')
                backup_name = f"{cloud_db_path.stem}_backup_{today}.db"
                backup_path = self.cloud_folder / backup_name
                
                # 오늘 백업이 없을 때만 생성
                if not backup_path.exists():
                    shutil.copy2(cloud_db_path, backup_path)
                    logger.info(f"클라우드 백업 생성: {backup_path}")
                    
                    # 오래된 백업 삭제 (최근 10개만 유지)
                    self._cleanup_old_backups()
            
            # 로컬 -> 클라우드 복사
            shutil.copy2(self.local_db_path, cloud_db_path)
            self.last_sync = datetime.now()
            logger.info(f"클라우드 동기화 완료: {cloud_db_path}")
            return True
            
        except Exception as e:
            logger.error(f"클라우드 동기화 실패: {e}")
            return False
    
    def sync_from_cloud(self) -> bool:
        """클라우드 DB를 로컬로 동기화 (다운로드)"""
        if not self.enabled or not self.cloud_folder:
            return False
        
        try:
            cloud_db_path = self.cloud_folder / self.local_db_path.name
            
            if not cloud_db_path.exists():
                logger.warning(f"클라우드 DB 파일이 없습니다: {cloud_db_path}")
                return False
            
            # 로컬 백업 생성 (기존 로컬 파일이 있으면)
            if self.local_db_path.exists():
                backup_dir = self.local_db_path.parent / "backups"
                backup_dir.mkdir(parents=True, exist_ok=True)
                backup_name = f"{self.local_db_path.stem}_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
                backup_path = backup_dir / backup_name
                shutil.copy2(self.local_db_path, backup_path)
                logger.info(f"로컬 백업 생성: {backup_path}")
            
            # 클라우드 -> 로컬 복사
            shutil.copy2(cloud_db_path, self.local_db_path)
            self.last_sync = datetime.now()
            logger.info(f"클라우드에서 동기화 완료: {self.local_db_path}")
            return True
            
        except Exception as e:
            logger.error(f"클라우드에서 동기화 실패: {e}")
            return False
    
    def _cleanup_old_backups(self, keep_count: int = 10):
        """오래된 백업 파일 삭제 (최근 N개만 유지)"""
        try:
            if not self.cloud_folder:
                return
            
            # 모든 백업 파일 찾기
            backup_files = list(self.cloud_folder.glob('*_backup_*.db'))
            
            # 수정 시간 기준 정렬 (최신 순)
            backup_files.sort(key=lambda x: x.stat().st_mtime, reverse=True)
            
            # keep_count개 이상이면 오래된 것 삭제
            if len(backup_files) > keep_count:
                for old_backup in backup_files[keep_count:]:
                    old_backup.unlink()
                    logger.info(f"오래된 백업 삭제: {old_backup.name}")
        except Exception as e:
            logger.error(f"백업 정리 오류: {e}")
    
    def auto_sync(self, direction: str = 'both') -> bool:
        """
        자동 동기화
        
        Args:
            direction: 'to_cloud', 'from_cloud', 'both'
        """
        if not self.enabled:
            return False
        
        success = True
        
        if direction in ['to_cloud', 'both']:
            success = success and self.sync_to_cloud()
        
        if direction in ['from_cloud', 'both']:
            # 스마트 동기화: 더 최신 파일 사용
            success = success and self._smart_sync()
        
        return success
    
    def _get_db_max_updated_at(self, db_path) -> str:
        """DB의 work_records MAX(updated_at) 조회 (충돌 해소용, 실패 시 '' 반환)"""
        try:
            import sqlite3 as _sqlite3
            conn = _sqlite3.connect(str(db_path), timeout=5)
            cursor = conn.cursor()
            cursor.execute("SELECT MAX(updated_at) FROM work_records")
            row = cursor.fetchone()
            conn.close()
            if row and row[0]:
                return row[0]  # e.g. "2026-03-05T14:23:00.123456"
            return ''
        except Exception as e:
            logger.warning(f"DB updated_at 조회 실패 ({db_path.name}): {e}")
            return ''

    def _smart_sync(self) -> bool:
        """
        스마트 동기화: 로컬과 클라우드 중 최신 DB 사용
        파일 mtime 대신 work_records.updated_at 기준으로 비교 (더 정확)
        """
        try:
            cloud_db_path = self.cloud_folder / self.local_db_path.name

            # 둘 다 없으면 패스
            if not self.local_db_path.exists() and not cloud_db_path.exists():
                return True

            # 로컬만 있으면 클라우드로
            if self.local_db_path.exists() and not cloud_db_path.exists():
                return self.sync_to_cloud()

            # 클라우드만 있으면 로컬로
            if not self.local_db_path.exists() and cloud_db_path.exists():
                return self.sync_from_cloud()

            # 둘 다 있으면 work_records.updated_at 기준으로 최신 DB 사용
            local_updated = self._get_db_max_updated_at(self.local_db_path)
            cloud_updated = self._get_db_max_updated_at(cloud_db_path)

            if local_updated or cloud_updated:
                # updated_at 비교 가능한 경우 (ISO 문자열 비교)
                if cloud_updated > local_updated:
                    logger.info(f"클라우드 DB가 더 최신입니다. (cloud={cloud_updated}, local={local_updated})")
                    return self.sync_from_cloud()
                else:
                    logger.info(f"로컬 DB가 더 최신입니다. (local={local_updated}, cloud={cloud_updated})")
                    return self.sync_to_cloud()
            else:
                # updated_at 조회 실패 시 기존 mtime 방식 fallback
                local_mtime = self.local_db_path.stat().st_mtime
                cloud_mtime = cloud_db_path.stat().st_mtime
                if cloud_mtime > local_mtime:
                    logger.info("클라우드 파일이 더 최신입니다. (mtime fallback)")
                    return self.sync_from_cloud()
                else:
                    logger.info("로컬 파일이 더 최신입니다. (mtime fallback)")
                    return self.sync_to_cloud()

        except Exception as e:
            logger.error(f"스마트 동기화 실패: {e}")
            return False
    
    def get_sync_status(self) -> dict:
        """동기화 상태 조회"""
        return {
            'enabled': self.enabled,
            'sync_mode': self.sync_mode,
            'cloud_folder': str(self.cloud_folder) if self.cloud_folder else None,
            'last_sync': self.last_sync.isoformat() if self.last_sync else None,
            'local_exists': self.local_db_path.exists(),
            'cloud_exists': (self.cloud_folder / self.local_db_path.name).exists() if self.cloud_folder else False,
            'notification_exists': self.check_notification(),
            'lock_exists': self.check_lock(),
        }

    # ─────────────────────────────────────────────
    # 알림 파일 (sync_notification.json)
    # 외부 PC → 회사 PC 변경 알림
    # ─────────────────────────────────────────────

    def check_notification(self) -> bool:
        """알림 파일 존재 여부"""
        if not self.cloud_folder:
            return False
        return (self.cloud_folder / self.NOTIFICATION_FILE).exists()

    def create_notification(self) -> bool:
        """알림 파일 생성 (외부 PC가 변경 후 호출)"""
        if not self.cloud_folder:
            return False
        try:
            notification_path = self.cloud_folder / self.NOTIFICATION_FILE
            data = {
                'timestamp': datetime.now().isoformat(),
                'source': 'external',
            }
            with open(notification_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            logger.info(f"알림 파일 생성: {notification_path}")
            return True
        except Exception as e:
            logger.error(f"알림 파일 생성 실패: {e}")
            return False

    def delete_notification(self) -> bool:
        """알림 파일 삭제 (회사 PC가 변경 반영 후 호출)"""
        if not self.cloud_folder:
            return False
        try:
            notification_path = self.cloud_folder / self.NOTIFICATION_FILE
            if notification_path.exists():
                notification_path.unlink()
                logger.info("알림 파일 삭제 완료")
            return True
        except Exception as e:
            logger.error(f"알림 파일 삭제 실패: {e}")
            return False

    # ─────────────────────────────────────────────
    # 잠금 파일 (sync_lock.json)
    # 외부 PC 사용 중 표시 → 동시 접속 경고용
    # ─────────────────────────────────────────────

    def check_lock(self) -> bool:
        """잠금 파일 존재 여부"""
        if not self.cloud_folder:
            return False
        return (self.cloud_folder / self.LOCK_FILE).exists()

    def create_lock(self) -> bool:
        """잠금 파일 생성 (외부 PC 접속 시)"""
        if not self.cloud_folder:
            return False
        try:
            lock_path = self.cloud_folder / self.LOCK_FILE
            data = {
                'timestamp': datetime.now().isoformat(),
                'source': 'external',
            }
            with open(lock_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            logger.info(f"잠금 파일 생성: {lock_path}")
            return True
        except Exception as e:
            logger.error(f"잠금 파일 생성 실패: {e}")
            return False

    def delete_lock(self) -> bool:
        """잠금 파일 삭제 (외부 PC 종료/연결 해제 시)"""
        if not self.cloud_folder:
            return False
        try:
            lock_path = self.cloud_folder / self.LOCK_FILE
            if lock_path.exists():
                lock_path.unlink()
                logger.info("잠금 파일 삭제 완료")
            return True
        except Exception as e:
            logger.error(f"잠금 파일 삭제 실패: {e}")
            return False

    # ─────────────────────────────────────────────
    # 외부 PC 연결
    # ─────────────────────────────────────────────

    def connect_external(self, cloud_path: str) -> dict:
        """
        외부 PC에서 클라우드에 연결 (관리자 전용)

        1. 클라우드 경로 검증
        2. 클라우드 DB 존재 확인
        3. 잠금 파일 존재 여부 반환 (경고용)
        4. 로컬 DB 백업
        5. 클라우드 DB → 로컬 복사
        6. 잠금 파일 생성
        7. sync_mode = "external", cloud_path 저장

        Returns:
            {success, warning, message}
        """
        try:
            # 1. 경로 검증
            cloud_dir = Path(cloud_path)
            if not cloud_dir.exists():
                return {'success': False, 'message': f'경로를 찾을 수 없습니다: {cloud_path}'}

            # 2. 클라우드 DB 확인
            cloud_db = cloud_dir / self.local_db_path.name
            if not cloud_db.exists():
                return {
                    'success': False,
                    'message': '클라우드에 DB 파일이 없습니다. 회사 PC에서 먼저 동기화해주세요.'
                }

            # 3. 잠금 파일 확인 (경고만 — 사용자가 계속 가능)
            lock_path = cloud_dir / self.LOCK_FILE
            warning = None
            if lock_path.exists():
                try:
                    with open(lock_path, 'r', encoding='utf-8') as f:
                        lock_data = json.load(f)
                    ts = lock_data.get('timestamp', '')
                    warning = f'다른 PC에서 사용 중입니다 (접속 시각: {ts[:16]}). 계속 진행하면 덮어쓸 수 있습니다.'
                except Exception:
                    warning = '다른 PC에서 사용 중일 수 있습니다.'

            # 4. 로컬 DB 백업
            if self.local_db_path.exists():
                backup_dir = self.local_db_path.parent / 'backups'
                backup_dir.mkdir(parents=True, exist_ok=True)
                backup_name = f"{self.local_db_path.stem}_before_external_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
                shutil.copy2(self.local_db_path, backup_dir / backup_name)
                logger.info(f"외부 연결 전 로컬 백업: {backup_dir / backup_name}")

            # 5. 클라우드 DB → 로컬 복사
            self.local_db_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(cloud_db, self.local_db_path)
            logger.info(f"외부 PC 연결: 클라우드 DB → 로컬 복사 완료")

            # 6. 잠금 파일 생성 (cloud_folder가 바뀌기 전에 새 경로로)
            lock_new = cloud_dir / self.LOCK_FILE
            try:
                lock_data = {'timestamp': datetime.now().isoformat(), 'source': 'external'}
                with open(lock_new, 'w', encoding='utf-8') as f:
                    json.dump(lock_data, f, indent=2, ensure_ascii=False)
                logger.info(f"잠금 파일 생성 완료: {lock_new}")
            except Exception as e:
                logger.error(f"잠금 파일 생성 실패 (접속 중단): {e}")
                return {'success': False, 'message': f'동기화 잠금을 설정할 수 없습니다. ({e})\n디스크 공간 또는 권한을 확인하세요.'}

            # 7. 설정 저장 및 인스턴스 갱신
            config.set('database.cloud_path', cloud_path)
            config.set('database.cloud_sync_enabled', True)
            config.set('database.sync_mode', 'external')
            config.save()

            self.cloud_folder = cloud_dir
            self.enabled = True
            self.last_sync = datetime.now()

            logger.info(f"외부 PC 클라우드 연결 완료: {cloud_path}")
            return {
                'success': True,
                'warning': warning,
                'message': f'클라우드 연결 완료: {cloud_path}',
                'cloud_path': cloud_path,
            }

        except Exception as e:
            logger.error(f"외부 PC 클라우드 연결 실패: {e}")
            return {'success': False, 'message': f'연결 실패: {str(e)}'}

    def disconnect_external(self) -> dict:
        """
        외부 PC 연결 해제

        1. 로컬 DB → 클라우드 push
        2. 알림 파일 생성
        3. 잠금 파일 삭제
        4. sync_mode = "standalone"
        """
        try:
            # 1. push
            if not self.sync_to_cloud():
                logger.warning("연결 해제 중 push 실패 — 알림/잠금은 계속 처리")

            # 2. 알림 생성
            self.create_notification()

            # 3. 잠금 삭제
            self.delete_lock()

            # 4. 모드 변경
            config.set('database.sync_mode', 'standalone')
            config.set('database.cloud_sync_enabled', False)
            config.save()
            self.enabled = False

            logger.info("외부 PC 연결 해제 완료")
            return {'success': True, 'message': '클라우드 연결이 해제되었습니다.'}

        except Exception as e:
            logger.error(f"외부 PC 연결 해제 실패: {e}")
            return {'success': False, 'message': f'연결 해제 실패: {str(e)}'}

    def sync_to_cloud_notify(self) -> bool:
        """
        외부 PC 전용: 로컬 → 클라우드 push + 알림 파일 생성
        """
        ok = self.sync_to_cloud()
        if ok:
            self.create_notification()
        return ok


# 싱글톤 인스턴스
cloud_sync = CloudSync()
