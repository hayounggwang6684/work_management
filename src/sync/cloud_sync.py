# src/sync/cloud_sync.py - 클라우드 동기화 (Google Drive)

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
    
    def __init__(self):
        self.enabled = config.cloud_sync_enabled
        self.local_db_path = config.db_path
        self.cloud_folder = self._get_cloud_folder()
        self.last_sync = None
        
        if self.enabled and self.cloud_folder:
            logger.info(f"클라우드 동기화 활성화: {self.cloud_folder}")
        else:
            logger.info("클라우드 동기화 비활성화")
    
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
    
    def _smart_sync(self) -> bool:
        """
        스마트 동기화: 로컬과 클라우드 중 최신 파일 사용
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
            
            # 둘 다 있으면 최신 파일 사용
            local_mtime = self.local_db_path.stat().st_mtime
            cloud_mtime = cloud_db_path.stat().st_mtime
            
            if cloud_mtime > local_mtime:
                logger.info("클라우드 파일이 더 최신입니다.")
                return self.sync_from_cloud()
            else:
                logger.info("로컬 파일이 더 최신입니다.")
                return self.sync_to_cloud()
                
        except Exception as e:
            logger.error(f"스마트 동기화 실패: {e}")
            return False
    
    def get_sync_status(self) -> dict:
        """동기화 상태 조회"""
        return {
            'enabled': self.enabled,
            'cloud_folder': str(self.cloud_folder) if self.cloud_folder else None,
            'last_sync': self.last_sync.isoformat() if self.last_sync else None,
            'local_exists': self.local_db_path.exists(),
            'cloud_exists': (self.cloud_folder / self.local_db_path.name).exists() if self.cloud_folder else False
        }


# 싱글톤 인스턴스
cloud_sync = CloudSync()
