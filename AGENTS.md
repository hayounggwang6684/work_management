# 금일작업현황 관리 — AGENTS.md

Codex가 이 프로젝트에서 작업할 때 반드시 따라야 할 전체 규칙과 아키텍처 가이드입니다.

---

## 프로젝트 개요

**선박 정비 일일작업 현황 관리 데스크톱 앱**

- 기술 스택: Python + Eel + Tailwind CSS (CDN) + SQLite
- 실행 방식: `python src/main.py` → Eel이 Chrome/Edge 앱 모드로 열림
- DB 경로: `C:\Users\admin\Desktop\db\work_management.db`
- 설정 파일: `config/settings.json` (GitHub token 포함 → **절대 git add 금지**)
- 현재 버전: `config/settings.json`의 `update.current_version` 필드

---

## 디렉터리 구조

```
project-root/
├── src/
│   ├── main.py                  # 진입점: Eel 시작, 패치 적용, 클라우드 동기화
│   ├── web/
│   │   └── api.py               # 모든 @eel.expose 함수 (JS ↔ Python 브릿지)
│   ├── database/
│   │   ├── db_manager.py        # SQLite 연결 관리, CRUD
│   │   ├── auth_manager.py      # 인증 (PBKDF2-HMAC-SHA256)
│   │   └── models.py            # WorkRecord 데이터클래스
│   ├── business/
│   │   ├── work_record_service.py # 작업 레코드 비즈니스 로직
│   │   └── calculations.py      # 인원 계산 로직
│   ├── sync/
│   │   └── cloud_sync.py        # Google Drive / Dropbox 동기화
│   └── utils/
│       ├── config.py            # settings.json 로더
│       ├── update_manager.py    # GitHub 릴리스 패치 자동 다운로드
│       ├── patch_system.py      # ZIP 패치 적용
│       ├── telegram_notifier.py # 텔레그램 봇 알림
│       └── daily_scheduler.py   # 자동 백업 / 일일 요약 스케줄러
├── web/
│   ├── index.html               # SPA — 모든 뷰 포함
│   └── js/
│       ├── app.js               # 메인 앱 로직 (뷰 전환, 레코드, 조회)
│       ├── auth.js              # 로그인, 세션 관리
│       ├── report.js            # 보고서 생성 및 출력
│       ├── splash.js            # 스플래시 화면 애니메이션
│       └── update.js            # 업데이트 알림 UI
├── config/
│   ├── settings.json            # ⚠️ GitHub token 포함 — .gitignore 대상
│   └── settings.example.json   # 배포용 예시 설정
├── build_patch.py               # 패치 ZIP 빌드 스크립트
├── build_installer.iss          # Inno Setup 설치파일 스크립트
└── build_embedded/              # 임베디드 Python 배포 디렉터리
    └── python/                  # Python 3.11 embed + 패키지
```

---

## 핵심 아키텍처 패턴

### 1. Python ↔ JavaScript 통신 (Eel)

```python
# Python (api.py)
@eel.expose
def save_work_records(date, records, username):
    result = work_record_service.save_records_for_date(date, records, username)
    return {'success': True, 'message': '저장됨'}
```

```javascript
// JavaScript — 항상 이중 호출 패턴
const result = await eel.save_work_records(dateStr, workRecords, username)();
if (result.success) { ... }
```

**규칙**: 모든 @eel.expose 함수는 `dict` 반환 (`{'success': bool, 'message': str}`). `bool` 직접 반환 금지.

### 2. DB 연결 — contextmanager 패턴

```python
# db_manager.py
with self.get_connection() as conn:
    cursor = conn.cursor()
    cursor.execute(...)
# with 블록 종료 = 자동 commit
```

**규칙**: `add_activity_log()`는 반드시 `with` 블록 **밖**에서 호출 (내부 호출 시 30초 데드락 발생).

### 3. snake_case ↔ camelCase 변환

- Python → JS: `work_record_service._to_camel_case()` 로 변환 (e.g. `contract_number` → `contractNumber`)
- JS → Python: `api.py`에서 `data.get('contractNumber', '')` 등으로 camelCase 수신

### 4. 레코드 패딩 (항상 10행)

날짜당 레코드는 항상 10개. 실제 데이터가 없는 행은 빈 WorkRecord로 채움.

### 5. 인원 계산 (`calculations.py`)

| 구분 | 계산 |
|------|------|
| 직영 팀장 | 1.0 |
| 협력업체 팀장 | 0.5 |
| 직영 작업자 | 1.0 |
| 반직영 작업자 | 0.5 |
| 계약 업체 | 1.0 고정 |
| 일일 용역 | 인원 수 × 1.0 |

---

## DB 스키마 핵심 테이블

```sql
work_records (
    id, date, record_number, contract_number, company, ship_name,
    engine_model, work_content, location, leader, teammates,
    manpower, created_at, updated_at, created_by, updated_by
)
board_projects (
    id, contract_number, company, ship_name, engine_model,
    work_content, status, created_at, updated_at, ...
)
holiday_work_entries (
    id, period_key, seq, department, rank, name,
    fri_work, sat_work, sun_work, work_content,
    contract_number, company, owner_company, vendor_company, ship_name,
    created_at, updated_at, created_by
)
users (id, username, full_name, password_hash, role, ...)
app_settings (key, value)               -- 키-값 앱 설정
activity_log (user, action, date, note) -- 사용자 행동 로그
employee_directory (id, sort_order, department, name, rank, phone, address,
    external_account1, external_account2, health_check, created_at, updated_at)
```

계약번호 형식: `SH-YYYY-NNN-T` (예: `SH-2025-001-T`)

---

## 절대 규칙 (위반 금지)

1. **`config/settings.json` git add 금지** — GitHub token, Telegram bot token 포함
2. **패치 빌드는 반드시 `build_patch.py` 사용** — 직접 zipfile.write() 빌드 시 래퍼 폴더 누락으로 패치 미적용
3. **ZIP 내부 구조**: `patch_vX.X.X/patch.json` + `patch_vX.X.X/파일들` (최상위 폴더 1개 필수)
4. **@eel.expose 함수는 dict 반환** — bool 직접 반환 시 JS에서 `.get()` 호출 오류
5. **DB 연결은 contextmanager 사용** — 직접 conn 관리 금지
6. **add_activity_log는 with 블록 밖에서 호출** — 데드락 방지
7. **설치파일에 `config/settings.json` 포함 금지** — Inno Setup은 반드시 `settings.example.json`만 배포용 기본값으로 복사하고, 운영 토큰이 들어 있는 실제 settings.json은 제외
8. **`settings.example.json` 버전 동기화 필수** — 설치본이 예전 버전으로 초기화되지 않게 `app.version` / `update.current_version`을 현재 릴리스와 같이 올릴 것
9. **코드 수정 시 문서 동시 업데이트 필수** — 아래 기준에 따라 해당 문서 업데이트:

   | 수정 유형 | 업데이트할 문서 |
   |-----------|----------------|
   | 버그 수정 | `MEMORY.md` (Bug Fixes Applied 섹션) + 새 버그 패턴이면 [[bug-fix]] 표 추가 |
   | 신기능 추가 | `MEMORY.md` + 아키텍처 변경 시 `AGENTS.md` + 관련 스킬 파일 |
   | 아키텍처 변경 | `AGENTS.md` (핵심 아키텍처 패턴 또는 DB 스키마 섹션) |
   | 절대 규칙 위반 패턴 발견 | `AGENTS.md` 절대 규칙 섹션에 추가 |

---

## 버전 관리 및 배포 흐름

```
코드 수정
  → settings.json current_version 업데이트
  → settings.example.json version / current_version 업데이트
  → build_installer.iss AppVersion / OutputBaseFilename 업데이트
  → git commit + push
  → python build_patch.py X.X.X 파일1 파일2 ...
  → gh release create vX.X.X patch_build/patch_vX.X.X/patch_vX.X.X.zip
  → ISCC.exe build_installer.iss
  → gh release upload vX.X.X installer.exe
```

자세한 절차는 [[patch-deploy]] 참조.

---

## 자주 쓰는 디버깅 명령

```bash
# DB 직접 쿼리 (모듈 import 없이)
python -c "from src.database.db_manager import db; print(db.execute_query('SELECT * FROM work_records LIMIT 3'))"

# 최신 계약번호 확인
python -c "from src.database.db_manager import db; print(db.execute_query(\"SELECT contract_number FROM work_records WHERE contract_number != '' ORDER BY date DESC LIMIT 1\"))"

# 패치 적용 상태 확인
cat data/applied_patches.json

# GitHub token (settings.json에서 읽기)
python -c "import json,codecs; d=json.load(codecs.open('config/settings.json','r','utf-8')); print(d['update']['github_token'])"
```

---

## 관련 문서

> 전체 문서 지도는 [[HOME]] 참조

### 📐 사양서 (앱을 처음 파악할 때)
- [[app-overview]] — 앱 목적, 기술 스택, 시작 흐름
- [[features]] — 전체 기능 명세 (6개 뷰)
- [[ui-structure]] — HTML 구조, 뷰 전환, UI 패턴
- [[database-schema]] — 14개 테이블 전체 스키마
- [[api-reference]] — 80개+ API 함수 목록
- [[business-logic]] — 인원 계산, 계약번호 로직
- [[auth-roles]] — 인증 체계, 사용자 역할
- [[configuration]] — settings.json 전체 구조

### 🔄 작업 흐름
- [[bug-fix]] — 버그 수정 전체 흐름
- [[new-feature]] — 신기능 개발 흐름
- [[patch-release]] — 패치 릴리스 흐름

### 🛠️ 스킬
- [[patch-deploy]] — 패치 빌드 & GitHub 배포
- [[db-debug]] — DB 직접 쿼리 & 디버깅
- [[add-api-function]] — 새 API 함수 추가 패턴
- [[version-release]] — 전체 버전 릴리스 절차

### 🤖 에이전트
- [[backend-dev]] — Python 백엔드 개발자
- [[frontend-dev]] — JS/HTML 프론트엔드 개발자
- [[release-manager]] — 릴리스 매니저

### ⚙️ 설정
- [[mcp/README\|MCP 도구]] — GitHub CLI, Inno Setup, SQLite
- [[hooks/README\|훅 설정]] — Pre-commit 검증, 버전 불일치 감지
