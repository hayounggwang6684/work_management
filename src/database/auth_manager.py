# src/database/auth_manager.py - 사용자 인증 관리

import sqlite3
import hashlib
import os
import random
import string
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
        self._ensure_db_directory()
        self._init_auth_tables()
        self._create_admin_account()
        logger.info(f"인증 시스템 초기화 완료: {self.db_path}")
    
    def _ensure_db_directory(self):
        """데이터베이스 디렉토리 생성"""
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
    
    @contextmanager
    def get_connection(self):
        """데이터베이스 연결 컨텍스트 매니저"""
        conn = sqlite3.connect(str(self.db_path))
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

            conn.commit()

    def _create_admin_account(self):
        """관리자 계정 생성"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                
                # 관리자 계정이 없으면 생성
                cursor.execute('SELECT id FROM auth_users WHERE user_id = ?', ('ha_admin',))
                if not cursor.fetchone():
                    initial_password = config.get('admin.admin_initial_password', '44448901')
                    password_hash = self._hash_password(initial_password)
                    cursor.execute('''
                        INSERT INTO auth_users (user_id, password_hash, full_name, role, status, approved_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                    ''', ('ha_admin', password_hash, '시스템 관리자', 'admin', 'active', datetime.now().isoformat()))
                    logger.info("관리자 계정 생성 완료")
                    
        except Exception as e:
            logger.error(f"관리자 계정 생성 실패: {e}")
    
    def _hash_password(self, password: str) -> str:
        """비밀번호 해시화 (PBKDF2-HMAC-SHA256, salt 포함)"""
        salt = os.urandom(32)
        dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 260000)
        return f"pbkdf2${salt.hex()}${dk.hex()}"

    def _verify_password(self, password: str, stored_hash: str) -> bool:
        """비밀번호 검증 (PBKDF2 및 구형 SHA-256 모두 지원)"""
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
                    logger.warning(f"로그인 실패: {user_id}")
                    return None

                user = dict(row)

                if not self._verify_password(password, user['password_hash']):
                    logger.warning(f"로그인 실패: {user_id}")
                    return None

                # 상태 확인
                if user['status'] == 'pending':
                    return {'error': '승인 대기 중입니다. 관리자에게 문의하세요.'}
                elif user['status'] == 'rejected':
                    return {'error': '계정이 거부되었습니다. 관리자에게 문의하세요.'}
                elif user['status'] == 'inactive':
                    return {'error': '비활성화된 계정입니다. 관리자에게 문의하세요.'}

                # 구형 SHA-256 해시라면 PBKDF2로 자동 업그레이드
                if not user['password_hash'].startswith('pbkdf2$'):
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
                cursor.execute('''
                    SELECT id, user_id, full_name, role, status, created_at, last_login
                    FROM auth_users
                    ORDER BY created_at DESC
                ''')
                rows = cursor.fetchall()
                return [dict(row) for row in rows]
        except Exception as e:
            logger.error(f"사용자 목록 조회 실패: {e}")
            return []
    
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
        """사용자 삭제"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                
                # 관리자는 삭제 불가
                cursor.execute('SELECT role FROM auth_users WHERE user_id = ?', (user_id,))
                row = cursor.fetchone()
                if row and row['role'] == 'admin':
                    logger.warning(f"관리자 계정 삭제 시도 차단: {user_id}")
                    return False
                
                # 사용자 삭제
                cursor.execute('DELETE FROM auth_users WHERE user_id = ?', (user_id,))
                cursor.execute('DELETE FROM registration_requests WHERE user_id = ?', (user_id,))
                
                logger.info(f"사용자 삭제: {user_id} by {admin_id}")
                return True
                
        except Exception as e:
            logger.error(f"사용자 삭제 실패: {e}")
            return False
    
    # =========================================================================
    # 텔레그램 연동 메서드
    # =========================================================================

    def generate_link_code(self, user_id: str) -> Optional[str]:
        """텔레그램 연결용 6자리 코드 생성 (5분 만료)"""
        try:
            code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
            expires_at = (datetime.now() + timedelta(minutes=5)).isoformat()

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


# 싱글톤 인스턴스
auth_manager = AuthManager()
