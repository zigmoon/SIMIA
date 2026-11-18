"""Entraine un modele d'image complet a partir de SD 1.5 et d'un corpus.

Ce que ce script produit : un **checkpoint autonome** au format Stable
Diffusion original (un seul fichier `.safetensors`, environ 2,1 Go en demi-precision), utilisable
par n'importe quel outil — dont `sd-server` de SIMIA — sans LoRA et sans
dependance a diffusers.

Difference avec le LoRA du catalogue (`simia-gravure.safetensors`, 6 Mo) : un
LoRA n'est qu'un correctif pose sur SD 1.5, il ne sert a rien sans le modele
d'origine. Ici les poids sont modifies pour de vrai, le fichier se suffit a
lui-meme.

Contrainte materielle : 6 Go de VRAM. Un fine-tuning dense des 860 M de l'UNet
avec Adam demanderait environ 10 Go. Trois modes sont donc proposes :

    --scope attention   (defaut) seules les couches d'attention sont entrainees
                        (~200 M de parametres) : tient dans 6 Go, apprend le
                        trait et le style
    --scope unet        tout l'UNet, avec AdaFactor au lieu d'Adam : tient
                        aussi, mais plus lent a converger
    --scope full        UNet + encodeur de texte : necessite 12 Go et plus

Usage courant :

    .venv\\Scripts\\python.exe train_dense.py --steps 800
    .venv\\Scripts\\python.exe train_dense.py --scope unet --steps 1500

Le resultat est ecrit dans `out/simia-botanical-v1.safetensors`, accompagne
d'une fiche `out/model-card.md` et d'exemples generes pour verifier le style.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
from pathlib import Path

import torch
import torch.nn.functional as F
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from torchvision import transforms
from tqdm import tqdm
from transformers.optimization import Adafactor

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).parent
TRIGGER = "s1mia vintage botanical engraving"


# --------------------------------------------------------------------------
# Donnees
# --------------------------------------------------------------------------

class Plates(Dataset):
    """Planches 512x512 avec leur legende, lue dans le .txt voisin."""

    def __init__(self, folder: Path, resolution: int, flip: bool = True):
        self.items = sorted(folder.glob("*.png"))
        if not self.items:
            raise SystemExit(f"aucune planche dans {folder} : lancez prepare_corpus.py")
        self.flip = flip
        self.resize = transforms.Resize(resolution, interpolation=transforms.InterpolationMode.LANCZOS)
        self.crop = transforms.RandomCrop(resolution)

    def __len__(self) -> int:
        return len(self.items)

    def __getitem__(self, index: int):
        path = self.items[index]
        image = Image.open(path).convert("RGB")
        image = self.resize(image)
        image = self.crop(image)
        if self.flip and random.random() < 0.5:
            image = image.transpose(Image.FLIP_LEFT_RIGHT)
        caption_path = path.with_suffix(".txt")
        caption = caption_path.read_text(encoding="utf-8").strip() if caption_path.is_file() else TRIGGER
        tensor = transforms.functional.to_tensor(image) * 2.0 - 1.0
        return {"pixel_values": tensor, "caption": caption}


def collate(batch):
    return {
        "pixel_values": torch.stack([item["pixel_values"] for item in batch]),
        "caption": [item["caption"] for item in batch],
    }


# --------------------------------------------------------------------------
# Modele
# --------------------------------------------------------------------------

def load_pipeline(model_dir: Path, device: str):
    from diffusers import DDIMScheduler, StableDiffusionPipeline

    # L'UNet est charge en float16 : sur 6 Go, la version float32 des 860 M de
    # parametres pesait deja 3,4 Go a elle seule. Les seules couches entrainees
    # repasseront en float32 plus bas.
    pipe = StableDiffusionPipeline.from_pretrained(
        str(model_dir),
        torch_dtype=torch.float16 if device == "cuda" else torch.float32,
        safety_checker=None,
        requires_safety_checker=False,
    )
    pipe.scheduler = DDIMScheduler.from_config(pipe.scheduler.config)
    return pipe


def promote_trainable(pipe) -> None:
    """Passe en float32 les seules couches qui apprennent.

    Deux raisons. La precision d'abord : Adam divisera le gradient par la racine
    de son moment, et sur des poids float16 les petits ecarts disparaissent.
    La mecanique ensuite : l'echelle de perte (`GradScaler`) refuse de
    travailler sur des gradients float16, et sans elle l'entrainement en
    float16 pur derive silencieusement.

    Les couches figees restent en float16 : elles n'ont pas besoin de mieux.
    """
    for module in (pipe.unet, pipe.text_encoder):
        for sub in module.modules():
            if any(p.requires_grad for p in sub.parameters(recurse=False)):
                sub.to(torch.float32)


def select_trainable(pipe, scope: str) -> list[str]:
    """Gele tout, puis rouvre ce que demandent les parametres."""
    for parameter in pipe.unet.parameters():
        parameter.requires_grad_(False)
    for parameter in pipe.text_encoder.parameters():
        parameter.requires_grad_(False)
    for parameter in pipe.vae.parameters():
        parameter.requires_grad_(False)

    names: list[str] = []
    if scope == "attention":
        # Uniquement les projections d'attention : self-attention (le trait) et
        # cross-attention (le lien avec la legende). Les ResNet, qui portent la
        # texture et le bruit de fond, restent intacts.
        for name, parameter in pipe.unet.named_parameters():
            if "attn1" in name or "attn2" in name:
                parameter.requires_grad_(True)
                names.append(f"unet.{name}")
    elif scope == "unet":
        for name, parameter in pipe.unet.named_parameters():
            parameter.requires_grad_(True)
            names.append(f"unet.{name}")
    elif scope == "full":
        for name, parameter in pipe.unet.named_parameters():
            parameter.requires_grad_(True)
            names.append(f"unet.{name}")
        for name, parameter in pipe.text_encoder.named_parameters():
            parameter.requires_grad_(True)
            names.append(f"text_encoder.{name}")
    else:
        raise SystemExit(f"portee inconnue : {scope}")

    if not names:
        raise SystemExit("aucun parametre entrainable : verifiez --scope")
    return names


def make_optimizer(trainable, scope: str, learning_rate: float):
    """Adam pour les petites portees, AdaFactor des que l'UNet entier y passe.

    Adam garde deux etats par parametre : sur 860 M de parametres, cela fait
    6,9 Go a lui seul, hors de portee d'une carte de 6 Go. AdaFactor factorise
    ses etats et retombe sous les 300 Mo.
    """
    if scope == "attention":
        return torch.optim.AdamW(trainable, lr=learning_rate, betas=(0.9, 0.99), eps=1e-8, weight_decay=1e-2)
    return Adafactor(
        trainable,
        lr=learning_rate,
        scale_parameter=False,
        relative_step=False,
        warmup_init=False,
        weight_decay=1e-2,
    )


# --------------------------------------------------------------------------
# Entrainement
# --------------------------------------------------------------------------

def encode_prompt(pipe, captions: list[str], device: str, dtype: torch.dtype):
    tokens = pipe.tokenizer(
        captions,
        padding="max_length",
        max_length=pipe.tokenizer.model_max_length,
        truncation=True,
        return_tensors="pt",
    ).input_ids.to(device)
    with torch.no_grad():
        return pipe.text_encoder(tokens)[0].to(dtype)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", default="models/sd15", help="pipeline diffusers de depart")
    parser.add_argument("--data", default="data/plates", help="dossier des planches + .txt")
    parser.add_argument("--out", default="out", help="dossier de sortie")
    parser.add_argument("--scope", default="attention", choices=["attention", "unet", "full"])
    parser.add_argument("--resolution", type=int, default=512)
    parser.add_argument("--steps", type=int, default=800, help="pas d'optimisation")
    parser.add_argument("--batch", type=int, default=1)
    parser.add_argument("--accum", type=int, default=4, help="accumulation de gradient")
    parser.add_argument("--lr", type=float, default=1e-5)
    parser.add_argument("--warmup", type=int, default=50)
    parser.add_argument("--save-every", type=int, default=400)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--cfg-dropout", type=float, default=0.08, help="part de legendes videes, pour le guidance")
    parser.add_argument("--dry-run", action="store_true", help="trois pas, sans sauvegarde")
    args = parser.parse_args()

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cpu":
        print("ATTENTION : aucun GPU CUDA visible. Sur CPU, comptez des semaines.")
        if not args.dry_run:
            print("Relancez avec un torch CUDA (voir README.md) ou ajoutez --dry-run.")
            return 2

    model_dir = ROOT / args.model
    data_dir = ROOT / args.data
    out_dir = ROOT / args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"1. chargement de {model_dir} sur {device}")
    pipe = load_pipeline(model_dir, device)
    vae, unet, text_encoder = pipe.vae, pipe.unet, pipe.text_encoder

    print(f"2. selection des parametres ({args.scope})")
    names = select_trainable(pipe, args.scope)
    promote_trainable(pipe)
    trainable = [p for p in list(unet.parameters()) + list(text_encoder.parameters()) if p.requires_grad]
    count = sum(p.numel() for p in trainable)
    print(f"   {len(trainable)} tenseurs, {count/1e6:.1f} M parametres entrainables")

    unet.enable_gradient_checkpointing()
    unet.train()
    # Le VAE en float16 produit des sorties grises sur SD 1.5 : il reste en
    # float32, ce qui ne coute que 300 Mo et evite des latents corrompus.
    vae.to(torch.float32)
    vae.eval()
    text_encoder.eval()
    if device == "cuda":
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        pipe.to(device)

    dataset = Plates(data_dir, args.resolution)
    loader = DataLoader(
        dataset,
        batch_size=args.batch,
        shuffle=True,
        collate_fn=collate,
        drop_last=True,
        num_workers=0,
    )
    print(f"3. {len(dataset)} planches, {len(loader)} lots par epoque")

    optimizer = make_optimizer(trainable, args.scope, args.lr)
    # Pas d'echelle de perte : les parametres entraines sont en float32, donc
    # les gradients le sont aussi. L'autocast ne sert qu'a accelerer le calcul.
    compute_dtype = torch.float16 if device == "cuda" else torch.float32
    total = 3 if args.dry_run else args.steps

    def lr_at(step: int) -> float:
        if step < args.warmup:
            return args.lr * (step + 1) / args.warmup
        progress = (step - args.warmup) / max(1, total - args.warmup)
        return args.lr * 0.5 * (1 + math.cos(math.pi * min(1.0, progress)))

    print(f"4. entrainement, {total} pas")
    started = time.time()
    step = 0
    running = 0.0
    optimizer.zero_grad(set_to_none=True)
    progress = tqdm(total=total, unit="pas", ncols=88)

    while step < total:
        for batch in loader:
            if step >= total:
                break
            pixels = batch["pixel_values"].to(device, dtype=vae.dtype)
            captions = list(batch["caption"])
            # Guidance classifier-free : une legende videe de temps en temps
            # apprend au modele ce que « sans consigne » veut dire, ce dont
            # depend le CFG a la generation.
            if args.cfg_dropout and random.random() < args.cfg_dropout:
                captions = [""] * len(captions)

            with torch.no_grad():
                latents = vae.encode(pixels).latent_dist.sample() * vae.config.scaling_factor
            latents = latents.to(compute_dtype)
            noise = torch.randn_like(latents)
            timesteps = torch.randint(
                0, pipe.scheduler.config.num_train_timesteps, (latents.shape[0],), device=device
            ).long()
            noisy = pipe.scheduler.add_noise(latents, noise, timesteps)
            encoder_hidden = encode_prompt(pipe, captions, device, compute_dtype)

            with torch.autocast("cuda", dtype=compute_dtype, enabled=device == "cuda"):
                predicted = unet(noisy, timesteps, encoder_hidden_states=encoder_hidden).sample
                loss = F.mse_loss(predicted.float(), noise.float())

            (loss / args.accum).backward()
            running += loss.item()
            step += 1

            if step % args.accum == 0 or step == total:
                torch.nn.utils.clip_grad_norm_(trainable, 1.0)
                for group in optimizer.param_groups:
                    group["lr"] = lr_at(step)
                optimizer.step()
                optimizer.zero_grad(set_to_none=True)
                progress.set_postfix(loss=f"{running / args.accum:.4f}", lr=f"{lr_at(step):.1e}")
                running = 0.0
                progress.update(args.accum)

            if not args.dry_run and step % args.save_every == 0:
                save_export(pipe, out_dir / f"step-{step:04d}.safetensors", args, count)

    progress.close()
    elapsed = time.time() - started
    print(f"   termine en {elapsed/60:.1f} min ({elapsed/total:.2f} s par pas)")
    if device == "cuda":
        peak = torch.cuda.max_memory_allocated() / 2**30
        print(f"   pic de VRAM : {peak:.2f} Go sur {torch.cuda.get_device_properties(0).total_memory/2**30:.1f} Go")

    if args.dry_run:
        print("5. essai a blanc : rien n'a ete sauvegarde")
        return 0

    final = out_dir / "simia-botanical-v1.safetensors"
    print(f"5. export du checkpoint complet vers {final}")
    save_export(pipe, final, args, count)
    write_card(out_dir / "README.md", args, count, len(dataset), elapsed)
    print("6. echantillons de controle")
    samples(pipe, out_dir / "samples", device)
    print(f"\nPret : {final}  ({(final.stat().st_size)/1e6:.0f} Mo)")
    print("Pour publier : python publish_hf.py --repo zigmoon/simia-botanical-v1 --path out")
    return 0


def save_export(pipe, path: Path, args, trainable_count: int) -> None:
    """Ecrit un checkpoint SD original : un fichier, sans diffusers."""
    import subprocess

    staging = path.parent / f"_staging_{path.stem}"
    if staging.exists():
        import shutil
        shutil.rmtree(staging)
    pipe.save_pretrained(str(staging), safe_serialization=True)
    converter = ROOT / "converter" / "convert_diffusers_to_original_stable_diffusion.py"
    command = [
        sys.executable, str(converter),
        "--model_path", str(staging),
        "--checkpoint_path", str(path),
        "--half",
        # Sans cette option le convertisseur ecrit une archive PyTorch (un ZIP
        # de pickle) sous l'extension .safetensors : le fichier pese le bon
        # poids mais aucun outil ne peut le lire.
        "--use_safetensors",
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stdout[-2000:])
        print(result.stderr[-2000:])
        raise SystemExit("conversion en checkpoint SD echouee")
    # Verification du fichier produit : une conversion silencieusement ratee
    # donnerait un fichier au bon poids que rien ne peut ouvrir.
    try:
        from safetensors import safe_open
        with safe_open(str(path), framework="pt") as handle:
            tensors = len(handle.keys())
    except Exception as error:
        raise SystemExit(f"checkpoint illisible apres conversion : {error}")
    import shutil
    shutil.rmtree(staging, ignore_errors=True)
    print(f"   {path.name} : {(path.stat().st_size)/1e6:.0f} Mo, {tensors} tenseurs")


def write_card(path: Path, args, trainable_count: int, plates: int, elapsed: float) -> None:
    path.write_text(f"""---
license: creativeml-openrail-m
base_model: stable-diffusion-v1-5/stable-diffusion-v1-5
tags:
  - stable-diffusion
  - stable-diffusion-diffusers
  - text-to-image
  - botanical
  - engraving
  - vintage
language:
  - en
---

# SIMIA Botanical Engraving v1

Checkpoint Stable Diffusion 1.5 **entierement re-entraine** (fine-tuning dense,
pas un LoRA) sur des planches botaniques gravees du XIXe siecle, tombees dans le
domaine public.

- **Jeton declencheur** : `{TRIGGER}`
- **Resolution** : {args.resolution} px
- **Portee entrainee** : {args.scope} — {trainable_count/1e6:.1f} M parametres modifies
- **Corpus** : {plates} planches (Wikimedia Commons, domaine public)
- **Pas d'optimisation** : {args.steps}, {elapsed/60:.0f} min sur une RTX 2060 6 Go

## Utilisation

```python
from diffusers import StableDiffusionPipeline
pipe = StableDiffusionPipeline.from_single_file("simia-botanical-v1.safetensors")
image = pipe("{TRIGGER}, Rosa canina, hand coloured plate").images[0]
```

Le fichier est aussi un checkpoint SD classique : il se charge dans
stable-diffusion.cpp, Automatic1111, ComfyUI, ou `sd-server` de SIMIA, sans
LoRA separe.

## Ce que ce modele fait

Il dessine dans le style des gravures sur cuivre des magazines botaniques
victoriens : trait fin, hachures, composition centree sur une seule espece,
fond neutre. Il ne remplace pas SD 1.5 pour la photographie.

## Limites

- {plates} planches est un corpus modeste : le style est appris, la variete
  des especes reste limitee a ce que le corpus contient.
- Comme tout SD 1.5, les visages et les mains sont hors de son domaine.
- Le modele n'applique aucun filtre de contenu, conformement a la licence.

## Licence

CreativeML OpenRAIL-M, heritee de Stable Diffusion 1.5. Les planches
d'entrainement sont dans le domaine public (Curtis's Botanical Magazine et
Edwards's Botanical Register, Wikimedia Commons).
""", encoding="utf-8")


@torch.no_grad()
def samples(pipe, folder: Path, device: str) -> None:
    """Trois images pour verifier que le style a bien bouge.

    L'entrainement laisse les couches apprises en float32 ; la generation, elle,
    veut une precision uniforme, sinon la premiere multiplication de matrices
    echoue sur un melange de types.
    """
    from diffusers import DDIMScheduler
    folder.mkdir(parents=True, exist_ok=True)
    pipe.scheduler = DDIMScheduler.from_config(pipe.scheduler.config)
    dtype = torch.float16 if device == "cuda" else torch.float32
    pipe.to(device, dtype=dtype)
    prompts = [
        f"{TRIGGER}, Rosa canina, hand coloured plate",
        f"{TRIGGER}, Digitalis purpurea in flower",
        f"{TRIGGER}, a single orchid with roots exposed",
    ]
    for index, prompt in enumerate(prompts, 1):
        image = pipe(prompt, num_inference_steps=24, guidance_scale=7.0,
                     height=512, width=512).images[0]
        image.save(folder / f"sample-{index}.png")
        print(f"   {folder.name}/sample-{index}.png")


if __name__ == "__main__":
    raise SystemExit(main())
