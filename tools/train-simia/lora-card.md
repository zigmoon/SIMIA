---
license: creativeml-openrail-m
base_model: stable-diffusion-v1-5/stable-diffusion-v1-5
library_name: diffusers
tags:
  - stable-diffusion
  - stable-diffusion-diffusers
  - lora
  - text-to-image
  - botanical
  - engraving
  - vintage
  - simia
language:
  - en
---

# SIMIA Gravure — LoRA botanique

LoRA pour Stable Diffusion 1.5 qui donne aux images le trait des **gravures
botaniques du XIXᵉ siècle** : trait fin sur cuivre, hachures, mise en couleur à
l'aquarelle, composition centrée sur une seule espèce, fond neutre.

C'est le correctif utilisé par [SIMIA](https://github.com/zigmoon/SIMIA), qui
l'applique avec un poids de 1,4 sur SD 1.5.

## Le fichier

| | |
|---|---|
| Fichier | `simia-gravure.safetensors` |
| Taille | 6,1 Mo |
| Rang | 8, alpha 8 |
| Modules | 128, uniquement les attentions de l'UNet (`attn1`, `attn2`) |
| Paramètres entraînés | 1 594 368, soit 0,159 % de SD 1.5 |
| Encodeur de texte | non modifié |
| Format | tenseurs `lora_down` / `lora_up`, compatible PEFT et `diffusers` |

Un LoRA plutôt qu'un modèle complet : 6 Mo au lieu de 2,1 Go, et il s'applique
indifféremment à n'importe quel checkpoint SD 1.5 déjà installé, y compris les
versions quantifiées en 4 bits que fait tourner SIMIA.

## Utilisation

### Avec diffusers

```python
from diffusers import StableDiffusionPipeline

pipe = StableDiffusionPipeline.from_pretrained(
    "stable-diffusion-v1-5/stable-diffusion-v1-5", torch_dtype="float16"
).to("cuda")
pipe.load_lora_weights("zigmoon/simia-gravure-lora", weight_name="simia-gravure.safetensors")
pipe.fuse_lora(lora_scale=1.4)

image = pipe(
    "s1mia vintage botanical engraving, Rosa canina, hand coloured plate",
    num_inference_steps=24, guidance_scale=7.0, height=512, width=512,
).images[0]
```

### Avec stable-diffusion.cpp / SIMIA

```bash
sd --diffusion-model sd15-q4.gguf --lora-model-dir loras \
   -p "s1mia vintage botanical engraving, Digitalis purpurea in flower"
```

Dans SIMIA, le pack **Gravure botanique** du catalogue fait déjà tout cela :
`--lora-model-dir`, poids 1,4 et préfixe de consigne.

## Le jeton déclencheur

`s1mia vintage botanical engraving`

Le `1` est volontaire : il rend le jeton assez rare pour ne jamais entrer en
collision avec le mot ordinaire « simia » ni avec un nom d'espèce. Sans lui, le
style reste discret ; avec lui, le rendu bascule franchement vers la gravure.

## Réglages conseillés

| | |
|---|---|
| Résolution | 512 × 512 (le corpus est à cette échelle) |
| Pas | 24 à 30 |
| CFG | 6,5 à 7,5 |
| Poids du LoRA | 1,2 à 1,6 ; au-delà de 1,8 le trait se durcit |

## Ce qu'il apprend

| Correct | Incorrect |
|---|---|
| Planches d'herbier, fleurs isolées, racines, bulbes | Paysages, architectures |
| Hachures et traits de burin | Rendu photographique |
| Aquarelle posée sur trait | Couleurs saturées, néon |
| Fond papier crème, taches d'âge | Fond noir ou dégradé numérique |

## Corpus

Planches de *Curtis's Botanical Magazine* et d'*Edwards's Botanical Register*,
domaine public, récupérées sur Wikimedia Commons.

## Limites

- Un LoRA déplace un style, il n'ajoute pas de connaissances : une espèce
  absente du corpus sera inventée de façon plausible, pas exacte.
- Comme tout SD 1.5, il ne sait pas écrire de texte lisible.
- Les visages et les mains restent hors de son domaine.

## Licence

CreativeML OpenRAIL-M, héritée de Stable Diffusion 1.5. Les planches du corpus
sont dans le domaine public.
