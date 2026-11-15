// Regénère le tableau « Versions publiées » du README à partir des releases GitHub.
// Appelé par le workflow à chaque étiquette, et utilisable à la main :
//   node tools/update-readme-versions.mjs
// Sans jeton, l'API GitHub est limitée à 60 requêtes par heure et par IP.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const README = join(ROOT, "README.md");
const REPO = process.env.SIMIA_REPO ?? "zigmoon/SIMIA";
const MAX_RELEASES = 10;

const START = "<!-- versions:start -->";
const END = "<!-- versions:end -->";

// Nom d'archive produit par le workflow -> libellé de colonne.
const COLUMNS = [
  { label: "Windows", match: /^simia-windows-x64\.(zip|tar\.gz)$/ },
  { label: "macOS ARM", match: /^simia-macos-arm64\.(zip|tar\.gz)$/ },
  { label: "macOS Intel", match: /^simia-macos-x64\.(zip|tar\.gz)$/ },
  { label: "Linux", match: /^simia-linux-x64\.(zip|tar\.gz)$/ },
];

const EMPTY = "| _Aucune version publiée pour le moment._ | | | | | |";

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const mb = bytes / 1024 / 1024;
  if (mb < 1024) return `${Math.round(mb)} Mo`;
  return `${(mb / 1024).toFixed(1).replace(".", ",")} Go`;
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

async function loadReleases() {
  const response = await fetch(
    `https://api.github.com/repos/${REPO}/releases?per_page=${MAX_RELEASES}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "simia-readme-versions",
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
    },
  );
  if (!response.ok) {
    throw new Error(`API GitHub ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

function buildTable(releases) {
  const rows = releases
    .filter((release) => !release.draft && release.tag_name)
    .map((release) => {
      const assets = Array.isArray(release.assets) ? release.assets : [];
      const cells = COLUMNS.map((column) => {
        const asset = assets.find((item) => column.match.test(item.name ?? ""));
        if (!asset) return "—";
        const size = formatSize(asset.size);
        const label = asset.name.endsWith(".zip") ? "zip" : "tar.gz";
        return `[${label}${size ? ` ${size}` : ""}](${asset.browser_download_url})`;
      });
      const version = `[${release.tag_name}](${release.html_url})`;
      return `| ${version} | ${formatDate(release.published_at ?? release.created_at)} | ${cells.join(" | ")} |`;
    });

  const header =
    "| Version | Date | Windows | macOS ARM | macOS Intel | Linux |\n" +
    "|---|---|---|---|---|---|";

  return header + "\n" + (rows.length ? rows.join("\n") : EMPTY);
}

const source = readFileSync(README, "utf8");
const startAt = source.indexOf(START);
const endAt = source.indexOf(END);
if (startAt === -1 || endAt === -1 || endAt < startAt) {
  console.error(`Marqueurs ${START} / ${END} absents du README.`);
  process.exit(1);
}

const eol = source.includes("\r\n") ? "\r\n" : "\n";

let table;
try {
  table = buildTable(await loadReleases());
} catch (error) {
  console.error(`Versions indisponibles (${error.message}). README inchangé.`);
  process.exit(0);
}

const block = `${START}${eol}${table.replace(/\n/g, eol)}${eol}${END}`;
const updated = source.slice(0, startAt) + block + source.slice(endAt + END.length);

if (updated === source) {
  console.log("README déjà à jour.");
} else {
  writeFileSync(README, updated, "utf8");
  console.log("README mis à jour.");
}
