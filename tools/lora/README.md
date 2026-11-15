# Entraîner un LoRA de style pour SIMIA

Ce dossier contient la chaîne complète qui a produit **SD 1.5 · Gravure SIMIA**,
le LoRA de style livré dans `models/image/loras/`. Tout tourne sur une seule
RTX 2060 de 6 Go, sans droits administrateur.

## Ce que produit la chaîne

| | |
|---|---|
| Base | Stable Diffusion 1.5 (`stable-diffusion-v1-5/stable-diffusion-v1-5`, variante fp16) |
| Cible | couches d'attention du UNet (`to_q`, `to_k`, `to_v`, `to_out.0`) |
| Rang | 8 (alpha 8) |
| Paramètres entraînés | 1 594 368, soit 3,2 Mo en fp32 |
| Pas d'entraînement | 1 250 (750, puis 500 en reprise) |
| Fichier final | 6,4 Mo au format kohya |
| Jeton déclencheur | `s1mia` |
| Poids d'application | 1,4 (`loraWeight` dans le catalogue) |

## Les quatre étapes

```powershell
$py = "C:/Users/zigmo/AppData/Local/Programs/Python/Python314/python.exe"
$root = "C:\chemin\vers\_simia-train"

# 1. la base, 2,1 Go (unet + vae + text_encoder + tokenizer, fp16)
& $py fetch_base.py --out "$root\base"

# 2. les images, via l'API Wikimedia Commons (domaine public uniquement)
& $py fetch_dataset.py --out "$root\dataset" --theme engraving --count 32

# 3. l'entraînement (~45 min sur une 2060, 0,43 pas/s)
& $py train_lora.py --base "$root\base" --data "$root\dataset" --out "$root\out" `
    --max-steps 1100 --save-every 250

# 3 bis. si le style reste trop discret, on prolonge depuis un checkpoint
& $py train_lora.py --base "$root\base" --data "$root\dataset" --out "$root\out\run2" `
    --init "$root\out\simia-style-step750.safetensors" `
    --max-steps 500 --lr 6e-5 --warmup 25 --save-every 250

# 4. la conversion vers le format lu par stable-diffusion.cpp
& $py convert_lora.py --src "$root\out\run2\simia-style-step500.safetensors" `
    --dst "..\..\models\image\loras\simia-gravure.safetensors" --alpha 8
```

## Pourquoi ces choix

**Pourquoi le UNet seul.** Un LoRA de style tient dans les couches d'attention du
UNet. Entraîner aussi l'encodeur texte doublerait la taille du fichier pour un
gain marginal sur un simple rendu de matière.

**Pourquoi `lora_A` en fp32 et le reste en fp16.** `GradScaler` refuse de
dés-échelonner des gradients fp16, et AdamW a besoin de précision sur un taux
d'apprentissage de 1e-4. Seul l'adaptateur est remonté en fp32, ce qui coûte
3,2 Mo au lieu de 1,7 Go si on remontait tout le modèle.

**Pourquoi `noisy.requires_grad_(True)`.** Avec le gradient checkpointing, torch
ne recalcule un bloc que si l'une de ses entrées porte un gradient. Un UNet gelé
n'en a aucune : sans cette ligne, les gradients LoRA resteraient nuls et
l'entraînement ne ferait rien, sans lever d'erreur.

**Pourquoi six recadrages par image.** Les planches botaniques sont très
allongées (960 × 1 500). Un seul carré central perdrait la fleur ou l'appareil
végétal. Trois positions verticales et leurs reflets donnent 192 exemples à
partir de 32 fichiers, sans retélécharger quoi que ce soit.
**Pourquoi le format kohya.** `stable-diffusion.cpp` résout les poids sous la
forme `lora.model.diffusion_model.<module>.weight.lora_down` et accepte l'entrée
standard kohya (`lora_unet_<module>.lora_down.weight`). Les clés `peft`
(`...to_q.lora_A.default.weight`) ne sont pas reconnues : la conversion est
obligatoire, sinon le serveur ignore silencieusement le fichier.

## Comment SIMIA applique le LoRA

Le lanceur démarre `sd-server` avec `--lora-model-dir models/image/loras`, puis
ajoute le LoRA à chaque requête de génération :

```json
{ "prompt": "...", "lora": [{ "path": "simia-gravure.safetensors", "multiplier": 0.8 }] }
```

Le champ s'appelle `multiplier`, **pas** `weight`. Et les balises `<lora:...>`
écrites dans le prompt sont volontairement ignorées par l'API : le style doit
passer par ce champ structuré.

## Effet mesuré

Comparaison sur une même graine, prompt `a wild rose`, 512 px, 24 pas, CFG 7.
Les valeurs sont les moyennes de saturation et de contraste sur l'image entière ;
la dernière colonne donne la référence du jeu d'entraînement.

| Image | Saturation | Contraste | Luminosité |
|---|---|---|---|
| Sans LoRA | 0,481 | 0,342 | 0,712 |
| LoRA 1,0 | 0,444 | 0,316 | 0,795 |
| **LoRA 1,4** (livré) | **0,395** | **0,288** | **0,771** |
| LoRA 1,8 | 0,382 | 0,275 | 0,751 |
| Planches d'origine | 0,296 | 0,211 | 0,807 |

Le style se voit nettement — palette qui vire au papier ancien, contraste qui
baisse, luminosité qui monte — mais reste plus timide que les planches sources.
Au-delà de 1,4 le gain devient marginal : c'est la limite d'un LoRA de rang 8
sur 192 exemples, pas un réglage à corriger.

## Limites assumées

- **32 images, deux recueils seulement.** Le modèle reproduit le style de
  *Curtis's Botanical Magazine* et d'*Edwards's Botanical Register*, pas
  « la gravure » en général.
- **Les planches contiennent du texte gravé.** Le modèle en invente parfois des
  bribes illisibles dans les coins, c'est le défaut classique d'un LoRA entraîné
  sur des documents.
- **Ce n'est pas un modèle généraliste.** Il ne remplace pas SD-Turbo ni
  Z-Image : il ajoute une texture là où une photographie serait hors sujet.
- **Reproductibilité.** Les chiffres ci-dessus valent pour cette machine ; un
  rang 4 suffit probablement, et 800 pas donnent déjà un style lisible.
