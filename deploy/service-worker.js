/*
 * SIMIA - service worker de la racine du site.
 *
 * La racine servait autrefois l'application : les visiteurs qui l'avaient
 * installee ont encore un service worker actif dont le perimetre couvre tout
 * /SIMIA/. Sans ce fichier, ce worker continuerait de repondre depuis son cache
 * et la landing resterait invisible.
 *
 * Il ne fait donc qu'une chose : rendre la main au reseau, puis disparaitre.
 * L'application, desormais servie depuis /SIMIA/app/, possede son propre worker.
 */

const OLD_CACHE = /^simia-shell-/;

self.addEventListener("install", () => {
  // Prendre la main tout de suite : le worker precedent ne doit pas attendre
  // la fermeture de tous les onglets pour laisser passer la landing.
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter(name => OLD_CACHE.test(name)).map(name => caches.delete(name))
    );
    await self.clients.claim();
    // Le perimetre ne sert plus rien : on libere l'enregistrement pour que le
    // navigateur ne revienne pas interroger ce fichier a chaque visite.
    await self.registration.unregister();
  })());
});

// Aucun gestionnaire "fetch" : tout repart au reseau, landing comprise.
