# src/database/auth_manager.py - 사용자 인증 관리

import sqlite3
import hashlib
import json
import os
import random
import string
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, List, Dict, Any
from contextlib import contextmanager

from ..utils.logger import logger
from ..utils.config import config


class AuthManager:
    """사용자 인증 관리 클래스"""
    
    def __init__(self, db_path: str = None):
        if db_path is None:
            db_path = config.db_path
        
        self.db_path = Path(db_path)
        self._token_lock = threading.Lock()   # #3 — 토큰 파일 동시 접근 방지
        self._ensure_db_directory()
        self._init_auth_tables()
        self.ensure_admin_account()
        logger.info(f"인증 시스템 초기화 완료: {self.db_path}")
    
    def _ensure_db_directory(self):
        """데이터베이스 디렉토리 생성"""
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
    
    @contextmanager
    def get_connection(self):
        """데이터베이스 연결 컨텍스트 매니저"""
        conn = sqlite3.connect(str(self.db_path), timeout=30)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception as e:
            conn.rollback()
            logger.error(f"데이터베이스 오류: {e}")
            raise
        finally:
            conn.close()
    
    def _init_auth_tables(self):
        """인증 관련 테이블 초기화"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # 인증 사용자 테이블
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS auth_users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    full_name TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'user',
                    status TEXT NOT NULL DEFAULT 'pending',
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    last_login TEXT,
                    approved_by TEXT,
                    approved_at TEXT
                )
            ''')
            
            # 사용자 등록 요청 테이블
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS registration_requests (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    full_name TEXT NOT NULL,
                    requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    status TEXT NOT NULL DEFAULT 'pending',
                    processed_by TEXT,
                    processed_at TEXT,
                    note TEXT
                )
            ''')
            
            # 텔레그램 연동 컬럼 추가 (기존 DB 마이그레이션)
            try:
                cursor.execute('ALTER TABLE auth_users ADD COLUMN telegram_chat_id TEXT DEFAULT NULL')
            except sqlite3.OperationalError:
                pass  # 이미 존재
            try:
                cursor.execute('ALTER TABLE auth_users ADD COLUMN telegram_linked_at TEXT DEFAULT NULL')
            except sqlite3.OperationalError:
                pass  # 이미 존재
            # 클라이언트 버전/마지막 접속 컬럼 추가 (사용자 현황 탭)
            for _col, _defn in [('client_version', 'TEXT'), ('last_seen', 'TEXT')]:
                try:
                    cursor.execute(f'ALTER TABLE auth_users ADD COLUMN {_col} {_defn}')
                except sqlite3.OperationalError:
                    pass  # 이미 존재
            # 트레이 모드 컬럼 추가 (0=앱 완전 종료(기본), 1=트레이로 최소화)
            try:
                cursor.execute('ALTER TABLE auth_users ADD COLUMN tray_mode INTEGER DEFAULT 0')
            except sqlite3.OperationalError:
                pass  # 이미 존재
            # 연차 월별 보고 편집 권한 컬럼 추가 (0=숨김(기본), 1=직원 추가 버튼 노출)
            try:
                cursor.execute('ALTER TABLE auth_users ADD COLUMN leave_report_edit INTEGER DEFAULT 0')
            except sqlite3.OperationalError:
                pass  # 이미 존재
            # 일일 작업 쓰기 권한 컬럼 추가 (0=읽기 전용(기본), 1=저장 가능)
            try:
                cursor.execute('ALTER TABLE auth_users ADD COLUMN can_write INTEGER DEFAULT 0')
                # admin 계정은 항상 쓰기 권한 자동 부여
                cursor.execute("UPDATE auth_users SET can_write = 1 WHERE role = 'admin'")
            except sqlite3.OperationalError:
                pass  # 이미 존재
            # ERP 입력 자동화 권한 컬럼 추가 (0=숨김(기본), 1=ERP 입력 탭 표시)
            try:
                cursor.execute('ALTER TABLE auth_users ADD COLUMN erp_input INTEGER DEFAULT 0')
            except sqlite3.OperationalError:
                pass  # 이미 존재

            # 텔레그램 연결 코드 테이블
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS telegram_link_codes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    code TEXT UNIQUE NOT NULL,
                    user_id TEXT NOT NULL,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    expires_at TEXT NOT NULL,
                    used INTEGER DEFAULT 0
                )
            ''')

            # 텔레그램 메시지 매핑 테이블 (답장→댓글 변환용)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS telegram_message_map (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    telegram_message_id INTEGER NOT NULL,
                    chat_id INTEGER NOT NULL,
                    contract_number TEXT DEFAULT '',
                    board_project_id INTEGER DEFAULT NULL,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(telegram_message_id, chat_id)
                )
            ''')

            # 자동 로그인 세션 테이블
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS auth_sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    token TEXT UNIQUE NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    is_active INTEGER NOT NULL DEFAULT 1
                )
            ''')

            conn.commit()

    def ensure_admin_account(self):
        """관리자 계정 보장 — 없을 때만 생성, 기존 계정의 비밀번호는 건드리지 않음.
        클라우드 DB 덮어쓰기 이후에도 호출되므로 public 메서드로 공개."""
        try:
            initial_password = config.get('admin.admin_initial_password', '44448901')
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('SELECT id FROM auth_users WHERE user_id = ?', ('ha_admin',))
                row = cursor.fetchone()
                if not row:
                    password_hash = self._hash_password(initial_password)
                    cursor.execute('''
                        INSERT INTO auth_users (user_id, password_hash, full_name, role, status, approved_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                    ''', ('ha_admin', password_hash, '시스템 관리자', 'admin', 'active',
                          datetime.now().isoformat()))
                    logger.info("관리자 계정 생성 완료")
                else:
                    logger.debug("관리자 계정 확인됨 (기존 비밀번호 유지)")
        except Exception as e:
            logger.error(f"관리자 계정 보장 실패: {e}")
    
    def _hash_password(self, password: str) -> str:
        """비밀번호 해시화 (PBKDF2-HMAC-SHA256, salt 포함)"""
        salt = os.urandom(32)
        dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 260000)
        return f"pbkdf2${salt.hex()}${dk.hex()}"

    def _verify_password(self, password: str, stored_hash: str) -> bool:
        """비밀번호 검증 (PBKDF2 및 구형 SHA-256 모두 지원)"""
        if not stored_hash:          # #4 — password_hash NULL 방어
            return False
        if stored_hash.startswith('pbkdf2$'):
            try:
                _, salt_hex, dk_hex = stored_hash.split('$')
                salt = bytes.fromhex(salt_hex)
                dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 260000)
                return dk.hex() == dk_hex
            except Exception:
                return False
        else:
            # 구형 SHA-256 단순 해시
            return hashlib.sha256(password.encode()).hexdigest() == stored_hash
    
    # =========================================================================
    # 인증 관련 메서드
    # =========================================================================
    
    def authenticate(self, user_id: str, password: str) -> Optional[Dict[str, Any]]:
        """사용자 인증"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()

                cursor.execute('SELECT * FROM auth_users WHERE user_id = ?', (user_id,))
                row = cursor.fetchone()

                if not row:
                    _uid_mask = (user_id[:2] + '***') if user_id else '(empty)'  # #10 — user_id 마스킹
                    logger.warning(f"로그인 실패 - 없는 사용자: {_uid_mask}")
                    return {'error': 'USER_NOT_FOUND'}

                user = dict(row)

                if not self._verify_password(password, user['password_hash']):
                    _uid_mask = (user_id[:2] + '***') if user_id else '(empty)'  # #10
                    logger.warning(f"로그인 실패 - 비밀번호 불일치: {_uid_mask}")
                    return {'error': 'WRONG_PASSWORD'}

                # 상태 확인
                if user['status'] == 'pending':
                    return {'error': '승인 대기 중입니다. 관리자에게 문의하세요.'}
                elif user['status'] == 'rejected':
                    return {'error': '계정이 거부되었습니다. 관리자에게 문의하세요.'}
                elif user['status'] == 'inactive':
                    return {'error': '비활성화된 계정입니다. 관리자에게 문의하세요.'}
                elif user['status'] == 'retired':
                    return {'error': '퇴사 처리된 계정입니다. 관리자에게 문의하세요.'}

                # 구형 SHA-256 해시라면 PBKDF2로 자동 업그레이드
                if not (user['password_hash'] or '').startswith('pbkdf2$'):  # #4 — NULL 안전
                    new_hash = self._hash_password(password)
                    cursor.execute(
                        'UPDATE auth_users SET password_hash = ? WHERE id = ?',
                        (new_hash, user['id'])
                    )
                    logger.info(f"비밀번호 해시 업그레이드 완료: {user_id}")

                # 마지막 로그인 시간 업데이트
                cursor.execute(
                    'UPDATE auth_users SET last_login = ? WHERE id = ?',
                    (datetime.now().isoformat(), user['id'])
                )

                logger.info(f"사용자 로그인: {user_id} ({user['role']})")
                return user

        except Exception as e:
            logger.error(f"인증 오류: {e}")
            return None
    
    def register_request(self, user_id: str, password: str, full_name: str) -> bool:
        """신규 사용자 등록 요청"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                
                # 중복 확인
                cursor.execute('SELECT id FROM auth_users WHERE user_id = ?', (user_id,))
                if cursor.fetchone():
                    return False  # 이미 존재하는 계정
                
                # 등록 요청 추가
                cursor.execute('''
                    INSERT INTO registration_requests (user_id, full_name)
                    VALUES (?, ?)
                ''', (user_id, full_name))
                
                # pending 상태로 사용자 계정 생성
                password_hash = self._hash_password(password)
                cursor.execute('''
                    INSERT INTO auth_users (user_id, password_hash, full_name, role, status)
                    VALUES (?, ?, ?, ?, ?)
                ''', (user_id, password_hash, full_name, 'user', 'pending'))
                
                logger.info(f"등록 요청: {user_id} ({full_name})")
                return True
                
        except Exception as e:
            logger.error(f"등록 요청 실패: {e}")
            return False
    
    # =========================================================================
    # 관리자 기능
    # =========================================================================
    
    def get_all_users(self) -> List[Dict[str, Any]]:
        """모든 사용자 조회"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                try:
                    cursor.execute('''
                        SELECT id, user_id, full_name, role, status, created_at, last_login,
                               leave_report_edit, can_write, erp_input
                        FROM auth_users
                        ORDER BY created_at DESC
                    ''')
                except sqlite3.OperationalError:
                    # erp_input 컬럼 아직 없는 경우 (업그레이드 과도기)
                    try:
                        cursor.execute('''
                            SELECT id, user_id, full_name, role, status, created_at, last_login,
                                   leave_report_edit, can_write, 0 AS erp_input
                            FROM auth_users
                            ORDER BY created_at DESC
                        ''')
                    except sqlite3.OperationalError:
                        # can_write 컬럼 아직 없는 경우 (업그레이드 과도기)
                        try:
                            cursor.execute('''
                                SELECT id, user_id, full_name, role, status, created_at, last_login,
                                       leave_report_edit, 0 AS can_write, 0 AS erp_input
                                FROM auth_users
                                ORDER BY created_at DESC
                            ''')
                        except sqlite3.OperationalError:
                            # leave_report_edit 컬럼도 없는 경우 (구버전)
                            cursor.execute('''
                                SELECT id, user_id, full_name, role, status, created_at, last_login,
                                       0 AS leave_report_edit, 0 AS can_write, 0 AS erp_input
                                FROM auth_users
                                ORDER BY created_at DESC
                            ''')
                rows = cursor.fetchall()
                return [dict(row) for row in rows]
        except Exception as e:
            logger.error(f"사용자 목록 조회 실패: {e}")
            return []
    
    def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        """특정 사용자 조회"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    SELECT id, user_id, full_name, role, status, created_at, last_login
                    FROM auth_users
                    WHERE user_id = ?
                ''', (user_id,))
                row = cursor.fetchone()
                return dict(row) if row else None
        except Exception as e:
            logger.error(f"사용자 조회 실패: {e}")
            return None

    def get_tray_mode(self, user_id: str) -> bool:
        """사용자 트레이 모드 설정 조회 (True=트레이 최소화, False=앱 종료)"""
        try:
            with self.get_connection() as conn:
                row = conn.execute(
                    'SELECT tray_mode FROM auth_users WHERE user_id = ?', (user_id,)
                ).fetchone()
            return bool(row['tray_mode']) if row else False
        except Exception as e:
            logger.error(f"트레이 설정 조회 실패: {e}")
            return False

    def update_tray_mode(self, user_id: str, enabled: bool):
        """사용자 트레이 모드 설정 저장"""
        try:
            with self.get_connection() as conn:
                conn.execute(
                    'UPDATE auth_users SET tray_mode = ? WHERE user_id = ?',
                    (1 if enabled else 0, user_id)
                )
        except Exception as e:
            logger.error(f"트레이 설정 저장 실패: {e}")
            raise

    def set_leave_report_edit(self, user_id: str, enabled: bool) -> bool:
        """연차 월별 보고 편집 권한 설정 (관리자가 사용자에게 부여)"""
        try:
            with self.get_connection() as conn:
                conn.execute(
                    'UPDATE auth_users SET leave_report_edit = ? WHERE user_id = ?',
                    (1 if enabled else 0, user_id)
                )
            return True
        except Exception as e:
            logger.error(f"leave_report_edit 설정 실패: {e}")
            return False

    def set_can_write(self, user_id: str, enabled: bool) -> bool:
        """일일 작업 쓰기 권한 설정 (관리자가 사용자에게 부여/해제)"""
        try:
            with self.get_connection() as conn:
                conn.execute(
                    'UPDATE auth_users SET can_write = ? WHERE user_id = ?',
                    (1 if enabled else 0, user_id)
                )
            return True
        except Exception as e:
            logger.error(f"can_write 설정 실패: {e}")
            return False

    def set_erp_input(self, user_id: str, enabled: bool) -> bool:
        """ERP 입력 자동화 권한 설정 (관리자가 사용자에게 부여/해제)"""
        try:
            with self.get_connection() as conn:
                conn.execute(
                    'UPDATE auth_users SET erp_input = ? WHERE user_id = ?',
                    (1 if enabled else 0, user_id)
                )
            return True
        except Exception as e:
            logger.error(f"erp_input 설정 실패: {e}")
            return False

    def get_can_write_by_fullname(self, full_name: str) -> bool:
        """full_name 기준 쓰기 권한 조회 (save_work_records 권한 검증용)"""
        try:
            with self.get_connection() as conn:
                row = conn.execute(
                    "SELECT can_write, role FROM auth_users "
                    "WHERE full_name = ? AND status = 'active'",
                    (full_name,)
                ).fetchone()
            if not row:
                return False
            # admin 역할은 항상 쓰기 허용
            if row['role'] == 'admin':
                return True
            return bool(row['can_write'])
        except Exception as e:
            logger.error(f"can_write 조회 실패: {e}")
            return False

    def get_pending_requests(self) -> List[Dict[str, Any]]:
        """승인 대기 중인 요청 조회"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    SELECT * FROM registration_requests
                    WHERE status = 'pending'
                    ORDER BY requested_at DESC
                ''')
                rows = cursor.fetchall()
                return [dict(row) for row in rows]
        except Exception as e:
            logger.error(f"대기 요청 조회 실패: {e}")
            return []
    
    def approve_user(self, user_id: str, admin_id: str) -> bool:
        """사용자 승인"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                
                now = datetime.now().isoformat()
                
                # 사용자 상태 변경
                cursor.execute('''
                    UPDATE auth_users 
                    SET status = 'active', approved_by = ?, approved_at = ?
                    WHERE user_id = ?
                ''', (admin_id, now, user_id))
                
                # 등록 요청 상태 변경
                cursor.execute('''
                    UPDATE registration_requests
                    SET status = 'approved', processed_by = ?, processed_at = ?
                    WHERE user_id = ? AND status = 'pending'
                ''', (admin_id, now, user_id))
                
                logger.info(f"사용자 승인: {user_id} by {admin_id}")
                return True
                
        except Exception as e:
            logger.error(f"사용자 승인 실패: {e}")
            return False
    
    def reject_user(self, user_id: str, admin_id: str, note: str = '') -> bool:
        """사용자 거부"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                
                now = datetime.now().isoformat()
                
                # 사용자 상태 변경
                cursor.execute('''
                    UPDATE auth_users 
                    SET status = 'rejected'
                    WHERE user_id = ?
                ''', (user_id,))
                
                # 등록 요청 상태 변경
                cursor.execute('''
                    UPDATE registration_requests
                    SET status = 'rejected', processed_by = ?, processed_at = ?, note = ?
                    WHERE user_id = ? AND status = 'pending'
                ''', (admin_id, now, note, user_id))
                
                logger.info(f"사용자 거부: {user_id} by {admin_id}")
                return True
                
        except Exception as e:
            logger.error(f"사용자 거부 실패: {e}")
            return False
    
    def delete_user(self, user_id: str, admin_id: str) -> bool:
        """사용자 퇴사 처리 (soft delete) — 실제 삭제 없이 상태만 변경"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()

                # 관리자는 퇴사 처리 불가
                cursor.execute('SELECT role, full_name, status FROM auth_users WHERE user_id = ?', (user_id,))
                row = cursor.fetchone()
                if not row:
                    return False
                if row['role'] == 'admin':
                    logger.warning(f"관리자 계정 퇴사 처리 시도 차단: {user_id}")
                    return False
                if row['status'] == 'retired':
                    return True  # 이미 퇴사 처리됨

                # full_name에 (퇴사) 접미어 추가 (중복 방지)
                old_name = row['full_name']
                new_name = old_name if old_name.endswith('(퇴사)') else old_name + '(퇴사)'

                cursor.execute(
                    'UPDATE auth_users SET status = ?, full_name = ? WHERE user_id = ?',
                    ('retired', new_name, user_id)
                )

                logger.info(f"사용자 퇴사 처리: {user_id} ({new_name}) by {admin_id}")
                return True

        except Exception as e:
            logger.error(f"사용자 퇴사 처리 실패: {e}")
            return False
    
    # =========================================================================
    # 텔레그램 연동 메서드
    # =========================================================================

    def generate_link_code(self, user_id: str) -> Optional[str]:
        """텔레그램 연결용 6자리 코드 생성 (30분 만료)"""
        try:
            code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
            expires_at = (datetime.now() + timedelta(minutes=30)).isoformat()

            with self.get_connection() as conn:
                cursor = conn.cursor()
                # 기존 미사용 코드 삭제
                cursor.execute('DELETE FROM telegram_link_codes WHERE user_id = ? AND used = 0', (user_id,))
                cursor.execute('''
                    INSERT INTO telegram_link_codes (code, user_id, expires_at)
                    VALUES (?, ?, ?)
                ''', (code, user_id, expires_at))
                logger.info(f"텔레그램 연결 코드 생성: {user_id} → {code}")
                return code
        except Exception as e:
            logger.error(f"연결 코드 생성 실패: {e}")
            return None

    def consume_link_code(self, code: str, chat_id: int) -> Optional[str]:
        """연결 코드 검증 + chat_id 저장. 성공 시 user_id 반환"""
        try:
            now = datetime.now().isoformat()
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    SELECT user_id FROM telegram_link_codes
                    WHERE code = ? AND used = 0 AND expires_at > ?
                ''', (code, now))
                row = cursor.fetchone()
                if not row:
                    return None

                user_id = row['user_id']

                # 코드 사용 처리
                cursor.execute('UPDATE telegram_link_codes SET used = 1 WHERE code = ?', (code,))

                # 사용자에 chat_id 저장
                cursor.execute('''
                    UPDATE auth_users SET telegram_chat_id = ?, telegram_linked_at = ?
                    WHERE user_id = ?
                ''', (str(chat_id), now, user_id))

                logger.info(f"텔레그램 연결 완료: {user_id} → chat_id={chat_id}")
                return user_id
        except Exception as e:
            logger.error(f"연결 코드 검증 실패: {e}")
            return None

    def unlink_telegram(self, user_id: str) -> bool:
        """텔레그램 연결 해제"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    UPDATE auth_users SET telegram_chat_id = NULL, telegram_linked_at = NULL
                    WHERE user_id = ?
                ''', (user_id,))
                logger.info(f"텔레그램 연결 해제: {user_id}")
                return True
        except Exception as e:
            logger.error(f"텔레그램 연결 해제 실패: {e}")
            return False

    def get_telegram_status(self, user_id: str) -> Dict[str, Any]:
        """텔레그램 연결 상태 조회"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    SELECT telegram_chat_id, telegram_linked_at FROM auth_users WHERE user_id = ?
                ''', (user_id,))
                row = cursor.fetchone()
                if row and row['telegram_chat_id']:
                    return {'linked': True, 'linked_at': row['telegram_linked_at']}
                return {'linked': False}
        except Exception as e:
            logger.error(f"텔레그램 상태 조회 실패: {e}")
            return {'linked': False}

    def get_all_linked_chat_ids(self) -> List[Dict[str, Any]]:
        """텔레그램 연결된 모든 사용자 조회"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    SELECT user_id, full_name, telegram_chat_id
                    FROM auth_users
                    WHERE telegram_chat_id IS NOT NULL AND status = 'active'
                ''')
                return [dict(row) for row in cursor.fetchall()]
        except Exception as e:
            logger.error(f"텔레그램 사용자 목록 조회 실패: {e}")
            return []

    def get_user_by_chat_id(self, chat_id: int) -> Optional[Dict[str, Any]]:
        """chat_id로 사용자 조회"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    SELECT user_id, full_name FROM auth_users
                    WHERE telegram_chat_id = ? AND status = 'active'
                ''', (str(chat_id),))
                row = cursor.fetchone()
                return dict(row) if row else None
        except Exception as e:
            logger.error(f"chat_id 사용자 조회 실패: {e}")
            return None

    def save_message_mapping(self, telegram_message_id: int, chat_id: int,
                             contract_number: str = '', board_project_id: int = None):
        """텔레그램 메시지 → 프로젝트 매핑 저장"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT OR REPLACE INTO telegram_message_map
                    (telegram_message_id, chat_id, contract_number, board_project_id)
                    VALUES (?, ?, ?, ?)
                ''', (telegram_message_id, chat_id, contract_number or '', board_project_id))
        except Exception as e:
            logger.error(f"메시지 매핑 저장 실패: {e}")

    def get_project_by_reply(self, telegram_message_id: int, chat_id: int) -> Optional[Dict[str, Any]]:
        """답장 메시지로 프로젝트 정보 조회"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    SELECT contract_number, board_project_id FROM telegram_message_map
                    WHERE telegram_message_id = ? AND chat_id = ?
                ''', (telegram_message_id, chat_id))
                row = cursor.fetchone()
                return dict(row) if row else None
        except Exception as e:
            logger.error(f"답장 매핑 조회 실패: {e}")
            return None

    def cleanup_old_telegram_data(self):
        """오래된 텔레그램 데이터 정리"""
        try:
            cutoff_codes = (datetime.now() - timedelta(hours=1)).isoformat()
            cutoff_messages = (datetime.now() - timedelta(days=30)).isoformat()
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('DELETE FROM telegram_link_codes WHERE created_at < ?', (cutoff_codes,))
                cursor.execute('DELETE FROM telegram_message_map WHERE created_at < ?', (cutoff_messages,))
        except Exception as e:
            logger.error(f"텔레그램 데이터 정리 실패: {e}")

    def update_user_version(self, user_id: str, version: str) -> bool:
        """로그인 성공 시 클라이언트 버전과 last_seen 업데이트"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "UPDATE auth_users SET client_version=?, last_seen=datetime('now','localtime') WHERE user_id=?",
                    (version, user_id)
                )
                return True
        except Exception as e:
            logger.error(f"클라이언트 버전 업데이트 실패: {e}")
            return False

    def update_user_status(self, user_id: str, status: str, admin_id: str) -> bool:
        """사용자 상태 변경"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    UPDATE auth_users SET status = ?
                    WHERE user_id = ?
                ''', (status, user_id))

                logger.info(f"사용자 상태 변경: {user_id} -> {status} by {admin_id}")
                return True

        except Exception as e:
            logger.error(f"사용자 상태 변경 실패: {e}")
            return False

    # =========================================================================
    # 자동 로그인 토큰 (로컬 파일 기반 — 클라우드 동기화 영향 없음)
    # =========================================================================

    def _get_token_file(self) -> Path:
        """토큰 저장 파일 경로 (설치 디렉토리 data/ → 클라우드 동기화 대상 아님)"""
        # auth_manager.py → src/database/ → src/ → app_root(프로젝트 루트 또는 {app}/app/)
        data_dir = Path(__file__).parent.parent.parent / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        return data_dir / "remember_tokens.json"

    def _load_tokens(self) -> Dict[str, Any]:
        """토큰 파일 로드 — #3: _token_lock 보유 상태에서 호출"""
        try:
            f = self._get_token_file()
            if f.exists():
                with open(f, 'r', encoding='utf-8') as fp:
                    return json.load(fp)
        except Exception:
            pass
        return {}

    def _save_tokens(self, tokens: Dict[str, Any]) -> None:
        """토큰 파일 저장 — #3: _token_lock 보유 상태에서 호출"""
        f = self._get_token_file()
        with open(f, 'w', encoding='utf-8') as fp:
            json.dump(tokens, fp, ensure_ascii=False, indent=2)
        try:
            os.chmod(f, 0o600)  # 소유자만 읽기/쓰기 (Windows는 무시됨)
        except Exception:
            pass

    def create_remember_token(self, user_id: str) -> Optional[str]:
        """자동 로그인 토큰 생성 (30일 유효, 로컬 파일 저장)"""
        import uuid
        token = str(uuid.uuid4())
        expires_at = (datetime.now() + timedelta(days=30)).isoformat()
        try:
            with self._token_lock:  # #3 — 파일 락
                tokens = self._load_tokens()
                token_hash = hashlib.sha256(token.encode()).hexdigest()
                tokens[token_hash] = {
                    'user_id': user_id,
                    'created_at': datetime.now().isoformat(),
                    'expires_at': expires_at,
                    'is_active': True
                }
                self._save_tokens(tokens)
            logger.info(f"자동 로그인 토큰 생성: {user_id}")
            return token
        except Exception as e:
            logger.error(f"Remember token 생성 실패: {e}")
            return None

    def validate_remember_token(self, token: str) -> Optional[Dict[str, Any]]:
        """토큰 검증 → 유효하면 사용자 정보 반환"""
        try:
            with self._token_lock:  # #3 — 파일 락
                tokens = self._load_tokens()
                token_hash = hashlib.sha256(token.encode()).hexdigest()
                entry = tokens.get(token_hash)
            if not entry:
                return None
            if not entry.get('is_active', False):
                return None
            if entry.get('expires_at', '') <= datetime.now().isoformat():
                return None
            user_id = entry['user_id']
            # DB에서 사용자 현재 상태 확인
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    'SELECT user_id, full_name, role, status, tray_mode, leave_report_edit, can_write FROM auth_users WHERE user_id = ?',
                    (user_id,)
                )
                row = cursor.fetchone()
                if not row:
                    return None
                uid, full_name, role, status = row['user_id'], row['full_name'], row['role'], row['status']
                tray_mode = bool(row['tray_mode']) if row['tray_mode'] else False
                leave_report_edit = bool(row['leave_report_edit']) if row['leave_report_edit'] else False
                # admin은 can_write 컬럼 무관하게 항상 쓰기 허용
                try:
                    can_write = bool(row['can_write']) if row['can_write'] else (role == 'admin')
                except Exception:
                    can_write = (role == 'admin')
                if status not in ('active', 'approved'):
                    return None
            logger.info(f"자동 로그인 토큰 검증 성공: {uid}")
            return {'user_id': uid, 'full_name': full_name, 'role': role,
                    'tray_mode': tray_mode, 'leave_report_edit': leave_report_edit,
                    'can_write': can_write}
        except Exception as e:
            logger.error(f"Remember token 검증 실패: {e}")
            return None

    def get_token_days_remaining(self, token: str) -> int:
        """토큰 만료까지 남은 일수 반환 (없거나 만료 시 0)"""
        try:
            with self._token_lock:  # #3 — 파일 락
                tokens = self._load_tokens()
                token_hash = hashlib.sha256(token.encode()).hexdigest()
                entry = tokens.get(token_hash)
            if not entry or not entry.get('is_active'):
                return 0
            expires_at = datetime.fromisoformat(entry.get('expires_at', ''))
            delta = expires_at - datetime.now()
            return max(0, delta.days)
        except Exception:
            return 0

    def clear_remember_token(self, token: str) -> bool:
        """토큰 비활성화 (로그아웃 시)"""
        try:
            with self._token_lock:  # #3 — 파일 락
                tokens = self._load_tokens()
                token_hash = hashlib.sha256(token.encode()).hexdigest()
                if token_hash in tokens:
                    tokens[token_hash]['is_active'] = False
                    self._save_tokens(tokens)
            return True
        except Exception as e:
            logger.error(f"Remember token 삭제 실패: {e}")
            return False


# 싱글톤 인스턴스
auth_manager = AuthManager()
