"""PDM 테스트 공통 설정 — 개발 모드(권한 판정 훅 없이 허용)를 기본으로 켜고, 테스트마다 원상복구한다."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import pytest

from PDM.backend import adapters


@pytest.fixture(autouse=True)
def pdm_dev_mode():
    before = adapters._dev_mode
    adapters.enable_dev_mode()
    yield
    adapters._dev_mode = before
