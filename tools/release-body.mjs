// Rédige les notes de version attachées à chaque release.
//
// Appelé par le workflow juste avant softprops/action-gh-release. Lit les
// archives réellement présentes dans dist/ : une cible en échec n'apparaît pas
// dans le tableau, et les tailles affichées sont les vraies.
//
//   node tools/release-body.mjs            écrit release-body.md
//
// Sans cette étape, GitHub ne montre qu'un « Full Changelog » automatique :
// un visiteur qui arrive sur la page Releases ne sait ni ce qu'il télécharge,
// ni comment l'installer.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const OUT = join(ROOT, "release-body.md");

const REPO = process.env.SIMIA_REPO ?? "zigmoon/SIMIA";
const SITE = "https://app.zigmoon.com/SIMIA/";
const VERSION = (process.env.GITHUB_REF_NAME ?? "v0.1.0").replace(/^v/, "");

// Nom d'archive produit par le workflow -> ce qu'on en dit au visiteur.
const TARGETS = [
  {
    file: "simia-windows-x64.zip",
    os: "Windows",
    detail: "10 et 11, 64 bits",
    note: "Moteur Vulkan, repli processeur.",
  },
  {
    file: "simia-macos-arm64.tar.gz",
    os: "macOS Apple Silicon",
    detail: "M1 et plus récent",
    note: "Moteur Metal, génération d'images comprise.",
  },
  {
    file: "simia-macos-x64.tar.gz",
    os: "macOS Intel",
    detail: "x86_64",
    note: "Conversation et code complets ; génération d'images masquée, faute de binaire stable-diffusion.cpp pour Intel.",
  },
  {
    file: "simia-linux-x64.tar.gz",
    os: "Linux",
    detail: "x86_64",
    note: "Moteur Vulkan, repli processeur. Testé sur Ubuntu 24.04.",
  },
];

function human(bytes) {
  const mb = bytes / 1024 / 1024;
  if (mb >= 1024) return `${(mb / 1024).toFixed(2).replace(".", ",")} Go`;
  return `${mb.toFixed(1).replace(".", ",")} Mo`;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

let entries = [];
try {
  entries = readdirSync(DIST);
} catch {
  console.error("dist/ introuvable : rien à décrire.");
}

const found = [];
for (const target of TARGETS) {
  if (!entries.includes(target.file)) continue;
  const path = join(DIST, target.file);
  found.push({
    ...target,
    href: `https://github.com/${REPO}/releases/download/v${VERSION}/${target.file}`,
    bytes: statSync(path).size,
    digest: sha256(path),
  });
}

if (!found.length) {
  console.error("aucune archive reconnue dans dist/");
  process.exit(1);
}

const missing = TARGETS.filter((t) => !found.some((f) => f.file === t.file));

const table = [
  "| Système | Matériel | Archive | Taille |",
  "|---|---|---|---|",
  ...found.map(
    (f) => `| **${f.os}** | ${f.detail} | [\`${f.file}\`](${f.href}) | ${human(f.bytes)} |`,
  ),
].join("\n");

const notes = found
  .filter((f) => f.note.includes("masquée"))
  .map((f) => `- **${f.os}** : ${f.note}`)
  .join("\n");

const checksums = found
  .map((f) => `${f.digest}  ${f.file}`)
  .join("\n");

const body = `**Assistant IA local, privé et hors ligne.** Conversation, analyse de
documents, génération d'images et atelier de code, exécutés sur votre machine.
Pas de compte, pas de clé API, pas de serveur : vos phrases ne quittent pas
l'ordinateur.

Chaque archive contient le lanceur, les moteurs d'inférence
(llama.cpp et stable-diffusion.cpp), l'interface complète et le style
« Gravure SIMIA ». Les poids des modèles se téléchargent depuis l'application,
au moment où vous en choisissez un.

## Télécharger

${table}

## Installer

1. Décompressez l'archive où vous voulez : aucun droit administrateur n'est
   nécessaire.
2. Lancez \`simia-desktop\` (\`simia-desktop.exe\` sur Windows).
3. Choisissez un modèle : il se télécharge une fois, puis reste sur la machine.

**macOS** — le binaire n'est pas signé, Gatekeeper le met en quarantaine :

\`\`\`bash
xattr -dr com.apple.quarantine simia-desktop
chmod +x simia-desktop
\`\`\`

**Windows** — SmartScreen affiche un avertissement à la première ouverture,
faute de signature de code : *Informations complémentaires* puis
*Exécuter quand même*.

**Linux** — rendez le fichier exécutable si l'archive a perdu le droit :

\`\`\`bash
chmod +x simia-desktop
\`\`\`

${notes ? `## À savoir\n\n${notes}\n` : ""}
## Vérifier l'intégrité

Un transfert interrompu peut produire une archive de bonne taille mais corrompue.
Empreintes SHA-256 de cette version :

\`\`\`
${checksums}
\`\`\`

## Aussi disponible

- **Version web, installable** — [${SITE}](${SITE}) : rien à télécharger, elle
  s'installe depuis Chrome ou Edge, ou depuis Safari sur iPhone et iPad.
- **Documentation** — [README](https://github.com/${REPO}#readme).
- **Toutes les versions** —
  [${REPO}/releases](https://github.com/${REPO}/releases).
- **Changements de cette version** —
  [commits de v${VERSION}](https://github.com/${REPO}/commits/v${VERSION}).

${missing.length ? `> Cette version n'inclut pas : ${missing.map((m) => m.os).join(", ")}. La compilation a échoué pour cette cible — les autres archives restent utilisables.\n` : ""}`;

writeFileSync(OUT, body, "utf8");
console.log(`release-body.md écrit : ${found.length} archive(s) décrite(s).`);
for (const f of found) console.log(`  ${f.file.padEnd(30)} ${human(f.bytes)}`);
if (missing.length) console.log(`  absentes : ${missing.map((m) => m.file).join(", ")}`);
