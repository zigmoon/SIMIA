# SIMIA Desktop

Application de bureau de SIMIA : la même interface que le site, servie localement,
avec l'inférence exécutée en natif par `llama.cpp` (Vulkan / D3D12 sur Windows,
Metal sur macOS, Vulkan sur Linux, repli CPU automatique).

## Pourquoi cette architecture

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
├── web/                            copie de ../SIMIA (tools/sync-web.ps1)
├── packaging/LISEZ-MOI.txt         fichier livré dans chaque archive
├── .github/workflows/build.yml     CI Windows / macOS / Linux
├── vendor/llama/win-vulkan/        llama.cpp + DLL Vulkan + runtime VC++
├── vendor/sd/win-vulkan/           stable-diffusion.cpp (sd-server) + DLL
├── models/*.gguf                   poids des modèles de texte
├── models/image/                   packs d'images + catalog.json
├── models/image/loras/             LoRA de style (simia-gravure.safetensors)
└── tools/lora/                     chaîne d'entraînement du LoRA
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
| `macos-arm64` | macos-arm64 | Darwin arm64 | `simia-macos-arm64.zip` |
| `macos-x64` | macos-x64 | **aucun binaire** | `simia-macos-x64.zip` |
| `linux-x64` | ubuntu-vulkan-x64 | Ubuntu x86_64 vulkan | `simia-linux-x64.tar.gz` |

Sur macOS Intel, la génération d'images est simplement masquée : le bouton
**Image** n'apparaît pas tant que `sd-server` est absent, sans erreur.

Chaque paquet contient `simia-desktop`, `web/`, `vendor/`, `models/*.json` et
`LISEZ-MOI.txt`. Les poids ne sont pas inclus : le catalogue pointe vers le CDN.

## Ce que l'interface affiche

Le moteur d'image est distinct du modèle de texte, donc il est visible à trois
endroits :

| Emplacement | Affichage |
|---|---|
| Barre du haut | pastille violette `IMAGE · SDXL Turbo` (+ infobulle avec la résolution et les pas) |
| Zone de saisie | `SDXL Turbo · 1024 px · 4 pas`, uniquement quand le mode Image est actif |
| Paramètres | bloc **MOTEUR D'IMAGE** avec la description du pack |
| Légende d'une image générée | `SDXL Turbo · 1024×1024 · 4 pas` |

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

1. Déposer un fichier `.gguf` dans `models/`.
2. Relancer. Il apparaît dans la bibliothèque avec son nom et sa quantification
   extraits du nom de fichier (`Qwen3.5-2B-Q4_K_M.gguf` → « Qwen3.5 2B »,
   « ~1.2 GB (Q4_K_M) »).

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

- **Runtime VC++** : les binaires officiels de `llama.cpp` sont compilés avec MSVC
  et exigent `vcruntime140.dll`, `vcruntime140_1.dll` et `msvcp140.dll`. Ils sont
  fournis dans `vendor/llama/win-vulkan/` (redistribution autorisée par Microsoft).
- **Modèles à raisonnement** (Qwen 3.x) : sans réglage, la réponse part dans
  `reasoning_content` et `content` reste vide. `app.js` envoie donc
  `chat_template_kwargs: { enable_thinking: false }`.
- **Service worker** : désactivé en mode bureau (le lanceur sert un worker inerte),
  sinon il servirait une ancienne version de `app.js` après une mise à jour.
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
