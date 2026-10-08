/* =============================================================================
   PILOT-SHOP — sw.js
   Service worker offline-first. La chambre froide n'a pas de réseau :
   l'application doit s'ouvrir instantanément, réseau ou pas.
   ============================================================================= */

/* La version doit changer à CHAQUE modification de la liste ci-dessous : c'est
   elle qui déclenche le re-téléchargement. Un appareil déjà installé garderait
   sinon l'ancien cache, et n'irait jamais chercher les fichiers ajoutés — le
   scan hors ligne ne marcherait que sur les appareils neufs. */
const CACHE   = 'pilotshop-cache-v10';
/* Nom FIXE, sans numéro de version : polices et bibliothèques du CDN ne
   changent pas avec l'application. Le renommer à chaque version les faisait
   purger à l'activation, donc re-télécharger — impossible en chambre froide. */
const RUNTIME = 'pilotshop-runtime';

const PRECACHE = [
  '/',
  '/index.html',
  /* Sans env.js hors ligne, l'application démarre sans l'adresse de la base :
     les saisies restent locales et ne partent jamais en file d'attente. */
  '/env.js',
  '/style.css',
  '/fonts/inter.woff2',
  '/config.js',
  '/auth.js',
  '/app.js',
  '/ocr.js',
  '/modules.js',
  '/stock.js',
  /* Reconnaissance de texte embarquée : sans elle, le scan ne marche pas
     hors ligne, alors que c'est là qu'on en a le plus besoin. */
  '/vendor/tesseract.min.js',
  '/vendor/tesseract-worker.min.js',
  '/vendor/tesseract-core-simd.wasm.js',
  '/vendor/fra.traineddata.gz',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-180.png',
  /* Icônes « maskable » déclarées dans le manifest : sans elles hors ligne,
     l'icône installée sur Android peut retomber sur une version par défaut. */
  '/icons/icon-192-maskable.png',
  '/icons/icon-512-maskable.png'
];

/* Ressources externes : mises en cache à la volée, jamais bloquantes */
const EXTERNES = [
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
        if (!r || !r.ok) throw new Error('precache ' + url);
        await cache.put(url, r);
      } catch (e) {
        /* Téléchargement raté (Wi-Fi faible) : on reprend la copie de l'ancienne
           version, sinon l'activation la purgerait et le scan hors ligne
           (plusieurs Mo de Tesseract) disparaîtrait. */
        const ancienne = await caches.match(url);
        if (ancienne) await cache.put(url, ancienne);
      }
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
    /* Le cache runtime (nom fixe) est conservé ; les anciens caches
       « pilotshop-runtime-vN » numérotés, eux, sont purgés. */
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
   Fichiers du app → réseau d'abord, repli sur le cache
   Modèle Tesseract → cache-first (mis en cache à la première réponse)
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

  /* --- Navigation : réseau d'abord, cache en secours ---
     La stratégie « cache d'abord » faisait qu'un déploiement n'apparaissait
     qu'au deuxième chargement : la page servie était l'ancienne, la nouvelle
     n'arrivant qu'en arrière-plan. En boutique, ça veut dire travailler une
     journée entière sur une version périmée sans le savoir. */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        /* Le préchargement de navigation peut lui aussi rester pendu sur un
           Wi-Fi muet : même délai que le fetch, et repli sur le cache. */
        const preload = await avecDelai(Promise.resolve(event.preloadResponse), 4000);
        const r = preload || await avecDelai(fetch(req), 4000);
        /* Une panne serveur (5xx) passe au secours du cache ; un 4xx (page
           absente, protection Vercel) est montré tel quel. Seule la page
           d'accueil peut remplacer la coquille hors ligne — pas un PDF ou une
           image ouverts dans l'application. */
        if (!r || r.status >= 500) throw new Error('navigation ' + (r && r.status));
        if (r.ok && (url.pathname === '/' || url.pathname === '/index.html')) {
          event.waitUntil(cache.put('/index.html', r.clone()).catch(() => {}));
        }
        return r;
      } catch (e) {
        const cachee = await cache.match('/index.html');
        return cachee || new Response(pageSecours(), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
    })());
    return;
  }

  /* --- Modèle de lecture (vendor/*.traineddata*) : cache d'abord ---
     ocr.js passe cacheMethod:'none' : Tesseract ne garde plus le modèle dans
     IndexedDB, c'est donc ce cache qui l'évite à chaque scan. Plusieurs Mo,
     qui ne changent pas d'une version à l'autre : pas de réseau d'abord. */
  if (url.origin === self.location.origin &&
      /^\/vendor\/[^/]*\.traineddata/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cachee = await cache.match(url.pathname) || await cache.match(req);
      if (cachee) return cachee;
      try {
        const r = await fetch(req);
        /* Première réponse réseau complète (200) : mise en cache. */
        if (r && r.status === 200 && r.type === 'basic') {
          event.waitUntil(cache.put(url.pathname, r.clone()).catch(() => {}));
        }
        return r;
      } catch (e) {
        return new Response('', { status: 504, statusText: 'Hors ligne' });
      }
    })());
    return;
  }

  /* --- Fichiers de l'application : réseau d'abord, repli sur le cache ---
     Ils pèsent quelques centaines de kilo-octets et sont servis par Vercel :
     la fraîcheur vaut mieux que les quelques dixièmes de seconde économisées. */
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const r = await avecDelai(fetch(req), 4000);
        /* 200 seulement : une réponse partielle (206) ou un quota plein ferait
           échouer cache.put, et la bonne réponse réseau serait jetée. */
        if (r && r.status === 200 && r.type === 'basic') {
          event.waitUntil(cache.put(req, r.clone()).catch(() => {}));
        }
        return r;
      } catch (e) {
        const cachee = await cache.match(req);
        return cachee || new Response('', { status: 504, statusText: 'Hors ligne' });
      }
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
        /* Délai maximum : sans lui, un CDN injoignable bloquait la requête
           (et l'écran) sans fin. */
        const r = await avecDelai(fetch(req), 4000);
        /* Jamais de réponse opaque : son statut est illisible, une erreur du
           CDN resterait en cache jusqu'à la prochaine version. */
        if (r && r.ok) event.waitUntil(cache.put(req, r.clone()).catch(() => {}));
        return r;
      } catch (e) {
        return cachee || new Response('', { status: 504, statusText: 'Hors ligne' });
      }
    })());
  }
});

/* -----------------------------------------------------------------------------
   OUTIL : une promesse qui échoue si le réseau traîne
   Sans délai maximum, un Wi-Fi présent mais muet — le cas classique de la
   chambre froide — laisserait l'application bloquée sur un écran blanc.
   -------------------------------------------------------------------------- */
function avecDelai(promesse, ms) {
  return Promise.race([
    promesse,
    new Promise((_, ko) => setTimeout(() => ko(new Error('delai depasse')), ms))
  ]);
}

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
