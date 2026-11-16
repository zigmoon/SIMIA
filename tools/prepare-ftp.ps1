<#
.SYNOPSIS
    Assemble le dossier SIMIA/ a deposer tel quel a la racine du serveur.

.DESCRIPTION
    Le site publie n'est ni web/ (l'application) ni deploy/ (la landing) : c'est
    leur reunion, plus les modeles et les paquets a telecharger.

        pwsh -File tools/prepare-ftp.ps1

    Resultat :

        dist/SIMIA/
          index.html         landing
          app/               application web installable
          models/            poids des modeles
          downloads/         paquets Windows, macOS, Linux + manifeste
          *.php              points d'entree appeles par l'application

    Les fichiers de plus de 100 Mo sont relies par lien physique quand c'est
    possible : aucune copie, aucun espace disque supplementaire.

    Le dossier est autonome : on peut le deplacer ou le recompacter sans rien
    casser, il suffit qu'il s'appelle SIMIA.
#>

param(
    [string]$App = (Join-Path $PSScriptRoot "..\web"),
    [string]$Site = (Join-Path $PSScriptRoot "..\deploy"),
    [string]$Models = (Join-Path $PSScriptRoot "..\models"),
    [string]$Out = (Join-Path $PSScriptRoot "..\dist\SIMIA")
)

$ErrorActionPreference = "Stop"
$HardLinkAbove = 100MB

function Write-Step($text) { Write-Host ""; Write-Host "== $text" -ForegroundColor Cyan }

function Add-File {
    param([string]$From, [string]$To)
    $parent = Split-Path $To -Parent
    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    $length = (Get-Item $From).Length
    # Un lien physique pour les gros fichiers : le dossier reste complet, sans
    # consommer un octet de plus sur le disque.
    if ($length -gt $HardLinkAbove) {
        if (Test-Path $To) { Remove-Item $To -Force }
        try {
            New-Item -ItemType HardLink -Path $To -Target $From -ErrorAction Stop | Out-Null
            return
        } catch {
            # Autre volume : on retombe sur une copie.
        }
    }
    Copy-Item $From $To -Force
}

foreach ($path in @($App, $Site, $Models)) {
    if (-not (Test-Path $path)) { throw "Dossier introuvable : $path" }
}
# Chemins absolus normalises : les comparaisons de longueur ci-dessous en
# dependent, et "..\web" n'a pas la meme longueur que sa cible resolue.
$App = (Resolve-Path $App).Path
$Site = (Resolve-Path $Site).Path
$Models = (Resolve-Path $Models).Path

Write-Step "Preparation"
if (Test-Path $Out) { Remove-Item $Out -Recurse -Force }
New-Item -ItemType Directory -Path $Out -Force | Out-Null

Write-Step "Landing et fichiers de site"
foreach ($file in (Get-ChildItem $Site -File -Force)) {
    Add-File $file.FullName (Join-Path $Out $file.Name)
}
$downloadsFrom = Join-Path $Site "downloads"
if (Test-Path $downloadsFrom) {
    Get-ChildItem $downloadsFrom -File -Recurse | ForEach-Object {
        $relative = $_.FullName.Substring($downloadsFrom.Length).TrimStart('\')
        Add-File $_.FullName (Join-Path (Join-Path $Out "downloads") $relative)
    }
}

Write-Step "Application web sous app/"
foreach ($file in (Get-ChildItem $App -File -Recurse)) {
    $relative = $file.FullName.Substring($App.Length).TrimStart('\')
    Add-File $file.FullName (Join-Path (Join-Path $Out "app") $relative)
}

Write-Step "Modeles"
# models/ contient tout le catalogue de bureau (~20 Go). Le serveur, lui, ne
# publie que les modeles declares dans versions.json : c'est cette liste qui
# fait foi, sinon le depot FTP devient impossible a envoyer.
$versionsPath = Join-Path $Models "versions.json"
if (-not (Test-Path $versionsPath)) { throw "models\versions.json introuvable : impossible de savoir quels modeles publier" }
$versions = Get-Content $versionsPath -Raw -Encoding UTF8 | ConvertFrom-Json

$hosted = @()
foreach ($entry in $versions.models.PSObject.Properties) {
    $id = $entry.Name
    if ($id -match '/') {
        $relative = "models\" + ($id -replace '/', '\')
    } else {
        $relative = "models\$id.gguf"
    }
    if (-not (Test-Path (Join-Path $Models $relative.Substring(7)))) {
        throw "modele declare dans versions.json mais absent du disque : $relative"
    }
    $hosted += $relative
}
# Fichiers de description, toujours publics. hosting-status.json n'est pas ici :
# il decrit le modele WebLLM de l'application et vit dans app/models/.
$hosted += "models\versions.json", "models\catalog.json"
if (Test-Path (Join-Path $Models "image\catalog.json")) { $hosted += "models\image\catalog.json" }

foreach ($relative in ($hosted | Sort-Object -Unique)) {
    Add-File (Join-Path $Models $relative.Substring(7)) (Join-Path $Out $relative)
}

Write-Step "Manifeste des telechargements"
$downloadsOut = Join-Path $Out "downloads"
$builds = @()
$targets = [ordered]@{
    "simia-windows-x64.zip"    = "windows-x64"
    "simia-macos-arm64.tar.gz" = "macos-arm64"
    "simia-macos-x64.tar.gz"   = "macos-x64"
    "simia-linux-x64.tar.gz"   = "linux-x64"
}
foreach ($name in $targets.Keys) {
    $file = Join-Path $downloadsOut $name
    if (-not (Test-Path $file)) { continue }
    $builds += [ordered]@{
        target = $targets[$name]
        file   = $name
        bytes  = (Get-Item $file).Length
        sha256 = (Get-FileHash $file -Algorithm SHA256).Hash.ToLower()
    }
}
$version = "0.1.0"
$cargo = Join-Path $PSScriptRoot "..\launcher\Cargo.toml"
if (Test-Path $cargo) {
    $line = Select-String -Path $cargo -Pattern '^version\s*=' | Select-Object -First 1
    if ($line) { $version = ($line.Line -split '=', 2)[1].Trim().Trim('"') }
}
$manifest = [ordered]@{
    version   = $version
    published = (Get-Date).ToString("yyyy-MM-dd")
    builds    = $builds
}
if (-not (Test-Path $downloadsOut)) { New-Item -ItemType Directory -Path $downloadsOut -Force | Out-Null }
[IO.File]::WriteAllText((Join-Path $downloadsOut "manifest.json"), ($manifest | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))

Write-Step "Controle"
$expected = @(
    "index.html", ".htaccess", "robots.txt", "sitemap.xml", "service-worker.js",
    "agent-api.php", "web-search-api.php", "read-url-api.php",
    "app\index.html", "app\app.js", "app\styles.css", "app\service-worker.js",
    "app\manifest.webmanifest", "app\offline.html",
    "app\icons\icon-192.png", "app\icons\icon-512.png",
    "models\versions.json", "models\catalog.json", "downloads\manifest.json"
)
$missing = $expected | Where-Object { -not (Test-Path (Join-Path $Out $_)) }
if ($missing) { throw "Fichiers manquants dans le dossier final : $($missing -join ', ')" }

# Le manifeste de l'application doit rester installable.
$appManifest = Get-Content (Join-Path $Out "app\manifest.webmanifest") -Raw -Encoding UTF8 | ConvertFrom-Json
$sizes = $appManifest.icons | ForEach-Object { $_.sizes }
foreach ($needed in "192x192", "512x512") {
    if ($sizes -notcontains $needed) { throw "manifeste : icone $needed absente" }
}
if ($appManifest.display -ne "standalone") { throw "manifeste : display doit valoir standalone" }

$files = Get-ChildItem $Out -Recurse -File
$logical = ($files | Measure-Object Length -Sum).Sum
$outPath = (Resolve-Path $Out).Path

Write-Host ""
Write-Host "Dossier pret : $outPath"
Write-Host ("  {0} fichiers, {1:N2} Go" -f $files.Count, ($logical / 1GB))
foreach ($group in ($files | Group-Object { $_.Directory.FullName.Replace($outPath, "").TrimStart("\").Split("\")[0] } | Sort-Object Name)) {
    $label = if ($group.Name) { $group.Name + "/" } else { "racine" }
    Write-Host ("  {0,-16} {1,3} fichiers  {2,8:N1} Mo" -f $label, $group.Count, (($group.Group | Measure-Object Length -Sum).Sum / 1MB))
}
Write-Host ""
Write-Host "Deposez le dossier SIMIA ENTIER a la racine du serveur :"
Write-Host "  app.zigmoon.com/  +  SIMIA/   ->   app.zigmoon.com/SIMIA/"
Write-Host ""
Write-Host "Le dossier est autonome : il remplace integralement la version en ligne."
Write-Host "Ne pas oublier de repasser en mode ASCII/binaire selon votre client :"
Write-Host "les .gguf, .zip et .png doivent partir en binaire, jamais en ASCII."
