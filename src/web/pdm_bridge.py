"""
PDM(서비스레포트/계측지) ↔ 본체 연동 글루.

PDM 은 본체를 import 하지 않는다. 대신 PDM.backend.adapters 의 훅에 본체의 것을 주입한다:
    - 현재 사용자 / 권한 판정 → 서버 세션(permissions.py). JS 가 넘기는 값은 신뢰하지 않는다
    - 작업현황 DB / pdm.db 경로 → 본체 설정(config.db_path). pdm.db 는 본체 DB 와 같은 폴더
"""
from typing import Optional

from PDM.backend import adapters
from ..utils.config import config
from . import permissions


def _check_access(tier: str) -> Optional[str]:
    denial = permissions.access_denial(tier)
    return denial[1] if denial else None


def install() -> None:
    """PDM 어댑터에 본체 훅을 연결한다 (여러 번 호출해도 안전)."""
    adapters.configure(
        current_user=permissions.current_user,
        check_access=_check_access,
        work_db_path=lambda: config.db_path,
        pdm_db_path=lambda: config.db_path.parent / 'pdm.db',
    )
