# src/utils/settings_manager.py - 설정 관리자

import json
import shutil
from pathlib import Path
from typing import Dict, Any
from ..utils.logger import logger
from ..utils.config import config


class SettingsManager:
    """설정 관리 클래스"""
    
    def __init__(self):
        self.config = config
        self.settings_file = Path(__file__).parent.parent.parent / "config" / "settings.json"
    
    def get_current_settings(self) -> Dict[str, Any]:
        """현재 설정 조회"""
        return {
            'local_db_path': str(config.db_path),
            'cloud_sync_path': config.get('database.cloud_path', ''),
            'backup_path': config.get('database.backup_path', ''),
            'cloud_sync_enabled': config.get('database.cloud_sync_enabled', False),
        }
    
    def update_local_db_path(self, new_path: str) -> Dict[str, Any]:
        """로컬 DB 경로 변경"""
        try:
            new_path = Path(new_path)
            current_path = Path(config.db_path)
            
            # 새 경로 디렉토리 생성
            new_path.parent.mkdir(parents=True, exist_ok=True)
            
            # 기존 DB 파일이 있으면 복사
            if current_path.exists():
                logger.info(f"DB 파일 복사 중: {current_path} -> {new_path}")
                shutil.copy2(current_path, new_path)
                logger.info("DB 파일 복사 완료")
            
            # 설정 파일 업데이트
            self._update_config_file('database.local_path', str(new_path.parent))
            
            return {
                'success': True,
                'message': 'DB 경로가 변경되었습니다. 프로그램을 재시작하세요.'
            }
            
        except Exception as e:
            logger.error(f"DB 경로 변경 실패: {e}")
            return {
                'success': False,
                'message': f'경로 변경 실패: {str(e)}'
            }
    
    def update_cloud_path(self, new_path: str) -> Dict[str, Any]:
        """클라우드 동기화 경로 변경"""
        try:
            new_path = Path(new_path)
            
            # 경로 검증
            if not new_path.parent.exists():
                return {
                    'success': False,
                    'message': '유효하지 않은 경로입니다.'
                }
            
            # 디렉토리 생성
            new_path.mkdir(parents=True, exist_ok=True)
            
            # 설정 파일 업데이트
            self._update_config_file('database.cloud_path', str(new_path))
            
            return {
                'success': True,
                'message': '클라우드 경로가 변경되었습니다. 프로그램을 재시작하세요.'
            }
            
        except Exception as e:
            logger.error(f"클라우드 경로 변경 실패: {e}")
            return {
                'success': False,
                'message': f'경로 변경 실패: {str(e)}'
            }
    
    def update_backup_path(self, new_path: str) -> Dict[str, Any]:
        """백업 경로 변경"""
        try:
            new_path = Path(new_path)
            
            # 디렉토리 생성
            new_path.mkdir(parents=True, exist_ok=True)
            
            # 설정 파일 업데이트
            self._update_config_file('database.backup_path', str(new_path))
            
            return {
                'success': True,
                'message': '백업 경로가 변경되었습니다.'
            }
            
        except Exception as e:
            logger.error(f"백업 경로 변경 실패: {e}")
            return {
                'success': False,
                'message': f'경로 변경 실패: {str(e)}'
            }
    
    def create_backup(self, backup_name: str = None) -> Dict[str, Any]:
        """수동 백업 생성"""
        try:
            from datetime import datetime
            
            if backup_name is None:
                backup_name = f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
            
            current_db = Path(config.db_path)
            backup_path = Path(config.get('database.backup_path', './backups'))
            backup_path.mkdir(parents=True, exist_ok=True)
            
            backup_file = backup_path / backup_name
            
            if current_db.exists():
                shutil.copy2(current_db, backup_file)
                logger.info(f"백업 생성 완료: {backup_file}")
                
                return {
                    'success': True,
                    'message': f'백업이 생성되었습니다: {backup_file}',
                    'path': str(backup_file)
                }
            else:
                return {
                    'success': False,
                    'message': 'DB 파일을 찾을 수 없습니다.'
                }
                
        except Exception as e:
            logger.error(f"백업 생성 실패: {e}")
            return {
                'success': False,
                'message': f'백업 생성 실패: {str(e)}'
            }
    
    def _update_config_file(self, key: str, value: Any):
        """설정 파일 업데이트"""
        try:
            # 설정 파일 읽기
            with open(self.settings_file, 'r', encoding='utf-8') as f:
                settings = json.load(f)
            
            # 키를 점 표기법으로 분리
            keys = key.split('.')
            current = settings
            
            for k in keys[:-1]:
                if k not in current:
                    current[k] = {}
                current = current[k]
            
            # 값 설정
            current[keys[-1]] = value
            
            # 파일에 저장
            with open(self.settings_file, 'w', encoding='utf-8') as f:
                json.dump(settings, f, indent=2, ensure_ascii=False)
            
            logger.info(f"설정 업데이트: {key} = {value}")
            
        except Exception as e:
            logger.error(f"설정 파일 업데이트 실패: {e}")
            raise


# 싱글톤 인스턴스
settings_manager = SettingsManager()
