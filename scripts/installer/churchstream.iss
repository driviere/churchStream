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
  ImportPage: TInputDirWizardPage;

function DataDir(): String;
begin
  Result := ExpandConstant('{%USERPROFILE}') + '\ChurchStream-data';
end;

procedure InitializeWizard();
begin
  ImportPage := CreateInputDirPage(wpSelectTasks,
    'Settings from an older ChurchStream',
    'Did you use ChurchStream from a folder (the zip download) before?',
    'If so, choose that ChurchStream folder and its settings, songs and services come along. ' +
    'Otherwise leave this empty.' + #13#10#13#10 +
    'Your ChurchStream data will be kept in: ' + DataDir(),
    False, '');
  ImportPage.Add('Older ChurchStream folder (optional):');
  ImportPage.Values[0] := '';
end;

// The installed ChurchStream already has its data: nothing to ask.
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = ImportPage.ID) and FileExists(DataDir() + '\config.json');
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Src: String;
begin
  Result := True;
  if CurPageID = ImportPage.ID then begin
    Src := Trim(ImportPage.Values[0]);
    if (Src <> '') and not FileExists(AddBackslash(Src) + 'ChurchStream-data\config.json') and not FileExists(AddBackslash(Src) + 'config.json') then begin
      MsgBox('No ChurchStream settings were found in that folder. Choose the folder that holds ChurchStream.exe (with ChurchStream-data inside), or leave it empty.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

// Copy the older data once, never overwriting anything already there.
procedure CurStepChanged(CurStep: TSetupStep);
var
  Src: String;
  Code: Integer;
begin
  if CurStep <> ssPostInstall then Exit;
  Src := Trim(ImportPage.Values[0]);
  if Src = '' then Exit;
  if FileExists(DataDir() + '\config.json') then Exit;
  Src := AddBackslash(Src);
  if FileExists(Src + 'ChurchStream-data\config.json') then Src := Src + 'ChurchStream-data';
  Exec(ExpandConstant('{sys}\robocopy.exe'), '"' + RemoveBackslash(Src) + '" "' + DataDir() + '" /E /XC /XN /XO /R:1 /W:1 /NP /NFL /NDL',
    '', SW_HIDE, ewWaitUntilTerminated, Code);
end;
