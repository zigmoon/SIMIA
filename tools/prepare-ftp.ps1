<#
.SYNOPSIS
    Prepare le dossier exact a televerser sur app.zigmoon.com/SIMIA/.

.DESCRIPTION
    Le dossier SIMIA/ ne contient que l'interface web : ses poids de modeles
    sont dans SIMIA-desktop/models/. Glisser SIMIA/ ne peut donc jamais envoyer
    les .gguf. Ce script assemble le dossier SIMIA complet, pret a etre glisse
    tel quel a la RACINE du serveur (il devient app.zigmoon.com/SIMIA/).

        pwsh -File tools/prepare-ftp.ps1

    Les fichiers de plus de 100 Mo sont relies par lien physique quand c'est
    possible : aucune copie, aucun espace disque supplementaire.

    Resultat : dist/SIMIA/  (~3 Go logiques)
#>

param(
    [string]$Web = (Join-Path $PSScriptRoot "..\..\SIMIA"),
    [string]$Models = (Join-Path $PSScriptRoot "..\models"),
    [string]$Out = (Join-Path $PSScriptRoot "..\dist\SIMIA")
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path (Join-Path $Web "index.html"))) {
    throw "Interface introuvable : $Web (attendu : index.html)"
}

if (Test-Path $Out) { Remove-Item $Out -Recurse -Force }
New-Item -ItemType Directory -Path $Out -Force | Out-Null

$linked = 0
$copied = 0

function Place {
    param([string]$Source, [string]$Target)

    $dir = Split-Path $Target -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

    if (Test-Path $Target) { Remove-Item $Target -Force }

    $size = (Get-Item $Source).Length
    if ($size -gt 100MB) {
        try {
            New-Item -ItemType HardLink -Path $Target -Target $Source -ErrorAction Stop | Out-Null
            $script:linked++
            return
        } catch {
            # Volume different : on copie.
        }
    }
    Copy-Item $Source $Target -Force
    $script:copied++
}

# 1. L'interface (racine SIMIA/, hors notes internes).
$skip = @("prepare-self-hosted-llama.ps1", "SELF_HOSTED_MODEL.md", "README.md")
Get-ChildItem $Web -File | Where-Object {
    $_.Extension -in ".html", ".js", ".css", ".json", ".webmanifest", ".svg", ".txt", ".xml", ".ico", ".php" -and
    $_.Name -notin $skip
} | ForEach-Object { Place $_.FullName (Join-Path $Out $_.Name) }

if (Test-Path (Join-Path $Web ".htaccess")) {
    Place (Join-Path $Web ".htaccess") (Join-Path $Out ".htaccess")
}

# 2. Icones et captures de l'application installee.
foreach ($folder in @("icons", "screenshots")) {
    $from = Join-Path $Web $folder
    if (-not (Test-Path $from)) { continue }
    Get-ChildItem $from -File | ForEach-Object { Place $_.FullName (Join-Path $Out "$folder\$($_.Name)") }
}

# 3. La page de presentation.
$landing = Join-Path $Web "desktop\index.html"
if (Test-Path $landing) { Place $landing (Join-Path $Out "desktop\index.html") }

# 4. Les modeles servis par le serveur (3 GGUF + LoRA + catalogues).
$modelFiles = @(
    "Qwen3.5-2B-Q4_K_M.gguf",
    "qwen2.5-1.5b-instruct-q4_k_m.gguf",
    "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
    "versions.json",
    "catalog.json",
    "image\loras\simia-gravure.safetensors"
)

$missing = @()
foreach ($relative in $modelFiles) {
    $source = Join-Path $Models $relative
    if (-not (Test-Path $source)) { $missing += $relative; continue }
    Place $source (Join-Path $Out "models\$relative")
}

$status = Join-Path $Web "models\hosting-status.json"
if (Test-Path $status) { Place $status (Join-Path $Out "models\hosting-status.json") }

if ($missing.Count) {
    Write-Warning ("Modeles absents en local : " + ($missing -join ", "))
}

$files = Get-ChildItem $Out -Recurse -File
$logical = ($files | Measure-Object Length -Sum).Sum

Write-Host ""
Write-Host "Dossier pret : $Out"
Write-Host ("  {0} fichiers  ·  {1:N2} Go a televerser" -f $files.Count, ($logical / 1GB))
Write-Host ("  {0} en lien physique (aucune copie), {1} copies" -f $linked, $copied)
foreach ($group in ($files | Group-Object { $_.Directory.FullName.Replace($Out, "").TrimStart("\") } | Sort-Object Name)) {
    $label = if ($group.Name) { $group.Name } else { "(racine)" }
    Write-Host ("  {0,-22} {1,3} fichiers  {2,8:N1} Mo" -f $label, $group.Count, (($group.Group | Measure-Object Length -Sum).Sum / 1MB))
}
Write-Host ""
Write-Host "Deposez le dossier SIMIA ENTIER a la racine du serveur :"
Write-Host "  app.zigmoon.com/  +  SIMIA/   ->   app.zigmoon.com/SIMIA/"
Write-Host ""
Write-Host "Le dossier est autonome : il remplace integralement la version en ligne."
Write-Host "Ne pas oublier de repasser en mode ASCII/binaire selon votre client :"
Write-Host "les .gguf et les PNG doivent partir en binaire, jamais en ASCII."
