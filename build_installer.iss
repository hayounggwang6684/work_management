; InnoSetup ?ㅼ튂 ?ㅽ겕由쏀듃
; 湲덉씪?묒뾽?꾪솴 愿由??쒖뒪??- Embedded Python 諛고룷
; 諛깆떊 ?ㅽ깘 ?녿뒗 諛고룷 諛⑹떇

[Setup]
AppName=湲덉씪?묒뾽?꾪솴 愿由?
AppVersion=2.1.11
AppPublisher=Your Company
DefaultDirName={autopf}\WorkManagement
DefaultGroupName=湲덉씪?묒뾽?꾪솴 愿由?
OutputDir=dist\installer
OutputBaseFilename=WorkManagement_Setup_v2.1.11
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
Name: "desktopicon"; Description: "諛뷀깢?붾㈃ ?꾩씠肄?留뚮뱾湲?; GroupDescription: "異붽? ?꾩씠肄?";

[Files]
; Embedded Python ?고???
Source: "build_embedded\python\*"; DestDir: "{app}\python"; Flags: ignoreversion recursesubdirs createallsubdirs

; ???뚯뒪肄붾뱶 + ??由ъ냼??
Source: "build_embedded\app\src\*"; DestDir: "{app}\app\src"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "build_embedded\app\web\*"; DestDir: "{app}\app\web"; Flags: ignoreversion recursesubdirs createallsubdirs

; ?ㅼ젙 ?뚯씪 (理쒖큹 ?ㅼ튂 ?쒕쭔 蹂듭궗, ?낅뜲?댄듃 ???ъ슜???ㅼ젙 蹂댁〈)
Source: "build_embedded\app\config\*"; DestDir: "{app}\app\config"; Flags: onlyifdoesntexist recursesubdirs createallsubdirs

; 由ъ냼??(?꾩씠肄??? - ?대뜑媛 議댁옱?섎뒗 寃쎌슦?먮쭔 ?ы븿
Source: "build_embedded\app\resources\*"; DestDir: "{app}\app\resources"; Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist

; ?먯뀑 (濡쒓퀬 ??
Source: "build_embedded\app\assets\*"; DestDir: "{app}\app\assets"; Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist

; ?ㅽ뻾 ?ㅽ겕由쏀듃
Source: "build_embedded\run.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "build_embedded\run_debug.bat"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
Name: "{app}\logs";          Permissions: users-full
Name: "{app}\data";          Permissions: users-full
Name: "{app}\app\src";       Permissions: users-full
Name: "{app}\app\web";       Permissions: users-full
Name: "{app}\app\data";      Permissions: users-full
Name: "{app}\app\patches";   Permissions: users-full
Name: "{app}\app\backups";   Permissions: users-full
Name: "{app}\app\config";    Permissions: users-full

[Icons]
; ?쒖옉 硫붾돱
Name: "{group}\湲덉씪?묒뾽?꾪솴 愿由?; Filename: "{app}\python\pythonw.exe"; Parameters: """{app}\app\src\main.py"""; WorkingDir: "{app}"; IconFilename: "{app}\app\assets\icon.ico"; Comment: "湲덉씪?묒뾽?꾪솴 愿由??쒖뒪??
Name: "{group}\?쒓굅"; Filename: "{uninstallexe}"

; 諛뷀깢?붾㈃ (?좏깮)
Name: "{autodesktop}\湲덉씪?묒뾽?꾪솴 愿由?; Filename: "{app}\python\pythonw.exe"; Parameters: """{app}\app\src\main.py"""; WorkingDir: "{app}"; IconFilename: "{app}\app\assets\icon.ico"; Tasks: desktopicon; Comment: "湲덉씪?묒뾽?꾪솴 愿由??쒖뒪??

[Run]
; ?ㅼ튂 ???ㅽ뻾 ?듭뀡
Filename: "{app}\python\pythonw.exe"; Parameters: """{app}\app\src\main.py"""; WorkingDir: "{app}"; Description: "湲덉씪?묒뾽?꾪솴 愿由??ㅽ뻾"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\logs"
Type: filesandordirs; Name: "{app}\data"
Type: filesandordirs; Name: "{app}\__pycache__"
