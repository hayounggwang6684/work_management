"""PDM API 권한 등급 데코레이터.

등급(본체 permissions.py 와 같은 이름): 'guest'(조회) / 'login' / 'write'(쓰기) / 'admin'(관리자).
실제 판정은 adapters.check_access(tier) 가 한다 — 단독 개발에서는 항상 허용, 본체에 붙이면 서버 세션으로 판정.
거부 시에는 예외 대신 PDM API 규약대로 {'success': False, 'message': …, 'authError': True} 를 돌려준다.

사용 (순서 주의 — @eel.expose 가 바깥):
    @eel.expose
    @guarded('write')
    def pdm_save_document(...): ...
"""
import functools
from typing import Any, Callable

from PDM.backend import adapters

TIERS = ('guest', 'login', 'write', 'admin')


def guarded(tier: str) -> Callable:
    if tier not in TIERS:
        raise ValueError(f'알 수 없는 권한 등급: {tier}')

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            denial = adapters.check_access(tier)
            if denial:
                return {'success': False, 'message': denial, 'authError': True}
            return func(*args, **kwargs)

        wrapper.__pdm_tier__ = tier
        return wrapper

    return decorator
