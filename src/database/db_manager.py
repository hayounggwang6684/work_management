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
            
            # 오류 리포트 테이블 (사용자 현황 탭)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS error_reports (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id       TEXT,
                    user_name     TEXT,
                    app_version   TEXT,
                    error_type    TEXT,
                    error_message TEXT NOT NULL,
                    stack_trace   TEXT,
                    timestamp     TEXT DEFAULT CURRENT_TIMESTAMP,
                    is_read       INTEGER DEFAULT 0
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

            # board_projects 마일스톤 컬럼 마이그레이션
            for _col in [
                ('target_start_date', 'TEXT DEFAULT ""'),
                ('target_end_date',   'TEXT DEFAULT ""'),
                ('actual_end_date',   'TEXT DEFAULT ""'),
            ]:
                try:
                    cursor.execute(f'ALTER TABLE board_projects ADD COLUMN {_col[0]} {_col[1]}')
                except sqlite3.OperationalError:
                    pass  # 이미 존재

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

            # 직원별 연차 설정 (생성 월)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS employee_annual_config (
                    employee_name TEXT PRIMARY KEY,
                    generation_month INTEGER NOT NULL DEFAULT 1,
                    note TEXT DEFAULT ''
                )
            ''')

            # 연차 부여 이력 (매년 수동 추가)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS leave_grant_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    employee_name TEXT NOT NULL,
                    grant_year  INTEGER NOT NULL,
                    grant_month INTEGER NOT NULL,
                    days        REAL NOT NULL,
                    note        TEXT DEFAULT '',
                    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # 연차 사용 내역
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS employee_leave_usage (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    employee_name TEXT NOT NULL,
                    use_date      TEXT NOT NULL,
                    leave_type    TEXT NOT NULL,
                    days          REAL NOT NULL DEFAULT 1.0,
                    note          TEXT DEFAULT '',
                    created_by    TEXT DEFAULT '',
                    created_at    TEXT DEFAULT CURRENT_TIMESTAMP
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
                CREATE INDEX IF NOT EXISTS idx_work_records_company
                ON work_records(company)
            ''')  # #13 — company 검색 풀테이블 스캔 방지

            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_activity_logs_timestamp
                ON activity_logs(timestamp DESC)
            ''')

            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_leave_grant_emp
                ON leave_grant_history(employee_name)
            ''')
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_leave_usage_emp
                ON employee_leave_usage(employee_name)
            ''')
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_leave_usage_date
                ON employee_leave_usage(use_date)
            ''')

            # employee_leave_usage 컬럼 마이그레이션 (기존 DB 업그레이드 대비)
            for _col, _defn in [
                ('created_by', "TEXT DEFAULT ''"),
                ('created_at', "TEXT DEFAULT CURRENT_TIMESTAMP"),
            ]:
                try:
                    cursor.execute(f"ALTER TABLE employee_leave_usage ADD COLUMN {_col} {_defn}")
                except sqlite3.OperationalError:
                    pass  # 이미 존재

            # ── vacation_records → employee_leave_usage 초기 마이그레이션 ──
            # 앱 시작 시 auto_vacation 레코드가 없는 날짜만 한 번 동기화
            try:
                _days_map = {'연차': 1.0, '반차': 0.5, '공가': 0.0}
                cursor.execute('''
                    SELECT DISTINCT vr.date
                    FROM vacation_records vr
                    LEFT JOIN employee_leave_usage eu
                        ON vr.date = eu.use_date AND eu.created_by = 'auto_vacation'
                    WHERE eu.id IS NULL
                ''')
                dates_to_migrate = [r[0] for r in cursor.fetchall()]
                for _date in dates_to_migrate:
                    cursor.execute(
                        'SELECT category, names FROM vacation_records WHERE date = ?', (_date,)
                    )
                    for vrow in cursor.fetchall():
                        _cat   = vrow['category']
                        _names = vrow['names'] or ''
                        _days  = _days_map.get(_cat, 1.0)
                        for _raw in _names.split(','):
                            _name = _raw.strip()
                            if _name:
                                cursor.execute('''
                                    INSERT INTO employee_leave_usage
                                        (employee_name, use_date, leave_type, days, note, created_by)
                                    VALUES (?, ?, ?, ?, ?, 'auto_vacation')
                                ''', (_name, _date, _cat, _days, '일일작업현황 자동'))
            except Exception as _me:
                logger.warning(f"vacation_records 마이그레이션 실패 (무시): {_me}")

            # work_records.is_as 컬럼 마이그레이션 (A/S 여부)
            try:
                cursor.execute("ALTER TABLE work_records ADD COLUMN is_as INTEGER DEFAULT 0")
                logger.info("work_records.is_as 컬럼 추가 완료")
            except Exception:
                pass  # 이미 존재하면 무시

            # work_records.work_type 컬럼 마이그레이션 (주간/야간 구분)
            try:
                cursor.execute("ALTER TABLE work_records ADD COLUMN work_type TEXT DEFAULT 'day'")
                logger.info("work_records.work_type 컬럼 추가 완료")
            except Exception:
                pass  # 이미 존재하면 무시

            # work_records.end_time 컬럼 마이그레이션 (야간 작업 종료 시간)
            try:
                cursor.execute("ALTER TABLE work_records ADD COLUMN end_time TEXT DEFAULT ''")
                logger.info("work_records.end_time 컬럼 추가 완료")
            except Exception:
                pass  # 이미 존재하면 무시

            # UNIQUE(date, record_number) → UNIQUE(date, record_number, work_type) 마이그레이션
            # 기존 인라인 UNIQUE 제약은 SQLite에서 직접 수정 불가 → 테이블 재생성
            try:
                cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='work_records_old'")
                if cursor.fetchone()[0] == 0:
                    # work_type 컬럼이 있는데 아직 새 UNIQUE 인덱스가 없는 경우에만 실행
                    cursor.execute("""
                        SELECT COUNT(*) FROM sqlite_master
                        WHERE type='index' AND name='idx_work_records_date_num_type'
                    """)
                    if cursor.fetchone()[0] == 0:
                        # 1) 기존 테이블 백업
                        cursor.execute("ALTER TABLE work_records RENAME TO work_records_old")
                        # 2) 새 테이블 생성 (UNIQUE 제약 변경)
                        cursor.execute('''
                            CREATE TABLE work_records (
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
                                is_as INTEGER DEFAULT 0,
                                work_type TEXT DEFAULT 'day',
                                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                                created_by TEXT,
                                updated_by TEXT,
                                UNIQUE(date, record_number, work_type)
                            )
                        ''')
                        # 3) 기존 데이터 복사 (work_type 기본값 'day')
                        cursor.execute('''
                            INSERT INTO work_records (
                                id, date, record_number, contract_number, company, ship_name,
                                engine_model, work_content, location, leader, teammates,
                                manpower, is_as, work_type,
                                created_at, updated_at, created_by, updated_by
                            )
                            SELECT
                                id, date, record_number, contract_number, company, ship_name,
                                engine_model, work_content, location, leader, teammates,
                                manpower,
                                COALESCE(is_as, 0),
                                COALESCE(work_type, 'day'),
                                created_at, updated_at, created_by, updated_by
                            FROM work_records_old
                        ''')
                        # 4) 기존 백업 테이블 삭제
                        cursor.execute("DROP TABLE work_records_old")
                        # 5) 새 인덱스 생성
                        cursor.execute('''
                            CREATE UNIQUE INDEX IF NOT EXISTS idx_work_records_date_num_type
                            ON work_records(date, record_number, work_type)
                        ''')
                        logger.info("work_records UNIQUE 제약 (date, record_number, work_type) 마이그레이션 완료")
            except Exception as _mig_e:
                logger.warning(f"work_records UNIQUE 마이그레이션 실패 (무시): {_mig_e}")

            # holiday_work_entries 테이블 (휴일/주말 작업 인원 보고서)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS holiday_work_entries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    period_key TEXT NOT NULL,
                    seq INTEGER NOT NULL,
                    department TEXT DEFAULT '',
                    rank TEXT DEFAULT '',
                    name TEXT DEFAULT '',
                    fri_work TEXT DEFAULT '-',
                    sat_work TEXT DEFAULT '-',
                    sun_work TEXT DEFAULT '-',
                    work_content TEXT DEFAULT '',
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    created_by TEXT DEFAULT '',
                    UNIQUE(period_key, seq)
                )
            ''')
            for _col, _defn in [
                ('contract_number', "TEXT DEFAULT ''"),
                ('company', "TEXT DEFAULT ''"),
                ('ship_name', "TEXT DEFAULT ''"),
            ]:
                try:
                    cursor.execute(f"ALTER TABLE holiday_work_entries ADD COLUMN {_col} {_defn}")
                    logger.info(f"holiday_work_entries.{_col} 컬럼 추가 완료")
                except Exception:
                    pass

    # =========================================================================
    # 작업 레코드 관련 메서드
    # =========================================================================
    
    def save_work_records(self, date: str, records: List[WorkRecord],
                          username: str, work_type: str = 'day') -> bool:
        """작업 레코드 저장 (날짜 + work_type별)"""
        inserted_count = 0
        try:
            logger.info(f"저장 시작: {date} [{work_type}], {len(records)}개 레코드")
            logger.info(f"DB 경로: {self.db_path}")

            with self.get_connection() as conn:
                cursor = conn.cursor()

                # 해당 날짜 + work_type 레코드만 삭제
                cursor.execute(
                    'DELETE FROM work_records WHERE date = ? AND work_type = ?',
                    (date, work_type)
                )
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
                    record.work_type = work_type
                    record.updated_at = datetime.now().isoformat()
                    record.updated_by = username

                    if record.created_at is None:
                        record.created_at = datetime.now().isoformat()
                        record.created_by = username

                    cursor.execute('''
                        INSERT INTO work_records (
                            date, record_number, contract_number, company, ship_name,
                            engine_model, work_content, location, leader, teammates,
                            manpower, is_as, work_type, end_time,
                            created_at, updated_at, created_by, updated_by
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (
                        record.date, record.record_number, record.contract_number,
                        record.company, record.ship_name, record.engine_model,
                        record.work_content, record.location, record.leader,
                        record.teammates, record.manpower,
                        getattr(record, 'is_as', 0),
                        work_type,
                        getattr(record, 'end_time', ''),
                        record.created_at, record.updated_at,
                        record.created_by, record.updated_by
                    ))
                    inserted_count += 1

                logger.info(f"삽입된 레코드: {inserted_count}개")
                logger.info(f"작업 레코드 저장 완료: {date} [{work_type}], {inserted_count}개")
            # with 블록 종료 → conn.commit() 완료, write lock 해제
            # add_activity_log는 with 블록 밖에서 호출 (안에서 호출 시 conn 중첩 → 30초 데드락)
            self.add_activity_log(username, 'save', date,
                                  f'{inserted_count}개 레코드 저장 [{work_type}]')
            return True

        except Exception as e:
            logger.error(f"작업 레코드 저장 실패: {e}")
            return False

    def load_work_records(self, date: str, work_type: str = 'day') -> List[WorkRecord]:
        """작업 레코드 로드 (날짜 + work_type별)"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    SELECT * FROM work_records
                    WHERE date = ? AND work_type = ?
                    ORDER BY record_number
                ''', (date, work_type))

                rows = cursor.fetchall()
                records = []
                for row in rows:
                    row_dict = dict(row)
                    # WorkRecord 필드에 없는 컬럼 제거 (DB에 여분 컬럼 있을 경우 대비)
                    valid_keys = {f.name for f in WorkRecord.__dataclass_fields__.values()}
                    filtered = {k: v for k, v in row_dict.items() if k in valid_keys}
                    records.append(WorkRecord(**filtered))

                logger.info(f"작업 레코드 로드 완료: {date} [{work_type}], {len(records)}개")
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
    
    def load_holiday_work_entries(self, period_key: str) -> List[dict]:
        """휴일 작업 인원 명단 로드 (period_key = 해당 주 금요일 날짜 YYYY-MM-DD)"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    SELECT * FROM holiday_work_entries
                    WHERE period_key = ?
                    ORDER BY seq
                ''', (period_key,))
                rows = cursor.fetchall()
                return [dict(row) for row in rows]
        except Exception as e:
            logger.error(f"휴일 작업 명단 로드 실패: {e}")
            return []

    def save_holiday_work_entries(self, period_key: str,
                                  entries: List[dict], username: str) -> bool:
        """휴일 작업 인원 명단 저장 (전체 덮어쓰기)"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    'DELETE FROM holiday_work_entries WHERE period_key = ?',
                    (period_key,)
                )
                now = datetime.now().isoformat()
                for i, entry in enumerate(entries, 1):
                    cursor.execute('''
                        INSERT INTO holiday_work_entries
                            (period_key, seq, department, rank, name,
                             fri_work, sat_work, sun_work, work_content,
                             contract_number, company, ship_name,
                             created_at, updated_at, created_by)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (
                        period_key, i,
                        entry.get('department', ''),
                        entry.get('rank', ''),
                        entry.get('name', ''),
                        entry.get('friWork') or entry.get('fri_work', '-'),
                        entry.get('satWork') or entry.get('sat_work', '-'),
                        entry.get('sunWork') or entry.get('sun_work', '-'),
                        entry.get('workContent') or entry.get('work_content', ''),
                        entry.get('contractNumber') or entry.get('contract_number', ''),
                        entry.get('company', ''),
                        entry.get('shipName') or entry.get('ship_name', ''),
                        now, now, username
                    ))
            self.add_activity_log(username, 'save', period_key,
                                  f'휴일 작업 명단 저장 {len(entries)}건')
            return True
        except Exception as e:
            logger.error(f"휴일 작업 명단 저장 실패: {e}")
            return False

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
    # 오류 리포트 관련 메서드
    # =========================================================================

    def add_error_report(self, user_id: str, user_name: str, app_version: str,
                         error_type: str, error_message: str, stack_trace: str = '') -> bool:
        """오류 리포트 저장"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    'INSERT INTO error_reports (user_id, user_name, app_version, error_type, error_message, stack_trace) '
                    'VALUES (?, ?, ?, ?, ?, ?)',
                    (user_id or '', user_name or '', app_version or '', error_type or '',
                     error_message[:2000] if error_message else '', (stack_trace or '')[:4000])
                )
            return True
        except Exception as e:
            logger.error(f"오류 리포트 저장 실패: {e}")
            return False

    def get_error_reports(self, limit: int = 50) -> List[dict]:
        """오류 리포트 목록 조회 (최신순)"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    'SELECT id, user_id, user_name, app_version, error_type, '
                    'error_message, stack_trace, timestamp, is_read '
                    'FROM error_reports ORDER BY timestamp DESC LIMIT ?',
                    (limit,)
                )
                rows = cursor.fetchall()
                return [dict(row) for row in rows]
        except Exception as e:
            logger.error(f"오류 리포트 조회 실패: {e}")
            return []

    def mark_error_report_read(self, error_id: int) -> bool:
        """오류 리포트 읽음 처리"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('UPDATE error_reports SET is_read=1 WHERE id=?', (error_id,))
            return True
        except Exception as e:
            logger.error(f"오류 리포트 읽음 처리 실패: {e}")
            return False

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
            logger.error(f"쿼리 실행 실패: {e} | query='{query[:60]}'")
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
                for key in ['contract_number', 'company', 'ship_name', 'engine_model', 'work_content', 'status',
                            'target_start_date', 'target_end_date', 'actual_end_date']:
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
        """날짜별 휴가자 현황 저장 (연차/반차/공가) + employee_leave_usage 자동 연동"""
        try:
            now = datetime.now().isoformat()
            days_map = {'연차': 1.0, '반차': 0.5, '공가': 0.0}
            with self.get_connection() as conn:
                cursor = conn.cursor()

                # vacation_records 저장
                for category in ('연차', '반차', '공가'):
                    names = data.get(category, '')
                    cursor.execute('''
                        INSERT INTO vacation_records (date, category, names, updated_at, updated_by)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(date, category)
                        DO UPDATE SET names = ?, updated_at = ?, updated_by = ?
                    ''', (date, category, names, now, username,
                          names, now, username))

                # employee_leave_usage 자동 연동:
                # 해당 날짜의 auto_vacation 레코드 삭제 후 재삽입 (항상 vacation_records와 동기화)
                cursor.execute(
                    "DELETE FROM employee_leave_usage WHERE use_date = ? AND created_by = 'auto_vacation'",
                    (date,)
                )
                for category in ('연차', '반차', '공가'):
                    names_str = data.get(category, '') or ''
                    days = days_map[category]
                    for raw_name in names_str.split(','):
                        name = raw_name.strip()
                        if not name:
                            continue
                        cursor.execute('''
                            INSERT INTO employee_leave_usage
                                (employee_name, use_date, leave_type, days, note, created_by)
                            VALUES (?, ?, ?, ?, ?, 'auto_vacation')
                        ''', (name, date, category, days, '일일작업현황 자동'))

            logger.info(f"휴가자 현황 저장 + 연차 사용 연동: {date}")
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

    # =========================================================================
    # 직원 연차 관리 메서드
    # =========================================================================

    def get_employee_leave_info(self, employee_name: str) -> dict:
        """직원 연차 전체 정보: 설정 + 부여이력 + 사용내역(올해) + 합계"""
        from datetime import date as _date
        today = _date.today()
        this_year = today.year

        info = {
            'config': {'generation_month': 1, 'note': ''},
            'grants': [],
            'usage_this_year': [],
            'all_usage_count': 0,
            'summary': {'total_granted': 0.0, 'total_used': 0.0, 'remaining': 0.0}
        }
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()

                # 설정 조회
                cursor.execute(
                    'SELECT generation_month, note FROM employee_annual_config WHERE employee_name = ?',
                    (employee_name,)
                )
                row = cursor.fetchone()
                if row:
                    info['config'] = {'generation_month': row['generation_month'], 'note': row['note'] or ''}

                # 부여 이력 (최신순)
                cursor.execute('''
                    SELECT id, grant_year, grant_month, days, note
                    FROM leave_grant_history
                    WHERE employee_name = ?
                    ORDER BY grant_year DESC, grant_month DESC
                ''', (employee_name,))
                for r in cursor.fetchall():
                    info['grants'].append({
                        'id': r['id'],
                        'grant_year': r['grant_year'],
                        'grant_month': r['grant_month'],
                        'days': r['days'],
                        'note': r['note'] or ''
                    })

                # 올해 사용 내역 (날짜순) — created_by 컬럼 없는 경우 폴백
                try:
                    cursor.execute('''
                        SELECT id, use_date, leave_type, days, note, created_by
                        FROM employee_leave_usage
                        WHERE employee_name = ? AND use_date LIKE ?
                        ORDER BY use_date ASC
                    ''', (employee_name, f'{this_year}-%'))
                except sqlite3.OperationalError:
                    # created_by 컬럼 없는 경우 (업그레이드 과도기)
                    cursor.execute('''
                        SELECT id, use_date, leave_type, days, note, '' AS created_by
                        FROM employee_leave_usage
                        WHERE employee_name = ? AND use_date LIKE ?
                        ORDER BY use_date ASC
                    ''', (employee_name, f'{this_year}-%'))
                for r in cursor.fetchall():
                    info['usage_this_year'].append({
                        'id': r['id'], 'use_date': r['use_date'],
                        'leave_type': r['leave_type'], 'days': r['days'],
                        'note': r['note'] or '',
                        'created_by': r['created_by'] or ''
                    })

                # 전체 사용 건수 (이전 연도 포함)
                cursor.execute(
                    'SELECT COUNT(*) as cnt FROM employee_leave_usage WHERE employee_name = ?',
                    (employee_name,)
                )
                info['all_usage_count'] = cursor.fetchone()['cnt']

                # 합계 계산
                # 총 부여: 오늘 이전까지의 grant만 합산
                cursor.execute('''
                    SELECT COALESCE(SUM(days), 0.0) as total
                    FROM leave_grant_history
                    WHERE employee_name = ?
                    AND (grant_year * 100 + grant_month) <= ?
                ''', (employee_name, this_year * 100 + today.month))
                total_granted = cursor.fetchone()['total']

                # 총 사용: 연차 + 반차만 차감 (공가 제외)
                cursor.execute('''
                    SELECT COALESCE(SUM(days), 0.0) as total
                    FROM employee_leave_usage
                    WHERE employee_name = ? AND leave_type IN ('연차', '반차')
                ''', (employee_name,))
                total_used = cursor.fetchone()['total']

                info['summary'] = {
                    'total_granted': round(total_granted, 1),
                    'total_used': round(total_used, 1),
                    'remaining': round(total_granted - total_used, 1)
                }

        except Exception as e:
            logger.error(f"직원 연차 정보 조회 실패: {e}")
        return info

    def save_employee_annual_config(self, employee_name: str, generation_month: int, note: str) -> bool:
        """직원 연차 설정 upsert"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO employee_annual_config (employee_name, generation_month, note)
                    VALUES (?, ?, ?)
                    ON CONFLICT(employee_name)
                    DO UPDATE SET generation_month = ?, note = ?
                ''', (employee_name, generation_month, note, generation_month, note))
            return True
        except Exception as e:
            logger.error(f"직원 연차 설정 저장 실패: {e}")
            return False

    def add_leave_grant(self, employee_name: str, grant_year: int, grant_month: int,
                        days: float, note: str, created_by: str = '') -> int:
        """연차 부여 이력 추가 → 신규 id 반환 (실패 시 -1)"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO leave_grant_history
                        (employee_name, grant_year, grant_month, days, note)
                    VALUES (?, ?, ?, ?, ?)
                ''', (employee_name, grant_year, grant_month, days, note))
                return cursor.lastrowid
        except Exception as e:
            logger.error(f"연차 부여 이력 추가 실패: {e}")
            return -1

    def delete_leave_grant(self, grant_id: int) -> bool:
        """연차 부여 이력 삭제"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('DELETE FROM leave_grant_history WHERE id = ?', (grant_id,))
            return True
        except Exception as e:
            logger.error(f"연차 부여 이력 삭제 실패: {e}")
            return False

    def add_leave_usage(self, employee_name: str, use_date: str, leave_type: str,
                        note: str, created_by: str = '') -> int:
        """연차 사용 내역 추가. days는 leave_type 기반 자동 결정. → id 반환 (실패 시 -1)"""
        days_map = {'연차': 1.0, '반차': 0.5, '공가': 0.0}
        days = days_map.get(leave_type, 1.0)
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO employee_leave_usage
                        (employee_name, use_date, leave_type, days, note, created_by)
                    VALUES (?, ?, ?, ?, ?, ?)
                ''', (employee_name, use_date, leave_type, days, note, created_by))
                return cursor.lastrowid
        except Exception as e:
            logger.error(f"연차 사용 내역 추가 실패: {e}")
            return -1

    def delete_leave_usage(self, usage_id: int) -> bool:
        """연차 사용 내역 삭제"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('DELETE FROM employee_leave_usage WHERE id = ?', (usage_id,))
            return True
        except Exception as e:
            logger.error(f"연차 사용 내역 삭제 실패: {e}")
            return False

    def get_employee_names_for_leave(self) -> list:
        """연차 관련 직원 이름 목록 (auth_users active + 기존 config) 합집합, 정렬"""
        names = set()
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                # 활성 인증 사용자 full_name
                try:
                    cursor.execute(
                        "SELECT full_name FROM auth_users WHERE status IN ('active','approved') AND full_name != ''",
                    )
                    for r in cursor.fetchall():
                        names.add(r['full_name'])
                except Exception:
                    pass
                # 기존 연차 설정이 있는 직원
                cursor.execute('SELECT employee_name FROM employee_annual_config')
                for r in cursor.fetchall():
                    names.add(r['employee_name'])
        except Exception as e:
            logger.error(f"직원 이름 목록 조회 실패: {e}")
        return sorted(list(names))

    def get_all_leave_monthly_report(self, year: int) -> list:
        """모든 직원의 연차 월별 현황 조회 (연차 월별 보고 탭용)"""
        names = self.get_employee_names_for_leave()
        result = []
        with self.get_connection() as conn:
            for name in names:
                # 해당 연도 월별 사용량 (연차+반차만, 공가 제외)
                rows = conn.execute(
                    "SELECT CAST(strftime('%m', use_date) AS INTEGER) AS m, SUM(days) "
                    "FROM employee_leave_usage "
                    "WHERE employee_name = ? AND strftime('%Y', use_date) = ? "
                    "AND leave_type IN ('연차', '반차') GROUP BY m",
                    (name, str(year))
                ).fetchall()
                monthly = {r[0]: round(r[1], 1) for r in rows}  # {1: 0.5, 3: 1.0, ...}

                # 연차 생성월
                cfg = conn.execute(
                    "SELECT generation_month FROM employee_annual_config WHERE employee_name = ?",
                    (name,)
                ).fetchone()
                gen_month = cfg[0] if cfg else 1

                # 누적 잔여 (전체 기간)
                grant_sum = conn.execute(
                    "SELECT COALESCE(SUM(days), 0) FROM leave_grant_history WHERE employee_name = ?",
                    (name,)
                ).fetchone()[0]
                use_sum = conn.execute(
                    "SELECT COALESCE(SUM(days), 0) FROM employee_leave_usage "
                    "WHERE employee_name = ? AND leave_type IN ('연차', '반차')",
                    (name,)
                ).fetchone()[0]

                result.append({
                    'name': name,
                    'monthly': monthly,
                    'generation_month': gen_month,
                    'remaining': round(grant_sum - use_sum, 1)
                })
        return result


# 싱글톤 인스턴스
db = DatabaseManager()
