@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM ===================================================================
REM 금일작업현황 관리 - GitHub 릴리즈 업로드 스크립트
REM
REM 사용법:
REM   release.bat              <- settings.json의 버전으로 자동 릴리즈
REM   release.bat 1.2.4        <- 지정 버전으로 릴리즈
REM
REM 실행 전 준비:
REM   1. config\settings.json 의 "version" 을 새 버전으로 수정
REM   2. patch_build\patch_v{버전}\ 폴더에 patch.json + 변경 파일 배치
REM      예) patch_build\patch_v1.2.4\patch.json
REM          patch_build\patch_v1.2.4\src\web\api.py  (변경된 파일들)
REM   3. git commit -am "v버전: 변경사항"  으로 커밋
REM   4. 이 스크립트 실행
REM
REM patch.json 형식:
REM   { "id": "patch_v1.2.4", "version": "1.2.4", "min_version": "1.2.3",
REM     "description": "변경사항 설명",
REM     "files": [{"source": "src/web/api.py", "target": "src/web/api.py"}] }
REM ===================================================================

REM ── 버전 결정 ────────────────────────────────────────────────
if not "%~1"=="" (
    set VERSION=%~1
) else (
    REM settings.json 에서 버전 자동 추출
    for /f "tokens=2 delims=:, " %%a in ('findstr /i "\"version\"" config\settings.json') do (
        set RAW=%%a
        set VERSION=!RAW:"=!
        REM 첫 번째 version 값만 사용 (app.version)
        goto :got_version
    )
    :got_version
)

if "!VERSION!"=="" (
    echo [오류] 버전을 읽을 수 없습니다. settings.json을 확인하거나 직접 입력하세요.
    echo   사용법: release.bat 1.2.4
    pause & exit /b 1
)

set TAG=v!VERSION!

echo ================================================
echo  릴리즈: !TAG!
echo ================================================
echo.

REM ── GitHub 토큰 확인 ─────────────────────────────────────────
for /f "tokens=2 delims=:, " %%a in ('findstr /i "github_token" config\settings.json') do (
    set RAW=%%a
    set GH_TOKEN=!RAW:"=!
    goto :got_token
)
:got_token

if "!GH_TOKEN!"=="" (
    echo [오류] config\settings.json 에서 github_token 을 찾을 수 없습니다.
    pause & exit /b 1
)

REM ── Git 상태 확인 ─────────────────────────────────────────────
echo [1/5] Git 상태 확인...
git diff --quiet 2>nul
if errorlevel 1 (
    echo.
    echo [경고] 커밋되지 않은 변경사항이 있습니다:
    git status --short
    echo.
    set /p CONT="계속 진행하시겠습니까? (y/N): "
    if /i not "!CONT!"=="y" (
        echo 취소되었습니다.
        pause & exit /b 1
    )
)

REM ── 태그 중복 확인 ────────────────────────────────────────────
git tag | findstr /x "!TAG!" >nul 2>&1
if not errorlevel 1 (
    echo [오류] 태그 !TAG! 가 이미 존재합니다.
    echo   다른 버전을 사용하거나: git tag -d !TAG! 로 삭제 후 재시도
    pause & exit /b 1
)

REM ── 패치 ZIP 생성 ─────────────────────────────────────────────
echo [2/5] 패치 ZIP 생성 중...
set ZIP_NAME=patch_v!VERSION!.zip
set PATCH_BUILD_DIR=patch_build\patch_v!VERSION!

if exist "!ZIP_NAME!" del "!ZIP_NAME!"

REM patch_build\patch_vVERSION\ 폴더가 있으면 해당 폴더로 ZIP 생성
if exist "!PATCH_BUILD_DIR!\" (
    echo     patch_build\patch_v!VERSION!\ 폴더 발견 → 패치 ZIP 생성
    powershell -Command ^
        "Compress-Archive -Path '!PATCH_BUILD_DIR!' -DestinationPath '!ZIP_NAME!' -Force" 2>nul
) else (
    echo [경고] !PATCH_BUILD_DIR!\ 폴더가 없습니다.
    echo        patch_build\patch_v!VERSION!\patch.json 과 변경 파일을 준비하세요.
    echo.
    echo        폴더 없이 소스 ZIP으로 대체합니다 (패치 기능 동작 안 함).
    git archive --format=zip --output="!ZIP_NAME!" HEAD -- ^
        src/ web/ config/holidays.json ^
        build.bat build_embedded.bat 2>nul
)

if not exist "!ZIP_NAME!" (
    echo [오류] ZIP 생성 실패
    pause & exit /b 1
)
echo     생성: !ZIP_NAME!

REM ── 태그 생성 & 푸시 ──────────────────────────────────────────
echo [3/5] Git 태그 생성 및 푸시...
git tag -a "!TAG!" -m "Release !TAG!"
if errorlevel 1 (
    echo [오류] 태그 생성 실패
    pause & exit /b 1
)

git push origin "!TAG!"
if errorlevel 1 (
    echo [오류] 태그 푸시 실패. 네트워크 연결을 확인하세요.
    git tag -d "!TAG!" >nul 2>&1
    pause & exit /b 1
)
echo     태그 !TAG! 푸시 완료

REM ── 현재 브랜치 푸시 ──────────────────────────────────────────
echo [4/5] 현재 브랜치 푸시...
git push origin HEAD
if errorlevel 1 (
    echo [경고] 브랜치 푸시 실패 (계속 진행)
)

REM ── GitHub Release 생성 (GitHub API) ──────────────────────────
echo [5/5] GitHub Release 생성...

REM 릴리즈 노트 본문 구성
set REPO_OWNER=hayounggwang6684
set REPO_NAME=work_management

set BODY=## v!VERSION! 변경사항\n\n### 개선\n- 일일 작업 저장 버튼 응답 속도 개선 (클라우드 동기화 비동기 처리)\n- 보고서 일일\/월간 테이블 테두리 검정색으로 변경\n\n### 변경\n- 월간보고 헤더 '담당공무' → '작업자'\n- 월간보고 작업자 표기: 홍길동 외 N명 형식\n- 월간보고 캡쳐 시 착수일 빠른 순으로 정렬\n\n### 신규\n- 텔레그램 봇 설정 DB 동기화 (다른 PC에서 자동 적용)

REM JSON 페이로드를 PowerShell에서 직접 생성 (UTF-8 인코딩 보장)
REM ConvertTo-Json 사용으로 특수문자/한글 이스케이프 자동 처리
for /f "delims=" %%r in ('powershell -Command ^
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;" ^
    "$tag = '!TAG!';" ^
    "$body = \"## v!VERSION! 변경사항`n`n### 개선`n- 저장 버튼 응답 속도 개선 (클라우드 동기화 비동기 처리)`n- 보고서 일일/월간 테이블 테두리 검정색으로 변경`n`n### 변경`n- 월간보고 헤더 담당공무 to 작업자`n- 월간보고 작업자 표기: 홍길동 외 N명 형식`n- 월간보고 캡쳐 시 착수일 빠른 순으로 정렬`n`n### 신규`n- 텔레그램 봇 설정 DB 동기화 (다른 PC에서 자동 적용)\";" ^
    "$payload = @{ tag_name=$tag; name=$tag; body=$body; draft=$false; prerelease=$false } ^| ConvertTo-Json -Depth 5;" ^
    "$bytes = [System.Text.Encoding]::UTF8.GetBytes($payload);" ^
    "$h = @{ Authorization = \"token !GH_TOKEN!\"; \"Content-Type\" = \"application/json\" };" ^
    "$r = Invoke-RestMethod -Uri \"https://api.github.com/repos/!REPO_OWNER!/!REPO_NAME!/releases\" -Method POST -Headers $h -Body $bytes;" ^
    "Write-Output $r.id"') do set RELEASE_ID=%%r

if "!RELEASE_ID!"=="" (
    echo [오류] GitHub Release 생성 실패. 토큰 권한 또는 네트워크를 확인하세요.
    pause & exit /b 1
)
echo     릴리즈 ID: !RELEASE_ID! 생성 완료

REM ── ZIP 에셋 업로드 ───────────────────────────────────────────
echo     ZIP 에셋 업로드 중: !ZIP_NAME!
powershell -Command ^
    "$h = @{ Authorization = 'token !GH_TOKEN!'; 'Content-Type' = 'application/zip' };" ^
    "$bytes = [System.IO.File]::ReadAllBytes('!ZIP_NAME!');" ^
    "$uri = 'https://uploads.github.com/repos/!REPO_OWNER!/!REPO_NAME!/releases/!RELEASE_ID!/assets?name=!ZIP_NAME!';" ^
    "Invoke-RestMethod -Uri $uri -Method POST -Headers $h -Body $bytes | Out-Null;" ^
    "Write-Host '    업로드 완료'"

del "!ZIP_NAME!" >nul 2>&1

echo.
echo ================================================
echo  릴리즈 완료!
echo  https://github.com/!REPO_OWNER!/!REPO_NAME!/releases/tag/!TAG!
echo ================================================
echo.
pause
