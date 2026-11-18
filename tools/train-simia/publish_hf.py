"""Publie un dossier sur Hugging Face, apres verification de son contenu.

Rien n'est envoye sans `--push` : par defaut le script se contente de decrire ce
qui partirait, de verifier que le fichier `.safetensors` est lisible et que la
fiche `README.md` porte bien les metadonnees exigees par Hugging Face. C'est le
mode a utiliser tant que le depot n'existe pas encore.

Prerequis, une seule fois :

    .venv\\Scripts\\python.exe -m pip install huggingface_hub
    .venv\\Scripts\\python.exe -m huggingface_hub.commands.huggingface_cli login
        (ou coller un jeton dans la variable d'environnement HF_TOKEN)

Usage :

    # 1. verification a blanc
    .venv\\Scripts\\python.exe publish_hf.py --repo zigmoon/simia-botanical-v1

    # 2. publication
    .venv\\Scripts\\python.exe publish_hf.py --repo zigmoon/simia-botanical-v1 --push

Le depot est cree s'il n'existe pas. Un depot prive s'obtient avec `--private`.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).parent

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Extensions qui n'ont rien a faire dans un depot de poids.
JUNK = {".log", ".tmp", ".pyc", ".pyo", ".partial", ".lock"}
# Plafond prudent : au-dela, l'envoi en une passe echoue et il faut decouper.
MAX_FILE_MB = 40_000


def human(size: int) -> str:
    for unit in ("o", "Ko", "Mo", "Go"):
        if size < 1024 or unit == "Go":
            return f"{size:.1f} {unit}" if unit != "o" else f"{size} o"
        size /= 1024
    return f"{size:.1f} Go"


def inspect(folder: Path) -> tuple[list[Path], int]:
    """Liste les fichiers a envoyer et signale ce qui cloche."""
    if not folder.is_dir():
        raise SystemExit(f"dossier introuvable : {folder}")

    files: list[Path] = []
    total = 0
    problems: list[str] = []

    for path in sorted(folder.rglob("*")):
        if not path.is_file() or path.name.startswith("."):
            continue
        if path.suffix.lower() in JUNK:
            continue
        size = path.stat().st_size
        if path.suffix.lower() == ".safetensors":
            readable, detail = check_safetensors(path)
            if not readable:
                problems.append(f"{path.name} : {detail}")
            else:
                print(f"   {path.relative_to(folder)}  {human(size)}  {detail}")
            total += size
            files.append(path)
            continue
        total += size
        files.append(path)

    card = folder / "README.md"
    if not card.is_file():
        problems.append("README.md absent : Hugging Face affichera un depot sans fiche")
    else:
        head = card.read_text(encoding="utf-8", errors="replace")[:600]
        if not head.lstrip().startswith("---"):
            problems.append("README.md ne commence pas par un en-tete YAML")
        for field in ("license:", "tags:"):
            if field not in head:
                problems.append(f"README.md : metadonnee « {field} » absente de l'en-tete")

    for path in files:
        if path.stat().st_size > MAX_FILE_MB * 1e6:
            problems.append(f"{path.name} depasse {MAX_FILE_MB} Mo : a decouper")

    print(f"\n   {len(files)} fichiers, {human(total)} au total")
    if problems:
        print("\n   points a corriger :")
        for problem in problems:
            print(f"     - {problem}")
    return files, total


def check_safetensors(path: Path) -> tuple[bool, str]:
    """Verifie l'en-tete du fichier : un tenseur, une taille, un nom."""
    try:
        from safetensors import safe_open
    except ImportError:
        return True, "(safetensors non installe, en-tete non verifie)"
    try:
        with safe_open(str(path), framework="pt") as handle:
            keys = list(handle.keys())
            if not keys:
                return False, "aucun tenseur"
            sample = keys[0]
            shape = tuple(handle.get_slice(sample).get_shape())
            return True, f"{len(keys)} tenseurs, ex. {sample} {shape}"
    except Exception as error:
        return False, f"illisible ({str(error)[:70]})"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", default="zigmoon/simia-botanical-v1",
                        help="identifiant du depot, par exemple zigmoon/simia-botanical-v1")
    parser.add_argument("--path", default="out", help="dossier a envoyer")
    parser.add_argument("--card", default="",
                        help="fiche a copier en README.md dans le dossier s'il n'en a pas")
    parser.add_argument("--kind", default="model", choices=["model", "dataset", "space"])
    parser.add_argument("--private", action="store_true", help="creer le depot en prive")
    parser.add_argument("--push", action="store_true", help="envoyer pour de vrai")
    parser.add_argument("--message", default="Ajout du modele", help="message de commit")
    args = parser.parse_args()

    folder = ROOT / args.path
    if args.card and not (folder / "README.md").is_file():
        source = ROOT / args.card
        if not source.is_file():
            raise SystemExit(f"fiche introuvable : {source}")
        (folder / "README.md").write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"0. fiche {source.name} copiee en README.md dans {folder}")
    print(f"1. contenu de {folder}")
    files, total = inspect(folder)

    print(f"\n2. destination : {args.repo} ({args.kind})")
    try:
        from huggingface_hub import HfApi
    except ImportError:
        print("   huggingface_hub n'est pas installe :")
        print("   .venv\\Scripts\\python.exe -m pip install huggingface_hub")
        return 2

    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    api = HfApi(token=token)
    try:
        who = api.whoami()
        print(f"   connecte en tant que {who.get('name')}")
    except Exception as error:
        print(f"   aucun jeton valide ({str(error)[:90]})")
        print("   lancez : .venv\\Scripts\\python.exe -m huggingface_hub.commands.huggingface_cli login")
        if args.push:
            return 2

    try:
        exists = api.repo_exists(args.repo, repo_type=args.kind, token=token)
    except Exception as error:
        print(f"   impossible de verifier le depot ({str(error)[:90]})")
        exists = False
    print(f"   depot {'deja cree' if exists else 'a creer'}")

    if not args.push:
        print("\n3. essai a blanc : rien n'a ete envoye")
        print(f"   pour publier : publish_hf.py --repo {args.repo} --path {args.path} --push")
        return 0

    print(f"\n3. creation du depot {args.repo}")
    api.create_repo(args.repo, repo_type=args.kind, private=args.private, exist_ok=True)

    print(f"4. envoi de {len(files)} fichiers ({human(total)})")
    api.upload_folder(
        repo_id=args.repo,
        repo_type=args.kind,
        folder_path=str(folder),
        commit_message=args.message,
        ignore_patterns=["_staging_*", "*.log", "step-*.safetensors"],
    )
    print(f"\nEn ligne : https://huggingface.co/{args.repo}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
