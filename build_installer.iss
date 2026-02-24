; InnoSetup 설치 스크립트
; 금일작업현황 관리 시스템 - Embedded Python 배포
; 백신 오탐 없는 배포 방식

[Setup]
AppName=금일작업현황 관리
AppVersion=1.2.0
AppPublisher=Your Company
DefaultDirName={autopf}\WorkManagement
DefaultGroupName=금일작업현황 관리
OutputDir=dist\installer
OutputBaseFilename=WorkManagement_Setup_v1.2.0
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
SetupIconFile=assets\icon.ico
UninstallDisplayIcon={app}\app\assets\icon.ico
WizardStyle=modern

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Tasks]
Name: "desktopicon"; Description: "바탕화면 아이콘 만들기"; GroupDescription: "추가 아이콘:";

[Files]
; Embedded Python 런타임
Source: "build_embedded\python\*"; DestDir: "{app}\python"; Flags: ignoreversion recursesubdirs createallsubdirs

; 앱 소스코드 + 웹 리소스
Source: "build_embedded\app\src\*"; DestDir: "{app}\app\src"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "build_embedded\app\web\*"; DestDir: "{app}\app\web"; Flags: ignoreversion recursesubdirs createallsubdirs

; 설정 파일 (최초 설치 시만 복사, 업데이트 시 사용자 설정 보존)
Source: "build_embedded\app\config\*"; DestDir: "{app}\app\config"; Flags: onlyifdoesntexist recursesubdirs createallsubdirs

; 리소스 (아이콘 등) - 폴더가 존재하는 경우에만 포함
Source: "build_embedded\app\resources\*"; DestDir: "{app}\app\resources"; Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist

; 에셋 (로고 등)
Source: "build_embedded\app\assets\*"; DestDir: "{app}\app\assets"; Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist

; 실행 스크립트
Source: "build_embedded\run.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "build_embedded\run_debug.bat"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
Name: "{app}\logs"; Permissions: users-full
Name: "{app}\data"; Permissions: users-full

[Icons]
; 시작 메뉴
Name: "{group}\금일작업현황 관리"; Filename: "{app}\python\pythonw.exe"; Parameters: """{app}\app\src\main.py"""; WorkingDir: "{app}"; IconFilename: "{app}\app\assets\icon.ico"; Comment: "금일작업현황 관리 시스템"
Name: "{group}\제거"; Filename: "{uninstallexe}"

; 바탕화면 (선택)
Name: "{autodesktop}\금일작업현황 관리"; Filename: "{app}\python\pythonw.exe"; Parameters: """{app}\app\src\main.py"""; WorkingDir: "{app}"; IconFilename: "{app}\app\assets\icon.ico"; Tasks: desktopicon; Comment: "금일작업현황 관리 시스템"

[Run]
; 설치 후 실행 옵션
Filename: "{app}\python\pythonw.exe"; Parameters: """{app}\app\src\main.py"""; WorkingDir: "{app}"; Description: "금일작업현황 관리 실행"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\logs"
Type: filesandordirs; Name: "{app}\data"
Type: filesandordirs; Name: "{app}\__pycache__"
