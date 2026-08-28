# 금일작업현황 관리 — AGENTS.md

이 프로젝트의 규칙·아키텍처 가이드는 **[CLAUDE.md](CLAUDE.md) 한 곳에서만** 관리합니다.

Codex를 포함한 모든 에이전트는 `CLAUDE.md`를 읽고 그 규칙을 따르세요.

> 이전에는 이 파일이 CLAUDE.md와 내용을 중복 보관했습니다. 두 파일이 함께 컨텍스트에
> 로드되면서 매 턴 약 10K 토큰이 이중 전송됐고, 한쪽만 갱신되어 규칙이 어긋나는
> 문제도 있었습니다. AGENTS.md에만 있던 내용(board_projects·holiday_work_entries·
> employee_* 스키마, 절대 규칙 7~9번)은 모두 CLAUDE.md로 병합했습니다.
>
> **규칙을 추가·수정할 때는 CLAUDE.md만 고치세요. 이 파일에는 내용을 다시 넣지 마세요.**
