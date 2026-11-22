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

# Garde-fou : la copie ne doit jamais ecraser un fichier plus recent. C'est
# arrive — web/ avait recu les correctifs de la version 0.1.11, SIMIA/ etait
# reste au 16 novembre, et lancer ce script aurait ramene l'application trois
# versions en arriere sans le dire.
$extensions = ".html", ".js", ".css", ".json", ".webmanifest", ".svg", ".ico"
$files = @(Get-ChildItem -Path $Source -File | Where-Object { $extensions -contains $_.Extension })

$stale = @()
foreach ($file in $files) {
    $existing = Join-Path $Target $file.Name
    if ((Test-Path $existing) -and ((Get-Item $existing).LastWriteTime -gt $file.LastWriteTime.AddMinutes(2))) {
        $stale += $file.Name
    }
}
if ($stale.Count -gt 0) {
    throw ("La copie de reference est plus ancienne que web/ pour : {0}. " -f ($stale -join ", ")) +
        "Synchronisez d'abord SIMIA/ depuis SIMIA-desktop/web, puis relancez."
}

New-Item -ItemType Directory -Path $Target -Force | Out-Null

# Copie fichier par fichier, jamais un Remove-Item -Recurse sur web/ : ce
# dossier peut etre le repertoire courant d'un serveur de test, et le script
# vidait alors l'application avant d'echouer sur la suppression du dossier.
$copies = 0
foreach ($file in $files) {
    Copy-Item -Path $file.FullName -Destination (Join-Path $Target $file.Name) -Force
    $copies++
}

# Fichiers perimes : presents dans web/ mais absents de la reference. On les
# retire un par un, en gardant cookies.js (qui vient de deploy/).
$known = @($files | ForEach-Object { $_.Name }) + @("cookies.js")
Get-ChildItem -Path $Target -File | Where-Object { $known -notcontains $_.Name -and $extensions -contains $_.Extension } | ForEach-Object {
    Remove-Item -LiteralPath $_.FullName -Force
    Write-Host "retire : $($_.Name)"
}

# La boite cookies est commune a la landing et a l'application. Elle n'existe
# plus qu'en un seul exemplaire, celui de l'application : tools/prepare-ftp.ps1
# le recopie a la racine du site. Deux fichiers maintenus en parallele avaient
# deja diverge, donc plus aucune copie depuis deploy/.
$cookies = Join-Path $Target "cookies.js"
if (-not (Test-Path $cookies)) { throw "web\cookies.js introuvable : la boite cookies est la source unique" }

# Configuration Apache : elle decrit le site, pas l'application. Elle est
# desormais versionnee dans deploy/.htaccess.

# Icones de l'application installee (192, 512, maskable, Apple).
foreach ($folder in @("icons", "screenshots")) {
    $from = Join-Path $Source $folder
    if (-not (Test-Path $from)) { continue }
    $to = Join-Path $Target $folder
    New-Item -ItemType Directory -Path $to -Force | Out-Null
    foreach ($item in @(Get-ChildItem -Path $from -File)) {
        Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $to $item.Name) -Force
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
