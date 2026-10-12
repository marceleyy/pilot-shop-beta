/* =============================================================================
   PILOT-SHOP — franchise.js
   « Mes boutiques » : un franchisé compare ses boutiques côte à côte.

   La base ne laisse un compte voir que SA boutique (RLS sur le site inscrit
   dans le jeton). Pour comparer, on ne touche pas à cette barrière :
   - chaque boutique calcule ses propres indicateurs, avec ses propres
     données, et les range sous la clé « franchise:indicateurs » ;
   - le manager lie à son appareil les autres boutiques, avec leurs
     identifiants (une seule fois), et l'appareil lit cette seule ligne
     dans chacune.
   Un compte ne lit donc jamais les registres d'une autre boutique : seulement
   son résumé, et seulement si l'on a ses identifiants.

   Les jetons des boutiques liées restent sur l'appareil, sous le même préfixe
   que le reste : « Changer de boutique » et la remise à zéro les effacent.

   Chargé après guide.js.
   ============================================================================= */

'use strict';

PAGES.boutiques = { titre:'Mes boutiques', sous:'Vos boutiques comparées côte à côte' };
if (MENU_PLUS.manager.indexOf('boutiques') < 0) MENU_PLUS.manager.unshift('boutiques');

const FRANCHISE = {
  cle: 'franchise:indicateurs',
  cleLiees: OFFLINE.storeLocal + ':franchise-liees',
  jours: 7,                       // fenêtre glissante des indicateurs
  rafraichirMs: 3600000           // au plus une mise à jour par heure, hors écran « Mes boutiques »
};

/* -----------------------------------------------------------------------------
   INDICATEURS DE LA BOUTIQUE COURANTE
   Les mêmes règles que la tour de contrôle : etatTemp pour les frigos,
   etatNettoyage pour les tâches, litresPerte pour le jeté.
   -------------------------------------------------------------------------- */
function jourSemaineIso(jour) {
  const p = jour.split('-');
  return new Date(+p[0], +p[1] - 1, +p[2]).getDay() || 7;
}

async function calculerIndicateurs() {
  const auj = today();
  const jours = [];
  for (let i = 0; i < FRANCHISE.jours; i++) jours.push(addD(auj, -i));
  const ouverts = HORAIRES.joursOuverture || [1, 2, 3, 4, 5, 6, 7];
  /* Rien n'est « en retard » avant le début de la première période : une
     boutique ouverte hier n'a pas manqué les relevés de la semaine dernière. */
  const per = await DB.get('periode:courante', null).catch(() => null);
  const depart = per && per.debut ? per.debut : auj;

  /* Une journée : lectures en parallèle, sinon 7 × 4 allers-retours en file. */
  const parJour = await Promise.all(jours.map(async d => {
    const [pertes, temp, net] = await Promise.all([
      DB.get('pertes:' + d, []).catch(() => []),
      DB.get('temp:' + d, {}).catch(() => ({})),
      (d < auj && d >= depart ? etatNettoyage(d) : Promise.resolve(null)).catch(() => null)
    ]);
    const t = temp || {};
    let crit = 0, relevesManquants = 0;
    ENCEINTES.forEach(en => ['m', 's'].forEach(mo => { if (etatTemp(en, t[mo + '_' + en.id]) === 'crit') crit++; }));
    /* En retard : un jour d'ouverture passé, relevé non validé ou tâche non faite. */
    const aSuivre = d < auj && d >= depart;
    if (aSuivre && ouverts.indexOf(jourSemaineIso(d)) >= 0) {
      const v = t.valide || {};
      relevesManquants = (v.m ? 0 : 1) + (v.s ? 0 : 1);
    }
    const litres = (Array.isArray(pertes) ? pertes : []).reduce((s, w) => s + litresPerte(w), 0);
    return { crit:crit, relevesManquants:relevesManquants,
             tachesManquantes:net && net.total ? Math.max(0, net.total - net.faits) : 0, litres:litres };
  }));

  const somme = k => parJour.reduce((s, x) => s + x[k], 0);
  const litres = somme('litres');

  /* Dernier calcul d'écart clôturé (calcul.js). */
  let ecart = null;
  try {
    const cles = (await DB.list('calcul:')).filter(k => /^calcul:\d{4}-\d{2}-\d{2}:/.test(k)).sort().reverse();
    for (const c of cles.slice(0, 8)) {
      const r = await DB.get(c, null);
      if (r && r.statut === 'clos' && r.resultat && !r.resultat.incoherent) {
        ecart = { pct:+r.resultat.pct, fin:r.fin || null };
        break;
      }
    }
  } catch (e) { /* pas de calcul */ }

  const [preaudit, anomalies, ruptures] = await Promise.all([
    DB.get('preaudit:dernier', null).catch(() => null),
    DB.get('anomalies', []).catch(() => []),
    DB.get('ruptures', []).catch(() => [])
  ]);

  return {
    site: APP.site, at: nowISO(), jours: FRANCHISE.jours,
    ecartPct: ecart ? ecart.pct : null, ecartFin: ecart ? ecart.fin : null,
    pertesL: +litres.toFixed(2),
    pertesEur: +(litres * FOURNISSEUR.poidsMoyenLitre * FOURNISSEUR.prixMoyenKg).toFixed(2),
    frigosCrit: somme('crit'),
    relevesManquants: somme('relevesManquants'),
    tachesManquantes: somme('tachesManquantes'),
    preaudit: preaudit && typeof preaudit.score === 'number'
      ? { score:preaudit.score, jour:preaudit.jour || null } : null,
    anomalies: (Array.isArray(anomalies) ? anomalies : []).filter(a => !a.resolue).length,
    ruptures: (Array.isArray(ruptures) ? ruptures : []).filter(r => !r.traite).length
  };
}

/* Calcule et range le résumé. Hors ligne, rien n'est écrit : un résumé fait
   sur une copie locale incomplète passerait pour la vérité. */
let _dernierResume = 0;
async function publierIndicateurs(force) {
  if (!STATE.user || !STATE.enLigne || !DB.configure) return null;
  if (!force && Date.now() - _dernierResume < FRANCHISE.rafraichirMs) return null;
  _dernierResume = Date.now();
  try {
    const r = await calculerIndicateurs();
    await DB.set(FRANCHISE.cle, r);
    return r;
  } catch (e) { return null; }
}

/* Les boutiques liées lisent ce résumé : on le tient à jour quand un manager
   ouvre la tour de contrôle, après son affichage, sans la ralentir. */
const V_controle_avantFranchise = V.controle;
V.controle = async function () {
  await V_controle_avantFranchise.apply(this, arguments);
  if (STATE.user && STATE.user.role === 'manager') setTimeout(() => publierIndicateurs(false), 4000);
};

/* -----------------------------------------------------------------------------
   BOUTIQUES LIÉES À CET APPAREIL
   [{ site, compte, access_token, refresh_token, expires_at, expire }]
   -------------------------------------------------------------------------- */
function boutiquesLiees() {
  try {
    const l = JSON.parse(localStorage.getItem(FRANCHISE.cleLiees) || '[]');
    return Array.isArray(l) ? l.filter(b => b && b.site && b.refresh_token) : [];
  } catch (e) { return []; }
}
function enregistrerLiees(l) {
  try { localStorage.setItem(FRANCHISE.cleLiees, JSON.stringify(l)); } catch (e) {}
}
function majLiee(site, modif) {
  enregistrerLiees(boutiquesLiees().map(b => b.site === site ? Object.assign({}, b, modif) : b));
}

function sessionDepuis(d) {
  return {
    access_token: d.access_token, refresh_token: d.refresh_token,
    expires_at: Date.now() + ((d.expires_in || 3600) * 1000),
    site: d.user && d.user.app_metadata ? d.user.app_metadata.site : null,
    compte: d.user ? d.user.email : null, expire: false
  };
}

async function lierBoutique(email, mdp) {
  const d = await appelAuth('/token?grant_type=password', { email:email, password:mdp });
  const s = sessionDepuis(d);
  if (!s.site) throw new Error('Ce compte n’a pas de boutique attribuée.');
  if (s.site === APP.site) throw new Error('C’est la boutique de cet appareil : elle est déjà comparée.');
  const l = boutiquesLiees().filter(b => b.site !== s.site);
  l.push(s);
  enregistrerLiees(l);
  return s;
}

/* Jeton valide d'une boutique liée, renouvelé si besoin. Le jeton de
   renouvellement change à chaque usage : on garde toujours le dernier. */
async function jetonLiee(b) {
  if (b.access_token && b.expires_at - Date.now() > 300000) return b.access_token;
  try {
    const d = await appelAuth('/token?grant_type=refresh_token', { refresh_token:b.refresh_token });
    const s = sessionDepuis(d);
    majLiee(b.site, s);
    return s.access_token;
  } catch (e) {
    if (e.statut === 400 || e.statut === 401) majLiee(b.site, { expire:true });
    throw e;
  }
}

async function resumeLiee(b) {
  const jeton = await jetonLiee(b);
  const r = await fetch(SUPABASE.url + '/rest/v1/reglages?id=eq.' + encodeURIComponent(FRANCHISE.cle) +
    '&select=data&limit=1', {
    headers: { apikey: SUPABASE.anonKey, Authorization: 'Bearer ' + jeton },
    signal: signalDelai()
  });
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.statut = r.status; throw e; }
  const l = await r.json();
  return (l && l.length) ? l[0].data : null;
}

/* -----------------------------------------------------------------------------
   VUE — MES BOUTIQUES
   -------------------------------------------------------------------------- */
const fmtEur = v => (Number(v) || 0).toLocaleString('fr-FR', { style:'currency', currency:'EUR', maximumFractionDigits:0 });

function depuis(iso) {
  if (!iso) return '';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 2) return 'à l’instant';
  if (min < 60) return 'il y a ' + min + ' min';
  const h = Math.round(min / 60);
  if (h < 24) return 'il y a ' + h + ' h';
  const j = Math.round(h / 24);
  return 'il y a ' + j + ' ' + accord(j, 'jour');
}

/* Une ligne d'indicateur : libellé, valeur, et la couleur qui dit s'il faut agir. */
const LIGNES_FRANCHISE = [
  { id:'ecart', libelle:'Écart glace', aide:'dernier calcul clôturé',
    val:r => r.ecartPct === null || r.ecartPct === undefined ? null
      : (Math.abs(r.ecartPct) < 0.05 ? '' : r.ecartPct > 0 ? '−' : '+') + n1(Math.abs(r.ecartPct)) + ' %',
    c:r => r.ecartPct === null || r.ecartPct === undefined ? 'n' : etatEcart(r.ecartPct).c },
  { id:'pertes', libelle:'Pertes glace', aide:'7 derniers jours',
    val:r => fmtEur(r.pertesEur) + ' · ' + n1(r.pertesL) + ' L',
    c:r => r.pertesEur > 50 ? 'bad' : r.pertesEur > 15 ? 'warn' : 'ok' },
  { id:'frigos', libelle:'Frigos hors norme', aide:'relevés critiques, 7 jours',
    val:r => String(r.frigosCrit), c:r => r.frigosCrit ? 'bad' : 'ok' },
  { id:'retard', libelle:'Tâches en retard', aide:'relevés non validés et nettoyage non fait',
    val:r => String((r.relevesManquants || 0) + (r.tachesManquantes || 0)),
    c:r => (r.relevesManquants || 0) + (r.tachesManquantes || 0) > 3 ? 'bad'
         : (r.relevesManquants || 0) + (r.tachesManquantes || 0) ? 'warn' : 'ok' },
  { id:'preaudit', libelle:'Score pré-audit', aide:'dernier pré-audit',
    val:r => r.preaudit ? Math.round(r.preaudit.score) + ' / 100' : null,
    c:r => !r.preaudit ? 'n' : r.preaudit.score >= 80 ? 'ok' : r.preaudit.score >= 60 ? 'warn' : 'bad' },
  { id:'signal', libelle:'Signalements ouverts', aide:'anomalies et ruptures',
    val:r => String((r.anomalies || 0) + (r.ruptures || 0)),
    c:r => (r.anomalies || 0) + (r.ruptures || 0) ? 'warn' : 'ok' }
];

V.boutiques = async function () {
  if (!STATE.user || STATE.user.role !== 'manager') {
    $('#page').innerHTML = carte(entete('', 'Réservé au manager', ''));
    return;
  }
  $('#vue-actions').innerHTML = '<button class="btn menthe sm" id="fr-ajout">+ Ajouter</button>';
  $('#fr-ajout').onclick = feuilleLierBoutique;

  const liees = boutiquesLiees();
  /* La boutique de l'appareil : calcul frais. Les autres : leur dernier résumé. */
  const ici = STATE.enLigne && DB.configure
    ? (await publierIndicateurs(true)) || await calculerIndicateurs()
    : await calculerIndicateurs();
  if (STATE.view !== 'boutiques') return;
  const autres = await Promise.all(liees.map(b => resumeLiee(b)
    .then(r => ({ b:b, r:r }), e => ({ b:b, erreur:e }))));
  if (STATE.view !== 'boutiques') return;

  const colonnes = [{ site:APP.site, r:ici, ici:true }].concat(autres.map(x => ({
    site:x.b.site, r:x.r, erreur:x.erreur, expire:boutiquesLiees().some(b => b.site === x.b.site && b.expire)
  })));

  const cellule = (col, l) => {
    if (!col.r) return '<span class="mini">—</span>';
    const v = l.val(col.r);
    return v === null ? '<span class="pill n">—</span>' : pastille(l.c(col.r), v);
  };

  const etatColonne = col => col.ici ? 'Cet appareil · à l’instant'
    : col.expire ? 'Connexion expirée'
    : col.erreur ? (STATE.enLigne ? 'Injoignable' : 'Hors ligne')
    : !col.r ? 'Pas encore de chiffres'
    : 'Mis à jour ' + depuis(col.r.at);

  $('#page').innerHTML =
    carte(entete('', 'Vos boutiques côte à côte',
      liees.length ? 'Les chiffres de chaque boutique sont calculés par la boutique elle-même, sur les 7 derniers jours.'
        : 'Ajoutez votre autre boutique avec ses identifiants pour la comparer à celle-ci.') +
      (liees.length ? '' :
        '<button class="btn menthe bloc" id="fr-ajout2" style="margin-top:12px">Ajouter une boutique</button>'), 'solide') +

    '<div style="overflow-x:auto;margin-top:14px">' +
    '<table class="fr-table" style="width:100%;border-collapse:collapse;min-width:' + (180 + colonnes.length * 140) + 'px">' +
    '<thead><tr><th scope="col" style="text-align:left;padding:10px 8px"></th>' +
    colonnes.map(col => '<th scope="col" style="text-align:left;padding:10px 8px;vertical-align:bottom">' +
      '<b>' + esc(col.site) + '</b><span class="mini" style="display:block;font-weight:400">' +
      esc(etatColonne(col)) + '</span></th>').join('') + '</tr></thead>' +
    '<tbody>' + LIGNES_FRANCHISE.map(l =>
      '<tr style="border-top:.5px solid rgba(15,32,39,.1)">' +
      '<th scope="row" style="text-align:left;padding:10px 8px;font-weight:500">' + esc(l.libelle) +
      '<span class="mini" style="display:block;font-weight:400">' + esc(l.aide) + '</span></th>' +
      colonnes.map(col => '<td style="padding:10px 8px">' + cellule(col, l) + '</td>').join('') +
      '</tr>').join('') + '</tbody></table></div>' +

    colonnes.filter(c => !c.ici && (!c.r || c.expire || c.erreur)).map(c => carte(
      '<b>' + esc(c.site) + '</b><p class="mini" style="margin-top:4px">' +
      (c.expire ? 'La connexion à cette boutique a expiré : reconnectez-la avec ses identifiants.'
        : c.erreur ? 'La boutique n’a pas répondu. Réessayez quand l’appareil est en ligne.'
        : 'Cette boutique n’a encore publié aucun chiffre. Il suffit qu’un manager y ouvre la tour de contrôle une fois.') +
      '</p>', c.expire || c.erreur ? 'ambre' : '')).join('') +

    (liees.length ? '<div class="entete"><h3>Boutiques liées à cet appareil</h3></div>' +
      '<div class="stack">' + liees.map(b => carte('<div class="rang"><div style="flex:1;min-width:0"><b>' + esc(b.site) + '</b>' +
        '<p class="mini">' + esc(b.compte || '') + '</p></div>' +
        (b.expire ? '<button class="btn clair sm" data-fr-recon="' + esc(b.site) + '">Reconnecter</button>' : '') +
        '<button class="btn fantome sm" data-fr-retirer="' + esc(b.site) + '">Retirer</button></div>')).join('') +
      '</div>' : '');

  const a2 = $('#fr-ajout2');
  if (a2) a2.onclick = feuilleLierBoutique;
  $$('#page [data-fr-recon]').forEach(b => b.onclick = () => feuilleLierBoutique(b.dataset.frRecon));
  $$('#page [data-fr-retirer]').forEach(b => b.onclick = () => confirmer('Retirer ' + b.dataset.frRetirer + ' ?',
    'Elle ne sera plus comparée sur cet appareil. Rien n’est effacé dans la boutique elle-même.',
    'Retirer', () => {
      enregistrerLiees(boutiquesLiees().filter(x => x.site !== b.dataset.frRetirer));
      rendre('boutiques');
    }));
};

function feuilleLierBoutique(siteAttendu) {
  if (typeof siteAttendu !== 'string') siteAttendu = '';
  showSheet(
    '<h2 id="sheet-titre">' + (siteAttendu ? 'Reconnecter ' + esc(siteAttendu) : 'Ajouter une boutique') + '</h2>' +
    '<p class="sub">Les identifiants du compte de l’autre boutique, ceux qui servent à rattacher ses appareils. ' +
    'Ils ne sont saisis qu’une fois ; cet appareil ne lira que son résumé.</p>' +
    '<form id="fr-form" novalidate>' +
    '<div class="champ" style="margin-top:14px"><label class="f" for="fr-mail">Compte de la boutique</label>' +
    '<input type="email" id="fr-mail" autocapitalize="none" autocomplete="off" spellcheck="false"></div>' +
    '<div class="champ" style="margin-top:12px"><label class="f" for="fr-mdp">Mot de passe</label>' +
    '<input type="password" id="fr-mdp" autocomplete="off"></div>' +
    '<div class="actions"><button type="button" class="btn clair" data-fermer>Annuler</button>' +
    '<button type="submit" class="btn menthe" id="fr-ok">Ajouter</button></div></form>' +
    '<p class="mini" id="fr-etat" role="status" style="text-align:center;margin-top:10px"></p>');

  const etat = m => { const e = $('#fr-etat'); if (e) e.textContent = m; };
  $('#fr-form').onsubmit = async ev => {
    ev.preventDefault();
    const bouton = $('#fr-ok');
    if (bouton.disabled) return;
    const mail = $('#fr-mail').value.trim(), mdp = $('#fr-mdp').value;
    if (!mail || !mdp) return etat('Renseignez les deux champs.');
    if (!STATE.enLigne) return etat('Connexion nécessaire.');
    bouton.disabled = true;
    etat('Connexion…');
    try {
      const s = await lierBoutique(mail, mdp);
      closeSheet();
      toast(s.site + ' est maintenant comparée');
      await feed('ok', STATE.user.prenom + ' a lié la boutique ' + s.site + ' à cet appareil');
      rendre('boutiques');
    } catch (e) {
      bouton.disabled = false;
      etat(e.statut === 400 ? 'Identifiants refusés.'
         : e.statut === 429 ? 'Trop d’essais : patientez une minute.'
         : e.statut ? 'La base refuse la connexion (erreur ' + e.statut + ').'
         : e.message && !/fetch|abort/i.test(e.message) ? e.message
         : 'Base injoignable. Vérifiez le Wi-Fi, puis réessayez.');
    }
  };
}
