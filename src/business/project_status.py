"""공사(계약번호) 진행 상태 판정 — 대시보드 프로젝트 보드와 승선신고서 만료 알림이 같은 규칙을 쓴다."""

AUTO_CLOSE_DAYS = 7          # 마지막 작업일이 이보다 오래되면 (수동/보드 상태가 없을 때) 자동으로 준공으로 본다

_STARTED = ('inProgress', '착수')
_COMPLETED = ('completed', '준공')


def resolve_status(manual_status: str, board_status: str, end_date: str, cutoff: str) -> str:
    """우선순위: 수동 상태(project_status) > 보드 상태(board_projects) > 자동(마지막 작업일이 cutoff 이후면 착수, 아니면 준공).

    manual_status 가 'auto' 거나 비어 있으면 수동 상태 없음. 반환: '착수' | '준공' | 그 외 수동 값 그대로.
    """
    if manual_status and manual_status != 'auto':
        if manual_status in _STARTED:
            return '착수'
        if manual_status in _COMPLETED:
            return '준공'
        return manual_status
    if board_status:
        return board_status
    return '착수' if end_date >= cutoff else '준공'
