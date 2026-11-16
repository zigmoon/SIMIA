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
    $_.Extension -in ".html", ".js", ".css", ".json", ".webmanifest", ".svg", ".ico"
} | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $Target $_.Name) -Force
    $copies++
}

# La boite cookies est commune a la landing et a l'application : elle vit dans
# deploy/ (a cote de la landing) et le service worker la precache sous app/.
# Une seule source, donc pas de divergence entre les deux copies.
$cookies = Join-Path $PSScriptRoot "..\deploy\cookies.js"
if (-not (Test-Path $cookies)) { throw "deploy\cookies.js introuvable" }
Copy-Item $cookies (Join-Path $Target "cookies.js") -Force
$copies++

# Configuration Apache : elle decrit le site, pas l'application. Elle est
# desormais versionnee dans deploy/.htaccess.

# Icones de l'application installee (192, 512, maskable, Apple).
foreach ($folder in @("icons", "screenshots")) {
    $from = Join-Path $Source $folder
    if (-not (Test-Path $from)) { continue }
    $to = Join-Path $Target $folder
    New-Item -ItemType Directory -Path $to -Force | Out-Null
    Get-ChildItem $from -File | ForEach-Object {
        Copy-Item $_.FullName (Join-Path $to $_.Name) -Force
        $copies++
    }
}

$status = Join-Path $Source "models\hosting-status.json"
if (Test-Path $status) {
    New-Item -ItemType Directory -Path (Join-Path $Target "models") -Force | Out-Null
    Copy-Item $status (Join-Path $Target "models\hosting-status.json") -Force
    $copies++
}

# La landing et les fichiers de site ne sont plus dans web/ : ils vivent dans
# deploy/ (landing a la racine du site, application sous /app/).

$expected = @(
    "index.html", "app.js", "styles.css", "code-runner.js", "service-worker.js",
    "cookies.js", "manifest.webmanifest", "offline.html",
    "icons\icon-192.png", "icons\icon-512.png"
)
$missing = $expected | Where-Object { -not (Test-Path (Join-Path $Target $_)) }
if ($missing) { throw "Fichiers manquants apres copie : $($missing -join ', ')" }

$size = [math]::Round(((Get-ChildItem $Target -Recurse -File | Measure-Object Length -Sum).Sum / 1KB), 0)
Write-Host "web/ synchronise : $copies fichiers, $size Ko"
