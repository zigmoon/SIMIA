"""Assemble le corpus d'entrainement a partir de planches du domaine public.

Source : Wikimedia Commons, categories des magazines botaniques du XIXe siecle
(Curtis's Botanical Magazine, Edwards's Botanical Register). Ces planches sont
dans le domaine public : elles peuvent servir a entrainer un modele et le
modele qui en resulte peut etre publie.

Ce que fait le script, dans l'ordre :
  1. parcourt les categories Commons (les volumes sont des sous-categories)
     et collecte les fichiers ;
  2. telecharge une vignette de 1024 px plutot que l'original (souvent 4000 px) ;
  3. ecarte les volumes PDF, les doublons, les pages de garde et les photos ;
  4. ramene chaque planche a 640 px de cote court, sans la recadrer : le
     recadrage aleatoire en 512 se fait a l'entrainement, ce qui donne de la
     matiere a l'augmentation ;
  5. ecrit une legende par image, prefixee du jeton declencheur.

Le resultat est un dossier pret pour train_dense.py :

    data/plates/0001.png
    data/plates/0001.txt   ->  "s1mia vintage botanical engraving, Rosa canina, ..."

Usage :
    python prepare_corpus.py --limit 200
    python prepare_corpus.py --limit 20 --check      # verification rapide
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

API = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "SIMIA-corpus/1.0 (entrainement LoRA botanique; contact: zigmoon)"
TRIGGER = "s1mia vintage botanical engraving"

# Categories de depart. Les volumes sont des sous-categories : on descend de
# trois niveaux pour atteindre les fichiers, sans parcourir tout Commons.
ROOTS = [
    "Category:Curtis's Botanical Magazine",
    "Category:Edwards's Botanical Register",
]

# Un fichier dont le titre contient un de ces mots est une page de garde, un
# sommaire ou un index : aucun interet pour apprendre un trait de gravure.
SKIP_TITLE = re.compile(
    r"(index|title\s*page|frontispiece|contents|preface|cover|plate\s*list|"
    r"advertisement|errata|catalogue|collage|portrait|\.pdf$|\.djvu$|\.tif$)",
    re.IGNORECASE,
)

# Les sous-categories de ce genre ne contiennent que des index ou des
# reproductions en volume : on ne les parcourt pas.
SKIP_SUBCAT = re.compile(r"(index|collage|portrait)", re.IGNORECASE)

# Seules les vignettes sont servies sans limite : upload.wikimedia.org renvoie
# des 429 quasi systematiques sur les originaux.
THUMB_HOST = "thumb.wikimedia.org"

# Intervalle minimal entre deux appels a l'API. Mesure sur ce poste : a 1 s
# d'ecart, Commons coupe au bout de cinq requetes avec une penalite de 45 s.
PACING = 3.5
_last_call = 0.0

# Cote court des images ecrites. L'entrainement recadre en 512, ce qui laisse
# 128 px de marge pour varier le cadrage d'une epoque a l'autre.
SIDE = 640
MAX_LONG = 1280


def api(params: dict, attempts: int = 8) -> dict:
    """Un GET sur l'API Commons, avec le User-Agent exige par Wikimedia.

    Commons renvoie 429 des que les appels s'enchainent : les requetes sont donc
    espacees d'au moins 3,5 s, ce qui reste sous le seuil tolere pour un usage
    anonyme, et une penalite est attendue avant de reessayer.
    """
    global _last_call
    params = {**params, "format": "json", "formatversion": "2", "maxlag": "5"}
    url = f"{API}?{urllib.parse.urlencode(params)}"
    last: Exception | None = None
    for attempt in range(attempts):
        pause = PACING - (time.monotonic() - _last_call)
        if pause > 0:
            time.sleep(pause)
        _last_call = time.monotonic()
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=40) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            last = error
            if error.code not in (429, 503):
                raise
            wait = float(error.headers.get("Retry-After") or 0) or (10 * (attempt + 1))
            print(f"   ... {error.code} sur l'API, nouvelle tentative dans {wait:.0f} s")
            time.sleep(min(90, wait))
            _last_call = time.monotonic()
        except Exception as error:
            last = error
            time.sleep(5 * (attempt + 1))
    raise last if last else RuntimeError("API Commons injoignable")


def category_members(title: str, kind: str, cap: int = 2000) -> list[str]:
    out: list[str] = []
    cursor = None
    while True:
        params = {
            "action": "query",
            "list": "categorymembers",
            "cmtitle": title,
            "cmlimit": "500",
            "cmtype": kind,
        }
        if cursor:
            params["cmcontinue"] = cursor
        payload = api(params)
        out += [entry["title"] for entry in payload.get("query", {}).get("categorymembers", [])]
        cursor = payload.get("continue", {}).get("cmcontinue")
        if not cursor or len(out) >= 2000:
            return out


def collect_files(limit: int, depth: int = 3) -> dict:
    """Descend les categories et rapporte les metadonnees de chaque fichier.

    Un volume de Curtis compte une soixantaine de planches : il faut parcourir
    beaucoup de volumes pour depasser la centaine d'images. On s'arrete des
    qu'il y a de quoi tenir la campagne, pas avant.

    Les metadonnees sont demandees dans la meme requete que la liste des
    fichiers, via le generateur de MediaWiki : 500 fichiers decrits par appel
    au lieu de 20, et donc vingt fois moins de 429.
    """
    seen_categories: set[str] = set()
    infos: dict = {}
    queue = [(title, 0) for title in ROOTS]
    while queue and len(infos) < limit * 3:
        title, level = queue.pop(0)
        if title in seen_categories:
            continue
        seen_categories.add(title)
        infos.update(category_infos(title))
        if level < depth:
            queue += [
                (sub, level + 1)
                for sub in category_members(title, "subcat")
                if not SKIP_SUBCAT.search(sub)
            ]
        print(f"   {len(infos):5d} fichiers decrits, {len(seen_categories)} categories vues")
    # Les doublons de titre arrivent quand une image est dans deux categories.
    return infos


def category_infos(title: str) -> dict:
    """Tous les fichiers d'une categorie, vignette et metadonnees comprises."""
    out: dict = {}
    cursor = None
    while True:
        params = {
            "action": "query",
            "generator": "categorymembers",
            "gcmtitle": title,
            "gcmtype": "file",
            "gcmlimit": "500",
            "prop": "imageinfo",
            "iiprop": "url|size|extmetadata|mime",
            "iiurlwidth": "1024",
        }
        if cursor:
            params["gccontinue"] = cursor
        payload = api(params)
        for page in payload.get("query", {}).get("pages", []):
            info = (page.get("imageinfo") or [{}])[0]
            if info:
                out[page["title"]] = info
        cursor = payload.get("continue", {}).get("gccontinue")
        if not cursor:
            return out
        time.sleep(1.0)


def clean(text: str | None, fallback: str) -> str:
    """Le champ ImageDescription arrive en HTML : on le reduit a une phrase."""
    if not text:
        return fallback
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"&[a-z]+;", " ", text)
    text = re.sub(r"\s+", " ", text).strip(" .,;:-")
    return text[:180] or fallback


def caption_for(title: str, info: dict) -> str:
    meta = info.get("extmetadata", {})
    description = clean((meta.get("ImageDescription") or {}).get("value"), "")
    obj = clean((meta.get("ObjectName") or {}).get("value"), "")
    # Le titre Commons est souvent le nom latin : "Curtis's Botanical
    # Magazine, plate 1234, Rosa canina". On garde le dernier segment utile.
    stem = title.replace("File:", "").rsplit(".", 1)[0]
    stem = re.sub(r"^[^,]*,", "", stem)
    subject = description or obj or stem
    if not subject:
        subject = "a botanical engraving plate"
    return f"{TRIGGER}, {subject}"


def normalise(image: Image.Image) -> Image.Image:
    """Ramene la planche a 640 px de cote court, sans la recadrer.

    Le recadrage carre se fait a l'entrainement : garder l'image entiere ici
    permet de deplacer la fenetre de 512 px d'une epoque a l'autre, donc de
    multiplier les cadrages vus par le modele sans dupliquer de fichier. Les
    planches tres hautes sont plafonnees a 1280 px de haut, au centre.
    """
    image = ImageOps.exif_transpose(image).convert("RGB")
    width, height = image.size
    short = min(width, height)
    if short != SIDE:
        scale = SIDE / short
        image = image.resize((round(width * scale), round(height * scale)), Image.LANCZOS)
    width, height = image.size
    if height > MAX_LONG:
        top = (height - MAX_LONG) // 2
        image = image.crop((0, top, width, top + MAX_LONG))
    return image


def fingerprint(image: Image.Image) -> str:
    """Empreinte perceptuelle grossiere : deux tirages d'une meme planche
    scannent differemment mais restent proches."""
    thumb = image.convert("L").resize((16, 16), Image.LANCZOS)
    return hashlib.sha1(thumb.tobytes()).hexdigest()


def download(url: str, attempts: int = 3) -> Image.Image:
    """Telecharge une image, avec attente progressive sur les 429.

    Wikimedia limite durement les vignettes : sans temporisation, un lot de
    200 planches se solde par une majorite d'echecs. Les attentes restent
    bornees a 20 s : au-dela, mieux vaut abandonner cette image et continuer
    que bloquer la collecte pendant cinq minutes.
    """
    last: Exception | None = None
    for attempt in range(attempts):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                data = response.read()
            image = Image.open(io.BytesIO(data))
            return ImageOps.exif_transpose(image).convert("RGB")
        except urllib.error.HTTPError as error:
            last = error
            if error.code not in (429, 503):
                raise
            wait = float(error.headers.get("Retry-After") or 0) or (5 * (attempt + 1))
            time.sleep(min(20, wait))
        except Exception as error:
            last = error
            time.sleep(3 * (attempt + 1))
    raise last if last else RuntimeError("telechargement impossible")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=200, help="nombre de planches voulues")
    parser.add_argument("--out", default="data/plates", help="dossier de sortie")
    parser.add_argument("--check", action="store_true", help="petit lot, sans tout ecrire")
    args = parser.parse_args()

    out = Path(__file__).parent / args.out
    out.mkdir(parents=True, exist_ok=True)

    print(f"1. parcours des categories Commons (objectif {args.limit} planches)")
    infos = {
        title: info
        for title, info in collect_files(args.limit).items()
        if not SKIP_TITLE.search(title)
    }
    print(f"   {len(infos)} fichiers candidats")

    print("3. telechargement et normalisation")
    seen: set[str] = set()
    skipped = failed = 0
    manifest = []
    # Reprise : les planches deja ecrites sont comptees et empreintes, pour
    # qu'une interruption reseau ne reparte pas de zero.
    existing = sorted(out.glob("*.png"))
    for path in existing:
        try:
            seen.add(fingerprint(Image.open(path)))
        except Exception:
            path.unlink(missing_ok=True)
    kept = len(existing)
    if kept:
        print(f"   reprise : {kept} planches deja presentes")
        previous = out.parent / "manifest.json"
        if previous.is_file():
            manifest = json.loads(previous.read_text(encoding="utf-8"))

    for title, info in infos.items():
        if kept >= args.limit:
            break
        if info.get("mime") not in {"image/jpeg", "image/png", "image/webp"}:
            skipped += 1
            continue
        # Une vignette de 1024 px suffit : l'original ne sert a rien pour du 640.
        url = info.get("thumburl") or ""
        if THUMB_HOST not in url:
            skipped += 1
            continue
        try:
            image = download(url)
        except Exception as error:  # reseau, 429, fichier casse
            failed += 1
            if failed <= 8:
                print(f"   ! {title[:60]} : {str(error)[:80]}")
            continue
        if min(image.size) < 320:
            skipped += 1
            continue
        # Une planche gravee est haute. Les photos de plantes et les bandeaux
        # des pages de volume sont larges : les ecarter garde le style propre.
        if image.width >= image.height:
            skipped += 1
            continue
        mark = fingerprint(image)
        if mark in seen:
            skipped += 1
            continue
        seen.add(mark)

        kept += 1
        name = f"{kept:04d}"
        normalise(image).save(out / f"{name}.png", optimize=True)
        caption = caption_for(title, info)
        (out / f"{name}.txt").write_text(caption, encoding="utf-8")
        manifest.append({"file": f"{name}.png", "title": title, "caption": caption,
                         "credit": "Wikimedia Commons", "license": "public domain"})
        if kept % 10 == 0:
            print(f"   {kept} planches")
        time.sleep(0.7)  # rester courtois avec l'API des vignettes

    (out.parent / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\n{kept} planches ecrites dans {out}")
    print(f"{skipped} ecartees (doublon, trop petite, photo en paysage, format), "
          f"{failed} en echec reseau")
    if kept < 20:
        print("ATTENTION : moins de 20 images, l'entrainement sera instable.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
