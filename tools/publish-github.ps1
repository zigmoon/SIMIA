<#
.SYNOPSIS
    Envoie le depot sur GitHub et suit la compilation des trois systemes.

.DESCRIPTION
    Le depot ne peut pas etre cree par un script : GitHub exige une
    authentification interactive. Creez-le une fois a la main, puis lancez :

        powershell -NoProfile -File tools/publish-github.ps1

    Ce script :
      1. verifie que le depot distant existe reellement (l'API repond 200) ;
      2. pousse la branche main ;
      3. pose le tag v<version> et le pousse, ce qui declenche la release ;
      4. suit l'avancement des compilations Windows, macOS et Linux.

    Sans le tag, le workflow ne fait que compiler et garder des artefacts
    temporaires : aucun paquet n'est attaché a une release, donc les boutons
    macOS et Linux de la landing restent inactifs. C'est la raison d'etre du
    tag dans ce script.
#>

param(
    [string]$Repo = "zigmoon/SIMIA",
    [string]$Branch = "main",
    [switch]$NoTag,
    [switch]$Watch,
    [int]$TimeoutMinutes = 45
)

$ErrorActionPreference = "Stop"

function Write-Step($text) { Write-Host ""; Write-Host "== $text" -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host "   $text" -ForegroundColor Green }
function Write-Warn($text) { Write-Host "   $text" -ForegroundColor Yellow }
function Write-Err($text) { Write-Host "   $text" -ForegroundColor Red }

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# ---------------------------------------------------------------- verification

Write-Step "Etat du depot local"

$current = (& git rev-parse --abbrev-ref HEAD).Trim()
if ($current -ne $Branch) { Write-Err "branche courante : $current (attendu : $Branch)"; exit 1 }
Write-Ok "branche $Branch"

$dirty = (& git status --porcelain)
if ($dirty) {
    Write-Err "des modifications ne sont pas commitees :"
    $dirty | ForEach-Object { Write-Host "     $_" }
    exit 1
}
Write-Ok "arbre de travail propre"

$commitCount = (& git rev-list --count HEAD).Trim()
Write-Ok "$commitCount commits"

$remoteUrl = (& git remote get-url origin).Trim()
Write-Ok "origin = $remoteUrl"

Write-Step "Le depot distant existe-t-il ?"
$api = "https://api.github.com/repos/$Repo"
try {
    $response = Invoke-WebRequest -Uri $api -UseBasicParsing -TimeoutSec 20 -ErrorAction Stop
    $json = $response.Content | ConvertFrom-Json
    Write-Ok "$Repo existe (branche par defaut : $($json.default_branch))"
} catch {
    $status = $null
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    if ($status -eq 404) {
        Write-Err "le depot $Repo n'existe pas encore."
        Write-Host ""
        Write-Host "   Creez-le, une seule fois :" -ForegroundColor Yellow
        Write-Host "     1. https://github.com/new"
        Write-Host "     2. Repository name : SIMIA"
        Write-Host "     3. Owner : zigmoon"
        Write-Host "     4. Ne cochez NI README, NI .gitignore, NI licence (le depot doit etre vide)"
        Write-Host "     5. Create repository"
        Write-Host ""
        Write-Host "   Puis relancez ce script."
    } elseif ($status -eq 403) {
        Write-Warn "API GitHub limitee (403). On continue sans verification."
    } else {
        Write-Err "impossible de joindre l'API GitHub : $($_.Exception.Message)"
        exit 1
    }
    if ($status -eq 404) { exit 1 }
}

# ---------------------------------------------------------------------- version

$version = "0.1.0"
$cargo = Join-Path $root "launcher\Cargo.toml"
if (Test-Path $cargo) {
    $line = Select-String -Path $cargo -Pattern '^version\s*=' | Select-Object -First 1
    if ($line) { $version = ($line.Line -split '=', 2)[1].Trim().Trim('"') }
}
$tag = "v$version"

# ------------------------------------------------------------------------ push

Write-Step "Envoi de la branche $Branch"
Write-Host "   Git Credential Manager va ouvrir une fenetre de connexion GitHub." -ForegroundColor Yellow
$pushOutput = & git push -u origin $Branch 2>&1
$pushOutput | ForEach-Object { Write-Host "   $_" }

if ($LASTEXITCODE -ne 0) {
    $text = ($pushOutput -join "`n")
    if ($text -match 'rejected|non-fast-forward|fetch first') {
        Write-Host ""
        Write-Err "le depot distant contient deja des commits."
        Write-Host ""
        Write-Host "   C'est le cas quand le depot a ete cree avec un README, un .gitignore" -ForegroundColor Yellow
        Write-Host "   ou une licence. Deux solutions :" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "   a) le plus propre : supprimer le depot sur GitHub et le recreer VIDE"
        Write-Host "      (aucune case cochee), puis relancer ce script ;"
        Write-Host ""
        Write-Host "   b) garder le README et forcer l'envoi de notre historique :"
        Write-Host "      git push -u --force-with-lease origin $Branch" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "   L'option b ecrase l'historique distant. Sans importance ici : le" -ForegroundColor DarkGray
        Write-Host "   depot vient d'etre cree et ne contient qu'un commit initial." -ForegroundColor DarkGray
        exit 1
    }
    Write-Err "le push a echoue (authentification refusee ou reseau)."
    Write-Host "   Verifiez que vous etes bien connecte au compte proprietaire de $Repo." -ForegroundColor Yellow
    exit 1
}
Write-Ok "branche envoyee"

if (-not $NoTag) {
    Write-Step "Tag $tag"
    $existing = & git tag --list $tag
    if ($existing) {
        Write-Ok "le tag $tag existe deja en local"
    } else {
        & git tag -a $tag -m "SIMIA $version"
        if ($LASTEXITCODE -ne 0) { Write-Err "creation du tag impossible"; exit 1 }
        Write-Ok "tag $tag cree sur $(git rev-parse --short HEAD)"
    }
    $remoteTag = (& git ls-remote --tags origin $tag)
    if ($remoteTag) {
        Write-Ok "le tag est deja sur le serveur"
    } else {
        & git push origin $tag
        if ($LASTEXITCODE -ne 0) { Write-Err "envoi du tag impossible"; exit 1 }
        Write-Ok "tag envoye : la release va se creer"
    }
}

# --------------------------------------------------------------------- suivi

$runsUrl = "https://api.github.com/repos/$Repo/actions/runs?per_page=5"

Write-Step "Compilations"
if (-not $Watch) {
    Write-Host "   Suivi : https://github.com/$Repo/actions"
    Write-Host "   Releases : https://github.com/$Repo/releases"
    Write-Host ""
    Write-Host "   Relancez avec -Watch pour suivre ici jusqu'au bout." -ForegroundColor Yellow
    exit 0
}

$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
$seen = @{}
$last = ""
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 20
    try {
        $runs = (Invoke-WebRequest -Uri $runsUrl -UseBasicParsing -TimeoutSec 20).Content | ConvertFrom-Json
    } catch {
        Write-Warn "API indisponible (depot prive sans jeton ?). Suivez sur github.com/$Repo/actions"
        exit 0
    }
    if (-not $runs.workflow_runs -or $runs.workflow_runs.Count -eq 0) { continue }

    $lines = @()
    $pending = 0
    foreach ($run in $runs.workflow_runs) {
        if ($run.created_at -lt (Get-Date).AddMinutes(-$TimeoutMinutes)) { continue }
        $state = if ($run.status -eq "completed") { $run.conclusion } else { $run.status }
        $lines += ("   {0,-34} {1}" -f $run.name, $state)
        if ($run.status -ne "completed") { $pending++ }
    }
    $text = ($lines -join "`n")
    if ($text -ne $last) { Write-Host $text; $last = $text }

    if ($pending -eq 0 -and $lines.Count -gt 0) {
        Write-Host ""
        $failed = $runs.workflow_runs | Where-Object { $_.conclusion -eq "failure" }
        if ($failed) {
            Write-Err "au moins une compilation a echoue :"
            $failed | ForEach-Object { Write-Host "     $($_.html_url)" }
            exit 1
        }
        Write-Ok "toutes les compilations sont terminees"
        Write-Host ""
        Write-Host "   Paquets : https://github.com/$Repo/releases/latest"
        Write-Host ""
        Write-Host "   Les boutons macOS et Linux de la landing s'activeront seuls :" -ForegroundColor Yellow
        Write-Host "   elle interroge l'API GitHub et bascule des qu'une release a des paquets."
        exit 0
    }
    Write-Host "   ... $pending compilation(s) en cours" -ForegroundColor DarkGray
}

Write-Warn "delai de $TimeoutMinutes minutes depasse. Suivez sur github.com/$Repo/actions"
exit 0
