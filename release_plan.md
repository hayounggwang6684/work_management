# 패치 배포 가이드

실제 배포 경험 기반으로 작성. **순서대로 따라가면 실수 없음.**

---

## 절대 규칙 (어기면 배포 실패)

| # | 규칙 | 위반 시 결과 |
|---|------|-------------|
| 1 | `config/settings.json` 절대 git add 금지 | GitHub PAT 감지 → push 즉시 차단 |
| 2 | `patch_build/patch_vX.X.X/config/settings.json` ZIP에 포함 금지 | 동일하게 push 차단 |
| 3 | ZIP 내부에 반드시 `patch_vX.X.X/` 최상위 폴더로 감싸야 함 | 패치 인식 불가 → "적용할 패치가 없다" |
| 4 | `patch.json`의 `files`는 `{"source":..., "target":...}` 딕셔너리 배열 | `TypeError` → 파일 복사 안 됨 |

---

## 배포 순서

### 1단계: 코드 수정

- 수정할 파일들을 편집한다.
- 새 Python 패키지가 필요하면 `requirements.txt`에 추가하고 `pip install <패키지>` 실행.
- **`src/main.py`의 `_OPTIONAL_PACKAGES`에도 추가** (현장 PC 자동 설치 대응).

---

### 2단계: 버전 번호 결정

버전 형식: `MAJOR.MINOR.PATCH` (예: `1.2.7`)

- 버그 수정 → PATCH 증가
- 새 기능 추가 → MINOR 증가

---

### 3단계: `config/settings.json` 버전 로컬 업데이트

```json
"app": {
  "version": "1.2.7"   ← 새 버전으로 변경
}
```

> **이 파일은 git에 절대 추가하지 않는다. 로컬에서만 수정.**

---

### 4단계: patch_build 디렉터리 생성

디렉터리 구조 (수정된 파일만 포함):

```
patch_build/
  patch_v1.2.7/
    patch.json          ← 반드시 포함
    src/
      main.py           ← 수정한 파일만
      web/
        api.py
      utils/
        update_manager.py
    web/
      js/
        app.js
        auth.js
        splash.js
```

파일 복사 (수정한 파일만, 프로젝트 루트에서 실행):

```bash
VERSION=1.2.7
PATCH_DIR="patch_build/patch_v${VERSION}"

mkdir -p "${PATCH_DIR}/src/web"
mkdir -p "${PATCH_DIR}/src/utils"
mkdir -p "${PATCH_DIR}/web/js"

# 수정한 파일만 골라서 복사 (예시)
cp src/main.py              "${PATCH_DIR}/src/"
cp src/web/api.py           "${PATCH_DIR}/src/web/"
cp web/js/app.js            "${PATCH_DIR}/web/js/"
```

---

### 4-1단계: patch.json 작성

> **규칙 4 적용**: `files`는 반드시 `{"source": ..., "target": ...}` 딕셔너리 배열.
> source = ZIP 내 경로, target = 앱 루트 기준 경로 (보통 동일).

`patch_build/patch_v1.2.7/patch.json`:

```json
{
  "version": "1.2.7",
  "description": "변경사항 한 줄 설명",
  "files": [
    {"source": "src/main.py",                 "target": "src/main.py"},
    {"source": "src/web/api.py",              "target": "src/web/api.py"},
    {"source": "src/utils/update_manager.py", "target": "src/utils/update_manager.py"},
    {"source": "web/js/app.js",               "target": "web/js/app.js"},
    {"source": "web/js/auth.js",              "target": "web/js/auth.js"},
    {"source": "web/js/splash.js",            "target": "web/js/splash.js"}
  ]
}
```

> **`config/settings.json` 목록에 절대 포함하지 말 것 (규칙 2).**

---

### 5단계: ZIP 파일 생성

> **규칙 3 적용**: `patch_dir.parent` 기준 arcname → ZIP 안에 `patch_v1.2.7/` 폴더 유지.

```python
# 프로젝트 루트에서 실행
import zipfile
from pathlib import Path

VERSION   = "1.2.7"
patch_dir = Path(f"patch_build/patch_v{VERSION}")
zip_path  = Path(f"patch_build/patch_v{VERSION}.zip")

with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
    for file in patch_dir.rglob('*'):
        if file.is_file():
            arcname = str(file.relative_to(patch_dir.parent)).replace('\\', '/')
            zf.write(file, arcname)

print("ZIP 생성 완료. 내부 구조:")
with zipfile.ZipFile(zip_path) as zf:
    for n in sorted(zf.namelist()):
        print(" ", n)
```

**확인해야 할 출력 (올바른 예):**

```
patch_v1.2.7/patch.json          ← 최상위 폴더 있어야 함
patch_v1.2.7/src/main.py
patch_v1.2.7/src/web/api.py
patch_v1.2.7/web/js/app.js
```

**잘못된 출력 (최상위 폴더 없음 → 규칙 3 위반):**

```
patch.json          ← 이렇게 나오면 ZIP 다시 만들어야 함
src/main.py
```

> `config/settings.json`이 목록에 보이면 즉시 중단하고 ZIP 재생성.

---

### 6단계: git commit + tag + push

```bash
VERSION=1.2.7

# 수정된 소스 파일만 명시적으로 추가 (git add . 금지)
git add src/main.py
git add src/web/api.py
git add src/utils/update_manager.py
git add web/js/app.js
git add web/js/auth.js
git add web/js/splash.js
git add patch_build/patch_v${VERSION}/
git add patch_build/patch_v${VERSION}.zip

# ★ 반드시 확인: config/settings.json이 없어야 함 (규칙 1)
git diff --cached --name-only
```

출력에 `config/settings.json`이 보이면 즉시 중단:
```bash
git restore --staged config/settings.json
```

문제 없으면 커밋:
```bash
git commit -m "v${VERSION}: 변경사항 한 줄 설명"
git tag v${VERSION}
git push origin main
git push origin v${VERSION}
```

---

### 7단계: GitHub Release 생성 + ZIP 업로드

`gh` CLI 없으므로 Python urllib 사용. 프로젝트 루트에서 실행.

```python
import json, urllib.request
from pathlib import Path

VERSION  = "1.2.7"
REPO     = "hayounggwang6684/work_management"
ZIP_PATH = Path(f"patch_build/patch_v{VERSION}.zip")

with open("config/settings.json", encoding="utf-8") as f:
    cfg = json.load(f)
TOKEN = cfg["update"]["github_token"]

HEADERS = {
    "Authorization": f"token {TOKEN}",
    "Accept": "application/vnd.github.v3+json",
    "Content-Type": "application/json",
    "User-Agent": "PatchUploader/1.0"
}

# 1) Release 생성
body = json.dumps({
    "tag_name": f"v{VERSION}",
    "name": f"v{VERSION}",
    "body": f"패치 v{VERSION}",
    "draft": False,
    "prerelease": False
}).encode()

req = urllib.request.Request(
    f"https://api.github.com/repos/{REPO}/releases",
    data=body, headers=HEADERS, method="POST"
)
with urllib.request.urlopen(req) as r:
    release = json.loads(r.read())
    release_id = release["id"]
    print("Release 생성:", release["html_url"])

# 2) ZIP 업로드
with open(ZIP_PATH, "rb") as f:
    zip_data = f.read()

upload_headers = dict(HEADERS)
upload_headers["Content-Type"] = "application/zip"
upload_headers["Content-Length"] = str(len(zip_data))

req2 = urllib.request.Request(
    f"https://uploads.github.com/repos/{REPO}/releases/{release_id}/assets?name={ZIP_PATH.name}",
    data=zip_data, headers=upload_headers, method="POST"
)
with urllib.request.urlopen(req2) as r:
    asset = json.loads(r.read())
    print("ZIP 업로드 완료:", asset["browser_download_url"])
```

---

### 8단계: 배포 확인

1. GitHub → Releases 탭에서 `v1.2.7` + `patch_v1.2.7.zip` 존재 확인
2. v1.2.6 앱 실행 → 스플래시에서 "새 업데이트 발견" 메시지 확인
3. 업데이트 적용 → 재시작 → 버전 v1.2.7로 표시되는지 확인

---

## 트러블슈팅

### push 차단됨 (secret detected)

```bash
# 어떤 파일이 문제인지 확인
git diff HEAD --name-only

# git 추적에서 제거 (파일 자체는 삭제 안 됨)
git rm --cached config/settings.json
git rm --cached patch_build/patch_v1.2.7/config/settings.json  # 있다면

# 태그 먼저 삭제 후 커밋 수정
git tag -d v1.2.7
git commit --amend --no-edit
git tag v1.2.7

git push origin main
git push origin v1.2.7
```

### 태그 이미 존재

```bash
git tag -d v1.2.7                   # 로컬 삭제
git push origin :refs/tags/v1.2.7   # 원격 삭제 (이미 push된 경우)
git tag v1.2.7
git push origin v1.2.7
```

### "적용할 패치가 없다" (현장 PC에서 패치 인식 못 함)

원인: ZIP 구조 오류 또는 `files` 형식 오류 → ZIP 재생성 후 GitHub Release 교체

기존 Release의 ZIP 교체:

```python
import json, urllib.request
from pathlib import Path

VERSION  = "1.2.7"
REPO     = "hayounggwang6684/work_management"
ZIP_PATH = Path(f"patch_build/patch_v{VERSION}.zip")

with open("config/settings.json", encoding="utf-8") as f:
    cfg = json.load(f)
TOKEN = cfg["update"]["github_token"]

HEADERS = {
    "Authorization": f"token {TOKEN}",
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "PatchUploader/1.0"
}

# 기존 Release 조회
req = urllib.request.Request(
    f"https://api.github.com/repos/{REPO}/releases/tags/v{VERSION}",
    headers=HEADERS
)
with urllib.request.urlopen(req) as r:
    release = json.loads(r.read())
    release_id = release["id"]
    assets = release.get("assets", [])

# 기존 ZIP asset 삭제
for asset in assets:
    if asset["name"].endswith(".zip"):
        del_req = urllib.request.Request(
            f"https://api.github.com/repos/{REPO}/releases/assets/{asset['id']}",
            headers=HEADERS, method="DELETE"
        )
        urllib.request.urlopen(del_req)
        print(f"삭제: {asset['name']}")

# 새 ZIP 업로드
with open(ZIP_PATH, "rb") as f:
    zip_data = f.read()

upload_headers = dict(HEADERS)
upload_headers["Content-Type"] = "application/zip"
upload_headers["Content-Length"] = str(len(zip_data))

req2 = urllib.request.Request(
    f"https://uploads.github.com/repos/{REPO}/releases/{release_id}/assets?name={ZIP_PATH.name}",
    data=zip_data, headers=upload_headers, method="POST"
)
with urllib.request.urlopen(req2) as r:
    asset = json.loads(r.read())
    print("재업로드 완료:", asset["browser_download_url"])
```

이미 실패한 현장 PC 복구:
```bash
python fix_patch_v1.2.6.py   # 버전에 맞는 스크립트 실행
# 그 다음 앱 재실행 → 자동 재다운로드·적용
```

### urllib SSL 오류

```python
import ssl
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
# urllib.request.urlopen(req, context=ctx) 로 교체
```

---

## 배포 체크리스트

배포 전 준비:
- [ ] `config/settings.json` `app.version` 로컬에서 새 버전으로 변경
- [ ] 새 패키지 필요 시 `pip install` + `requirements.txt` + `src/main.py` `_OPTIONAL_PACKAGES` 추가
- [ ] `patch_build/patch_vX.X.X/` 디렉터리 생성 + 수정 파일 복사
- [ ] `patch.json` 작성 — **`files` 형식이 `{"source":..., "target":...}` 딕셔너리인지 확인** (규칙 4)
- [ ] `patch.json`에 `config/settings.json` 없음 확인 (규칙 2)

ZIP 생성 후:
- [ ] ZIP 내부 첫 항목이 `patch_vX.X.X/patch.json` 인지 확인 (규칙 3)
- [ ] ZIP 내부에 `config/settings.json` 없음 확인 (규칙 1·2)

git 전:
- [ ] `git diff --cached --name-only` 출력에 `config/settings.json` 없음 (규칙 1)
- [ ] `git commit` + `git tag vX.X.X`
- [ ] `git push origin main` + `git push origin vX.X.X`

GitHub Release:
- [ ] Release 생성 + ZIP 업로드 완료
- [ ] GitHub Releases 탭에서 ZIP 다운로드 링크 확인
