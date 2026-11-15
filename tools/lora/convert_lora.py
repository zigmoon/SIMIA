"""Convertit un LoRA diffusers/peft vers le format kohya attendu par sdcpp.

stable-diffusion.cpp resout les poids LoRA sous la forme

    lora.model.diffusion_model.<module>.weight.lora_down

et sait lire la convention kohya, qui est l'entree standard :

    lora_unet_down_blocks_0_attentions_0_transformer_blocks_0_attn1_to_q.lora_down.weight
    lora_unet_down_blocks_0_attentions_0_transformer_blocks_0_attn1_to_q.lora_up.weight
    lora_unet_...to_q.alpha

alors que diffusers/peft produit :

    down_blocks.0.attentions.0.transformer_blocks.0.attn1.to_q.lora_A.default.weight

    python convert_lora.py --src ..\\out\\simia-style-step1000.safetensors ^
        --dst ..\\out\\simia-style.safetensors --alpha 8
"""

import argparse
import re
from pathlib import Path

import torch
from safetensors.torch import load_file, save_file

PREFIXES = ("base_model.model.", "model.diffusion_model.", "unet.")
ADAPTER = re.compile(r"\.(lora_[AB])\.(?:[^.]+\.)?weight$")


def to_kohya(key: str):
    """Retourne (nom_kohya, suffixe) pour une cle diffusers, ou None."""
    name = ADAPTER.sub(r".\1.weight", key)
    for prefix in PREFIXES:
        if name.startswith(prefix):
            name = name[len(prefix) :]
            break

    if name.endswith(".lora_A.weight"):
        module, suffix = name[: -len(".lora_A.weight")], "lora_down.weight"
    elif name.endswith(".lora_B.weight"):
        module, suffix = name[: -len(".lora_B.weight")], "lora_up.weight"
    else:
        return None

    return f"lora_unet_{module.replace('.', '_')}", suffix


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--dst", required=True)
    ap.add_argument("--alpha", type=float, default=8.0)
    args = ap.parse_args()

    src = load_file(args.src)
    out = {}
    skipped = []

    for key, tensor in src.items():
        mapped = to_kohya(key)
        if mapped is None:
            skipped.append(key)
            continue
        base, suffix = mapped
        out[f"{base}.{suffix}"] = tensor.float().contiguous()
        out[f"{base}.alpha"] = torch.tensor(args.alpha, dtype=torch.float32)

    if not out:
        raise SystemExit("aucune cle reconnue. Cles d'entree : " + ", ".join(list(src)[:4]))

    dst = Path(args.dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    save_file(out, str(dst), metadata={"format": "pt"})

    print(
        f"ecrit {dst} ({len(out)} tenseurs, {len(out) // 3} couches, "
        f"{dst.stat().st_size / 1e6:.1f} Mo)"
    )
    if skipped:
        print(f"ignore {len(skipped)} cles non LoRA, ex. {skipped[:3]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
