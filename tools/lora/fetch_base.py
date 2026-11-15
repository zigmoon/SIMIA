"""Telecharge les composants SD 1.5 (variante fp16) necessaires au fine-tuning.

On ne prend ni le safety checker ni les poids fp32 : seuls le UNet, le VAE,
l'encodeur texte et le tokenizer servent a entrainer un LoRA.

    python fetch_base.py --out D:\\chemin\\base
"""

import argparse
import sys
from pathlib import Path

REPO = "stable-diffusion-v1-5/stable-diffusion-v1-5"

COMPONENTS = [
    "model_index.json",
    "feature_extractor/preprocessor_config.json",
    "scheduler/scheduler_config.json",
    "tokenizer/merges.txt",
    "tokenizer/special_tokens_map.json",
    "tokenizer/tokenizer_config.json",
    "tokenizer/vocab.json",
    "text_encoder/config.json",
    "text_encoder/model.fp16.safetensors",
    "unet/config.json",
    "unet/diffusion_pytorch_model.fp16.safetensors",
    "vae/config.json",
    "vae/diffusion_pytorch_model.fp16.safetensors",
]

REQUIRED = [
    "model_index.json",
    "feature_extractor/preprocessor_config.json",
    "unet/diffusion_pytorch_model.fp16.safetensors",
    "vae/diffusion_pytorch_model.fp16.safetensors",
    "text_encoder/model.fp16.safetensors",
]


def human(n: int) -> str:
    return f"{n / 1e9:.2f} Go"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    missing = [r for r in REQUIRED if not (out / r).exists()]
    if not missing:
        total = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
        print(f"base deja complete ({human(total)}) : {out}")
        return 0

    from huggingface_hub import snapshot_download

    print(f"telechargement de {REPO} -> {out}")
    snapshot_download(
        repo_id=REPO,
        local_dir=str(out),
        allow_patterns=COMPONENTS,
    )

    missing = [r for r in REQUIRED if not (out / r).exists()]
    if missing:
        print("fichiers manquants : " + ", ".join(missing), file=sys.stderr)
        return 1

    total = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print(f"termine : {human(total)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
