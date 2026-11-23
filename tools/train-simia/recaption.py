"""Reecrit les legendes du corpus a partir du nom latin des planches.

Pourquoi c'est necessaire : un LoRA n'apprend que ce que la legende lui dit de
distinguer. Sur les 220 planches du corpus, 61 % des legendes ne nommaient pas
la plante — « This is a plate from Curtis's Botanical Magazine, Volume 73 »,
ou du texte grave mal océrisé (« MfoS », « FSv£ »). Le jeton de style y a donc
appris « une planche », pas « un style pose sur un sujet » : d'ou l'impression
que le modele ne fait que resservir le corpus.

Ce script reprend le nom latin la ou il existe vraiment :
  1. dans le titre Commons (« File:Ada aurantiaca.jpg ») ;
  2. sinon dans les categories Commons, qui rangent chaque planche sous son
     espece (« Digitalis purpurea »).

Une planche dont on ne peut pas nommer le sujet est **ecartee** : mieux vaut
150 legendes justes que 220 dont 130 n'apprennent rien. Les fichiers ecartes
ne sont pas supprimes, ils sont deplaces dans data/unused/.

    .venv\\Scripts\\python.exe recaption.py            # ecrit les legendes
    .venv\\Scripts\\python.exe recaption.py --dry-run  # rapport seul
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).parent
TRIGGER = "s1mia vintage botanical engraving"
API = "https://commons.wikimedia.org/w/api.php"
AGENT = "SIMIA-corpus/1.0 (recaption; contact: zigmoon)"

# Un binome latin : un genre capitalise, une espece en minuscules, au moins
# trois lettres chacun. Les mots d'une categorie administrative ne passent pas
# ce filtre : « Botanical Magazine » a une majuscule au second mot.
BINOMIAL = re.compile(r"\b([A-Z][a-z]{2,})\s+([a-z]{3,})\b")

# Categorie ou titre qui parle de la collection, pas de la plante. La recherche
# se fait sur des mots entiers : « flora » ne doit pas disqualifier
# « Anguloa uniflora ».
NOISE = (
    "botanical", "magazine", "curtis", "edwards", "wikimedia", "commons", "public",
    "domain", "images", "image", "files", "file", "media", "plates", "plate",
    "illustrations", "illustration", "drawings", "paintings", "prints", "engraving",
    "chromolithograph", "lithograph", "century", "herbarium", "flora", "botany",
    "plants", "taxonomy", "described", "named", "taxa", "genera", "species",
    "gallery", "art", "books", "works", "author", "died", "years", "ago", "more",
    "than", "vintage", "coloured", "colored", "hand", "svg", "png", "jpg", "jpeg",
    "tif", "tiff", "wikidata", "wikispecies", "no", "scan", "book",
)

# Mots latins frequents mais qui ne nomment pas une plante dans ce corpus.
NOT_A_GENUS = {"Plate", "Volume", "From", "This", "Illustration", "File", "The", "Author", "No"}


def fetch_categories(titles: list[str], batch: int = 50) -> dict[str, list[str]]:
    """Categories Commons de chaque fichier, par lots de 50 titres."""
    found: dict[str, list[str]] = {}
    for start in range(0, len(titles), batch):
        chunk = titles[start:start + batch]
        query = urllib.parse.urlencode({
            "action": "query",
            "format": "json",
            "prop": "categories",
            "cllimit": "max",
            "titles": "|".join(chunk),
        })
        request = urllib.request.Request(f"{API}?{query}", headers={"User-Agent": AGENT})
        with urllib.request.urlopen(request, timeout=90) as response:
            payload = json.load(response)
        for page in payload.get("query", {}).get("pages", {}).values():
            name = page.get("title", "")
            found[name] = [item["title"] for item in page.get("categories", [])]
        print(f"   {min(start + batch, len(titles))}/{len(titles)} titres")
        time.sleep(0.5)
    return found


def binomial_in(text: str) -> str | None:
    """Premier binome plausible d'un texte, ou None."""
    cleaned = text.replace("File:", " ").replace("_", " ")
    cleaned = re.sub(r"\.(png|jpg|jpeg|tif|tiff)$", " ", cleaned, flags=re.I)
    for match in BINOMIAL.finditer(cleaned):
        genus, species = match.group(1), match.group(2)
        if genus in NOT_A_GENUS:
            continue
        # Mots entiers seulement : « uniflora » contient « flora », ce qui ne
        # doit pas disqualifier une espece.
        words = set(re.findall(r"[a-z]+", match.group(0).lower()))
        if words & set(NOISE):
            continue
        if species in {"from", "with", "and", "the", "for", "var", "subsp", "orig", "syn", "as"}:
            continue
        return f"{genus} {species}"
    return None


def subject_for(title: str, categories: list[str]) -> tuple[str | None, str]:
    """Nom latin de la plante, et d'ou il vient."""
    from_title = binomial_in(title)
    if from_title:
        return from_title, "titre"

    # Les categories taxinomiques arrivent souvent en double (« Rosa canina » et
    # « Rosa canina in art ») : on garde le binome le plus frequent, puis le plus
    # court, ce qui ecarte les variantes bavardes.
    counts: dict[str, int] = {}
    for category in categories:
        found = binomial_in(category)
        if found:
            counts[found] = counts.get(found, 0) + 1
    if counts:
        best = sorted(counts.items(), key=lambda item: (-item[1], len(item[0])))[0][0]
        return best, "categorie"
    return None, "aucun"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", default="data/plates", help="dossier des planches")
    parser.add_argument("--manifest", default="data/manifest.json")
    parser.add_argument("--unused", default="data/unused", help="ou ranger les planches sans sujet")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    data = ROOT / args.data
    manifest_path = ROOT / args.manifest
    unused = ROOT / args.unused
    records = json.loads(manifest_path.read_text(encoding="utf-8"))
    titles = [record["title"] for record in records]

    print(f"1. categories Commons pour {len(titles)} fichiers")
    categories = fetch_categories(titles)

    print("2. nom latin de chaque planche")
    kept, dropped = [], []
    for record in records:
        subject, source = subject_for(record["title"], categories.get(record["title"], []))
        record["subject"] = subject
        record["subjectSource"] = source
        (kept if subject else dropped).append(record)

    print(f"   {len(kept)} planches nommees, {len(dropped)} sans sujet")
    from_title = sum(1 for record in kept if record["subjectSource"] == "titre")
    print(f"   dont {from_title} par le titre, {len(kept) - from_title} par les categories")

    if args.dry_run:
        for record in kept[:8]:
            print(f"   {record['file']}  {record['subject']}")
        for record in dropped[:8]:
            print(f"   {record['file']}  (ecartee) {record['title'][:60]}")
        print("essai a blanc : rien n'a ete ecrit")
        return 0

    print("3. ecriture des legendes")
    for record in kept:
        caption = f"{TRIGGER}, {record['subject']}"
        (data / record["file"]).with_suffix(".txt").write_text(caption, encoding="utf-8")
        record["caption"] = caption

    if dropped:
        unused.mkdir(parents=True, exist_ok=True)
        for record in dropped:
            for suffix in (".png", ".txt"):
                source = (data / record["file"]).with_suffix(suffix)
                if source.is_file():
                    shutil.move(str(source), str(unused / source.name))
                elif unused.joinpath(source.name).is_file():
                    shutil.move(str(data / source.name), str(unused / source.name))
            record["caption"] = ""

    manifest_path.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    distinct = len({record["subject"] for record in kept})
    print(f"   {len(kept)} legendes, {distinct} especes distinctes")
    print(f"   planches ecartees : {len(dropped)} dans {unused.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
