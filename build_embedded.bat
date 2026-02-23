@echo off
chcp 65001 >nul
REM ===================================================================
REM 금일작업현황 관리 시스템 - Embedded Python 빌드 스크립트
REM PyInstaller 대신 Embedded Python + 소스코드로 배포 (백신 오탐 방지)
REM ===================================================================

setlocal enabledelayedexpansion

set PYTHON_VERSION=3.11.9
set PYTHON_SHORT=311
set BUILD_DIR=build_embedded
set PYTHON_ZIP=python-%PYTHON_VERSION%-embed-amd64.zip
set PYTHON_URL=https://www.python.org/ftp/python/%PYTHON_VERSION%/%PYTHON_ZIP%
set GET_PIP_URL=https://bootstrap.pypa.io/get-pip.py

echo ================================
echo Embedded Python 빌드 시작
echo ================================

REM ---------------------------------------------------------------
REM 1. 기존 빌드 폴더 정리
REM ---------------------------------------------------------------
echo.
echo [1/7] 빌드 폴더 초기화...
if exist "%BUILD_DIR%" (
    rmdir /s /q "%BUILD_DIR%"
)
mkdir "%BUILD_DIR%"
mkdir "%BUILD_DIR%\python"
mkdir "%BUILD_DIR%\app"

REM ---------------------------------------------------------------
REM 2. Python Embedded 다운로드 (없으면)
REM ---------------------------------------------------------------
echo.
echo [2/7] Python %PYTHON_VERSION% Embedded 다운로드...
if not exist "%PYTHON_ZIP%" (
    echo     다운로드 중: %PYTHON_URL%
    powershell -Command "Invoke-WebRequest -Uri '%PYTHON_URL%' -OutFile '%PYTHON_ZIP%'"
    if errorlevel 1 (
        echo [오류] Python Embedded 다운로드 실패
        pause
        exit /b 1
    )
) else (
    echo     이미 다운로드됨: %PYTHON_ZIP%
)

REM ---------------------------------------------------------------
REM 3. 압축 해제
REM ---------------------------------------------------------------
echo.
echo [3/7] Python Embedded 압축 해제...
powershell -Command "Expand-Archive -Path '%PYTHON_ZIP%' -DestinationPath '%BUILD_DIR%\python' -Force"
if errorlevel 1 (
    echo [오류] 압축 해제 실패
    pause
    exit /b 1
)

REM ---------------------------------------------------------------
REM 4. python311._pth 수정 (import site 활성화 - pip 사용을 위해 필수)
REM ---------------------------------------------------------------
echo.
echo [4/7] Python 경로 설정 (._pth 수정)...
set PTH_FILE=%BUILD_DIR%\python\python%PYTHON_SHORT%._pth

REM ._pth 파일을 새로 작성 (import site 주석 해제 + Lib\site-packages 추가)
(
    echo python%PYTHON_SHORT%.zip
    echo .
    echo ..\app
    echo import site
) > "%PTH_FILE%"

echo     %PTH_FILE% 수정 완료

REM ---------------------------------------------------------------
REM 5. pip 설치
REM ---------------------------------------------------------------
echo.
echo [5/7] pip 설치...
if not exist "get-pip.py" (
    echo     get-pip.py 다운로드 중...
    powershell -Command "Invoke-WebRequest -Uri '%GET_PIP_URL%' -OutFile 'get-pip.py'"
)

"%BUILD_DIR%\python\python.exe" get-pip.py --no-warn-script-location
if errorlevel 1 (
    echo [오류] pip 설치 실패
    pause
    exit /b 1
)

REM ---------------------------------------------------------------
REM 6. 의존성 설치 (빌드/개발 패키지 제외)
REM ---------------------------------------------------------------
echo.
echo [6/7] 패키지 설치 중...

REM requirements.txt에서 빌드/개발 패키지 제외하고 설치
"%BUILD_DIR%\python\python.exe" -m pip install --no-warn-script-location ^
    Eel>=0.16.0 ^
    python-dateutil>=2.8.2 ^
    openpyxl>=3.1.2 ^
    pandas>=2.0.0 ^
    google-api-python-client>=2.100.0 ^
    google-auth-httplib2>=0.1.1 ^
    google-auth-oauthlib>=1.1.0 ^
    dropbox>=11.36.2 ^
    python-dotenv>=1.0.0 ^
    requests>=2.31.0 ^
    packaging>=23.0

if errorlevel 1 (
    echo [오류] 패키지 설치 실패
    pause
    exit /b 1
)

REM ---------------------------------------------------------------
REM 7. 앱 소스코드 복사
REM ---------------------------------------------------------------
echo.
echo [7/7] 소스코드 복사...

REM src 폴더 복사
xcopy /E /I /Y "src" "%BUILD_DIR%\app\src" >nul
echo     src\ 복사 완료

REM web 폴더 복사
xcopy /E /I /Y "web" "%BUILD_DIR%\app\web" >nul
echo     web\ 복사 완료

REM config 폴더 복사 (settings.json 제외 - 개인 토큰/경로 포함되어 배포 금지)
mkdir "%BUILD_DIR%\app\config" 2>nul
for %%F in (config\*) do (
    if /I not "%%~nxF"=="settings.json" (
        copy /Y "%%F" "%BUILD_DIR%\app\config\" >nul
    )
)
if exist "config\holidays.json" copy /Y "config\holidays.json" "%BUILD_DIR%\app\config\" >nul
echo     config\ 복사 완료 (settings.json 제외)

REM resources 폴더 복사 (아이콘 등)
if exist "resources" (
    xcopy /E /I /Y "resources" "%BUILD_DIR%\app\resources" >nul
    echo     resources\ 복사 완료
)

REM assets 폴더 복사 (로고 등)
if exist "assets" (
    xcopy /E /I /Y "assets" "%BUILD_DIR%\app\assets" >nul
    echo     assets\ 복사 완료
)

REM 실행 스크립트 생성 (창 없는 백그라운드 실행)
(
    echo @echo off
    echo cd /d "%%~dp0"
    echo python\pythonw.exe app\src\main.py
) > "%BUILD_DIR%\run.bat"
echo     run.bat 생성 완료

REM 콘솔 디버그용 실행 스크립트 (에러 확인용)
(
    echo @echo off
    echo chcp 65001 ^>nul
    echo cd /d "%%~dp0"
    echo echo ================================================
    echo echo  금일작업현황 관리 - 디버그 모드
    echo echo  오류 발생 시 이 창의 내용을 캡처해주세요
    echo echo ================================================
    echo echo.
    echo python\python.exe app\src\main.py
    echo echo.
    echo echo 프로그램이 종료되었습니다. 오류가 있으면 위 내용을 확인하세요.
    echo pause
) > "%BUILD_DIR%\run_debug.bat"
echo     run_debug.bat 생성 완료

echo.
echo ================================
echo 빌드 완료!
echo ================================
echo.
echo 결과 폴더: %BUILD_DIR%\
echo.
echo 테스트: %BUILD_DIR%\run.bat 실행
echo 디버그: %BUILD_DIR%\run_debug.bat 실행
echo.
echo 다음 단계:
echo 1. %BUILD_DIR%\run.bat 으로 정상 실행 확인
echo 2. InnoSetup으로 build_installer.iss 컴파일
echo 3. 설치 프로그램 생성: dist\installer\WorkManagement_Setup_vX.X.X.exe
echo.

pause
