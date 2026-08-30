/* =============================================================================
   PILOT-SHOP — app.js  ·  PARTIE 1 / 2
   Noyau, base de données, connexion tactile, navigation, espace équipier.
   Dépend de config.js. Aucune dépendance externe hors XLSX (export manager).
   ============================================================================= */

'use strict';

/* =============================================================================
   0. RACCOURCIS ET FORMATAGE
   ========================================================================== */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.prototype.slice.call(r.querySelectorAll(s));

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

const num = v => { const x = parseFloat(String(v).replace(',', '.')); return isFinite(x) ? x : 0; };
const n1  = v => (Number(v) || 0).toFixed(1);
const n2  = v => (Number(v) || 0).toFixed(2);
const eur = v => (Number(v) || 0).toLocaleString(APP.locale, { style:'currency', currency:APP.devise });

const MOIS  = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const isoOf = d => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
const today  = () => isoOf(new Date());
const nowISO = () => new Date().toISOString();
const addD   = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return isoOf(d); };
const fmtD   = s => { const a = String(s).split('-'); return a[2] + ' ' + MOIS[+a[1] - 1] + ' ' + a[0]; };
const fmtDC  = s => { const a = String(s).split('-'); return a[2] + '/' + a[1]; };
const fmtM   = s => { const a = String(s).split('-'); return MOIS[+a[1] - 1] + ' ' + a[0]; };
const heure  = t => new Date(t).toLocaleTimeString(APP.locale, { hour:'2-digit', minute:'2-digit' });
const monthKey = s => String(s).slice(0, 7);

/* Jour ISO : 1 = lundi … 7 = dimanche */
const jourISO = s => { const j = new Date(s + 'T12:00:00').getDay(); return j === 0 ? 7 : j; };
const nomJour = s => JOURS_SEMAINE[jourISO(s)];

const debounce = (f, ms) => { let t; return function () { const a = arguments; clearTimeout(t); t = setTimeout(() => f.apply(null, a), ms); }; };
const vibrer = p => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* =============================================================================
   1. ÉTAT GLOBAL
   ========================================================================== */
const STATE = {
  user: null,          // { id, prenom, role, couleur, initiales }
  view: '',
  jour: today(),
  phase: null,         // 'ouverture' | 'service' | 'fermeture'
  service: null,       // session de pointeuse en cours
  enLigne: navigator.onLine,
  erreurBase: null,
  fileAttente: 0,
  _pin: '',
  _candidat: null
};

/* =============================================================================
   2. BASE DE DONNÉES — Supabase REST + cache local + file d'attente
   Interface inchangée : get / set / push / patch / list / del, tout async.
   Aucune vue n'a été modifiée.

   En ligne  : lecture réseau, écriture réseau, miroir systématique en local.
   Hors ligne: lecture depuis le miroir, écriture empilée dans la file, rejouée
               dès le retour du réseau. La chambre froide ne bloque rien.
   ========================================================================== */

/* Chaque clé de l'application pointe vers une table. Le préfixe décide. */
const ROUTES = [
  ['temp:',        SUPABASE.tables.temperatures],
  ['clean:',       SUPABASE.tables.nettoyage],
  ['reassort:',    SUPABASE.tables.reassort],
  ['ruptures',     SUPABASE.tables.ruptures],
  ['pertes:',      SUPABASE.tables.pertes],
  ['lots:',        SUPABASE.tables.lots],
  ['invglace:',    SUPABASE.tables.inventaires],
  ['invsec:',      SUPABASE.tables.inventaires],
  ['caisse:',      SUPABASE.tables.caisse],
  ['ecart:',       SUPABASE.tables.ventes],
  ['periode:',     SUPABASE.tables.periodes],
  ['periodes',     SUPABASE.tables.periodes],
  ['pointage:',    SUPABASE.tables.sessions],
  ['releve',       SUPABASE.tables.releve],
  ['feed:',        SUPABASE.tables.feed],
  ['feedback',     SUPABASE.tables.feedback],
  /* Ajouts du lot « réunion d'équipe » : sans ces lignes, les clés
     n'avaient aucune table et l'URL contenait littéralement « undefined ». */
  ['checklist:',   'checklists'],
  ['preuves:',     'preuves'],
  ['stock:',       'stock'],
  ['reception:',   'receptions'],
  ['horaires',     'reglages'],
  ['enceintes',    'reglages'],
  ['hebdo',        'reglages'],
  ['async:',       'reglages']
];

/* Clés propres à l'appareil : elles ne partent jamais sur le réseau. */
const LOCALES = ['session', 'seuils', 'meteo', OFFLINE.fileAttente];

const DB = (function () {
  const P = OFFLINE.storeLocal + ':';
  let dispo = true;
  try { localStorage.setItem(P + '_t', '1'); localStorage.removeItem(P + '_t'); }
  catch (e) { dispo = false; }
  const mem = {};

  const lire   = k => dispo ? localStorage.getItem(P + k) : (mem[k] === undefined ? null : mem[k]);
  const ecrire = (k, v) => { dispo ? localStorage.setItem(P + k, v) : (mem[k] = v); };
  const oter   = k => { dispo ? localStorage.removeItem(P + k) : delete mem[k]; };
  const clesLocales = () => (dispo
    ? Object.keys(localStorage).filter(k => k.indexOf(P) === 0).map(k => k.slice(P.length))
    : Object.keys(mem));

  const table = cle => {
    const r = ROUTES.filter(x => cle.indexOf(x[0]) === 0)[0];
    return r ? r[1] : null;
  };
  const estLocale = cle => LOCALES.some(l => cle === l || cle.indexOf(l) === 0);
  const configuré = () => !!(SUPABASE.url && SUPABASE.anonKey);
  const distant = cle => configuré() && !estLocale(cle) && !!table(cle);

  async function appel(chemin, options) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), OFFLINE.timeoutReseauMs);
    try {
      const r = await fetch(SUPABASE.url + '/rest/v1/' + chemin, Object.assign({
        signal: ctrl.signal,
        headers: Object.assign({
          'apikey': SUPABASE.anonKey,
          'Authorization': 'Bearer ' + SUPABASE.anonKey,
          'Content-Type': 'application/json',
          'Accept-Profile': SUPABASE.schema,
          'Content-Profile': SUPABASE.schema
        }, (options && options.headers) || {})
      }, options || {}));
      clearTimeout(to);
      /* Le réseau a répondu : on est en ligne, même si le serveur refuse. */
      if (!STATE.enLigne) { STATE.enLigne = true; STATE.erreurBase = null; majBandeau(); }
      if (!r.ok) {
        const err = new Error('HTTP ' + r.status);
        err.http = r.status;
        /* 401/403 : clé ou RLS. 404 : table absente. Ce n'est pas une panne réseau,
           le signaler comme tel évite de basculer toute l'app en mode hors-ligne. */
        if (r.status === 401 || r.status === 403) STATE.erreurBase = 'Clé Supabase refusée';
        else if (r.status === 404) STATE.erreurBase = 'Table introuvable';
        else STATE.erreurBase = 'Base en erreur (' + r.status + ')';
        majBandeau();
        throw err;
      }
      /* Requête réussie : on efface l'erreur ET on rafraîchit l'affichage.
         Sans ce majBandeau(), le bandeau restait à l'écran indéfiniment. */
      if (STATE.erreurBase) { STATE.erreurBase = null; majBandeau(); }
      const txt = await r.text();
      return txt ? JSON.parse(txt) : null;
    } catch (e) {
      clearTimeout(to);
      /* Seule une vraie panne réseau bascule l'application hors ligne. */
      if (!e.http && STATE.enLigne) { STATE.enLigne = false; majBandeau(); }
      throw e;
    }
  }

  return {
    mode: 'supabase',
    get local() { return dispo ? 'local' : 'memoire'; },
    get configure() { return configuré(); },

    async get(cle, defaut) {
      if (defaut === undefined) defaut = null;
      const cache = () => { try { const v = lire(cle); return v === null ? defaut : JSON.parse(v); } catch (e) { return defaut; } };
      if (!distant(cle) || !STATE.enLigne) return cache();
      try {
        const l = await appel(table(cle) + '?id=eq.' + encodeURIComponent(cle) + '&select=data&limit=1');
        if (!l || !l.length) return cache();
        ecrire(cle, JSON.stringify(l[0].data));
        return l[0].data === null ? defaut : l[0].data;
      } catch (e) { return cache(); }
    },

    async set(cle, valeur) {
      try { ecrire(cle, JSON.stringify(valeur)); }
      catch (e) { toast('Mémoire pleine — libérez de l’espace sur l’iPad', 'erreur'); return false; }

      if (!distant(cle)) return true;
      if (!STATE.enLigne) { await empiler('set', cle, valeur); return true; }

      try {
        await appel(table(cle), {
          method: 'POST',
          headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ id:cle, site:APP.site, data:valeur })
        });
        return true;
      } catch (e) { await empiler('set', cle, valeur); return true; }
    },

    async push(cle, element) {
      const l = await this.get(cle, []);
      l.push(element);
      await this.set(cle, l);
      return l;
    },

    async patch(cle, modif) {
      const o = await this.get(cle, {});
      Object.assign(o, modif);
      await this.set(cle, o);
      return o;
    },

    async list(prefixe) {
      const locales = clesLocales().filter(k => k.indexOf(prefixe) === 0);
      if (!configuré() || !STATE.enLigne) return locales.sort();

      const tables = prefixe
        ? ROUTES.filter(r => r[0].indexOf(prefixe) === 0 || prefixe.indexOf(r[0]) === 0).map(r => r[1])
        : ROUTES.map(r => r[1]);
      const vues = {}, out = locales.slice();
      for (const t of tables.filter(t => { if (vues[t]) return false; vues[t] = 1; return true; })) {
        try {
          const l = await appel(t + '?id=like.' + encodeURIComponent(prefixe + '%') + '&select=id&limit=2000');
          (l || []).forEach(r => { if (out.indexOf(r.id) < 0) out.push(r.id); });
        } catch (e) { /* le cache local a déjà été pris */ }
      }
      return out.sort();
    },

    async del(cle) {
      try { oter(cle); } catch (e) {}
      if (!distant(cle)) return;
      if (!STATE.enLigne) return empiler('del', cle, null);
      try { await appel(table(cle) + '?id=eq.' + encodeURIComponent(cle), { method:'DELETE' }); }
      catch (e) { await empiler('del', cle, null); }
    },

    /* Exposés pour la file d'attente et l'écran de réglages */
    _appel: appel, _table: table, _distant: distant, _clesLocales: clesLocales,
    _lire: lire, _ecrire: ecrire, _oter: oter
  };
})();

/* -----------------------------------------------------------------------------
   FILE D'ATTENTE HORS-LIGNE
   Une écriture ratée n'est jamais perdue : elle est empilée avec son horodatage
   et rejouée dans l'ordre au retour du réseau. La dernière écriture d'une même
   clé écrase les précédentes, inutile de rejouer dix fois la même saisie.
   -------------------------------------------------------------------------- */
function fileLire() {
  try {
    const v = DB._lire(OFFLINE.fileAttente);
    const f = v ? JSON.parse(v) : [];
    /* On écarte à la lecture les entrées dont la clé n'a plus de table :
       elles dateraient d'une version antérieure et bloqueraient la file. */
    const propres = f.filter(x => x && x.cle && DB._table(x.cle));
    if (propres.length !== f.length) {
      try { DB._ecrire(OFFLINE.fileAttente, JSON.stringify(propres)); } catch (e) {}
    }
    return propres;
  } catch (e) { return []; }
}
function fileEcrire(f) {
  try { DB._ecrire(OFFLINE.fileAttente, JSON.stringify(f)); } catch (e) {}
  STATE.fileAttente = f.length;
  majBandeau();
}

async function empiler(op, cle, valeur) {
  const f = fileLire().filter(x => !(x.cle === cle && x.op === op));
  f.push({ op:op, cle:cle, valeur:valeur, at:nowISO(), essais:0 });
  fileEcrire(f);
}

let syncEnCours = false;
let derniereSync = null;
async function journaliserSync() {
  if (syncEnCours || !DB.configure) return;
  /* On se fie au navigateur, pas à notre propre drapeau : c'est ce qui permet
     à la file de se débloquer toute seule après une erreur passagère. */
  if (!navigator.onLine) return;
  let f = fileLire();
  if (!f.length) return;

  syncEnCours = true;
  const restants = [];
  for (const item of f) {
    /* Une clé sans table ne peut pas partir : on l'abandonne au lieu
       d'appeler /rest/v1/undefined en boucle. La donnée reste en local. */
    if (!DB._table(item.cle)) {
      console.warn('Clé non routée, abandonnée de la file :', item.cle);
      continue;
    }
    try {
      if (item.op === 'del') {
        await DB._appel(DB._table(item.cle) + '?id=eq.' + encodeURIComponent(item.cle), { method:'DELETE' });
      } else {
        await DB._appel(DB._table(item.cle), {
          method: 'POST',
          headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ id:item.cle, site:APP.site, data:item.valeur })
        });
      }
    } catch (e) {
      item.essais = (item.essais || 0) + 1;
      if (item.essais < OFFLINE.tentatives) restants.push(item);
      else console.warn('Écriture abandonnée après ' + item.essais + ' essais :', item.cle);
    }
  }
  fileEcrire(restants);
  syncEnCours = false;

  const partis = f.length - restants.length;
  if (partis > 0) {
    derniereSync = nowISO();
    if (STATE.user) toast(partis + ' saisie(s) synchronisée(s)');
  }
}

/* Le réseau revient, ou l'onglet reprend le focus : on vide la file. */
window.addEventListener('online', () => setTimeout(journaliserSync, 800));
document.addEventListener('visibilitychange', () => { if (!document.hidden) journaliserSync(); });
setInterval(journaliserSync, OFFLINE.intervalleSyncMs);

/* =============================================================================
   3. UI DE BASE
   ========================================================================== */
function toast(msg, type) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  vibrer(type === 'erreur' ? UI.vibration.erreur : UI.vibration.ok);
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('on'), UI.dureeToastMs);
}

function showSheet(html) {
  $('#sheet-corps').innerHTML = html;
  $('#sheet').hidden = false;
  document.body.style.overflow = 'hidden';
  $$('[data-fermer]').forEach(b => b.onclick = closeSheet);
  const p = $('#sheet-corps input, #sheet-corps textarea');
  if (p && p.dataset.autofocus !== undefined) setTimeout(() => p.focus(), 120);
}
function closeSheet() {
  $('#sheet').hidden = true;
  document.body.style.overflow = '';
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

/* Confirmation destructive — jamais de suppression sur simple appui */
function confirmer(titre, texte, libelle, onOui) {
  showSheet(
    '<h2 id="sheet-titre">' + esc(titre) + '</h2>' +
    '<p class="sub">' + esc(texte) + '</p>' +
    '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
    '<button class="btn corail" id="cf-oui">' + esc(libelle) + '</button></div>'
  );
  $('#cf-oui').onclick = () => { closeSheet(); onOui(); };
}

function majBandeau() {
  const b = $('#offline');
  if (!b) return;
  const msg = b.querySelector('.msg');

  /* Sans clés Supabase, tout est local par choix : pas de bandeau alarmiste. */
  const configure = (typeof DB !== 'undefined' && DB.configure);
  if (!configure) { b.classList.remove('on'); return; }

  if (STATE.erreurBase) {
    b.classList.add('on');
    if (msg) msg.textContent = STATE.erreurBase + ' — vos saisies restent sur l’iPad';
  } else if (!STATE.enLigne) {
    b.classList.add('on');
    if (msg) msg.textContent = PWA.bannerOffline;
  } else {
    b.classList.remove('on');
  }
  $('#offline-n').textContent = STATE.fileAttente ? '· ' + STATE.fileAttente + ' en attente' : '';
}

/* Sonde légère : rétablit l'état en ligne dès que la base répond de nouveau. */
let sondeEnCours = false;
async function sonderReseau() {
  if (sondeEnCours || !navigator.onLine || !DB.configure) return;
  if (STATE.enLigne && !STATE.erreurBase) return;
  sondeEnCours = true;
  try {
    await DB._appel(SUPABASE.tables.journal + '?select=id&limit=1');
    STATE.enLigne = true; STATE.erreurBase = null;
    majBandeau();
    journaliserSync();
  } catch (e) { /* toujours indisponible */ }
  sondeEnCours = false;
}

window.addEventListener('online',  () => { STATE.enLigne = true; STATE.erreurBase = null; majBandeau(); sonderReseau(); });
window.addEventListener('offline', () => { STATE.enLigne = false; majBandeau(); });
setInterval(sonderReseau, 15000);

/* Fragments réutilisables */
const carte = (contenu, cls) => '<div class="card ' + (cls || '') + '">' + contenu + '</div>';
const entete = (icone, titre, sous) =>
  '<div class="ch">' + (icone ? '<span class="ci">' + icone + '</span>' : '') +
  '<h2>' + esc(titre) + '</h2></div>' + (sous ? '<div class="cs">' + esc(sous) + '</div>' : '');
const vide = (icone, texte) => '<div class="vide"><span class="vi">' + icone + '</span>' + esc(texte) + '</div>';
const pastille = (cls, txt) => '<span class="pill ' + cls + '">' + esc(txt) + '</span>';
const avatar = (e, cls) =>
  '<span class="' + (cls || 'av') + '" style="background:' + e.couleur + '">' + esc(e.initiales) + '</span>';

/* =============================================================================
   4. CONNEXION TACTILE
   ========================================================================== */
function initLogin() {
  $('#login-site').textContent = APP.site + ' · ' + APP.version;

  $('#qui-liste').innerHTML = EQUIPE.map(e =>
    '<button type="button" data-qui="' + e.id + '">' +
      avatar(e) +
      '<span class="nm">' + esc(e.prenom) + '</span>' +
      '<span class="rl">' + ROLES[e.role].label + '</span>' +
    '</button>'
  ).join('');

  $$('#qui-liste [data-qui]').forEach(b => b.onclick = () => ouvrirPin(b.dataset.qui));
  $$('#pin-pave [data-k]').forEach(b => b.onclick = () => toucheP(b.dataset.k));
  $('#pin-retour').onclick = retourQui;

  document.addEventListener('keydown', e => {
    if ($('#login').hidden || $('#login-pin').hidden) return;
    if (/^[0-9]$/.test(e.key)) toucheP(e.key);
    else if (e.key === 'Backspace') toucheP('effacer');
    else if (e.key === 'Escape') retourQui();
  });
}

function ouvrirPin(id) {
  const e = EQUIPE.filter(x => x.id === id)[0];
  if (!e) return;
  STATE._candidat = e;
  STATE._pin = '';
  $('#pin-nom').textContent = e.prenom;
  $('#pin-av').textContent = e.initiales;
  $('#pin-av').style.background = e.couleur;
  $('#pin-aide').textContent = 'Composez votre code à 4 chiffres';
  $('#login-qui').hidden = true;
  $('#login-pin').hidden = false;
  majPoints();
}

function retourQui() {
  STATE._candidat = null;
  STATE._pin = '';
  $('#login-pin').hidden = true;
  $('#login-qui').hidden = false;
}

function majPoints(erreur) {
  const c = $('#pin-points');
  c.classList.toggle('err', !!erreur);
  $$('#pin-points i').forEach((p, i) => p.classList.toggle('on', i < STATE._pin.length));
}

function toucheP(k) {
  if (k === 'annuler') return retourQui();
  if (k === 'effacer') { STATE._pin = STATE._pin.slice(0, -1); return majPoints(); }
  if (STATE._pin.length >= 4) return;
  STATE._pin += k;
  vibrer(UI.vibration.ok);
  majPoints();
  if (STATE._pin.length === 4) setTimeout(verifierPin, 140);
}

async function verifierPin() {
  const e = STATE._candidat;
  if (!e) return retourQui();

  if (STATE._pin !== e.pin) {
    majPoints(true);
    vibrer(UI.vibration.erreur);
    $('#pin-aide').textContent = 'Code incorrect, réessayez';
    STATE._pin = '';
    setTimeout(() => majPoints(false), 420);
    return;
  }

  STATE.user = { id:e.id, prenom:e.prenom, role:e.role, couleur:e.couleur, initiales:e.initiales };
  STATE._pin = '';
  await DB.set('session', STATE.user);
  await chargerService();
  demarrer();
}

async function chargerService() {
  const l = await DB.get('pointage:' + today(), []);
  const ouverte = l.filter(s => s.employe === STATE.user.id && !s.fin)[0];
  STATE.service = ouverte || null;
}

async function pointer(entree) {
  const cle = 'pointage:' + today();
  const l = await DB.get(cle, []);
  if (entree) {
    const s = { id:uid(), employe:STATE.user.id, prenom:STATE.user.prenom, debut:nowISO(), fin:null };
    l.push(s);
    STATE.service = s;
    await DB.set(cle, l);
    await feed('ok', STATE.user.prenom + ' a pris son service');
    toast('Bon service, ' + STATE.user.prenom);
  } else {
    const s = l.filter(x => x.id === (STATE.service && STATE.service.id))[0];
    if (s) { s.fin = nowISO(); s.minutes = Math.round((new Date(s.fin) - new Date(s.debut)) / 60000); }
    STATE.service = null;
    await DB.set(cle, l);
    await feed('ok', STATE.user.prenom + ' a terminé son service');
    toast('Service terminé');
  }
  rendre(STATE.view);
}

function deconnexion() {
  confirmer('Se déconnecter ?', 'Votre pointage reste enregistré. L’appareil reviendra à l’écran des prénoms.',
    'Se déconnecter', async () => {
      await DB.del('session');
      location.reload();
    });
}

/* =============================================================================
   5. JOURNAL D'ACTIVITÉ
   ========================================================================== */
async function feed(niveau, texte) {
  try {
    const cle = 'feed:' + today();
    const l = await DB.get(cle, []);
    l.push({ n:niveau, x:texte, par:STATE.user ? STATE.user.prenom : '—',
             id:STATE.user ? STATE.user.id : null, at:nowISO() });
    await DB.set(cle, l.slice(-400));
  } catch (e) {}
}

/* =============================================================================
   6. NAVIGATION
   ========================================================================== */
const V = {};   // vues, remplies ici et en partie 2

function renderNav() {
  const onglets = TABS[STATE.user.role] || TABS.equipe;
  $('#tabbar').innerHTML = onglets.map(t =>
    '<button type="button" class="tab' + (STATE.view === t.id ? ' on' : '') + '" data-tab="' + t.id + '">' +
      '<span class="ic">' + t.icone + '</span>' + esc(t.label) +
      '<span class="badge" data-badge="' + t.id + '" hidden></span>' +
    '</button>'
  ).join('');
  $$('#tabbar [data-tab]').forEach(b => b.onclick = () => {
    b.dataset.tab === 'plus' ? ouvrirPlus() : rendre(b.dataset.tab);
  });
}

function badge(tab, n, pulse) {
  const b = $('[data-badge="' + tab + '"]');
  if (!b) return;
  b.hidden = !n;
  b.textContent = n > 99 ? '99+' : n;
  b.classList.toggle('pulse', !!pulse);
}

function ouvrirPlus() {
  const liste = MENU_PLUS[STATE.user.role] || MENU_PLUS.equipe;
  showSheet(
    '<h2 id="sheet-titre">Tout le reste</h2>' +
    '<p class="sub">' + esc(STATE.user.prenom) + ' · ' + ROLES[STATE.user.role].label + '</p>' +
    '<div class="stack">' + liste.map(id =>
      '<button type="button" class="tache" data-plus="' + id + '">' +
        '<span class="box" style="border:0;background:rgba(15,32,39,.05);color:var(--ardoise)">›</span>' +
        '<span class="tx"><span class="tn">' + esc(PAGES[id].titre) + '</span>' +
        '<span class="tm">' + esc(PAGES[id].sous) + '</span></span>' +
      '</button>').join('') + '</div>' +
    '<div class="actions"><button class="btn clair" data-fermer>Fermer</button>' +
    '<button class="btn fantome" id="mp-out">Déconnexion</button></div>'
  );
  $$('[data-plus]').forEach(b => b.onclick = () => { closeSheet(); rendre(b.dataset.plus); });
  $('#mp-out').onclick = () => { closeSheet(); deconnexion(); };
}

async function rendre(id) {
  if (!V[id]) { toast('Vue indisponible'); return; }
  /* On quitte les réglages : on arrête le rafraîchissement de l'indicateur */
  if (V.reglages && V.reglages._t) { clearInterval(V.reglages._t); V.reglages._t = null; }
  STATE.view = id;
  STATE.jour = today();
  const p = PAGES[id] || { titre:id, sous:'' };
  $('#vue-titre').textContent = p.titre;
  $('#vue-sous').textContent  = p.sous;
  $('#vue-actions').innerHTML = '';
  $('#page').innerHTML = '<div class="vide"><span class="vi">⏳</span>Un instant…</div>';
  renderNav();
  try { await V[id](); }
  catch (err) {
    $('#page').innerHTML = carte(
      entete('⚠️', 'Cette page ne s’est pas ouverte', String(err && err.message || err)) +
      '<button class="btn clair bloc" id="rt">Réessayer</button>');
    $('#rt').onclick = () => rendre(id);
  }
  $$('#page [data-go]').forEach(b => b.onclick = () => rendre(b.dataset.go));
  window.scrollTo(0, 0);
}

/* Phase courante d'après l'heure */
function phaseCourante() {
  const m = new Date().getHours() * 60 + new Date().getMinutes();
  const mn = h => +h.slice(0, 2) * 60 + +h.slice(3, 5);
  const p = PHASES.filter(x => m >= mn(x.de) && m < mn(x.a))[0];
  return (p || PHASES[PHASES.length - 1]).id;
}

/* =============================================================================
   7. NETTOYAGE — sélection des tâches du jour
   ========================================================================== */
function tachesDuJour(jour) {
  const j = jourISO(jour);
  const out = [];

  NETTOYAGE.zones.forEach(z => z.taches.forEach(t => {
    if (t.annuel || t.mensuel) return;              // gérées à part, hors quotidien
    if (t.jours && t.jours.indexOf(j) < 0) return;
    out.push({ id:t.id, nom:t.nom, zone:z.nom, zoneId:z.id, icone:z.icone,
               phase:t.phase, recurrence: t.jours ? 'hebdo' : 'quotidien' });
  }));

  NETTOYAGE.zones.forEach(z => z.taches.forEach(t => {
    if (!t.mensuel && !t.annuel) return;
    if (j !== 1) return;                            // planifiées le lundi
    out.push({ id:t.id, nom:t.nom, zone:z.nom, zoneId:z.id, icone:z.icone,
               phase:t.phase, recurrence: t.mensuel ? 'mensuel' : 'annuel' });
  }));

  return out;
}

async function asyncDuJour(jour) {
  const j = jourISO(jour), out = [];
  for (const a of NETTOYAGE.asynchrones) {
    let du = false, retard = 0;
    if (a.type === 'jours-fixes') {
      du = a.jours.indexOf(j) >= 0;
    } else {
      const dernier = await DB.get('async:' + a.id, null);
      if (!dernier) du = true;
      else {
        const ecart = Math.round((new Date(jour + 'T12:00:00') - new Date(dernier.jour + 'T12:00:00')) / 864e5);
        du = ecart >= a.intervalleJours;
        retard = Math.max(0, ecart - a.intervalleJours);
      }
    }
    if (du) out.push(Object.assign({}, a, { retard:retard }));
  }
  return out;
}

async function etatNettoyage(jour) {
  const rec = await DB.get('clean:' + jour, {});
  const liste = tachesDuJour(jour);
  const faits = liste.filter(t => rec[t.id] && rec[t.id].ok).length;
  return { rec:rec, liste:liste, faits:faits, total:liste.length };
}

/* =============================================================================
   8. ÉTAT D'UNE JOURNÉE
   ========================================================================== */
async function etatJour(jour) {
  const t   = await DB.get('temp:' + jour, {});
  const net = await etatNettoyage(jour);
  const k   = await DB.get('caisse:' + jour, null);
  const r   = await DB.get('reassort:' + jour, {});

  const complet = mom => ENCEINTES.every(e => {
    const v = t[mom + '_' + e.id];
    return v !== undefined && v !== '';
  });
  const crit = ENCEINTES.filter(e => ['m','s'].some(m => etatTemp(e, t[m + '_' + e.id]) === 'crit')).length;
  const rupt = Object.keys(r).filter(k2 => r[k2] && r[k2].rupture).length;

  return {
    jour:jour,
    tempM:complet('m'), tempS:complet('s'), tempCrit:crit,
    net:net.faits, netTotal:net.total,
    caisse:!!k, caisseEcart: k ? num(k.ecart) : 0,
    reassort:Object.keys(r).filter(k2 => r[k2] && r[k2].ok).length,
    reassortTotal:REASSORT.length, ruptures:rupt
  };
}

function etatTemp(e, v) {
  if (v === '' || v === null || v === undefined || isNaN(v)) return '';
  v = Number(v);
  if (v > e.crit) return 'crit';
  if (v >= e.vert[0] && v <= e.vert[1]) return 'vert';
  return 'rouge';
}

/* =============================================================================
   9. VUE — MA JOURNÉE
   ========================================================================== */
V.accueil = async function () {
  const j = STATE.jour;
  STATE.phase = STATE.phase || phaseCourante();
  const e = await etatJour(j);
  const asy = await asyncDuJour(j);
  const releve = await DB.get('releve', []);
  const msgs = releve.filter(m => !m.lu || m.epingle).slice(-4).reverse();

  $('#vue-actions').innerHTML = STATE.service
    ? '<button class="btn corail sm" id="ptg">Fin de service</button>'
    : '<button class="btn menthe sm" id="ptg">Début de service</button>';

  const rappels = [];
  if (!e.tempM) rappels.push(['bad', 'Frigos du matin non relevés', 'À faire dès l’ouverture, avant la mise en vitrine.', 'temp']);
  else if (!e.tempS && STATE.phase === 'fermeture') rappels.push(['warn', 'Frigos du soir à relever', 'Avant de fermer la caisse.', 'temp']);
  if (e.tempCrit) rappels.push(['bad', e.tempCrit + ' frigo(s) en limite critique', 'Transférez les produits et prévenez Eve.', 'temp']);
  asy.filter(a => a.retard > 0).forEach(a => rappels.push(['warn', a.nom + ' en retard de ' + a.retard + ' jour(s)', a.consigne, 'clean']));

  const bloc = ph => {
    const p = PHASES.filter(x => x.id === ph)[0];
    const t = tachesDuJour(j).filter(x => x.phase === ph);
    const rec = e;
    const items = [];

    if (ph === 'ouverture') {
      items.push(['Pointer mon arrivée', !!STATE.service, STATE.service ? 'Depuis ' + heure(STATE.service.debut) : 'Non pointé', null]);
      items.push(['Relever les frigos', rec.tempM, rec.tempM ? 'Fait ce matin' : ENCEINTES.length + ' enceintes', 'temp']);
      items.push(['Vérifier le réassort', rec.reassort >= rec.reassortTotal, rec.reassort + ' / ' + rec.reassortTotal + ' points', 'reas']);
    }
    if (ph === 'service') {
      items.push(['Nettoyage en cours de service', rec.net > 0, rec.net + ' / ' + rec.netTotal + ' tâches', 'clean']);
      items.push(['Déclarer une perte', false, 'Dès qu’un produit est jeté', 'pertes']);
      items.push(['Saisir un numéro de lot', false, 'À chaque bac mis en vitrine', 'lots']);
    }
    if (ph === 'fermeture') {
      items.push(['Relever les frigos du soir', rec.tempS, rec.tempS ? 'Fait ce soir' : ENCEINTES.length + ' enceintes', 'temp']);
      items.push(['Terminer le nettoyage', rec.net >= rec.netTotal, rec.net + ' / ' + rec.netTotal + ' tâches', 'clean']);
      items.push(['Fermer la caisse', rec.caisse, rec.caisse ? 'Écart ' + eur(rec.caisseEcart) : 'Ticket Z et TPE', 'caisse']);
      items.push(['Laisser un mot à l’équipe', false, 'Carnet de relève', 'releve']);
    }

    return carte(
      entete(p.icone, p.label, t.length + ' tâche(s) de nettoyage sur cette phase') +
      '<div class="stack">' + items.map(it =>
        '<button type="button" class="tache' + (it[1] ? ' on' : '') + '"' +
          (it[3] ? ' data-go="' + it[3] + '"' : ' data-ptg="1"') + '>' +
          '<span class="box">✓</span>' +
          '<span class="tx"><span class="tn">' + esc(it[0]) + '</span>' +
          '<span class="tm">' + esc(it[2]) + '</span></span>' +
        '</button>').join('') + '</div>',
      p.couleur);
  };

  $('#page').innerHTML =
    carte(
      '<div class="rang">' + avatar(STATE.user, 'av') +
      '<div><h2>Bonjour ' + esc(STATE.user.prenom) + '</h2>' +
      '<div class="mini">' + nomJour(j) + ' ' + fmtD(j) + ' · ' +
      (STATE.service ? 'en service depuis ' + heure(STATE.service.debut) : 'pas encore pointé') + '</div></div>' +
      '<span class="pousse">' + pastille(e.tempCrit ? 'bad' : 'ok',
        e.tempCrit ? e.tempCrit + ' alerte(s)' : 'Tout va bien') + '</span></div>', 'solide') +

    (rappels.length ? '<div class="stack" style="margin-top:12px">' + rappels.map(r =>
      '<div class="alerte ' + r[0] + '"><span class="ai">' + (r[0] === 'bad' ? '▲' : '●') + '</span>' +
      '<div><b>' + esc(r[1]) + '</b><p>' + esc(r[2]) + '</p></div>' +
      '<span class="go"><button class="btn clair sm" data-go="' + r[3] + '">Ouvrir</button></span></div>').join('') + '</div>' : '') +

    (msgs.length ? '<div class="entete"><h3>Carnet de relève</h3>' +
      '<button class="btn fantome sm pousse" data-go="releve">Tout voir</button></div>' +
      '<div class="stack">' + msgs.map(m => {
        const c = (RELEVE.categories.filter(x => x.id === m.cat)[0] || RELEVE.categories[3]);
        return carte('<div class="rang"><span class="ci">' + c.icone + '</span>' +
          '<div style="flex:1"><b>' + esc(m.texte) + '</b>' +
          '<div class="mini">' + esc(m.par) + ' · ' + fmtDC(m.jour) + ' ' + heure(m.at) + '</div></div>' +
          (m.epingle ? '<span class="pill ambre">📌</span>' : '') + '</div>', c.couleur);
      }).join('') + '</div>' : '') +

    '<div class="phase-nav" style="margin-top:18px">' + PHASES.map(p =>
      '<button type="button" data-ph="' + p.id + '" class="' + (STATE.phase === p.id ? 'on' : '') + '">' +
      '<span class="pi">' + p.icone + '</span>' + esc(p.label) + '</button>').join('') + '</div>' +

    bloc(STATE.phase);

  $('#ptg').onclick = () => pointer(!STATE.service);
  $$('[data-ptg]').forEach(b => b.onclick = () => pointer(!STATE.service));
  $$('[data-ph]').forEach(b => b.onclick = () => { STATE.phase = b.dataset.ph; rendre('accueil'); });
};

/* =============================================================================
   10. VUE — FRIGOS
   ========================================================================== */
V.temp = async function () {
  const j = STATE.jour;
  const rec = await DB.get('temp:' + j, {});

  $('#page').innerHTML =
    carte(entete('🌡️', 'Relevé du ' + fmtD(j),
      'Appuyez sur la température lue. Vert : conforme. Rouge : hors cible. Rouge plein : limite critique.') +
      ENCEINTES.map(e =>
        '<div class="temp"><div class="th"><b>' + esc(e.nom) + '</b>' +
        '<span class="mini">cible ' + e.cible + '</span>' +
        '<span class="pousse" data-st="' + e.id + '">' + pastilleTemp(e, rec) + '</span></div>' +
        RELEVES.moments.map(m =>
          '<div class="tl">' + m.label + '</div><div class="degres">' +
          boutonsDegres(e, m.id, rec[m.id + '_' + e.id]) + '</div>').join('') +
        '</div>').join(''), 'solide') +

    carte(entete('📝', 'Action corrective', 'Obligatoire dès qu’une enceinte dépasse sa limite critique.') +
      '<textarea id="obs" placeholder="Ex. vitrine gelato à −9 °C à 14 h : bacs transférés en chambre froide, technicien appelé.">' +
      esc(rec.obs || '') + '</textarea>' +
      '<p class="mini" id="sig" style="margin-top:10px">' +
      (rec.par ? 'Signé par ' + esc(rec.par) + ' · ' + heure(rec.at) : 'Non signé') + '</p>');

  const sauver = async () => {
    const o = { obs:$('#obs').value, par:STATE.user.prenom, id:STATE.user.id, at:nowISO() };
    ENCEINTES.forEach(e => RELEVES.moments.forEach(m => {
      const b = $('[data-t="' + m.id + '_' + e.id + '"].on');
      o[m.id + '_' + e.id] = b ? b.dataset.v : '';
    }));
    await DB.set('temp:' + j, o);
    $('#sig').textContent = 'Signé par ' + STATE.user.prenom + ' · ' + heure(nowISO());
  };

  $$('.deg').forEach(b => b.onclick = async () => {
    const cle = b.dataset.t, deja = b.classList.contains('on');
    $$('[data-t="' + cle + '"]').forEach(x => x.classList.remove('on'));
    if (!deja) b.classList.add('on');
    const e = ENCEINTES.filter(x => x.id === cle.slice(2))[0];
    const rc = {};
    ENCEINTES.forEach(en => RELEVES.moments.forEach(m => {
      const s = $('[data-t="' + m.id + '_' + en.id + '"].on');
      rc[m.id + '_' + en.id] = s ? s.dataset.v : '';
    }));
    $('[data-st="' + e.id + '"]').innerHTML = pastilleTemp(e, rc);
    vibrer(UI.vibration.ok);
    await sauver();
    if (!deja && etatTemp(e, b.dataset.v) === 'crit') {
      await feed('bad', e.nom + ' relevée à ' + b.dataset.v + ' °C — limite critique');
      alerteCritique(e, b.dataset.v);
    }
  });
  $('#obs').oninput = debounce(sauver, 500);
};

function boutonsDegres(e, mom, val) {
  let h = '';
  for (let v = e.lo; v <= e.hi; v += (e.pas || 1)) {
    h += '<button type="button" class="deg ' + etatTemp(e, v) + (String(val) === String(v) ? ' on' : '') +
         '" data-t="' + mom + '_' + e.id + '" data-v="' + v + '">' + v + '</button>';
  }
  return h;
}
function pastilleTemp(e, rec) {
  const s = RELEVES.moments.map(m => etatTemp(e, rec[m.id + '_' + e.id]));
  if (s.indexOf('crit') >= 0)  return pastille('bad', 'Critique');
  if (s.indexOf('rouge') >= 0) return pastille('warn', 'Hors cible');
  if (s.every(x => x === 'vert')) return pastille('ok', 'Conforme');
  return pastille('n', 'À relever');
}
function alerteCritique(e, v) {
  const f = FICHES.filter(x => x.id === 'f05')[0];
  showSheet(
    '<h2 id="sheet-titre">🚨 ' + esc(e.nom) + ' à ' + v + ' °C</h2>' +
    '<p class="sub">Limite critique dépassée. Voici la marche à suivre.</p>' +
    '<div class="stack">' + f.etapes.map((s, i) =>
      '<div class="tache"><span class="box" style="border:0;background:var(--corail-l);color:var(--corail-d)">' +
      (i + 1) + '</span><span class="tx"><span class="tn">' + esc(s) + '</span></span></div>').join('') + '</div>' +
    '<div class="actions"><button class="btn corail" data-fermer>J’ai compris</button></div>'
  );
}

/* =============================================================================
   11. VUE — NETTOYAGE (validation en un clic)
   ========================================================================== */
V.clean = async function () {
  const j = STATE.jour;
  const rec = await DB.get('clean:' + j, {});
  const liste = tachesDuJour(j);
  const asy = await asyncDuJour(j);
  const faits = liste.filter(t => rec[t.id] && rec[t.id].ok).length;
  const pct = liste.length ? Math.round(faits / liste.length * 100) : 0;

  const parZone = {};
  liste.forEach(t => { (parZone[t.zoneId] = parZone[t.zoneId] || { nom:t.zone, icone:t.icone, t:[] }).t.push(t); });

  const ligne = t => {
    const v = rec[t.id] || {};
    return '<button type="button" class="tache' + (v.ok ? ' on' : '') + '" data-c="' + t.id + '">' +
      '<span class="box">✓</span><span class="tx"><span class="tn">' + esc(t.nom) + '</span>' +
      '<span class="tm">' + (v.ok ? esc(v.par) + ' · ' + heure(v.at)
        : (t.recurrence === 'quotidien' ? 'Tous les jours' :
           t.recurrence === 'hebdo' ? 'Le ' + nomJour(j).toLowerCase() :
           t.recurrence === 'mensuel' ? 'Une fois par mois' : 'Une fois par an')) + '</span></span></button>';
  };

  $('#page').innerHTML =
    carte(entete('🧽', nomJour(j) + ' ' + fmtD(j), 'Un appui suffit : la tâche est signée à votre nom.') +
      '<div class="rang"><b class="num" style="font-size:26px">' + faits + '</b>' +
      '<span class="mini">sur ' + liste.length + ' tâches</span>' +
      '<span class="pousse">' + pastille(pct === 100 ? 'ok' : pct > 0 ? 'warn' : 'n', pct + ' %') + '</span></div>' +
      '<div class="jauge" style="margin-top:10px"><i class="' + (pct === 100 ? '' : pct ? 'warn' : 'bad') +
      '" style="width:' + pct + '%"></i></div>', 'solide') +

    (asy.length ? '<div class="entete"><h3>À faire aujourd’hui en plus</h3></div><div class="stack">' +
      asy.map(a => {
        const v = rec['async_' + a.id] || {};
        return carte('<button type="button" class="tache' + (v.ok ? ' on' : '') + '" data-c="async_' + a.id +
          '" style="width:100%;background:transparent;border:0;padding:0">' +
          '<span class="box">✓</span><span class="tx"><span class="tn">' + a.icone + ' ' + esc(a.nom) + '</span>' +
          '<span class="tm">' + (v.ok ? esc(v.par) + ' · ' + heure(v.at)
            : a.type === 'jours-fixes' ? 'Chaque ' + a.jours.map(x => JOURS_SEMAINE[x].toLowerCase()).join(', ')
            : 'Tous les ' + a.intervalleJours + ' jours') +
          (a.retard ? ' · en retard de ' + a.retard + ' j' : '') + '</span></span></button>' +
          '<p class="mini" style="margin-top:8px">' + esc(a.consigne) + '</p>',
          a.retard ? 'corail' : 'ambre');
      }).join('') + '</div>' : '') +

    Object.keys(parZone).map(z => {
      const g = parZone[z];
      return '<div class="entete"><h3>' + g.icone + ' ' + esc(g.nom) + '</h3></div>' +
             carte('<div class="stack">' + g.t.map(ligne).join('') + '</div>');
    }).join('');

  $$('[data-c]').forEach(b => b.onclick = async () => {
    const cle = b.dataset.c, actif = !b.classList.contains('on');
    b.classList.toggle('on', actif);
    rec[cle] = actif ? { ok:1, par:STATE.user.prenom, id:STATE.user.id, at:nowISO() } : { ok:0 };
    const tm = $('.tm', b);
    if (tm) tm.textContent = actif ? STATE.user.prenom + ' · ' + heure(nowISO()) : 'À faire';
    vibrer(UI.vibration.ok);
    await DB.set('clean:' + j, rec);

    if (cle.indexOf('async_') === 0) {
      const a = NETTOYAGE.asynchrones.filter(x => 'async_' + x.id === cle)[0];
      if (actif && a) { await DB.set('async:' + a.id, { jour:j, par:STATE.user.prenom, at:nowISO() }); }
    }
    if (actif) {
      const nom = ($('.tn', b) ? $('.tn', b).textContent : cle);
      await feed('ok', STATE.user.prenom + ' a nettoyé ' + nom.replace(/^[^\w]+/, '').toLowerCase());
    }
  });
};

/* =============================================================================
   12. VUE — PERTES (dictée vocale)
   ========================================================================== */
const SPEECH = window.SpeechRecognition || window.webkitSpeechRecognition || null;

V.pertes = async function () {
  const j = STATE.jour;
  const liste = await DB.get('pertes:' + j, []);

  $('#page').innerHTML =
    carte(entete('🎙️', 'Dicter la perte', SPEECH
        ? 'Appuyez, parlez normalement : « J’ai jeté 2 bacs de vanille ».'
        : 'La dictée n’est pas disponible sur ce navigateur. Utilisez la saisie ci-dessous.') +
      '<button class="btn corail bloc xl mic" id="mic"' + (SPEECH ? '' : ' disabled') + '>' +
      '<span class="ic">🎙️</span>Dicter la perte</button>' +
      '<p class="mini" id="mtx" style="margin-top:12px">' +
      (SPEECH ? esc(VOIX.exemples.join(' · ')) : 'Dictée indisponible') + '</p>', 'corail') +

    carte(entete('✍️', 'Saisie manuelle', 'Ou remplissez directement.') +
      '<div class="champ"><label class="f">Produit</label>' +
      '<input type="text" id="pp" placeholder="Ex. Bac pistache 5 L"></div>' +
      '<div class="grid g2" style="margin-top:14px">' +
      '<div class="champ"><label class="f">Nombre</label><input type="number" id="pn" min="0" step="1" value="1"></div>' +
      '<div class="champ"><label class="f">Litrage (L)</label><input type="number" id="pl" min="0" step="0.5" placeholder="0"></div></div>' +
      '<div style="margin-top:14px"><label class="f">Motif</label><div class="chips" id="pm">' +
      MOTIFS_PERTE.map((m, i) => '<button type="button" class="chip corail' + (i === 0 ? ' on' : '') +
        '" data-m="' + m.id + '">' + m.icone + ' ' + esc(m.label) + '</button>').join('') + '</div></div>' +
      '<button class="btn menthe bloc" id="pa" style="margin-top:18px">Enregistrer la perte</button>') +

    '<div class="entete"><h3>Jetés aujourd’hui</h3>' +
    '<span class="pousse mini num">' + n1(liste.reduce((s, w) => s + num(w.litrage), 0)) + ' L</span></div>' +

    (liste.length ? '<div class="stack">' + liste.map((w, i) => {
      const m = MOTIFS_PERTE.filter(x => x.id === w.motif)[0] || MOTIFS_PERTE[0];
      return carte('<div class="rang"><span class="ci">' + m.icone + '</span>' +
        '<div style="flex:1"><b>' + esc(w.produit) + '</b>' +
        '<div class="mini">' + w.nombre + ' × · ' + (w.litrage ? n1(w.litrage) + ' L · ' : '') +
        esc(w.par) + ' · ' + heure(w.at) + '</div></div>' +
        pastille('bad', m.label) +
        '<button class="btn fantome sm" data-del="' + i + '">Retirer</button></div>');
    }).join('') + '</div>' : vide('🗑️', 'Aucune perte déclarée aujourd’hui.'));

  let motif = MOTIFS_PERTE[0].id;
  $$('#pm [data-m]').forEach(b => b.onclick = () => {
    $$('#pm .chip').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); motif = b.dataset.m;
  });

  const mb = $('#mic');
  mb.onclick = () => {
    if (!SPEECH) return toast('Dictée indisponible sur cet appareil', 'erreur');
    const r = new SPEECH();
    r.lang = VOIX.langue;
    r.interimResults = VOIX.resultatsIntermediaires;
    r.maxAlternatives = 1;
    mb.classList.add('rec');
    mb.innerHTML = '<span class="ic">●</span>J’écoute…';
    const stop = setTimeout(() => { try { r.stop(); } catch (e) {} }, VOIX.dureeMaxMs);
    r.onresult = ev => {
      clearTimeout(stop);
      const txt = ev.results[0][0].transcript;
      const d = analyserDictee(txt);
      $('#pp').value = d.produit;
      if (d.nombre)  $('#pn').value = d.nombre;
      if (d.litrage) $('#pl').value = d.litrage;
      if (d.motif) {
        motif = d.motif;
        $$('#pm .chip').forEach(x => x.classList.toggle('on', x.dataset.m === d.motif));
      }
      $('#mtx').innerHTML = 'Entendu : « ' + esc(txt) + ' » — vérifiez avant d’enregistrer.';
      vibrer(UI.vibration.ok);
    };
    r.onerror = ev => {
      clearTimeout(stop);
      toast(ev.error === 'not-allowed' ? 'Micro refusé par le navigateur' : 'Dictée interrompue', 'erreur');
    };
    r.onend = () => { mb.classList.remove('rec'); mb.innerHTML = '<span class="ic">🎙️</span>Dicter la perte'; };
    try { r.start(); } catch (e) { r.onend(); }
  };

  $('#pa').onclick = async () => {
    const p = $('#pp').value.trim();
    if (!p) { toast('Indiquez le produit', 'erreur'); return $('#pp').focus(); }
    liste.push({ id:uid(), produit:p, nombre:num($('#pn').value) || 1, litrage:num($('#pl').value),
                 motif:motif, par:STATE.user.prenom, employe:STATE.user.id, at:nowISO() });
    await DB.set('pertes:' + j, liste);
    await cumulerPertesMois(j);
    await feed('warn', STATE.user.prenom + ' a jeté ' + p);
    toast('Perte enregistrée');
    rendre('pertes');
  };

  $$('[data-del]').forEach(b => b.onclick = () => {
    confirmer('Retirer cette ligne ?', 'La perte sera supprimée du registre du jour.', 'Retirer', async () => {
      liste.splice(+b.dataset.del, 1);
      await DB.set('pertes:' + j, liste);
      await cumulerPertesMois(j);
      rendre('pertes');
    });
  });
};

/* Reporte le litrage détruit du mois dans la période d'écart en cours */
async function cumulerPertesMois(jour) {
  const m = monthKey(jour);
  let total = 0;
  const cles = await DB.list('pertes:');
  for (const c of cles) {
    if (monthKey(c.replace('pertes:', '')) !== m) continue;
    (await DB.get(c, [])).forEach(w => total += num(w.litrage));
  }
  await DB.patch('ecart:' + m, { jeteL:total, jeteKg:+(total * FOURNISSEUR.poidsMoyenLitre).toFixed(2) });
}

function analyserDictee(txt) {
  const t = ' ' + String(txt).toLowerCase().replace(/,/g, '.') + ' ';
  const mots = t.split(/\s+/).filter(Boolean);
  const res = { produit:'', nombre:'', litrage:'', motif:'' };
  const chiffre = m => (VOIX.chiffres[m] !== undefined ? VOIX.chiffres[m] : (isNaN(+m) ? null : +m));

  const mm = MOTIFS_PERTE.filter(x => x.mots.some(w => t.indexOf(w) >= 0))[0];
  if (mm) res.motif = mm.id;

  const lit = t.match(/([\d.]+|[a-zéèêà]+)\s*(?:litres?|\bl\b)/);
  if (lit) { const v = chiffre(lit[1]); if (v !== null) res.litrage = v; }

  for (let i = 0; i < mots.length; i++) {
    const v = chiffre(mots[i]);
    if (v === null) continue;
    const suite = (mots[i + 1] || '') + ' ' + (mots[i + 2] || '');
    if (/litres?|\bl\b/.test(suite)) continue;
    res.nombre = v;
    break;
  }

  const unite = VOIX.unites.filter(u => u.re.test(t))[0];
  const parfum = PARFUMS.filter(p => t.indexOf(p.toLowerCase().split(' ')[0]) >= 0)[0];
  if (parfum) res.produit = (unite ? unite.id.charAt(0).toUpperCase() + unite.id.slice(1) + ' ' : '') + parfum;
  else {
    const m2 = t.match(/(?:de|du|d’|d')\s+([a-zàâçéèêëîïôûùüÿñæœ\- ]{3,32})/);
    res.produit = m2 ? m2[1].trim().replace(/\s+(p[eé]rim|cass|erreur|formation).*$/, '') : String(txt).trim();
  }
  return res;
}

/* =============================================================================
   13. VUE — NUMÉROS DE LOT (scanner simulé)
   ========================================================================== */
V.lots = async function () {
  const m = monthKey(STATE.jour);
  const rec = await DB.get('lots:' + m, {});
  const src = PARFUMS.map(p => ({ cle:'g_' + p, nom:p, type:'g' }))
    .concat(Object.keys(DLC_RULES).filter(k => k !== 'defaut' && k !== 'gelato')
      .map(k => ({ cle:'c_' + k, nom:DLC_RULES[k].label, type:'c' })));

  const ouverts = src.filter(s => rec[s.cle] && rec[s.cle].lot).length;

  $('#page').innerHTML =
    carte(entete('📸', 'Scanner l’étiquette', 'Photographiez l’étiquette plutôt que de recopier le numéro.') +
      '<span class="demo">MODE DÉMONSTRATION</span>' +
      '<button class="btn ciel bloc xl" id="scan" style="margin-top:14px">' +
      '<span class="ic">📸</span>Scanner une étiquette</button>' +
      '<p class="mini" style="margin-top:12px">Le lot se note à l’ouverture du produit, au moment de la mise en vitrine.</p>', 'ciel') +

    '<div class="entete"><h3>Produits ouverts ce mois</h3><span class="pousse mini num">' + ouverts + '</span></div>' +

    '<div class="stack">' + src.map(s => {
      const v = rec[s.cle] || {};
      const regle = regleDLC(s.nom, s.type);
      return carte(
        '<div class="rang"><div style="flex:1;min-width:0"><b>' + esc(s.nom) + '</b>' +
        '<div class="mini">' + Math.round(DLC_RULES[regle].h / 24 * 10) / 10 + ' j après ouverture</div></div>' +
        (v.lot ? pastille('ok', 'Lot ' + esc(v.lot)) : pastille('n', 'Non ouvert')) + '</div>' +
        '<div class="grid g2" style="margin-top:12px">' +
        '<div class="champ"><label class="f">N° de lot</label>' +
        '<input type="text" inputmode="numeric" data-l="' + s.cle + '.lot" value="' + esc(v.lot || '') + '" placeholder="—"></div>' +
        '<div class="champ"><label class="f">Ouvert le</label>' +
        '<input type="date" data-l="' + s.cle + '.ouv" value="' + (v.ouv || '') + '"></div></div>' +
        '<div class="btn-row" style="margin-top:12px">' +
        '<button class="btn clair sm" data-scan="' + s.cle + '">📸 Scanner</button>' +
        '<button class="btn clair sm" data-now="' + s.cle + '">Ouvert aujourd’hui</button></div>',
        v.lot ? 'menthe' : '');
    }).join('') + '</div>';

  const sauver = debounce(async () => {
    $$('[data-l]').forEach(i => {
      const a = i.dataset.l.split('.');
      if (!rec[a[0]]) rec[a[0]] = {};
      rec[a[0]][a[1]] = i.value;
      if (a[1] === 'lot' && i.value && !rec[a[0]].ouv) {
        rec[a[0]].ouv = today();
        const d = $('[data-l="' + a[0] + '.ouv"]');
        if (d) d.value = today();
      }
      if (i.value) { rec[a[0]].par = STATE.user.prenom; rec[a[0]].at = nowISO(); }
    });
    await DB.set('lots:' + m, rec);
  }, 400);

  $$('[data-l]').forEach(i => i.oninput = sauver);

  $$('[data-now]').forEach(b => b.onclick = () => {
    $('[data-l="' + b.dataset.now + '.ouv"]').value = today();
    sauver(); toast('Date du jour appliquée');
  });

  $$('[data-scan]').forEach(b => b.onclick = () => lancerScan(b.dataset.scan));
  $('#scan').onclick = () => lancerScan(null);

  async function lancerScan(cle) {
    const r = await scannerPhoto('etiquette');
    if (!r) return;
    if (!cle) {
      showSheet('<h2 id="sheet-titre">À quel produit ce lot appartient-il ?</h2>' +
        '<p class="sub">Lot lu : <b>' + esc(r.lot) + '</b></p>' +
        '<div class="chips">' + src.map(s =>
          '<button type="button" class="chip" data-aff="' + s.cle + '">' + esc(s.nom) + '</button>').join('') + '</div>' +
        '<div class="actions"><button class="btn clair" data-fermer>Annuler</button></div>');
      $$('[data-aff]').forEach(x => x.onclick = () => { closeSheet(); appliquer(x.dataset.aff, r); });
      return;
    }
    appliquer(cle, r);
  }

  async function appliquer(cle, r) {
    $('[data-l="' + cle + '.lot"]').value = r.lot;
    $('[data-l="' + cle + '.ouv"]').value = r.ouv;
    sauver();
    await feed('ok', STATE.user.prenom + ' a ouvert un lot (' + r.lot + ')');
    toast('Lot repris — vérifiez sur l’étiquette');
  }
};

function regleDLC(nom, type) {
  if (type === 'g') return 'gelato';
  const m = DLC_MATCH.filter(x => x.re.test(nom))[0];
  return m ? m.regle : 'defaut';
}

/* Le scan réel est fourni par ocr.js, chargé après ce fichier. */

/* =============================================================================
   14. VUE — RÉASSORT
   ========================================================================== */
V.reas = async function () {
  const j = STATE.jour;
  const rec = await DB.get('reassort:' + j, {});
  const faits = REASSORT.filter(r => rec[r.id] && rec[r.id].ok).length;
  const rupt  = REASSORT.filter(r => rec[r.id] && rec[r.id].rupture);

  $('#page').innerHTML =
    carte(entete('📦', 'Réassort du ' + fmtD(j), REASSORT.length + ' points à vérifier. Signalez ce qui manque.') +
      '<div class="rang"><b class="num" style="font-size:26px">' + faits + '</b>' +
      '<span class="mini">sur ' + REASSORT.length + '</span>' +
      (rupt.length ? '<span class="pousse">' + pastille('bad', rupt.length + ' rupture(s)') + '</span>' : '') + '</div>' +
      '<div class="jauge" style="margin-top:10px"><i style="width:' +
      Math.round(faits / REASSORT.length * 100) + '%"></i></div>', 'solide') +

    REASSORT_CATS.map(c => {
      const items = REASSORT.filter(r => r.cat === c.id);
      const ok = items.filter(r => rec[r.id] && rec[r.id].ok).length;
      return '<div class="entete"><h3>' + c.icone + ' ' + esc(c.id) + '</h3>' +
        '<span class="pousse mini num">' + ok + '/' + items.length + '</span></div>' +
        '<div class="stack">' + items.map(r => {
          const v = rec[r.id] || {};
          return carte(
            '<div class="rang"><div style="flex:1;min-width:0"><b>' + esc(r.nom) + '</b>' +
            '<div class="mini">' + (v.ok ? 'Vérifié par ' + esc(v.par) + ' · ' + heure(v.at)
              : v.rupture ? 'Reste ' + v.reste + ' ' + r.unite + ' — signalé' : 'En ' + r.unite) + '</div></div></div>' +
            '<div class="duo" style="margin-top:12px">' +
            '<button type="button" class="btn ok' + (v.ok ? ' on' : '') + '" data-ok="' + r.id + '">✅ Fait</button>' +
            '<button type="button" class="btn ko' + (v.rupture ? ' on' : '') + '" data-ko="' + r.id + '">⚠️ Rupture</button>' +
            '</div>', v.rupture ? 'corail' : v.ok ? 'menthe' : c.couleur);
        }).join('') + '</div>';
    }).join('');

  $$('[data-ok]').forEach(b => b.onclick = async () => {
    const id = b.dataset.ok, actif = !b.classList.contains('on');
    rec[id] = { ok:actif ? 1 : 0, rupture:0, par:STATE.user.prenom, at:nowISO() };
    vibrer(UI.vibration.ok);
    await DB.set('reassort:' + j, rec);
    rendre('reas');
  });

  $$('[data-ko]').forEach(b => b.onclick = () => {
    const art = REASSORT.filter(r => r.id === b.dataset.ko)[0];
    if (rec[art.id] && rec[art.id].rupture) {
      rec[art.id] = { ok:0, rupture:0 };
      DB.set('reassort:' + j, rec).then(() => rendre('reas'));
      return;
    }
    demanderQuantite(art);
  });

  function demanderQuantite(art) {
    showSheet(
      '<h2 id="sheet-titre">⚠️ ' + esc(art.nom) + '</h2>' +
      '<p class="sub">Combien en reste-t-il ? Eve reçoit l’alerte immédiatement.</p>' +
      '<div class="chips" id="qt">' + RUPTURE.unitesRapides.map(q =>
        '<button type="button" class="chip corail" data-q="' + q + '">' +
        (q === 0 ? 'Plus rien' : q + ' ' + art.unite) + '</button>').join('') + '</div>' +
      '<div class="champ" style="margin-top:16px"><label class="f">Autre quantité</label>' +
      '<input type="number" id="qa" min="0" step="1" placeholder="Nombre de ' + esc(art.unite) + '"></div>' +
      '<div class="champ" style="margin-top:14px"><label class="f">Précision (facultatif)</label>' +
      '<input type="text" id="qn" placeholder="Ex. commande passée mardi"></div>' +
      '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
      '<button class="btn corail" id="qv">Signaler à Eve</button></div>');

    let reste = null;
    $$('#qt [data-q]').forEach(b => b.onclick = () => {
      $$('#qt .chip').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); reste = +b.dataset.q; $('#qa').value = '';
    });
    $('#qa').oninput = () => { $$('#qt .chip').forEach(x => x.classList.remove('on')); reste = num($('#qa').value); };

    $('#qv').onclick = async () => {
      if (reste === null) return toast('Indiquez ce qu’il reste', 'erreur');
      const niveau = RUPTURE.niveaux.filter(n => reste <= n.max)[0];
      rec[art.id] = { ok:0, rupture:1, reste:reste, niveau:niveau.id, note:$('#qn').value.trim(),
                      par:STATE.user.prenom, employe:STATE.user.id, at:nowISO() };
      await DB.set('reassort:' + j, rec);
      await DB.push('ruptures', { id:uid(), jour:j, article:art.nom, cat:art.cat, unite:art.unite,
                                  reste:reste, niveau:niveau.id, note:rec[art.id].note,
                                  par:STATE.user.prenom, at:nowISO(), traite:false });
      await feed('bad', STATE.user.prenom + ' signale une rupture : ' + art.nom +
                 (reste === 0 ? ' (plus rien)' : ' (reste ' + reste + ' ' + art.unite + ')'));
      closeSheet();
      toast('Eve est prévenue');
      rendre('reas');
    };
  }
};

/* =============================================================================
   15. VUE — CARNET DE RELÈVE
   ========================================================================== */
V.releve = async function () {
  const liste = await DB.get('releve', []);
  const visibles = liste.slice().reverse().slice(0, 40);

  $('#page').innerHTML =
    carte(entete('💬', 'Laisser un mot', 'Ce que la prochaine équipe doit savoir en arrivant.') +
      '<div class="chips" id="rc">' + RELEVE.categories.map((c, i) =>
        '<button type="button" class="chip' + (i === 3 ? ' on' : '') + '" data-rc="' + c.id + '">' +
        c.icone + ' ' + esc(c.label) + '</button>').join('') + '</div>' +
      '<div class="champ" style="margin-top:14px">' +
      '<textarea id="rt" placeholder="' + esc(RELEVE.exemples[0]) + '"></textarea></div>' +
      '<div class="btn-row" style="margin-top:14px">' +
      '<button class="btn menthe" id="rv">Publier</button>' +
      '<button class="btn clair" id="rp">📌 Épingler</button></div>', 'solide') +

    '<div class="entete"><h3>Derniers messages</h3></div>' +
    (visibles.length ? '<div class="stack">' + visibles.map(m => {
      const c = RELEVE.categories.filter(x => x.id === m.cat)[0] || RELEVE.categories[3];
      return carte('<div class="rang"><span class="ci">' + c.icone + '</span>' +
        '<div style="flex:1;min-width:0"><b>' + esc(m.texte) + '</b>' +
        '<div class="mini">' + esc(m.par) + ' · ' + fmtDC(m.jour) + ' ' + heure(m.at) +
        (m.luPar && m.luPar.length ? ' · lu par ' + esc(m.luPar.join(', ')) : '') + '</div></div>' +
        (m.epingle ? '<span class="pill ambre">📌</span>' : '') +
        (m.luPar && m.luPar.indexOf(STATE.user.prenom) >= 0 ? ''
          : '<button class="btn clair sm" data-lu="' + m.id + '">J’ai lu</button>') + '</div>',
        m.epingle ? 'ambre' : c.couleur);
    }).join('') + '</div>' : vide('💬', 'Aucun message pour l’instant.'));

  let cat = 'info', epingle = false;
  $$('#rc [data-rc]').forEach(b => b.onclick = () => {
    $$('#rc .chip').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); cat = b.dataset.rc;
  });
  $('#rp').onclick = () => { epingle = !epingle; $('#rp').classList.toggle('ambre', epingle); toast(epingle ? 'Message épinglé' : 'Épingle retirée'); };

  $('#rv').onclick = async () => {
    const txt = $('#rt').value.trim();
    if (!txt) return toast('Écrivez votre message', 'erreur');
    await DB.push('releve', { id:uid(), texte:txt, cat:cat, epingle:epingle, jour:today(),
                              par:STATE.user.prenom, employe:STATE.user.id, at:nowISO(), luPar:[] });
    await feed('ok', STATE.user.prenom + ' a laissé un mot dans le carnet de relève');
    toast('Message publié');
    rendre('releve');
  };

  $$('[data-lu]').forEach(b => b.onclick = async () => {
    const m = liste.filter(x => x.id === b.dataset.lu)[0];
    if (!m) return;
    m.luPar = m.luPar || [];
    if (m.luPar.indexOf(STATE.user.prenom) < 0) m.luPar.push(STATE.user.prenom);
    m.lu = true;
    await DB.set('releve', liste);
    rendre('releve');
  });
};

/* =============================================================================
   16. VUE — BIBLIOTHÈQUE
   ========================================================================== */
V.fiches = async function () {
  const cats = FICHES.map(f => f.cat).filter((c, i, a) => a.indexOf(c) === i);

  $('#page').innerHTML = cats.map(c =>
    '<div class="entete"><h3>' + esc(c) + '</h3></div><div class="stack">' +
    FICHES.filter(f => f.cat === c).map(f =>
      carte('<div class="rang"><span class="ci">' + f.icone + '</span>' +
        '<div style="flex:1;min-width:0"><b>' + esc(f.titre) + '</b>' +
        '<div class="mini">' + esc(f.resume) + '</div></div>' +
        pastille('n', f.duree) + '</div>', 'tap').replace('<div class="card', '<div data-f="' + f.id + '" class="card')
    ).join('') + '</div>').join('');

  $$('[data-f]').forEach(b => b.onclick = () => {
    const f = FICHES.filter(x => x.id === b.dataset.f)[0];
    showSheet(
      '<h2 id="sheet-titre">' + f.icone + ' ' + esc(f.titre) + '</h2>' +
      '<p class="sub">' + esc(f.resume) + '</p>' +
      '<div class="stack">' + f.etapes.map((s, i) =>
        '<div class="tache"><span class="box" style="border:0;background:var(--ciel-l);color:var(--ciel-d)">' +
        (i + 1) + '</span><span class="tx"><span class="tn">' + esc(s) + '</span></span></div>').join('') + '</div>' +
      '<div class="alerte warn" style="margin-top:16px"><span class="ai">⚠️</span>' +
      '<div><b>Sécurité</b><p>' + esc(f.securite) + '</p></div></div>' +
      '<div class="alerte info" style="margin-top:10px"><span class="ai">⏱️</span>' +
      '<div><b>Validité</b><p>' + esc(f.validite) + '</p></div></div>' +
      '<div class="actions"><button class="btn clair" data-fermer>Fermer</button></div>');
  });
};

/* =============================================================================
   17. VUE — POINTEUSE
   ========================================================================== */
V.pointage = async function () {
  const cles = (await DB.list('pointage:')).reverse().slice(0, 14);
  const jours = [];
  for (const c of cles) jours.push({ jour:c.replace('pointage:', ''), l:await DB.get(c, []) });

  const mien = jours.map(d => ({ jour:d.jour, s:d.l.filter(x => x.employe === STATE.user.id) }))
                    .filter(d => d.s.length);
  const totalMin = mien.reduce((s, d) => s + d.s.reduce((a, x) => a + (x.minutes || 0), 0), 0);

  $('#page').innerHTML =
    carte(entete('⏱️', STATE.service ? 'En service' : 'Hors service',
      STATE.service ? 'Depuis ' + heure(STATE.service.debut) : 'Pointez en arrivant.') +
      '<button class="btn ' + (STATE.service ? 'corail' : 'menthe') + ' bloc xl" id="pt">' +
      (STATE.service ? 'Terminer mon service' : 'Prendre mon service') + '</button>', 'solide') +

    carte(entete('📅', 'Mes heures', 'Sur les 14 derniers jours enregistrés.') +
      '<div class="rang"><b class="num" style="font-size:26px">' +
      Math.floor(totalMin / 60) + ' h ' + String(totalMin % 60).padStart(2, '0') + '</b>' +
      '<span class="mini">cumulées</span></div>') +

    (mien.length ? '<div class="stack">' + mien.map(d =>
      carte('<div class="rang"><div style="flex:1"><b>' + nomJour(d.jour) + ' ' + fmtDC(d.jour) + '</b>' +
        '<div class="mini">' + d.s.map(x => heure(x.debut) + ' → ' + (x.fin ? heure(x.fin) : 'en cours')).join(' · ') + '</div></div>' +
        '<span class="num"><b>' + (() => {
          const t = d.s.reduce((a, x) => a + (x.minutes || 0), 0);
          return Math.floor(t / 60) + ' h ' + String(t % 60).padStart(2, '0');
        })() + '</b></span></div>')).join('') + '</div>'
      : vide('⏱️', 'Aucun pointage enregistré.'));

  $('#pt').onclick = () => pointer(!STATE.service);
};

/* =============================================================================
   18. RETOUR BÊTA
   ========================================================================== */
function initFeedback() {
  if (!APP.beta) return;
  const b = $('#fb');
  b.hidden = false;
  b.onclick = () => {
    showSheet(
      '<h2 id="sheet-titre">Signaler un souci</h2>' +
      '<p class="sub">L’application est en bêta. La page et l’heure sont ajoutées automatiquement.</p>' +
      '<div class="chips" id="fbt">' +
      ['Ça ne marche pas', 'Un chiffre est faux', 'Une idée', 'Autre'].map((t, i) =>
        '<button type="button" class="chip' + (i === 0 ? ' on' : '') + '" data-t="' + esc(t) + '">' + esc(t) + '</button>').join('') +
      '</div><div class="champ" style="margin-top:14px">' +
      '<textarea id="fbx" data-autofocus placeholder="Ex. quand je valide le nettoyage, la ligne ne se coche pas."></textarea></div>' +
      '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
      '<button class="btn menthe" id="fbv">Envoyer</button></div>');

    let type = 'Ça ne marche pas';
    $$('#fbt [data-t]').forEach(x => x.onclick = () => {
      $$('#fbt .chip').forEach(y => y.classList.remove('on'));
      x.classList.add('on'); type = x.dataset.t;
    });
    $('#fbv').onclick = async () => {
      const t = $('#fbx').value.trim();
      if (!t) return toast('Décrivez le souci en une phrase', 'erreur');
      await DB.push('feedback', { id:uid(), type:type, texte:t, vue:STATE.view,
                                  par:STATE.user.prenom, at:nowISO(), version:APP.version });
      await feed('warn', STATE.user.prenom + ' a signalé un souci sur « ' + (PAGES[STATE.view] || {}).titre + ' »');
      closeSheet();
      toast('Merci, c’est transmis à Eve');
    };
  };
}

/* =============================================================================
   19. DÉMARRAGE
   ========================================================================== */
/* Service worker : sans cette inscription, la PWA ne s'installe pas et
   l'application ne s'ouvre pas hors ligne. Silencieux si non supporté
   ou si la page est servie depuis file://. */
function enregistrerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(PWA.serviceWorker, { scope:PWA.scope });
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('Nouvelle version prête — rouvrez l’application');
          }
        });
      });
      navigator.serviceWorker.addEventListener('message', e => {
        if (e.data && e.data.type === 'SYNC_NOW') majBandeau();
      });
    } catch (e) { /* pas de PWA, l'application fonctionne quand même */ }
  });
}

function demarrer() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  document.title = APP.nom + ' — ' + APP.site;
  STATE.phase = phaseCourante();
  majBandeau();
  initFeedback();
  renderNav();
  rendre(STATE.user.role === 'manager' ? 'controle' : 'accueil');
}

(async function () {
  initLogin();
  majBandeau();
  enregistrerSW();
  const s = await DB.get('session', null);
  if (s && s.id && EQUIPE.filter(e => e.id === s.id)[0]) {
    STATE.user = s;
    await chargerService();
    demarrer();
  }
})();
/* =============================================================================
   PILOT-SHOP — app.js  ·  PARTIE 2 / 2
   Espace manager : tour de contrôle, frigo virtuel, écarts, périodes,
   inventaires, caisse, historique, équipe, réglages.
   Se colle telle quelle à la suite de la partie 1.
   ============================================================================= */

/* =============================================================================
   20. PÉRIODES — fenêtre de calcul courante
   ========================================================================== */
async function periodeCourante() {
  let p = await DB.get('periode:courante', null);
  if (!p) {
    p = { id:uid(), type:PERIODES.parDefaut, debut:debutNaturel(PERIODES.parDefaut, today()),
          fin:finNaturelle(PERIODES.parDefaut, today()), ouverte:true, creee:nowISO() };
    await DB.set('periode:courante', p);
  }
  return p;
}
function debutNaturel(type, ref) {
  if (type === 'mois')      return ref.slice(0, 7) + '-01';
  if (type === 'trimestre') { const t = Math.floor((+ref.slice(5, 7) - 1) / 3) * 3 + 1; return ref.slice(0, 4) + '-' + String(t).padStart(2, '0') + '-01'; }
  if (type === 'semaine')   return addD(ref, -(jourISO(ref) - 1));
  if (type === 'quinzaine') return addD(ref, -13);
  return ref;
}
function finNaturelle(type, ref) {
  if (type === 'mois')      { const d = new Date(+ref.slice(0, 4), +ref.slice(5, 7), 0); return isoOf(d); }
  if (type === 'trimestre') { const t = Math.floor((+ref.slice(5, 7) - 1) / 3) * 3 + 3; const d = new Date(+ref.slice(0, 4), t, 0); return isoOf(d); }
  if (type === 'semaine')   return addD(debutNaturel('semaine', ref), 6);
  if (type === 'quinzaine') return addD(ref, 0);
  return ref;
}
const joursEntre = (a, b) => { const o = []; let d = a; let g = 0; while (d <= b && g++ < 400) { o.push(d); d = addD(d, 1); } return o; };
const libellePeriode = p => PERIODES.types.filter(t => t.id === p.type)[0].label + ' · ' + fmtDC(p.debut) + ' → ' + fmtDC(p.fin);

/* =============================================================================
   21. MÉTÉO
   ========================================================================== */
async function meteo() {
  if (!METEO.actif) return null;
  const cache = await DB.get('meteo', null);
  const frais = cache && (Date.now() - new Date(cache.at)) < METEO.cacheHeures * 3600e3;
  if (frais || !STATE.enLigne) return cache;
  try {
    const u = METEO.endpoint + '?latitude=' + METEO.lat + '&longitude=' + METEO.lon +
      '&current=' + METEO.parametres.current + '&daily=' + METEO.parametres.daily +
      '&timezone=' + encodeURIComponent(METEO.parametres.timezone);
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), OFFLINE.timeoutReseauMs);
    const r = await fetch(u, { signal:ctrl.signal });
    clearTimeout(to);
    const d = await r.json();
    const o = { t:Math.round(d.current.temperature_2m), code:d.current.weather_code,
                max:Math.round(d.daily.temperature_2m_max[0]),
                pluie:d.daily.precipitation_probability_max[0], at:nowISO(), source:'api' };
    await DB.set('meteo', o);
    return o;
  } catch (e) {
    return cache || { t:'—', code:3, max:'—', pluie:'—', at:nowISO(), source:'indisponible' };
  }
}
function widgetMeteo(m) {
  if (!m) return '';
  const c = METEO.codes[m.code] || METEO.codes[3];
  return carte(
    '<div class="meteo"><span class="mi">' + c.i + '</span>' +
    '<div style="flex:1"><div class="mt">' + m.t + '°</div>' +
    '<div class="md">' + esc(c.l) + ' · ' + METEO.ville + '</div></div>' +
    '<div style="text-align:right"><div class="mini">max ' + m.max + '°</div>' +
    '<div class="mini">pluie ' + m.pluie + ' %</div>' +
    (m.source === 'api' ? '' : '<div class="mini">hors ligne</div>') + '</div></div>', 'ciel');
}

/* =============================================================================
   22. TOUR DE CONTRÔLE
   ========================================================================== */
V.controle = async function () {
  const j = today();
  const per = await periodeCourante();
  const m = await meteo();
  const e = await etatJour(j);

  const ruptures = (await DB.get('ruptures', [])).filter(r => !r.traite);
  const feedJ = [];
  for (let i = 0; i < 3; i++) {
    const d = addD(j, -i);
    (await DB.get('feed:' + d, [])).forEach(x => feedJ.push(Object.assign({ jour:d }, x)));
  }
  feedJ.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  const fifo = await calculFIFO(monthKey(j));
  const perimes = fifo.filter(f => f.c === 'rouge').length;
  const bientot = fifo.filter(f => f.c === 'orange').length;

  const jours = joursEntre(per.debut, j > per.fin ? per.fin : j);
  let cumulCaisse = 0, sansNet = 0, tempCrit = 0;
  for (const d of jours) {
    const k = await DB.get('caisse:' + d, null);
    if (k) cumulCaisse += num(k.ecart);
    const n = await etatNettoyage(d);
    if (n.total && n.faits === 0) sansNet++;
    const t = await DB.get('temp:' + d, {});
    tempCrit += ENCEINTES.filter(en => ['m','s'].some(mo => etatTemp(en, t[mo + '_' + en.id]) === 'crit')).length;
  }

  const equipeJour = await DB.get('pointage:' + j, []);
  const enService = equipeJour.filter(s => !s.fin);

  const A = [];
  if (ruptures.length) A.push(['bad', ruptures.length + ' rupture(s) non traitée(s)', 'Signalées par l’équipe lors du réassort.', 'controle']);
  if (perimes) A.push(['bad', perimes + ' produit(s) dépassé(s)', 'À retirer de la vitrine immédiatement.', 'frigo']);
  if (tempCrit) A.push(['bad', tempCrit + ' relevé(s) en limite critique', 'Chaque dépassement doit avoir une action corrective écrite.', 'temp']);
  if (Math.abs(cumulCaisse) > SEUILS.caisseCumulEur) A.push(['warn', 'Écart de caisse cumulé : ' + eur(cumulCaisse), 'Au-delà de ' + eur(SEUILS.caisseCumulEur) + ' sur la période.', 'caisse']);
  if (sansNet >= SEUILS.joursSansNettoyage) A.push(['warn', sansNet + ' jour(s) sans nettoyage validé', 'À reprendre avec l’équipe.', 'clean']);
  if (bientot) A.push(['warn', bientot + ' produit(s) à écouler vite', 'Moins de 48 h de vie restante.', 'frigo']);

  badge('controle', A.filter(a => a[0] === 'bad').length, true);
  $('#vue-actions').innerHTML =
    '<button class="btn clair sm" id="scanbl">📸 Scanner BL</button>' +
    '<button class="btn sm" id="pdf">🛡️ Registre</button>';

  $('#page').innerHTML =
    '<div class="grid g2">' + widgetMeteo(m) +
    carte(entete('👥', enService.length ? enService.map(s => s.prenom).join(', ') : 'Personne en service',
      enService.length ? 'En poste depuis ' + enService.map(s => heure(s.debut)).join(', ') : 'Aucun pointage ouvert') +
      '<div class="rang">' + pastille(e.tempM ? 'ok' : 'bad', e.tempM ? 'Frigos matin faits' : 'Frigos matin manquants') +
      pastille(e.net ? 'ok' : 'warn', e.net + '/' + e.netTotal + ' nettoyage') +
      pastille(e.caisse ? 'ok' : 'n', e.caisse ? 'Caisse faite' : 'Caisse ouverte') + '</div>', 'solide') + '</div>' +

    carte(entete('📅', libellePeriode(per), 'Fenêtre de calcul en cours.') +
      '<div class="grid g4">' +
      kpi('Écart caisse', eur(cumulCaisse), Math.abs(cumulCaisse) > SEUILS.caisseCumulEur ? 'bad' : 'ok', 'Cumulé sur la période') +
      kpi('Jours couverts', jours.length, '', 'Depuis le ' + fmtDC(per.debut)) +
      kpi('Ruptures', ruptures.length, ruptures.length ? 'bad' : 'ok', 'Non traitées') +
      kpi('Périmés', perimes, perimes ? 'bad' : 'ok', 'En vitrine ou réserve') + '</div>', 'plat') +

    (A.length ? '<div class="entete"><h3>Alertes</h3></div><div class="stack">' + A.map(a =>
      '<div class="alerte ' + a[0] + '"><span class="ai">' + (a[0] === 'bad' ? '▲' : '●') + '</span>' +
      '<div><b>' + esc(a[1]) + '</b><p>' + esc(a[2]) + '</p></div>' +
      '<span class="go"><button class="btn clair sm" data-go="' + a[3] + '">Ouvrir</button></span></div>').join('') + '</div>'
      : carte('<div class="alerte ok"><span class="ai">✓</span><div><b>Rien à signaler</b>' +
        '<p>Caisse, frigos, nettoyage et stocks sont dans les clous.</p></div></div>', 'plat')) +

    (ruptures.length ? '<div class="entete"><h3>🚨 Urgences</h3>' +
      '<button class="btn fantome sm pousse" id="tout-traite">Tout marquer traité</button></div>' +
      '<div class="stack">' + ruptures.slice().reverse().map(r => {
        const niv = RUPTURE.niveaux.filter(n => n.id === r.niveau)[0] || RUPTURE.niveaux[0];
        return carte('<div class="rang"><span class="ci">⚠️</span>' +
          '<div style="flex:1;min-width:0"><b>' + esc(r.article) + '</b>' +
          '<div class="mini">' + (r.reste === 0 ? 'Plus rien en stock' : 'Reste ' + r.reste + ' ' + esc(r.unite)) +
          (r.note ? ' · ' + esc(r.note) : '') + ' · ' + esc(r.par) + ' le ' + fmtDC(r.jour) + ' ' + heure(r.at) + '</div></div>' +
          pastille(niv.couleur === 'rouge' ? 'bad' : 'warn', niv.label) +
          '<button class="btn menthe sm" data-traite="' + r.id + '">Traité</button></div>', 'urgence corail');
      }).join('') + '</div>' : '') +

    '<div class="entete"><h3>🗼 En direct</h3><span class="pousse mini">3 derniers jours</span></div>' +
    carte(feedJ.length ? '<div class="feed">' + feedJ.slice(0, 60).map(x => {
      const p = EQUIPE.filter(y => y.id === x.id)[0];
      return '<div class="fi ' + (x.n === 'ok' ? '' : x.n) + '">' +
        '<span class="fh">' + heure(x.at) + '</span>' +
        (p ? avatar(p, 'fp') : '<span class="fp" style="background:var(--brume)">?</span>') +
        '<span class="fc"><span class="fx">' + esc(x.x) + '</span>' +
        '<span class="fm">' + fmtDC(x.jour) + '</span></span></div>';
    }).join('') + '</div>' : vide('🗼', 'Aucune activité enregistrée.'));

  $$('[data-traite]').forEach(b => b.onclick = async () => {
    const l = await DB.get('ruptures', []);
    const r = l.filter(x => x.id === b.dataset.traite)[0];
    if (r) { r.traite = true; r.traitePar = STATE.user.prenom; r.traiteAt = nowISO(); }
    await DB.set('ruptures', l);
    await feed('ok', STATE.user.prenom + ' a traité la rupture : ' + (r ? r.article : ''));
    toast('Rupture traitée');
    rendre('controle');
  });

  const tt = $('#tout-traite');
  if (tt) tt.onclick = () => confirmer('Tout marquer traité ?',
    ruptures.length + ' rupture(s) seront classées. L’historique est conservé.', 'Tout traiter', async () => {
      const l = await DB.get('ruptures', []);
      l.forEach(r => { if (!r.traite) { r.traite = true; r.traitePar = STATE.user.prenom; r.traiteAt = nowISO(); } });
      await DB.set('ruptures', l);
      toast('Urgences classées');
      rendre('controle');
    });

  $('#pdf').onclick = ouvrirBouclier;
  $('#scanbl').onclick = scannerBL;
};

const kpi = (k, v, cls, d) =>
  '<div class="kpi ' + (cls || '') + '"><div class="k">' + esc(k) + '</div>' +
  '<div class="v">' + v + '</div><div class="d">' + esc(d || '') + '</div></div>';

/* =============================================================================
   23. FRIGO VIRTUEL (FIFO)
   ========================================================================== */
async function calculFIFO(mois) {
  const rec = await DB.get('lots:' + mois, {});
  const out = [];
  Object.keys(rec).forEach(cle => {
    const v = rec[cle];
    if (!v || !v.lot || !v.ouv) return;
    const type = cle.slice(0, 1);
    const nom = type === 'g' ? cle.slice(2) : (DLC_RULES[cle.slice(2)] || DLC_RULES.defaut).label;
    const regle = regleDLC(nom, type);
    const heures = DLC_RULES[regle].h;
    const limite = new Date(new Date(v.ouv + 'T08:00:00').getTime() + heures * 3600e3);
    const resteH = Math.round((limite - Date.now()) / 3600e3);
    const part = resteH / heures;
    const c = resteH < 0 ? 'rouge' : part <= DLC_SEUILS.vert.min ? 'orange' : 'vert';
    out.push({ cle:cle, nom:nom, type:type, lot:v.lot, ouv:v.ouv, par:v.par,
               regle:regle, heures:heures, limite:isoOf(limite), limiteH:limite,
               resteH:resteH, c:c, zone:DLC_RULES[regle].zone });
  });
  return out.sort((a, b) => a.resteH - b.resteH);
}
const resteLisible = h => h < 0
  ? 'Dépassé de ' + (Math.abs(h) < 48 ? Math.abs(h) + ' h' : Math.round(Math.abs(h) / 24) + ' j')
  : h < 48 ? 'Encore ' + h + ' h' : 'Encore ' + Math.round(h / 24) + ' j';

V.frigo = async function () {
  const mois = monthKey(STATE.jour);
  const fifo = await calculFIFO(mois);
  const r = fifo.filter(f => f.c === 'rouge'), o = fifo.filter(f => f.c === 'orange'), v = fifo.filter(f => f.c === 'vert');

  $('#vue-actions').innerHTML = '<input type="month" id="mm" value="' + mois + '" style="width:auto;min-height:42px">';

  $('#page').innerHTML =
    '<div class="grid g3">' +
    kpi('Périmés', r.length, r.length ? 'bad' : 'ok', 'À retirer maintenant') +
    kpi('À écouler', o.length, o.length ? 'warn' : 'ok', 'Moins de 48 h') +
    kpi('Conformes', v.length, 'ok', 'Rien à signaler') + '</div>' +

    (fifo.length ? [['rouge', '🔴 Périmés — à retirer', r], ['orange', '🟠 À vendre vite', o], ['vert', '🟢 Conformes', v]]
      .filter(g => g[2].length).map(g =>
        '<div class="entete"><h3>' + g[1] + '</h3><span class="pousse mini num">' + g[2].length + '</span></div>' +
        '<div class="stack">' + g[2].map(f =>
          '<div class="fifo ' + f.c + '"><div class="fn"><b>' + esc(f.nom) + '</b>' +
          '<div class="fd">Lot ' + esc(f.lot) + ' · ouvert le ' + fmtDC(f.ouv) +
          ' par ' + esc(f.par || '—') + ' · ' + Math.round(f.heures / 24 * 10) / 10 + ' j de vie</div></div>' +
          '<div class="fr"><b>' + resteLisible(f.resteH) + '</b>' +
          '<span>limite ' + fmtDC(f.limite) + '</span></div>' +
          (f.c === 'rouge' ? '<button class="btn corail sm" data-jeter="' + f.cle + '">Jeter</button>' : '') +
          '</div>').join('') + '</div>').join('')
      : vide('🧊', 'Aucun lot ouvert ce mois. Les saisies de l’équipe apparaissent ici.'));

  $('#mm').onchange = e => { STATE.jour = e.target.value + '-15'; rendre('frigo'); };

  $$('[data-jeter]').forEach(b => b.onclick = () => {
    const f = fifo.filter(x => x.cle === b.dataset.jeter)[0];
    confirmer('Jeter ' + f.nom + ' ?',
      'Le lot ' + f.lot + ' sera enregistré en perte et retiré du frigo virtuel.', 'Jeter et déclarer', async () => {
        await DB.push('pertes:' + today(), { id:uid(), produit:f.nom + ' (lot ' + f.lot + ')', nombre:1,
          litrage:FOURNISSEUR.tailleParDefaut, motif:'perime', par:STATE.user.prenom, at:nowISO() });
        await cumulerPertesMois(today());
        const rec = await DB.get('lots:' + mois, {});
        delete rec[f.cle];
        await DB.set('lots:' + mois, rec);
        await feed('warn', STATE.user.prenom + ' a jeté ' + f.nom + ' (DLC dépassée)');
        toast('Perte enregistrée');
        rendre('frigo');
      });
  });
};

/* =============================================================================
   24. SCANNER BON DE LIVRAISON — Jetfreeze
   ========================================================================== */
async function scannerBL() {
  const r = await scannerPhoto('bl');
  if (!r) return;
  const total = r.lignes.reduce((s, l) => s + l.bacs, 0);
  const litres = r.lignes.reduce((s, l) => s + l.bacs * l.taille, 0);

  showSheet(
    '<div class="rang"><h2 id="sheet-titre">' + esc(r.fournisseur) + ' · ' + esc(r.numero) + '</h2>' +
    '<span class="pousse demo">DÉMO</span></div>' +
    '<p class="sub">' + r.lignes.length + ' références · ' + total + ' bacs · ' + n1(litres) + ' L</p>' +
    '<div class="dense"><div class="dense-h"><span class="c1">Référence</span>' +
    '<span class="c w">Bacs</span><span class="c w">Litres</span></div>' +
    '<div class="dense-scroll">' + r.lignes.map(l =>
      '<div class="dl"><span class="c1">' + esc(l.ref) + ' · ' + esc(l.parfum) + '</span>' +
      '<span class="c w num">' + l.bacs + '</span>' +
      '<span class="c w num">' + (l.bacs * l.taille) + '</span></div>').join('') + '</div></div>' +
    '<div class="alerte info" style="margin-top:14px"><span class="ai">📥</span><div><b>Ce que fait la validation</b>' +
    '<p>Les ' + n1(litres) + ' L s’ajoutent aux achats de la période en cours, base du calcul d’écart.</p></div></div>' +
    '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
    '<button class="btn menthe" id="bl-ok">Ajouter aux achats</button></div>');

  $('#bl-ok').onclick = async () => {
    const per = await periodeCourante();
    const e = await DB.get('ecart:' + per.id, {});
    e.litrageBL = num(e.litrageBL) + litres;
    e.bl = (e.bl || []).concat([{ numero:r.numero, date:r.date, bacs:total, litres:litres, lignes:r.lignes, par:STATE.user.prenom }]);
    await DB.set('ecart:' + per.id, e);
    await feed('ok', STATE.user.prenom + ' a saisi le BL ' + r.numero + ' (' + total + ' bacs)');
    closeSheet();
    toast(n1(litres) + ' L ajoutés aux achats');
  };
}

/* =============================================================================
   25. INVENTAIRES
   ========================================================================== */
V.inv = async function () {
  const per = await periodeCourante();
  const onglet = V.inv._t || 'glace';
  $('#vue-actions').innerHTML =
    '<button class="btn ' + (onglet === 'glace' ? '' : 'clair') + ' sm" data-iv="glace">🍦 Glace</button>' +
    '<button class="btn ' + (onglet === 'sec' ? '' : 'clair') + ' sm" data-iv="sec">📦 Sec</button>';
  $$('[data-iv]').forEach(b => b.onclick = () => { V.inv._t = b.dataset.iv; rendre('inv'); });
  onglet === 'glace' ? await invGlace(per) : await invSec(per);
};

async function invGlace(per) {
  const cle = 'invglace:' + per.id;
  const rec = await DB.get(cle, { l:{}, valide:false });
  if (!rec.l) rec.l = {};

  const calc = () => {
    let bacs = 0, litres = 0;
    PARFUMS.forEach((p, i) => {
      const v = rec.l['p' + i] || {}, t = num(v.taille) || FOURNISSEUR.tailleParDefaut;
      bacs += num(v.n); litres += num(v.n) * t + num(v.ent);
    });
    return { bacs:bacs, litres:litres, kg:litres * FOURNISSEUR.poidsMoyenLitre };
  };
  const c = calc();

  $('#page').innerHTML =
    carte(entete('🍦', 'Inventaire glace · ' + libellePeriode(per),
      'Comptez parfum par parfum. Le total des bacs devra être confirmé avant validation.') +
      (rec.valide
        ? '<div class="alerte ok"><span class="ai">✓</span><div><b>Validé</b><p>' + esc(rec.par) + ' · ' +
          fmtD(rec.jour) + ' ' + heure(rec.at) + ' — ' + rec.bacs + ' bacs, ' + n1(rec.kg) + ' kg</p></div>' +
          '<span class="go"><button class="btn clair sm" id="rouvrir">Rouvrir</button></span></div>'
        : '<div class="grid g3">' +
          kpi('Bacs comptés', '<span id="tb">' + c.bacs + '</span>', '', 'Total saisi') +
          kpi('Litres', '<span id="tl">' + n1(c.litres) + '</span>', '', 'Bacs + entamés') +
          kpi('Poids', '<span id="tk">' + n1(c.kg) + '</span><span class="u">kg</span>', '', 'Stock réel') + '</div>'), 'solide') +

    '<div class="entete"><h3>Parfums</h3></div><div class="stack">' +
    PARFUMS.map((p, i) => {
      const v = rec.l['p' + i] || {}, t = num(v.taille) || FOURNISSEUR.tailleParDefaut;
      return carte('<div class="rang"><b style="flex:1">' + esc(p) + '</b>' +
        '<span class="mini num" data-lg="p' + i + '">' + n1(num(v.n) * t + num(v.ent)) + ' L</span></div>' +
        '<div class="grid g3" style="margin-top:12px">' +
        '<div class="champ"><label class="f">Taille</label><select data-g="p' + i + '.taille"' + (rec.valide ? ' disabled' : '') + '>' +
        TAILLES_BAC.map(x => '<option value="' + x + '"' + (t === x ? ' selected' : '') + '>' + x + ' L</option>').join('') + '</select></div>' +
        '<div class="champ"><label class="f">Bacs entiers</label>' +
        '<input type="number" min="0" step="1" data-g="p' + i + '.n" value="' + (v.n === undefined ? '' : v.n) + '"' + (rec.valide ? ' disabled' : '') + '></div>' +
        '<div class="champ"><label class="f">Entamé (L)</label>' +
        '<input type="number" min="0" step="0.5" data-g="p' + i + '.ent" value="' + (v.ent === undefined ? '' : v.ent) + '"' + (rec.valide ? ' disabled' : '') + '></div></div>',
        num(v.n) ? 'menthe' : '');
    }).join('') + '</div>' +

    (rec.valide ? '' : carte(entete('✅', 'Confirmation du comptage',
      'Recomptez les bacs présents toutes chambres confondues. La validation exige que les deux nombres correspondent.') +
      '<div class="grid g2"><div class="champ"><label class="f">Total recompté</label>' +
      '<input type="number" min="0" id="cf" placeholder="Ex. 120"></div>' +
      '<div class="champ"><label class="f">Total calculé</label>' +
      '<input type="text" id="cc" value="' + c.bacs + '" readonly></div></div>' +
      '<button class="btn menthe bloc xl" id="val" style="margin-top:16px">Valider l’inventaire</button>' +
      '<div id="vm" style="margin-top:14px"></div>', 'ambre'));

  const refresh = () => {
    $$('[data-g]').forEach(i => {
      const a = i.dataset.g.split('.');
      if (!rec.l[a[0]]) rec.l[a[0]] = {};
      rec.l[a[0]][a[1]] = i.value;
    });
    PARFUMS.forEach((p, i) => {
      const v = rec.l['p' + i] || {}, t = num(v.taille) || FOURNISSEUR.tailleParDefaut;
      const el = $('[data-lg="p' + i + '"]');
      if (el) el.textContent = n1(num(v.n) * t + num(v.ent)) + ' L';
    });
    const c2 = calc();
    if ($('#tb')) { $('#tb').textContent = c2.bacs; $('#tl').textContent = n1(c2.litres); $('#tk').textContent = n1(c2.kg); }
    if ($('#cc')) $('#cc').value = c2.bacs;
    DB.set(cle, rec);
  };
  $$('[data-g]').forEach(i => { i.oninput = refresh; i.onchange = refresh; });

  const rv = $('#rouvrir');
  if (rv) rv.onclick = () => confirmer('Rouvrir l’inventaire ?',
    'Les chiffres redeviennent modifiables. La clôture de période sera bloquée jusqu’à une nouvelle validation.',
    'Rouvrir', async () => { rec.valide = false; await DB.set(cle, rec); rendre('inv'); });

  const vb = $('#val');
  if (vb) vb.onclick = async () => {
    const c2 = calc(), saisi = num($('#cf').value);
    if ($('#cf').value === '') {
      $('#vm').innerHTML = '<div class="alerte warn"><span class="ai">●</span><div><b>Confirmation manquante</b>' +
        '<p>Saisissez le nombre total de bacs que vous avez recomptés.</p></div></div>';
      return;
    }
    if (saisi !== c2.bacs) {
      $('#vm').innerHTML = '<div class="alerte bad"><span class="ai">▲</span><div><b>Les comptages ne correspondent pas</b>' +
        '<p>Vous avez compté ' + saisi + ' bacs, l’application en totalise ' + c2.bacs +
        '. Recomptez ou corrigez les lignes avant de valider.</p></div></div>';
      vibrer(UI.vibration.erreur);
      return;
    }
    Object.assign(rec, { valide:true, par:STATE.user.prenom, jour:today(), at:nowISO(),
                         bacs:c2.bacs, litres:c2.litres, kg:c2.kg });
    await DB.set(cle, rec);
    const par = { }; TAILLES_BAC.forEach(t => par[t] = 0);
    let ent = 0;
    PARFUMS.forEach((p, i) => {
      const v = rec.l['p' + i] || {}, t = num(v.taille) || FOURNISSEUR.tailleParDefaut;
      par[t] = (par[t] || 0) + num(v.n); ent += num(v.ent);
    });
    await DB.patch('ecart:' + per.id, { fin:{ bacs:par, entames:ent, kg:c2.kg } });
    await feed('ok', STATE.user.prenom + ' a validé l’inventaire glace (' + c2.bacs + ' bacs, ' + n1(c2.kg) + ' kg)');
    toast('Inventaire validé et reporté dans les écarts');
    rendre('inv');
  };
}

async function invSec(per) {
  const cle = 'invsec:' + per.id;
  const rec = await DB.get(cle, { l:{}, valide:false });
  if (!rec.l) rec.l = {};

  $('#page').innerHTML =
    carte(entete('📦', 'Inventaire sec · ' + libellePeriode(per), 'Consommables et produits non congelés.') +
      (rec.valide ? '<div class="alerte ok"><span class="ai">✓</span><div><b>Validé</b><p>' + esc(rec.par) +
        ' · ' + fmtD(rec.jour) + '</p></div><span class="go"><button class="btn clair sm" id="ro">Rouvrir</button></span></div>' : ''), 'solide') +

    '<div class="stack">' + INVENTAIRE_SEC.map((s, i) => {
      const v = rec.l['s' + i] || {};
      return carte('<div class="rang"><b style="flex:1">' + esc(s) + '</b>' +
        (v.q ? pastille('ok', v.q + ' ' + esc(v.u || '')) : pastille('n', 'à compter')) + '</div>' +
        '<div class="grid g3" style="margin-top:12px">' +
        '<div class="champ"><label class="f">Quantité</label>' +
        '<input type="number" min="0" step="0.5" data-s="s' + i + '.q" value="' + (v.q === undefined ? '' : v.q) + '"' + (rec.valide ? ' disabled' : '') + '></div>' +
        '<div class="champ"><label class="f">Unité</label>' +
        '<input type="text" data-s="s' + i + '.u" value="' + esc(v.u || '') + '" placeholder="unité, kg…"' + (rec.valide ? ' disabled' : '') + '></div>' +
        '<div class="champ"><label class="f">Note</label>' +
        '<input type="text" data-s="s' + i + '.c" value="' + esc(v.c || '') + '" placeholder="—"' + (rec.valide ? ' disabled' : '') + '></div></div>',
        v.q ? 'menthe' : '');
    }).join('') + '</div>' +

    (rec.valide ? '' : '<button class="btn menthe bloc xl" id="vs" style="margin-top:16px">Valider l’inventaire sec</button>');

  const collecte = () => $$('[data-s]').forEach(i => {
    const a = i.dataset.s.split('.');
    if (!rec.l[a[0]]) rec.l[a[0]] = {};
    rec.l[a[0]][a[1]] = i.value;
  });
  const save = debounce(() => { collecte(); DB.set(cle, rec); }, 400);
  $$('[data-s]').forEach(i => i.oninput = save);

  const ro = $('#ro');
  if (ro) ro.onclick = async () => { rec.valide = false; await DB.set(cle, rec); rendre('inv'); };

  const vs = $('#vs');
  if (vs) vs.onclick = async () => {
    collecte();
    Object.assign(rec, { valide:true, par:STATE.user.prenom, jour:today(), at:nowISO() });
    await DB.set(cle, rec);
    await feed('ok', STATE.user.prenom + ' a validé l’inventaire sec');
    toast('Inventaire sec validé');
    rendre('inv');
  };
}

/* =============================================================================
   26. CAISSE
   ========================================================================== */
V.caisse = async function () {
  const j = STATE.jour;
  const r = await DB.get('caisse:' + j, {});
  const champ = (k, l, ph) =>
    '<div class="champ"><label class="f">' + l + '</label>' +
    '<input type="number" inputmode="decimal" step="0.01" data-k="' + k + '" value="' +
    (r[k] === undefined ? '' : r[k]) + '" placeholder="' + (ph || '') + '"></div>';

  $('#vue-actions').innerHTML = '<input type="date" id="jj" value="' + j + '" style="width:auto;min-height:42px">';

  $('#page').innerHTML =
    carte(entete('💶', 'Caisse du ' + fmtD(j), 'Suivez l’ordre de la fiche : ticket Z, TPE, puis comptage des espèces.') +
      '<div class="grid g2">' + champ('fi', 'Fonds initial') + champ('ff', 'Fonds final') + '</div>' +
      '<div class="grid g2" style="margin-top:14px">' + champ('cb', 'Recettes CB') + champ('esp', 'Recettes espèces') + '</div>' +
      '<div class="grid g2" style="margin-top:14px">' + champ('tpe', 'Total TPE') + champ('ret', 'Retrait du soir') + '</div>' +
      '<div class="champ" style="margin-top:14px"><label class="f">Commandes annulées</label>' +
      '<input type="text" data-k="ann" value="' + esc(r.ann || '') + '" placeholder="Nombre, montant, personne"></div>' +
      '<div class="champ" style="margin-top:14px"><label class="f">Commentaire</label>' +
      '<textarea data-k="com" placeholder="Ex. erreur de rendu de monnaie sur une commande de 12 €.">' + esc(r.com || '') + '</textarea></div>', 'solide') +

    '<div class="grid g3" style="margin-top:12px">' +
    kpi('Recette totale', '<span id="k1">—</span>', '', 'CB + espèces') +
    kpi('Écart TPE / CB', '<span id="k2">—</span>', '', 'Seuil ' + eur(SEUILS.caisseJourEur)) +
    kpi('Signature', esc(STATE.user.prenom), '', 'Session en cours') + '</div>' +

    '<button class="btn menthe bloc xl" id="cv" style="margin-top:16px">Enregistrer la feuille</button>' +
    '<button class="btn fantome bloc" id="cf6" style="margin-top:8px">Voir la fiche « Clôture de caisse »</button>';

  const sauver = debounce(async (o, ec) => {
    await DB.set('caisse:' + j, Object.assign({}, o, { ecart:ec, par:STATE.user.prenom, employe:STATE.user.id, at:nowISO() }));
  }, 450);

  const refresh = () => {
    const o = {};
    $$('[data-k]').forEach(i => o[i.dataset.k] = i.value);
    const ec = num(o.tpe) - num(o.cb);
    $('#k1').textContent = eur(num(o.cb) + num(o.esp));
    $('#k2').textContent = eur(ec);
    const box = $('#k2').closest('.kpi');
    box.className = 'kpi ' + (Math.abs(ec) > SEUILS.caisseJourEur ? 'bad' : Math.abs(ec) > 0.01 ? 'warn' : 'ok');
    sauver(o, ec);
    return ec;
  };
  $$('[data-k]').forEach(i => i.oninput = refresh);
  refresh();

  $('#cv').onclick = async () => {
    const ec = refresh();
    await feed(Math.abs(ec) > SEUILS.caisseJourEur ? 'bad' : 'ok',
      STATE.user.prenom + ' a fermé la caisse — écart ' + eur(ec));
    toast(Math.abs(ec) > SEUILS.caisseJourEur ? 'Enregistré — écart à expliquer' : 'Feuille enregistrée');
  };
  $('#cf6').onclick = () => { rendre('fiches'); setTimeout(() => { const b = $('[data-f="f06"]'); if (b) b.click(); }, 300); };
  $('#jj').onchange = e => { STATE.jour = e.target.value; rendre('caisse'); };
};

/* =============================================================================
   27. ÉCARTS GLACE + DÉTECTEUR DE TENDANCES
   ========================================================================== */
async function calculEcart(per) {
  const e = await DB.get('ecart:' + per.id, {});
  const invD = await DB.get('invglace:' + (per.precedente || '') , null);
  const debutKg = e.debut && e.debut.kg !== undefined ? num(e.debut.kg) : (invD && invD.valide ? num(invD.kg) : num(e.debutKg));
  const finKg = e.fin && e.fin.kg !== undefined ? num(e.fin.kg) : 0;
  const achats = num(e.litrageBL) * FOURNISSEUR.poidsMoyenLitre;
  const jete = num(e.jeteKg);

  let vendu = 0;
  const ventes = e.ventes || {};
  Object.keys(ventes).forEach(sku => vendu += num(ventes[sku]));

  const theo = debutKg + achats - jete - vendu;
  const ecart = finKg - theo;
  const pct = theo ? ((theo - finKg) / theo) * 100 : 0;
  return { debutKg, finKg, achats, jete, vendu, theo, reel:finKg, ecart:ecart,
           pct:pct, valeur:ecart * FOURNISSEUR.prixMoyenKg, invValide:!!(e.fin && e.fin.kg !== undefined) };
}
const etatEcart = p => {
  const a = Math.abs(p);
  return a <= SEUILS.ecartGlacePct ? { c:'ok', t:'Dans la fourchette' }
       : a <= SEUILS.ecartGlaceAlertePct ? { c:'warn', t:'À surveiller' }
       : { c:'bad', t:'Hors fourchette' };
};

V.ecarts = async function () {
  const per = await periodeCourante();
  const c = await calculEcart(per);
  const st = etatEcart(c.pct);
  const inv = await DB.get('invglace:' + per.id, null);
  const e = await DB.get('ecart:' + per.id, {});
  const tendances = await analyserTendances(per);

  const pos = Math.max(-25, Math.min(25, -c.pct));
  const gauche = 50 + (pos / 25) * 50;

  $('#vue-actions').innerHTML = '<button class="btn clair sm" id="sbl">📸 Scanner BL</button>';

  $('#page').innerHTML =
    carte(entete('📊', libellePeriode(per), 'Stock théorique = début + achats − jeté − vendu.') +
      '<div class="grid g4">' +
      kpi('Stock réel', n1(c.reel) + '<span class="u">kg</span>', '', c.invValide ? 'Inventaire validé' : 'Inventaire manquant') +
      kpi('Stock théorique', n1(c.theo) + '<span class="u">kg</span>', '', 'Calculé') +
      kpi('Écart', (c.ecart > 0 ? '+' : '−') + n1(Math.abs(c.ecart)) + '<span class="u">kg</span>', st.c, st.t) +
      kpi('Coût', eur(c.valeur), st.c, 'à ' + n2(FOURNISSEUR.prixMoyenKg) + ' €/kg') + '</div>' +
      '<div class="ecart" style="margin-top:18px"><div class="piste">' +
      '<div class="cible" style="left:' + (50 - (SEUILS.ecartGlacePct / 25) * 50) + '%;width:' + ((SEUILS.ecartGlacePct * 2 / 25) * 50) + '%"></div>' +
      '<div class="aig" style="left:' + gauche + '%"></div></div>' +
      '<div class="lg"><span>−25 % manquant</span><span>objectif ±' + SEUILS.ecartGlacePct + ' %</span><span>+25 % surplus</span></div></div>', 'solide') +

    (c.invValide ? '' : '<div class="alerte bad" style="margin-top:12px"><span class="ai">▲</span>' +
      '<div><b>Inventaire glace non validé</b><p>Sans comptage réel, le stock de fin est inconnu et l’écart n’a aucune valeur. ' +
      'La période ne pourra pas être clôturée.</p></div>' +
      '<span class="go"><button class="btn clair sm" data-go="inv">Compter</button></span></div>') +

    '<div class="grid g2" style="margin-top:12px">' +
    carte(entete('📥', 'Achats de la période', 'Litrage cumulé des bons de livraison.') +
      '<div class="champ"><label class="f">Litrage total (L)</label>' +
      '<input type="number" step="0.1" id="bl" value="' + (e.litrageBL || '') + '"></div>' +
      '<p class="mini" style="margin-top:10px">' + n1(c.achats) + ' kg · ' +
      ((e.bl || []).length) + ' bon(s) scanné(s)</p>') +
    carte(entete('🗑️', 'Pertes de la période', 'Reprises automatiquement du registre.') +
      '<div class="champ"><label class="f">Poids jeté (kg)</label>' +
      '<input type="number" step="0.01" id="jk" value="' + (e.jeteKg || '') + '"></div>' +
      '<p class="mini" style="margin-top:10px">' + n1(num(e.jeteL)) + ' L déclarés</p>') + '</div>' +

    carte(entete('🍦', 'Glace vendue', 'Poids sorti par la caisse sur la période. C’est la donnée qui pèse le plus dans l’écart.') +
      '<button class="btn ciel bloc xl" id="imp-btn">📥 Importer l’export de caisse (XLSX)</button>' +
      '<input type="file" id="import-caisse" accept=".xlsx,.xls" hidden>' +
      '<div class="grid g2" style="margin-top:16px">' +
      kpi('Poids vendu', n1(c.vendu) + '<span class="u">kg</span>',
          c.vendu ? 'ok' : 'warn', e.venteSource || 'Aucun import') +
      '<div class="champ"><label class="f">Corriger à la main (kg)</label>' +
      '<input type="number" step="0.01" id="vd" value="' + (num(c.vendu) || '') + '" placeholder="0"></div></div>' +
      ((e.imports || []).length
        ? '<div class="dense" style="margin-top:14px"><div class="dense-h"><span class="c1">Import</span>' +
          '<span class="c w">Lignes</span><span class="c w">Poids</span></div>' +
          e.imports.slice().reverse().slice(0, 5).map(i =>
            '<div class="dl"><span class="c1">' + esc(i.fichier) + '</span>' +
            '<span class="c w num">' + i.lignes + '</span>' +
            '<span class="c w num">' + n1(i.kg) + ' kg</span></div>').join('') + '</div>'
        : '<p class="mini" style="margin-top:12px">Le fichier doit contenir une colonne de quantités et, ' +
          'soit une colonne de poids, soit des SKU rattachés à un grammage.</p>')) +

    (inv && inv.valide ? carte(entete('✅', 'Inventaire de clôture',
      inv.bacs + ' bacs · ' + n1(inv.kg) + ' kg · validé par ' + inv.par + ' le ' + fmtD(inv.jour)), 'menthe') : '') +

    (tendances.length ? '<div class="entete"><h3>🔎 Tendances détectées</h3><span class="pousse demo">ANALYSE LOCALE</span></div>' +
      '<div class="stack">' + tendances.map(t =>
        carte('<div class="rang"><span class="ci">' + t.icone + '</span>' +
          '<div style="flex:1"><b>' + esc(t.titre) + '</b><div class="mini">' + esc(t.detail) + '</div></div>' +
          pastille(t.niveau, t.compte + '×') + '</div>', 'ambre')).join('') +
      '</div><p class="mini" style="margin-top:10px">' + esc(FRAUDE.avertissement) + '</p>' : '');

  const sauver = debounce(async () => {
    await DB.patch('ecart:' + per.id, {
      litrageBL:$('#bl').value, jeteKg:$('#jk').value,
      ventes:{ total:$('#vd').value },
      venteSource:'Saisie manuelle · ' + STATE.user.prenom
    });
    rendre('ecarts');
  }, 700);
  ['#bl', '#jk', '#vd'].forEach(x => { const el = $(x); if (el) el.oninput = sauver; });
  $('#sbl').onclick = scannerBL;

  $('#imp-btn').onclick = () => $('#import-caisse').click();
  $('#import-caisse').onchange = async ev => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    if (typeof XLSX === 'undefined') return toast('Librairie de lecture indisponible hors ligne', 'erreur');

    showSheet('<h2 id="sheet-titre">Lecture de l’export</h2>' +
      '<p class="sub">' + esc(f.name) + '</p>' +
      '<div class="vide"><span class="vi">📊</span>Analyse du fichier…</div>');

    let r;
    try { r = await lireExportCaisse(f); }
    catch (err) {
      closeSheet();
      toast(err && err.message ? err.message : 'Fichier illisible', 'erreur');
      return;
    }
    confirmerImport(per, f.name, r);
  };
};

async function analyserTendances(per) {
  if (!FRAUDE.actif) return [];
  const out = [];
  const fin = today(), debut = addD(fin, -FRAUDE.fenetreJours);
  const parJour = {}, parPersonne = {};
  let annulations = 0, pertesTotal = 0;

  for (const d of joursEntre(debut, fin)) {
    const k = await DB.get('caisse:' + d, null);
    if (k) {
      const ec = num(k.ecart);
      if (Math.abs(ec) > SEUILS.caisseJourEur) {
        const jn = JOURS_SEMAINE[jourISO(d)];
        parJour[jn] = (parJour[jn] || 0) + 1;
        if (k.par) parPersonne[k.par] = (parPersonne[k.par] || 0) + 1;
      }
      if (k.ann && String(k.ann).trim()) annulations++;
    }
    (await DB.get('pertes:' + d, [])).forEach(p => pertesTotal += num(p.litrage));
  }

  Object.keys(parJour).forEach(j => {
    if (parJour[j] >= FRAUDE.minOccurrences)
      out.push({ icone:'📅', niveau:'warn', compte:parJour[j],
                 titre:'Manques en caisse le ' + j.toLowerCase(),
                 detail:parJour[j] + ' écarts au-delà du seuil sur ' + FRAUDE.fenetreJours + ' jours, tous un ' + j.toLowerCase() + '.' });
  });
  Object.keys(parPersonne).forEach(p => {
    if (parPersonne[p] >= FRAUDE.minOccurrences)
      out.push({ icone:'👤', niveau:'warn', compte:parPersonne[p],
                 titre:'Écarts concentrés sur une session',
                 detail:parPersonne[p] + ' clôtures avec écart signées ' + p + '. À vérifier avant toute conclusion.' });
  });
  if (annulations >= FRAUDE.minOccurrences)
    out.push({ icone:'↩️', niveau:'warn', compte:annulations,
               titre:'Commandes annulées répétées',
               detail:annulations + ' journées avec des annulations notées sur la fenêtre analysée.' });
  if (pertesTotal > 0)
    out.push({ icone:'🗑️', niveau:'n', compte:Math.round(pertesTotal),
               titre:'Volume de pertes déclarées',
               detail:n1(pertesTotal) + ' L jetés sur ' + FRAUDE.fenetreJours + ' jours, soit ' +
                      n1(pertesTotal * FOURNISSEUR.poidsMoyenLitre * FOURNISSEUR.prixMoyenKg) + ' € de marchandise.' });
  return out;
}

/* =============================================================================
   28. PÉRIODES — clôture, y compris anticipée
   ========================================================================== */
async function blocagesCloture(per) {
  const B = [];
  const invG = await DB.get('invglace:' + per.id, null);
  const invS = await DB.get('invsec:' + per.id, null);
  const e = await DB.get('ecart:' + per.id, {});

  if (!invG || !invG.valide) B.push({ id:'inv_glace', txt:'Inventaire glace non validé', go:'inv' });
  if (!invS || !invS.valide) B.push({ id:'inv_sec', txt:'Inventaire sec non validé', go:'inv' });
  if (!num(e.litrageBL))     B.push({ id:'achats', txt:'Achats de la période non saisis', go:'ecarts' });

  for (const d of joursEntre(per.debut, today() < per.fin ? today() : per.fin)) {
    const st = await etatJour(d);
    if (!st.tempM || !st.tempS) B.push({ id:'temp', txt:'Températures incomplètes le ' + fmtDC(d), go:'temp' });
    if (st.netTotal && st.net === 0) B.push({ id:'nettoyage', txt:'Aucun nettoyage validé le ' + fmtDC(d), go:'clean' });
    if (!st.caisse) B.push({ id:'caisse', txt:'Feuille de caisse absente le ' + fmtDC(d), go:'caisse' });
  }
  return B.map(b => Object.assign(b, {
    forcable: (PERIODES.blocages.filter(x => x.id === b.id)[0] || { forcable:false }).forcable
  }));
}

V.periodes = async function () {
  const per = await periodeCourante();
  const B = await blocagesCloture(per);
  const dur = joursEntre(per.debut, per.fin).length;
  const ecoules = joursEntre(per.debut, today() < per.fin ? today() : per.fin).length;
  const anticipee = today() < per.fin;
  const bloquants = B.filter(b => !b.forcable);
  const historique = (await DB.get('periodes', [])).slice().reverse().slice(0, 12);

  $('#page').innerHTML =
    carte(entete('📅', libellePeriode(per),
      anticipee ? 'Il reste ' + (dur - ecoules) + ' jour(s) avant la fin naturelle.' : 'La période est arrivée à son terme.') +
      '<div class="jauge"><i style="width:' + Math.round(ecoules / dur * 100) + '%"></i></div>' +
      '<div class="rang" style="margin-top:10px"><span class="mini">' + ecoules + ' jour(s) sur ' + dur + '</span>' +
      '<span class="pousse">' + pastille(B.length ? (bloquants.length ? 'bad' : 'warn') : 'ok',
        B.length ? B.length + ' point(s) ouverts' : 'Prête à clôturer') + '</span></div>', 'solide') +

    (B.length ? '<div class="entete"><h3>Ce qui reste à faire</h3></div><div class="stack">' + B.map(b =>
      '<div class="alerte ' + (b.forcable ? 'warn' : 'bad') + '"><span class="ai">' + (b.forcable ? '●' : '▲') + '</span>' +
      '<div><b>' + esc(b.txt) + '</b><p>' + (b.forcable ? 'Peut être forcé avec un motif écrit.' : 'Bloquant : la clôture est impossible sans cela.') + '</p></div>' +
      '<span class="go"><button class="btn clair sm" data-go="' + b.go + '">Ouvrir</button></span></div>').join('') + '</div>'
      : carte('<div class="alerte ok"><span class="ai">✓</span><div><b>Tout est en ordre</b>' +
        '<p>Inventaires validés, achats saisis, registres complets.</p></div></div>', 'plat')) +

    '<button class="btn ' + (bloquants.length ? 'clair' : 'menthe') + ' bloc xl" id="clo" style="margin-top:16px">' +
    (anticipee ? '⏭️ Clôture anticipée' : '🔒 Terminer la période') + '</button>' +

    (historique.length ? '<div class="entete"><h3>Périodes clôturées</h3></div>' +
      '<div class="dense"><div class="dense-h"><span class="c1">Période</span>' +
      '<span class="c w">Écart</span><span class="c ww">Clôturée par</span></div>' +
      historique.map(p =>
        '<div class="dl"><span class="c1">' + esc(libellePeriode(p)) +
        (p.anticipee ? ' · anticipée' : '') + '</span>' +
        '<span class="c w num">' + (p.ecartPct === undefined ? '—' : n1(p.ecartPct) + ' %') + '</span>' +
        '<span class="c ww">' + esc(p.par) + ' ' + fmtDC(p.jour) + '</span></div>').join('') + '</div>' : '');

  $('#clo').onclick = () => ouvrirCloture(per, B, anticipee);
};

function ouvrirCloture(per, B, anticipee) {
  const bloquants = B.filter(b => !b.forcable);
  const forcables = B.filter(b => b.forcable);

  if (bloquants.length) {
    showSheet(
      '<h2 id="sheet-titre">Clôture impossible</h2>' +
      '<p class="sub">' + bloquants.length + ' point(s) ne peuvent pas être contournés.</p>' +
      '<div class="stack">' + bloquants.map(b =>
        '<div class="alerte bad"><span class="ai">▲</span><div><b>' + esc(b.txt) + '</b></div>' +
        '<span class="go"><button class="btn clair sm" data-saut="' + b.go + '">Ouvrir</button></span></div>').join('') + '</div>' +
      '<div class="alerte info" style="margin-top:14px"><span class="ai">ℹ️</span><div><b>Pourquoi c’est bloquant</b>' +
      '<p>Sans inventaire de glace réel et sans achats saisis, le stock de fin est une invention : ' +
      'l’écart calculé serait faux et toute la période suivante partirait de travers.</p></div></div>' +
      '<div class="actions"><button class="btn clair" data-fermer>Fermer</button></div>');
    $$('[data-saut]').forEach(b => b.onclick = () => { closeSheet(); rendre(b.dataset.saut); });
    return;
  }

  const demain = addD(today(), 1);
  showSheet(
    '<h2 id="sheet-titre">' + (anticipee ? 'Clôture anticipée' : 'Terminer la période') + '</h2>' +
    '<p class="sub">' + esc(libellePeriode(per)) + (anticipee
      ? ' — vous fermez avant le terme prévu du ' + fmtD(per.fin) + '.' : '') + '</p>' +

    (forcables.length ? '<div class="alerte warn"><span class="ai">●</span><div><b>' + forcables.length +
      ' point(s) incomplets</b><p>' + esc(forcables.slice(0, 3).map(b => b.txt).join(' · ')) +
      (forcables.length > 3 ? '…' : '') + '</p></div></div>' : '') +

    (forcables.length && PERIODES.forcageMotifObligatoire
      ? '<div class="champ" style="margin-top:14px"><label class="f">Motif du forçage (obligatoire)</label>' +
        '<input type="text" id="cl-motif" data-autofocus placeholder="Ex. boutique fermée le 14, relevés sans objet"></div>' : '') +

    '<div class="entete"><h3>Nouvelle période</h3></div>' +
    '<div class="chips" id="cl-type">' + PERIODES.types.map((t, i) =>
      '<button type="button" class="chip' + (t.id === per.type ? ' on' : '') + '" data-t="' + t.id + '">' +
      esc(t.label) + '</button>').join('') + '</div>' +

    '<div class="grid g2" id="cl-dates" style="margin-top:14px">' +
    '<div class="champ"><label class="f">Début</label><input type="date" id="cl-d" value="' + demain + '"></div>' +
    '<div class="champ"><label class="f">Fin</label><input type="date" id="cl-f" value="' +
    finNaturelle(per.type, demain) + '"></div></div>' +
    '<p class="mini" id="cl-info" style="margin-top:10px"></p>' +

    '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
    '<button class="btn menthe" id="cl-ok">Clôturer et ouvrir</button></div>');

  let type = per.type;
  const maj = () => {
    const d = $('#cl-d').value || demain;
    if (type !== 'personnalise') {
      $('#cl-d').value = d;
      $('#cl-f').value = finNaturelle(type, d);
    }
    const n = joursEntre($('#cl-d').value, $('#cl-f').value).length;
    $('#cl-info').textContent = 'La nouvelle fenêtre couvrira ' + n + ' jour(s). ' +
      'Tous les écarts et statistiques se recalculeront dessus.';
    $('#cl-dates').style.opacity = type === 'personnalise' ? '1' : '.85';
  };
  $$('#cl-type [data-t]').forEach(b => b.onclick = () => {
    $$('#cl-type .chip').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); type = b.dataset.t; maj();
  });
  $('#cl-d').onchange = maj;
  $('#cl-f').onchange = maj;
  maj();

  $('#cl-ok').onclick = async () => {
    const motif = $('#cl-motif') ? $('#cl-motif').value.trim() : '';
    if (forcables.length && PERIODES.forcageMotifObligatoire && !motif) {
      toast('Indiquez le motif du forçage', 'erreur');
      return $('#cl-motif').focus();
    }
    const d1 = $('#cl-d').value, d2 = $('#cl-f').value;
    if (!d1 || !d2 || d2 < d1) return toast('Dates de période incohérentes', 'erreur');

    const c = await calculEcart(per);
    const close = Object.assign({}, per, {
      ouverte:false, anticipee:anticipee, par:STATE.user.prenom, jour:today(), at:nowISO(),
      motif:motif, forces:forcables.map(f => f.txt),
      ecartKg:+n2(c.ecart), ecartPct:+n2(c.pct), stockFin:+n2(c.reel), valeur:+n2(c.valeur)
    });
    await DB.push('periodes', close);

    const suivante = { id:uid(), type:type, debut:d1, fin:d2, ouverte:true,
                       precedente:per.id, creee:nowISO(), creeePar:STATE.user.prenom };
    await DB.set('periode:courante', suivante);
    await DB.patch('ecart:' + suivante.id, { debut:{ kg:c.reel }, litrageBL:0, jeteL:0, jeteKg:0, ventes:{} });

    await feed('ok', STATE.user.prenom + ' a clôturé ' + libellePeriode(per) +
      (anticipee ? ' (anticipée)' : '') + ' — écart ' + n1(c.pct) + ' %');
    closeSheet();
    toast('Période clôturée · nouvelle fenêtre ouverte');
    rendre('periodes');
  };
}

/* =============================================================================
   29. HISTORIQUE + BOUCLIER SANITAIRE
   ========================================================================== */
V.histo = async function () {
  const onglet = V.histo._t || 'caisse';
  const defs = {
    caisse:{ l:'Caisse', p:'caisse:' }, temp:{ l:'Frigos', p:'temp:' }, clean:{ l:'Nettoyage', p:'clean:' },
    reassort:{ l:'Réassort', p:'reassort:' }, pertes:{ l:'Pertes', p:'pertes:' },
    pointage:{ l:'Heures', p:'pointage:' }, feedback:{ l:'Retours', p:'feedback' }
  };
  const cles = (await DB.list(defs[onglet].p)).reverse();
  const lignes = [];

  for (const c of cles) {
    const j = c.replace(defs[onglet].p, ''), v = await DB.get(c);
    if (!v) continue;
    if (onglet === 'caisse')
      lignes.push([fmtD(j), eur(num(v.cb) + num(v.esp)), eur(num(v.ecart)), v.par || '—',
                   Math.abs(num(v.ecart)) > SEUILS.caisseJourEur ? 'bad' : 'ok']);
    else if (onglet === 'temp') {
      const n = ENCEINTES.reduce((s, e) => s + (v['m_' + e.id] ? 1 : 0) + (v['s_' + e.id] ? 1 : 0), 0);
      const cr = ENCEINTES.filter(e => ['m','s'].some(m => etatTemp(e, v[m + '_' + e.id]) === 'crit')).length;
      lignes.push([fmtD(j), n + ' / ' + (ENCEINTES.length * 2), cr ? cr + ' critique(s)' : 'Conforme', v.par || '—', cr ? 'bad' : 'ok']);
    }
    else if (onglet === 'clean') {
      const f = Object.keys(v).filter(k => v[k] && v[k].ok).length;
      lignes.push([fmtD(j), f + ' tâche(s)', f ? 'Fait' : 'Rien', '—', f ? 'ok' : 'bad']);
    }
    else if (onglet === 'reassort') {
      const f = Object.keys(v).filter(k => v[k] && v[k].ok).length;
      const r = Object.keys(v).filter(k => v[k] && v[k].rupture).length;
      lignes.push([fmtD(j), f + ' / ' + REASSORT.length, r ? r + ' rupture(s)' : 'Aucune', '—', r ? 'bad' : 'ok']);
    }
    else if (onglet === 'pertes') {
      if (!v.length) continue;
      lignes.push([fmtD(j), v.length + ' ligne(s)', n1(v.reduce((s, w) => s + num(w.litrage), 0)) + ' L', v[0].par || '—', 'warn']);
    }
    else if (onglet === 'pointage') {
      if (!v.length) continue;
      const t = v.reduce((s, x) => s + (x.minutes || 0), 0);
      lignes.push([fmtD(j), v.length + ' session(s)', Math.floor(t / 60) + ' h ' + String(t % 60).padStart(2, '0'),
                   v.map(x => x.prenom).filter((x, i, a) => a.indexOf(x) === i).join(', '), 'ok']);
    }
    else if (onglet === 'feedback') {
      (Array.isArray(v) ? v : []).slice().reverse().forEach(f =>
        lignes.push([fmtD(f.at.slice(0, 10)), f.type, f.texte, f.par, 'warn']));
    }
  }

  $('#vue-actions').innerHTML = '<button class="btn sm" id="pdf">🛡️ Registre sanitaire</button>' +
    '<button class="btn clair sm" id="csv">CSV</button>';

  $('#page').innerHTML =
    '<div class="chips" style="margin-bottom:14px">' + Object.keys(defs).map(k =>
      '<button type="button" class="chip' + (onglet === k ? ' on' : '') + '" data-h="' + k + '">' +
      esc(defs[k].l) + '</button>').join('') + '</div>' +

    carte(entete('🛡️', 'Bouclier sanitaire',
      'Compile températures, nettoyage et lots ouverts en un document présentable à un contrôle.') +
      '<button class="btn ciel bloc xl" id="pdf2">🛡️ Export PDF contrôle sanitaire</button>', 'ciel') +

    (lignes.length
      ? '<div class="dense" style="margin-top:14px"><div class="dense-h">' +
        '<span class="c1">Date</span><span class="c w">Volume</span><span class="c w">Résultat</span><span class="c ww">Par</span></div>' +
        '<div class="dense-scroll">' + lignes.map(l =>
          '<div class="dl"><span class="c1">' + esc(l[0]) + '</span>' +
          '<span class="c w">' + esc(l[1]) + '</span>' +
          '<span class="c w">' + pastille(l[4], String(l[2]).slice(0, 22)) + '</span>' +
          '<span class="c ww">' + esc(l[3]) + '</span></div>').join('') + '</div></div>'
      : vide('📚', 'Aucun enregistrement pour ce registre.'));

  $$('[data-h]').forEach(b => b.onclick = () => { V.histo._t = b.dataset.h; rendre('histo'); });
  $('#pdf').onclick = ouvrirBouclier;
  $('#pdf2').onclick = ouvrirBouclier;
  $('#csv').onclick = () => {
    const csv = ['Date;Volume;Resultat;Par'].concat(lignes.map(l => l.slice(0, 4).join(';'))).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type:'text/csv;charset=utf-8' }));
    a.download = 'pilot-shop-' + onglet + '-' + today() + '.csv';
    a.click();
    toast('Export CSV téléchargé');
  };
};

function ouvrirBouclier() {
  showSheet(
    '<h2 id="sheet-titre">🛡️ Registre pour un contrôle sanitaire</h2>' +
    '<p class="sub">Le document compile les relevés de température, le nettoyage et les lots ouverts, ' +
    'avec les noms et les heures de saisie.</p>' +
    '<div class="chips" id="bp">' +
    [[7, '7 jours'], [30, '30 jours'], [90, '3 mois']].map((x, i) =>
      '<button type="button" class="chip' + (i === 1 ? ' on' : '') + '" data-p="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>' +
    '<div class="alerte info" style="margin-top:16px"><span class="ai">🖨️</span><div><b>Enregistrer en PDF</b>' +
    '<p>Dans la fenêtre d’impression, choisissez « Enregistrer au format PDF » comme destination.</p></div></div>' +
    '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
    '<button class="btn ciel" id="bg">Générer</button></div>');

  let jours = 30;
  $$('#bp [data-p]').forEach(b => b.onclick = () => {
    $$('#bp .chip').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); jours = +b.dataset.p;
  });
  $('#bg').onclick = async () => { closeSheet(); toast('Préparation du registre…'); await genererRegistre(jours); };
}

async function genererRegistre(jours) {
  const fin = today(), debut = addD(fin, -(jours - 1));
  const temps = [], nets = [];
  for (const d of joursEntre(debut, fin)) {
    const t = await DB.get('temp:' + d, null);
    if (t) temps.push({ d:d, t:t });
    const c = await DB.get('clean:' + d, null);
    if (c) {
      const ok = Object.keys(c).filter(k => c[k] && c[k].ok);
      if (ok.length) nets.push({ d:d, n:ok.length, total:tachesDuJour(d).length,
        par:ok.map(k => c[k].par).filter((v, i, a) => a.indexOf(v) === i).join(', ') });
    }
  }
  const fifo = await calculFIFO(monthKey(fin));
  const per = await periodeCourante();

  $('#printview').innerHTML =
    '<div class="pv-h"><h1>Registre sanitaire — ' + esc(APP.nom) + '</h1>' +
    '<div>' + esc(APP.site) + ' · du ' + fmtD(debut) + ' au ' + fmtD(fin) +
    ' · période de gestion : ' + esc(libellePeriode(per)) +
    '<br>Édité le ' + new Date().toLocaleString(APP.locale) + ' par ' + esc(STATE.user.prenom) + '</div></div>' +

    '<div class="pv-s">1. Relevés de température des enceintes froides</div>' +
    (temps.length
      ? '<table><thead><tr><th>Date</th>' + ENCEINTES.map(e => '<th>' + esc(e.nom) + '</th>').join('') +
        '<th>Action corrective</th></tr></thead><tbody>' +
        temps.map(L => '<tr><td>' + L.d.split('-').reverse().join('/') + '</td>' +
          ENCEINTES.map(e => {
            const m = L.t['m_' + e.id], s = L.t['s_' + e.id];
            const bad = etatTemp(e, m) === 'crit' || etatTemp(e, s) === 'crit';
            return '<td' + (bad ? ' style="font-weight:700"' : '') + '>' +
              (m === undefined || m === '' ? '—' : m) + ' / ' + (s === undefined || s === '' ? '—' : s) + '</td>';
          }).join('') + '<td>' + esc(L.t.obs || '') + '</td></tr>').join('') + '</tbody></table>' +
        '<div style="font-size:9.5px">Valeurs en °C, matin / soir. Les dépassements de limite critique sont en gras. ' +
        'Cibles : ' + ENCEINTES.map(e => e.nom + ' ' + e.cible).join(' · ') + '.</div>'
      : '<div>Aucun relevé enregistré sur la période.</div>') +

    '<div class="pv-s">2. Nettoyage et désinfection</div>' +
    (nets.length
      ? '<table><thead><tr><th>Date</th><th>Jour</th><th>Postes validés</th><th>Prévus</th><th>Par</th></tr></thead><tbody>' +
        nets.map(x => '<tr><td>' + x.d.split('-').reverse().join('/') + '</td><td>' + nomJour(x.d) + '</td>' +
          '<td>' + x.n + '</td><td>' + x.total + '</td><td>' + esc(x.par) + '</td></tr>').join('') + '</tbody></table>' +
        '<div style="font-size:9.5px">Plan de nettoyage : ' +
        NETTOYAGE.asynchrones.map(a => a.nom + ' (' + (a.type === 'jours-fixes'
          ? a.jours.map(j => JOURS_SEMAINE[j].toLowerCase()).join(', ')
          : 'tous les ' + a.intervalleJours + ' jours') + ')').join(' · ') + '.</div>'
      : '<div>Aucun enregistrement de nettoyage sur la période.</div>') +

    '<div class="pv-s">3. Traçabilité des lots ouverts</div>' +
    (fifo.length
      ? '<table><thead><tr><th>Produit</th><th>Lot</th><th>Ouvert le</th><th>Durée de vie</th><th>Limite</th><th>État</th><th>Par</th></tr></thead><tbody>' +
        fifo.map(f => '<tr><td>' + esc(f.nom) + '</td><td>' + esc(f.lot) + '</td>' +
          '<td>' + f.ouv.split('-').reverse().join('/') + '</td>' +
          '<td>' + (f.heures < 72 ? f.heures + ' h' : Math.round(f.heures / 24) + ' j') + '</td>' +
          '<td>' + f.limite.split('-').reverse().join('/') + '</td>' +
          '<td>' + (f.c === 'rouge' ? 'DÉPASSÉE' : f.c === 'orange' ? 'À consommer' : 'Conforme') + '</td>' +
          '<td>' + esc(f.par || '—') + '</td></tr>').join('') + '</tbody></table>'
      : '<div>Aucun lot ouvert enregistré ce mois.</div>') +

    '<div class="sign">Document généré à partir de saisies horodatées et nominatives du système ' + esc(APP.nom) +
    '. Chaque validation est associée au compte de la personne connectée.<br><br>' +
    'Nom du responsable : ____________________  Signature : ____________________  Date : ____ / ____ / ________</div>';

  await feed('ok', STATE.user.prenom + ' a édité le registre sanitaire sur ' + jours + ' jours');
  setTimeout(() => window.print(), 200);
}

/* =============================================================================
   30. ÉQUIPE
   ========================================================================== */
V.equipe = async function () {
  const cles = (await DB.list('pointage:')).reverse().slice(0, 30);
  const parPersonne = {};
  EQUIPE.forEach(e => parPersonne[e.id] = { e:e, min:0, jours:0, sessions:[] });

  for (const c of cles) {
    const j = c.replace('pointage:', '');
    (await DB.get(c, [])).forEach(s => {
      const p = parPersonne[s.employe];
      if (!p) return;
      p.min += s.minutes || 0;
      p.jours++;
      p.sessions.push(Object.assign({ jour:j }, s));
    });
  }

  const feedTot = {};
  for (let i = 0; i < 14; i++) {
    (await DB.get('feed:' + addD(today(), -i), [])).forEach(x => {
      if (x.id) feedTot[x.id] = (feedTot[x.id] || 0) + 1;
    });
  }

  $('#page').innerHTML =
    '<div class="stack">' + EQUIPE.map(e => {
      const p = parPersonne[e.id];
      const h = Math.floor(p.min / 60) + ' h ' + String(p.min % 60).padStart(2, '0');
      const enCours = p.sessions.filter(s => !s.fin && s.jour === today())[0];
      return carte('<div class="rang">' + avatar(e, 'av') +
        '<div style="flex:1;min-width:0"><b>' + esc(e.prenom) + '</b>' +
        '<div class="mini">' + ROLES[e.role].label + ' · ' + p.jours + ' journée(s) sur 30' +
        (enCours ? ' · en service depuis ' + heure(enCours.debut) : '') + '</div></div>' +
        '<div style="text-align:right"><b class="num">' + h + '</b>' +
        '<div class="mini">' + (feedTot[e.id] || 0) + ' action(s) / 14 j</div></div></div>',
        enCours ? 'menthe' : '');
    }).join('') + '</div>' +

    carte(entete('ℹ️', 'Ce que mesure cette page',
      'Le nombre d’actions compte les validations tracées, pas la qualité du travail. ' +
      'Une personne qui saisit peu peut travailler autant : à croiser avec le terrain avant d’en tirer une conclusion.'), 'plat');
};

/* =============================================================================
   31. RÉGLAGES
   ========================================================================== */
V.reglages = async function () {
  const per = await periodeCourante();
  const fb = await DB.get('feedback', []);
  const seuils = await DB.get('seuils', SEUILS);

  $('#page').innerHTML =
    carte(entete('⚙️', 'Seuils d’alerte', 'Ces valeurs déclenchent les alertes du tableau de bord.') +
      '<div class="grid g2">' +
      '<div class="champ"><label class="f">Écart glace toléré (±%)</label>' +
      '<input type="number" step="0.5" id="s1" value="' + seuils.ecartGlacePct + '"></div>' +
      '<div class="champ"><label class="f">Écart caisse — jour (€)</label>' +
      '<input type="number" step="1" id="s2" value="' + seuils.caisseJourEur + '"></div>' +
      '<div class="champ"><label class="f">Écart caisse — cumul (€)</label>' +
      '<input type="number" step="1" id="s3" value="' + seuils.caisseCumulEur + '"></div>' +
      '<div class="champ"><label class="f">Jours sans nettoyage tolérés</label>' +
      '<input type="number" step="1" id="s4" value="' + seuils.joursSansNettoyage + '"></div></div>' +
      '<button class="btn menthe bloc" id="sv" style="margin-top:16px">Enregistrer</button>', 'solide') +

    carte(entete('📅', 'Période en cours', libellePeriode(per)) +
      '<button class="btn clair bloc" data-go="periodes">Gérer les clôtures</button>') +

    (fb.length ? '<div class="entete"><h3>Retours de l’équipe</h3><span class="pousse mini num">' + fb.length + '</span></div>' +
      '<div class="dense"><div class="dense-h"><span class="c1">Message</span>' +
      '<span class="c w">Vue</span><span class="c ww">Par</span></div><div class="dense-scroll">' +
      fb.slice().reverse().map(f =>
        '<div class="dl"><span class="c1">' + esc(f.texte) + '</span>' +
        '<span class="c w">' + esc((PAGES[f.vue] || { titre:f.vue }).titre) + '</span>' +
        '<span class="c ww">' + esc(f.par) + ' ' + fmtDC(f.at.slice(0, 10)) + '</span></div>').join('') +
      '</div></div>' : '') +

    carte(entete('🗄️', 'Données',
        (DB.configure ? 'Supabase · ' + APP.site : 'Cet appareil uniquement') + ' · ' + APP.version) +

      '<div id="sync-status" class="alerte info" style="margin-bottom:14px">' +
      '<span class="ai" id="sync-ic">⏳</span><div><b id="sync-tx">Vérification…</b>' +
      '<p id="sync-sub"></p></div></div>' +

      '<p class="mini">' + (DB.configure
        ? 'Les saisies partent sur Supabase dès qu’il y a du réseau. Sans réseau, elles sont gardées ' +
          'sur l’iPad et repartent toutes seules ensuite : la chambre froide ne fait rien perdre.'
        : 'Aucune clé Supabase n’est configurée : tout reste sur cet appareil et disparaîtrait avec le cache. ' +
          'Renseignez env.js pour activer la sauvegarde en ligne.') + '</p>' +

      '<button class="btn clair bloc" id="sync-now" style="margin-top:14px">Forcer la synchronisation</button>' +
      '<button class="btn clair bloc" id="ex" style="margin-top:8px">Exporter toutes les données</button>' +
      '<button class="btn fantome bloc" id="rz" style="margin-top:8px">Réinitialiser cet appareil</button>', 'plat');

  /* --- Indicateur de synchronisation, rafraîchi chaque seconde --- */
  if (V.reglages._t) { clearInterval(V.reglages._t); V.reglages._t = null; }

  const majSync = () => {
    const box = $('#sync-status');
    if (!box) { clearInterval(V.reglages._t); V.reglages._t = null; return; }

    const ic = $('#sync-ic'), tx = $('#sync-tx'), sub = $('#sync-sub'), btn = $('#sync-now');
    let classe, icone, texte, detail, couleur;

    if (!DB.configure) {
      classe = 'warn'; icone = '⚪'; couleur = 'var(--brume)';
      texte = 'Sauvegarde en ligne inactive';
      detail = 'Les données restent sur cet iPad. Renseignez env.js pour activer Supabase.';
    } else if (!STATE.enLigne) {
      classe = 'bad'; icone = '🔴'; couleur = 'var(--corail-d)';
      texte = 'Hors-ligne — En attente de réseau';
      detail = STATE.fileAttente
        ? STATE.fileAttente + ' saisie(s) gardée(s) sur l’iPad, elles partiront au retour du réseau.'
        : 'Vos saisies continuent d’être enregistrées sur l’iPad.';
    } else if (STATE.fileAttente > 0) {
      classe = 'warn'; icone = '🟠'; couleur = 'var(--ambre-d)';
      texte = STATE.fileAttente + ' saisie(s) en attente d’envoi';
      detail = 'Laissez l’application ouverte le temps de l’envoi.';
    } else {
      classe = 'ok'; icone = '🟢'; couleur = 'var(--menthe-d)';
      texte = 'Toutes les données sont synchronisées sur le Cloud';
      detail = derniereSync
        ? 'Dernier envoi réussi à ' + heure(derniereSync) + '.'
        : 'Rien en attente.';
    }

    box.className = 'alerte ' + classe;
    ic.textContent = icone;
    tx.textContent = texte;
    tx.style.color = couleur;
    sub.textContent = detail;
    if (btn) btn.disabled = !DB.configure || !STATE.enLigne || STATE.fileAttente === 0;
  };

  majSync();
  V.reglages._t = setInterval(majSync, 1000);

  $('#sync-now').onclick = async () => {
    if (!STATE.enLigne) return toast('Pas de réseau pour l’instant', 'erreur');
    toast('Envoi en cours…');
    await journaliserSync();
    majSync();
  };

  $('#sv').onclick = async () => {
    const o = { ecartGlacePct:num($('#s1').value) || 3, caisseJourEur:num($('#s2').value) || 10,
                caisseCumulEur:num($('#s3').value) || 50, joursSansNettoyage:num($('#s4').value) || 2 };
    Object.assign(SEUILS, o);
    await DB.set('seuils', SEUILS);
    toast('Seuils enregistrés');
  };

  $('#ex').onclick = async () => {
    const dump = {};
    for (const k of await DB.list('')) dump[k] = await DB.get(k);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(dump, null, 2)], { type:'application/json' }));
    a.download = 'pilot-shop-sauvegarde-' + today() + '.json';
    a.click();
    toast('Sauvegarde téléchargée');
  };

  $('#rz').onclick = () => confirmer('Effacer toutes les données ?',
    'Tous les registres de cet appareil seront supprimés définitivement. Exportez d’abord la sauvegarde.',
    'Tout effacer', async () => {
      for (const k of await DB.list('')) await DB.del(k);
      location.reload();
    });
};

/* =============================================================================
   32. IMPORT DE L'EXPORT DE CAISSE
   Trois lectures possibles, de la plus fiable à la moins fiable :
     1. une colonne de poids en kg  → somme directe
     2. SKU + quantité             → grammage du catalogue
     3. libellé produit + quantité → rapprochement par nom
   Rien n'est enregistré sans que le manager ait vu le détail à l'écran.
   ========================================================================== */

/* À déplacer dans config.js quand le catalogue de Chamonix sera figé.
   Grammes de glace par unité vendue, par SKU. */
const GRAMMAGES = (typeof CATALOGUE_SKU !== 'undefined') ? CATALOGUE_SKU : {
  '11111':81,  '11112':133, '11113':163, '11114':221, '11115':275,
  '11121':69,  '11122':114, '11123':153, '11124':224, '11127':153,
  '11131':112, '11132':149, '11133':208,
  '15111':470, '15112':930,
  '12115':160, '12121':160, '12122':160, '12123':160, '12126':160,
  '14111':160, '14121':160, '14127':160, '14131':160, '14132':200, '14133':160,
  '13111':25,  '13112':50,  '13113':75,  '13114':100, '13116':150, '13141':60, '17010':60,
  '41171':80,  '41173':80,  '41175':80,  '41116':100,
  '41121':50,  '41122':50,  '41123':50,  '41126':50,  '41133':50, '41134':50, '41137':50, '41313':50,
  '31132':50,  '31134':50,  '31312':50,  '31313':50,  '31314':50,
  '71111':50
};

function lireExportCaisse(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();

    fr.onerror = () => reject(new Error('Fichier illisible'));

    fr.onload = ev => {
      let wb;
      try { wb = XLSX.read(new Uint8Array(ev.target.result), { type:'array' }); }
      catch (e) { return reject(new Error('Ce fichier n’est pas un classeur Excel valide')); }

      const feuille = wb.Sheets[wb.SheetNames[0]];
      if (!feuille) return reject(new Error('Classeur vide'));

      /* --- Lecture 1 : une cellule « Total Kg » quelque part dans la feuille --- */
      const brut = XLSX.utils.sheet_to_json(feuille, { header:1, defval:'' });
      for (let i = 0; i < brut.length; i++) {
        for (let j = 0; j < brut[i].length; j++) {
          const cel = String(brut[i][j]).toLowerCase();
          if (!/total\s*(kg|poids)|poids\s*total/.test(cel)) continue;
          const voisins = [brut[i][j + 1], brut[i][j + 2], (brut[i + 1] || [])[j]];
          const v = voisins.map(num).filter(x => x > 0)[0];
          if (v) return resolve({ kg:v, lignes:1, methode:'Cellule « Total Kg » du fichier',
                                  fiable:true, detail:[['Total lu dans le fichier', n1(v) + ' kg']], inconnus:[] });
        }
      }

      /* --- Lecture 2 et 3 : par colonnes --- */
      const rows = XLSX.utils.sheet_to_json(feuille, { defval:'' });
      if (!rows.length) return reject(new Error('Aucune ligne de vente dans le fichier'));

      const cols = Object.keys(rows[0]);
      const trouve = re => cols.filter(c => re.test(c))[0];
      const cPoids = trouve(/poids|\bkg\b|masse/i);
      const cQte   = trouve(/qte|qté|quantit|nombre|nb\.?$/i);
      const cSku   = trouve(/\bsku\b|code|référence|reference|\bref\b/i);
      const cNom   = trouve(/produit|libell|désignation|designation|article|nom/i);

      /* Colonne de poids : la plus sûre */
      if (cPoids) {
        let kg = 0, n = 0;
        rows.forEach(r => { const v = num(r[cPoids]); if (v > 0) { kg += v; n++; } });
        if (kg > 0) return resolve({ kg:kg, lignes:n, methode:'Colonne « ' + cPoids + ' »',
                                     fiable:true, detail:[[n + ' lignes additionnées', n1(kg) + ' kg']], inconnus:[] });
      }

      if (!cQte) {
        return reject(new Error('Aucune colonne de quantité trouvée. Colonnes lues : ' + cols.slice(0, 6).join(', ')));
      }

      /* SKU + quantité × grammage */
      if (cSku) {
        let g = 0, n = 0;
        const inconnus = {}, parProduit = {};
        rows.forEach(r => {
          const sku = String(r[cSku]).trim();
          const q = num(r[cQte]);
          if (!sku || q <= 0) return;
          const gr = GRAMMAGES[sku];
          if (gr === undefined) { inconnus[sku] = (inconnus[sku] || 0) + q; return; }
          if (gr === 0) return;                       /* produit sans glace */
          g += gr * q; n++;
          const lib = cNom ? String(r[cNom]).trim() : sku;
          parProduit[lib] = (parProduit[lib] || 0) + gr * q / 1000;
        });
        if (g > 0) {
          const top = Object.keys(parProduit).sort((a, b) => parProduit[b] - parProduit[a]).slice(0, 8)
            .map(k => [k, n1(parProduit[k]) + ' kg']);
          return resolve({
            kg:g / 1000, lignes:n, methode:'SKU × grammage du catalogue', fiable:true,
            detail:top, inconnus:Object.keys(inconnus).map(s => s + ' (' + inconnus[s] + ')')
          });
        }
        if (Object.keys(inconnus).length) {
          return reject(new Error('Aucun SKU du fichier n’est rattaché à un grammage. Complétez le catalogue avant d’importer.'));
        }
      }

      /* Libellé + quantité, rapprochement par nom de parfum */
      if (cNom) {
        let g = 0, n = 0;
        const parProduit = {};
        rows.forEach(r => {
          const nom = String(r[cNom]).toLowerCase();
          const q = num(r[cQte]);
          if (!nom || q <= 0) return;
          const p = PARFUMS.filter(x => nom.indexOf(x.toLowerCase().split(' ')[0]) >= 0)[0];
          if (!p) return;
          const gr = 150;                             /* boule moyenne, à confirmer */
          g += gr * q; n++;
          parProduit[p] = (parProduit[p] || 0) + gr * q / 1000;
        });
        if (g > 0) {
          return resolve({
            kg:g / 1000, lignes:n, methode:'Rapprochement par nom de parfum, 150 g par unité',
            fiable:false,
            detail:Object.keys(parProduit).slice(0, 8).map(k => [k, n1(parProduit[k]) + ' kg']),
            inconnus:[]
          });
        }
      }

      reject(new Error('Format non reconnu. Il faut une colonne de poids, ou des SKU, ou des noms de parfums avec les quantités.'));
    };

    fr.readAsArrayBuffer(file);
  });
}

function confirmerImport(per, fichier, r) {
  showSheet(
    '<h2 id="sheet-titre">Ventes lues dans le fichier</h2>' +
    '<p class="sub">' + esc(fichier) + ' · ' + esc(r.methode) + '</p>' +

    (r.fiable ? '' :
      '<div class="alerte warn"><span class="ai">●</span><div><b>Lecture approximative</b>' +
      '<p>Le fichier n’a ni colonne de poids ni SKU reconnus. Le calcul repose sur une moyenne de 150 g par unité : ' +
      'l’écart qui en découlera sera indicatif, pas exploitable pour trancher.</p></div></div>') +

    '<div class="grid g2" style="margin:14px 0">' +
    kpi('Poids vendu', n1(r.kg) + '<span class="u">kg</span>', r.fiable ? 'ok' : 'warn', r.lignes + ' ligne(s)') +
    kpi('Valeur', eur(r.kg * FOURNISSEUR.prixMoyenKg), '', 'à ' + n2(FOURNISSEUR.prixMoyenKg) + ' €/kg') + '</div>' +

    (r.detail.length
      ? '<div class="dense"><div class="dense-h"><span class="c1">Détail</span><span class="c w">Poids</span></div>' +
        '<div class="dense-scroll">' + r.detail.map(d =>
          '<div class="dl"><span class="c1">' + esc(d[0]) + '</span>' +
          '<span class="c w num">' + esc(d[1]) + '</span></div>').join('') + '</div></div>'
      : '') +

    (r.inconnus.length
      ? '<div class="alerte warn" style="margin-top:14px"><span class="ai">⚠️</span>' +
        '<div><b>' + r.inconnus.length + ' SKU sans grammage</b><p>' +
        esc(r.inconnus.slice(0, 8).join(', ')) + (r.inconnus.length > 8 ? '…' : '') +
        '. Leur glace n’est pas comptée dans les ventes, donc elle apparaîtra comme un manque.</p></div></div>'
      : '') +

    '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
    '<button class="btn menthe" id="imp-ok">Enregistrer ' + n1(r.kg) + ' kg</button></div>');

  $('#imp-ok').onclick = async () => {
    const e = await DB.get('ecart:' + per.id, {});
    e.ventes = { total:+n2(r.kg) };
    e.venteSource = r.methode + (r.fiable ? '' : ' · approximatif');
    e.imports = (e.imports || []).concat([{
      fichier:fichier, kg:+n2(r.kg), lignes:r.lignes, methode:r.methode,
      fiable:r.fiable, inconnus:r.inconnus.length, par:STATE.user.prenom, at:nowISO()
    }]);
    await DB.set('ecart:' + per.id, e);
    await feed('ok', STATE.user.prenom + ' a importé les ventes : ' + n1(r.kg) + ' kg (' + r.lignes + ' lignes)');
    closeSheet();
    toast(n1(r.kg) + ' kg enregistrés');
    rendre('ecarts');
  };
}
