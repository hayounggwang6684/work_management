# src/utils/config.py - 설정 관리

import json
import os
import threading
from pathlib import Path
from typing import Any, Dict


class Config:
    """애플리케이션 설정 관리 클래스"""

    _instance = None
    _config: Dict[str, Any] = {}
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        with self._lock:
            if not self._config:
                self.load_config()
    
    def load_config(self, config_path: str = None):
        """설정 파일 로드"""
        if config_path is None:
            base_dir = Path(__file__).parent.parent.parent
            config_path = base_dir / "config" / "settings.json"

        config_path = Path(config_path)

        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                self._config = json.load(f)
        except FileNotFoundError:
            # settings.example.json이 있으면 복사해서 안내
            example_path = config_path.parent / "settings.example.json"
            if example_path.exists():
                import shutil
                shutil.copy2(example_path, config_path)
                print(
                    f"[설정] settings.json이 없어 settings.example.json을 복사했습니다.\n"
                    f"      {config_path} 을 열어 토큰/경로를 직접 입력하세요."
                )
                with open(config_path, 'r', encoding='utf-8') as f:
                    self._config = json.load(f)
            else:
                print(f"[설정] 설정 파일을 찾을 수 없습니다: {config_path}")
                self._config = self._get_default_config()
        except json.JSONDecodeError as e:
            print(f"[설정] 설정 파일 파싱 오류: {e}")
            self._config = self._get_default_config()
    
    def _get_default_config(self) -> Dict[str, Any]:
        """기본 설정 반환 (settings.json 없을 때 사용)"""
        # DB 기본 경로: 현재 사용자 바탕화면/db (어떤 PC에서도 동작)
        default_db_path = str(Path.home() / "Desktop" / "db")
        return {
            "app": {
                "name": "금일작업현황 관리",
                "version": "1.0.0"
            },
            "database": {
                "filename": "work_management.db",
                "cloud_sync_enabled": False,
                "local_path": default_db_path
            },
            "ui": {
                "window_width": 1400,
                "window_height": 900
            }
        }
    
    def get(self, key: str, default: Any = None) -> Any:
        """설정 값 가져오기 (점 표기법 지원)
        
        예: config.get('database.filename')
        """
        keys = key.split('.')
        value = self._config
        
        for k in keys:
            if isinstance(value, dict):
                value = value.get(k)
                if value is None:
                    return default
            else:
                return default
        
        return value
    
    def set(self, key: str, value: Any):
        """설정 값 변경"""
        keys = key.split('.')
        config = self._config
        
        for k in keys[:-1]:
            if k not in config:
                config[k] = {}
            config = config[k]
        
        config[keys[-1]] = value
    
    def save(self, config_path: str = None):
        """설정 파일 저장"""
        if config_path is None:
            base_dir = Path(__file__).parent.parent.parent
            config_path = base_dir / "config" / "settings.json"
        
        os.makedirs(os.path.dirname(config_path), exist_ok=True)
        
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(self._config, f, indent=2, ensure_ascii=False)
    
    @property
    def app_name(self) -> str:
        return self.get('app.name', '금일작업현황 관리')
    
    @property
    def version(self) -> str:
        return self.get('app.version', '1.0.0')
    
    @property
    def db_path(self) -> Path:
        """데이터베이스 파일 경로 (비어 있으면 현재 사용자 Desktop/db 사용)"""
        local_path = self.get('database.local_path', '')
        filename = self.get('database.filename', 'work_management.db')
        if not local_path or local_path.strip() == '':
            local_path = str(Path.home() / "Desktop" / "db")
        return Path(local_path) / filename
    
    @property
    def cloud_sync_enabled(self) -> bool:
        return self.get('database.cloud_sync_enabled', False)


# 싱글톤 인스턴스
config = Config()
