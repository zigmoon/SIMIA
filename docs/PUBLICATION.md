# Publication des modèles SIMIA

Seuls **3 modèles** sont hébergés sur votre serveur. Les 26 autres sont téléchargés
directement depuis le CDN HuggingFace, sans occuper d'espace chez vous.

## 1. L'interface (`app.zigmoon.com/SIMIA/`)

16 fichiers à la racine, **1,3 Mo**, plus `models/hosting-status.json` :

```
app.zigmoon.com/SIMIA/
├── index.html                    23,8 Ko   ← changé
├── app.js                       361,7 Ko   ← changé
├── styles.css                    53,0 Ko   ← changé
├── code-runner.js                 3,7 Ko
├── service-worker.js              2,1 Ko   ← changé (simia-shell-v157)
├── manifest.webmanifest
├── cookies-config.js
├── icon.svg · simia-logo.svg · simia-logo-white.svg
├── robots.txt · sitemap.xml
├── agent-api.php · read-url-api.php · web-search-api.php
└── models/hosting-status.json
```

`prepare-self-hosted-llama.ps1` est un outil local (préparation WebLLM), inutile
sur le serveur.

Les trois fichiers marqués sont ceux modifiés depuis le dernier envoi. Bumper
`CACHE_NAME` dans `service-worker.js` (fait : v158) suffit à ce que les visiteurs
récupèrent la nouvelle version au rechargement suivant.

> **Le dossier `SIMIA/desktop/`** contient la page de présentation
> (`SIMIA/desktop/index.html`) : elle propose les téléchargements Windows, macOS
> et Linux ainsi que le lien vers la version web. `tools/sync-web.ps1` la copie
> dans `web/desktop/`, donc elle part avec l'interface :

```
app.zigmoon.com/SIMIA/desktop/index.html
```

Son unique constante pointe déjà vers les releases du dépôt :

```js
const RELEASE_BASE = "https://github.com/zigmoon/SIMIA/releases/latest/download";
```

## La règle des 1,9 Go en web

La version web ne liste que les modèles dont les poids sont **sous 1,9 Go**
(`WEB_MAX_MODEL_MB` dans `app.js`) : au-delà, le navigateur manque de mémoire
pour un usage confortable. Un total de 12 modèles est donc masqué côté web, avec
une carte « Version desktop » qui explique où les trouver.

La version de bureau n'applique aucun filtre : elle charge le catalogue
`models/catalog.json` tel quel, jusqu'à 9,7 Go par modèle.

## 2. Les modèles (`app.zigmoon.com/SIMIA/models/`)

```
app.zigmoon.com/SIMIA/models/
├── catalog.json                                         (~8 Ko)
├── versions.json                                        (~0,4 Ko)
├── Llama-3.2-1B-Instruct-Q4_K_M.gguf                    ~770 Mo
├── Qwen3.5-2B-Q4_K_M.gguf                               ~1,2 Go
└── image/
    ├── catalog.json                                     (~3 Ko)
    └── loras/simia-gravure.safetensors                  6,1 Mo
```

**Total à uploader : ≈ 3,0 Go** (et non 40 Go). Les trois fichiers sont présents
et vérifiés (en-tête GGUF v3 valide) :

| Fichier | Octets exacts | Affiché |
|---|---|---|
| `Llama-3.2-1B-Instruct-Q4_K_M.gguf` | 807 694 368 | 770 Mo |
| `qwen2.5-1.5b-instruct-q4_k_m.gguf` | 1 117 320 736 | 1 066 Mo |
| `Qwen3.5-2B-Q4_K_M.gguf` | 1 280 835 840 | 1 222 Mo |

Les 3 modèles texte ont tous un `mirror` HuggingFace : si le serveur répond 404
ou 500, le lanceur essaie le CDN automatiquement. Un dossier `models/` absent
dégrade donc la vitesse, pas la disponibilité.

Ils correspondent à `"source": "server"` dans
[models/catalog.json](../models/catalog.json). Tous les autres ont
`"source": "cdn"` et pointent vers HuggingFace.

## Modèles d'image (facultatif)

La génération d'images est une fonction de l'application de bureau. Trois jeux de
fichiers sont déclarés dans `models/image/catalog.json` et apparaissent dans la
bibliothèque de SIMIA, onglet **Image** :

| Jeu | Fichiers | Taille | Résolution | Vitesse (RTX 2060) |
|---|---|---|---|---|
| **SD-Turbo** (recommandé) | `sdturbo/sd_turbo_q4_0.gguf` | 1,72 Go | 512 px, 4 pas | **1,2 s** (2,2 s en 768) |
| SDXS 512 | `sdxs/sdxs-512-tinySDdistilled_Q8_0.gguf` | 651 Mo | 512 px, 1 pas | **0,3 s** |
| Stable Diffusion 1.5 | `sd15/stable-diffusion-v1-5-pruned-emaonly-Q4_0.gguf` | 1,46 Go | 512 px, 20 pas | ~2 s |
| **SD 1.5 · Gravure SIMIA** | `sd15/…Q4_0.gguf` + `loras/simia-gravure.safetensors` | 1,46 Go + 6,4 Mo | 512 px, 24 pas | ~2 s |
| Z-Image Turbo | `z_image_turbo-Q3_K.gguf` + `Qwen3-4B-Instruct-2507-Q4_K_M.gguf` + `ae.safetensors` | 5,57 Go | 1024 px, 8 pas | ~37 s |

Les trois premiers tiennent sous 1,8 Go, se téléchargent depuis l'application
(bouton **Télécharger** de la carte) et restent entièrement en VRAM, sans
`--offload-to-cpu`. Z-Image demande les trois fichiers à la main.

Si vous voulez les héberger vous-même, reproduisez l'arborescence :

```
app.zigmoon.com/SIMIA/models/image/
├── sdturbo/sd_turbo_q4_0.gguf                            ~1,7 Go
├── sd15/stable-diffusion-v1-5-pruned-emaonly-Q4_0.gguf   ~1,5 Go
├── loras/simia-gravure.safetensors                       ~6,4 Mo
├── sdxs/sdxs-512-tinySDdistilled_Q8_0.gguf               ~0,65 Go
└── z_image_turbo-Q3_K.gguf + Qwen3-4B + ae.safetensors   ~5,6 Go
```

Le LoRA de gravure est un fichier que nous avons entraîné (voir
[tools/lora](../tools/lora/README.md)) : il ne dépend d'aucun dépôt tiers et ne
pèse que quelques méga-octets. `loraUrl` dans le catalogue pointe déjà vers
`models/image/loras/simia-gravure.safetensors` sur le serveur.

Puis remplacez le champ `url` de chaque pack dans `models/image/catalog.json` par
l'adresse de votre serveur. Tant qu'un pack est incomplet, sa carte reste
visible avec la mention des fichiers manquants, et le bouton **Image** de la
barre de saisie reste masqué.

### Pourquoi pas les modèles 2026 plus récents ?

Tous les modèles sortis en 2026 qui produisent des images dépassent largement
2 Go, même quantifiés :

| Modèle | Poids mini | Obstacle |
|---|---|---|
| Z-Image Turbo | 5,6 Go | retenu, mais hors budget « léger » |
| FLUX.2-klein-4B | ~4,8 Go | DiT 2,3 Go + encodeur Qwen3-4B 2,3 Go + VAE |
| SeFi-Image 1B turbo | ~3,7 Go | pas de GGUF : 2,2 Go de transformer + encodeur Qwen3-VL-2B |
| Iris-Z | ~6 Go | 4,7 Go de transformer, pixel space, sans VAE |
| MiniT2I b-16 | ~3 Go | 985 Mo de DiT mais 2 Go d'encodeur T5-large |
| PixArt-Σ | ~5 Go | transformer 2,3 Go + T5-XXL |
| Fibo 2.0 | ~14 Go | 15 Go de transformer |

Sous 2 Go, seules les architectures à encodeur CLIP intégré restent possibles —
c'est-à-dire la famille SD 1.5 / SD 2.1 et ses distillations (SD-Turbo, SDXS,
LCM). SD-Turbo Q4_0 est le meilleur compromis trouvé : qualité SD 2.1, 4 pas.

## Configuration du serveur

Les fichiers doivent être servis tels quels, avec support des requêtes `Range`
(reprise de téléchargement) :

```apache
<Directory "/var/www/app.zigmoon.com/SIMIA/models">
  Require all granted
  Options -Indexes
  <FilesMatch "\.(gguf|json)$">
    Header set Accept-Ranges bytes
    Header set Cache-Control "public, max-age=604800"
  </FilesMatch>
  AddType application/octet-stream .gguf
</Directory>
```

Nginx :

```nginx
location /SIMIA/models/ {
    add_header Accept-Ranges bytes;
    add_header Cache-Control "public, max-age=604800";
    types { application/octet-stream gguf; }
}
```

## versions.json : la veille de version

Le lanceur interroge `https://app.zigmoon.com/SIMIA/models/versions.json` au
démarrage, puis l'interface affiche :

- `N modèle(s) sur ce disque · 3 hébergés sur le serveur` dans les paramètres ;
- une bannière bleue dans la bibliothèque si `versions.json` annonce une version
  différente de celle de `catalog.json`.

Pour publier une mise à jour :

1. Incrémenter `version` dans `versions.json` **et** dans `catalog.json`.
2. Renseigner `published` (date) et `notes` (résumé).
3. Uploader. Les clients voient la bannière au prochain lancement.

Le contrôle est non bloquant : serveur injoignable → SIMIA démarre normalement.

## Repli automatique serveur → CDN

Chaque modèle `source: "server"` porte un champ `mirror` (URL CDN). Le lanceur
essaie dans l'ordre :

1. `https://app.zigmoon.com/SIMIA/models/<id>.gguf`
2. le `mirror` HuggingFace

Donc si vous coupez le serveur ou dépassez la bande passante, les téléchargements
continuent depuis le CDN.

## Vérifier après upload

```powershell
# l'interface
curl.exe -sI https://app.zigmoon.com/SIMIA/app.js
# 200 + Content-Length proche de 370000 (361,7 Ko)

# le catalogue et les versions
curl.exe -s https://app.zigmoon.com/SIMIA/models/versions.json

# un modèle : 200 attendu, et surtout Accept-Ranges: bytes (sinon pas de reprise)
curl.exe -sI https://app.zigmoon.com/SIMIA/models/Qwen3.5-2B-Q4_K_M.gguf

# le LoRA (6,1 Mo)
curl.exe -sI https://app.zigmoon.com/SIMIA/models/image/loras/simia-gravure.safetensors
```

### Empreintes SHA-256 (contrôle d'intégrité après transfert)

Un transfert FTP interrompu produit un fichier de bonne taille apparente mais
corrompu. À vérifier après upload :

```powershell
Get-FileHash qwen2.5-1.5b-instruct-q4_k_m.gguf -Algorithm SHA256   # sur votre copie locale
# comparer avec le tableau ci-dessous et avec versions.json
```

| Fichier | Octets | SHA-256 |
|---|---|---|
| `Llama-3.2-1B-Instruct-Q4_K_M.gguf` | 807 694 368 | `3f5a2242…68d862dcc1` |
| `qwen2.5-1.5b-instruct-q4_k_m.gguf` | 1 117 320 736 | `6a1a2eb6…e434e9407e` |
| `Qwen3.5-2B-Q4_K_M.gguf` | 1 280 835 840 | `aaf42c8b…914699223` |
| `image/loras/simia-gravure.safetensors` | 6 434 152 | `7f3be811…2647930a` |

Les valeurs complètes sont dans [models/versions.json](../models/versions.json).

Puis relancer `simia-desktop.exe` : le journal doit afficher
`catalogue : v2 (https://app.zigmoon.com/SIMIA/models/)`.

## Symptôme d'un dossier `models/` absent

Un hébergement mutualisé (LWS, o2switch…) qui reçoit une requête sur un dossier
inexistant renvoie souvent **500** et non 404. C'est ce que renvoie
`/SIMIA/models/catalog.json` tant que le dossier n'a pas été déposé. Le lanceur
interprète ce 500 comme un échec et bascule sur le `mirror` : l'application
fonctionne, mais rien n'est servi par votre serveur. Un test rapide :

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" https://app.zigmoon.com/SIMIA/models/catalog.json
```
