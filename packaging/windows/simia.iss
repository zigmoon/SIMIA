; Installeur SIMIA pour Windows.
;
; Objectif : double-clic, SIMIA s'installe, raccourci dans le menu Demarrer,
; desinstalleur propre. Plus de decompression manuelle.
;
; Deux choix assumes :
;   - PrivilegesRequired=lowest : installation dans %LOCALAPPDATA%, donc aucune
;     demande d'administrateur. C'est la promesse du LISEZ-MOI, et un installeur
;     qui reclame les droits admin la contredirait.
;   - Compression=none : les poids sont deja compresses (gguf, safetensors, dll).
;     Recompresser 1,5 Go ferait perdre plusieurs minutes de CI pour quelques
;     pourcents. Ce que l'utilisateur telecharge fait la taille de l'archive zip.
;
; Le contenu installe est exactement celui du dossier assemble par la CI :
; l'installeur ne remplace pas le paquet, il l'installe.

#define AppName "SIMIA"
#define AppPublisher "Zigmoon"
#define AppUrl "https://app.zigmoon.com/SIMIA/"
#define AppExe "simia-desktop.exe"
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\dist\windows"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\dist"
#endif

[Setup]
AppId={{8F3A2C41-6D19-4B7E-9C2A-5E4F1B7D3A60}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}
AppUpdatesURL={#AppUrl}
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir={#OutputDir}
OutputBaseFilename=simia-windows-x64-setup
Compression=none
SolidCompression=no
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\{#AppExe}
SetupLogging=yes

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; recursesubdirs : web/, models/, vendor/ gardent leur arborescence.
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"
Name: "{group}\LISEZ-MOI"; Filename: "{app}\LISEZ-MOI.txt"
Name: "{group}\Desinstaller {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent
Filename: "{app}\LISEZ-MOI.txt"; Description: "Lire le LISEZ-MOI (SmartScreen, desinstallation)"; Flags: postinstall shellexec skipifsilent unchecked

[UninstallDelete]
; Le stockage local et les modeles telecharges ensuite vivent ailleurs, ou sont
; les fichiers de l'utilisateur : on ne supprime que ce que l'installeur a cree.
Type: filesandordirs; Name: "{app}\web"
Type: filesandordirs; Name: "{app}\vendor"
