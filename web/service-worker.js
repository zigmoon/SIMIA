const CACHE_NAME = "simia-shell-v159";
const APP_SHELL = ["./index.html", "./styles.css", "./app.js", "./code-runner.js", "./cookies-config.js", "./manifest.webmanifest", "./icon.svg", "./simia-logo.svg", "./simia-logo-white.svg"];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      await Promise.all(APP_SHELL.map(async asset => {
        const response = await fetch(asset, { cache: "reload" });
        if (!response.ok) throw new Error(`Unable to cache ${asset}`);
        await cache.put(asset, response);
      }));
      await self.skipWaiting();
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/models/") || url.pathname.endsWith("/agent-api.php")) return;

  const isNavigation = request.mode === "navigate";

  if (isNavigation) {
    // Network-first pour les pages : toujours la dernière version, avec repli cache hors-ligne.
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Cache-first pour les assets statiques (CSS/JS/SVG).
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        return response;
      });
    })
  );
});
