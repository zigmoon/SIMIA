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
          downloads/         manifeste des paquets (les binaires viennent de GitHub)
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

# Un paquet Windows depose dans deploy/downloads/ est publie tel quel : rien ne
# le reconstruit. Il doit donc embarquer l'interface a jour. Un ancien paquet a
# deja ete servi avec l'interface privee de la boite cookies, le fichier
# cookies-config.js disparu du projet, et les archives moteur laissees zippees
# a la place de leur contenu : 146 Mo au lieu de 76, pour un resultat perime.
function Assert-WindowsPackage {
    param([string]$Path, [string]$ExpectedIndex)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $names = @($zip.Entries | ForEach-Object { $_.FullName -replace '\\', '/' })
        if (-not $names.Count) { throw "paquet Windows vide : $Path" }
        $prefix = ($names[0] -split '/')[0]
        $problems = @()

        if ($names -notcontains "$prefix/web/cookies.js") {
            $problems += "web/cookies.js absent"
        }
        if ($names -contains "$prefix/web/cookies-config.js") {
            $problems += "web/cookies-config.js encore present, alors qu'il a ete supprime du projet"
        }
        $nested = @($names | Where-Object { $_ -match "^$([regex]::Escape($prefix))/vendor/.*\.(zip|tar\.gz)$" })
        if ($nested.Count) {
            $problems += "archives moteur publiees telles quelles au lieu de leur contenu : $($nested -join ', ')"
        }

        $entry = $zip.Entries | Where-Object { ($_.FullName -replace '\\', '/') -eq "$prefix/web/index.html" } | Select-Object -First 1
        if (-not $entry) {
            $problems += "web/index.html absent"
        } else {
            $reader = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8)
            try { $inside = $reader.ReadToEnd() } finally { $reader.Dispose() }
            $current = [IO.File]::ReadAllText($ExpectedIndex, [System.Text.Encoding]::UTF8)
            if (($inside -replace "`r", '') -ne ($current -replace "`r", '')) {
                $problems += "web/index.html ne correspond pas a web/index.html : interface perimee"
            }
        }

        if ($problems.Count) {
            throw ("paquet Windows refuse ({0}) :`n  - {1}" -f [IO.Path]::GetFileName($Path), ($problems -join "`n  - "))
        }
        Write-Host ("  paquet verifie : {0} embarque l'interface a jour" -f [IO.Path]::GetFileName($Path)) -ForegroundColor DarkGray
    } finally {
        $zip.Dispose()
    }
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
    foreach ($package in (Get-ChildItem $downloadsFrom -File -Filter "*.zip")) {
        Assert-WindowsPackage -Path $package.FullName -ExpectedIndex (Join-Path $App "index.html")
    }
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
    "index.html", ".htaccess", "robots.txt", "sitemap.xml", "service-worker.js", "cookies.js",
    "og-simia.png",
    "agent-api.php", "web-search-api.php", "read-url-api.php",
    "app\index.html", "app\app.js", "app\styles.css", "app\service-worker.js", "app\cookies.js",
    "app\manifest.webmanifest", "app\offline.html",
    "app\icons\icon-192.png", "app\icons\icon-512.png",
    "models\versions.json", "models\catalog.json", "downloads\manifest.json"
)
$missing = $expected | Where-Object { -not (Test-Path (Join-Path $Out $_)) }
if ($missing) { throw "Fichiers manquants dans le dossier final : $($missing -join ', ')" }

# Chaque modele annonce par versions.json est servi avec sa taille et son
# empreinte dans l'application : si le fichier manque, est tronque ou ne
# correspond pas, le telechargement echoue chez le visiteur. Une archive
# oubliee lors d'un envoi FTP ne se voyait nulle part avant ce controle.
Write-Step "Empreintes des modeles"
$modelRoot = Join-Path $Out "models"
foreach ($entry in $versions.models.PSObject.Properties) {
    $id = $entry.Name
    $declared = $entry.Value
    $relative = if ($id -match '/') { $id -replace '/', '\' } else { "$id.gguf" }
    $path = Join-Path $modelRoot $relative
    if (-not (Test-Path $path)) { throw "modele declare mais absent du dossier final : models\$relative" }

    $actualBytes = (Get-Item $path).Length
    if ($declared.bytes -and $actualBytes -ne [int64]$declared.bytes) {
        throw ("modele {0} : {1} octets sur le disque, {2} annonces dans versions.json" -f $relative, $actualBytes, $declared.bytes)
    }
    if ($declared.sha256) {
        $actualSha = (Get-FileHash $path -Algorithm SHA256).Hash.ToLower()
        if ($actualSha -ne ([string]$declared.sha256).ToLower()) {
            throw ("modele {0} : empreinte SHA-256 differente de versions.json" -f $relative)
        }
    }
    Write-Host ("  {0,-52} {1,12:N0} o  sha256 verifie" -f $relative, $actualBytes) -ForegroundColor DarkGray
}

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
