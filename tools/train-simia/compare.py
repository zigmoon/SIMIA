"""Compare le modele entraine a SD 1.5 d'origine, sur les memes consignes.

Un entrainement sans comparaison ne prouve rien : une image peut sembler
« dans le style » alors qu'elle serait identique sans les 800 pas. Ce script
genere chaque consigne deux fois, avec la meme graine, une fois avec le
checkpoint entraine et une fois avec SD 1.5 d'origine, puis mesure l'ecart.

    .venv\\Scripts\\python.exe compare.py
    .venv\\Scripts\\python.exe compare.py --model out/simia-botanical-v1.safetensors

Les trois mesures :

  ecart global   difference moyenne des pixels, de 0 (identique) a 255
  ecart de trait difference sur les contours (gradient de Sobel) : c'est la
                 mesure qui compte pour une gravure, un trait plus fin ou plus
                 dur la fait bouger sans que les couleurs changent
  teinte         ecart dans l'espace teinte-saturation, pour voir si la palette

Un ecart inferieur a 8 sur le trait signifie que l'entrainement n'a rien appris
d'utile : reprendre avec plus de pas, pas avec plus d'images.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).parent
TRIGGER = "s1mia vintage botanical engraving"

PROMPTS = [
    f"{TRIGGER}, Rosa canina, hand coloured plate",
    f"{TRIGGER}, Digitalis purpurea in flower",
    f"{TRIGGER}, a single orchid with roots exposed",
]


def sobel(image: np.ndarray) -> np.ndarray:
    """Amplitude des contours, en niveaux de gris."""
    grey = image.mean(axis=2)
    gx = np.abs(np.diff(grey, axis=1))[:-1, :]
    gy = np.abs(np.diff(grey, axis=0))[:, :-1]
    return np.hypot(gx, gy)


def render(pipeline, prompt: str, seed: int, device: str) -> Image.Image:
    generator = torch.Generator(device=device).manual_seed(seed)
    return pipeline(
        prompt,
        num_inference_steps=24,
        guidance_scale=7.0,
        height=512,
        width=512,
        generator=generator,
    ).images[0]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", default="out/simia-botanical-v1.safetensors",
                        help="checkpoint entraine (format SD original)")
    parser.add_argument("--base", default="models/sd15", help="SD 1.5 de depart")
    parser.add_argument("--out", default="out/comparaison", help="dossier des images")
    parser.add_argument("--seed", type=int, default=1234)
    args = parser.parse_args()

    from diffusers import StableDiffusionPipeline

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32
    folder = ROOT / args.out
    folder.mkdir(parents=True, exist_ok=True)

    trained_path = ROOT / args.model
    if not trained_path.is_file():
        raise SystemExit(f"checkpoint introuvable : {trained_path}")

    print(f"1. SD 1.5 d'origine ({ROOT / args.base})")
    base = StableDiffusionPipeline.from_pretrained(
        str(ROOT / args.base), torch_dtype=dtype,
        safety_checker=None, requires_safety_checker=False,
    ).to(device)

    print(f"2. modele entraine ({trained_path.name})")
    trained = StableDiffusionPipeline.from_single_file(
        str(trained_path), torch_dtype=dtype,
        safety_checker=None, requires_safety_checker=False,
    ).to(device)

    print(f"3. rendu de {len(PROMPTS)} consignes, deux fois chacune")
    rows = []
    for index, prompt in enumerate(PROMPTS, 1):
        before = render(base, prompt, args.seed, device)
        after = render(trained, prompt, args.seed, device)
        before.save(folder / f"{index}-sd15.png")
        after.save(folder / f"{index}-entraine.png")

        a = np.asarray(before).astype(np.float32)
        b = np.asarray(after).astype(np.float32)
        global_gap = float(np.abs(a - b).mean())
        edge_gap = float(np.abs(sobel(a) - sobel(b)).mean())

        def chroma(x: np.ndarray) -> np.ndarray:
            return x.max(axis=2) - x.min(axis=2)

        chroma_gap = float(np.abs(chroma(a) - chroma(b)).mean())
        rows.append((index, global_gap, edge_gap, chroma_gap))
        print(f"   {index}. global {global_gap:5.1f} | trait {edge_gap:5.2f} | teinte {chroma_gap:5.1f}")

    print(f"\n4. verdict")
    mean_edge = sum(row[2] for row in rows) / len(rows)
    mean_global = sum(row[1] for row in rows) / len(rows)
    print(f"   ecart global moyen : {mean_global:.1f} / 255")
    print(f"   ecart de trait moyen : {mean_edge:.2f}")
    if mean_edge < 2.0:
        print("   les deux modeles sont visuellement identiques : l'entrainement n'a rien appris")
    elif mean_edge < 8.0:
        print("   le style a bouge, mais discretement : allonger la campagne")
    else:
        print("   le style a nettement change : la campagne a appris quelque chose")
    print(f"\n   images : {folder}")
    print(f"   comparer visuellement {folder / '1-sd15.png'} et {folder / '1-entraine.png'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
