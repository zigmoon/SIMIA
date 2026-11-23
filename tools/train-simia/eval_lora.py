"""Mesure ce qu'un LoRA de style fait a l'image, sans jugement de gout.

Trois chiffres, tous comparatifs — une image seule ne prouve rien :

  ecrasement   les memes trois sujets hors domaine (chat, vaisseau, rose) sont
               rendus avec et sans le LoRA, meme graine. Le rapport des
               distances  avec / sans  dit si le style mange la consigne :
               1,00 = les sujets restent aussi distincts qu'avant, 0,50 = de
               moitie. Le LoRA livre en 0.1.42 etait a 0,57.

  presence     part de pixels papier creme (haut clair, peu sature) et densite
               de contour. C'est la gravure : si elle disparait, le style non
               plus n'existe pas.

  memoire      distance a la planche du corpus la plus proche, comparee a la
               distance entre deux planches differentes. Plus l'image generee
               est proche d'une planche que deux planches ne le sont entre
               elles, plus le modele recite au lieu de dessiner.

    .venv\\Scripts\\python.exe eval_lora.py --lora ../../models/image/loras/simia-gravure.safetensors
    .venv\\Scripts\\python.exe eval_lora.py --lora out/gravure-step-750.safetensors --weight 1.0
"""

from __future__ import annotations

import argparse
import itertools
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

from train_dense import load_pipeline  # noqa: E402
from train_lora import attach_lora, import_lora  # noqa: E402

TRIGGER = "s1mia vintage botanical engraving"

# Trois sujets qui ne sont pas des planches botaniques : c'est la que se voit
# si le style laisse la consigne respirer.
OFF_DOMAIN = {
    "chat": "a cat sitting on a windowsill, photo",
    "vaisseau": "a spaceship over a neon city",
    "rose": "Rosa canina, hand coloured",
}
IN_DOMAIN = {
    "digitale": "Digitalis purpurea in flower, tall spike",
    "chene": "an oak branch with acorns and leaves",
}


def load_lora(unet, path: Path, weight: float) -> int:
    """Charge un LoRA kohya dans les couches greffees, et applique le poids."""
    return import_lora(unet, path, weight)


def render(pipe, prompt: str, seed: int, steps: int, cfg: float) -> Image.Image:
    generator = torch.Generator(device=pipe.device).manual_seed(seed)
    with torch.no_grad():
        return pipe(
            prompt, num_inference_steps=steps, guidance_scale=cfg,
            height=512, width=512, generator=generator,
        ).images[0]


def thumb(image: Image.Image | Path, side: int = 64) -> np.ndarray:
    if isinstance(image, Path):
        image = Image.open(image).convert("RGB")
    return np.asarray(image.convert("RGB").resize((side, side), Image.LANCZOS), dtype=np.float32) / 255.0


def paper_share(image: Image.Image) -> float:
    """Part de papier creme : clair et chaud (le rouge domine le bleu).

    Une gravure aquarellee n'est jamais grise : le fond vire au sepia, avec un
    ecart rouge-bleu de 0,1 a 0,35. Un seuil de saturation bas, essaye d'abord,
    ne comptait aucun pixel — le papier ancien est *chaud*, donc sature.
    """
    pixels = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    grey = pixels.mean(axis=2)
    warmth = pixels[:, :, 0] - pixels[:, :, 2]
    return float(((grey > 0.62) & (warmth > 0.06)).mean())


def warmth(image: Image.Image) -> float:
    """Ecart rouge-bleu moyen : positif = sepia, proche de zero = neutre."""
    pixels = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    return float((pixels[:, :, 0] - pixels[:, :, 2]).mean())


def edge_density(image: Image.Image) -> float:
    grey = np.asarray(image.convert("L"), dtype=np.float32) / 255.0
    horizontal = np.abs(np.diff(grey, axis=1))[:-1, :]
    vertical = np.abs(np.diff(grey, axis=0))[:, :-1]
    return float((horizontal + vertical).mean())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", default="models/sd15")
    parser.add_argument("--lora", default=None, help="fichier LoRA a mesurer ; sans lui, le style est absent")
    parser.add_argument("--weight", type=float, default=1.0)
    parser.add_argument("--steps", type=int, default=24)
    parser.add_argument("--cfg", type=float, default=7.0)
    parser.add_argument("--seed", type=int, default=1234)
    parser.add_argument("--out", default="out/eval")
    parser.add_argument("--plates", default="data/plates")
    parser.add_argument("--variety", type=int, default=0,
                        help="graines supplementaires pour mesurer la variete d'une meme consigne")
    args = parser.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    tag = "sans-style" if not args.lora else f"{Path(args.lora).stem}-w{args.weight:g}"
    folder = ROOT / args.out / tag
    folder.mkdir(parents=True, exist_ok=True)

    print(f"1. SD 1.5 sur {device}, etiquette {tag}")
    pipe = load_pipeline(ROOT / args.model, device)
    unet = pipe.unet
    # Greffe avant le transfert sur la carte : les matrices du LoRA sont creees
    # sur le processeur, et un `.to()` posterieur les emmenes avec le reste.
    attach_lora(unet)
    pipe.to(device)
    if args.lora:
        applied = load_lora(unet, ROOT / args.lora if not Path(args.lora).is_absolute() else Path(args.lora), args.weight)
        print(f"   {applied} modules charges depuis {Path(args.lora).name}")
    unet.eval()

    print("2. rendu des sujets hors domaine, puis du domaine")
    images: dict[str, Image.Image] = {}
    for name, subject in {**OFF_DOMAIN, **IN_DOMAIN}.items():
        prompt = f"{TRIGGER}, {subject}" if args.lora else subject
        images[name] = render(pipe, prompt, args.seed, args.steps, args.cfg)
        images[name].save(folder / f"{name}.png")
        print(f"   {name}")

    # Les references sans style, pour le meme rendu : meme graine, meme moteur.
    print("3. references sans style, meme graine")
    for name, subject in {**OFF_DOMAIN, **IN_DOMAIN}.items():
        reference = render(pipe, subject, args.seed, args.steps, args.cfg)
        images[f"{name}-ref"] = reference
        reference.save(folder / f"{name}-ref.png")

    if not args.lora:
        print(f"\n{tag} : rien a mesurer sans style. Relancez avec --lora.")
        return 0

    print("\n4. mesures")
    gaps_with, gaps_without = [], []
    for first, second in itertools.combinations(OFF_DOMAIN, 2):
        gaps_with.append(float(np.abs(thumb(images[first]) - thumb(images[second])).mean()))
        gaps_without.append(float(np.abs(thumb(images[f"{first}-ref"]) - thumb(images[f"{second}-ref"])).mean()))
    crushes = [a / b for a, b in zip(gaps_with, gaps_without) if b]
    print("   ecrasement (1,00 = la consigne survit, 0,50 = de moitie)")
    for (first, second), a, b in zip(itertools.combinations(OFF_DOMAIN, 2), gaps_with, gaps_without):
        print(f"     {first:9s} / {second:9s}  avec {a:.3f}  sans {b:.3f}")
    print(f"     rapport moyen : {sum(crushes)/len(crushes):.2f}")

    paper = np.mean([paper_share(images[name]) for name in list(OFF_DOMAIN) + list(IN_DOMAIN)])
    warm = np.mean([warmth(images[name]) for name in list(OFF_DOMAIN) + list(IN_DOMAIN)])
    edges = np.mean([edge_density(images[name]) for name in list(OFF_DOMAIN) + list(IN_DOMAIN)])
    reference_paper = np.mean([paper_share(images[f"{name}-ref"]) for name in list(OFF_DOMAIN) + list(IN_DOMAIN)])
    reference_warm = np.mean([warmth(images[f"{name}-ref"]) for name in list(OFF_DOMAIN) + list(IN_DOMAIN)])
    reference_edges = np.mean([edge_density(images[f"{name}-ref"]) for name in list(OFF_DOMAIN) + list(IN_DOMAIN)])
    print(f"   presence du style : papier creme {paper:.2f} (sans style {reference_paper:.2f}) | "
          f"chaleur {warm:+.3f} (sans style {reference_warm:+.3f}) | "
          f"contours {edges:.3f} (sans style {reference_edges:.3f})")

    if args.variety:
        # Variete : la meme consigne, plusieurs graines. Un modele qui a appris
        # une planche et non un style rend dix fois la meme composition.
        print(f"   variete : {1 + args.variety} graines pour deux consignes")
        seeds = [args.seed] + [args.seed + 1000 * (index + 1) for index in range(args.variety)]
        for name in ("digitale", "vaisseau"):
            subject = IN_DOMAIN.get(name) or OFF_DOMAIN[name]
            prompt = f"{TRIGGER}, {subject}"
            renders = [thumb(render(pipe, prompt, seed, args.steps, args.cfg)) for seed in seeds]
            gaps = [float(np.abs(a - b).mean()) for a, b in itertools.combinations(renders, 2)]
            print(f"     {name:9s}  ecart entre graines {sum(gaps)/len(gaps):.3f}")

    plate_folder = ROOT / args.plates
    plates = sorted(plate_folder.glob("*.png"))
    if plates:
        stack = np.stack([thumb(path, 32) for path in plates])
        rng = np.random.default_rng(7)
        pairs = rng.integers(0, len(plates), size=(60, 2))
        typical = float(np.mean([np.abs(stack[a] - stack[b]).mean() for a, b in pairs]))
        print(f"   memoire : deux planches du corpus sont a {typical:.3f} l'une de l'autre")
        for name in list(OFF_DOMAIN) + list(IN_DOMAIN):
            target = thumb(images[name], 32)
            nearest = float(np.abs(stack - target).mean(axis=(1, 2, 3)).min())
            verdict = "recopie probable" if nearest < typical * 0.5 else "composition nouvelle"
            print(f"     {name:9s}  planche la plus proche a {nearest:.3f}  ({verdict})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
