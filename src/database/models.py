# src/database/models.py - 데이터 모델

from dataclasses import dataclass, asdict
from datetime import datetime
from typing import Optional


@dataclass
class WorkRecord:
    """작업 레코드 데이터 모델"""
    
    id: Optional[int] = None
    date: str = ""  # YYYY-MM-DD
    record_number: int = 1  # 1-10
    contract_number: str = ""
    company: str = ""
    ship_name: str = ""
    engine_model: str = ""
    work_content: str = ""
    location: str = ""
    leader: str = ""
    teammates: str = ""
    manpower: float = 0.0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    created_by: str = ""
    updated_by: str = ""
    
    def to_dict(self) -> dict:
        """딕셔너리로 변환"""
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: dict) -> 'WorkRecord':
        """딕셔너리에서 생성"""
        return cls(**{k: v for k, v in data.items() if k in cls.__annotations__})


@dataclass
class User:
    """사용자 데이터 모델"""
    
    id: Optional[int] = None
    username: str = ""
    last_login: Optional[str] = None
    created_at: Optional[str] = None
    
    def to_dict(self) -> dict:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: dict) -> 'User':
        return cls(**{k: v for k, v in data.items() if k in cls.__annotations__})


@dataclass
class ActivityLog:
    """활동 로그 데이터 모델"""
    
    id: Optional[int] = None
    user: str = ""
    action: str = ""  # save, load, delete, export
    target: str = ""  # 작업 날짜 등
    details: str = ""
    timestamp: Optional[str] = None
    
    def to_dict(self) -> dict:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: dict) -> 'ActivityLog':
        return cls(**{k: v for k, v in data.items() if k in cls.__annotations__})


@dataclass
class AppSettings:
    """앱 설정 데이터 모델"""
    
    id: Optional[int] = None
    key: str = ""
    value: str = ""
    updated_at: Optional[str] = None
    
    def to_dict(self) -> dict:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: dict) -> 'AppSettings':
        return cls(**{k: v for k, v in data.items() if k in cls.__annotations__})
