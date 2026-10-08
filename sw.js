/* =============================================================================
   PILOT-SHOP — sw.js
   Service worker offline-first. La chambre froide n'a pas de réseau :
   l'application doit s'ouvrir instantanément, réseau ou pas.
   ============================================================================= */

/* La version doit changer à CHAQUE modification de la liste ci-dessous : c'est
   elle qui déclenche le re-téléchargement. Un appareil déjà installé garderait
   sinon l'ancien cache, et n'irait jamais chercher les fichiers ajoutés — le
   scan hors ligne ne marcherait que sur les appareils neufs. */
const CACHE   = 'pilotshop-cache-v21';
/* Cache des ressources externes. Il ne sert plus : XLSX est désormais servi
   par l'application (vendor/). Son ancien contenu — la copie du CDN, gardée
   « cache d'abord » sous ce nom fixe et jamais revalidée — est purgé à
   l'activation : une copie altérée y aurait survécu à toutes les versions. */
const RUNTIME = 'pilotshop-runtime';

const PRECACHE = [
  '/',
  '/index.html',
  /* Sans env.js hors ligne, l'application démarre sans l'adresse de la base :
     les saisies restent locales et ne partent jamais en file d'attente. */
  '/env.js',
  '/style.css',
  /* Habillage « Maison glacière », chargé après style.css. */
  '/premium.css',
  '/fonts/inter.woff2',
  '/config.js',
  '/auth.js',
  '/app.js',
  '/ocr.js',
  '/modules.js',
  '/stock.js',
  '/calcul.js',
  /* Reconnaissance de texte embarquée : sans elle, le scan ne marche pas
     hors ligne, alors que c'est là qu'on en a le plus besoin. */
  '/vendor/tesseract.min.js',
  '/vendor/tesseract-worker.min.js',
  '/vendor/tesseract-core-simd.wasm.js',
  '/vendor/fra.traineddata.gz',
  /* Lecture des exports de caisse (XLSX 0.18.5), autrefois chargée d'un CDN. */
  '/vendor/xlsx.full.min.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-180.png',
  /* Icônes « maskable » déclarées dans le manifest : sans elles hors ligne,
     l'icône installée sur Android peut retomber sur une version par défaut. */
  '/icons/icon-192-maskable.png',
  '/icons/icon-512-maskable.png'
];

/* Ressources externes : aucune aujourd'hui (polices et XLSX sont locaux). */
const EXTERNES = [];

/* Wi-Fi connecté mais sans Internet : la navigation attendait 4 s, puis
   chaque vague de fichiers 4 s de plus (styles et scripts, puis la police) :
   12 s avant la liste des prénoms. La page garde 4 s pour arriver, pas moins :
   sur un réseau lent (2 à 4 s par réponse), un délai plus court servait
   l'ancienne version à chaque ouverture, tant que le réseau restait lent.
   Une fois la page servie par le cache (réseau muet ou trop lent, serveur en
   panne), ses fichiers en sortent aussi pendant 20 s, sans nouvelle attente
   de 4 s par vague. L'application le demande au démarrage (message RESEAU)
   pour partir hors ligne d'emblée. */
const DELAI_NAVIGATION_MS = 4000;
const FENETRE_MUET_MS = 20000;
let muetJusqua = 0;

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
    /* Tout ce qui n'est pas la version courante est purgé, y compris le
       cache runtime et sa copie du CDN (voir RUNTIME). */
    await Promise.all(noms.map(n => (n !== CACHE) ? caches.delete(n) : null));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) {}
    }
    await self.clients.claim();
  })());
});

/* -----------------------------------------------------------------------------
   RÉCUPÉRATION
   Navigation      → réseau d'abord (4 s au plus), repli sur le cache
   Fichiers du app → réseau d'abord, repli sur le cache ; cache seul pendant
                     20 s après une page servie par le cache
   Modèle Tesseract → cache-first (mis en cache à la première réponse)
   Externes        → réseau d'abord, cache en secours (aucun aujourd'hui)
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
           Wi-Fi muet : un seul délai pour lui et le fetch, puis le cache. */
        const fin = Date.now() + DELAI_NAVIGATION_MS;
        const preload = await avecDelai(Promise.resolve(event.preloadResponse), fin - Date.now());
        const r = preload || await avecDelai(fetch(req), Math.max(0, fin - Date.now()));
        /* Une panne serveur (5xx) passe au secours du cache ; un 4xx (page
           absente, protection Vercel) est montré tel quel. Seule la page
           d'accueil peut remplacer la coquille hors ligne — pas un PDF ou une
           image ouverts dans l'application. */
        if (!r || r.status >= 500) throw new Error('navigation ' + (r && r.status));
        muetJusqua = 0;
        if (r.ok && (url.pathname === '/' || url.pathname === '/index.html')) {
          event.waitUntil(cache.put('/index.html', r.clone()).catch(() => {}));
        }
        return r;
      } catch (e) {
        const cachee = await cache.match('/index.html');
        if (cachee) muetJusqua = Date.now() + FENETRE_MUET_MS;
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
      /* Une page vient d'être servie par le cache (voir DELAI_NAVIGATION_MS) :
         pas de nouvelle attente. */
      if (Date.now() < muetJusqua) {
        return (await cache.match(req)) || new Response('', { status: 504, statusText: 'Hors ligne' });
      }
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

  /* --- Ressources externes : réseau d'abord, cache en secours ---
     Plus de « cache d'abord » : une réponse gardée sans revalidation (même
     altérée) était resservie indéfiniment. */
  if (EXTERNES.some(h => url.hostname.endsWith(h))) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      try {
        /* Délai maximum : sans lui, un CDN injoignable bloquait la requête
           (et l'écran) sans fin. */
        const r = await avecDelai(fetch(req), 4000);
        /* Jamais de réponse opaque : son statut est illisible, une erreur du
           CDN resterait en cache jusqu'à la prochaine version. */
        if (r && r.ok) event.waitUntil(cache.put(req, r.clone()).catch(() => {}));
        return r;
      } catch (e) {
        return (await cache.match(req)) || new Response('', { status: 504, statusText: 'Hors ligne' });
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
  if (d.type === 'RESEAU' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ muet: Date.now() < muetJusqua });
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
