# Publication du site SIMIA

Le site public tient dans un seul dossier : **`dist/SIMIA/`**. Il est autonome :
la landing à la racine, l'application sous `app/`, les modeles et les paquets a
telecharger en dessous.

## Préparer le dossier à téléverser

Les poids ne sont **pas** dans `SIMIA/` : ce dossier ne contient que l'interface.
Glisser `SIMIA/` sur le FTP ne peut donc jamais envoyer les `.gguf`. Un script
assemble le tout, à partir de `deploy/` (le site), `web/` (l'application) et
`models/` (les poids) :

```powershell
cd SIMIA-desktop
powershell -NoProfile -File tools\prepare-ftp.ps1
```

Résultat dans **`SIMIA-desktop/dist/SIMIA/`** : 36 fichiers, **3,14 Go**, avec la
bonne arborescence. Les gros fichiers sont posés en **liens physiques** : aucune
copie, aucun espace disque consommé.

> Il suffit ensuite de déposer **le dossier `dist/SIMIA/` entier** à la racine du
> serveur : il devient `app.zigmoon.com/SIMIA/`. Pas son contenu, le dossier.

| Sous-dossier | Contenu | Rôle |
|---|---|---|
| *(racine)* | `index.html`, `.htaccess`, `robots.txt`, `sitemap.xml`, `service-worker.js`, 3 `.php` | la landing et ses fichiers de site |
| `app/` | 18 fichiers | l'application web installable (PWA) |
| `models/` | 3 GGUF + LoRA + `versions.json` + `catalog.json` | modèles servis par le serveur |
| `downloads/` | paquets `.zip` / `.tar.gz` + `manifest.json` | les versions de bureau |

`models/` ne reçoit **que** les fichiers déclarés dans `models/versions.json`.
Le reste du catalogue local (~20 Go d'images) n'est jamais publié : il vient du
CDN. `catalog.json` n'est pas lu par le navigateur mais documente le catalogue
cote serveur ; `versions.json` alimente la veille de version du lanceur.

`downloads/manifest.json` est régénéré à chaque exécution du script : la landing
le lit pour savoir quels paquets existent réellement, et n'affiche jamais un lien
mort. Déposer un nouveau `.zip` dans `deploy/downloads/` puis relancer le script
suffit à le rendre téléchargeable.

## 1. La landing (`app.zigmoon.com/SIMIA/`)

La racine du site sert la page de présentation. C'est elle que Google indexe et
que les visiteurs voient en premier.

```
app.zigmoon.com/SIMIA/
├── index.html                    82 Ko   ← la landing
├── cookies.js                    21 Ko   ← boîte de consentement (landing + app)
├── .htaccess                     2,8 Ko  ← types MIME + cache + redirection
├── service-worker.js             1,3 Ko  ← desinscrit l'ancienne PWA
├── robots.txt . sitemap.xml
├── agent-api.php . read-url-api.php . web-search-api.php
├── app/                                  ← l'application
├── models/                               ← les poids
└── downloads/                            ← les paquets
```

## La boîte de consentement

`cookies.js` sert les deux pages : la landing le charge à la racine, l'application
sous `app/`. Un seul fichier source (`deploy/cookies.js`), deux copies, aucune
divergence possible — `tools/sync-web.ps1` fait la seconde.

Ce n'est pas une bannière décorative. SIMIA ne depose aucun cookie et n'envoie
aucune donnee, mais trois ressources viennent de tiers : les polices
d'affichage, la visionneuse 3D (`model-viewer`) et la liste des versions GitHub.
Elles portent `data-consent-href` ou `data-consent-src` au lieu de `href`/`src`,
et ne sont chargées qu'apres un accord explicite. Refuser laisse l'application
entièrement fonctionnelle : le repli système remplace les polices, la visionneuse
3D ne se charge pas, et la liste des versions affiche le paquet servi par le
site.

Deux détails qui comptent :

- un `<script>` déjà analysé ne rejoue pas quand on lui pose un `src` ; le script
  injecte est donc un **nouvel** element, sinon la visionneuse 3D ne se
  chargerait jamais après un accord donné en cours de visite ;
- le choix vit dans `simia-consent-v1`, séparé de la sauvegarde de
  l'application : effacer ses conversations ne le remet pas à zéro.

`cookies-config.js` a été supprimé : il ne servait qu'à l'ancien script commun
`/zigmoon-cookies.js`, absent de ce site. Si vous le voyez encore en ligne, il
peut être supprimé sans conséquence.

> **Le fichier `.htaccess` est indispensable.** Apache ne connaît pas
> `.webmanifest` par défaut : sans lui, le manifeste part en
> `application/octet-stream` et Chrome refuse l'installation. Il fixe aussi
> `Cache-Control: no-store` sur les `service-worker.js`, sans quoi un ancien
> worker peut rester actif plusieurs heures. Certains clients FTP masquent les
> fichiers commençant par un point : vérifier qu'il est bien arrive.

## 2. L'application (`app.zigmoon.com/SIMIA/app/`)

18 fichiers, **1,4 Mo** :

```
app.zigmoon.com/SIMIA/app/
+-- index.html                    30,1 Ko
+-- app.js                       393,0 Ko
+-- styles.css                    58,8 Ko
+-- code-runner.js                 3,8 Ko
+-- cookies-config.js
+-- service-worker.js              8,5 Ko   <- simia-app-4.0.0
+-- manifest.webmanifest           2,3 Ko
+-- offline.html                   2,5 Ko
+-- icon.svg . simia-logo.svg . simia-logo-white.svg
+-- icons/                         4 PNG, 17,5 Ko
+-- screenshots/                   2 PNG, 121 Ko
+-- models/hosting-status.json
```

Les points d'entree PHP restent à la racine : l'application les appelle en
`../agent-api.php`. Les déplacer sous `app/` casserait l'agent web.

### L'ancienne adresse /SIMIA/desktop/

La landing était auparavant servie depuis `/SIMIA/desktop/`. `.htaccess` la
redirige en 301 vers la racine, pour les favoris et les liens déjà indexés.

### Les visiteurs qui avaient installe l'ancienne version

L'application occupait la racine : ceux qui l'avaient installée ont un service
worker dont le périmètre couvre tout `/SIMIA/`, et qui continuerait de servir son
cache a la place de la landing. `deploy/service-worker.js` existe uniquement pour
ca : a l'activation il supprime les caches `simia-shell-*`, s'approprie les
onglets, puis se désinscrit. Vérifié en local : les anciens caches disparaissent,
celui de la nouvelle application (`simia-app-*`) est préservé.
## L'application installable (PWA)

Trois éléments rendent SIMIA installable, tous déjà en place :

| Élément | Fichier | Rôle |
|---|---|---|
| Manifeste | `manifest.webmanifest` | nom, icônes, `display: standalone`, raccourcis, captures |
| Service worker | `service-worker.js` | rend l'interface disponible hors ligne |
| Icônes | `icons/` | 192 et 512 px obligatoires, plus une version `maskable` |

Chrome et Edge déclenchent l'installation quand ces trois conditions sont
remplies et que la page est servie en **HTTPS**. L'application affiche alors son
propre bouton **Installer SIMIA** (barre latérale sur ordinateur, menu sur
mobile), qui appelle l'invite native du navigateur.

Sur iOS, aucun navigateur ne peut déclencher cette invite : le bouton ouvre une
aide en trois étapes (Partager → Sur l'écran d'accueil). Safari exige que le site
soit dans `Safari`, pas dans Chrome iOS.

> Le bouton reste masqué si l'application tourne déjà en mode installé
> (`display-mode: standalone`) ou dans le lanceur de bureau : inutile de proposer
> d'installer ce qui l'est déjà.

### Ce que le service worker met en cache

Précache à l'installation : `index.html`, `app.js`, `styles.css`,
`code-runner.js`, `manifest.webmanifest`, `offline.html`, les logos, les 4 icônes
PNG et la page `desktop/`. Environ 500 Ko, une seule fois.

Jamais mis en cache : tout ce qui est sous `/models/` (plusieurs gigaoctets), les
fichiers `.gguf` et `.safetensors`, les points d'entrée `.php`, et toute requête
inter-origine (les poids viennent de HuggingFace).

Comportement réseau :

| Type de requête | Stratégie |
|---|---|
| Navigation (une page) | réseau d'abord, 4 s maximum, puis cache, puis `offline.html` |
| Assets (`js`, `css`, `svg`, `png`, `webmanifest`…) | cache immédiat, rafraîchissement en arrière-plan |
| `.php`, `/models/`, CDN | laissé passer sans interception |

### Publier une nouvelle version

Deux cas, et un seul geste dans chacun :

1. **Contenu modifié** (interface, page de présentation) : rien à faire de plus
   que l'upload. Le worker se met à jour en arrière-plan, la page affiche
   « Une nouvelle version de SIMIA est prête — Recharger », et l'ancien cache est
   supprimé à l'activation.
2. **Logique du worker modifiée** : incrémenter `VERSION` dans
   `service-worker.js` (`3.1.0` aujourd'hui). Le nom du cache en découle : les
   anciens caches sont supprimés d'office.

### Migration depuis l'ancien service worker (`simia-shell-v146`)

Le premier worker déployé sur le site ne se mettait jamais à jour : il servait
son cache indéfiniment, y compris `app.js` et `manifest.webmanifest`. Les
visiteurs revenus voyaient donc une interface périmée, et le worker correct
restait en attente sans jamais prendre la main.

Le worker actuel détecte ce cas : si un cache au nom d'une ancienne génération
(`simia-shell-v146`, `simia-shell-v162`…) existe au moment de l'installation, il
appelle `skipWaiting()` immédiatement au lieu d'attendre un clic. Les anciens
caches sont purgés, la page se recharge une fois, et le visiteur récupère la
version courante. Les mises à jour suivantes (3.1.0 → 3.2.0) reviennent au
comportement normal : le worker attend, la page propose de recharger.

Vérifié en local en reproduisant l'état exact : cache `simia-shell-v146` contenant
un `app.js` périmé, puis dépôt du nouveau worker. Résultat : un seul cache
restant (`simia-shell-3.1.0`), `app.js` à jour, rechargement automatique.

Pour tester après upload, dans Chrome : **DevTools → Application → Manifest**
(doit afficher les icônes sans erreur), **Service Workers** (état `activated`),
puis cocher **Offline** et recharger : SIMIA doit s'ouvrir normalement.

## La règle des 1,9 Go en web

La version web ne liste que les modèles dont les poids sont **sous 1,9 Go**
(`WEB_MAX_MODEL_MB` dans `app.js`) : au-delà, le navigateur manque de mémoire
pour un usage confortable. Un total de 12 modèles est donc masqué côté web, avec
une carte « Version desktop » qui explique où les trouver.

La version de bureau n'applique aucun filtre : elle charge le catalogue
`models/catalog.json` tel quel, jusqu'à 9,7 Go par modèle.

## 3. Les modèles (`app.zigmoon.com/SIMIA/models/`)

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
curl.exe -sI https://app.zigmoon.com/SIMIA/app/app.js
# 200 + Content-Length proche de 393000 (383,6 Ko)

# le service worker doit etre servi sans cache
curl.exe -sI https://app.zigmoon.com/SIMIA/service-worker.js
# 200 + Cache-Control: no-cache, no-store, must-revalidate

# le manifeste doit avoir le bon type, sinon Chrome refuse l'installation
curl.exe -sI https://app.zigmoon.com/SIMIA/app/manifest.webmanifest
# 200 + Content-Type: application/manifest+json   (jamais application/octet-stream)

# les icones de l'application installee
curl.exe -sI https://app.zigmoon.com/SIMIA/app/icons/icon-512.png
curl.exe -sI https://app.zigmoon.com/SIMIA/app/icons/maskable-512.png

# la page hors ligne et la page de presentation
curl.exe -sI https://app.zigmoon.com/SIMIA/app/offline.html
curl.exe -sI https://app.zigmoon.com/SIMIA/    # la landing, en 200
curl.exe -sI https://app.zigmoon.com/SIMIA/desktop/   # 301 vers la racine
curl.exe -sI https://app.zigmoon.com/SIMIA/downloads/simia-windows-x64.zip

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
| `image/loras/simia-gravure.safetensors` | 6 434 192 | `7f3be811…2647930a` |

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