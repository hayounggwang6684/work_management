@echo off
REM ===================================================================
REM 금일작업현황 관리 시스템 - 빌드 스크립트
REM Embedded Python 방식 (백신 오탐 방지)
REM ===================================================================

echo ================================
echo 빌드 시작 (Embedded Python 방식)
echo ================================

REM Embedded Python 빌드 실행
call build_embedded.bat

if errorlevel 1 (
    echo.
    echo [오류] 빌드 실패
    pause
    exit /b 1
)
