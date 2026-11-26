/* =============================================================================
   PILOT-SHOP — tableau.js
   Tableau de bord en tête de la tour de contrôle, sur le modèle de
   l'appli Métropole : une rangée de compteurs, puis six cartes —
   actions prioritaires, prochaine visite, accès rapides, calendrier des
   échéances, état des équipements froids et pertes du mois.

   Lecture seule : rien n'est calculé ni écrit ici qui ne l'était déjà.
   Les données viennent des modules existants (taches.js, preaudit.js,
   relevés « temp:<jour> », registre « pertes:<jour> », ruptures, période).
   Les boutons ouvrent les écrans ou les feuilles qui existent déjà.
   Le reste de la tour de contrôle (alertes, urgences, fil « En direct »)
   reste en dessous, inchangé.

   Chargé en dernier, après taches.js.
   ============================================================================= */

'use strict';

const TDB = {
  actions: 5,          // tâches montrées dans « Actions prioritaires »
  horizon: 30,         // jours comptés dans « Échéances à 30 jours »
  evenements: 6,       // lignes sous le calendrier
  evenementsJours: 60, // jusqu'où le calendrier cherche les échéances
  couleurs: ['var(--chocolat)', 'var(--framboise)', 'var(--caramel)', 'var(--myrtille)', 'var(--pistache)', 'var(--or)']
};

/* Semaine affichée par le calendrier (décalage en semaines depuis la courante). */
let _tdbSemaine = 0;
/* Numéro du dernier dessin : un dessin plus lent, dépassé, ne remplace pas le suivant. */
let _tdbRendu = 0;

const tdbMois = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const tdbMoisLong = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const tdbJourCourt = d => +d.slice(8, 10) + ' ' + tdbMois[+d.slice(5, 7) - 1];
const tdbLundi = d => addD(d, -(((new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)).getDay()) + 6) % 7));
const tdbNombre = v => (Math.round(v * 10) / 10).toLocaleString('fr-FR');

/* Dernière mesure d'une enceinte : soir, sinon matin, du jour puis de la veille. */
function tdbEtatEnceinte(en, auj, veille) {
  for (const t of [auj, veille]) {
    if (!t) continue;
    for (const mo of ['s', 'm']) {
      const v = t[mo + '_' + en.id];
      if (v === 'HS') return { c:'bad', txt:'Hors service' };
      const e = etatTemp(en, v);
      if (e === 'crit') return { c:'bad', txt:'Critique · ' + v + ' °C' };
      if (e === 'rouge') return { c:'warn', txt:'Hors cible · ' + v + ' °C' };
      if (e === 'vert') return { c:'ok', txt:'OK · ' + v + ' °C' };
    }
  }
  return { c:'n', txt:'Non relevé' };
}

/* Toutes les lectures du tableau, en une passe. */
async function tdbDonnees() {
  const j = today(), mois = j.slice(0, 7);
  const clesPertes = (await DB.list('pertes:')).filter(k => k.slice(7, 14) === mois);
  DB.prelire(['ruptures', 'temp:' + j, 'temp:' + addD(j, -1)].concat(clesPertes));
  const [taches, passages, ruptures, tAuj, tVeille, per, pertes] = await Promise.all([
    typeof lireTaches === 'function' ? lireTaches().catch(() => []) : [],
    typeof lirePassages === 'function' ? lirePassages().catch(() => []) : [],
    DB.get('ruptures', []).catch(() => []),
    DB.get('temp:' + j, null).catch(() => null),
    DB.get('temp:' + addD(j, -1), null).catch(() => null),
    DB.get('periode:courante', null).catch(() => null),
    Promise.all(clesPertes.map(k => DB.get(k, []).catch(() => [])))
  ]);
  const ouvertes = (taches || []).filter(t => t.statut !== 'realisee').sort(tbTrier);
  const equipements = ENCEINTES.map(en => Object.assign({ nom:en.nom }, tdbEtatEnceinte(en, tAuj, tVeille)));

  /* Pertes du mois par motif : litres de glace, et lignes pour le reste. */
  const parMotif = {};
  let litres = 0, lignes = 0;
  [].concat(...pertes).forEach(w => {
    /* Ajustements d'inventaire et lignes hors écart : pas des pertes déclarées. */
    if (!w || w.supprime || w.motif === 'inventaire' || w.horsEcart) return;
    const l = typeof litresJetes === 'function' ? litresJetes(w) : 0;
    const m = MOTIFS_PERTE.filter(x => x.id === w.motif)[0];
    const cle = m ? m.label : 'Autre';
    parMotif[cle] = parMotif[cle] || { l:0, n:0 };
    parMotif[cle].l += l; parMotif[cle].n++;
    litres += l; lignes++;
  });

  /* Échéances : passages de l'animateur, tâches datées, fin de période, fermetures. */
  const ev = [];
  (passages || []).forEach(p => ev.push({ jour:p.jour, txt:paTypeLabel(p.type) + ' de l’animateur', c:'or', go:'preaudit' }));
  ouvertes.filter(t => t.echeance).forEach(t => ev.push({ jour:t.echeance, txt:'Échéance : ' + t.titre,
    c:tbEnRetard(t) ? 'bad' : t.priorite === 'urgente' ? 'warn' : 'ciel', go:'taches' }));
  if (per && per.fin) ev.push({ jour:per.fin, txt:'Fin de la période d’écart', c:'n', go:'periodes' });
  (Array.isArray(HORAIRES.fermetures) ? HORAIRES.fermetures : []).forEach(f => {
    if (f && f.du && f.au && f.au >= j) ev.push({ jour:f.du < j ? j : f.du, txt:'Fermeture jusqu’au ' + tdbJourCourt(f.au), c:'n', go:'reglages' });
  });
  ev.sort((a, b) => (a.jour < b.jour ? -1 : a.jour > b.jour ? 1 : 0));

  return { j:j, ouvertes:ouvertes, passages:passages || [], equipements:equipements, ev:ev,
           ruptures:(ruptures || []).filter(r => !r.traite), parMotif:parMotif, litres:litres, lignes:lignes, mois:mois };
}

/* --- Cartes ---------------------------------------------------------------- */
const tdbCarte = (icone, titre, corps, id) =>
  '<section class="card tdb-carte"' + (id ? ' id="' + id + '"' : '') + '>' +
  '<h2 class="tdb-titre">' + ic(icone, 20) + '<span>' + esc(titre) + '</span></h2>' + corps + '</section>';

function tdbCompteurs(d) {
  const urg = d.ouvertes.filter(t => tbEnRetard(t) || t.priorite === 'urgente').length;
  const equip = d.equipements.filter(e => e.c === 'bad' || e.c === 'warn').length;
  const limite = addD(d.j, TDB.horizon);
  const ech = d.ev.filter(e => e.jour >= d.j && e.jour <= limite && e.go !== 'reglages').length;
  const k = (v, lib, cls, go) => '<button type="button" class="tdb-kpi ' + cls + '" data-tdb-go="' + go + '">' +
    '<span class="tdb-kv">' + v + '</span><span class="tdb-kl">' + esc(lib) + '</span></button>';
  return '<div class="tdb-kpis">' +
    k(d.ouvertes.length, 'Tâches ouvertes', '', 'taches') +
    k(urg, 'Urgentes / en retard', urg ? 'bad' : '', 'taches') +
    k(equip, 'Équipements à vérifier', equip ? 'bad' : '', 'temp') +
    k(d.ruptures.length, 'Ruptures signalées', d.ruptures.length ? 'warn' : '', 'controle#urgences') +
    k(ech, 'Échéances à ' + TDB.horizon + ' jours', '', 'taches') + '</div>';
}

function tdbActions(d) {
  const l = d.ouvertes.slice(0, TDB.actions);
  const corps = l.length ? '<ul class="tdb-liste">' + l.map(t => {
    const p = tbPrio(t.priorite), retard = tbEnRetard(t);
    const pills = [pastille(p.pill, p.libelle),
      t.echeance ? pastille(retard ? 'bad' : 'n', (retard ? 'En retard · ' : 'Avant le ') + fmtDC(t.echeance)) : '',
      t.statut === 'en_cours' ? pastille('ciel', 'En cours') : ''].join('');
    const peut = typeof tbPeutAgir === 'function' && tbPeutAgir(t);
    return '<li class="tdb-tache">' +
      (peut ? '<button type="button" class="tdb-coche" data-tdb-fin="' + esc(t.id) + '" aria-label="Marquer réalisée : ' + esc(t.titre) + '"></button>'
            : '<span class="tdb-coche off" aria-hidden="true"></span>') +
      '<button type="button" class="tdb-tl" data-tdb-go="taches"><b>' + esc(t.titre) + '</b>' +
      '<span class="tdb-pills">' + pills + '</span></button></li>';
  }).join('') + '</ul>'
    : '<p class="tdb-vide">Aucune tâche ouverte. Tout est à jour.</p>';
  return tdbCarte('valide', 'Actions prioritaires', corps +
    '<button type="button" class="btn clair sm tdb-bas" data-tdb-go="taches">Toutes les tâches (' + d.ouvertes.length + ')</button>');
}

function tdbVisite(d) {
  const p = d.passages.filter(x => x.jour >= d.j).sort((a, b) => (a.jour < b.jour ? -1 : 1))[0];
  if (!p) return tdbCarte('controle', 'Prochaine visite',
    '<p class="tdb-vide">Aucun passage de l’animateur prévu.</p>' +
    '<button type="button" class="btn clair sm tdb-bas" data-tdb-go="preaudit">Noter un passage</button>');
  const liees = d.ouvertes.filter(t => t.passage === p.id);
  const dans = joursEntre(d.j, p.jour).length - 1;
  return tdbCarte('controle', 'Prochaine visite',
    '<div class="tdb-visite"><div class="tdb-date"><span>' + +p.jour.slice(8, 10) + '</span>' +
      tdbMois[+p.jour.slice(5, 7) - 1] + '</div>' +
    '<div><b>' + esc(paTypeLabel(p.type)) + ' de l’animateur</b>' +
      '<div class="mini">' + esc(fmtD(p.jour)) + ' · ' + (dans === 0 ? 'aujourd’hui' : dans === 1 ? 'demain' : 'dans ' + dans + ' jours') + '</div>' +
      (p.note ? '<div class="mini">' + esc(p.note) + '</div>' : '') + '</div></div>' +
    '<button type="button" class="tdb-prep" data-tdb-go="preaudit"><span class="tdb-prep-l"><span>Préparation · pré-audit</span>' +
      '<b id="tdb-score">…</b></span><span class="tdb-barre"><i id="tdb-barre" style="width:0%"></i></span></button>' +
    (liees.length ? '<p class="mini tdb-note">' + liees.length + ' ' + accord(liees.length, 'tâche demandée', 'tâches demandées') + ' encore à faire.</p>' : ''),
    'tdb-visite');
}

function tdbAcces() {
  const b = (id, icone, lib) => '<button type="button" class="tdb-acces" id="' + id + '">' + ic(icone, 18) + '<span>' + esc(lib) + '</span></button>';
  return tdbCarte('journee', 'Accès rapides',
    '<div class="tdb-acces-l">' +
    b('tdb-tache', 'valide', 'Nouvelle tâche') +
    b('tdb-perte', 'anomalie', 'Déclarer une perte') +
    b('tdb-frigo', 'temperature', 'Relever les frigos') +
    b('tdb-bl', 'photo', 'Scanner un bon de livraison') + '</div>');
}

function tdbCalendrier(d) {
  const lundi = addD(tdbLundi(d.j), 7 * _tdbSemaine);
  const jours = joursEntre(lundi, addD(lundi, 6));
  const aEv = new Set(d.ev.map(e => e.jour));
  const milieu = jours[3];
  const titre = tdbMoisLong[+milieu.slice(5, 7) - 1] + ' ' + milieu.slice(0, 4);
  const depuis = _tdbSemaine > 0 ? lundi : d.j;
  const fin = addD(depuis, TDB.evenementsJours);
  const prochains = d.ev.filter(e => e.jour >= depuis && e.jour <= fin).slice(0, TDB.evenements);
  return tdbCarte('periodes', 'Calendrier & échéances',
    '<div class="tdb-cal-tete"><button type="button" class="tdb-nav" data-tdb-sem="-1" aria-label="Semaine précédente">‹</button>' +
      '<b>' + esc(titre.charAt(0).toUpperCase() + titre.slice(1)) + '</b>' +
      '<button type="button" class="tdb-nav" data-tdb-sem="1" aria-label="Semaine suivante">›</button></div>' +
    '<div class="tdb-semaine">' + jours.map((x, i) =>
      '<div class="tdb-jour' + (x === d.j ? ' auj' : '') + (aEv.has(x) ? ' ev' : '') + '">' +
      '<span>' + 'LMMJVSD'[i] + '</span><b>' + +x.slice(8, 10) + '</b></div>').join('') + '</div>' +
    (prochains.length ? '<ul class="tdb-ev">' + prochains.map(e =>
      '<li><button type="button" class="tdb-ev-l ' + e.c + '" data-tdb-go="' + e.go + '">' +
      '<span class="tdb-ev-d">' + tdbJourCourt(e.jour) + '</span><span class="tdb-ev-t">' + esc(e.txt) + '</span></button></li>').join('') + '</ul>'
      : '<p class="tdb-vide">Aucune échéance à venir.</p>'), 'tdb-cal');
}

function tdbEquipements(d) {
  const rep = d.ouvertes.filter(t => t.categorie === 'reparation').length;
  return tdbCarte('temperature', 'État des équipements',
    '<ul class="tdb-equip">' + d.equipements.map(e =>
      '<li><button type="button" data-tdb-go="temp"><span class="tdb-eq-i ' + e.c + '" aria-hidden="true"></span>' +
      '<span class="tdb-eq-n">' + esc(e.nom) + '</span>' +
      '<span class="tdb-eq-e ' + e.c + '">' + esc(e.txt) + '</span></button></li>').join('') +
    '<li><button type="button" data-tdb-go="taches"><span class="tdb-eq-i ' + (rep ? 'warn' : 'ok') + '" aria-hidden="true"></span>' +
      '<span class="tdb-eq-n">Réparations</span><span class="tdb-eq-e ' + (rep ? 'warn' : 'ok') + '">' +
      (rep ? rep + ' ' + accord(rep, 'ouverte') : 'Aucune') + '</span></button></li></ul>');
}

function tdbPertes(d) {
  const motifs = Object.keys(d.parMotif).map(k => ({ k:k, l:d.parMotif[k].l, n:d.parMotif[k].n }));
  /* Part de chaque motif : en litres s'il y a de la glace jetée, sinon en lignes. */
  const enL = d.litres > 0;
  const tot = enL ? d.litres : d.lignes;
  motifs.sort((a, b) => (enL ? b.l - a.l : b.n - a.n));
  let donut = '';
  if (tot > 0) {
    const R = 15.915, C = 100;
    let off = 25;
    donut = '<svg class="tdb-donut" viewBox="0 0 42 42" role="img" aria-label="Pertes par motif">' +
      '<circle cx="21" cy="21" r="' + R + '" fill="none" stroke="var(--creme-2)" stroke-width="7"/>' +
      motifs.map((m, i) => {
        const v = (enL ? m.l : m.n) / tot * C;
        if (v <= 0) return '';
        const s = '<circle cx="21" cy="21" r="' + R + '" fill="none" stroke="' + TDB.couleurs[i % TDB.couleurs.length] +
          '" stroke-width="7" stroke-dasharray="' + Math.max(v - 0.6, 0.1).toFixed(2) + ' ' + (C - Math.max(v - 0.6, 0.1)).toFixed(2) +
          '" stroke-dashoffset="' + off.toFixed(2) + '"/>';
        off -= v;
        return s;
      }).join('') + '</svg>';
  }
  const titreMois = tdbMoisLong[+d.mois.slice(5, 7) - 1] + ' ' + d.mois.slice(0, 4);
  return tdbCarte('anomalie', 'Pertes — aperçu',
    '<div class="tdb-gros">' + tdbNombre(d.litres) + ' L</div>' +
    '<div class="mini">Glace jetée en ' + esc(titreMois) + ' · ' + d.lignes + ' ' + accord(d.lignes, 'déclaration') + '</div>' +
    (tot > 0
      ? '<div class="tdb-donut-l">' + donut + '<ul class="tdb-leg">' + motifs.map((m, i) =>
          '<li><i style="background:' + TDB.couleurs[i % TDB.couleurs.length] + '"></i>' + esc(m.k) +
          ' <span>' + (enL && m.l > 0 ? tdbNombre(m.l) + ' L · ' + Math.round(m.l / tot * 100) + ' %'
            : m.n + ' ' + accord(m.n, 'déclaration') + (enL ? ' hors glace' : ' · ' + Math.round(m.n / tot * 100) + ' %')) + '</span></li>').join('') + '</ul></div>'
      : '<p class="tdb-vide">Aucune perte déclarée ce mois.</p>') +
    '<button type="button" class="btn clair sm tdb-bas" data-tdb-go="pertes">Déclarer une perte</button>');
}

/* --- Dessin et branchements ----------------------------------------------- */
async function tdbDessiner(page) {
  const n = ++_tdbRendu;
  const d = await tdbDonnees();
  if (n !== _tdbRendu || STATE.view !== 'controle' || page !== $('#page')) return;
  const ancien = $('#tdb'); if (ancien) ancien.remove();
  const bloc = document.createElement('div');
  bloc.id = 'tdb';
  bloc.innerHTML = tdbCompteurs(d) +
    '<div class="tdb-grille">' +
    '<div class="tdb-col">' + tdbActions(d) + tdbEquipements(d) + '</div>' +
    '<div class="tdb-col">' + tdbVisite(d) + tdbPertes(d) + '</div>' +
    '<div class="tdb-col">' + tdbAcces() + tdbCalendrier(d) + '</div></div>' +
    '<div class="entete tdb-suite"><h3>Suivi du jour</h3></div>';
  /* Après le rappel « Mise en route » s'il est là, avant tout le reste. */
  const guide = page.firstChild && page.firstChild.querySelector && page.firstChild.querySelector('#gd-rep') ? page.firstChild : null;
  page.insertBefore(bloc, guide ? guide.nextSibling : page.firstChild);

  const redessiner = () => rendre('controle');
  bloc.querySelectorAll('[data-tdb-go]').forEach(b => b.onclick = () => {
    const [vue, ancre] = b.dataset.tdbGo.split('#');
    if (ancre) { const c = document.getElementById(ancre); if (c) return c.scrollIntoView({ behavior:'smooth', block:'start' }); }
    if (vue !== 'controle') rendre(vue);
  });
  bloc.querySelectorAll('[data-tdb-fin]').forEach(b => b.onclick = () => feuilleRealisee(b.dataset.tdbFin, redessiner));
  bloc.querySelectorAll('[data-tdb-sem]').forEach(b => b.onclick = () => {
    _tdbSemaine += +b.dataset.tdbSem;
    const c = bloc.querySelector('#tdb-cal');
    if (c) { c.outerHTML = tdbCalendrier(d); tdbBrancherCal(bloc, d); }
  });
  const o = (id, f) => { const x = bloc.querySelector('#' + id); if (x) x.onclick = f; };
  o('tdb-tache', () => ouvrirFormulaireTache({ categorie:'boutique' }, redessiner));
  o('tdb-perte', () => rendre('pertes'));
  o('tdb-frigo', () => rendre('temp'));
  o('tdb-bl', () => scannerBL());

  /* Score de préparation : lecture des registres, sans retenir l'écran. */
  if (bloc.querySelector('#tdb-score') && typeof scoreConformite === 'function') {
    scoreConformite().then(s => {
      const sc = bloc.querySelector('#tdb-score'), br = bloc.querySelector('#tdb-barre');
      if (!sc || !document.body.contains(sc)) return;
      const v = s && s.score !== null && s.score !== undefined ? s.score : null;
      sc.textContent = v === null ? '—' : v + ' %';
      if (br) { br.style.width = (v || 0) + '%'; br.className = s ? s.classe : ''; }
    }).catch(() => { const sc = bloc.querySelector('#tdb-score'); if (sc) sc.textContent = '—'; });
  }
}
/* Après un changement de semaine : seuls les boutons du calendrier redessiné. */
function tdbBrancherCal(bloc, d) {
  const c = bloc.querySelector('#tdb-cal');
  c.querySelectorAll('[data-tdb-sem]').forEach(b => b.onclick = () => {
    _tdbSemaine += +b.dataset.tdbSem;
    const x = bloc.querySelector('#tdb-cal');
    if (x) { x.outerHTML = tdbCalendrier(d); tdbBrancherCal(bloc, d); }
  });
  c.querySelectorAll('[data-tdb-go]').forEach(b => b.onclick = () => rendre(b.dataset.tdbGo));
}

const V_controle_avantTableau = V.controle;
V.controle = async function () {
  /* Arrivée depuis un autre écran : le calendrier revient à la semaine en cours. */
  if (STATE.view !== 'controle' || !document.getElementById('tdb')) _tdbSemaine = 0;
  await V_controle_avantTableau.apply(this, arguments);
  const page = $('#page');
  if (!page || STATE.view !== 'controle' || !STATE.user || STATE.user.role !== 'manager') return;
  /* Guide de mise en route affiché à la place de la tour : rien à ajouter. */
  if (typeof guideEnCours === 'function' && guideEnCours() && typeof _guideMasque !== 'undefined' && !_guideMasque) return;
  try { await tdbDessiner(page); }
  catch (e) { console.warn('Tableau de bord indisponible', e); }
};
