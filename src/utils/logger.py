# src/utils/logger.py - 로깅 시스템

import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path
from .config import config


def setup_logger(name: str = None) -> logging.Logger:
    """로거 설정 및 반환"""
    
    if name is None:
        name = config.app_name
    
    logger = logging.getLogger(name)
    
    # 이미 핸들러가 설정되어 있으면 반환
    if logger.handlers:
        return logger
    
    # 로그 레벨 설정
    log_level = config.get('logging.level', 'INFO')
    logger.setLevel(getattr(logging, log_level))
    
    # 로그 디렉토리 생성
    log_file = config.get('logging.file', 'logs/app.log')
    log_dir = os.path.dirname(log_file)
    if log_dir:
        os.makedirs(log_dir, exist_ok=True)
    
    # 파일 핸들러 (로테이션)
    max_bytes = config.get('logging.max_bytes', 10485760)  # 10MB
    backup_count = config.get('logging.backup_count', 5)
    
    file_handler = RotatingFileHandler(
        log_file,
        maxBytes=max_bytes,
        backupCount=backup_count,
        encoding='utf-8'
    )
    file_handler.setLevel(logging.DEBUG)
    
    # 콘솔 핸들러
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    
    # 포맷 설정
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    file_handler.setFormatter(formatter)
    console_handler.setFormatter(formatter)
    
    # 핸들러 추가
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    
    return logger


# 전역 로거
logger = setup_logger()
