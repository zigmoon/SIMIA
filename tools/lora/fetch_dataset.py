"""Constitue un jeu d'images de style a partir de Wikimedia Commons.

Ne prend que des fichiers du domaine public, redimensionnes a 512 px par le
service de vignettes de Commons (aucun traitement local, aucun droits tiers).

    python fetch_dataset.py --out D:\\chemin\\dataset --theme engraving

Chaque image recoit une legende au format attendu par l'entraineur :
    <jeton> <description>, <theme>
"""

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://commons.wikimedia.org/w/api.php"
UA = "SIMIA-lora-dataset/1.0 (local training, contact: none)"

THEMES = {
    "engraving": {
        "queries": [
            "Curtis's Botanical Magazine plate",
            "botanical illustration engraving plate",
            "Flora Danica plate",
            "vintage botanical print hand coloured",
            "herbal engraving plate 19th century",
        ],
        "caption": "vintage botanical engraving plate",
    },
    "nouveau": {
        "queries": [
            "Alphonse Mucha poster",
            "Art Nouveau poster 1900",
            "Art Nouveau decorative panel lithograph",
        ],
        "caption": "art nouveau lithograph poster",
    },
    "ukiyoe": {
        "queries": [
            "ukiyo-e woodblock print",
            "Hokusai woodblock print",
            "Hiroshige woodblock print landscape",
        ],
        "caption": "ukiyo-e woodblock print",
    },
}


def api_get(params: dict) -> dict:
    params = dict(params, format="json", formatversion="2")
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))


def is_public_domain(meta: dict) -> bool:
    """Filtre sur la licence declaree : on refuse tout ce qui n'est pas PD."""
    raw = (meta.get("LicenseShortName", {}) or {}).get("value", "") or ""
    low = raw.lower()
    return "public domain" in low or low.startswith("pd") or "cc0" in low


def search(query: str, limit: int) -> list[dict]:
    data = api_get(
        {
            "action": "query",
            "generator": "search",
            "gsrsearch": f"filetype:bitmap {query}",
            "gsrnamespace": "6",
            "gsrlimit": str(limit),
            "prop": "imageinfo",
            "iiprop": "url|size|extmetadata|mime",
            "iiurlwidth": "512",
        }
    )
    return (data.get("query") or {}).get("pages") or []


def safe_name(title: str) -> str:
    name = title.split(":", 1)[-1]
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-")
    return name[:80] or "image"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--theme", default="engraving", choices=sorted(THEMES))
    ap.add_argument("--count", type=int, default=32)
    ap.add_argument("--token", default="s1mia")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    theme = THEMES[args.theme]
    caption = f"{args.token} {theme['caption']}"

    seen: set[str] = set()
    kept = 0
    rejected = {"licence": 0, "format": 0, "telechargement": 0}

    for query in theme["queries"]:
        if kept >= args.count:
            break
        print(f"recherche : {query}")
        for page in search(query, 40):
            if kept >= args.count:
                break
            info = (page.get("imageinfo") or [{}])[0]
            meta = info.get("extmetadata") or {}
            title = page.get("title", "")
            if title in seen:
                continue
            seen.add(title)

            if not is_public_domain(meta):
                rejected["licence"] += 1
                continue
            if info.get("mime") not in ("image/jpeg", "image/png"):
                rejected["format"] += 1
                continue
            src = info.get("thumburl") or info.get("url")
            if not src:
                rejected["format"] += 1
                continue

            name = safe_name(title) + ".jpg"
            dest = out / name
            if not dest.exists():
                try:
                    req = urllib.request.Request(src, headers={"User-Agent": UA})
                    with urllib.request.urlopen(req, timeout=60) as r:
                        dest.write_bytes(r.read())
                    time.sleep(0.2)
                except Exception as exc:  # reseau instable : on passe a la suite
                    print(f"  echec {name} : {exc}")
                    rejected["telechargement"] += 1
                    continue
            (out / (dest.stem + ".txt")).write_text(caption, encoding="utf-8")
            kept += 1
            print(f"  [{kept}/{args.count}] {name}")

    print(
        f"termine : {kept} images, rejets {rejected} "
        f"(legende : \"{caption}\")"
    )
    return 0 if kept >= max(8, args.count // 2) else 1


if __name__ == "__main__":
    raise SystemExit(main())
