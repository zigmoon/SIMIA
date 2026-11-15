<#
.SYNOPSIS
    Publie SIMIA sur GitHub : synchronise l'interface, commit, tag et push.

.DESCRIPTION
    A lancer depuis SIMIA-desktop. Le depot distant doit exister et les
    identifiants GitHub etre deja configures (Git Credential Manager fait le
    necessaire au premier push).

        powershell -NoProfile -File tools\publish.ps1 -Tag v1.0.0

    Sans -Tag, seul le commit est pousse.
#>

param(
    [string]$Tag = "",
    [string]$Message = ""
)

$ErrorActionPreference = "Stop"
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }

Step "1/5 Synchronisation de l'interface"
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "sync-web.ps1")

Step "2/5 Verification avant commit"
if (-not (Test-Path "web\index.html")) { throw "web/index.html manquant" }
if (-not (Test-Path ".github\workflows\build.yml")) { throw "workflow manquant" }
$heavy = Get-ChildItem . -Recurse -File -Include *.gguf, *.pth, *.onnx, *.ckpt -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\target\\' -and $_.Length -gt 20MB }
if ($heavy) {
    Write-Warning "Fichiers lourds detectes (ils devraient etre ignores) :"
    $heavy | ForEach-Object { Write-Warning ("  {0} ({1:N0} Mo)" -f $_.Name, ($_.Length / 1MB)) }
}

Step "3/5 Commit"
git add -A
$changes = git status --porcelain
if ($changes) {
    if (-not $Message) { $Message = "Mise a jour de SIMIA" }
    $body = "$Message`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
    $tmp = Join-Path $env:TEMP "simia_msg.txt"
    [IO.File]::WriteAllText($tmp, $body, (New-Object Text.UTF8Encoding($false)))
    git commit -F $tmp
    Remove-Item $tmp -Force
} else {
    Write-Host "  rien de nouveau a committer"
}

Step "4/5 Push de la branche main"
git push -u origin main

if ($Tag) {
    Step "5/5 Tag $Tag et publication"
    if (-not (git tag --list $Tag)) { git tag -a $Tag -m "SIMIA $Tag" }
    git push origin $Tag
    Write-Host "  Le workflow GitHub Actions compile les 4 paquets et cree la release." -ForegroundColor Green
    Write-Host "  Suivi : https://github.com/zigmoon/SIMIA/actions" -ForegroundColor Green
} else {
    Step "5/5 Termine"
    Write-Host "  Depot : https://github.com/zigmoon/SIMIA" -ForegroundColor Green
}
