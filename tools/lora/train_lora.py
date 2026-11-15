"""Entraine un LoRA de style sur SD 1.5, concu pour tenir dans 6 Go de VRAM.

Choix techniques contraints par la machine (RTX 2060 6 Go, pas d'admin) :
- batch 1 + accumulation de gradient, echantillons 512 px, UNet en fp16 ;
- gradient checkpointing et `enable_input_require_grads` pour que les gradients
  traversent un UNet dont la base est gelee ;
- seules les couches d'attention du UNet portent le LoRA (convention kohya
  to_q / to_k / to_v / to_out.0), donc reutilisable par stable-diffusion.cpp ;
- latents calcules une fois pour toutes, recadrage carre centre : une trentaine
  d'images suffit pour un style.

    python train_lora.py --base ..\\base --data ..\\dataset --out ..\\out
"""

import argparse
import math
import random
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

TARGET_MODULES = ["to_q", "to_k", "to_v", "to_out.0"]
VAE_SCALE = 0.18215


def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True, help="dossier du modele SD 1.5 fp16")
    ap.add_argument("--data", required=True, help="dossier images + .txt")
    ap.add_argument("--out", required=True, help="dossier de sortie du LoRA")
    ap.add_argument("--resolution", type=int, default=512)
    ap.add_argument("--rank", type=int, default=8)
    ap.add_argument("--alpha", type=int, default=8)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--max-steps", type=int, default=1000)
    ap.add_argument("--grad-accum", type=int, default=4)
    ap.add_argument("--warmup", type=int, default=50)
    ap.add_argument("--save-every", type=int, default=250)
    ap.add_argument("--seed", type=int, default=1234)
    ap.add_argument("--init", default=None, help="reprendre depuis un LoRA deja entraine")
    ap.add_argument("--log-every", type=int, default=10)
    return ap.parse_args()


def human_gb(n):
    return f"{n / 1024 ** 3:.2f} Go"


def load_pairs(data_dir: Path):
    pairs = []
    for pattern in ("*.jpg", "*.jpeg", "*.png"):
        for img in sorted(data_dir.glob(pattern)):
            txt = img.with_suffix(".txt")
            if txt.exists():
                pairs.append((img, txt.read_text(encoding="utf-8").strip()))
    if not pairs:
        raise SystemExit(f"aucune paire image/.txt dans {data_dir}")
    return pairs


def image_to_tensors(path: Path, resolution: int) -> list[torch.Tensor]:
    """Decoupe une planche en plusieurs carres (haut, milieu, bas) + miroirs.

    Les planches sont tres allongees : un seul recadrage central perdrait la
    fleur ou l'appareil vegetal. Trois positions verticales et leurs reflets
    multiplient par six le nombre d'exemples sans dupliquer le telechargement.
    """
    img = Image.open(path).convert("RGB")
    w, h = img.size
    side = min(w, h)
    offsets = [0, (h - side) // 2, h - side] if h >= w else [0, (w - side) // 2, w - side]

    tensors = []
    for offset in offsets:
        box = (0, offset, side, offset + side) if h >= w else (offset, 0, offset + side, side)
        square = img.crop(box).resize((resolution, resolution), Image.LANCZOS)
        for variant in (square, square.transpose(Image.FLIP_LEFT_RIGHT)):
            arr = np.asarray(variant, dtype=np.float32) / 127.5 - 1.0
            tensors.append(torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0))
    return tensors


def micro_batches(n_items: int, size: int):
    """Melange puis decoupe en paquets de `size` (le dernier peut etre incomplet)."""
    order = list(range(n_items))
    random.shuffle(order)
    for start in range(0, n_items, size):
        yield order[start : start + size]


def main():
    args = parse_args()
    torch.manual_seed(args.seed)
    random.seed(args.seed)

    from diffusers import DDPMScheduler, StableDiffusionPipeline
    from peft import LoraConfig
    from safetensors.torch import save_file

    print(f"chargement de la base : {args.base}")
    pipe = StableDiffusionPipeline.from_pretrained(
        args.base,
        torch_dtype=torch.float16,
        variant="fp16",
        safety_checker=None,
        requires_safety_checker=False,
        local_files_only=True,
    )
    unet, vae, text_encoder, tokenizer = pipe.unet, pipe.vae, pipe.text_encoder, pipe.tokenizer
    noise_scheduler = DDPMScheduler.from_pretrained(
        args.base, subfolder="scheduler", local_files_only=True
    )

    vae.requires_grad_(False)
    text_encoder.requires_grad_(False)
    unet.requires_grad_(False)
    vae.eval()
    text_encoder.eval()

    unet.add_adapter(
        LoraConfig(
            r=args.rank,
            lora_alpha=args.alpha,
            init_lora_weights="gaussian",
            target_modules=TARGET_MODULES,
        )
    )
    unet.enable_gradient_checkpointing()

    trainable = [p for p in unet.parameters() if p.requires_grad]
    n_train = sum(p.numel() for p in trainable)
    print(f"parametres entrainables : {n_train:,} ({n_train * 2 / 1e6:.1f} Mo en fp16)")
    if not trainable:
        raise SystemExit("aucun parametre entrainable : l'adaptateur n'a pas ete pose")

    if args.init:
        from safetensors.torch import load_file

        state = load_file(args.init)
        missing, unexpected = unet.load_state_dict(state, strict=False)
        pose = len(state) - len(unexpected)
        print(f"reprise depuis {args.init} : {pose}/{len(state)} tenseurs charges")
        if pose == 0:
            raise SystemExit("aucun tenseur du LoRA n'a ete charge : verifier le format")

    vae.to("cuda", dtype=torch.float16)
    text_encoder.to("cuda", dtype=torch.float16)
    unet.to("cuda")

    # GradScaler refuse de des-echelonner des gradients fp16, et AdamW a besoin
    # d'une precision suffisante sur un taux d'apprentissage de 1e-4 : seul
    # l'adaptateur passe en fp32, le modele de base reste en fp16.
    for p in trainable:
        p.data = p.data.float()
    print(f"adaptateur en fp32 : {sum(p.numel() for p in trainable):,} parametres")

    pairs = load_pairs(Path(args.data))
    print(f"{len(pairs)} images d'entrainement")

    captions = sorted({c for _, c in pairs})
    with torch.no_grad():
        tok = tokenizer(
            captions,
            padding="max_length",
            max_length=tokenizer.model_max_length,
            truncation=True,
            return_tensors="pt",
        )
        cond = text_encoder(tok.input_ids.to("cuda"))[0].to(torch.float16)
    cond_by_caption = {c: cond[i : i + 1].to("cpu") for i, c in enumerate(captions)}

    latents, conds = [], []
    with torch.no_grad():
        for img_path, caption in pairs:
            for arr in image_to_tensors(img_path, args.resolution):
                arr = arr.to("cuda", dtype=torch.float16)
                lat = vae.encode(arr).latent_dist.sample() * VAE_SCALE
                latents.append(lat.to("cpu"))
                conds.append(cond_by_caption[caption])
    print(f"latents et embeddings prets : {len(latents)} exemples")

    del vae, cond, pipe
    torch.cuda.empty_cache()
    print(f"VRAM libre apres liberation du VAE : {human_gb(torch.cuda.mem_get_info()[0])}")

    optimizer = torch.optim.AdamW(trainable, lr=args.lr, betas=(0.9, 0.999), eps=1e-8)
    scaler = torch.amp.GradScaler("cuda")

    def lr_at(step):
        if step < args.warmup:
            return args.lr * (step + 1) / args.warmup
        progress = (step - args.warmup) / max(1, args.max_steps - args.warmup)
        return args.lr * (0.5 * (1 + math.cos(math.pi * progress)) * 0.9 + 0.1)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    def save(step):
        sd = {
            k: v.detach().to("cpu").contiguous()
            for k, v in unet.state_dict().items()
            if "lora" in k.lower()
        }
        target = out / f"simia-style-step{step}.safetensors"
        save_file(sd, str(target))
        print(f"  sauvegarde {target.name} ({len(sd)} tenseurs)")
        return target

    unet.train()
    global_step = 0
    running = []
    t0 = time.time()

    while global_step < args.max_steps:
        for batch in micro_batches(len(latents), args.grad_accum):
            if global_step >= args.max_steps:
                break
            for g in optimizer.param_groups:
                g["lr"] = lr_at(global_step)

            optimizer.zero_grad(set_to_none=True)
            for idx in batch:
                lat = latents[idx].to("cuda", dtype=torch.float16)
                noise = torch.randn_like(lat)
                t = torch.randint(
                    0, noise_scheduler.config.num_train_timesteps, (1,), device="cuda"
                ).long()
                noisy = noise_scheduler.add_noise(lat, noise, t)
                # Sans ceci, le gradient checkpointing court-circuite le UNet :
                # aucun de ses entrees ne requiert de gradient, donc les couches
                # LoRA ne recoivent jamais de gradient.
                noisy.requires_grad_(True)
                ctx = conds[idx].to("cuda", dtype=torch.float16)

                with torch.autocast("cuda", dtype=torch.float16):
                    pred = unet(noisy, t, encoder_hidden_states=ctx).sample
                    loss = F.mse_loss(pred.float(), noise.float()) / len(batch)

                scaler.scale(loss).backward()
                running.append(loss.item() * len(batch))

            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(trainable, 1.0)
            scaler.step(optimizer)
            scaler.update()

            global_step += 1
            if global_step % args.log_every == 0:
                speed = global_step / (time.time() - t0)
                print(
                    f"pas {global_step}/{args.max_steps}  loss {sum(running) / len(running):.4f}"
                    f"  lr {lr_at(global_step):.2e}  {speed:.2f} it/s"
                    f"  VRAM libre {human_gb(torch.cuda.mem_get_info()[0])}"
                )
                running = []

            if args.save_every and global_step % args.save_every == 0:
                save(global_step)

    final = save(global_step)
    print(f"termine en {(time.time() - t0) / 60:.1f} min -> {final}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
