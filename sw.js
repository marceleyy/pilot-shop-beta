/* =============================================================================
   PILOT-SHOP — sw.js
   Service worker offline-first. La chambre froide n'a pas de réseau :
   l'application doit s'ouvrir instantanément, réseau ou pas.
   ============================================================================= */

const CACHE   = 'pilotshop-cache-v3';
const RUNTIME = 'pilotshop-runtime-v3';

const PRECACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/config.js',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-180.png'
];

/* Ressources externes : mises en cache à la volée, jamais bloquantes */
const EXTERNES = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com'
];

/* -----------------------------------------------------------------------------
   INSTALLATION — précache tolérant à l'échec unitaire
   Un seul fichier absent ne doit pas faire échouer toute l'installation.
   -------------------------------------------------------------------------- */
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(PRECACHE.map(async url => {
      try {
        const r = await fetch(new Request(url, { cache: 'reload' }));
        if (r && r.ok) await cache.put(url, r);
      } catch (e) { /* ressource optionnelle absente : on continue */ }
    }));
    await self.skipWaiting();
  })());
});

/* -----------------------------------------------------------------------------
   ACTIVATION — purge des anciennes versions, prise de contrôle immédiate
   -------------------------------------------------------------------------- */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const noms = await caches.keys();
    await Promise.all(noms.map(n => (n !== CACHE && n !== RUNTIME) ? caches.delete(n) : null));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) {}
    }
    await self.clients.claim();
  })());
});

/* -----------------------------------------------------------------------------
   RÉCUPÉRATION
   Navigation      → cache d'abord, réseau en arrière-plan (ouverture instantanée)
   Fichiers du app → stale-while-revalidate
   Polices, CDN    → cache-first, mise en cache runtime
   Écritures / API → réseau seul, jamais de cache
   -------------------------------------------------------------------------- */
self.addEventListener('fetch', event => {
  const req = event.request;

  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  /* Ne jamais mettre en cache les appels de données */
  if (url.pathname.startsWith('/rest/') ||
      url.pathname.startsWith('/auth/') ||
      url.hostname.endsWith('.supabase.co') ||
      url.hostname === 'api.open-meteo.com') {
    return;
  }

  /* --- Navigation : l'app s'ouvre même sans réseau --- */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cachee = await cache.match('/index.html');

      const reseau = (async () => {
        try {
          const preload = await event.preloadResponse;
          const r = preload || await fetch(req);
          if (r && r.ok) await cache.put('/index.html', r.clone());
          return r;
        } catch (e) { return null; }
      })();

      if (cachee) { event.waitUntil(reseau); return cachee; }
      const r = await reseau;
      return r || new Response(pageSecours(), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    })());
    return;
  }

  /* --- Fichiers de l'application : stale-while-revalidate --- */
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cachee = await cache.match(req);

      const reseau = fetch(req).then(async r => {
        if (r && r.ok && r.type === 'basic') await cache.put(req, r.clone());
        return r;
      }).catch(() => null);

      if (cachee) { event.waitUntil(reseau); return cachee; }
      const r = await reseau;
      return r || new Response('', { status: 504, statusText: 'Hors ligne' });
    })());
    return;
  }

  /* --- Polices et CDN : cache-first, repli réseau --- */
  if (EXTERNES.some(h => url.hostname.endsWith(h))) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const cachee = await cache.match(req);
      if (cachee) return cachee;
      try {
        const r = await fetch(req);
        if (r && (r.ok || r.type === 'opaque')) await cache.put(req, r.clone());
        return r;
      } catch (e) {
        return cachee || new Response('', { status: 504, statusText: 'Hors ligne' });
      }
    })());
  }
});

/* -----------------------------------------------------------------------------
   MESSAGES — mise à jour pilotée depuis l'application
   -------------------------------------------------------------------------- */
self.addEventListener('message', event => {
  const d = event.data || {};
  if (d.type === 'SKIP_WAITING') self.skipWaiting();
  if (d.type === 'VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ cache: CACHE });
  }
  if (d.type === 'PURGE') {
    event.waitUntil(caches.keys().then(k => Promise.all(k.map(n => caches.delete(n)))));
  }
});

/* -----------------------------------------------------------------------------
   SYNCHRONISATION EN ARRIÈRE-PLAN — file d'attente OFFLINE
   Absente sur iOS aujourd'hui : l'application resynchronise aussi à
   l'événement 'online'. Ce bloc sert les navigateurs qui le supportent.
   -------------------------------------------------------------------------- */
self.addEventListener('sync', event => {
  if (event.tag !== 'pilotshop-sync') return;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach(c => c.postMessage({ type: 'SYNC_NOW' }));
  })());
});

/* -----------------------------------------------------------------------------
   PAGE DE SECOURS — uniquement au tout premier lancement sans réseau
   -------------------------------------------------------------------------- */
function pageSecours() {
  return '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<title>Pilot-Shop</title><style>' +
    'body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#F2F6F7;color:#0F2027;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px;text-align:center}' +
    '.b{background:#fff;border-radius:16px;padding:28px;max-width:380px;box-shadow:0 6px 24px rgba(15,32,39,.08)}' +
    'h1{margin:0 0 6px;font-size:22px}p{color:#5F757F;font-size:14px;line-height:1.5;margin:0}' +
    'button{margin-top:20px;width:100%;min-height:56px;border:0;border-radius:14px;background:#0F2027;' +
    'color:#fff;font-size:16px;font-weight:600}</style></head><body><div class="b">' +
    '<h1>Pilot-Shop</h1>' +
    '<p>L’application n’a pas encore été installée sur cet appareil et le réseau est indisponible. ' +
    'Rapprochez-vous du Wi-Fi de la boutique, puis rouvrez : elle fonctionnera ensuite hors ligne, ' +
    'y compris en chambre froide.</p>' +
    '<button onclick="location.reload()">Réessayer</button>' +
    '</div></body></html>';
}
