/* SIMIA â€” service worker
 *
 * Trois responsabilites, et rien d'autre :
 *   1. garder la coquille (interface + page de presentation) disponible hors ligne ;
 *   2. servir vite depuis le cache tout en rafraichissant en arriere-plan ;
 *   3. ne jamais intercepter les poids des modeles ni les points d'entree PHP.
 *
 * Les fichiers prefixes par une version : incrementer VERSION suffit a purger
 * l'ancien cache a l'activation.
 *
 * Mise a jour : le nouveau worker attend sagement. La page detecte ce worker en
 * attente, propose Â« Recharger Â» et envoie SKIP_WAITING. Aucun rechargement
 * surprise au milieu d'une conversation.
 */

const VERSION = "3.1.0";
const CACHE = `simia-shell-${VERSION}`;

/* Un cache d'une ancienne generation (`simia-shell-v146`) signale un worker qui
   ne se met jamais a jour : il sert son cache pour toujours et le nouveau
   worker reste en attente indefiniment. Dans ce cas precis, et seulement dans
   celui-la, on prend la main immediatement au lieu d'attendre un clic. */
const LEGACY_CACHE = /^simia-shell-(?!\d+\.\d+\.\d+$)/;

async function legacyWorkerPresent() {
  try {
    const keys = await caches.keys();
    return keys.some(key => key.startsWith("simia-shell-") && LEGACY_CACHE.test(key));
  } catch {
    return false;
  }
}

const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./code-runner.js",
  "./cookies-config.js",
  "./manifest.webmanifest",
  "./offline.html",
  "./icon.svg",
  "./simia-logo.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon-180.png",
];

// Facultatif : absent du serveur, l'installation continue quand meme.
const OPTIONAL = ["./desktop/", "./desktop/index.html"];

const NAV_TIMEOUT = 4000;
const OFFLINE_PAGE = "./offline.html";

/* Chemins a ne jamais mettre en cache : poids des modeles (plusieurs Go) et
   points d'entree PHP (POST, reponses personnalisees). */
function isBypassed(url) {
  if (url.pathname.includes("/models/")) return true;
  if (/\.(gguf|safetensors|onnx|bin|pt|ckpt)$/i.test(url.pathname)) return true;
  if (/\.php$/i.test(url.pathname)) return true;
  if (url.pathname.endsWith("/service-worker.js")) return true;
  return false;
}

function isAsset(request, url) {
  if (/\.(css|js|mjs|svg|png|jpe?g|webp|ico|woff2?|ttf|webmanifest|json|txt|xml)$/i.test(url.pathname)) return true;
  return ["style", "script", "image", "font", "manifest"].includes(request.destination);
}

/* Page a servir hors ligne pour une navigation donnee. On ne detourne que les
   adresses de l'application : une URL inconnue affiche la page hors ligne,
   jamais la coquille (sinon elle repondrait 200 a n'importe quoi). */
function pageFor(url) {
  const path = url.pathname;
  if (/\/desktop(\/|$)/i.test(path)) return "./desktop/index.html";
  if (path.endsWith("/index.html") || path.endsWith("/")) return "./index.html";
  return OFFLINE_PAGE;
}

async function precache() {
  const cache = await caches.open(CACHE);
  const put = async url => {
    const request = new Request(url, { cache: "reload" });
    const response = await fetch(request);
    if (!response || !response.ok) throw new Error(`${url} â†’ ${response ? response.status : "rÃ©seau"}`);
    await cache.put(url, response);
  };

  const results = await Promise.allSettled(CORE.map(put));
  const failures = results.filter(result => result.status === "rejected");
  if (failures.length) {
    console.warn("[SIMIA] prÃ©cache incomplet :", failures.map(failure => String(failure.reason)));
  }
  // La moindre coquille manquante rendrait l'application inutilisable hors ligne.
  if (failures.length === results.length) throw new Error("prÃ©cache impossible");

  await Promise.allSettled(OPTIONAL.map(put));
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    try {
      await precache();
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
    // Premiere installation, ou migration depuis un worker qui ne se mettait
    // jamais a jour : on prend la main tout de suite. Sinon (mise a jour
    // normale) on reste en attente, la page proposera de recharger.
    if (!self.registration.active || (await legacyWorkerPresent())) {
      await self.skipWaiting();
    }
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: "window" });
    clients.forEach(client => client.postMessage({ type: "SIMIA_SW_ACTIVE", version: VERSION }));
  })());
});

self.addEventListener("message", event => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") self.skipWaiting();
  if (data.type === "GET_VERSION") {
    (event.source || self).postMessage?.({ type: "SIMIA_SW_VERSION", version: VERSION });
  }
});

/* Course entre le reseau et un delai : un serveur lent ne doit pas bloquer
   l'ouverture de l'application. */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("dÃ©lai dÃ©passÃ©")), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

/* Le cache HTTP du navigateur peut renvoyer une version perimee : on force la
   revalidation aupres du serveur pour chaque requete reseau du worker. */
function freshRequest(request) {
  try {
    return new Request(request, { cache: "no-cache" });
  } catch {
    return request;
  }
}

async function handleNavigation(event, url) {
  const cache = await caches.open(CACHE);
  try {
    const response = await withTimeout(fetch(freshRequest(event.request)), NAV_TIMEOUT);
    if (!response || response.type !== "basic") throw new Error("rÃ©ponse non exploitable");
    // Un 404 du serveur reste un 404 : on ne le remplace pas par une page du cache.
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(cache.put(url.origin + url.pathname, copy).catch(() => {}));
    }
    return response;
  } catch {
    const cached = await cache.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    const page = await cache.match(pageFor(url));
    if (page) return page;
    const offline = await cache.match(OFFLINE_PAGE);
    if (offline) return offline;
    return new Response("SIMIA est hors ligne et la page n'est pas en cache.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function handleAsset(event, url) {
  const cache = await caches.open(CACHE);
  const key = url.origin + url.pathname;
  const cached = await cache.match(key);

  // Le rafraichissement doit etre rattache a l'evenement : sans waitUntil, le
  // navigateur peut endormir le worker avant l'ecriture, et le cache ne se
  // mettrait jamais a jour.
  const network = (async () => {
    try {
      const response = await fetch(freshRequest(event.request));
      if (response && response.ok && response.type === "basic") {
        await cache.put(key, response.clone());
      }
      return response;
    } catch {
      return null;
    }
  })();
  event.waitUntil(network);

  if (cached) return cached;
  const fresh = await network;
  if (fresh) return fresh;
  const offlineAsset = await cache.match(key, { ignoreSearch: true });
  if (offlineAsset) return offlineAsset;
  return new Response("", { status: 504, statusText: "Hors ligne" });
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (isBypassed(url)) return;
  if (request.headers.has("range")) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event, url));
    return;
  }

  if (isAsset(request, url)) {
    event.respondWith(handleAsset(event, url));
  }
});
