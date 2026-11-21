"""Verifie le contenu d'une archive ZIP publiee, sans la telecharger.

Un ZIP se lit a distance : le repertoire central est en fin de fichier, et chaque
membre se demande par une requete Range. Les archives Windows pesent 1,5 Go ;
les telecharger pour verifier trois fichiers coute une heure de connexion, alors
que l'inspection demande quelques dizaines de kilo-octets.

    python tools/inspect-release-zip.py                 # archive de la version du lanceur
    python tools/inspect-release-zip.py v0.1.23          # une etiquette precise
    python tools/inspect-release-zip.py v0.1.23 ma.zip   # une autre archive

Sortie : taille, nombre d'entrees, racine de l'archive, version du cache hors
ligne, presence des fonctions attendues dans l'interface, et comparaison avec
l'empreinte publiee dans la note de version. Code de sortie 1 si une
verification echoue, pour pouvoir enchainer dans un script.

A lancer depuis la racine du depot : le script lit launcher/Cargo.toml pour
savoir quelle version verifier par defaut.
"""
import json
import re
import struct
import sys
import urllib.error
import urllib.request
import zlib

REPO = "zigmoon/SIMIA"
DEFAULT_ASSET = "simia-windows-x64.zip"

# Marqueurs de l'interface : leur absence signifie que l'archive ne contient pas
# la version annoncee, meme si l'etiquette du binaire est bonne.
MARKERS = {
    "web/app.js": [
        "renderCodePreviewToggle",
        "ICON_EYE_OFF",
        "expanded: new Set()",
        "codePreviewRev: CODE_PREVIEW_REV",
        "markCodeBlockState",
        "codeRevealPath",
        "replyTokensFor",
        "codeAppendMerge",
        "streamCodeDraft",
        "settleCodeDrafts",
        "continueInVibe",
        "markReplyTruncated",
        "codeTurnInstruction",
        "codeWantsPage",
        "refreshContinueLabels",
        "state.code.focus === \"chat\"",
        "Conversation seule, pleine largeur",
        'if (!NATIVE && document.querySelector(".update-bar")) return;',
        "remoteCatalog > localCatalog",
        "renderImageLoraControls",
        "discover_image_packs",
        'element.setAttribute("aria-busy", "true");',
    ],
    "web/styles.css": [
        '[data-code-pane="chat"] .code-pane',
        "width:min(850px, 100%); margin:0 auto; padding:34px 32px 24px",
        ".update-bar + .update-bar",
    ],
    "web/index.html": [
        "M3.4 3.4l17.2 17.2",
        "composer-steps",
        '<input id="setting-code-preview" type="checkbox">',
        "code-draft-bar",
        'id="image-lora"',
    ],
}


def launcher_version():
    with open("launcher/Cargo.toml", encoding="utf-8") as handle:
        for line in handle:
            if line.startswith("version"):
                return line.split("=", 1)[1].strip().strip('"')
    raise SystemExit("version introuvable dans launcher/Cargo.toml")


def fetch_range(url, start, end):
    request = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}", "User-Agent": "curl/8"})
    with urllib.request.urlopen(request) as response:
        return response.read()


def read_members(url):
    request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "curl/8"})
    with urllib.request.urlopen(request) as response:
        size = int(response.headers["Content-Length"])
    window = min(size, 4 * 1024 * 1024)
    start = size - window
    tail = fetch_range(url, start, size - 1)
    eocd = tail.rfind(b"PK\x05\x06")
    if eocd < 0:
        raise SystemExit("repertoire central introuvable : ce n'est pas un ZIP")
    _, _, _, entries, cd_size, cd_offset, _ = struct.unpack_from("<HHHHIIH", tail, eocd + 4)
    offset = cd_offset - start
    directory = tail[offset:offset + cd_size] if offset >= 0 else b""
    if len(directory) < cd_size:
        directory = fetch_range(url, cd_offset, cd_offset + cd_size - 1)
    members = {}
    cursor = 0
    while cursor + 46 <= len(directory) and directory[cursor:cursor + 4] == b"PK\x01\x02":
        # En-tete central : signature(4) version_made(2) version_needed(2) flags(2)
        # method(2) heure(2) date(2) crc(4) comp(4) decomp(4) nom(2) extra(2)
        # commentaire(2) disque(2) attributs internes(2) externes(4) offset local(4)
        (_, method, _, compressed, _, name_len, extra_len, comment_len, _,
         _, _, local_offset) = struct.unpack_from("<HH4xIIIHHHHHII", directory, cursor + 8)
        name = directory[cursor + 46:cursor + 46 + name_len].decode("utf-8", "replace")
        members[name] = {"method": method, "compressed": compressed, "offset": local_offset}
        cursor += 46 + name_len + extra_len + comment_len
    return size, entries, members


def read_member(url, member):
    header = fetch_range(url, member["offset"], member["offset"] + 330)
    name_len, extra_len = struct.unpack_from("<HH", header, 26)
    start = member["offset"] + 30 + name_len + extra_len
    data = fetch_range(url, start, start + member["compressed"] - 1)
    return data if member["method"] == 0 else zlib.decompress(data, -15)


def main():
    tag = sys.argv[1] if len(sys.argv) > 1 else "v" + launcher_version()
    asset = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_ASSET
    request = urllib.request.Request(f"https://api.github.com/repos/{REPO}/releases/tags/{tag}",
                                     headers={"User-Agent": "curl/8"})
    try:
        release = json.load(urllib.request.urlopen(request))
    except urllib.error.HTTPError as error:
        raise SystemExit(f"{tag} : {error.code} sur l'API GitHub")
    published = {item["name"]: item for item in release["assets"]}
    if asset not in published:
        raise SystemExit(f"{asset} absent de {tag} : {', '.join(sorted(published))}")

    url = published[asset]["browser_download_url"]
    size, entries, members = read_members(url)
    print(f"{tag} / {asset}")
    print(f"  {size} o ({size / 1024 ** 2:.1f} Mo), {entries} entrees annoncees, {len(members)} lues")
    print("  racines :", ", ".join(sorted({name.split('/')[0] for name in members})))

    failures = []
    for suffix, needles in MARKERS.items():
        name = next((key for key in members if key.endswith(suffix)), None)
        if not name:
            failures.append(f"{suffix} absent")
            continue
        text = read_member(url, members[name]).decode("utf-8", "replace")
        for needle in needles:
            if needle not in text:
                failures.append(f"{suffix} : {needle}")
    worker = next((key for key in members if key.endswith("web/service-worker.js")), None)
    if worker:
        version = re.search(r'VERSION = "([\d.]+)"', read_member(url, members[worker]).decode("utf-8", "replace"))
        print("  cache hors ligne :", version.group(1) if version else "?")
    else:
        failures.append("web/service-worker.js absent")

    digest = (published[asset].get("digest") or "").replace("sha256:", "")
    in_notes = re.search(r"([0-9a-f]{64})[ `|]*" + re.escape(asset), release.get("body") or "")
    if digest and in_notes and digest != in_notes.group(1):
        failures.append("empreinte differente de celle de la note de version")
    print("  empreinte :", (digest[:16] + "...") if digest else "non fournie par l'API")

    if failures:
        print("\n  ECHECS :")
        for item in failures:
            print("   -", item)
        sys.exit(1)
    print("\n  conforme.")


if __name__ == "__main__":
    main()
