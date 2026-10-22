/* =============================================================================
   PILOT-SHOP — alertes.js
   Alertes sur le téléphone du manager (notifications Web Push).

   - Écran « Alertes sur ce téléphone » (manager) : abonne CE téléphone, choisit
     les types d'alerte, envoie un essai.
   - signalerManager(type, cle, titre, texte, vue) : appelée par les écrans de
     l'équipe (rupture, frigo critique, inventaire à confirmer…). L'envoi passe
     par la fonction Supabase « alertes », qui lit la boutique dans le jeton de
     l'appareil. Hors ligne, l'alerte attend dans une petite file locale
     (six heures au plus : passé ce délai, elle n'a plus d'intérêt).
   - Les frigos non relevés partent du serveur toutes les 10 minutes, même si
     personne n'a ouvert l'application (supabase-alertes.sql).

   Sur iPhone, les notifications ne marchent que si l'application est ajoutée
   à l'écran d'accueil (iOS 16.4 ou plus récent).

   Chargé après app.js et auth.js.
   ============================================================================= */

'use strict';

PAGES.alertes = { titre:'Alertes sur ce téléphone', sous:'Être prévenu sans ouvrir l’application' };
if (MENU_PLUS.manager.indexOf('alertes') < 0) {
  const i = MENU_PLUS.manager.indexOf('reglages');
  MENU_PLUS.manager.splice(i >= 0 ? i : MENU_PLUS.manager.length, 0, 'alertes');
}

const ALERTES = {
  clePublique: (window.__ENV__ && window.__ENV__.VAPID_PUBLIC_KEY) || '',
  table: 'abonnements_push',
  fonction: 'alertes',
  moi: OFFLINE.storeLocal + ':alertes-moi',      // abonnement de ce téléphone
  file: OFFLINE.storeLocal + ':alertes-file',    // alertes en attente de réseau
  fileMaxH: 6,
  types: [
    ['frigos',   'Frigos non relevés',   'Matin : 30 min après l’ouverture. Soir : 15 min après la fermeture.'],
    ['temp',     'Température critique', 'Dès qu’un relevé validé dépasse la limite.'],
    ['rupture',  'Rupture signalée',     'Quand l’équipe signale un produit manquant au réassort.'],
    ['valider',  'À confirmer',          'Inventaire ou réception qui attend un manager.'],
    ['incident', 'Incident',             'Livraison refusée, anomalie bloquante, écart de fond de caisse.']
  ]
};

const alLire = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const alEcrire = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

function alertesPossibles() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const installe = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    return { ok:false, motif: ios && !installe
      ? 'Sur iPhone, ajoutez d’abord Pilot-Shop à l’écran d’accueil (Partager, puis « Sur l’écran d’accueil »), et ouvrez-le depuis l’icône.'
      : 'Ce navigateur ne reçoit pas de notifications. Utilisez Safari (iPhone, application ajoutée à l’écran d’accueil) ou Chrome.' };
  }
  if (!ALERTES.clePublique) return { ok:false, motif:'Les alertes ne sont pas encore activées sur le serveur.' };
  if (!(SUPABASE.url && SUPABASE.anonKey)) return { ok:false, motif:'Base non configurée sur cet appareil.' };
  return { ok:true };
}

async function alIdentifiant(endpoint) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return 'push:' + Array.from(new Uint8Array(h)).slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}
function alCleServeur() {
  const b = ALERTES.clePublique.replace(/-/g, '+').replace(/_/g, '/');
  const s = atob(b + '==='.slice((b.length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}

/* Enregistre l'abonnement de ce téléphone dans la base (table de la boutique). */
async function alEnregistrer(sub, types) {
  const j = sub.toJSON();
  const id = await alIdentifiant(j.endpoint);
  await DB._appel(ALERTES.table, {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id:id, site:APP.site, data:{
      endpoint:j.endpoint, keys:j.keys, types:types,
      prenom:STATE.user.prenom, employe:STATE.user.id, at:nowISO() } })
  });
  alEcrire(ALERTES.moi, { id:id, types:types, prenom:STATE.user.prenom });
  return id;
}

async function alActiver(types) {
  const p = alertesPossibles();
  if (!p.ok) throw new Error(p.motif);
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications refusées. Autorisez-les dans les réglages du téléphone pour Pilot-Shop.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:alCleServeur() });
  return alEnregistrer(sub, types);
}

async function alDesactiver() {
  const moi = alLire(ALERTES.moi, null);
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch (e) {}
  if (moi && moi.id) {
    await DB._appel(ALERTES.table + '?id=eq.' + encodeURIComponent(moi.id), { method:'DELETE' });
  }
  alEcrire(ALERTES.moi, null);
}

/* -----------------------------------------------------------------------------
   ENVOI D'UNE ALERTE
   -------------------------------------------------------------------------- */
async function alPoster(a) {
  const jeton = (typeof jetonValide === 'function') ? await jetonValide() : null;
  if (!jeton) { const e = new Error('Appareil non rattaché'); e.http = 401; throw e; }
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), OFFLINE.timeoutReseauMs);
  try {
    const r = await fetch(SUPABASE.url + '/functions/v1/' + ALERTES.fonction, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'apikey':SUPABASE.anonKey, 'Authorization':'Bearer ' + jeton, 'Content-Type':'application/json' },
      body: JSON.stringify(a)
    });
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.http = r.status; throw e; }
    return r.json().catch(() => ({}));
  } finally { clearTimeout(to); }
}

/* Une erreur réseau ou serveur (5xx) garde l'alerte pour plus tard ; un refus
   (4xx) l'abandonne : la renvoyer ne changerait rien. */
const alAGarder = e => !e.http || e.http >= 500 || e.http === 401;

function signalerManager(type, cle, titre, texte, vue) {
  if (!(SUPABASE.url && SUPABASE.anonKey)) return;
  const a = { type:type, cle:String(cle), titre:titre, texte:texte || '', vue:vue || 'controle',
              auteur:STATE.user ? STATE.user.prenom : '', at:nowISO() };
  alPoster(a).catch(e => {
    if (!alAGarder(e)) return;
    const f = alLire(ALERTES.file, []);
    if (!f.some(x => x.type === a.type && x.cle === a.cle)) f.push(a);
    alEcrire(ALERTES.file, f.slice(-30));
  });
}

let _alVidage = false;
async function alViderFile() {
  if (_alVidage || !STATE.enLigne) return;
  const f = alLire(ALERTES.file, []);
  if (!f.length) return;
  _alVidage = true;
  const limite = Date.now() - ALERTES.fileMaxH * 3600000;
  const reste = [];
  try {
    for (const a of f) {
      if (new Date(a.at).getTime() < limite) continue;
      try { await alPoster(a); }
      catch (e) { if (alAGarder(e)) reste.push(a); }
    }
    /* Une alerte ajoutée pendant le vidage reste dans la file. */
    const ajoutees = alLire(ALERTES.file, []).filter(x => !f.some(y => y.type === x.type && y.cle === x.cle));
    alEcrire(ALERTES.file, reste.concat(ajoutees));
  } finally { _alVidage = false; }
}
window.addEventListener('online', () => setTimeout(alViderFile, 3000));
setInterval(alViderFile, 60000);

/* -----------------------------------------------------------------------------
   OUVRIR L'ÉCRAN D'UNE NOTIFICATION
   -------------------------------------------------------------------------- */
let _alVueDemandee = (function () {
  try {
    const v = new URLSearchParams(location.search).get('vue');
    if (v) history.replaceState(history.state, '', location.pathname);
    return /^[a-z]{2,20}$/.test(v || '') ? v : null;
  } catch (e) { return null; }
})();
/* Lue une fois, au démarrage de la session (app.js, demarrer). */
function vueDemandee() {
  const v = _alVueDemandee;
  _alVueDemandee = null;
  return (v && V[v] && vueAutorisee(v)) ? v : null;
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', e => {
    const d = e.data || {};
    if (d.type !== 'OUVRIR_VUE' || !STATE.user) return;
    if (V[d.vue] && vueAutorisee(d.vue) && $('#sheet').hidden) rendre(d.vue);
  });
}

/* -----------------------------------------------------------------------------
   ÉCRAN
   -------------------------------------------------------------------------- */
V.alertes = async function () {
  const p = alertesPossibles();
  const moi = alLire(ALERTES.moi, null);
  let actif = false;
  if (p.ok && moi) {
    try {
      const reg = await navigator.serviceWorker.ready;
      actif = !!(await reg.pushManager.getSubscription()) && Notification.permission === 'granted';
    } catch (e) {}
  }
  if (STATE.view !== 'alertes') return;
  const types = moi && Array.isArray(moi.types) ? moi.types : ALERTES.types.map(t => t[0]);

  $('#page').innerHTML =
    (!p.ok
      ? '<div class="alerte warn"><span class="ai">!</span><div><b>Alertes indisponibles ici</b><p>' + esc(p.motif) + '</p></div></div>'
      : carte(entete('🔔', actif ? 'Alertes actives sur ce téléphone' : 'Alertes désactivées sur ce téléphone',
          actif ? 'Pour ' + esc(moi.prenom || STATE.user.prenom) + '. Elles arrivent même application fermée.'
                : 'Activez-les sur le téléphone qui doit être prévenu.') +
        '<div class="actions" style="margin-top:12px">' +
          (actif
            ? '<button class="btn fantome" id="al-off">Désactiver</button><button class="btn clair" id="al-essai">Envoyer un essai</button>'
            : '<button class="btn menthe" id="al-on">Activer sur ce téléphone</button>') +
        '</div>', 'solide')) +
    '<div class="entete"><h3>Ce qui vous prévient</h3></div>' +
    '<div class="stack">' + ALERTES.types.map(t =>
      '<label class="card" style="display:flex;gap:12px;align-items:flex-start">' +
        '<input type="checkbox" data-type="' + t[0] + '"' + (types.indexOf(t[0]) >= 0 ? ' checked' : '') +
        (p.ok ? '' : ' disabled') + ' style="margin-top:4px;width:22px;height:22px">' +
        '<span><b>' + esc(t[1]) + '</b><span class="mini" style="display:block">' + esc(t[2]) + '</span></span>' +
      '</label>').join('') + '</div>' +
    '<p class="mini" style="margin-top:14px">Vous n’êtes pas prévenu de ce que vous faites vous-même. ' +
      'Une même alerte ne part qu’une fois.</p>';

  const choisis = () => $$('#page [data-type]').filter(c => c.checked).map(c => c.dataset.type);
  const on = $('#al-on'), off = $('#al-off'), essai = $('#al-essai');
  if (on) on.onclick = async () => {
    on.disabled = true;
    try { await alActiver(choisis()); toast('Alertes activées'); }
    catch (e) { toast(e.message || 'Activation impossible', 'erreur'); }
    rendre('alertes');
  };
  if (off) off.onclick = async () => {
    off.disabled = true;
    try { await alDesactiver(); toast('Alertes désactivées'); }
    catch (e) { toast('Désactivation impossible : réessayez avec du réseau', 'erreur'); }
    rendre('alertes');
  };
  if (essai) essai.onclick = async () => {
    essai.disabled = true;
    try {
      const r = await alPoster({ type:'essai', cle:uid(), titre:'Essai Pilot-Shop',
        texte:'Les alertes arrivent bien sur ce téléphone.', vue:'alertes',
        auteur:STATE.user.prenom, abonnement:moi.id });
      toast(r && r.envoyes ? 'Essai envoyé' : 'Essai parti, mais ce téléphone n’est plus inscrit : désactivez puis réactivez', r && r.envoyes ? '' : 'erreur');
    } catch (e) { toast('Envoi impossible (réseau ou serveur)', 'erreur'); }
    essai.disabled = false;
  };
  /* Changer un type sur un téléphone abonné : on réenregistre tout de suite. */
  $$('#page [data-type]').forEach(c => c.onchange = async () => {
    if (!actif) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await alEnregistrer(sub, choisis()); toast('Choix enregistré'); }
    } catch (e) { toast('Enregistrement impossible : réessayez avec du réseau', 'erreur'); c.checked = !c.checked; }
  });
};
