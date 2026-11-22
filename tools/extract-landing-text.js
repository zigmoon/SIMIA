// Extrait les chaines visibles de la landing pour preparer la traduction.
const fs = require("fs");
const path = process.argv[2];
let html = fs.readFileSync(path, "utf8");

// On retire les zones non visibles.
html = html
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<!--[\s\S]*?-->/g, " ")
  .replace(/<svg[\s\S]*?<\/svg>/gi, " ");

const texts = new Map();
const re = />([^<>]+)</g;
let m;
while ((m = re.exec(html))) {
  const value = m[1].replace(/\s+/g, " ").trim();
  if (!value) continue;
  if (!/[a-zà-ÿ]/i.test(value)) continue;
  if (/^[&][a-z]+;$/.test(value)) continue;
  texts.set(value, (texts.get(value) || 0) + 1);
}

const attrs = new Map();
const reAttr = /(?:placeholder|title|aria-label|alt|content)="([^"]{3,})"/g;
while ((m = reAttr.exec(html))) {
  const value = m[1].replace(/\s+/g, " ").trim();
  if (!/[a-zà-ÿ]/i.test(value)) continue;
  attrs.set(value, (attrs.get(value) || 0) + 1);
}

const out = { texts: [...texts.keys()], attrs: [...attrs.keys()] };
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1), "utf8");
console.log("textes:", out.texts.length, "attributs:", out.attrs.length);
console.log("caracteres:", out.texts.join(" ").length + out.attrs.join(" ").length);
