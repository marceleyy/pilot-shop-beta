/* =============================================================================
   Fonction « alertes » (Supabase Edge Function)
   Envoie les notifications au téléphone des managers abonnés (alertes.js).

   Deux façons d'être appelée :
   1. Par un appareil de la boutique, avec son jeton : une alerte précise
      (rupture, frigo critique, inventaire à confirmer…). La boutique est lue
      dans le jeton, jamais dans la requête.
   2. Toutes les 10 minutes par pg_cron (supabase-alertes.sql), avec l'en-tête
      x-cle-cron : frigos du matin ou du soir non relevés. Cette alerte doit
      partir même si personne n'a ouvert l'application.

   Chaque alerte a une clé (« frigos-m:2026-10-22 ») rangée dans
   alertes_envoyees : la même alerte ne part qu'une fois.

   Secrets à poser (supabase secrets set …) :
     VAPID_PUBLIQUE, VAPID_PRIVEE, VAPID_SUJET (mailto:… ou https://…),
     ALERTES_CRON_SECRET.
   Déploiement : supabase functions deploy alertes --no-verify-jwt
   (le jeton est vérifié ici, pour laisser passer l'appel de pg_cron).
   ============================================================================= */

import { envoyer } from './webpush.js';

const URL_BASE = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const CRON = Deno.env.get('ALERTES_CRON_SECRET') ?? '';
const VAPID = {
  publique: Deno.env.get('VAPID_PUBLIQUE') ?? '',
  privee: Deno.env.get('VAPID_PRIVEE') ?? '',
  sujet: Deno.env.get('VAPID_SUJET') ?? '',
};
const FUSEAU = 'Europe/Paris';
const HORAIRES_DEF = { ouverture: '09:30', fermeture: '23:00', joursOuverture: [1, 2, 3, 4, 5, 6, 7] };
/* Délais avant de prévenir, en minutes après l'ouverture et la fermeture. */
const RETARD = { matin: 30, soir: 15 };
/* Types qu'un appareil peut envoyer ; « frigos » vient seulement de pg_cron. */
const TYPES_APPAREIL = ['temp', 'rupture', 'valider', 'incident', 'essai'];
/* Garde-fou : au plus 30 alertes par boutique en 10 minutes. */
const PLAFOND = { n: 30, minutes: 10 };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reponse = (statut: number, corps: unknown) =>
  new Response(JSON.stringify(corps), { status: statut, headers: { ...CORS, 'Content-Type': 'application/json' } });

function rest(chemin: string, init: RequestInit = {}) {
  return fetch(URL_BASE + '/rest/v1/' + chemin, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: 'Bearer ' + SERVICE,
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> ?? {}),
    },
  });
}
const enc = encodeURIComponent;
/* Comparaison à temps constant du secret de pg_cron. */
function egal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const court = (s: unknown, n: number) => String(s ?? '').slice(0, n);

/* Réserve la clé de l'alerte. Faux si elle est déjà partie. */
async function reserver(site: string, cle: string): Promise<boolean> {
  const r = await rest('alertes_envoyees', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ site, id: cle }),
  });
  if (!r.ok) throw new Error('alertes_envoyees ' + r.status + ' ' + await r.text());
  const l = await r.json();
  return Array.isArray(l) && l.length > 0;
}

type Alerte = { type: string; titre: string; texte: string; vue?: string; auteur?: string; abonnement?: string };

async function diffuser(site: string, cle: string, a: Alerte) {
  const r = await rest('abonnements_push?site=eq.' + enc(site) + '&select=id,data');
  if (!r.ok) throw new Error('abonnements_push ' + r.status);
  const abos = (await r.json()) as { id: string; data: any }[];
  const cibles = abos.filter((x) => {
    const d = x.data || {};
    if (!d.endpoint || !d.keys) return false;
    /* L'essai ne vise que le téléphone de la personne qui le demande. */
    if (a.type === 'essai') return x.id === a.abonnement && d.prenom === a.auteur;
    if (Array.isArray(d.types) && d.types.indexOf(a.type) < 0) return false;
    /* On ne se prévient pas soi-même de ce qu'on vient de faire. */
    return !a.auteur || d.prenom !== a.auteur;
  });
  const message = JSON.stringify({ titre: a.titre, texte: a.texte, vue: a.vue || 'controle', tag: cle });
  let envoyes = 0, temporaires = 0;
  if (!cibles.length) return { envoyes: 0, cibles: 0, temporaires: 0 };
  for (const c of cibles) {
    try {
      const statut = await envoyer({ endpoint: c.data.endpoint, keys: c.data.keys }, message, VAPID);
      /* 404, 410 : abonnement expiré. 403 : il a été créé avec d'autres clés
         VAPID. Dans les deux cas il ne servira plus : on l'oublie. */
      if (statut === 404 || statut === 410 || statut === 403) {
        await rest('abonnements_push?site=eq.' + enc(site) + '&id=eq.' + enc(c.id), { method: 'DELETE' });
      } else if (statut < 300) envoyes++;
      else if (statut === 429 || statut >= 500) temporaires++;
      /* Autre refus (400, 413…) : le renvoyer ne changerait rien. */
    } catch (_) { temporaires++; /* réseau : un téléphone injoignable ne bloque pas les autres */ }
  }
  return { envoyes, cibles: cibles.length, temporaires };
}

/* Réserve, envoie, et rend la clé si aucun téléphone n'a pu être joint :
   sinon l'alerte serait marquée « partie » sans être arrivée nulle part. */
async function reserverEtDiffuser(site: string, cle: string, a: Alerte) {
  if (!(await reserver(site, cle))) return null;
  let r;
  try { r = await diffuser(site, cle, a); } catch (_) { r = { envoyes: 0, cibles: 1, temporaires: 1 }; }
  /* On ne rend la clé que pour une panne passagère : un refus définitif
     relancé chaque minute contournerait aussi le plafond d'alertes. */
  if (r.envoyes === 0 && r.temporaires > 0) {
    await rest('alertes_envoyees?site=eq.' + enc(site) + '&id=eq.' + enc(cle), { method: 'DELETE' });
    throw new Error('Aucun téléphone joignable');
  }
  return r.envoyes;
}

/* Heure de la boutique : date ISO, minutes depuis minuit, jour 1 (lundi) à 7. */
function maintenant() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const jours: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { jour: p.year + '-' + p.month + '-' + p.day, minutes: +p.hour * 60 + +p.minute, js: jours[p.weekday] };
}
const enMinutes = (h: unknown) => /^\d{2}:\d{2}$/.test(String(h)) ? +String(h).slice(0, 2) * 60 + +String(h).slice(3, 5) : null;

async function lireDonnee(table: string, site: string, id: string) {
  const r = await rest(table + '?site=eq.' + enc(site) + '&id=eq.' + enc(id) + '&select=data&limit=1');
  if (!r.ok) return null;
  const l = await r.json();
  return l && l.length ? l[0].data : null;
}

async function envoyerTout(site: string, aFaire: [string, Alerte][], bilan: Record<string, unknown>) {
  for (const [cle, a] of aFaire) {
    try {
      const n = await reserverEtDiffuser(site, cle, a);
      if (n !== null) bilan[site + ' ' + cle] = n;
    } catch (e) { bilan[site + ' ' + cle] = 'échec : ' + (e as Error).message; }
  }
}

async function tourneeFrigos() {
  const r = await rest('abonnements_push?select=site');
  if (!r.ok) throw new Error('abonnements_push ' + r.status);
  const sites = [...new Set(((await r.json()) as { site: string }[]).map((x) => x.site))];
  const t = maintenant();
  const bilan: Record<string, unknown> = {};
  for (const site of sites) {
    const h = { ...HORAIRES_DEF, ...((await lireDonnee('reglages', site, 'horaires')) || {}) };
    const ouverts = Array.isArray(h.joursOuverture) ? h.joursOuverture : HORAIRES_DEF.joursOuverture;
    const o = enMinutes(h.ouverture), f = enMinutes(h.fermeture);
    const aFaire: [string, Alerte][] = [];
    /* Fermeture tardive (23:45 et après, minuit, après minuit) : l'alerte du
       soir ne peut pas tomber le jour même. On regarde le relevé de la veille,
       le lendemain entre fermeture + 15 min et l'ouverture. */
    const tardive = f !== null && (f + RETARD.soir >= 1440 || (o !== null && f <= o));
    if (tardive && o !== null) {
      /* La veille calculée sur la date, pas en retirant 24 h (changement d'heure). */
      const dh = new Date(t.jour + 'T12:00:00Z'); dh.setUTCDate(dh.getUTCDate() - 1);
      const hier = { jour: dh.toISOString().slice(0, 10), js: dh.getUTCDay() || 7 };
      const limite = (f! + RETARD.soir) % 1440;
      if (ouverts.indexOf(hier.js) >= 0 && t.minutes >= limite && t.minutes < o) {
        const rh = (await lireDonnee('releves_temperature', site, 'temp:' + hier.jour)) || {};
        if (!(rh.valide || {}).s) {
          aFaire.push(['frigos-s:' + hier.jour, { type: 'frigos', titre: 'Frigos du soir non relevés',
            texte: 'Fermeture d’hier à ' + h.fermeture + ' et aucun relevé validé.', vue: 'temp' }]);
        }
      }
    }
    if (ouverts.indexOf(t.js) < 0) { await envoyerTout(site, aFaire, bilan); continue; }
    const releve = (await lireDonnee('releves_temperature', site, 'temp:' + t.jour)) || {};
    const v = releve.valide || {};
    if (o !== null && t.minutes >= o + RETARD.matin && !v.m) {
      aFaire.push(['frigos-m:' + t.jour, { type: 'frigos', titre: 'Frigos du matin non relevés',
        texte: 'Ouverture à ' + h.ouverture + ' et aucun relevé validé.', vue: 'temp' }]);
    }
    if (f !== null && !tardive && t.minutes >= f + RETARD.soir && !v.s) {
      aFaire.push(['frigos-s:' + t.jour, { type: 'frigos', titre: 'Frigos du soir non relevés',
        texte: 'Fermeture à ' + h.fermeture + ' et aucun relevé validé.', vue: 'temp' }]);
    }
    await envoyerTout(site, aFaire, bilan);
  }
  /* Les clés de plus de 30 jours ne servent plus à rien. */
  await rest('alertes_envoyees?created_at=lt.' + enc(new Date(Date.now() - 30 * 864e5).toISOString()),
    { method: 'DELETE' });
  return bilan;
}

async function siteDuJeton(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') || '';
  if (!/^Bearer .+/.test(auth)) return null;
  const r = await fetch(URL_BASE + '/auth/v1/user', { headers: { apikey: ANON || SERVICE, Authorization: auth } });
  if (!r.ok) return null;
  const u = await r.json();
  const site = u && u.app_metadata && u.app_metadata.site;
  return typeof site === 'string' && site ? site : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reponse(405, { erreur: 'POST attendu' });
  if (!VAPID.publique || !VAPID.privee || !VAPID.sujet) return reponse(500, { erreur: 'Clés VAPID absentes' });

  try {
    /* 1. Tournée planifiée */
    if (CRON && egal(req.headers.get('x-cle-cron') || '', CRON)) {
      return reponse(200, { ok: true, envoyes: await tourneeFrigos() });
    }

    /* 2. Alerte envoyée par un appareil */
    const site = await siteDuJeton(req);
    if (!site) return reponse(401, { erreur: 'Appareil non rattaché' });
    let b: any;
    try { b = await req.json(); } catch (_) { return reponse(400, { erreur: 'Corps illisible' }); }
    if (!b || TYPES_APPAREIL.indexOf(b.type) < 0) return reponse(400, { erreur: 'Type inconnu' });
    const cle = court(b.cle, 120);
    if (!cle) return reponse(400, { erreur: 'Clé manquante' });

    const depuis = new Date(Date.now() - PLAFOND.minutes * 60000).toISOString();
    const recents = await rest('alertes_envoyees?site=eq.' + enc(site) + '&created_at=gte.' + enc(depuis) +
      '&select=id&limit=' + (PLAFOND.n + 1));
    if (recents.ok && ((await recents.json()) as unknown[]).length > PLAFOND.n) {
      return reponse(429, { erreur: 'Trop d’alertes' });
    }

    const a: Alerte = {
      type: b.type, titre: court(b.titre, 80), texte: court(b.texte, 240),
      vue: /^[a-z]{2,20}$/.test(String(b.vue)) ? b.vue : 'controle',
      auteur: court(b.auteur, 40), abonnement: court(b.abonnement, 80),
    };
    if (!a.titre) return reponse(400, { erreur: 'Titre manquant' });
    /* L'essai est propre à un téléphone : sa clé en tient compte. */
    const cleComplete = b.type + ':' + cle;
    let n;
    try { n = await reserverEtDiffuser(site, cleComplete, a); }
    catch (_) { return reponse(502, { erreur: 'Aucun téléphone joignable' }); }
    if (n === null) return reponse(200, { ok: true, deja: true });
    return reponse(200, { ok: true, envoyes: n });
  } catch (e) {
    return reponse(500, { erreur: String((e as Error).message || e).slice(0, 200) });
  }
});
