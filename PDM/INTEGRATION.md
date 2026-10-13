# PDM ↔ 본체 통합 가이드

PDM(Product Data Management)은 **공사현황 → 서비스레포트 / 계측지** 작성·보관·출력 기능이다.
`PDM/` 폴더에서 본체와 독립적으로 개발했고, 이 브랜치(`feature/pdm`)에서 본체에 연결했다.

## 1. 구조

```
PDM/
├── backend/        파이썬: DB(pdm.db), 사진 처리, 양식 정의/검증, Eel API(pdm_*)
│   ├── adapters.py   ★ 본체 접점 (훅 4개 — 아래 3장)
│   ├── guard.py      API 권한 등급 데코레이터 (@guarded)
│   └── templates/    내장 계측 양식 정의(JSON)
├── web/            화면 스크립트(.js). pdm_loader.js 가 나머지를 순서대로 불러온다
├── tests/          pytest(backend) + node:test(web 순수 로직)
└── pdm_main.py     단독 실행 (개발용)
web/pdm/            ← PDM/web 의 복사본 (본체 Eel 은 web/ 의 .js/.html 만 서빙) — 직접 고치지 말 것
web/js/projects_tab.js   공사현황 탭 연결 (PDM 지연 로딩)
src/web/pdm_bridge.py    본체 훅 주입 (세션 권한, DB 경로)
scripts/sync_pdm_web.py  PDM/web → web/pdm 복사 / 일치 검사
```

## 2. 본체에서 바뀐 곳 (전부 추가 방식)

| 파일 | 변경 |
|---|---|
| `web/index.html` | 메뉴 버튼 `공사현황`, `#projectsView` 컨테이너, 스크립트 2줄, 메뉴 컨테이너에 `[&_button]:whitespace-nowrap`(탭이 늘어 버튼 글자가 줄바꿈되는 것 방지) + `gap-4→gap-3` |
| `web/js/app.js` | `showView('projects')` 분기, `Ctrl+6` 단축키 |
| `web/js/projects_tab.js` | 신규 — 탭을 처음 열 때 PDM 로드 후 마운트 |
| `src/web/api.py` | 파일 끝에 PDM 연결(`pdm_bridge.install()` + `import PDM.backend.api`). 실패해도 본체 기동을 막지 않고 `PDM_STATUS='error'` |
| `src/web/permissions.py` | 판정 로직을 `access_denial(tier)` 로 분리 (`require` 동작 동일, PDM 이 같은 판정을 재사용) |
| `src/web/pdm_bridge.py` | 신규 — 훅 주입 |

## 3. 접점 (`PDM/backend/adapters.py` 훅)

| 훅 | 본체 연결 | 비고 |
|---|---|---|
| `current_user` | `permissions.current_user` | 작성자는 항상 서버 세션 기준 (JS 인자 신뢰 안 함) |
| `check_access(tier)` | `permissions.access_denial` | 거부 시 PDM 규약대로 `{'success': False, 'message', 'authError': True}` |
| `work_db_path` | `config.db_path` | 작업현황은 **읽기 전용(mode=ro)** 으로만 연다 |
| `pdm_db_path` | `config.db_path.parent / 'pdm.db'` | 본체 DB 와 같은 폴더 |

### 권한 등급 (모든 `pdm_*` API 에 `@guarded` — `test_guard.py` 가 누락을 검사)
| 등급 | API |
|---|---|
| `guest` (조회) | 공사현황 목록, 문서/사진 조회, 출력 양식 조회, 양식 정의 조회, 계측 표준값 조회/적용 |
| `write` | 문서 생성/저장, 판매용 주문 등록/수정/삭제, 사진 입력·수정·제거·캡션 |
| `admin` | 출력 양식 설정 저장, 계측 양식 추가/수정/삭제/미리보기, 계측 표준값 추가/수정/삭제/가져오기 |

## 4. PDM 화면을 고친 뒤

```bash
python scripts/sync_pdm_web.py          # PDM/web → web/pdm 복사
python scripts/sync_pdm_web.py --check  # 어긋나면 종료 코드 1
```
`web/pdm` 도 함께 커밋한다. `tests/test_pdm_sync.py` 가 어긋남을 잡는다. 새 `.js` 를 `PDM/web` 에 추가하면
`pdm_loader.js` 의 `PDM_SCRIPT_ORDER` 에도 넣는다 (`PDM/tests/loader.test.js` 가 검사).

## 5. 테스트

```bash
python -m pytest PDM/tests -q                                   # backend
node --test PDM/tests/*.test.js                                 # web 순수 로직
venv/Scripts/python tests/test_permissions.py                   # 본체 권한 (145개 배선 + access_denial)
venv/Scripts/python tests/test_pdm_bridge.py                    # 본체 ↔ PDM 연결
venv/Scripts/python tests/test_pdm_sync.py                      # web/pdm 일치
```
단독 실행: `venv/Scripts/python PDM/pdm_main.py` (포트 8765, `--no-browser` 가능).
실제 앱 화면 검증은 **임시 DB + 테스트 세션**으로 했다 (운영 DB/설정/토큰 미사용).

## 6. 릴리스 전 체크리스트 (아직 하지 않음 — 허가 후 진행)

1. **패치/설치 패키지에 `PDM/` 포함**: `build_embedded.bat` 는 `src`, `web` 만 복사하므로 `PDM` 복사 추가 필요,
   `build_installer.iss` 에도 `Source: "build_embedded\app\PDM\*"` 추가 필요. 패치는 `build_patch.py` 에 아래 파일을 넘긴다:
   `PDM/**`(tests 제외), `web/pdm/*`, `web/js/projects_tab.js`, `web/js/app.js`, `web/index.html`,
   `src/web/api.py`, `src/web/permissions.py`, `src/web/pdm_bridge.py`.
2. **Pillow**: `requirements.txt` 에 있어 새 임베디드 빌드에는 포함된다. 이미 설치된 PC 는 `main.py` 의 시작 시 자동 설치에 의존 (인터넷 필요).
   설치 실패 시 PDM 만 비활성(`PDM_STATUS='error'`)되고 본체는 정상.
3. 버전 규칙(CLAUDE.md 절대 규칙 8·9): `settings.json`/`settings.example.json`/`build_installer.iss`/`patch.json` 버전 동기화.
4. `index.html` 의 `?v=` 캐시 파라미터는 릴리스 버전과 맞춘다.

## 7. 결정 사항 / 남은 확인

- **pdm.db 동기화·백업: 하지 않기로 결정 (2026-10-07).** `pdm.db`(문서·사진)는 클라우드 동기화(`cloud_sync.py`)와 자동 백업
  (`settings_manager.create_backup`) 대상이 아니다 — 두 기능은 `work_management.db` 한 파일만 다룬다. 각 PC 의 `pdm.db` 는 독립이며,
  여러 PC 가 같은 폴더(네트워크 경로)를 `database.local_path` 로 쓰는 경우에만 공유된다.
- **클리어런스 자동 계산 규칙**: `(안지름 기준 + C/100) − (외경 기준 − C/100)` 의 TB/PS 방향별 **큰 값**으로 가정 (`PDM/web/mm_logic.js`). 실제 규칙 확인 필요.
