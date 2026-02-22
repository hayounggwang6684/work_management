# 금일작업현황 관리 시스템

Python 데스크톱 애플리케이션 - SQLite + 클라우드 동기화

---

## 📋 목차

1. [개요](#개요)
2. [기술 스택](#기술-스택)
3. [프로젝트 구조](#프로젝트-구조)
4. [설치 및 실행](#설치-및-실행)
5. [빌드 및 배포](#빌드-및-배포)
6. [패치 시스템](#패치-시스템)
7. [클라우드 동기화](#클라우드-동기화)
8. [개발 가이드](#개발-가이드)

---

## 개요

### 주요 기능

- ✅ **일일 작업 현황 입력 및 관리**
- ✅ **자동 인원 계산** (본사/외주/도급/일당 자동 구분)
- ✅ **SQLite 데이터베이스** (동시 접근 지원)
- ✅ **클라우드 자동 동기화** (Google Drive, OneDrive, Dropbox)
- ✅ **Excel 내보내기**
- ✅ **활동 로그 기록**
- ✅ **패치 시스템** (업데이트 용이)

### 특징

- 🖥️ **데스크톱 앱**: Windows 설치 프로그램
- 🌐 **HTML UI**: 기존 웹 UI 재사용
- 📦 **모듈화 구조**: 유지보수 용이
- 🔄 **자동 동기화**: 출장 시에도 접근 가능
- 🛡️ **안티바이러스 친화적**: InnoSetup 사용

---

## 기술 스택

### Backend
- **Python 3.10+**
- **SQLite3** (내장)
- **Eel** (Python ↔ JavaScript 브리지)

### Frontend
- **HTML5 + CSS3 + JavaScript**
- **Tailwind CSS**

### 패키징
- **PyInstaller** (Python → exe)
- **InnoSetup** (설치 프로그램)

### 라이브러리
```
eel                    # GUI 프레임워크
openpyxl, pandas       # Excel 처리
python-dateutil        # 날짜 처리
google-api-python-client  # Google Drive API (선택)
```

---

## 프로젝트 구조

```
work-management-desktop/
├── src/                        # 소스 코드
│   ├── main.py                # 진입점
│   ├── database/              # 데이터베이스
│   │   ├── __init__.py
│   │   ├── models.py         # 데이터 모델
│   │   └── db_manager.py     # SQLite 관리
│   ├── business/              # 비즈니스 로직
│   │   ├── __init__.py
│   │   ├── calculations.py   # 인원 계산
│   │   └── work_record_service.py
│   ├── sync/                  # 클라우드 동기화
│   │   ├── __init__.py
│   │   └── cloud_sync.py
│   ├── utils/                 # 유틸리티
│   │   ├── __init__.py
│   │   ├── config.py         # 설정 관리
│   │   └── logger.py         # 로깅
│   └── web/                   # 웹 API
│       ├── __init__.py
│       └── api.py            # Python-JS API
├── web/                       # 웹 UI
│   ├── index.html
│   ├── css/
│   └── js/
├── config/                    # 설정 파일
│   └── settings.json
├── patches/                   # 패치 폴더
├── requirements.txt           # Python 의존성
├── build_installer.iss       # InnoSetup 스크립트
└── README.md                 # 이 파일
```

---

## 설치 및 실행

### 개발 환경 설정

```bash
# 1. Python 3.10+ 설치 확인
python --version

# 2. 가상환경 생성 (권장)
python -m venv venv

# 3. 가상환경 활성화
# Windows:
venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

# 4. 의존성 설치
pip install -r requirements.txt

# 5. 프로그램 실행
python src/main.py
```

### 사용자 설치

1. `WorkManagement_Setup_v1.1.0.exe` 다운로드
2. 설치 프로그램 실행
3. 설치 완료 후 바탕화면 아이콘 클릭

---

## 빌드 및 배포

### 1. PyInstaller로 exe 생성

```bash
# 단일 실행 파일로 빌드
pyinstaller --name work_management \
            --onedir \
            --windowed \
            --add-data "web;web" \
            --add-data "config;config" \
            --hidden-import=eel \
            --hidden-import=openpyxl \
            src/main.py

# 결과: dist/work_management/work_management.exe
```

### 2. InnoSetup으로 설치 프로그램 생성

```bash
# 1. InnoSetup 설치 (https://jrsoftware.org/isdl.php)

# 2. build_installer.iss 파일 열기

# 3. Compile 버튼 클릭

# 결과: dist/installer/WorkManagement_Setup_v1.1.0.exe
```

### 3. 배포

```
배포 파일:
- WorkManagement_Setup_v1.1.0.exe (설치 프로그램)
- README.pdf (사용자 매뉴얼)
```

---

## 패치 시스템

### 패치 적용 방법

#### 방법 1: 패치 파일 배포 (권장)

```
1. 수정된 파일만 패치 폴더에 준비
   patches/
   ├── v1.0.1/
   │   ├── src/
   │   │   └── business/
   │   │       └── calculations.py
   │   └── patch.json

2. patch.json 예시:
{
  "id": "patch-v1.1.0",
  "version": "1.1.0",
  "min_version": "1.0.0",
  "description": "자동 패치 시스템 개선",
  "files": [
    {
      "source": "src/utils/patch_system.py",
      "target": "src/utils/patch_system.py"
    }
  ]
}

3. 패치 파일을 사용자에게 배포

4. 사용자가 patches 폴더에 압축 해제

5. 프로그램 재시작 시 자동 적용
```

#### 방법 2: 전체 재설치

```
1. 새 버전 빌드
2. 새 설치 프로그램 배포
3. 사용자가 설치 (기존 데이터 유지)
```

### 자동 업데이트 (TODO)

```python
# src/web/api.py의 check_for_updates() 함수 구현
@eel.expose
def check_for_updates():
    # 서버에서 최신 버전 확인
    # 다운로드 URL 제공
    # 자동 설치
    pass
```

---

## 클라우드 동기화

### 지원 클라우드

- ✅ **Google Drive**
- ✅ **OneDrive**
- ✅ **Dropbox**

### 설정 방법

#### 자동 감지 (권장)

```
1. Google Drive/OneDrive/Dropbox 설치
2. 프로그램 실행
3. 자동으로 클라우드 폴더 감지
4. WorkManagement 폴더 자동 생성
5. 자동 동기화 시작
```

#### 수동 설정

```json
// config/settings.json
{
  "database": {
    "cloud_sync_enabled": true,
    "cloud_path": "C:/Users/YourName/Google Drive/WorkManagement"
  }
}
```

### 동기화 방식

```
시작 시: 클라우드 → 로컬 (최신 파일 사용)
저장 시: 로컬 → 클라우드 (자동 업로드)
종료 시: 로컬 → 클라우드 (최종 백업)
```

### 충돌 해결

```
- 최신 파일 우선 (newest_wins)
- 백업 자동 생성
- 로그에 기록
```

---

## 개발 가이드

### 새 기능 추가

#### 1. 백엔드 API 추가

```python
# src/web/api.py
@eel.expose
def my_new_function(param1, param2):
    # 로직 구현
    return result
```

#### 2. 프론트엔드에서 호출

```javascript
// web/js/app.js
async function callMyFunction() {
    const result = await eel.my_new_function(param1, param2)();
    console.log(result);
}
```

### 데이터베이스 스키마 변경

```python
# src/database/db_manager.py의 _init_database() 수정
cursor.execute('''
    ALTER TABLE work_records 
    ADD COLUMN new_field TEXT
''')
```

### 새 비즈니스 로직 추가

```python
# src/business/에 새 파일 생성
# src/business/my_service.py

class MyService:
    def my_method(self):
        pass

my_service = MyService()
```

---

## 테스트

### 단위 테스트

```bash
# pytest 설치
pip install pytest

# 테스트 실행
pytest tests/
```

### 수동 테스트 체크리스트

- [ ] 로그인
- [ ] 데이터 입력
- [ ] 저장
- [ ] 어제 작업 불러오기
- [ ] Excel 내보내기
- [ ] 클라우드 동기화
- [ ] 날짜 변경
- [ ] 인원 계산 (본사/외주/도급/일당)

---

## 문제 해결

### 백신 오탐지

**문제**: Windows Defender가 exe를 차단

**해결**:
1. InnoSetup 사용 (이미 적용됨)
2. 코드 서명 인증서 구매 및 적용
3. VirusTotal 업로드로 평판 구축

### 클라우드 동기화 실패

**문제**: 클라우드 폴더를 찾지 못함

**해결**:
```json
// config/settings.json에 수동 설정
{
  "database": {
    "cloud_path": "실제 클라우드 경로"
  }
}
```

### DB 파일 손상

**문제**: SQLite 파일이 손상됨

**해결**:
```
1. data/backups 폴더에서 백업 찾기
2. 또는 클라우드에서 다운로드
3. work_management.db 교체
```

---

## 라이선스

(회사 내부 사용)

---

## 지원

문의: your-email@company.com

---

## 버전 히스토리

### v1.0.0 (2026-01-31)
- 초기 릴리스
- 기본 기능 구현
- SQLite 데이터베이스
- 클라우드 동기화
- InnoSetup 설치 프로그램
