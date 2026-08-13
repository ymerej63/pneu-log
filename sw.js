// Service worker — Suivi des Pneus
// Objectif : l'app démarre et fonctionne intégralement sans réseau (paddock, montagne).
//
// Stratégie :
//  - navigation (ouverture de l'app) : réseau d'abord avec timeout court, sinon cache.
//    -> tu vois la nouvelle version dès qu'il y a du réseau, et l'app s'ouvre quand même sans.
//  - reste des ressources : cache d'abord + revalidation en arrière-plan.
//  - précache tolérant : un fichier manquant (manifest, icône) ne casse plus l'install.

const VERSION = 'v22';
const CACHE = 'suivi-pneus-' + VERSION;

// Indispensable : si ça échoue, l'install échoue (et c'est voulu).
const ESSENTIAL = ['./index.html'];

// Souhaitable : un échec est toléré (404, CDN injoignable…).
const OPTIONAL = [
  './',
  './manifest.json',
  './apple-touch-icon.png',
  'https://cdn.jsdelivr.net/npm/zxing-wasm@2/dist/iife/reader/index.js',
  // OCR-B : la police des étiquettes. Précachée pour que l'app garde son
  // apparence dès le premier lancement hors réseau.
  'https://cdn.jsdelivr.net/gh/raisty/OCR-B@1.1/dist/OCR-B.ttf',
];

const NAV_TIMEOUT = 2500; // ms avant de basculer sur le cache

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(ESSENTIAL);
    await Promise.allSettled(OPTIONAL.map((u) => c.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isCacheable(url) {
  return url.origin === location.origin ||
    url.hostname === 'cdn.jsdelivr.net' ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com';
}

// Ouverture de l'app : réseau d'abord, mais on n'attend jamais longtemps.
async function handleNavigation(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), NAV_TIMEOUT)),
    ]);
    if (res && res.ok) cache.put('./index.html', res.clone());
    return res;
  } catch (e) {
    // hors ligne ou réseau trop lent : on sert la dernière version connue
    return (await cache.match('./index.html')) ||
           (await cache.match('./', { ignoreSearch: true })) ||
           new Response(
             '<!doctype html><meta charset="utf-8"><body style="background:#121417;color:#EDEAE3;' +
             'font-family:sans-serif;padding:40px;text-align:center">' +
             '<p>Application non encore mise en cache.<br>Ouvre-la une fois avec du reseau.</p>',
             { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
           );
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate') {
    e.respondWith(handleNavigation(req));
    return;
  }

  const url = new URL(req.url);
  if (!isCacheable(url)) return;

  e.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: url.origin !== location.origin });
    const network = fetch(req)
      .then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => cached);
    return cached || network;
  })());
});
