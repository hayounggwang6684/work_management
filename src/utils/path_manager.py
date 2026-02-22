# src/utils/path_manager.py - 경로 관리

import shutil
from pathlib import Path
from typing import Optional, Dict, Any
from datetime import datetime

from .logger import logger
from .config import config


class PathManager:
    """경로 및 저장 위치 관리"""
    
    def __init__(self):
        self.settings_file = Path(config.db_path).parent.parent / "config" / "path_settings.json"
        self._ensure_settings_file()
    
    def _ensure_settings_file(self):
        """설정 파일 생성"""
        import json
        
        if not self.settings_file.exists():
            self.settings_file.parent.mkdir(parents=True, exist_ok=True)
            default_settings = {
                'local_db_path': str(config.db_path),
                'backup_path': str(Path.home() / 'Documents' / 'WorkManagement_Backup'),
                'cloud_sync_enabled': True,
                'last_updated': datetime.now().isoformat()
            }
            with open(self.settings_file, 'w', encoding='utf-8') as f:
                json.dump(default_settings, f, indent=2, ensure_ascii=False)
    
    def get_paths(self) -> Dict[str, Any]:
        """현재 경로 설정 조회"""
        import json
        
        try:
            with open(self.settings_file, 'r', encoding='utf-8') as f:
                settings = json.load(f)
            return settings
        except Exception as e:
            logger.error(f"경로 설정 로드 실패: {e}")
            return {
                'local_db_path': str(config.db_path),
                'backup_path': str(Path.home() / 'Documents' / 'WorkManagement_Backup'),
                'cloud_sync_enabled': True
            }
    
    def update_local_path(self, new_path: str) -> Dict[str, Any]:
        """로컬 DB 경로 변경"""
        import json
        
        try:
            new_path = Path(new_path)
            
            # 경로 유효성 검사
            if not new_path.parent.exists():
                return {'success': False, 'message': '유효하지 않은 경로입니다.'}
            
            # 기존 DB 파일 존재 여부 확인
            old_path = Path(config.db_path)
            
            if old_path.exists():
                # 새 경로로 복사
                new_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(old_path, new_path)
                logger.info(f"DB 파일 복사: {old_path} → {new_path}")
                
                # 백업 생성
                backup_name = f"work_management_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
                backup_path = old_path.parent / backup_name
                shutil.copy2(old_path, backup_path)
                logger.info(f"백업 생성: {backup_path}")
            
            # 설정 파일 업데이트
            settings = self.get_paths()
            settings['local_db_path'] = str(new_path)
            settings['last_updated'] = datetime.now().isoformat()
            
            with open(self.settings_file, 'w', encoding='utf-8') as f:
                json.dump(settings, f, indent=2, ensure_ascii=False)
            
            # config 업데이트
            config._config['database']['local_path'] = str(new_path.parent)
            
            return {
                'success': True,
                'message': f'로컬 DB 경로가 변경되었습니다: {new_path}'
            }
            
        except Exception as e:
            logger.error(f"경로 변경 실패: {e}")
            return {'success': False, 'message': f'오류: {str(e)}'}
    
    def update_backup_path(self, new_path: str) -> Dict[str, Any]:
        """백업 경로 변경"""
        import json
        
        try:
            new_path = Path(new_path)
            
            # 경로 생성
            new_path.mkdir(parents=True, exist_ok=True)
            
            # 설정 파일 업데이트
            settings = self.get_paths()
            settings['backup_path'] = str(new_path)
            settings['last_updated'] = datetime.now().isoformat()
            
            with open(self.settings_file, 'w', encoding='utf-8') as f:
                json.dump(settings, f, indent=2, ensure_ascii=False)
            
            logger.info(f"백업 경로 변경: {new_path}")
            
            return {
                'success': True,
                'message': f'백업 경로가 변경되었습니다: {new_path}'
            }
            
        except Exception as e:
            logger.error(f"백업 경로 변경 실패: {e}")
            return {'success': False, 'message': f'오류: {str(e)}'}
    
    def create_backup(self) -> Dict[str, Any]:
        """수동 백업 생성"""
        try:
            settings = self.get_paths()
            backup_folder = Path(settings['backup_path'])
            backup_folder.mkdir(parents=True, exist_ok=True)
            
            # 현재 DB 파일
            db_path = Path(config.db_path)
            
            if not db_path.exists():
                return {'success': False, 'message': 'DB 파일이 존재하지 않습니다.'}
            
            # 백업 파일명
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            backup_name = f"work_management_backup_{timestamp}.db"
            backup_file = backup_folder / backup_name
            
            # 복사
            shutil.copy2(db_path, backup_file)
            
            logger.info(f"백업 생성: {backup_file}")
            
            return {
                'success': True,
                'message': f'백업이 생성되었습니다: {backup_file}',
                'path': str(backup_file)
            }
            
        except Exception as e:
            logger.error(f"백업 생성 실패: {e}")
            return {'success': False, 'message': f'오류: {str(e)}'}
    
    def restore_from_backup(self, backup_file: str) -> Dict[str, Any]:
        """백업에서 복원"""
        try:
            backup_path = Path(backup_file)
            
            if not backup_path.exists():
                return {'success': False, 'message': '백업 파일이 존재하지 않습니다.'}
            
            # 현재 DB 백업
            current_db = Path(config.db_path)
            if current_db.exists():
                temp_backup = current_db.parent / f"temp_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
                shutil.copy2(current_db, temp_backup)
            
            # 복원
            shutil.copy2(backup_path, current_db)
            
            logger.info(f"백업 복원: {backup_path} → {current_db}")
            
            return {
                'success': True,
                'message': f'백업에서 복원되었습니다: {backup_file}'
            }
            
        except Exception as e:
            logger.error(f"백업 복원 실패: {e}")
            return {'success': False, 'message': f'오류: {str(e)}'}
    
    def get_backup_list(self) -> list:
        """백업 파일 목록 조회"""
        try:
            settings = self.get_paths()
            backup_folder = Path(settings['backup_path'])
            
            if not backup_folder.exists():
                return []
            
            backups = []
            for file in backup_folder.glob('work_management_backup_*.db'):
                backups.append({
                    'name': file.name,
                    'path': str(file),
                    'size': file.stat().st_size,
                    'created': datetime.fromtimestamp(file.stat().st_mtime).isoformat()
                })
            
            # 최신순 정렬
            backups.sort(key=lambda x: x['created'], reverse=True)
            
            return backups
            
        except Exception as e:
            logger.error(f"백업 목록 조회 실패: {e}")
            return []


# 싱글톤 인스턴스
path_manager = PathManager()
