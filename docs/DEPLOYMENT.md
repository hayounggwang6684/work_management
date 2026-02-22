# 배포 가이드 - 금일작업현황 관리 시스템

## 📦 배포 준비 체크리스트

### 1단계: 개발 완료 확인
- [ ] 모든 기능 구현 완료
- [ ] 테스트 실행 및 통과
- [ ] 버전 번호 업데이트
- [ ] README 및 문서 최신화

### 2단계: 빌드 준비
- [ ] Python 3.10+ 설치 확인
- [ ] 가상환경 생성 및 의존성 설치
- [ ] 로컬에서 프로그램 실행 테스트

### 3단계: 빌드 실행
- [ ] PyInstaller로 exe 생성
- [ ] InnoSetup으로 설치 프로그램 생성
- [ ] 설치 프로그램 테스트

### 4단계: 배포
- [ ] 설치 파일 공유 (네트워크 드라이브 또는 이메일)
- [ ] 사용자 매뉴얼 공유
- [ ] 설치 지원

---

## 🔨 상세 빌드 가이드

### Step 1: 환경 준비

```bash
# 프로젝트 폴더로 이동
cd work-management-desktop

# 가상환경 활성화
venv\Scripts\activate  # Windows

# 의존성 확인
pip install -r requirements.txt
```

### Step 2: 테스트 실행

```bash
# 인원 계산 테스트
python tests/test_calculations.py

# 프로그램 실행 테스트
python src/main.py
```

### Step 3: 버전 업데이트

```json
// config/settings.json
{
  "app": {
    "version": "1.1.0"  ← 이 버전 번호 확인
  }
}
```

### Step 4: PyInstaller 빌드

#### 방법 A: build.bat 사용 (권장)
```bash
build.bat
```

#### 방법 B: 수동 빌드
```bash
pyinstaller ^
  --name work_management ^
  --onedir ^
  --windowed ^
  --add-data "web;web" ^
  --add-data "config;config" ^
  --hidden-import=eel ^
  --hidden-import=openpyxl ^
  --hidden-import=pandas ^
  src/main.py
```

**결과 확인**: `dist/work_management/work_management.exe`

### Step 5: InnoSetup 설치 프로그램 생성

1. **InnoSetup 다운로드 및 설치**
   - https://jrsoftware.org/isdl.php
   - 다운로드 후 설치

2. **build_installer.iss 열기**
   - InnoSetup 실행
   - File > Open
   - `build_installer.iss` 선택

3. **버전 확인**
   ```ini
   [Setup]
   AppVersion=1.1.0  ← 확인
   OutputBaseFilename=WorkManagement_Setup_v1.1.0  ← 확인
   ```

4. **컴파일**
   - Build > Compile (F9)
   - 완료 대기 (약 1-2분)

**결과**: `dist/installer/WorkManagement_Setup_v1.1.0.exe`

---

## 📤 배포 방법

### 방법 1: 네트워크 드라이브 (권장)

```
1. 공유 폴더 생성
   \\서버\공유\WorkManagement\Installer\

2. 설치 파일 복사
   WorkManagement_Setup_v1.1.0.exe
   사용자매뉴얼.pdf
   README.pdf

3. 직원들에게 경로 공유
```

### 방법 2: 이메일

```
1. 설치 파일 압축 (ZIP)
2. 이메일 첨부 전송
3. 주의: 파일 크기 확인 (이메일 용량 제한)
```

### 방법 3: USB

```
1. USB에 복사
2. 각 PC에서 직접 설치
```

---

## 👥 사용자 설치 가이드

### 최종 사용자용 간단 가이드

```
===============================================
금일작업현황 관리 시스템 설치 가이드
===============================================

1. 설치 프로그램 다운로드
   - WorkManagement_Setup_v1.1.0.exe

2. 설치 프로그램 실행
   - 더블클릭
   - Windows Defender 경고 시:
     "자세한 정보" > "실행" 클릭

3. 설치 진행
   - "다음" 버튼 클릭
   - 설치 경로 확인: C:\Program Files\WorkManagement
   - "설치" 버튼 클릭

4. 설치 완료
   - "금일작업현황 관리 실행" 체크
   - "완료" 버튼 클릭

5. 첫 실행
   - 이름 입력
   - 로그인
   - 사용 시작!

===============================================
```

---

## 🔄 업데이트 배포

### 버그 수정 패치 (간단한 수정)

```
1. 수정된 파일 준비
   예: src/utils/patch_system.py

2. 패치 폴더 생성
   patches/patch-v1.1.0/
   ├── src/utils/patch_system.py
   └── patch.json

3. patch.json 작성
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

4. ZIP으로 압축
   patch-v1.1.0.zip

5. 사용자에게 배포
   - ZIP 파일 전달
   - patches/ 폴더에 압축 해제
   - 프로그램 재시작
```

### 전체 업데이트 (큰 변경)

```
1. 새 버전 빌드 (위의 빌드 가이드 참조)

2. 새 설치 프로그램 생성
   WorkManagement_Setup_v1.1.0.exe

3. 배포
   - 기존 프로그램 제거 불필요
   - 새 버전 설치하면 자동 업그레이드
   - 데이터는 유지됨
```

---

## 🛡️ 백신 오탐 대처

### 문제
- Windows Defender가 exe를 차단
- "알 수 없는 게시자" 경고

### 해결방법

#### 방법 1: 사용자 제외 설정 (즉시)
```
1. Windows Defender 열기
2. 바이러스 및 위협 방지
3. 설정 관리
4. 제외 추가
5. 파일 또는 폴더
6. C:\Program Files\WorkManagement\ 추가
```

#### 방법 2: 코드 서명 인증서 (장기적)
```
1. 코드 서명 인증서 구매
   - GlobalSign, Sectigo 등
   - 비용: 연간 약 20-50만원

2. 인증서로 exe 서명
   signtool sign /f cert.pfx work_management.exe

3. 재배포
   - 서명된 파일은 백신 오탐 없음
```

#### 방법 3: InnoSetup 사용 (현재 적용됨)
- 설치 프로그램은 오탐률 낮음
- exe 단독 배포보다 안전

---

## 📊 배포 후 점검

### 1주차
- [ ] 모든 PC 설치 완료 확인
- [ ] 로그인 및 기본 기능 테스트
- [ ] 클라우드 동기화 설정 확인
- [ ] 사용자 피드백 수집

### 1개월차
- [ ] 버그 리포트 수집
- [ ] 사용 패턴 분석
- [ ] 필요한 기능 추가 논의
- [ ] 패치 또는 업데이트 배포

---

## 🆘 문제 해결

### 설치 실패
**증상**: 설치 중 오류 발생

**해결**:
1. Windows 업데이트 확인
2. 관리자 권한으로 재시도
3. 기존 버전 제거 후 재설치

### 프로그램 실행 안됨
**증상**: 아이콘 클릭해도 아무 반응 없음

**해결**:
1. 작업 관리자에서 중복 실행 확인
2. 프로그램 재설치
3. logs/app.log 확인

### 클라우드 동기화 안됨
**증상**: "클라우드 폴더를 찾을 수 없습니다"

**해결**:
```json
// config/settings.json 수정
{
  "database": {
    "cloud_path": "C:/Users/YourName/Google Drive/WorkManagement"
  }
}
```

### 데이터 손실
**증상**: 저장한 데이터가 사라짐

**해결**:
1. data/backups/ 폴더 확인
2. 클라우드에서 복구
3. 최신 백업 복사

---

## 📞 지원 연락처

- **기술 지원**: tech-support@company.com
- **전화**: 02-XXXX-XXXX
- **긴급**: 010-XXXX-XXXX

---

## 📝 배포 체크리스트 (최종)

### 개발팀
- [ ] 코드 완성
- [ ] 테스트 통과
- [ ] 문서 작성
- [ ] 빌드 완료
- [ ] 설치 파일 생성

### IT팀
- [ ] 공유 폴더 준비
- [ ] 설치 파일 배포
- [ ] 백신 제외 설정
- [ ] 네트워크 접근 권한

### 사용자
- [ ] 설치 완료
- [ ] 로그인 성공
- [ ] 클라우드 연결
- [ ] 기본 사용법 숙지

---

**배포 성공을 기원합니다! 🎉**
