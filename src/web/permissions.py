"""
서버측 권한 게이트 (order.md #7)

기존 방식의 문제:
    관리자 API가 `admin_id` 를 JS 인자로 받아 역할을 확인했다. Eel 은 로컬 HTTP
    서버이므로 브라우저 콘솔에서 `eel.admin_delete_user('아무개', 'admin')` 처럼
    아무 값이나 넘길 수 있어 실질적인 방어가 되지 않았다.

이 모듈의 방식:
    로그인 성공 시 서버(파이썬) 쪽에 현재 세션을 기록하고, 권한 판정은 오직 그
    서버 세션만 근거로 한다. JS 가 무엇을 넘기든 판정 결과는 바뀌지 않는다.

사용법:
    @eel.expose
    @require('write')
    def save_work_records(...): ...

    데코레이터 순서 주의 — `@eel.expose` 가 반드시 바깥(위)에 있어야 Eel 이
    권한 검사로 감싼 함수를 등록한다.
"""

import functools
import logging
import threading
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)

# ============================================================================
# 권한 등급
# ============================================================================
# public : 로그인 이전에도 호출 가능 (인증·업데이트·앱 정보 등)
# guest  : 게스트(비로그인 조회) 또는 로그인 사용자 — 작업 현황 조회 계열
# login  : 로그인 사용자만 (게스트 불가) — 개인정보·내보내기 계열
# write  : 로그인 + can_write
# admin  : 로그인 + role == 'admin'
# erp    : 로그인 + erp_input
TIERS = ('public', 'guest', 'login', 'write', 'admin', 'erp')

GUEST_ROLE = 'guest'

_lock = threading.RLock()
_session: Optional[Dict[str, Any]] = None


# ============================================================================
# 세션 관리
# ============================================================================

def begin_session(user: Dict[str, Any]) -> None:
    """로그인 성공 시 서버측 세션 기록"""
    global _session
    with _lock:
        _session = {
            'user_id': user.get('user_id', ''),
            'full_name': user.get('full_name', ''),
            'role': user.get('role', 'user'),
            'can_write': bool(user.get('can_write', 0)),
            'erp_input': bool(user.get('erp_input', 0)),
            'leave_report_edit': bool(user.get('leave_report_edit', 0)),
            'is_guest': False,
        }
    logger.info(f"세션 시작: {_session['user_id']} (role={_session['role']}, "
                f"can_write={_session['can_write']})")


def begin_guest_session() -> Dict[str, Any]:
    """게스트(비로그인) 조회 전용 세션 시작"""
    global _session
    with _lock:
        _session = {
            'user_id': 'guest',
            'full_name': '게스트',
            'role': GUEST_ROLE,
            'can_write': False,
            'erp_input': False,
            'leave_report_edit': False,
            'is_guest': True,
        }
        snapshot = dict(_session)
    logger.info("게스트 세션 시작 (조회 전용)")
    return snapshot


def end_session() -> None:
    """로그아웃"""
    global _session
    with _lock:
        if _session:
            logger.info(f"세션 종료: {_session.get('user_id')}")
        _session = None


def current_user() -> Optional[Dict[str, Any]]:
    with _lock:
        return dict(_session) if _session else None


def is_guest() -> bool:
    with _lock:
        return bool(_session and _session.get('is_guest'))


def is_authenticated() -> bool:
    """게스트가 아닌 실제 로그인 상태인지"""
    with _lock:
        return bool(_session and not _session.get('is_guest'))


# ============================================================================
# 거부 응답 — 함수의 반환 타입에 맞춰야 JS 쪽이 깨지지 않는다
# ============================================================================

def _empty_for(func: Callable, message: str, code: str) -> Any:
    """
    권한 거부 시 반환값.

    @eel.expose 함수 145개 중 32개는 dict 가 아니라 list/str/bool 을 반환한다.
    거부 응답으로 무조건 dict 를 돌려주면 JS 에서 `.map()` / `.trim()` 등이
    터지므로, 반환 타입 주석을 보고 타입에 맞는 빈 값을 돌려준다.
    """
    ann = getattr(func, '__annotations__', {}).get('return')
    text = str(ann) if ann is not None else ''

    if ann is bool or text.endswith("'bool'>") or text == 'bool':
        return False
    if ann is str or text.endswith("'str'>") or text == 'str':
        return ''
    if ann is list or 'List' in text or text == 'list' or text.endswith("'list'>"):
        return []
    # dict / Dict[...] / 주석 없음 → 표준 실패 dict
    return {'success': False, 'message': message, 'auth_error': code}


# ============================================================================
# 데코레이터
# ============================================================================

def require(tier: str) -> Callable:
    """지정한 권한 등급을 서버 세션 기준으로 강제한다."""
    if tier not in TIERS:
        raise ValueError(f"알 수 없는 권한 등급: {tier}")

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            if tier == 'public':
                return func(*args, **kwargs)

            user = current_user()

            if user is None:
                logger.warning(f"권한 거부(세션 없음): {func.__name__} [{tier}]")
                return _empty_for(func, '로그인이 필요합니다.', 'NO_SESSION')

            if tier == 'guest':
                return func(*args, **kwargs)

            if user.get('is_guest'):
                logger.warning(f"권한 거부(게스트): {func.__name__} [{tier}]")
                return _empty_for(
                    func, '조회 전용 접속입니다. 이 기능은 로그인 후 사용할 수 있습니다.',
                    'GUEST_FORBIDDEN')

            if tier == 'login':
                return func(*args, **kwargs)

            # 관리자는 can_write 컬럼과 무관하게 항상 쓰기 허용.
            # auth_manager.validate_remember_token() 은 이 예외를 적용하는데
            # authenticate() 는 적용하지 않아, 두 경로의 can_write 가 달라질 수 있다.
            # 게이트 쪽에서 한 번 더 맞춰 준다.
            if tier == 'write' and not user.get('can_write') and user.get('role') != 'admin':
                logger.warning(f"권한 거부(쓰기 없음): {func.__name__} "
                               f"user={user.get('user_id')}")
                return _empty_for(func, '쓰기 권한이 없습니다.', 'NO_WRITE')

            if tier == 'admin' and user.get('role') != 'admin':
                logger.warning(f"권한 거부(관리자 아님): {func.__name__} "
                               f"user={user.get('user_id')}")
                return _empty_for(func, '관리자 권한이 필요합니다.', 'NOT_ADMIN')

            if tier == 'erp' and not user.get('erp_input'):
                logger.warning(f"권한 거부(ERP 없음): {func.__name__} "
                               f"user={user.get('user_id')}")
                return _empty_for(func, 'ERP 입력 권한이 없습니다.', 'NO_ERP')

            return func(*args, **kwargs)

        wrapper.__auth_tier__ = tier
        return wrapper

    return decorator
