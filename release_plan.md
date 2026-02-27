# 패치 배포 가이드

v1.2.4 ~ v1.2.6 배포 경험 기반으로 작성. 배포 전 반드시 처음부터 끝까지 읽을 것.

---

## 핵심 주의사항 (먼저 읽기)

> **`config/settings.json` 은 절대로 git에 추가하지 말 것.**
> 이 파일에는 `update.github_token` (GitHub PAT)이 포함되어 있어
> push 시 GitHub Push Protection에 의해 **즉시 차단**된다.
> 이미 .gitignore에 등록되어 있으므로 절대 `git add -f config/settings.json` 하지 말 것.

> **`patch_build/vX.X.X/config/settings.json` 도 ZIP에 넣지 말 것.**
> 패치 ZIP에 포함하면 마찬가지로 push 차단됨.

> **ZIP 내부 구조: 반드시 최상위 폴더(`patch_vX.X.X/`)로 감싸야 한다.**
> 파일을 ZIP 루트에 바로 넣으면 `patches/` 에 풀릴 때 `patch_system`이 인식 못하고
> "적용할 패치가 없다" 메시지와 함께 중단된다.

> **`patch.json`의 `files` 형식: 문자열이 아닌 딕셔너리 배열.**
> `patch_system.apply_patch()`는 `file_info['source']`, `file_info['target']`을 읽는다.
> 단순 문자열 배열(`["src/a.py"]`)로 쓰면 `TypeError`로 적용 실패한다.

---

## 배포 순서

### 1단계: 코드 수정

- 수정할 파일들을 편집한다.
- 새로운 Python 패키지가 필요한 경우 `requirements.txt`에 추가하고 `pip install <패키지>` 실행.

---

### 2단계: 버전 번호 결정

버전 형식: `MAJOR.MINOR.PATCH` (예: `1.2.6`)

- 버그 수정 → PATCH 증가
- 새 기능 추가 → MINOR 증가

---

### 3단계: `config/settings.json` 버전 로컬 업데이트

```json
"app": {
  "version": "1.2.6"
},
"update": {
  "current_version": "1.0.0"   ← 이건 건드리지 말 것 (update_manager가 자체 관리)
}
```

**이 파일은 git에 추가하지 않는다. 로컬에서만 수정.**

---

### 4단계: patch_build 디렉터리 생성

```
patch_build/
  patch_v1.2.6/
    patch.json
    src/
      web/
        api.py          ← 수정된 파일만
      utils/
        update_manager.py
    web/
      js/
        splash.js
        auth.js
        app.js
```

#### patch.json 형식 (files는 반드시 source/target 딕셔너리):

```json
{
  "version": "1.2.6",
  "description": "변경사항 한 줄 설명",
  "files": [
    {"source": "src/web/api.py",                "target": "src/web/api.py"},
    {"source": "src/utils/update_manager.py",   "target": "src/utils/update_manager.py"},
    {"source": "web/js/splash.js",              "target": "web/js/splash.js"},
    {"source": "web/js/auth.js",                "target": "web/js/auth.js"},
    {"source": "web/js/app.js",                 "target": "web/js/app.js"}
  ]
}
```

**`files` 목록에 `config/settings.json` 절대 포함하지 말 것.**

#### patch_build 안에 파일 복사:

```bash
# patch_build/patch_v1.2.6/ 폴더 구조에 맞게 파일 복사
# 수정된 파일만 포함 (프로젝트 루트 기준 상대경로 유지)
```

---

### 5단계: ZIP 파일 생성

```bash
cd patch_build
# Windows PowerShell:
Compress-Archive -Path patch_v1.2.6 -DestinationPath patch_v1.2.6.zip -Force
```

또는 Python으로 (권장 — 최상위 폴더 포함):

```python
import zipfile
from pathlib import Path

patch_dir = Path("patch_build/patch_v1.2.6")
zip_path  = Path("patch_build/patch_v1.2.6.zip")

with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
    for file in patch_dir.rglob('*'):
        if file.is_file():
            # arcname: "patch_v1.2.6/patch.json", "patch_v1.2.6/src/main.py" ...
            # (patch_dir.parent 기준 상대경로 → ZIP 안에 폴더 이름 유지)
            arcname = str(file.relative_to(patch_dir.parent)).replace('\\', '/')
            zf.write(file, arcname)

print("ZIP 생성 완료")
```

> **주의**: `os.path.relpath(full, patch_dir)` 로 만들면 최상위 폴더가 빠진다.
> 반드시 `patch_dir.parent` 기준으로 arcname을 구해야 `patch_v1.2.6/...` 구조가 됨.

ZIP 내부 구조 확인 (settings.json 포함 여부 체크):

```bash
python -c "import zipfile; [print(n) for n in zipfile.ZipFile('patch_build/patch_v1.2.6.zip').namelist()]"
```

---

### 6단계: git commit + tag + push

```bash
# 수정된 소스 파일만 명시적으로 추가 (git add . 사용 금지)
git add src/web/api.py
git add src/utils/update_manager.py
git add web/js/splash.js
git add web/js/auth.js
git add web/js/app.js
git add patch_build/patch_v1.2.6/patch.json
git add patch_build/patch_v1.2.6/src/
git add patch_build/patch_v1.2.6/web/
git add patch_build/patch_v1.2.6.zip

# 스테이징 확인 (config/settings.json 없는지 반드시 확인)
git status
git diff --cached --name-only

# 커밋
git commit -m "v1.2.6: 변경사항 한 줄 설명"

# 태그
git tag v1.2.6

# push (tag 포함)
git push origin main
git push origin v1.2.6
```

**push 전에 반드시 `git diff --cached --name-only`로 config/settings.json 없는지 확인.**

---

### 7단계: GitHub Release 생성 + ZIP 업로드

`gh` CLI가 없으므로 Python urllib 사용.
`config/settings.json`에서 `update.github_token` 값을 직접 사용.

```python
import json, urllib.request

# 설정 로드
with open("config/settings.json", encoding="utf-8") as f:
    cfg = json.load(f)

TOKEN   = cfg["update"]["github_token"]
VERSION = "v1.2.6"
REPO    = "사용자명/저장소명"    # ← 실제 값으로 교체
ZIP_PATH = "patch_build/patch_v1.2.6.zip"

HEADERS = {
    "Authorization": f"token {TOKEN}",
    "Accept": "application/vnd.github.v3+json",
    "Content-Type": "application/json",
    "User-Agent": "PatchUploader/1.0"
}

# 1) Release 생성
body = json.dumps({
    "tag_name": VERSION,
    "name": f"Release {VERSION}",
    "body": "변경사항 설명",
    "draft": False,
    "prerelease": False
}).encode()

req = urllib.request.Request(
    f"https://api.github.com/repos/{REPO}/releases",
    data=body, headers=HEADERS, method="POST"
)
with urllib.request.urlopen(req) as r:
    release = json.loads(r.read())
    upload_url = release["upload_url"].split("{")[0]
    print("Release 생성:", release["html_url"])

# 2) ZIP 업로드
with open(ZIP_PATH, "rb") as f:
    zip_data = f.read()

upload_headers = dict(HEADERS)
upload_headers["Content-Type"] = "application/zip"
upload_headers["Content-Length"] = str(len(zip_data))

zip_name = ZIP_PATH.split("/")[-1]
req2 = urllib.request.Request(
    f"{upload_url}?name={zip_name}",
    data=zip_data, headers=upload_headers, method="POST"
)
with urllib.request.urlopen(req2) as r:
    asset = json.loads(r.read())
    print("ZIP 업로드 완료:", asset["browser_download_url"])
```

---

### 8단계: 배포 확인

1. GitHub 저장소 → Releases 탭에서 `v1.2.6` Release + `patch_v1.2.6.zip` 확인
2. 앱 실행 후 스플래시 화면에서 업데이트 확인 메시지 확인
3. 업데이트 적용 후 로그에서 패치 적용 로그 확인

---

## 트러블슈팅

### push 차단됨 (secret detected)

GitHub Push Protection이 PAT를 감지한 경우:

```bash
# 어떤 파일이 포함됐는지 확인
git diff HEAD~1 --name-only

# 해당 파일을 git에서 제거 (파일 자체는 삭제 안 됨)
git rm --cached config/settings.json
git rm --cached patch_build/patch_v1.2.6/config/settings.json  # 있다면

# 이전 커밋에 덮어쓰기 (push 전이라면)
git commit --amend --no-edit

# 태그가 이미 있으면 삭제 후 재생성
git tag -d v1.2.6
git tag v1.2.6

git push origin main
git push origin v1.2.6
```

### 태그 이미 존재

```bash
git tag -d v1.2.6                  # 로컬 삭제
git push origin :refs/tags/v1.2.6  # 원격 삭제 (올라간 경우)
git tag v1.2.6
git push origin v1.2.6
```

### urllib SSL 오류

```python
import ssl
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
# urllib.request.urlopen(req, context=ctx)
```

---

## 체크리스트

배포 전:
- [ ] `config/settings.json` `app.version` 로컬 업데이트
- [ ] 새 패키지 필요 시 `pip install` + `requirements.txt` 추가
- [ ] `patch_build/patch_vX.X.X/` 디렉터리 생성 + 파일 복사
- [ ] `patch.json`의 `files` 목록에 `config/settings.json` 없음
- [ ] ZIP 내부에 `config/settings.json` 없음 (`python -c "..."` 으로 확인)
- [ ] `git status`에 `config/settings.json` 없음

배포:
- [ ] `git add` (명시적 파일만)
- [ ] `git diff --cached --name-only` 확인
- [ ] `git commit`
- [ ] `git tag vX.X.X`
- [ ] `git push origin main && git push origin vX.X.X`
- [ ] Python urllib로 GitHub Release 생성 + ZIP 업로드
- [ ] GitHub Releases 탭에서 확인
