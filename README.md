<div align="center">

<img src="web/icon.svg" width="84" height="84" alt="SIMIA, assistant IA local" />

# SIMIA

**Assistant IA local, privé et hors ligne — Windows, macOS et Linux**

Conversation, génération d'images et atelier de code dans une seule interface,
exécutés sur votre propre machine. Pas de compte, pas de clé API, pas de serveur :
vos phrases ne quittent pas l'ordinateur.

**La version bureau est la version complète** : elle fait tourner des modèles
jusqu'à 9,7 Go, génère des images jusqu'à 1024 px, et accepte n'importe quel
`.gguf` supplémentaire déposé dans son dossier `models/`. La version web, dans le
navigateur, s'arrête à 1,9 Go par modèle et sert surtout à essayer.

[![Dernière version](https://img.shields.io/github/v/release/zigmoon/SIMIA?style=flat-square&label=version&color=4c6b1f)](https://github.com/zigmoon/SIMIA/releases/latest)
[![Compilation Windows, macOS, Linux](https://github.com/zigmoon/SIMIA/actions/workflows/build.yml/badge.svg)](https://github.com/zigmoon/SIMIA/actions/workflows/build.yml)
[![Windows | macOS | Linux](https://img.shields.io/badge/Windows%20%7C%20macOS%20%7C%20Linux-x64%20%26%20arm64-4c6b1f?style=flat-square)](#télécharger)

[**Télécharger**](#télécharger) · [**Essayer dans le navigateur**](https://app.zigmoon.com/SIMIA/app/) · [**Site officiel**](https://app.zigmoon.com/SIMIA/) · [**Modèles**](#les-modèles)

</div>

---

## Sommaire

- [Qu'est-ce que SIMIA ?](#quest-ce-que-simia)
- [Ce que SIMIA sait faire](#ce-que-simia-sait-faire)
- [Confidentialité](#confidentialité)
- [Télécharger](#télécharger)
- [La version web, installable](#la-version-web-installable)
- [Versions publiées](#versions-publiées)
- [Les modèles](#les-modèles)
- [Architecture](#architecture)
- [Utilisation](#utilisation)
- [Ajouter un modèle](#ajouter-un-modèle)
- [Questions fréquentes](#questions-fréquentes)
- [Licence et mentions légales](#licence-et-mentions-légales)

## Qu'est-ce que SIMIA

**SIMIA est un espace de travail IA qui tourne entièrement en local.** Trois
outils réunis dans une seule page : une conversation avec un modèle de langage,
un générateur d'images Stable Diffusion, et un atelier de code capable
d'exécuter le JavaScript et le Python que l'assistant écrit.

Rien n'est envoyé à un serveur. Ni compte, ni clé API, ni abonnement, ni limite de
messages : les poids des modèles sont téléchargés une fois depuis un CDN, puis
l'inférence se fait sur le processeur graphique de la machine. Le réseau peut être
coupé, SIMIA continue de répondre.

Le même code d'interface sert les deux versions ; seule l'exécution diffère :

| | Version bureau | Version web |
|---|---|---|
| Moteur | `llama.cpp` et `stable-diffusion.cpp` en natif (Vulkan, D3D12, Metal, CPU) | WebGPU, via WebLLM, dans l'onglet |
| Systèmes | Windows 10/11, macOS 13.3+ (Intel et Apple Silicon), Linux x86_64 | Chrome et Edge avec WebGPU |
| Modèles de texte | tout le catalogue, jusqu'à 9,7 Go | uniquement sous **1,9 Go** (mémoire du navigateur) |
| Génération d'images | 7 packs, jusqu'à 1024 px, aucun filtre de contenu | — |
| Installation | archive à décompresser, aucun installateur | un clic dans le navigateur (PWA) |
| Stockage | disque, à côté de l'exécutable | cache du navigateur |

**La version bureau est la version complète.** Le navigateur impose un plafond
de mémoire difficile à contourner : la version web se limite aux modèles sous
1,9 Go, et ne sait pas générer d'images. Sur le poste, `llama.cpp` pilote
directement le GPU sans plafond de ce genre :

- **Tout le catalogue, y compris les gros modèles.** La version web s'arrête aux
  modèles 1B à 2B ; la version bureau fait tourner des modèles de 7, 14 ou 32
  milliards de paramètres, soit jusqu'à 9,7 Go de poids pour un seul fichier.
- **Génération d'images.** Stable Diffusion en natif, sept packs de 512 à
  1024 px, sans passer par le réseau.
- **Vos propres fichiers `.gguf`.** Le dossier `models/` de l'application est un
  dossier ordinaire : déposer n'importe quel fichier GGUF compatible llama.cpp
  suffit à le voir apparaître dans le sélecteur de modèles, y compris des modèles
  non listés dans le catalogue. Voir [Ajouter un modèle](#ajouter-un-modèle).

La version web reste le moyen le plus rapide d'essayer : rien à installer, elle
tient dans un onglet. Pour un usage quotidien, c'est le bureau qui donne toute la
mesure de SIMIA.

La version web s'installe : icône sur le bureau ou l'écran d'accueil, fenêtre
sans barre d'adresse, et interface disponible même sans réseau. C'est le même
code que l'onglet, mis en cache par un service worker.

## Ce que SIMIA sait faire

| Fonction | Détail | Web | Bureau |
|---|---|:--:|:--:|
| Conversation | modèle de langage local, réponse en flux, historique, export JSON | ✅ | ✅ |
| Choix du modèle | plus de 30 modèles de texte, filtrés par usage (généraliste, documents, code, raisonnement, vision) | ✅ | ✅ |
| Lecture de documents | PDF, Word, OpenDocument, CSV, texte ; citations dans la réponse | ✅ | ✅ |
| Génération d'images | Stable Diffusion local, 512 et 1024 px, style maison « Gravure SIMIA » | — | ✅ |
| Atelier de code | éditeur, exécution JavaScript et Python dans un Worker isolé, relecture par l'IA | ✅ | ✅ |
| Agent web | recherche assistée, récupération de pages, synthèse sourcée | ✅ | — |
| Dictée vocale | saisie au micro, reconnaissance dans le navigateur | ✅ | ✅ |
| Quatre langues | français, anglais, espagnol, japonais | ✅ | ✅ |
| Installation | application installable depuis le navigateur (icône, fenêtre propre, hors ligne) | ✅ | — |
| Hors ligne | après le premier téléchargement des poids, aucune connexion requise | ✅ | ✅ |

> L'agent web s'appuie sur un relais PHP (`agent-api.php`) déployé sur le site.
> La version bureau sert l'interface localement et n'a pas ce relais : le bouton
> correspondant n'y est pas affiché, plutôt que d'échouer à chaque clic.

## Confidentialité

- **Aucun compte.** Pas d'e-mail, pas de mot de passe, pas de profil.
- **Aucune télémétrie.** SIMIA n'envoie ni usage, ni erreur, ni identifiant.
- **Aucun serveur d'inférence.** Le modèle tourne sur votre GPU ; le trafic réseau
  se limite au téléchargement des poids depuis le CDN et aux pages que vous
  demandez explicitement à l'agent web.
- **Stockage local.** Les conversations restent dans le navigateur ou sur le
  disque, et s'exportent en JSON quand vous voulez.

## Télécharger

Les archives sont compilées par GitHub Actions à chaque étiquette `v*` et
publiées dans [Releases](https://github.com/zigmoon/SIMIA/releases). Le lien
`latest` pointe toujours sur la version la plus récente.

| Système | Matériel | Archive |
|---|---|---|
| Windows | x86_64 | [simia-windows-x64.zip](https://github.com/zigmoon/SIMIA/releases/latest/download/simia-windows-x64.zip) |
| macOS | Apple Silicon (M1 et plus) | [simia-macos-arm64.tar.gz](https://github.com/zigmoon/SIMIA/releases/latest/download/simia-macos-arm64.tar.gz) |
| macOS | Intel | [simia-macos-x64.tar.gz](https://github.com/zigmoon/SIMIA/releases/latest/download/simia-macos-x64.tar.gz) |
| Linux | x86_64 | [simia-linux-x64.tar.gz](https://github.com/zigmoon/SIMIA/releases/latest/download/simia-linux-x64.tar.gz) |

Décompressez l'archive, puis lancez `simia-desktop` (ou `simia-desktop.exe`).
Les moteurs et l'interface sont inclus ; les poids des modèles se téléchargent
depuis l'application, au premier choix. Sur macOS et Linux, rendez le fichier
exécutable si l'archive a perdu le droit : `chmod +x simia-desktop`.

Sur Windows, le runtime Visual C++ est joint aux moteurs : rien à installer, et
aucun droit administrateur.

Les exigences ci-dessous ne sont pas des recommandations mais le résultat de ce
que les binaires déclarent, relevé dans leurs en-têtes (`minos` pour Mach-O,
symboles `GLIBC_*` pour ELF). Les moteurs viennent de l'amont et ne peuvent pas
être recompilés ici.

| Système | Conversation et code | Génération d'images |
|---|---|---|
| Windows 10/11 | ✔ | ✔ |
| macOS Apple Silicon | 13.3 (Ventura) et plus | **macOS 26** et plus |
| macOS Intel | 13.3 (Ventura) et plus | — aucun binaire amont |
| Linux x86_64 | glibc 2.34 → Ubuntu 22.04 et plus | **glibc 2.43 → Ubuntu 26.04** et plus |

La conversation et l'atelier de code fonctionnent donc dès macOS 13.3 et Ubuntu
22.04. La génération d'images est plus exigeante : le `sd-server` publié par
stable-diffusion.cpp est compilé pour macOS 26 et Ubuntu 26.04, et macOS refuse
de charger un binaire dont le `minos` est supérieur au système. Sur une machine
plus ancienne, le bouton **Image** reste présent mais le moteur ne démarre pas ;
la conversation n'est pas affectée.

> **macOS** : le binaire n'est pas signé, Gatekeeper le met en quarantaine.
> `xattr -dr com.apple.quarantine simia-macos-arm64/` puis relancez.
> **Windows** : SmartScreen affiche un avertissement à la première ouverture,
> faute de signature de code.

## La version web, installable

Rien à télécharger : [app.zigmoon.com/SIMIA](https://app.zigmoon.com/SIMIA/)
s'installe depuis le navigateur. Un bouton **Installer SIMIA** apparaît dans la
barre latérale (menu sur mobile) dès que le navigateur sait le proposer.

| Étape | Chrome / Edge (ordinateur et Android) | Safari (iOS et iPadOS) |
|---|---|---|
| 1 | Cliquer sur **Installer SIMIA** | Ouvrir la page dans Safari |
| 2 | Confirmer dans la fenêtre du navigateur | Partager → **Sur l'écran d'accueil** |
| 3 | L'icône rejoint le bureau ou le lanceur | L'icône rejoint l'écran d'accueil |

Une fois installée, SIMIA s'ouvre dans sa propre fenêtre, sans barre d'adresse,
et démarre instantanément : l'interface est dans un cache local. Le réseau ne
sert plus qu'à télécharger un modèle.

Ce que le service worker garde en mémoire, et ce qu'il refuse :

| Requête | Traitement |
|---|---|
| Interface (`index.html`, `app.js`, `styles.css`, icônes) | précachée à l'installation, servie immédiatement |
| Navigation | réseau d'abord (4 s), puis cache, puis page `offline.html` |
| `/models/`, `.gguf`, `.safetensors` | jamais mis en cache (plusieurs gigaoctets) |
| Points d'entrée `.php`, CDN HuggingFace | laissés passer, sans interception |

Les ressources tierces (polices d'affichage, visionneuse 3D, liste des versions
GitHub) ne sont chargées qu'après un accord explicite dans la boîte de
consentement : elles portent `data-consent-href` / `data-consent-src` et restent
inertes tant que le visiteur n'a pas répondu. Refuser laisse l'application
entièrement fonctionnelle.

Quand une nouvelle version est publiée, un bandeau discret propose de recharger :
le nouveau service worker attend sagement, plutôt que de recharger la page au
milieu d'une conversation. Voir
[docs/PUBLICATION.md](docs/PUBLICATION.md#lapplication-installable-pwa) pour la
procédure d'upload, y compris le `.htaccess` qui déclare les types MIME
(`application/manifest+json`) sans lesquels Chrome refuse l'installation.

## Versions publiées

<!-- versions:start -->
| Version | Date | Windows | macOS ARM | macOS Intel | Linux |
|---|---|---|---|---|---|
| [v0.1.2](https://github.com/zigmoon/SIMIA/releases/tag/v0.1.2) | 2026-11-16 | [zip 77 Mo](https://github.com/zigmoon/SIMIA/releases/download/v0.1.2/simia-windows-x64.zip) | [tar.gz 72 Mo](https://github.com/zigmoon/SIMIA/releases/download/v0.1.2/simia-macos-arm64.tar.gz) | [tar.gz 31 Mo](https://github.com/zigmoon/SIMIA/releases/download/v0.1.2/simia-macos-x64.tar.gz) | [tar.gz 82 Mo](https://github.com/zigmoon/SIMIA/releases/download/v0.1.2/simia-linux-x64.tar.gz) |
| [v0.1.1](https://github.com/zigmoon/SIMIA/releases/tag/v0.1.1) | 2026-11-16 | [zip 77 Mo](https://github.com/zigmoon/SIMIA/releases/download/v0.1.1/simia-windows-x64.zip) | [tar.gz 72 Mo](https://github.com/zigmoon/SIMIA/releases/download/v0.1.1/simia-macos-arm64.tar.gz) | [tar.gz 31 Mo](https://github.com/zigmoon/SIMIA/releases/download/v0.1.1/simia-macos-x64.tar.gz) | [tar.gz 82 Mo](https://github.com/zigmoon/SIMIA/releases/download/v0.1.1/simia-linux-x64.tar.gz) |
| [v0.1.0](https://github.com/zigmoon/SIMIA/releases/tag/v0.1.0) | 2026-11-16 | [zip 76 Mo](https://github.com/zigmoon/SIMIA/releases/download/v0.1.0/simia-windows-x64.zip) | [tar.gz 72 Mo](https://github.com/zigmoon/SIMIA/releases/download/v0.1.0/simia-macos-arm64.tar.gz) | [tar.gz 31 Mo](https://github.com/zigmoon/SIMIA/releases/download/v0.1.0/simia-macos-x64.tar.gz) | [tar.gz 82 Mo](https://github.com/zigmoon/SIMIA/releases/download/v0.1.0/simia-linux-x64.tar.gz) |
<!-- versions:end -->

Le tableau ci-dessus est régénéré automatiquement par le workflow à chaque
étiquette, et la page [Releases](https://github.com/zigmoon/SIMIA/releases)
reste la source de vérité. La version web, elle, n'a pas de numéro : elle est
servie directement depuis la branche `main`.

## Les modèles

Deux catalogues, tous deux en JSON, versionnés dans le dépôt :

| Fichier | Contenu |
|---|---|
| [models/catalog.json](models/catalog.json) | modèle de texte : identifiant, taille, quantification, licence, URL du CDN, gabarit de prompt |
| [models/image/catalog.json](models/image/catalog.json) | packs d'images : fichiers, résolution, pas de diffusion, LoRA de style |

Les packs d'images mesurés sur une RTX 2060 6 Go, à chaud :

| Pack | Taille | Résolution | Temps / image | Licence |
|---|---|---|---|---|
| SDXS 512 | 651 Mo | 512 px | 0,3 s | Apache-2.0 |
| SD-Turbo Q4 | 1,72 Go | 512 px | 1,2 s | Stability Community |
| SD 1.5 Q4 | 1,46 Go | 512 px | ~2 s | CreativeML OpenRAIL-M |
| **Gravure SIMIA** | 1,46 Go + LoRA 6 Mo | 512 px | ~2 s | CreativeML OpenRAIL-M |
| SDXL Turbo | 3,67 Go | 1024 px | 6,1 s (15 s à froid) | Stability Community |
| SDXL base | 3,67 Go | 1024 px | 57,3 s | CreativeML OpenRAIL++-M |
| Z-Image Turbo | 5,57 Go | 1024 px | 37,5 s | Apache-2.0 |

**Gravure SIMIA** est un LoRA entraîné sur cette machine à partir de 32 planches
botaniques du domaine public (*Curtis's Botanical Magazine*, *Edwards's Botanical
Register*). Il se pose sur SD 1.5 et donne au modèle un trait de gravure au
burin. La chaîne d'entraînement complète est dans [tools/lora/](tools/lora/).

Aucun filtre de contenu n'est appliqué côté SIMIA : ce que le modèle accepte de
dessiner, SIMIA le dessine. Les licences ci-dessus, elles, continuent de
s'appliquer à l'usage des images produites.

## Architecture

L'application de bureau n'est pas une réécriture : c'est la même interface que le
site, servie localement, avec l'inférence exécutée en natif par `llama.cpp`
(Vulkan / D3D12 sur Windows, Metal sur macOS, Vulkan sur Linux, repli CPU
automatique).

### Pourquoi cette architecture

Le site SIMIA exécute les modèles dans le navigateur via WebGPU. En natif, le même
`app.js` continue de fonctionner : le lanceur injecte `window.__SIMIA_NATIVE__`
et `app.js` bascule alors sur l'API locale au lieu de WebLLM. Aucune duplication
d'interface, un seul code source pour le web et le bureau.

```
┌─ Fenêtre applicative (Chrome/Edge --app) ───────────┐
│  SIMIA/index.html + app.js + styles.css (inchangés) │
└───────────────────────┬─────────────────────────────┘
                        │ fetch /v1/... (même origine)
┌───────────────────────▼─────────────────────────────┐
│  simia-desktop (Rust, ~0,6 Mo)                      │
│   • sert l'interface sur 127.0.0.1:8170             │
│   • injecte /_simia/native.js dans index.html       │
│   • relaie /v1/* vers llama-server                  │
│   • supervise le cycle de vie de llama-server       │
└───────────────────────┬─────────────────────────────┘
                        │ HTTP local
┌───────────────────────▼─────────────────────────────┐
│  llama-server (llama.cpp) — GPU via Vulkan          │
└─────────────────────────────────────────────────────┘
```

## Contenu

```
SIMIA-desktop/
├── launcher/                       code Rust du lanceur
├── web/                            l'application, copie de ../SIMIA (tools/sync-web.ps1)
│   ├── icons/                      icônes PWA 192, 512, maskable, Apple
│   ├── screenshots/                captures de la boîte d'installation
│   ├── manifest.webmanifest        nom, icônes, raccourcis, mode standalone
│   ├── service-worker.js           cache hors ligne et mises à jour
│   └── offline.html                page de repli sans réseau
├── deploy/                         le site public, tel quel à la racine du serveur
│   ├── index.html                  landing (celle de app.zigmoon.com/SIMIA/)
│   ├── service-worker.js           désinscrit l'ancienne PWA installée à la racine
│   ├── .htaccess                   types MIME, cache, redirection /desktop/
│   ├── robots.txt, sitemap.xml     indexation
│   ├── *.php                       agent web, recherche, lecture d'URL
│   └── downloads/                  paquets à télécharger + manifest.json
├── packaging/LISEZ-MOI.txt         fichier livré dans chaque archive
├── runtime/msvc-x64/               runtime VC++ embarqué dans le paquet Windows
├── dist/SIMIA/                     dossier prêt à téléverser (tools/prepare-ftp.ps1)
├── .github/workflows/build.yml     CI Windows / macOS / Linux
├── vendor/llama/win-vulkan/        llama.cpp + DLL Vulkan (local, non versionné)
├── vendor/sd/win-vulkan/           stable-diffusion.cpp (sd-server) + DLL
├── models/*.gguf                   poids des modèles de texte
├── models/image/                   packs d'images + catalog.json
├── models/image/loras/             LoRA de style (simia-gravure.safetensors)
└── tools/lora/                     chaîne d'entraînement du LoRA
```

Le site publié réunit les deux dossiers : `deploy/` donne la racine, `web/`
donne `app/`. C'est exactement ce que produit `tools/prepare-ftp.ps1`.

```
app.zigmoon.com/SIMIA/
├── index.html          ← deploy/index.html      la landing
├── app/                ← web/                   l'application installable
├── models/             ← models/ (versions.json) 3 GGUF + le LoRA
└── downloads/          ← deploy/downloads/      paquets Windows, macOS, Linux
```

## Utilisation

```powershell
cd SIMIA-desktop
.\launcher\target\release\simia-desktop.exe
```

Options :

| Option | Rôle |
|---|---|
| `--web <dossier>` | dossier de l'interface (sinon détection automatique : `SIMIA/` voisin) |
| `--model <fichier.gguf>` | modèle à charger (sinon premier GGUF trouvé dans `models/`) |
| `--llama-server <chemin>` | binaire llama-server |
| `--port <port>` | port de l'interface (défaut : 8170, fixe pour conserver les conversations) |
| `--ctx <tokens>` | taille du contexte du modèle (défaut : 8192, minimum 2048) |
| `--sd-server <chemin>` | binaire `sd-server` du générateur d'images |
| `--image-port <port>` | port du générateur d'images (défaut : port llama + 1) |
| `--image-size <pixels>` | largeur et hauteur de l'image (défaut : 1024) |
| `--image-steps <n>` | pas de diffusion (défaut : 8, valeur distillée de Z-Image-Turbo) |
| `--no-browser` | ne pas ouvrir de fenêtre |

## Compilation du lanceur

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
cd launcher
cargo build --release            # toolchain MSVC si installée
cargo +stable-x86_64-pc-windows-gnu build --release   # sinon toolchain GNU
```

Aucune dépendance C/C++ : le lanceur compile sans Visual Studio Build Tools.
Seule dépendance : `tiny_http`.

## Publication multi-plateformes (GitHub Actions)

Le dépôt est prévu pour être la racine d'un dépôt GitHub
(`github.com/zigmoon/SIMIA`). L'interface est versionnée dans `web/` : c'est une
copie de `../SIMIA`, à rafraîchir avant chaque commit.

```powershell
powershell -NoProfile -File tools\sync-web.ps1   # copie ../SIMIA -> web/
git add -A && git commit -m "…" && git tag v1.0.0 && git push --tags
```

Le workflow [.github/workflows/build.yml](.github/workflows/build.yml) compile le
lanceur avec la toolchain native de chaque runner (MSVC sur Windows, donc pas de
contrainte GNU comme en local) et récupère les moteurs depuis les releases
officielles :

| Cible | llama.cpp | stable-diffusion.cpp | Archive |
|---|---|---|---|
| `windows-x64` | win-vulkan-x64 | win-vulkan-x64 | `simia-windows-x64.zip` |
| `macos-arm64` | macos-arm64 | Darwin arm64 | `simia-macos-arm64.tar.gz` |
| `macos-x64` | macos-x64 | **aucun binaire** | `simia-macos-x64.tar.gz` |
| `linux-x64` | ubuntu-vulkan-x64 | Ubuntu x86_64 vulkan | `simia-linux-x64.tar.gz` |

Sur macOS Intel, la génération d'images est simplement masquée : le bouton
**Image** n'apparaît pas tant que `sd-server` est absent, sans erreur.

Chaque paquet contient `simia-desktop`, `web/`, `vendor/`, `models/*.json`,
`models/image/loras/` et `LISEZ-MOI.txt`. Les poids ne sont pas inclus : le
catalogue pointe vers le CDN. Sur Windows, le runtime VC++ est joint aux
moteurs, donc rien à installer.

Le corps de la release n'est pas laissé au « Full Changelog » automatique de
GitHub : [tools/release-body.mjs](tools/release-body.mjs) le rédige à partir des
archives réellement présentes dans `dist/` — tableau des systèmes avec la taille
exacte, instructions d'installation par OS, empreintes SHA-256, et mention des
cibles qui ont échoué. Une archive manquante est signalée au lieu de disparaître
silencieusement du tableau.

## Ce que l'interface affiche

Le moteur d'image est distinct du modèle de texte, donc il est visible à deux
endroits — et **pas** dans la barre de saisie, où il encombrait :

| Emplacement | Affichage |
|---|---|
| Barre du haut | pastille compacte : icône image + nom court (`Gravure SIMIA`), infobulle avec le nom complet, la résolution et les pas |
| Paramètres | bloc **MOTEUR D'IMAGE** : nom complet, résolution, pas et description |
| Légende d'une image générée | `SD 1.5 · Gravure SIMIA · 512×512 · 24 pas` |

Le nom court se déduit du libellé du pack : `SD 1.5 · Gravure SIMIA` devient
`Gravure SIMIA`, `Stable Diffusion 1.5` devient `SD 1.5`. La pastille reprend la
palette du site (neutres + vert accent), pas une couleur propre.

En dessous de 560 px de large, seule l'icône reste visible : le nom serait
illisible, l'infobulle et `aria-label` portent l'information.

La pastille et le bloc des paramètres ouvrent directement la bibliothèque sur
l'onglet **Image**. En version web, tout cela reste masqué : il n'y a pas de
moteur d'image dans un navigateur.

Pour ajouter un jeu d'images, voir [models/image/catalog.json](models/image/catalog.json).

## Première publication sur GitHub

1. Sur github.com, créer un dépôt **vide** nommé `SIMIA` sous le compte `zigmoon` :
   ni README, ni `.gitignore`, ni licence (ils entreraient en conflit avec ce qui
   est déjà prêt ici).
2. Depuis `SIMIA-desktop` :

```powershell
# pousse la branche main ; Git Credential Manager demande la connexion une fois
git push -u origin main

# puis, pour déclencher la compilation des 4 paquets et créer la release :
powershell -NoProfile -File tools\publish.ps1 -Tag v0.9.0
```

`publish.ps1` enchaîne : synchronisation de `web/`, commit si nécessaire, push,
tag annoté et push du tag. Le workflow démarre alors et dépose les archives dans
l'onglet **Releases** (`https://github.com/zigmoon/SIMIA/releases`).

Pour une simple mise à jour de code, sans nouvelle version :

```powershell
powershell -NoProfile -File tools\publish.ps1 -Message "Corrige le libelle du modele"
```

## Développement de l'interface

Il y a **deux copies** de l'interface, et c'est volontaire :

| Chemin | Rôle |
|---|---|
| `../SIMIA/` | source de travail, c'est ce qu'on modifie |
| `SIMIA-desktop/web/` | copie versionnée, **c'est elle que le lanceur sert** |

Le lanceur cherche `index.html` en remontant l'arborescence depuis l'exécutable
et s'arrête sur le premier dossier `web/` trouvé. Depuis que
`SIMIA-desktop/web/` existe (nécessaire au CI), c'est **lui** qui est servi en
local, plus `../SIMIA/`.

Conséquence pratique : après toute modification de l'interface, lancer

```powershell
powershell -NoProfile -File tools\sync-web.ps1
```

sinon l'application semble ne pas avoir changé. C'est exactement ce qui se
produit si un badge ou un bouton n'apparaît pas après édition.

## Ajouter un modèle

C'est la différence de fond entre les deux versions : sur le bureau, le dossier
`models/` de l'application est un dossier ordinaire, sans liste blanche. Tout
fichier GGUF compatible `llama.cpp` y déposé est utilisable, y compris des
modèles bien plus gros que ce que le navigateur accepte.

1. Déposer un fichier `.gguf` dans `models/`.
2. Relancer. Il apparaît dans la bibliothèque avec son nom et sa quantification
   extraits du nom de fichier (`Qwen3.5-2B-Q4_K_M.gguf` → « Qwen3.5 2B »,
   « ~1.2 GB (Q4_K_M) »).

Aucune limite de taille imposée par SIMIA : c'est la mémoire vidéo de la machine
qui décide. Un modèle 14B en Q4 (~8,4 Go) tient sur une carte de 12 Go ; un 32B
en Q4 (~19 Go) demande une carte de 24 Go ou un repli processeur, lent mais
fonctionnel. Les fichiers déjà présents dans le dossier sont reconnus au
démarrage, il n'y a pas de réimport à faire.

Pour un modèle très volumineux, il vaut mieux télécharger le `.gguf` à la main
depuis Hugging Face que par l'interface : la reprise d'un téléchargement
interrompu y est plus fiable.

## Ajouter un style (LoRA)

Un pack d'images peut déclarer un LoRA de style dans
[models/image/catalog.json](models/image/catalog.json) :

```json
{
  "id": "sd15-simia",
  "model": "sd15/stable-diffusion-v1-5-pruned-emaonly-Q4_0.gguf",
  "lora": "simia-gravure.safetensors",
  "loraWeight": 0.8,
  "loraUrl": "https://…/loras/simia-gravure.safetensors"
}
```

Le fichier va dans `models/image/loras/`. Le lanceur démarre alors `sd-server`
avec `--lora-model-dir` et ajoute le style à chaque requête de génération.

Attention, deux pièges de l'API `sd-server` : le champ de pondération s'appelle
`multiplier` et non `weight`, et les balises `<lora:...>` écrites dans le prompt
sont ignorées volontairement. La pondération est donc injectée par le lanceur,
jamais par `app.js`.

Pour entraîner votre propre style, voir [tools/lora/README.md](tools/lora/README.md).

## Points d'attention

- **Runtime VC++** : les binaires officiels de `llama.cpp` et de
  `stable-diffusion.cpp` sont compilés avec MSVC et importent
  `vcruntime140.dll`, `vcruntime140_1.dll`, `msvcp140.dll` et
  `msvcp140_codecvt_ids.dll` — `simia-desktop.exe` lui-même importe la
  première. Depuis la version b12413, l'archive Windows de `llama.cpp` ne les
  contient plus : elles sont donc versionnées dans
  [runtime/msvc-x64/](runtime/msvc-x64/) (redistribution app-local autorisée
  par Microsoft) et copiées dans les deux dossiers de moteurs par la CI. Le
  paquet reste ainsi autonome, sans redistribuable à installer.
- **Modèles à raisonnement** (Qwen 3.x) : sans réglage, la réponse part dans
  `reasoning_content` et `content` reste vide. `app.js` envoie donc
  `chat_template_kwargs: { enable_thinking: false }`.
- **Service worker** : actif sur le site, désactivé en mode bureau — le lanceur
  sert un worker inerte qui s'enregistre puis se désinscrit. Sans cela, il
  servirait une ancienne version de `app.js` après une mise à jour, alors que le
  fichier est déjà local. Conséquence : pas de bandeau « nouvelle version » ni de
  bouton d'installation dans l'application de bureau, ce qui est logique.
- **Fichiers `.htaccess` et dossiers `icons/`** : à envoyer avec l'interface.
  Sans `.htaccess`, Apache sert `manifest.webmanifest` en
  `application/octet-stream`, et Chrome refuse l'installation ; sans les icônes,
  le manifeste est invalide. `tools/sync-web.ps1` les copie dans `web/`.
- **Port fixe** : `localStorage` est lié à l'origine. Changer de port perd les
  conversations locales.
- **Contexte** : `--ctx` fixe la fenêtre du modèle (8 192 tokens par défaut, un
  seul slot pour ne pas gaspiller la VRAM). La page lit la valeur via
  `window.__SIMIA_NATIVE__.ctxSize` et en déduit la taille de code envoyée au
  modèle depuis l'atelier.
- **Exécution de code** : `SIMIA/code-runner.js` doit accompagner `app.js`.
  C'est un Worker dédié : il a sa propre politique de sécurité, alors que la page
  interdit `'unsafe-eval'`. Sans ce fichier, seul le bouton ▶ échoue. Corollaire
  pour le déploiement web : ne pas envoyer de CSP par en-tête HTTP sur les `.js`
  (la CSP de SIMIA est dans un `<meta>` de `index.html`). Un en-tête global
  s'appliquerait au worker et bloquerait l'exécution du JavaScript collé.
- **Génération d'images** : `vendor/sd/<plateforme>/sd-server`
  (stable-diffusion.cpp) + les jeux de fichiers déclarés dans
  `models/image/catalog.json`. Quatre packs sont fournis : SD-Turbo Q4 (1,72 Go,
  512 px, 4 pas, ~1,2 s), SDXS 512 (651 Mo, 1 pas, ~0,3 s), SD 1.5 Q4 (1,46 Go,
  20 pas, ~2 s) et Z-Image Turbo (5,57 Go, 1024 px, 8 pas, ~37 s) — mesures à
  chaud sur RTX 2060 6 Go. Ils sont visibles dans la bibliothèque, onglet
  **Image** ; les trois premiers se téléchargent depuis l'application. Sans
  aucun pack complet, le bouton **Image** reste masqué.
- **Sous 2 Go, seules les architectures CLIP intégré passent** : SD 1.5, SD 2.1
  et leurs distillations. Tous les modèles 2026 (FLUX.2-klein, SeFi-Image,
  Iris-Z, MiniT2I, PixArt-Σ, Fibo) exigent un encodeur texte séparé de 2 à 15 Go
  et dépassent le budget, même quantifiés.
- **Un seul moteur sur le GPU** : llama-server et sd-server ne cohabitent pas dans
  6 Go. Au premier message d'image, le lanceur arrête llama-server ; la première
  question de texte suivante le relance (~5 s). Sans image demandée pendant
  `IMAGE_IDLE` (5 min), sd-server est libéré automatiquement.
- **DLL OpenMP** : `vcomp140.dll` et `msvcp140_codecvt_ids.dll` sont fournis à
  côté de `sd-server.exe` (extraits du redistribuable VC++ de Microsoft, comme les
  autres DLL app-local). Sans eux, Windows renvoie `0xC0000135`.

## Reste à faire pour une distribution complète

- Empaqueter le lanceur + `llama-server` + DLL dans un installeur (MSI/NSIS).
- Publier `vendor/llama/macos/` (Metal) et `vendor/llama/ubuntu/` (Vulkan) via CI.
- Signer le binaire Windows (SmartScreen) et le `.dmg` macOS (notarisation Apple).
- Remplacer le mode `--app` par une WebView embarquée si l'on veut un exécutable
  unique sans dépendre de Chrome/Edge installé.

## Questions fréquentes

**SIMIA a-t-il besoin d'Internet ?**
Une fois les poids d'un modèle téléchargés, non. Le premier téléchargement se fait
depuis un CDN ; ensuite l'application fonctionne réseau coupé. Seul l'agent web
demande une connexion, et seulement quand vous l'utilisez.

**Quelle configuration faut-il ?**
8 Go de mémoire suffisent pour les modèles sous 2 Go. Pour la génération
d'images, comptez 6 Go de VRAM (mesures faites sur une RTX 2060 6 Go). Sans GPU
compatible, `llama.cpp` bascule sur le processeur : plus lent, mais fonctionnel.

**Quelle différence avec ChatGPT ou Claude ?**
Aucune donnée ne sort de la machine, il n'y a pas de compte à créer et pas de
quota. En contrepartie, les modèles embarqués sont bien plus petits : quelques
milliards de paramètres au lieu de plusieurs centaines, donc moins de culture
générale et plus d'erreurs sur les sujets pointus.

**Pourquoi la version web limite-t-elle les modèles à 1,9 Go ?**
Un onglet ne dispose que d'une fraction de la mémoire du GPU, et un dépassement
fait planter l'onglet sans message utile. La version bureau n'a pas cette limite :
elle charge le modèle sur le GPU de la machine.

**Qu'apporte la version bureau, concrètement ?**
Trois choses que le navigateur ne sait pas faire : les modèles volumineux (7B,
14B, 32B, jusqu'à 9,7 Go de poids par fichier, contre 1,9 Go en web), la
génération d'images Stable Diffusion jusqu'à 1024 px, et l'installation de
n'importe quel `.gguf` supplémentaire en le déposant simplement dans le dossier
`models/`. C'est la version complète ; la version web est faite pour essayer.

**Les images générées sont-elles filtrées ?**
Non. SIMIA ne filtre rien lui-même. Les licences des modèles (CreativeML
OpenRAIL-M, Stability Community) s'appliquent à l'usage des images produites, et
certaines interdisent un usage commercial ; elles sont rappelées dans le
catalogue.

**Où sont stockées mes conversations ?**
Dans le navigateur (IndexedDB) pour la version web, dans le profil de
l'application pour la version bureau. L'export JSON permet de les sauvegarder ou
de les déplacer.

## Licence et mentions légales

Le code de SIMIA est publié ici à titre de source visible ; aucun fichier
`LICENSE` n'accompagne encore le dépôt, donc tous droits réservés par défaut.
Les composants tiers conservent leurs licences respectives :

| Composant | Licence |
|---|---|
| [llama.cpp](https://github.com/ggml-org/llama.cpp) | MIT |
| [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp) | MIT |
| [WebLLM](https://github.com/mlc-ai/web-llm) | Apache-2.0 |
| Modèles de texte et d'images | voir la colonne `license` des catalogues |

Le LoRA « Gravure SIMIA » et son jeu d'entraînement (planches botaniques du
domaine public) sont fournis avec le projet.

Site et application web : <https://app.zigmoon.com/SIMIA/> — hébergement LWS,
serveurs en France. Les mentions légales complètes (éditeur, hébergeur, données
personnelles) sont dans l'interface, section **Mentions légales**.
