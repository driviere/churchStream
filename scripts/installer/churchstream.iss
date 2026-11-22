; ChurchStream for Windows: the installer (Inno Setup 6; built by CI, see
; .github/workflows/windows-build.yml):
;   iscc /DAppVersion=1.0.0 /DSourceDir=..\..\dist\ChurchStream /DOutputDir=..\..\dist scripts\installer\churchstream.iss
;
; - Installs for the current user, without an administrator password, into
;   %LOCALAPPDATA%\Programs\ChurchStream, with Start menu (and optional desktop) shortcuts
;   and an uninstaller.
; - Settings, songs and recordings go to ChurchStream-data in the user's home folder
;   (ChurchStream.ini, read by lib/datadir.js), so uninstalling or installing again never
;   touches them.
; - Can bring the settings of an older ChurchStream folder (the portable zip) along once.
; - Running a newer installer over an installed ChurchStream updates it in place. Most updates
;   don't need this: ChurchStream downloads only what changed (lib/updater.js).

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\dist\ChurchStream"
#endif
#ifndef IconFile
  #define IconFile "..\..\assets\icon\churchstream.ico"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\dist"
#endif

[Setup]
AppId={{6F1C2B7E-4A0D-4E5B-9C3A-CB5D7E2F9A41}
AppName=ChurchStream
AppVersion={#AppVersion}
AppVerName=ChurchStream {#AppVersion}
AppPublisher=ChurchStream
AppPublisherURL=https://github.com/driviere/churchStream
AppSupportURL=https://github.com/driviere/churchStream
AppUpdatesURL=https://github.com/driviere/churchStream/releases
DefaultDirName={localappdata}\Programs\ChurchStream
DefaultGroupName=ChurchStream
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=ChurchStream-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\ChurchStream.exe
UninstallDisplayName=ChurchStream
CloseApplications=force
RestartApplications=no
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Put a ChurchStream shortcut on the desktop"; GroupDescription: "Shortcuts:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Excludes: "ChurchStream-data\*,ChurchStream.ini"; Flags: ignoreversion recursesubdirs createallsubdirs

[INI]
; Where the data lives (lib/datadir.js): ~ is the user's home folder.
Filename: "{app}\ChurchStream.ini"; Section: "ChurchStream"; Key: "data"; String: "~\ChurchStream-data"; Flags: uninsdeletesection

[Icons]
Name: "{autoprograms}\ChurchStream"; Filename: "{app}\ChurchStream.exe"; WorkingDir: "{app}"; Comment: "Streaming and projection for your church"
Name: "{autoprograms}\ChurchStream read me"; Filename: "{app}\README.txt"
Name: "{autodesktop}\ChurchStream"; Filename: "{app}\ChurchStream.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\ChurchStream.exe"; Description: "Start ChurchStream now"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: files; Name: "{app}\ChurchStream.ini"

[Code]
var
  ImportChoice: TInputOptionWizardPage;
  ImportPage: TInputDirWizardPage;

function DataDir(): String;
begin
  Result := ExpandConstant('{%USERPROFILE}') + '\ChurchStream-data';
end;

// The folder of an older ChurchStream to bring the data from: the /ImportFrom=<folder> option
// (silent installs on many computers), or the folder chosen in the wizard; '' for none.
function ImportFolder(): String;
begin
  Result := Trim(ExpandConstant('{param:ImportFrom|}'));
  if (Result = '') and ImportChoice.Values[0] then Result := Trim(ImportPage.Values[0]);
end;

function HasData(Folder: String): Boolean;
begin
  Folder := AddBackslash(Folder);
  Result := FileExists(Folder + 'ChurchStream-data\config.json') or FileExists(Folder + 'config.json');
end;

procedure InitializeWizard();
begin
  ImportChoice := CreateInputOptionPage(wpSelectTasks,
    'Settings from an older ChurchStream',
    'Did you use ChurchStream from a folder (the zip download) before?',
    'Your ChurchStream data will be kept in: ' + DataDir(),
    False, False);
  ImportChoice.Add('Bring the settings, songs and services from an older ChurchStream folder');
  ImportChoice.Values[0] := False;
  ImportPage := CreateInputDirPage(ImportChoice.ID,
    'Settings from an older ChurchStream',
    'Where is the older ChurchStream?',
    'Choose the folder that holds ChurchStream.exe (with ChurchStream-data inside). Its settings, songs and services are copied; nothing there is changed.',
    False, '');
  ImportPage.Add('Older ChurchStream folder:');
  ImportPage.Values[0] := ExpandConstant('{userdesktop}\ChurchStream');
end;

// Nothing to ask when this computer already has ChurchStream data, or the box isn't ticked.
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if (PageID = ImportChoice.ID) or (PageID = ImportPage.ID) then
    Result := FileExists(DataDir() + '\config.json');
  if (PageID = ImportPage.ID) and not ImportChoice.Values[0] then Result := True;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = ImportPage.ID) and not HasData(ImportPage.Values[0]) then begin
    MsgBox('No ChurchStream settings were found in that folder. Choose the folder that holds ChurchStream.exe (with ChurchStream-data inside), or go Back and untick the box.', mbError, MB_OK);
    Result := False;
  end;
end;

// Copy the older data once, never overwriting anything already there.
procedure CurStepChanged(CurStep: TSetupStep);
var
  Src: String;
  Code: Integer;
begin
  if CurStep <> ssPostInstall then Exit;
  Src := ImportFolder();
  if Src = '' then Exit;
  if FileExists(DataDir() + '\config.json') then Exit;
  Src := AddBackslash(Src);
  if FileExists(Src + 'ChurchStream-data\config.json') then Src := Src + 'ChurchStream-data'
  else if not FileExists(Src + 'config.json') then begin
    Log('No ChurchStream data in ' + Src);
    Exit;
  end;
  Log('Bringing the data from ' + Src);
  Exec(ExpandConstant('{sys}\robocopy.exe'), '"' + RemoveBackslash(Src) + '" "' + DataDir() + '" /E /XC /XN /XO /R:1 /W:1 /NP /NFL /NDL',
    '', SW_HIDE, ewWaitUntilTerminated, Code);
end;
