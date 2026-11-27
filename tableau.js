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
  const [taches, passages, ruptures, tAuj, tVeille, per, pertes, fifo] = await Promise.all([
    typeof lireTaches === 'function' ? lireTaches().catch(() => []) : [],
    typeof lirePassages === 'function' ? lirePassages().catch(() => []) : [],
    DB.get('ruptures', []).catch(() => []),
    DB.get('temp:' + j, null).catch(() => null),
    DB.get('temp:' + addD(j, -1), null).catch(() => null),
    DB.get('periode:courante', null).catch(() => null),
    Promise.all(clesPertes.map(k => DB.get(k, []).catch(() => []))),
    /* Produits ouverts (frigo virtuel) : dépassés ou à vendre vite. */
    typeof calculFIFO === 'function' ? calculFIFO(mois).catch(() => []) : []
  ]);
  const ouvertes = (taches || []).filter(t => t.statut !== 'realisee').sort(tbTrier);
  const equipements = ENCEINTES.map(en => Object.assign({ nom:en.nom }, tdbEtatEnceinte(en, tAuj, tVeille)));

  /* Pertes du mois par motif : litres de glace, et lignes pour le reste. */
  const parMotif = {};
  let litres = 0, lignes = 0;
  /* Litres jetés par jour du mois (courbe de la carte « Pertes »), à partir des mêmes registres. */
  const litresJour = {};
  pertes.forEach((l, i) => (l || []).forEach(w => {
    if (!w || w.supprime || w.motif === 'inventaire' || w.horsEcart) return;
    const jj = clesPertes[i].slice(7, 17);
    litresJour[jj] = (litresJour[jj] || 0) + (typeof litresJetes === 'function' ? litresJetes(w) : 0);
  }));
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
           ruptures:(ruptures || []).filter(r => !r.traite),
           perimes:(fifo || []).filter(f => f.c === 'rouge').length, aEcouler:(fifo || []).filter(f => f.c === 'orange').length, parMotif:parMotif, litres:litres, lignes:lignes, mois:mois, litresJour:litresJour };
}

/* --- Cartes ---------------------------------------------------------------- */
const tdbCarte = (icone, titre, corps, id) =>
  '<section class="card tdb-carte"' + (id ? ' id="' + id + '"' : '') + '>' +
  '<h2 class="tdb-titre">' + ic(icone, 20) + '<span>' + esc(titre) + '</span></h2>' + corps + '</section>';

function tdbCompteurs(d) {
  const urg = d.ouvertes.filter(t => tbEnRetard(t) || t.priorite === 'urgente').length;
  const equip = d.equipements.filter(e => e.c === 'bad' || e.c === 'warn').length;
  const k = (v, lib, cls, go) => '<button type="button" class="tdb-kpi ' + cls + '" data-tdb-go="' + go + '">' +
    '<span class="tdb-kv">' + v + '</span><span class="tdb-kl">' + esc(lib) + '</span></button>';
  return '<div class="tdb-kpis">' +
    k(d.ouvertes.length, 'Tâches ouvertes', '', 'taches') +
    k(urg, 'Urgentes / en retard', urg ? 'bad' : '', 'taches') +
    k(equip, 'Équipements à vérifier', equip ? 'bad' : '', 'temp') +
    k(d.ruptures.length, 'Ruptures signalées', d.ruptures.length ? 'warn' : '', 'controle#urgences') +
    k(d.perimes + d.aEcouler, d.perimes ? 'Produits dépassés / à écouler' : 'Produits à écouler vite',
      d.perimes ? 'bad' : d.aEcouler ? 'warn' : '', 'frigo') + '</div>';
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
  return tdbCarte('anomalie', 'Pertes du mois',
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

/* --- Verre : à surveiller, carte principale, zones colorées -------------- */
/* Courbe SVG d'une série (échelle propre à la série). */
function tdbCourbe(v, cls) {
  if (!v || v.length < 2) return '';
  const W = 600, H = 220, m = 10, mn = Math.min.apply(null, v), mx = Math.max.apply(null, v), r = mx - mn || 1;
  const p = v.map((x, i) => [m + i * (W - 2 * m) / (v.length - 1), H - m - (x - mn) / r * (H - 2 * m)]);
  const d = p.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
  return '<svg class="' + cls + '" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
    '<defs><linearGradient id="tdbg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#FFD9C2" stop-opacity=".45"/><stop offset="1" stop-color="#FFD9C2" stop-opacity="0"/></linearGradient></defs>' +
    '<path d="' + d + ' L' + p[p.length - 1][0] + ' ' + H + ' L' + p[0][0] + ' ' + H + 'Z" fill="url(#tdbg)"/>' +
    '<path class="tdb-trace" d="' + d + '" fill="none" stroke="#FFD9C2" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linecap="round"/></svg>';
}
function tdbAnneau(part, txt) {
  const C = 2 * Math.PI * 22, x = Math.max(0, Math.min(1, part || 0));
  return '<svg viewBox="0 0 60 60" width="66" height="66" aria-hidden="true"><circle cx="30" cy="30" r="22" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="7"/>' +
    '<circle cx="30" cy="30" r="22" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + C.toFixed(2) + '" stroke-dashoffset="' + (C * (1 - x)).toFixed(2) + '" transform="rotate(-90 30 30)"/>' +
    '<text x="30" y="35" text-anchor="middle" fill="#fff" font-size="12.5" font-weight="800">' + esc(txt) + '</text></svg>';
}
function tdbJauge(part, txt, id) {
  const L = Math.PI * 24, x = Math.max(0, Math.min(1, part || 0));
  return '<svg viewBox="0 0 64 40" width="96" height="60" aria-hidden="true"><path d="M8 34a24 24 0 0 1 48 0" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="7" stroke-linecap="round"/>' +
    '<path' + (id ? ' id="' + id + '-arc"' : '') + ' d="M8 34a24 24 0 0 1 48 0" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + L.toFixed(2) + '" stroke-dashoffset="' + (L * (1 - x)).toFixed(2) + '"/>' +
    '<text' + (id ? ' id="' + id + '-txt"' : '') + ' x="32" y="34" text-anchor="middle" fill="#fff" font-size="10.5" font-weight="800">' + esc(txt) + '</text></svg>';
}

/* À surveiller : équipements critiques, tâches en retard ou urgentes, ruptures. */
function tdbSurveiller(d) {
  const l = [];
  d.equipements.filter(e => e.c === 'bad').forEach(e => l.push({ t:'Frigo', d:e.txt.split(' · ')[0], txt:e.nom, g:'g1', go:'temp' }));
  if (d.ruptures.length) l.push({ t:'Rupture', d:d.ruptures.length + ' ' + accord(d.ruptures.length, 'produit'), txt:d.ruptures.map(r => r.article || '').filter(Boolean).slice(0, 2).join(', ') || 'Ruptures signalées', g:'g2', go:'controle#urgences' });
  d.ouvertes.filter(t => tbEnRetard(t) || t.priorite === 'urgente').forEach(t => l.push({ t:tbEnRetard(t) ? 'En retard' : 'Urgent',
    d:t.echeance ? tdbJourCourt(t.echeance) : '', txt:t.titre, g:tbEnRetard(t) ? 'g1' : 'g2', go:'taches' }));
  const v = l.slice(0, 3);
  return '<div class="tdb-v-col"><div class="tdb-v-t">À surveiller<small>' + (l.length ? l.length + ' ' + accord(l.length, 'élément') : '') + '</small></div>' +
    (v.length ? v.map((x, i) => '<button type="button" class="tdb-mini tdb-' + x.g + '" style="animation-delay:' + (0.1 + i * 0.06).toFixed(2) + 's" data-tdb-go="' + x.go + '">' +
      '<span class="tdb-etiq"><span>' + esc(x.t) + '</span><span>' + esc(x.d) + '</span></span><b>' + esc(x.txt) + '</b></button>').join('')
      : '<div class="card tdb-carte tdb-vide">Rien d’urgent : frigos, tâches et stock sont à jour.</div>') + '</div>';
}

/* Carte principale : pertes du mois, avec la courbe des litres cumulés jour après jour. */
function tdbHero(d) {
  const n = +d.j.slice(8, 10), serie = [];
  let cumul = 0;
  for (let i = 1; i <= n; i++) { cumul += d.litresJour[d.mois + '-' + String(i).padStart(2, '0')] || 0; serie.push(cumul); }
  const titreMois = tdbMoisLong[+d.mois.slice(5, 7) - 1];
  return '<section class="tdb-hero" aria-label="Pertes du mois">' +
    '<div class="tdb-flags"><span>Pertes de ' + esc(titreMois) + '</span><span>' + d.lignes + ' ' + accord(d.lignes, 'déclaration') + '</span></div>' +
    (d.litres > 0 ? tdbCourbe(serie, 'tdb-courbe') : '') +
    '<h2>' + (d.litres > 0 ? tdbNombre(d.litres) + ' L de glace jetés ce mois' : 'Aucune glace jetée ce mois') + '</h2>' +
    '<p>' + (d.litres > 0 ? 'Litres cumulés depuis le 1er ' + esc(titreMois) + '. Le détail par motif est dans la carte « Pertes du mois ».' : 'Déclarez chaque perte pour suivre les écarts de la période.') + '</p>' +
    '<div class="tdb-hero-a"><button type="button" class="tdb-btn" data-tdb-go="pertes">Déclarer une perte</button>' +
    '<button type="button" class="tdb-btn gh" data-tdb-go="temp">Relever les frigos</button></div></section>';
}

/* Zones colorées : frigos, tâches, produits ouverts, préparation de la visite. */
function tdbZones(d) {
  const ok = d.equipements.filter(e => e.c === 'ok').length, tot = d.equipements.length;
  const urg = d.ouvertes.filter(t => tbEnRetard(t) || t.priorite === 'urgente').length;
  const ouv = d.perimes + d.aEcouler;
  const p = d.passages.filter(x => x.jour >= d.j).sort((a, b) => (a.jour < b.jour ? -1 : 1))[0];
  const z = (g, t, v, s, viz, go, i) => '<button type="button" class="tdb-zone tdb-' + g + '" style="animation-delay:' + (0.15 + i * 0.05).toFixed(2) + 's" data-tdb-go="' + go + '">' +
    '<span class="tdb-z-t">' + esc(t) + '</span><b>' + esc(v) + '</b><span class="tdb-z-s">' + esc(s) + '</span><span class="tdb-viz">' + viz + '</span></button>';
  return '<p class="tdb-v-sec">Zones à surveiller</p><div class="tdb-zones">' +
    z('g4', 'Frigos', tot ? ok + ' sur ' + tot + ' OK' : 'Aucun frigo', !tot ? 'à configurer' : tot - ok ? (tot - ok) + ' à vérifier' : 'tout est conforme', tdbAnneau(tot ? ok / tot : 0, tot ? ok + '/' + tot : '–'), 'temp', 0) +
    z('g5', 'Tâches ouvertes', d.ouvertes.length + ' ' + accord(d.ouvertes.length, 'tâche'), urg ? urg + ' urgente' + (urg > 1 ? 's' : '') + ' ou en retard' : 'aucune en retard', tdbAnneau(d.ouvertes.length ? 1 - urg / d.ouvertes.length : 1, String(urg)), 'taches', 1) +
    z('g6', 'Produits ouverts', ouv ? ouv + ' à surveiller' : 'Rien à écouler', d.perimes ? d.perimes + ' ' + accord(d.perimes, 'dépassé') : d.aEcouler ? 'à vendre vite' : 'tout est dans les temps', tdbAnneau(ouv ? 0.3 : 1, ouv ? String(ouv) : 'OK'), 'frigo', 2) +
    z('g7', p ? 'Visite le ' + tdbJourCourt(p.jour) : 'Prochaine visite', 'Pré-audit', p ? 'préparation en cours' : 'aucun passage prévu', tdbJauge(0, p && typeof scoreConformite === 'function' ? '…' : '—', p ? 'tdb-z-pa' : null), 'preaudit', 3) +
    '</div>';
}

/* --- Dessin et branchements ----------------------------------------------- */
async function tdbDessiner(page) {
  const n = ++_tdbRendu;
  const d = await tdbDonnees();
  if (n !== _tdbRendu || STATE.view !== 'controle' || page !== $('#page')) return;
  const ancien = $('#tdb'); if (ancien) ancien.remove();
  const bloc = document.createElement('div');
  bloc.id = 'tdb';
  bloc.className = 'tdb-verre';
  bloc.innerHTML = '<div class="tdb-fenetre">' + tdbCompteurs(d) +
    '<div class="tdb-haut">' + tdbSurveiller(d) + tdbHero(d) + '</div>' + tdbZones(d) +
    '<div class="tdb-grille">' +
    '<div class="tdb-col">' + tdbActions(d) + tdbEquipements(d) + '</div>' +
    '<div class="tdb-col">' + tdbVisite(d) + tdbPertes(d) + '</div>' +
    '<div class="tdb-col">' + tdbAcces() + tdbCalendrier(d) + '</div></div></div>' +
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
  if ((bloc.querySelector('#tdb-score') || bloc.querySelector('#tdb-z-pa-txt')) && typeof scoreConformite === 'function') {
    scoreConformite().then(s => {
      const sc = bloc.querySelector('#tdb-score'), br = bloc.querySelector('#tdb-barre');
      if (!document.body.contains(bloc)) return;
      const v = s && s.score !== null && s.score !== undefined ? s.score : null;
      if (sc) sc.textContent = v === null ? '—' : v + ' %';
      if (br) { br.style.width = (v || 0) + '%'; br.className = s ? s.classe : ''; }
      const za = bloc.querySelector('#tdb-z-pa-arc'), zt = bloc.querySelector('#tdb-z-pa-txt');
      if (za) za.setAttribute('stroke-dashoffset', (Math.PI * 24 * (1 - (v || 0) / 100)).toFixed(2));
      if (zt) zt.textContent = v === null ? '—' : v + ' %';
    }).catch(() => { const sc = bloc.querySelector('#tdb-score'); if (sc) sc.textContent = '—'; const zt = bloc.querySelector('#tdb-z-pa-txt'); if (zt) zt.textContent = '—'; });
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
