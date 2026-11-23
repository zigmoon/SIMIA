# Entraînement du modèle botanique SIMIA

Ce dossier fabrique un **modèle d'image complet** à partir de SD 1.5 et d'un
corpus de planches gravées du XIXᵉ siècle tombées dans le domaine public. Le
résultat est un fichier unique d'environ 2,1 Go, utilisable par n'importe quel
outil — dont `sd-server` de SIMIA — **sans LoRA séparé**.

Il contient aussi de quoi publier le tout sur Hugging Face.

## Ce que ce n'est pas

Le LoRA du catalogue (`../../models/image/loras/simia-gravure.safetensors`,
6 Mo) est un correctif posé sur SD 1.5 : sans le modèle d'origine il ne sert à
rien. Ici les poids sont modifiés pour de vrai, le fichier se suffit à lui-même.
C'est la différence entre « une consigne ajoutée » et « un modèle ».

## Matériel

| | |
|---|---|
| Carte utilisée | RTX 2060, 6 Go de VRAM |
| Temps d'une campagne courte | ~45 min pour 800 pas |
| Espace disque | ~8 Go (SD 1.5 de départ + corpus + points de sauvegarde) |

6 Go de VRAM imposent des choix : entraîner les 860 M de l'UNet avec Adam
demanderait ~10 Go. Trois portées sont donc proposées :

- `--scope attention` (défaut) : seules les projections d'attention sont
  entraînées (~200 M de paramètres, AdamW). Tient largement dans 6 Go.
- `--scope unet` : tout l'UNet, avec AdaFactor à la place d'Adam (états
  factorisés, < 300 Mo).
- `--scope full` : UNet + encodeur de texte. 12 Go et plus.

## Prérequis : un torch CUDA

Le Python du système porte un `torch` compilé sans CUDA (`2.15.0+cpu`).
L'entraînement sur processeur prendrait des semaines, un environnement isolé
est donc nécessaire. Les roues CUDA pour Python 3.14 existent jusqu'à
`torch 2.9.1` ; au-delà, il faut un Python 3.12 ou 3.13.

```powershell
cd tools\train-simia
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install "torch==2.9.1+cu126" --index-url https://download.pytorch.org/whl/cu126
.\.venv\Scripts\python.exe -m pip install torchvision==0.24.1 --index-url https://download.pytorch.org/whl/cu126
.\.venv\Scripts\python.exe -m pip install diffusers transformers accelerate safetensors pillow tqdm scipy
```

Vérification, qui doit afficher `True` :

```powershell
.\.venv\Scripts\python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available())"
```

## Les trois étapes

### 1. Assembler le corpus

```powershell
.\.venv\Scripts\python.exe -u prepare_corpus.py --limit 220
```

Le script parcourt les catégories Wikimedia Commons de *Curtis's Botanical
Magazine* et d'*Edwards's Botanical Register*, descend dans les volumes,
télécharge des vignettes de 1024 px, écarte les volumes PDF, les pages de
garde, les photos en paysage et les doublons, puis écrit pour chaque planche un
`.png` et un `.txt` contenant la légende préfixée du jeton déclencheur.

Il est **reprenable** : relancer la commande après une coupure réseau repart
des planches déjà écrites. Commons limite durement le débit (429), d'où les
temporisations ; comptez une dizaine de minutes pour 220 planches.

Pourquoi 220 et pas 30 : sous une centaine d'images le modèle apprend par cœur
au lieu d'apprendre un style, et produit des planches qui ressemblent à celles
du corpus sans jamais en inventer.

### 2. Entraîner

```powershell
# essai à blanc : trois pas, rien n'est écrit
.\.venv\Scripts\python.exe train_dense.py --dry-run

# campagne courte de contrôle
.\.venv\Scripts\python.exe train_dense.py --steps 800

# campagne sérieuse
.\.venv\Scripts\python.exe train_dense.py --scope attention --steps 4000 --save-every 1000
```

Le script gèle tout, rouvre la portée demandée, active la rétropropagation par
points de contrôle (gradient checkpointing) pour tenir dans 6 Go, applique un
abandon de légende (CFG dropout) pour que la génération guidée fonctionne
ensuite, et décroît le taux d'apprentissage en cosinus.

Sorties dans `out/` :

| Fichier | Contenu |
|---|---|
| `simia-botanical-v1.safetensors` | le modèle complet, format SD original |
| `README.md` | la fiche du modèle, prête pour Hugging Face |
| `samples/sample-1..3.png` | trois rendus pour vérifier que le style a bougé |
| `step-XXXX.safetensors` | points de sauvegarde intermédiaires |

### 3. Publier

Rien ne part sans `--push`.

```powershell
.\.venv\Scripts\python.exe -m pip install huggingface_hub
.\.venv\Scripts\python.exe -m huggingface_hub.commands.huggingface_cli login

# vérification à blanc : contenu, en-tête du .safetensors, métadonnées de la fiche
.\.venv\Scripts\python.exe publish_hf.py --repo zigmoon/simia-botanical-v1

# publication
.\.venv\Scripts\python.exe publish_hf.py --repo zigmoon/simia-botanical-v1 --push
```

Le script crée le dépôt s'il n'existe pas, vérifie que le `.safetensors` est
lisible, que la fiche commence bien par un en-tête YAML avec `license` et
`tags`, et n'envoie pas les points de sauvegarde intermédiaires.

## La variante LoRA, celle que livre le catalogue

Le catalogue de SIMIA ne pose pas un checkpoint de 2,1 Go mais un correctif de
6 Mo (`models/image/loras/simia-gravure.safetensors`). Trois scripts le
fabriquent et le mesurent.

### 1. Recapitionner le corpus

Un LoRA n'apprend que ce que la légende lui dit de distinguer. Sur les 220
planches de la première campagne, 61 % des légendes ne nommaient pas la plante :
« This is a plate from Curtis's Botanical Magazine, Volume 73 », ou du texte
gravé mal océrisé (« MfoS », « FSv£ »). Le jeton de style y a donc appris « une
planche », pas « un style posé sur un sujet ».

```powershell
.\.venv\Scripts\python.exe recaption.py --dry-run   # rapport seul
.\.venv\Scripts\python.exe recaption.py             # écrit les légendes
```

Le script reprend le nom latin là où il existe : dans le titre Commons
(`File:Ada aurantiaca.jpg`), sinon dans les catégories, qui rangent chaque
planche sous son espèce (`Digitalis purpurea`). Résultat mesuré sur le corpus :
**212 planches nommées, 154 espèces distinctes, 8 planches écartées** faute de
sujet identifiable — déplacées dans `data/unused/`, jamais supprimées.

### 2. Entraîner le LoRA

```powershell
.\.venv\Scripts\python.exe train_lora.py --dry-run
.\.venv\Scripts\python.exe train_lora.py --steps 1500 --checkpoint-every 500
```

Rang 8, alpha 8, sur les seules projections d'attention (128 couches,
1,59 M de paramètres, 2,8 Go de VRAM, ~1,3 s par pas sur une RTX 2060).
L'UNet entier est gelé avant la greffe : sans ce gel, l'optimiseur se retrouve
avec 767 M de paramètres, remplit la carte et fait dériver la perte en NaN.

L'export écrit les clefs que `sd-server` attend — `lora_unet_<module>` avec les
points devenus des soulignes, `.alpha`, `.lora_down.weight`, `.lora_up.weight` —
et **compare le jeu de clefs à celui du LoRA livré**. Un export subtilement
différent ne lève aucune erreur : le moteur applique zéro tenseur et rend une
image sans style.

### 3. Mesurer avant de livrer

```powershell
.\.venv\Scripts\python.exe eval_lora.py --lora out/gravure-step-500.safetensors --weight 1.0
.\.venv\Scripts\python.exe eval_lora.py --lora ../../models/image/loras/simia-gravure.safetensors
```

Trois chiffres, tous comparatifs :

| Mesure | Ce qu'elle dit | Seuil |
|---|---|---|
| écrasement | rapport des distances entre trois sujets hors domaine, avec et sans le LoRA | 1,00 = la consigne survit ; le LoRA de 0.1.42 était à 0,57 |
| présence | part de papier crème et densité de contour | doit rester au-dessus du rendu sans style |
| mémoire | distance à la planche du corpus la plus proche, comparée à la distance entre deux planches | si l'image est plus proche d'une planche que deux planches ne le sont entre elles, le modèle récite |

## Vérifier que le modèle appris diffère vraiment de SD 1.5

Une campagne ne vaut rien sans comparaison. Après l'entraînement :

```powershell
.\.venv\Scripts\python.exe compare.py
```

Le script génère les mêmes consignes avec la même graine, une fois avec le
checkpoint entraîné, une fois avec SD 1.5 d'origine, puis mesure trois écarts :
global (pixels), **de trait** (contours, la mesure qui compte pour une gravure)
et de teinte. Les images sont écrites côte à côte dans `out/comparaison/`.

- écart de trait < 2 : les deux modèles sont identiques, rien n'a été appris ;
- entre 2 et 8 : le style a bougé mais discrètement, allonger la campagne ;
- au-delà de 8 : le style a nettement changé.

Si le résultat est trop faible, augmenter le nombre de pas, pas le corpus.

## Utiliser le modèle dans SIMIA

Le fichier est un checkpoint SD ordinaire. Le copier dans le dossier des
modèles d'image, puis recharger la bibliothèque :

```powershell
Copy-Item out\simia-botanical-v1.safetensors "$env:APPDATA\SIMIA\models\image\"
```

Il apparaît alors dans **Image → Modèles** et se génère comme n'importe quel
autre pack, sans LoRA.

## Licences

- Base : Stable Diffusion 1.5, licence CreativeML OpenRAIL-M (héritée).
- Corpus : planches de Curtis's Botanical Magazine et d'Edwards's Botanical
  Register, domaine public, via Wikimedia Commons. Le crédit figure dans
  `data/manifest.json`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `prepare_corpus.py` | collecte et normalise les planches |
| `train_dense.py` | entraîne et exporte le modèle |
| `compare.py` | mesure l'écart réel entre le modèle entraîné et SD 1.5 |
| `publish_hf.py` | vérifie et publie sur Hugging Face |
| `lora-card.md` | fiche du LoRA déjà dans le catalogue |
| `converter/convert_diffusers_to_original_stable_diffusion.py` | conversion au format SD original |
| `models/sd15/` | SD 1.5 découpé en composants diffusers |
| `data/plates/` | le corpus |
| `.venv/` | l'environnement CUDA |
