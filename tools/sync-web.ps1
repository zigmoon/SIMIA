<#
.SYNOPSIS
    Synchronise l'interface web dans SIMIA-desktop/web.

.DESCRIPTION
    Le depot SIMIA-desktop doit etre autonome : GitHub Actions ne voit que lui.
    Cette copie evite un sous-module et garde SIMIA/ comme source unique.

        pwsh -File tools/sync-web.ps1
        git add web && git commit -m "web: mise a jour de l'interface"

    A relancer apres chaque modification de ../SIMIA.
#>

param(
    [string]$Source = (Join-Path $PSScriptRoot "..\..\SIMIA"),
    [string]$Target = (Join-Path $PSScriptRoot "..\web")
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path (Join-Path $Source "index.html"))) {
    throw "Interface introuvable : $Source (attendu : index.html)"
}

if (Test-Path $Target) { Remove-Item $Target -Recurse -Force }
New-Item -ItemType Directory -Path $Target -Force | Out-Null

$copies = 0
Get-ChildItem $Source -File | Where-Object {
    $_.Extension -in ".html", ".js", ".css", ".json", ".webmanifest", ".svg", ".txt", ".xml", ".ico", ".php"
} | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $Target $_.Name) -Force
    $copies++
}

$status = Join-Path $Source "models\hosting-status.json"
if (Test-Path $status) {
    New-Item -ItemType Directory -Path (Join-Path $Target "models") -Force | Out-Null
    Copy-Item $status (Join-Path $Target "models\hosting-status.json") -Force
    $copies++
}

# Page de presentation des versions de bureau (app.zigmoon.com/SIMIA/desktop/).
$landing = Join-Path $Source "desktop"
if (Test-Path (Join-Path $landing "index.html")) {
    New-Item -ItemType Directory -Path (Join-Path $Target "desktop") -Force | Out-Null
    Copy-Item (Join-Path $landing "index.html") (Join-Path $Target "desktop\index.html") -Force
    $copies++
}

$expected = @("index.html", "app.js", "styles.css", "code-runner.js", "service-worker.js")
$missing = $expected | Where-Object { -not (Test-Path (Join-Path $Target $_)) }
if ($missing) { throw "Fichiers manquants apres copie : $($missing -join ', ')" }

$size = [math]::Round(((Get-ChildItem $Target -Recurse -File | Measure-Object Length -Sum).Sum / 1KB), 0)
Write-Host "web/ synchronise : $copies fichiers, $size Ko"
