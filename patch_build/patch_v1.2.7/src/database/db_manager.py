# src/database/db_manager.py - SQLite 데이터베이스 관리

import sqlite3
import os
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Dict, Any
from contextlib import contextmanager

from .models import WorkRecord, User, ActivityLog, AppSettings
from ..utils.logger import logger
from ..utils.config import config


class DatabaseManager:
    """SQLite 데이터베이스 관리 클래스"""
    
    def __init__(self, db_path: str = None):
        if db_path is None:
            db_path = config.db_path
        
        self.db_path = Path(db_path)
        self._ensure_db_directory()
        self._init_database()
        logger.info(f"데이터베이스 초기화 완료: {self.db_path}")
    
    def _ensure_db_directory(self):
        """데이터베이스 디렉토리 생성"""
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
    
    @contextmanager
    def get_connection(self):
        """데이터베이스 연결 컨텍스트 매니저"""
        conn = sqlite3.connect(str(self.db_path), timeout=30)
        conn.row_factory = sqlite3.Row  # 딕셔너리 형태로 반환
        try:
            yield conn
            conn.commit()
        except Exception as e:
            conn.rollback()
            logger.error(f"데이터베이스 오류: {e}")
            raise
        finally:
            conn.close()
    
    def _init_database(self):
        """데이터베이스 테이블 초기화"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # 작업 레코드 테이블
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS work_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    date TEXT NOT NULL,
                    record_number INTEGER NOT NULL,
                    contract_number TEXT,
                    company TEXT,
                    ship_name TEXT,
                    engine_model TEXT,
                    work_content TEXT,
                    location TEXT,
                    leader TEXT,
                    teammates TEXT,
                    manpower REAL DEFAULT 0,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    created_by TEXT,
                    updated_by TEXT,
                    UNIQUE(date, record_number)
                )
            ''')
            
            # 사용자 테이블
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    last_login TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # 활동 로그 테이블
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS activity_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user TEXT NOT NULL,
                    action TEXT NOT NULL,
                    target TEXT,
                    details TEXT,
                    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # 앱 설정 테이블
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS app_settings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    key TEXT UNIQUE NOT NULL,
                    value TEXT,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # 프로젝트 상태 테이블 (칸반 보드용)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS project_status (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    contract_number TEXT UNIQUE NOT NULL,
                    status TEXT NOT NULL DEFAULT 'auto',
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    updated_by TEXT
                )
            ''')

            # 프로젝트 댓글 테이블
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS project_comments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    contract_number TEXT NOT NULL,
                    board_project_id INTEGER DEFAULT NULL,
                    parent_id INTEGER DEFAULT NULL,
                    user_id TEXT NOT NULL,
                    user_name TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (parent_id) REFERENCES project_comments(id)
                )
            ''')

            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_comments_contract
                ON project_comments(contract_number)
            ''')

            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_comments_board_project
                ON project_comments(board_project_id)
            ''')

            # 보드 프로젝트 테이블 (접수 단계 등 계약번호 없는 프로젝트 관리)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS board_projects (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    contract_number TEXT DEFAULT '',
                    company TEXT DEFAULT '',
                    ship_name TEXT DEFAULT '',
                    engine_model TEXT DEFAULT '',
                    work_content TEXT DEFAULT '',
                    status TEXT NOT NULL DEFAULT '접수',
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    created_by TEXT DEFAULT '',
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # 휴가자 현황 테이블 (날짜별 연차/반차/공가)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS vacation_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    date TEXT NOT NULL,
                    category TEXT NOT NULL,
                    names TEXT DEFAULT '',
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    created_by TEXT DEFAULT '',
                    updated_by TEXT DEFAULT '',
                    UNIQUE(date, category)
                )
            ''')

            # 연차 잔여/사용 현황 (장기 연차 관리용 구조)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS vacation_balances (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    year INTEGER NOT NULL,
                    employee_name TEXT NOT NULL,
                    total_days REAL DEFAULT 15.0,
                    used_annual REAL DEFAULT 0,
                    used_half INTEGER DEFAULT 0,
                    used_special REAL DEFAULT 0,
                    UNIQUE(year, employee_name)
                )
            ''')

            # 인덱스 생성
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_work_records_date
                ON work_records(date)
            ''')

            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_work_records_contract_number
                ON work_records(contract_number)
            ''')

            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_work_records_ship_name
                ON work_records(ship_name)
            ''')
            
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_activity_logs_timestamp 
                ON activity_logs(timestamp DESC)
            ''')
            
            conn.commit()
    
    # =========================================================================
    # 작업 레코드 관련 메서드
    # =========================================================================
    
    def save_work_records(self, date: str, records: List[WorkRecord], username: str) -> bool:
        """작업 레코드 저장 (날짜별 전체 레코드)"""
        inserted_count = 0
        try:
            logger.info(f"저장 시작: {date}, {len(records)}개 레코드")
            logger.info(f"DB 경로: {self.db_path}")

            with self.get_connection() as conn:
                cursor = conn.cursor()

                # 기존 레코드 삭제
                cursor.execute('DELETE FROM work_records WHERE date = ?', (date,))
                deleted_count = cursor.rowcount
                logger.info(f"기존 레코드 삭제: {deleted_count}개")

                # 빈 레코드 필터링 (데이터가 있는 레코드만)
                valid_records = [
                    r for r in records
                    if (r.contract_number or r.company or r.ship_name or
                        r.engine_model or r.work_content or r.location or
                        r.leader or r.teammates)
                ]
                logger.info(f"유효한 레코드: {len(valid_records)}개")

                # 새 레코드 삽입
                for record in valid_records:
                    record.date = date
                    record.updated_at = datetime.now().isoformat()
                    record.updated_by = username

                    if record.created_at is None:
                        record.created_at = datetime.now().isoformat()
                        record.created_by = username

                    cursor.execute('''
                        INSERT INTO work_records (
                            date, record_number, contract_number, company, ship_name,
                            engine_model, work_content, location, leader, teammates,
                            manpower, created_at, updated_at, created_by, updated_by
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (
                        record.date, record.record_number, record.contract_number,
                        record.company, record.ship_name, record.engine_model,
                        record.work_content, record.location, record.leader,
                        record.teammates, record.manpower, record.created_at,
                        record.updated_at, record.created_by, record.updated_by
                    ))
                    inserted_count += 1

                logger.info(f"삽입된 레코드: {inserted_count}개")
                logger.info(f"작업 레코드 저장 완료: {date}, {inserted_count}개")
            # with 블록 종료 → conn.commit() 완료, write lock 해제
            # add_activity_log는 with 블록 밖에서 호출 (안에서 호출 시 conn 중첩 → 30초 데드락)
            self.add_activity_log(username, 'save', date, f'{inserted_count}개 레코드 저장')
            return True

        except Exception as e:
            logger.error(f"작업 레코드 저장 실패: {e}")
            return False
    
    def load_work_records(self, date: str) -> List[WorkRecord]:
        """작업 레코드 로드 (날짜별)"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    SELECT * FROM work_records 
                    WHERE date = ? 
                    ORDER BY record_number
                ''', (date,))
                
                rows = cursor.fetchall()
                records = [WorkRecord(**dict(row)) for row in rows]
                
                logger.info(f"작업 레코드 로드 완료: {date}, {len(records)}개")
                return records
                
        except Exception as e:
            logger.error(f"작업 레코드 로드 실패: {e}")
            return []
    
    def get_dates_with_records(self, start_date: str = None, end_date: str = None) -> List[str]:
        """레코드가 있는 날짜 목록 조회"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                
                query = 'SELECT DISTINCT date FROM work_records'
                params = []
                
                if start_date and end_date:
                    query += ' WHERE date BETWEEN ? AND ?'
                    params = [start_date, end_date]
                elif start_date:
                    query += ' WHERE date >= ?'
                    params = [start_date]
                elif end_date:
                    query += ' WHERE date <= ?'
                    params = [end_date]
                
                query += ' ORDER BY date DESC'
                
                cursor.execute(query, params)
                rows = cursor.fetchall()
                
                return [row['date'] for row in rows]
                
        except Exception as e:
            logger.error(f"날짜 목록 조회 실패: {e}")
            return []
    
    # =========================================================================
    # 사용자 관련 메서드
    # =========================================================================
    
    def add_or_update_user(self, username: str) -> bool:
        """사용자 추가 또는 업데이트"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                
                cursor.execute('''
                    INSERT INTO users (username, last_login)
                    VALUES (?, ?)
                    ON CONFLICT(username) DO UPDATE SET
                        last_login = ?
                ''', (username, datetime.now().isoformat(), datetime.now().isoformat()))
                
                return True
                
        except Exception as e:
            logger.error(f"사용자 정보 저장 실패: {e}")
            return False
    
    def get_all_users(self) -> List[User]:
        """모든 사용자 조회"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('SELECT * FROM users ORDER BY last_login DESC')
                rows = cursor.fetchall()
                return [User(**dict(row)) for row in rows]
                
        except Exception as e:
            logger.error(f"사용자 목록 조회 실패: {e}")
            return []
    
    # =========================================================================
    # 활동 로그 관련 메서드
    # =========================================================================
    
    def add_activity_log(self, user: str, action: str, target: str = "", details: str = "") -> bool:
        """활동 로그 추가"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO activity_logs (user, action, target, details)
                    VALUES (?, ?, ?, ?)
                ''', (user, action, target, details))
                return True
                
        except Exception as e:
            logger.error(f"활동 로그 추가 실패: {e}")
            return False
    
    def get_activity_logs(self, limit: int = 100, user: str = None) -> List[ActivityLog]:
        """활동 로그 조회"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                
                query = 'SELECT * FROM activity_logs'
                params = []
                
                if user:
                    query += ' WHERE user = ?'
                    params.append(user)
                
                query += ' ORDER BY timestamp DESC LIMIT ?'
                params.append(limit)
                
                cursor.execute(query, params)
                rows = cursor.fetchall()
                return [ActivityLog(**dict(row)) for row in rows]
                
        except Exception as e:
            logger.error(f"활동 로그 조회 실패: {e}")
            return []
    
    # =========================================================================
    # 앱 설정 관련 메서드
    # =========================================================================
    
    def set_setting(self, key: str, value: str) -> bool:
        """설정 값 저장"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO app_settings (key, value, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET
                        value = ?,
                        updated_at = ?
                ''', (key, value, datetime.now().isoformat(), value, datetime.now().isoformat()))
                return True
                
        except Exception as e:
            logger.error(f"설정 저장 실패: {e}")
            return False
    
    def get_setting(self, key: str, default: str = None) -> Optional[str]:
        """설정 값 조회"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('SELECT value FROM app_settings WHERE key = ?', (key,))
                row = cursor.fetchone()
                return row['value'] if row else default

        except Exception as e:
            logger.error(f"설정 조회 실패: {e}")
            return default

    def execute_query(self, query: str, params: tuple = ()) -> List[tuple]:
        """범용 쿼리 실행 (SELECT용)"""
        try:
            with self.get_connection() as conn:
                conn.row_factory = None  # 튜플 형태로 반환
                cursor = conn.cursor()
                cursor.execute(query, params)
                rows = cursor.fetchall()
                return rows if rows else []
        except Exception as e:
            logger.error(f"쿼리 실행 실패: {e}")
            return []

    # =========================================================================
    # 프로젝트 상태 관련 메서드 (칸반 보드)
    # =========================================================================

    def set_project_status(self, contract_number: str, status: str, username: str = '') -> bool:
        """프로젝트 상태 설정 (auto/inProgress/completed)"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                if status == 'auto':
                    # 자동 모드로 전환 시 레코드 삭제
                    cursor.execute('DELETE FROM project_status WHERE contract_number = ?', (contract_number,))
                else:
                    cursor.execute('''
                        INSERT INTO project_status (contract_number, status, updated_at, updated_by)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT(contract_number)
                        DO UPDATE SET status = ?, updated_at = ?, updated_by = ?
                    ''', (contract_number, status, datetime.now().isoformat(), username,
                          status, datetime.now().isoformat(), username))
                logger.info(f"프로젝트 상태 변경: {contract_number} → {status}")
                return True
        except Exception as e:
            logger.error(f"프로젝트 상태 변경 실패: {e}")
            return False

    def get_project_statuses(self) -> Dict:
        """모든 프로젝트의 수동 상태 조회"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('SELECT contract_number, status FROM project_status')
                rows = cursor.fetchall()
                return {row['contract_number']: row['status'] for row in rows}
        except Exception as e:
            logger.error(f"프로젝트 상태 조회 실패: {e}")
            return {}

    # =========================================================================
    # 보드 프로젝트 관련 메서드
    # =========================================================================

    def create_board_project(self, data: Dict, username: str = '') -> Optional[int]:
        """보드 프로젝트 생성 (접수 단계)"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                now = datetime.now().isoformat()
                cursor.execute('''
                    INSERT INTO board_projects (contract_number, company, ship_name, engine_model, work_content, status, created_at, created_by, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    data.get('contract_number', ''),
                    data.get('company', ''),
                    data.get('ship_name', ''),
                    data.get('engine_model', ''),
                    data.get('work_content', ''),
                    data.get('status', '접수'),
                    now, username, now
                ))
                project_id = cursor.lastrowid
                logger.info(f"보드 프로젝트 생성: ID={project_id}")
                return project_id
        except Exception as e:
            logger.error(f"보드 프로젝트 생성 실패: {e}")
            return None

    def update_board_project(self, project_id: int, data: Dict, username: str = '') -> bool:
        """보드 프로젝트 업데이트"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                now = datetime.now().isoformat()
                fields = []
                values = []
                for key in ['contract_number', 'company', 'ship_name', 'engine_model', 'work_content', 'status']:
                    if key in data:
                        fields.append(f"{key} = ?")
                        values.append(data[key])
                if not fields:
                    return False
                fields.append("updated_at = ?")
                values.append(now)
                values.append(project_id)
                cursor.execute(f"UPDATE board_projects SET {', '.join(fields)} WHERE id = ?", values)
                logger.info(f"보드 프로젝트 업데이트: ID={project_id}")
                return True
        except Exception as e:
            logger.error(f"보드 프로젝트 업데이트 실패: {e}")
            return False

    def delete_board_project(self, project_id: int) -> bool:
        """보드 프로젝트 삭제"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('DELETE FROM board_projects WHERE id = ?', (project_id,))
                return True
        except Exception as e:
            logger.error(f"보드 프로젝트 삭제 실패: {e}")
            return False

    def get_board_projects(self, status: str = None) -> List[Dict]:
        """보드 프로젝트 조회"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                if status:
                    cursor.execute('SELECT * FROM board_projects WHERE status = ? ORDER BY created_at DESC', (status,))
                else:
                    cursor.execute('SELECT * FROM board_projects ORDER BY created_at DESC')
                rows = cursor.fetchall()
                return [dict(row) for row in rows]
        except Exception as e:
            logger.error(f"보드 프로젝트 조회 실패: {e}")
            return []

    # =========================================================================
    # 댓글 관련 메서드
    # =========================================================================

    def add_comment(self, contract_number: str, user_id: str, user_name: str, content: str, parent_id: int = None, board_project_id: int = None) -> Optional[int]:
        """댓글 추가"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                now = datetime.now().isoformat()
                cursor.execute('''
                    INSERT INTO project_comments (contract_number, board_project_id, parent_id, user_id, user_name, content, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (contract_number, board_project_id, parent_id, user_id, user_name, content, now))
                comment_id = cursor.lastrowid
                logger.info(f"댓글 추가: ID={comment_id}, 계약={contract_number}")
                return comment_id
        except Exception as e:
            logger.error(f"댓글 추가 실패: {e}")
            return None

    def get_comments(self, contract_number: str = None, board_project_id: int = None) -> List[Dict]:
        """댓글 조회 (flat list, JS에서 트리 구성)"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                if contract_number:
                    cursor.execute('SELECT * FROM project_comments WHERE contract_number = ? ORDER BY created_at ASC', (contract_number,))
                elif board_project_id:
                    cursor.execute('SELECT * FROM project_comments WHERE board_project_id = ? ORDER BY created_at ASC', (board_project_id,))
                else:
                    return []
                rows = cursor.fetchall()
                return [dict(row) for row in rows]
        except Exception as e:
            logger.error(f"댓글 조회 실패: {e}")
            return []

    def delete_comment(self, comment_id: int, user_id: str) -> bool:
        """댓글 삭제 (본인만 가능)"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                # 대댓글도 함께 삭제
                cursor.execute('DELETE FROM project_comments WHERE id = ? AND user_id = ?', (comment_id, user_id))
                if cursor.rowcount > 0:
                    cursor.execute('DELETE FROM project_comments WHERE parent_id = ?', (comment_id,))
                    logger.info(f"댓글 삭제: ID={comment_id}")
                    return True
                return False
        except Exception as e:
            logger.error(f"댓글 삭제 실패: {e}")
            return False

    def get_comment_counts(self, contract_numbers: List[str] = None, board_project_ids: List[int] = None) -> Dict:
        """프로젝트별 댓글 수 조회"""
        try:
            result = {}
            with self.get_connection() as conn:
                cursor = conn.cursor()
                if contract_numbers:
                    placeholders = ','.join(['?' for _ in contract_numbers])
                    cursor.execute(f'SELECT contract_number, COUNT(*) as cnt FROM project_comments WHERE contract_number IN ({placeholders}) GROUP BY contract_number', contract_numbers)
                    for row in cursor.fetchall():
                        result[f"cn:{row['contract_number']}"] = row['cnt']
                if board_project_ids:
                    placeholders = ','.join(['?' for _ in board_project_ids])
                    cursor.execute(f'SELECT board_project_id, COUNT(*) as cnt FROM project_comments WHERE board_project_id IN ({placeholders}) GROUP BY board_project_id', board_project_ids)
                    for row in cursor.fetchall():
                        result[f"bp:{row['board_project_id']}"] = row['cnt']
            return result
        except Exception as e:
            logger.error(f"댓글 수 조회 실패: {e}")
            return {}

    def clear_all_work_records(self) -> bool:
        """모든 작업 레코드 삭제"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('DELETE FROM work_records')
                deleted_count = cursor.rowcount
                logger.info(f"전체 작업 레코드 삭제 완료: {deleted_count}개")
                return True
        except Exception as e:
            logger.error(f"전체 작업 레코드 삭제 실패: {e}")
            return False

    # =========================================================================
    # 휴가자 현황
    # =========================================================================

    def save_vacation_records(self, date: str, data: dict, username: str) -> bool:
        """날짜별 휴가자 현황 저장 (연차/반차/공가)"""
        try:
            now = datetime.now().isoformat()
            with self.get_connection() as conn:
                cursor = conn.cursor()
                for category in ('연차', '반차', '공가'):
                    names = data.get(category, '')
                    cursor.execute('''
                        INSERT INTO vacation_records (date, category, names, updated_at, updated_by)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(date, category)
                        DO UPDATE SET names = ?, updated_at = ?, updated_by = ?
                    ''', (date, category, names, now, username,
                          names, now, username))
            logger.info(f"휴가자 현황 저장: {date}")
            return True
        except Exception as e:
            logger.error(f"휴가자 현황 저장 실패: {e}")
            return False

    def load_vacation_records(self, date: str) -> dict:
        """날짜별 휴가자 현황 로드"""
        result = {'연차': '', '반차': '', '공가': ''}
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    'SELECT category, names FROM vacation_records WHERE date = ?', (date,)
                )
                for row in cursor.fetchall():
                    result[row['category']] = row['names'] or ''
        except Exception as e:
            logger.error(f"휴가자 현황 로드 실패: {e}")
        return result


# 싱글톤 인스턴스
db = DatabaseManager()
