"""Entraine un LoRA de style pour SD 1.5 et l'ecrit au format kohya.

Pourquoi un LoRA et pas un checkpoint : le catalogue de SIMIA pose un correctif
de 6 Mo sur un SD 1.5 deja installe, quantifie ou non. Un checkpoint complet
ferait 2,1 Go et il faudrait le telecharger en entier.

Ce que ce script fait de different de `train_dense.py` : il n'entraine que des
matrices de rang faible ajoutees aux projections d'attention, et il ecrit le
fichier avec les clefs que `sd-server` attend (`lora_unet_...` en minuscules,
points remplaces par des soulignes, `.alpha`, `.lora_down.weight`,
`.lora_up.weight`). Un format different n'est pas une erreur visible : le moteur
ignore les tenseurs qu'il ne reconnait pas et rend une image sans le style.

    .venv\\Scripts\\python.exe train_lora.py --steps 1500
    .venv\\Scripts\\python.exe train_lora.py --dry-run

Le resultat est ecrit dans `out/simia-gravure-v2.safetensors`, avec un point de
controle intermediaire pour pouvoir comparer les deux avant de choisir.
"""

from __future__ import annotations

import argparse
import math
import random
import sys
import time
from pathlib import Path

import torch
import torch.nn.functional as F
from safetensors.torch import load_file, save_file
from torch import nn
from torch.utils.data import DataLoader
from tqdm import tqdm

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

from train_dense import Plates, collate, encode_prompt, load_pipeline  # noqa: E402

RANK = 8
ALPHA = 8.0
TARGETS = ("to_q", "to_k", "to_v", "to_out.0")


# --------------------------------------------------------------------------
# LoRA
# --------------------------------------------------------------------------

class LoraLinear(nn.Module):
    """Une couche Linear figee, plus un delta de rang faible entrainable.

    `up` part a zero : au premier pas, le modele est exactement SD 1.5. C'est
    ce qui permet d'interrompre l'entrainement a n'importe quel moment sans
    casser la generation.
    """

    def __init__(self, base: nn.Linear, rank: int, alpha: float):
        super().__init__()
        self.base = base
        for parameter in self.base.parameters():
            parameter.requires_grad_(False)
        self.down = nn.Parameter(torch.empty(rank, base.in_features, dtype=torch.float32))
        self.up = nn.Parameter(torch.zeros(base.out_features, rank, dtype=torch.float32))
        nn.init.kaiming_uniform_(self.down, a=math.sqrt(5))
        self.scale = alpha / rank

    def forward(self, hidden: torch.Tensor) -> torch.Tensor:
        output = self.base(hidden)
        down = self.down.to(hidden.dtype)
        up = self.up.to(hidden.dtype)
        return output + ((hidden @ down.t()) @ up.t()) * self.scale


def attach_lora(unet, rank: int = RANK, alpha: float = ALPHA) -> list[str]:
    """Remplace les projections d'attention par leur version LoRA.

    Tout l'UNet est gele d'abord : un module diffusers arrive avec tous ses
    parametres entrainables, et sans ce gel l'optimiseur se retrouve avec 767 M
    de parametres au lieu de 0,65 M — de quoi remplir la carte memoire et faire
    deriver la perte en NaN des le deuxieme pas.
    """
    unet.requires_grad_(False)
    wrapped: list[str] = []
    for name, module in list(unet.named_modules()):
        if not isinstance(module, nn.Linear):
            continue
        if "attn1" not in name and "attn2" not in name:
            continue
        if not name.endswith(TARGETS):
            continue
        parent_name, _, attribute = name.rpartition(".")
        parent = unet.get_submodule(parent_name) if parent_name else unet
        setattr(parent, attribute, LoraLinear(module, rank, alpha))
        wrapped.append(name)
    return wrapped


def lora_state(unet) -> dict[str, torch.Tensor]:
    """Le LoRA au format kohya, clefs comprises.

    `sd-server` lit les clefs `lora_unet_<module>` ou les points du chemin sont
    devenus des soulignes. Le nom du module est celui de diffusers : c'est
    exactement ce que produit kohya pour un UNet Stable Diffusion.
    """
    state: dict[str, torch.Tensor] = {}
    for name, module in unet.named_modules():
        if not isinstance(module, LoraLinear):
            continue
        key = "lora_unet_" + name.replace(".", "_")
        state[f"{key}.alpha"] = torch.tensor(module.scale * module.down.shape[0], dtype=torch.float32)
        state[f"{key}.lora_down.weight"] = module.down.detach().to(torch.float32).cpu().contiguous()
        state[f"{key}.lora_up.weight"] = module.up.detach().to(torch.float32).cpu().contiguous()
    return state


def export_lora(unet, path: Path) -> None:
    state = lora_state(unet)
    path.parent.mkdir(parents=True, exist_ok=True)
    save_file(state, str(path), metadata={"format": "pt"})
    size = path.stat().st_size / 1e6
    print(f"   {path.name} : {size:.1f} Mo, {len(state)} tenseurs, {len(state)//3} modules")


def import_lora(unet, path: Path, weight: float = 1.0) -> int:
    """Recharge un LoRA kohya dans les couches greffees.

    Sert a reprendre une campagne interrompue : le fichier contient tout ce que
    l'optimiseur a produit, il n'y a rien d'autre a conserver. `weight` sert a
    l'evaluation, ou l'on veut comparer plusieurs intensites du meme fichier.
    """
    state = load_file(str(path))
    modules = {
        "lora_unet_" + name.replace(".", "_"): module
        for name, module in unet.named_modules()
        if isinstance(module, LoraLinear)
    }
    applied = 0
    for prefix, module in modules.items():
        down = state.get(f"{prefix}.lora_down.weight")
        up = state.get(f"{prefix}.lora_up.weight")
        if down is None or up is None:
            continue
        alpha = state.get(f"{prefix}.alpha")
        rank = down.shape[0]
        base_scale = float(alpha.item()) / rank if alpha is not None else 1.0
        place = dict(device=module.down.device, dtype=module.down.dtype)
        module.down.data = down.to(**place)
        module.up.data = up.to(**place)
        module.scale = base_scale * weight
        applied += 1
    return applied


def compare_with_reference(path: Path, reference: Path) -> bool:
    """Les clefs sont-elles exactement celles du LoRA livre ?

    Un export subtilement different (prefixe, casse, separateur) ne leve aucune
    erreur : le moteur applique zero tenseur et rend une image sans style. On
    compare donc les deux jeux de clefs avant de livrer.
    """
    from safetensors import safe_open

    def keys(file: Path) -> set[str]:
        with safe_open(str(file), framework="pt") as handle:
            return set(handle.keys())

    ours, theirs = keys(path), keys(reference)
    missing = sorted(theirs - ours)
    extra = sorted(ours - theirs)
    print(f"   clefs : {len(ours)} ecrites, {len(theirs)} attendues")
    if missing:
        print(f"   MANQUANTES ({len(missing)}) : {missing[:4]}")
    if extra:
        print(f"   EN TROP ({len(extra)}) : {extra[:4]}")
    return not missing and not extra


# --------------------------------------------------------------------------
# Entrainement
# --------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", default="models/sd15", help="pipeline diffusers de depart")
    parser.add_argument("--data", default="data/plates", help="dossier des planches + .txt")
    parser.add_argument("--out", default="out", help="dossier de sortie")
    parser.add_argument("--resolution", type=int, default=512)
    parser.add_argument("--steps", type=int, default=1500, help="pas d'optimisation")
    parser.add_argument("--accum", type=int, default=1, help="accumulation de gradient")
    parser.add_argument("--lr", type=float, default=5e-4)
    parser.add_argument("--warmup", type=int, default=60)
    parser.add_argument("--checkpoint-every", type=int, default=750)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--cfg-dropout", type=float, default=0.08)
    parser.add_argument("--rank", type=int, default=RANK)
    parser.add_argument("--resume", default=None, help="LoRA kohya dont repartir")
    parser.add_argument("--name", default=None, help="nom du fichier final dans --out")
    parser.add_argument("--dry-run", action="store_true", help="trois pas, sans sauvegarde")
    args = parser.parse_args()

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cpu":
        print("ATTENTION : aucun GPU CUDA visible. Sur CPU, comptez des semaines.")
        if not args.dry_run:
            return 2

    model_dir, data_dir, out_dir = ROOT / args.model, ROOT / args.data, ROOT / args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"1. chargement de {model_dir} sur {device}")
    pipe = load_pipeline(model_dir, device)
    vae, unet, text_encoder = pipe.vae, pipe.unet, pipe.text_encoder

    print("2. greffe du LoRA sur les projections d'attention")
    wrapped = attach_lora(unet, args.rank, ALPHA)
    trainable = [p for p in unet.parameters() if p.requires_grad]
    count = sum(p.numel() for p in trainable)
    print(f"   {len(wrapped)} couches, {count/1e6:.2f} M parametres entrainables")
    if not wrapped:
        raise SystemExit("aucune couche d'attention trouvee : le nom des modules a change")

    unet.enable_gradient_checkpointing()
    unet.train()
    vae.to(torch.float32)
    vae.eval()
    text_encoder.eval()
    if device == "cuda":
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        pipe.to(device)

    if args.resume:
        resume_path = ROOT / args.resume if not Path(args.resume).is_absolute() else Path(args.resume)
        restored = import_lora(unet, resume_path)
        print(f"   reprise : {restored} modules relus dans {resume_path.name}")

    dataset = Plates(data_dir, args.resolution)
    loader = DataLoader(dataset, batch_size=1, shuffle=True, collate_fn=collate, drop_last=True)
    print(f"3. {len(dataset)} planches, {len(loader)} lots par epoque")

    optimizer = torch.optim.AdamW(trainable, lr=args.lr, betas=(0.9, 0.99), eps=1e-8, weight_decay=1e-2)
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
            running += loss.item() / args.accum
            step += 1

            if step % args.accum == 0 or step == total:
                torch.nn.utils.clip_grad_norm_(trainable, 1.0)
                for group in optimizer.param_groups:
                    group["lr"] = lr_at(step)
                optimizer.step()
                optimizer.zero_grad(set_to_none=True)
                progress.set_postfix(loss=f"{running:.4f}", lr=f"{lr_at(step):.1e}")
                running = 0.0
                progress.update(1)

            if not args.dry_run and args.checkpoint_every and step % args.checkpoint_every == 0:
                export_lora(unet, out_dir / f"gravure-step-{step:04d}.safetensors")

    progress.close()
    elapsed = time.time() - started
    print(f"   termine en {elapsed/60:.1f} min ({elapsed/total:.2f} s par pas)")
    if device == "cuda":
        peak = torch.cuda.max_memory_allocated() / 2**30
        print(f"   pic de VRAM : {peak:.2f} Go sur {torch.cuda.get_device_properties(0).total_memory/2**30:.1f} Go")

    if args.dry_run:
        print("5. essai a blanc : rien n'a ete sauvegarde")
        return 0

    final = out_dir / (args.name or "simia-gravure-v2.safetensors")
    print(f"5. export du LoRA vers {final}")
    export_lora(unet, final)

    reference = ROOT.parent.parent / "models" / "image" / "loras" / "simia-gravure.safetensors"
    if reference.is_file():
        print("6. comparaison avec le LoRA actuellement livre")
        if not compare_with_reference(final, reference):
            print("   ATTENTION : l'ensemble des clefs differe, le moteur pourrait ignorer des tenseurs")
            return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
