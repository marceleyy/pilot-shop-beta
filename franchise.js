/* =============================================================================
   PILOT-SHOP — franchise.js
   « Mes boutiques » : un franchisé compare ses boutiques côte à côte.

   La base ne laisse un compte voir que SA boutique (RLS sur le site inscrit
   dans le jeton). On n'ouvre pas cette barrière :
   - chaque boutique calcule ses propres indicateurs, avec ses propres
     données, et les range sous la clé « franchise:indicateurs » ;
   - la fonction resumes_franchise (base, SECURITY DEFINER) rend ce seul
     résumé pour les boutiques listées dans app_metadata.franchise du compte,
     liste que seul l'administrateur peut écrire.
   Un compte ne lit donc jamais les registres d'une autre boutique, et aucun
   jeton d'une autre boutique n'est gardé sur l'appareil.

   Chargé après guide.js.
   ============================================================================= */

'use strict';

PAGES.boutiques = { titre:'Mes boutiques', sous:'Vos boutiques comparées côte à côte' };
if (MENU_PLUS.manager.indexOf('boutiques') < 0) MENU_PLUS.manager.unshift('boutiques');

const FRANCHISE = {
  cle: 'franchise:indicateurs',
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
  /* Rien n'est « en retard » avant la mise en service : une boutique ouverte
     hier n'a pas manqué les relevés de la semaine dernière. Une boutique sans
     mise en route guidée (Paccard) est suivie sur toute la fenêtre. */
  const b = await DB.get('boutique', null).catch(() => null);
  const depart = b && b.debut ? String(b.debut).slice(0, 10) : addD(auj, -FRANCHISE.jours);

  /* Jour après jour, trois lectures à la fois : sept jours lancés ensemble
     encombraient le Wi-Fi au moment où le manager ouvrait un autre écran. */
  const parJour = [];
  for (const d of jours) parJour.push(await (async () => {
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
      /* Validé ET mesuré, comme pour l'état de la journée. */
      relevesManquants = (v.m && releveMesure(t, 'm') ? 0 : 1) + (v.s && releveMesure(t, 's') ? 0 : 1);
    }
    const litres = (Array.isArray(pertes) ? pertes : []).reduce((s, w) => s + litresPerte(w), 0);
    return { crit:crit, relevesManquants:relevesManquants,
             tachesManquantes:net && net.total ? Math.max(0, net.total - net.faits) : 0, litres:litres };
  })());

  const somme = k => parJour.reduce((s, x) => s + x[k], 0);
  const litres = somme('litres');

  /* Dernier calcul d'écart clôturé, avec la règle de calcul.js (essais exclus). */
  let ecart = null;
  try {
    const c = derniereCloture(await lireCalculs());
    if (c && c.resultat && !c.resultat.incoherent) ecart = { pct:+c.resultat.pct, fin:c.fin };
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
   sur une copie locale incomplète passerait pour la vérité. La limite d'une
   fois par heure se lit sur le résumé déjà rangé : elle tient d'un
   rechargement à l'autre et d'un iPad à l'autre. */
async function publierIndicateurs(force) {
  if (!STATE.user || !STATE.enLigne || !DB.configure) return null;
  if (!force) {
    try {
      const prec = JSON.parse(DB._lire(FRANCHISE.cle) || 'null');
      if (prec && prec.at && Date.now() - new Date(prec.at).getTime() < FRANCHISE.rafraichirMs) return null;
    } catch (e) {}
  }
  try {
    const r = await calculerIndicateurs();
    /* Le réseau a pu tomber pendant le calcul : les lectures sont alors
       revenues du cache. On n'écrit rien. */
    if (!STATE.enLigne) return r;
    await DB.set(FRANCHISE.cle, r);
    return r;
  } catch (e) { return null; }
}

/* Les autres boutiques lisent ce résumé : on le tient à jour quand un manager
   ouvre la tour de contrôle, une fois l'écran affiché et le Wi-Fi libre. */
const V_controle_avantFranchise = V.controle;
V.controle = async function () {
  await V_controle_avantFranchise.apply(this, arguments);
  if (!STATE.user || STATE.user.role !== 'manager') return;
  const lancer = () => publierIndicateurs(false);
  setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(lancer, { timeout:20000 }) : lancer()), 6000);
};

/* -----------------------------------------------------------------------------
   RÉSUMÉS DES AUTRES BOUTIQUES
   La fonction resumes_franchise (base) rend la ligne « franchise:indicateurs »
   des boutiques listées dans app_metadata.franchise du compte de l'appareil,
   et rien d'autre. Cette liste, seul l'administrateur l'écrit : aucun jeton
   d'une autre boutique n'est gardé sur l'appareil.
   -------------------------------------------------------------------------- */
async function resumesFranchise() {
  const jeton = await jetonValide();
  if (!jeton) { const e = new Error('non rattaché'); e.statut = 401; throw e; }
  const r = await fetch(SUPABASE.url + '/rest/v1/rpc/resumes_franchise', {
    method: 'POST',
    headers: { apikey: SUPABASE.anonKey, Authorization: 'Bearer ' + jeton, 'Content-Type': 'application/json' },
    body: '{}',
    signal: signalDelai()
  });
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.statut = r.status; throw e; }
  const l = await r.json();
  return Array.isArray(l) ? l.filter(x => x && x.site) : [];
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
  /* Les deux en même temps : la boutique d'ici se calcule pendant que la
     base rend les résumés des autres. */
  const [ici, autres] = await Promise.all([
    STATE.enLigne && DB.configure ? publierIndicateurs(true).then(r => r || calculerIndicateurs())
                                  : calculerIndicateurs(),
    STATE.enLigne && DB.configure ? resumesFranchise().catch(e => ({ erreur:e })) : Promise.resolve({ erreur:'horsligne' })
  ]);
  if (STATE.view !== 'boutiques') return;

  const erreur = autres && autres.erreur;
  const liste = Array.isArray(autres) ? autres.filter(x => x.site !== APP.site) : [];
  const colonnes = [{ site:APP.site, r:ici, ici:true }].concat(liste.map(x => ({ site:x.site, r:x.data })));

  const cellule = (col, l) => {
    if (!col.r) return '<span class="mini">—</span>';
    const v = l.val(col.r);
    return v === null ? '<span class="pill n">—</span>' : pastille(l.c(col.r), v);
  };
  const etatColonne = col => col.ici ? 'Cet appareil · à l’instant'
    : !col.r ? 'Pas encore de chiffres'
    : 'Mis à jour ' + depuis(col.r.at);

  $('#page').innerHTML =
    carte(entete('', 'Vos boutiques côte à côte',
      'Chaque boutique calcule ses chiffres elle-même, sur les 7 derniers jours. ' +
      'Les autres boutiques ne voient que ce résumé, jamais les registres.'), 'solide') +

    (erreur ? carte('<p class="mini">' + (erreur === 'horsligne'
        ? 'Hors ligne : seule cette boutique est affichée.'
        : 'Les autres boutiques n’ont pas pu être lues. Réessayez dans un instant.') + '</p>', 'ambre')
      : !liste.length ? carte('<b>Aucune autre boutique rattachée</b><p class="mini" style="margin-top:4px">' +
        'La comparaison s’active pour le compte de cette boutique depuis l’administration de Pilot-Shop. ' +
        'Demandez-la à votre contact Pilot-Shop.</p>', 'ambre') : '') +

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

    colonnes.filter(c => !c.ici && !c.r).map(c => carte('<b>' + esc(c.site) + '</b><p class="mini" style="margin-top:4px">' +
      'Cette boutique n’a encore publié aucun chiffre. Il suffit qu’un manager y ouvre la tour de contrôle une fois.</p>')).join('');
};
