/* Executeur de l'atelier SIMIA.
 *
 * Il vit dans un fichier separe (et non dans un Blob) pour deux raisons :
 * - un Worker dedie n'a pas acces au DOM ni au stockage du document ;
 * - sa politique de securite est celle de sa propre reponse, pas celle de la
 *   page, qui interdit 'unsafe-eval'. Lancer du JavaScript utilisateur exige
 *   cette capacite, et elle reste confinee a ce worker.
 *
 * Protocole : { code, language } en entree, { ok, lines[] } en sortie, et
 * { stage: "loading-python" } pendant le premier chargement de Pyodide.
 */

const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.29.0/full/";
/* `new Function` ne connait pas await : ce constructeur equivaut a une fonction
 * async, ce qui accepte await et return au premier niveau du code colle. */
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
/* Garde-fou : une boucle qui imprime en continu ne doit pas saturer le DOM. */
const MAX_LINES = 400;
/* Marqueur renvoye au document, qui le remplace par un message traduit. */
const PYODIDE_OFFLINE = "PYODIDE_LOAD_FAILED";

let pyodidePromise = null;

function ensurePyodide() {
  if (!pyodidePromise) {
    self.postMessage({ stage: "loading-python" });
    try {
      importScripts(`${PYODIDE_URL}pyodide.js`);
    } catch {
      throw new Error(PYODIDE_OFFLINE);
    }
    pyodidePromise = loadPyodide({ indexURL: PYODIDE_URL }).catch(() => {
      pyodidePromise = null;
      throw new Error(PYODIDE_OFFLINE);
    });
  }
  return pyodidePromise;
}

function format(value) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "function") return `[function ${value.name || "anonymous"}]`;
  try {
    const text = JSON.stringify(value);
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
}

/* Les erreurs Python contiennent la trace Python suivie de dizaines de frames
 * WebAssembly : on ne garde que la partie utile. */
function formatError(error) {
  if (!error) return String(error);
  const text = String(error.message || error);
  if (text === PYODIDE_OFFLINE) return text;
  if (text.includes("Traceback (most recent call last)")) {
    const cut = text.indexOf("\n    at ");
    return (cut > 0 ? text.slice(0, cut) : text).trim();
  }
  return error.stack || text;
}

async function run(code, language) {
  const lines = [];
  const push = (kind, text) => {
    if (lines.length > MAX_LINES) return;
    if (lines.length === MAX_LINES) {
      lines.push({ kind: "muted", text: "… sortie tronquée à 400 lignes." });
      return;
    }
    lines.push({ kind, text: String(text) });
  };
  console.log = console.info = console.debug = (...args) => push("log", args.map(format).join(" "));
  console.warn = (...args) => push("warn", args.map(format).join(" "));
  console.error = (...args) => push("error", args.map(format).join(" "));

  try {
    if (language === "python") {
      const pyodide = await ensurePyodide();
      pyodide.setStdout({ batched: text => push("log", text) });
      pyodide.setStderr({ batched: text => push("error", text) });
      const result = await pyodide.runPythonAsync(code);
      if (result !== undefined && result !== null) push("return", format(result));
    } else {
      const value = await new AsyncFunction(code)();
      if (value !== undefined) push("return", format(value));
    }
    self.postMessage({ ok: true, lines });
  } catch (error) {
    push("error", formatError(error));
    self.postMessage({ ok: false, lines });
  }
}

self.onmessage = event => {
  const data = event.data || {};
  run(data.code, data.language);
};
