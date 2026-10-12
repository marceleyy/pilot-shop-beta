/* =============================================================================
   PILOT-SHOP — preaudit.js
   Pré-audit Amorino : une grille d'auto-contrôle sur les thèmes de l'audit
   trimestriel du réseau (hygiène, vitrine, quantités servies, affiches,
   traçabilité, nettoyage des machines). Elle donne un score, un plan
   d'actions avec un responsable et une échéance, et s'imprime en PDF.
   Les registres déjà tenus dans l'appli (frigos, nettoyage, lots, réceptions,
   pertes, calcul d'écart) sont lus et affichés comme preuves à côté des
   points qu'ils concernent.
   La grille officielle d'Amorino n'est pas publique : celle-ci reprend les
   thèmes connus de l'audit. Les points se changent dans PREAUDIT.themes.
   Chargé après app.js, modules.js, stock.js et calcul.js.
   ============================================================================= */

   'use strict';

PAGES.preaudit = { titre:'Pré-audit Amorino', sous:'Grille, score et plan d’actions' };
if (MENU_PLUS.manager.indexOf('preaudit') < 0) {
  MENU_PLUS.manager.splice(MENU_PLUS.manager.indexOf('calcul') + 1, 0, 'preaudit');
}

const PREAUDIT = {
  /* Fenêtre lue dans les registres pour les preuves. */
  joursPreuves: 30,
  /* Échéance proposée pour une action, en jours. */
  delaiAction: 7,
  /* Une fois le premier pré-audit fait, la tour de contrôle rappelle d'en
     refaire un passé ce délai : quatre audits par an, un pré-audit par mois. */
  rappelJours: 30,
  /* Score en % : vert au-dessus de ok, orange au-dessus de warn. */
  seuils: { ok:85, warn:70 },
  reponses: [
    { id:'c',  label:'Conforme',     court:'OK',  pill:'ok',   points:1 },
    { id:'p',  label:'À reprendre',  court:'±',   pill:'warn', points:0.5 },
    { id:'nc', label:'Non conforme', court:'NC',  pill:'bad',  points:0 },
    { id:'na', label:'Sans objet',   court:'—',   pill:'n',    points:null }
  ],
  /* [id, libellé, preuve lue dans l'appli (facultatif)] */
  themes: [
    { id:'hyg', nom:'Hygiène et personnel', points:[
      ['hyg1', 'Tenue propre et complète, cheveux attachés et couverts'],
      ['hyg2', 'Pas de bijoux ni de montre, ongles courts et sans vernis'],
      ['hyg3', 'Lave-mains équipé : savon, essuie-mains jetables, poubelle à pédale'],
      ['hyg4', 'Mains lavées entre l’encaissement et le service'],
      ['hyg5', 'Températures des frigos relevées matin et soir', 'temp']
    ] },
    { id:'vit', nom:'Vitrine et présentation', points:[
      ['vit1', 'Bacs travaillés et lissés, bords propres'],
      ['vit2', 'Étiquettes des parfums en place, dans l’ordre de la vitrine'],
      ['vit3', 'Vitre, joints et plan de travail propres, sans traces de doigts'],
      ['vit4', 'Tous les parfums de la carte présents, aucun bac vide', 'ruptures'],
      ['vit5', 'Vitrine dans sa plage de température', 'vitrine']
    ] },
    { id:'por', nom:'Quantités servies', points:[
      ['por1', 'Fleur faite selon le geste Amorino, nombre de pétales respecté'],
      ['por2', 'Pesée de contrôle faite cette semaine, grammages respectés'],
      ['por3', 'Écart glace du dernier calcul dans la fourchette', 'ecart'],
      ['por4', 'Cornets, coppas et pots servis dans le bon format']
    ] },
    { id:'aff', nom:'Affiches et information client', points:[
      ['aff1', 'Affiches de la saison en place, aucune affiche périmée'],
      ['aff2', 'Prix à jour, affichés et lisibles depuis l’entrée'],
      ['aff3', 'Tableau des allergènes affiché, dernière version Amorino'],
      ['aff4', 'Menu et présentoirs propres, sans rature ni étiquette provisoire']
    ] },
    { id:'tra', nom:'Traçabilité', points:[
      ['tra1', 'Numéro de lot noté à chaque ouverture de bac', 'lots'],
      ['tra2', 'Aucun produit entamé au-delà de sa durée de vie', 'dlc'],
      ['tra3', 'Livraisons réceptionnées avec contrôle de la température et des DLC', 'receptions'],
      ['tra4', 'Produits entamés étiquetés avec leur date d’ouverture'],
      ['tra5', 'Pertes enregistrées avec leur motif', 'pertes']
    ] },
    { id:'net', nom:'Nettoyage des machines et des locaux', points:[
      ['net1', 'Plan de nettoyage tenu à jour', 'nettoyage'],
      ['net2', 'Crêpière et gaufrier propres, sans résidus'],
      ['net3', 'Machine à café et buse vapeur nettoyées'],
      ['net4', 'Spatules dans une eau claire, changée régulièrement'],
      ['net5', 'Chambre froide et congélateurs rangés, sans givre ni carton au sol'],
      ['net6', 'Sols, poubelles et réserve propres']
    ] }
  ]
};

/* ---------------------------------------------------------------------------
   Lecture et calculs
   ------------------------------------------------------------------------ */
const PA_RE = /^preaudit:\d{4}-\d{2}-\d{2}:/;
const paPoints = () => [].concat(...PREAUDIT.themes.map(t => t.points.map(p => ({ id:p[0], libelle:p[1], preuve:p[2] || null, theme:t }))));
const paReponse = id => PREAUDIT.reponses.filter(r => r.id === id)[0] || null;
const paClasse = s => s === null ? 'n' : s >= PREAUDIT.seuils.ok ? 'ok' : s >= PREAUDIT.seuils.warn ? 'warn' : 'bad';
const paScoreTxt = s => s === null ? '—' : s + ' %';
/* Actions vivantes (ni supprimées), dans l'ordre des échéances. */
const paActions = a => Object.keys(a.actions || {}).map(k => a.actions[k])
  .filter(x => x && x.id && !x.supprime)
  .sort((x, y) => String(x.echeance) < String(y.echeance) ? -1 : String(x.echeance) > String(y.echeance) ? 1 : 0);
const paEnRetard = x => !x.fait && x.echeance && x.echeance < today();

/* Stockage à plat : une réponse par champ « r:<point> », une action par champ
   « a:<id> ». Chaque écriture est un DB.patch de ce seul champ, appliqué sur
   la copie du serveur relue juste avant : deux iPads qui notent la même
   grille, ou cochent des actions, ne s'écrasent pas, et le statut n'est
   jamais renvoyé par une simple réponse. reponses et actions sont recomposés
   ici, pour la lecture seulement : ils ne sont jamais écrits. */
function paNormaliser(d) {
  if (!d || typeof d !== 'object') return d;
  const a = Object.assign({}, d, { reponses:{}, actions:{} });
  Object.keys(d).forEach(k => {
    if (k.indexOf('r:') === 0) a.reponses[k.slice(2)] = d[k];
    else if (k.indexOf('a:') === 0) a.actions[k.slice(2)] = d[k];
  });
  return a;
}
async function paEcrire(a, champs) {
  const n = paNormaliser(await DB.patch(a.id, champs));
  /* La copie relue ne porte pas encore les écritures qui attendent derrière
     celle-ci (une réponse touchée juste après) : pour les réponses et les
     actions, le local garde la main ; le serveur n'ajoute que ce qui vient
     d'ailleurs. Statut, score… viennent du serveur. */
  const reponses = Object.assign({}, n.reponses, a.reponses);
  const actions = Object.assign({}, n.actions, a.actions);
  Object.keys(champs).forEach(k => {
    if (k.indexOf('r:') === 0) reponses[k.slice(2)] = champs[k];
    else if (k.indexOf('a:') === 0) actions[k.slice(2)] = champs[k];
  });
  Object.assign(a, n, { reponses:reponses, actions:actions });
  return a;
}

async function lirePreAudits() {
  const cles = (await DB.list('preaudit:')).filter(k => PA_RE.test(k));
  const l = (await Promise.all(cles.map(k => DB.get(k, null)))).map(paNormaliser);
  /* Supprimé : marqué, pas effacé, sinon il revenait d'un autre iPad. */
  return l.filter(a => a && a.id && a.jour && a.statut !== 'supprime')
    .sort((x, y) => (x.jour < y.jour ? 1 : x.jour > y.jour ? -1 : String(x.at) < String(y.at) ? 1 : -1));
}

/* Score d'un ensemble de points : conforme 1, à reprendre ½, non conforme 0,
   sans objet hors du compte. null tant qu'aucun point n'est noté. */
function scorePoints(a, points) {
  let total = 0, n = 0;
  points.forEach(p => {
    const r = a.reponses && a.reponses[p.id];
    const def = r && paReponse(r.r);
    if (!def || def.points === null) return;
    total += def.points; n++;
  });
  return n ? Math.round(total / n * 100) : null;
}
function scoresAudit(a) {
  const pts = paPoints();
  const themes = {};
  PREAUDIT.themes.forEach(t => { themes[t.id] = scorePoints(a, pts.filter(p => p.theme.id === t.id)); });
  const notes = pts.filter(p => a.reponses && a.reponses[p.id] && paReponse(a.reponses[p.id].r)).length;
  return { global:scorePoints(a, pts), themes:themes, notes:notes, total:pts.length };
}

/* Pour la vue multi-boutiques et la tour de contrôle : dernier pré-audit
   clôturé et actions encore ouvertes, tous pré-audits confondus. */
async function resumePreAudit() {
  const as = await lirePreAudits();
  const clos = as.filter(a => a.statut === 'clos')[0] || null;
  const ouvertes = [].concat(...as.map(paActions)).filter(x => !x.fait);
  return {
    score: clos ? clos.score : null,
    jour: clos ? clos.jour : null,
    enCours: !!as.filter(a => a.statut === 'en cours')[0],
    actionsOuvertes: ouvertes.length,
    actionsEnRetard: ouvertes.filter(paEnRetard).length
  };
}

/* Dernier score publié sous « preaudit:dernier » : la vue multi-boutiques
   (franchise.js) le lit dans le résumé de chaque boutique. Recalculé à chaque
   clôture et à chaque suppression. */
async function publierDernierPreAudit() {
  const clos = (await lirePreAudits()).filter(a => a.statut === 'clos')[0] || null;
  await DB.set('preaudit:dernier', clos
    ? { score:clos.score, jour:clos.jour, scores:clos.scores || {}, par:clos.closPar || '', at:nowISO() }
    : { score:null, jour:null, scores:{}, par:'', at:nowISO() });
}

/* Pour la tour de contrôle : [niveau, titre, texte, vue] ou null. Rien tant
   qu'aucun pré-audit n'a été fait : pas d'alerte pour un outil pas encore
   adopté. */
async function alertePreAudit() {
  const r = await resumePreAudit();
  if (r.actionsEnRetard) {
    return ['warn', r.actionsEnRetard + ' ' + accord(r.actionsEnRetard, 'action de pré-audit en retard', 'actions de pré-audit en retard'),
      'Leur échéance est passée. À régler avant le prochain audit Amorino.', 'preaudit'];
  }
  if (r.jour && !r.enCours && addD(r.jour, PREAUDIT.rappelJours) <= today()) {
    return ['warn', 'Pré-audit à refaire',
      'Le dernier date du ' + fmtD(r.jour) + ' (' + paScoreTxt(r.score) + '). Un par mois évite les surprises le jour de l’audit.', 'preaudit'];
  }
  return null;
}

/* ---------------------------------------------------------------------------
   Preuves tirées des registres
   Chaque preuve : { c:'ok'|'warn'|'bad'|'n', texte }. Elles sont recalculées
   tant que le pré-audit est en cours, puis figées à sa clôture.
   ------------------------------------------------------------------------ */
async function preuvesPreAudit(fin) {
  const debut = addD(fin, -(PREAUDIT.joursPreuves - 1));
  const jours = joursEntre(debut, fin);
  const P = {};
  const sur = ' sur ' + PREAUDIT.joursPreuves + ' jours';

  /* Températures : moments relevés et dépassements critiques. */
  let attendus = 0, faits = 0, crit = 0, critSansAction = 0, vitHors = 0, vitCrit = 0, vitMesures = 0;
  const vitrines = ENCEINTES.filter(e => /vitrine/i.test(e.nom));
  const pertes = [];
  let receptions = 0, refusees = 0;
  let netFaits = 0, netTotal = 0, joursSansNet = 0;
  /* Lus par paquets de cinq jours : l'un après l'autre, l'attente se comptait
     en dizaines de secondes ; tous d'un coup, 150 requêtes saturaient un Wi-Fi
     lent, et deux délais dépassés font passer l'appli hors ligne. */
  const lus = [];
  for (let i = 0; i < jours.length; i += 5) {
    lus.push(...await Promise.all(jours.slice(i, i + 5).map(d => Promise.all([
      DB.get('temp:' + d, null), DB.get('pertes:' + d, []), DB.get('reception:' + d, []), etatNettoyage(d)
    ]))));
  }
  /* Jours de fermeture et relevé du soir pas encore dû : pas attendus. */
  const ouverts = (typeof HORAIRES !== 'undefined' && HORAIRES.joursOuverture) || [1, 2, 3, 4, 5, 6, 7];
  jours.forEach((d, i) => {
    const t = lus[i][0] || {};
    const ouvert = ouverts.indexOf(jourISO(d)) >= 0;
    let critJour = false;
    RELEVES.moments.forEach(m => {
      const releve = releveMesure(t, m.id);
      if (releve || (ouvert && !(d === fin && m.id === 's'))) attendus++;
      if (releve) faits++;
      ENCEINTES.forEach(e => { if (etatTemp(e, t[m.id + '_' + e.id]) === 'crit') { crit++; critJour = true; } });
      vitrines.forEach(e => {
        const s = etatTemp(e, t[m.id + '_' + e.id]);
        if (s) vitMesures++;
        if (s === 'crit') vitCrit++;
        else if (s === 'rouge') vitHors++;
      });
    });
    if (critJour && !String(t.obs || '').trim()) critSansAction++;

    (Array.isArray(lus[i][1]) ? lus[i][1] : []).forEach(x => pertes.push(x));
    (Array.isArray(lus[i][2]) ? lus[i][2] : []).forEach(r => { receptions++; if (r && r.refuse) refusees++; });

    const n = lus[i][3];
    if (n.total) { netFaits += n.faits; netTotal += n.total; if (!n.faits) joursSansNet++; }
  });

  const taux = attendus ? faits / attendus : 0;
  P.temp = {
    c: (critSansAction || taux < 0.8) ? 'bad' : (crit || taux < 0.95) ? 'warn' : 'ok',
    texte: faits + ' relevés sur ' + attendus + sur +
      (crit ? ' · ' + crit + ' ' + accord(crit, 'dépassement critique', 'dépassements critiques') +
        (critSansAction ? ', dont ' + critSansAction + ' ' + accord(critSansAction, 'jour') + ' sans action corrective' : '') : ' · aucun dépassement')
  };

  P.vitrine = !vitrines.length || !vitMesures
    ? { c:'n', texte:'Aucun relevé de vitrine' + sur }
    : { c: vitCrit ? 'bad' : vitHors ? 'warn' : 'ok',
        texte: vitMesures + ' ' + accord(vitMesures, 'relevé') + ' de vitrine' + sur +
          (vitCrit || vitHors ? ' · ' + (vitCrit + vitHors) + ' hors de la plage' : ', tous dans la plage') };

  const rupt = (await DB.get('ruptures', [])).filter(r => r && (r.jour || '') >= debut);
  const ruptOuvertes = rupt.filter(r => !r.traite);
  P.ruptures = {
    c: ruptOuvertes.length ? 'bad' : rupt.length > 3 ? 'warn' : 'ok',
    texte: ruptOuvertes.length
      ? ruptOuvertes.length + ' ' + accord(ruptOuvertes.length, 'rupture non traitée', 'ruptures non traitées') + ' : ' +
        [...new Set(ruptOuvertes.map(r => r.article).filter(Boolean))].slice(0, 3).join(', ')
      : rupt.length + ' ' + accord(rupt.length, 'rupture signalée', 'ruptures signalées') + sur + ', toutes traitées'
  };

  /* Écart glace : dernier calcul clôturé (calcul.js). */
  P.ecart = { c:'n', texte:'Aucun calcul d’écart clôturé' };
  if (typeof lireCalculs === 'function' && typeof derniereCloture === 'function') {
    const c = derniereCloture(await lireCalculs());
    if (c) {
      const r = resultatCalcul(c);
      const st = r.incoherent ? { c:'bad' } : etatEcart(r.pct);
      P.ecart = { c:st.c, texte:'Calcul du ' + fmtDC(c.debut) + ' au ' + fmtDC(c.fin) + ' : ' + pctTxt(r) +
        (r.incoherent ? '' : ' (' + (r.ecart > 0.05 ? '+' : r.ecart < -0.05 ? '−' : '') + kgTxt(Math.abs(r.ecart)) + ')') };
    }
  }

  /* Lots ouverts sur la fenêtre, et produits entamés dépassés aujourd'hui. */
  const mois = jours.map(monthKey).filter((m, i, a) => a.indexOf(m) === i);
  let lots = 0;
  for (const m of mois) {
    const rec = await DB.get('lots:' + m, {});
    Object.keys(rec || {}).forEach(k => { const v = rec[k]; if (v && v.lot && v.ouv && v.ouv >= debut && v.ouv <= fin) lots++; });
  }
  P.lots = { c: lots ? 'ok' : 'warn', texte: lots ? lots + ' ' + accord(lots, 'lot noté', 'lots notés') + ' à l’ouverture' + sur : 'Aucun lot noté' + sur };

  const fifo = await calculFIFO(monthKey(fin));
  const depasses = fifo.filter(f => f.c === 'rouge');
  P.dlc = depasses.length
    ? { c:'bad', texte: depasses.length + ' ' + accord(depasses.length, 'produit dépassé', 'produits dépassés') + ' au frigo virtuel : ' +
        [...new Set(depasses.map(f => f.nom))].slice(0, 3).join(', ') }
    : { c:'ok', texte:'Aucun produit dépassé au frigo virtuel' };

  P.receptions = receptions
    ? { c:'ok', texte: receptions + ' ' + accord(receptions, 'réception enregistrée', 'réceptions enregistrées') + sur +
        ', DLC notées' + (refusees ? ' · ' + refusees + ' ' + accord(refusees, 'refusée', 'refusées') : '') }
    : { c:'warn', texte:'Aucune réception enregistrée' + sur };

  const sansMotif = pertes.filter(x => x && !String(x.motif || x.raison || '').trim()).length;
  P.pertes = pertes.length
    ? { c: sansMotif ? 'warn' : 'ok', texte: pertes.length + ' ' + accord(pertes.length, 'perte enregistrée', 'pertes enregistrées') + sur +
        (sansMotif ? ', ' + sansMotif + ' sans motif' : '') }
    : { c:'warn', texte:'Aucune perte enregistrée' + sur + ' : rien jeté, ou rien noté ?' };

  const tauxNet = netTotal ? netFaits / netTotal : 0;
  P.nettoyage = netTotal
    ? { c: tauxNet >= 0.9 ? 'ok' : tauxNet >= 0.7 ? 'warn' : 'bad',
        texte: netFaits + ' ' + accord(netFaits, 'tâche validée', 'tâches validées') + ' sur ' + netTotal + sur +
          (joursSansNet ? ' · ' + joursSansNet + ' ' + accord(joursSansNet, 'jour') + ' sans rien' : '') }
    : { c:'n', texte:'Aucune tâche de nettoyage prévue' + sur };

  return P;
}

/* ---------------------------------------------------------------------------
   Vue principale : en cours, plan d'actions, historique
   ------------------------------------------------------------------------ */
/* Redessin demandé par l'écran lui-même (V.preaudit._interne) : la grille
   ouverte reste ouverte. Arrivée depuis le menu ou la tour de contrôle : on
   repart de la liste, et rien n'est repris d'une copie en mémoire. */
const paRedessiner = () => { V.preaudit._interne = true; return rendre('preaudit'); };
V.preaudit = async function () {
  if (!V.preaudit._interne) { V.preaudit._id = null; V.preaudit._doc = null; }
  V.preaudit._interne = false;
  if (V.preaudit._id) return ecranGrille(V.preaudit._id);
  const as = await lirePreAudits();
  if (STATE.view !== 'preaudit') return;
  const enCours = as.filter(a => a.statut === 'en cours');
  const clos = as.filter(a => a.statut === 'clos');
  const dernier = clos[0] || null;
  const actions = [].concat(...as.map(a => paActions(a).map(x => ({ x:x, a:a }))));
  const ouvertes = actions.filter(o => !o.x.fait);
  const retard = ouvertes.filter(o => paEnRetard(o.x));

  if (!enCours.length) $('#vue-actions').innerHTML = '<button class="btn sm" id="pa-new">Nouveau</button>';

  $('#page').innerHTML =
    '<div class="grid g3">' +
      '<div class="kpi ' + (dernier ? paClasse(dernier.score) : '') + '"><div class="k">Dernier score</div>' +
        '<div class="v">' + (dernier ? dernier.score + '<span class="u">%</span>' : '—') + '</div>' +
        '<div class="d">' + (dernier ? esc(fmtD(dernier.jour)) : 'Aucun pré-audit') + '</div></div>' +
      '<div class="kpi"><div class="k">Actions ouvertes</div><div class="v">' + ouvertes.length + '</div>' +
        '<div class="d">' + (actions.length - ouvertes.length) + ' ' + accord(actions.length - ouvertes.length, 'faite', 'faites') + '</div></div>' +
      '<div class="kpi ' + (retard.length ? 'bad' : '') + '"><div class="k">En retard</div><div class="v">' + retard.length + '</div>' +
        '<div class="d">échéance passée</div></div>' +
    '</div>' +

    '<div class="stack" style="margin-top:12px">' +
    (enCours.length
      ? enCours.map(a => {
          const s = scoresAudit(a);
          return carte(
            '<div class="rang"><div style="flex:1"><h2>Pré-audit en cours</h2>' +
            '<div class="cs">Commencé le ' + esc(fmtD(a.jour)) + ' par ' + esc(a.par || '—') + ' · ' + s.notes + ' points sur ' + s.total +
            (s.global !== null ? ' · ' + s.global + ' % pour l’instant' : '') + '</div></div>' + pastille('ciel', 'EN COURS') + '</div>' +
            '<div class="jauge" style="margin-top:12px"><i style="width:' + Math.round(s.notes / s.total * 100) + '%"></i></div>' +
            '<div class="btn-row" style="margin-top:12px"><button class="btn fantome" data-pa-sup="' + esc(a.id) + '">Supprimer</button>' +
            '<button class="btn menthe" data-pa-ouvrir="' + esc(a.id) + '">Reprendre</button></div>', 'solide');
        }).join('')
      : carte(entete('', 'Faire un pré-audit',
          'La grille reprend les thèmes de l’audit trimestriel Amorino : hygiène, vitrine, quantités servies, affiches, ' +
          'traçabilité et nettoyage des machines. Comptez un quart d’heure, en faisant le tour de la boutique.') +
        '<p class="mini" style="margin-top:8px">Les relevés des frigos, le nettoyage, les lots, les réceptions, les pertes et le dernier ' +
          'calcul d’écart des ' + PREAUDIT.joursPreuves + ' derniers jours s’affichent à côté des points qu’ils prouvent.</p>' +
        '<button class="btn menthe bloc xl" id="pa-new2" style="margin-top:12px">Commencer le pré-audit</button>')) +
    '</div>' +

    '<div class="entete" style="margin-top:18px"><h3>Plan d’actions</h3></div>' +
    (ouvertes.length
      ? '<div class="stack">' + ouvertes.map(o => carteAction(o.x, o.a, true)).join('') + '</div>'
      : vide('', actions.length ? 'Toutes les actions sont faites.' : 'Aucune action pour l’instant. Elles se créent depuis la grille, sur un point à reprendre ou non conforme.')) +

    '<div class="entete" style="margin-top:18px"><h3>Pré-audits clôturés</h3></div>' +
    (clos.length
      ? '<div class="dense"><div class="dense-h"><span class="c1">Date</span><span class="c w">Actions</span><span class="c w">Score</span></div>' +
        clos.slice(0, 24).map(a => {
          const n = paActions(a).filter(x => !x.fait).length;
          return '<div class="dl" data-pa-voir="' + esc(a.id) + '" role="button" tabindex="0" style="cursor:pointer">' +
            '<span class="c1">' + esc(fmtD(a.jour)) + ' · ' + esc(a.closPar || a.par || '') + '</span>' +
            '<span class="c w">' + (n ? n + ' ' + accord(n, 'ouverte', 'ouvertes') : '—') + '</span>' +
            '<span class="c w">' + pastille(paClasse(a.score), paScoreTxt(a.score)) + '</span></div>';
        }).join('') + '</div>'
      : vide('', 'Aucun pré-audit clôturé pour l’instant.'));

  const nouveau = () => demarrerPreAudit();
  if ($('#pa-new')) $('#pa-new').onclick = nouveau;
  if ($('#pa-new2')) $('#pa-new2').onclick = nouveau;
  const ouvrir = id => { V.preaudit._id = id; V.preaudit._doc = null; paRedessiner(); window.scrollTo(0, 0); };
  $$('[data-pa-ouvrir]').forEach(b => b.onclick = () => ouvrir(b.dataset.paOuvrir));
  $$('[data-pa-voir]').forEach(b => {
    b.onclick = () => ouvrir(b.dataset.paVoir);
    b.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvrir(b.dataset.paVoir); } };
  });
  $$('[data-pa-sup]').forEach(b => b.onclick = () => {
    const a = as.filter(x => x.id === b.dataset.paSup)[0];
    if (!a) return;
    confirmer('Supprimer ce pré-audit ?', 'Commencé le ' + fmtD(a.jour) + '. Les réponses et ses actions seront perdues.',
      'Supprimer', async () => {
        const etaitClos = a.statut === 'clos';
        await paEcrire(a, { statut:'supprime', suppPar:STATE.user.prenom, suppAt:nowISO() });
        await feed('ok', STATE.user.prenom + ' a supprimé le pré-audit du ' + fmtD(a.jour));
        if (etaitClos) await publierDernierPreAudit();
        paRedessiner();
      });
  });
  brancherActions(as);
};

function carteAction(x, a, avecOrigine) {
  const pt = paPoints().filter(p => p.id === x.point)[0];
  const etat = x.fait ? pastille('ok', 'Faite')
    : paEnRetard(x) ? pastille('bad', 'En retard')
    : x.echeance ? pastille('n', 'Pour le ' + fmtDC(x.echeance)) : pastille('n', 'Sans échéance');
  return '<div class="card">' +
    '<div class="rang"><div style="flex:1"><b>' + esc(x.texte) + '</b>' +
    '<div class="cs">' + esc(x.resp || 'Sans responsable') +
      (x.echeance ? ' · échéance ' + esc(fmtD(x.echeance)) : '') +
      (avecOrigine && pt ? ' · ' + esc(pt.theme.nom) : '') +
      (x.fait ? ' · faite par ' + esc(x.faitPar || '') + (x.faitAt ? ' le ' + esc(fmtDC(isoOf(new Date(x.faitAt)))) : '') : '') +
    '</div></div>' + etat + '</div>' +
    '<div class="btn-row" style="margin-top:10px">' +
      '<button class="btn fantome sm" data-pa-act-modif="' + esc(a.id) + '|' + esc(x.id) + '">Modifier</button>' +
      '<button class="btn ' + (x.fait ? 'clair' : 'menthe') + ' sm" data-pa-act-fait="' + esc(a.id) + '|' + esc(x.id) + '">' +
        (x.fait ? 'Rouvrir' : 'C’est fait') + '</button>' +
    '</div></div>';
}

/* Boutons des cartes d'action, sur la liste comme dans la grille. */
function brancherActions(as) {
  const trouver = v => {
    const [aid, xid] = String(v).split('|');
    const a = as.filter(y => y.id === aid)[0];
    return a ? { a:a, x:(a.actions || {})[xid] } : null;
  };
  $$('[data-pa-act-fait]').forEach(b => b.onclick = async () => {
    const t = trouver(b.dataset.paActFait);
    if (!t || !t.x) return;
    const x = Object.assign({}, t.x, t.x.fait
      ? { fait:false, faitPar:null, faitAt:null }
      : { fait:true, faitPar:STATE.user.prenom, faitAt:nowISO() });
    await ecrireAction(t.a, x);
    if (x.fait) await feed('ok', STATE.user.prenom + ' a fait l’action de pré-audit « ' + x.texte + ' »');
    toast(x.fait ? 'Action faite' : 'Action rouverte');
    paRedessiner();
  });
  $$('[data-pa-act-modif]').forEach(b => b.onclick = () => {
    const t = trouver(b.dataset.paActModif);
    if (t && t.x) feuilleAction(t.a, t.x.point, t.x);
  });
}

async function ecrireAction(a, x) {
  await paEcrire(a, { ['a:' + x.id]:x });
}

/* ---------------------------------------------------------------------------
   Démarrage
   ------------------------------------------------------------------------ */
async function demarrerPreAudit() {
  const as = await lirePreAudits();
  const deja = as.filter(a => a.statut === 'en cours')[0];
  if (deja) { V.preaudit._id = deja.id; return paRedessiner(); }
  const j = today();
  const a = { id:'preaudit:' + j + ':' + uid(), jour:j, statut:'en cours',
              par:STATE.user.prenom, at:nowISO() };
  await DB.set(a.id, a);
  await feed('ok', STATE.user.prenom + ' a commencé un pré-audit Amorino');
  V.preaudit._id = a.id;
  V.preaudit._doc = paNormaliser(a);
  paRedessiner();
  window.scrollTo(0, 0);
}

/* ---------------------------------------------------------------------------
   Grille
   ------------------------------------------------------------------------ */
async function ecranGrille(id) {
  /* Copie en mémoire, le temps des redessins de cet écran : chaque réponse
     s'affiche tout de suite, sans attendre la relecture réseau (jusqu'à 8 s
     sur le Wi-Fi de la boutique). Elle est relue à chaque arrivée sur l'écran. */
  let a = (V.preaudit._doc && V.preaudit._doc.id === id) ? V.preaudit._doc : paNormaliser(await DB.get(id, null));
  if (STATE.view !== 'preaudit') return;
  if (!a || a.statut === 'supprime') { V.preaudit._id = null; V.preaudit._doc = null; return V.preaudit(); }
  V.preaudit._doc = a;
  const clos = a.statut === 'clos';

  $('#vue-titre').textContent = clos ? 'Pré-audit du ' + fmtDC(a.jour) : 'Pré-audit en cours';
  $('#vue-sous').textContent = clos ? 'Clôturé par ' + (a.closPar || '—') : 'Commencé le ' + fmtD(a.jour) + ' par ' + (a.par || '—');
  $('#vue-actions').innerHTML = '<button class="btn sm clair" id="pa-retour">Retour</button>';
  $('#pa-retour').onclick = () => { V.preaudit._id = null; V.preaudit._doc = null; paRedessiner(); window.scrollTo(0, 0); };

  /* Preuves : figées à la clôture ; sinon calculées une fois par pré-audit et
     par jour, et recalculées au moment de clôturer. */
  let P = clos ? (a.preuves || {}) : V.preaudit._preuves;
  if (!clos && (!P || V.preaudit._preuvesDe !== a.id + '|' + today())) {
    $('#page').innerHTML = '<div class="vide">Lecture des registres des ' + PREAUDIT.joursPreuves + ' derniers jours…</div>';
    P = await preuvesPreAudit(today());
    if (STATE.view !== 'preaudit' || V.preaudit._id !== id) return;
    V.preaudit._preuves = P; V.preaudit._preuvesDe = a.id + '|' + today();
  }

  const s = scoresAudit(a);
  const parPoint = {};
  paActions(a).forEach(x => { (parPoint[x.point] = parPoint[x.point] || []).push(x); });

  const lignePoint = p => {
    const r = a.reponses[p.id] || {};
    const pr = p.preuve && P[p.preuve];
    return '<div class="pa-pt" id="pa-' + esc(p.id) + '">' +
      '<div class="pa-lib">' + esc(p.libelle) + '</div>' +
      (pr ? '<div class="pa-preuve">' + pastille(pr.c, pr.c === 'ok' ? 'Registre OK' : pr.c === 'warn' ? 'À vérifier' : pr.c === 'bad' ? 'Écart' : 'Registre') +
        ' <span class="mini">' + esc(pr.texte) + '</span></div>' : '') +
      (r.note ? '<div class="mini" style="margin-top:6px">Constat : ' + esc(r.note) + '</div>' : '') +
      (clos
        ? '<div style="margin-top:8px">' + (paReponse(r.r) ? pastille(paReponse(r.r).pill, paReponse(r.r).label) : pastille('n', 'Non noté')) + '</div>'
        : '<div class="chips pa-rep" style="margin-top:10px">' + PREAUDIT.reponses.map(d =>
            '<button type="button" class="chip' + (d.id === 'c' ? ' menthe' : d.id === 'p' ? ' ambre' : d.id === 'nc' ? ' corail' : '') +
            (r.r === d.id ? ' on' : '') + '" data-pa-r="' + esc(p.id) + '|' + d.id + '" aria-pressed="' + (r.r === d.id) + '">' +
            esc(d.label) + '</button>').join('') +
          ((r.r === 'p' || r.r === 'nc') ? '<button type="button" class="chip" data-pa-plus="' + esc(p.id) + '">+ Action</button>' : '') +
          '</div>') +
      ((parPoint[p.id] || []).length ? '<div class="stack" style="margin-top:10px">' + parPoint[p.id].map(x => carteAction(x, a, false)).join('') + '</div>' : '') +
      '</div>';
  };

  $('#page').innerHTML =
    '<div class="grid g3">' +
      '<div class="kpi ' + paClasse(s.global) + '"><div class="k">' + (clos ? 'Score' : 'Score provisoire') + '</div>' +
        '<div class="v">' + (s.global === null ? '—' : s.global + '<span class="u">%</span>') + '</div>' +
        '<div class="d">' + s.notes + ' points notés sur ' + s.total + '</div></div>' +
      '<div class="kpi"><div class="k">Non conformes</div><div class="v">' +
        paPoints().filter(p => (a.reponses[p.id] || {}).r === 'nc').length + '</div>' +
        '<div class="d">' + paPoints().filter(p => (a.reponses[p.id] || {}).r === 'p').length + ' à reprendre</div></div>' +
      '<div class="kpi"><div class="k">Actions</div><div class="v">' + paActions(a).filter(x => !x.fait).length + '</div>' +
        '<div class="d">ouvertes sur ' + paActions(a).length + '</div></div>' +
    '</div>' +
    (clos ? '' : '<p class="mini" style="margin:12px 2px 0">Faites le tour de la boutique et notez chaque point. Un point « À reprendre » ou ' +
      '« Non conforme » propose une action, avec un responsable et une échéance. Les registres de l’appli sont rappelés sous les points qu’ils prouvent.</p>') +
    '<div class="stack" style="margin-top:12px">' +
    PREAUDIT.themes.map(t => {
      const pts = paPoints().filter(p => p.theme.id === t.id);
      const st = s.themes[t.id];
      return carte('<div class="rang"><h2 style="flex:1">' + esc(t.nom) + '</h2>' + pastille(paClasse(st), paScoreTxt(st)) + '</div>' +
        pts.map(lignePoint).join(''), 'solide');
    }).join('') + '</div>' +
    '<div class="btn-row" style="margin-top:16px">' +
      (clos
        ? '<button class="btn ciel bloc" id="pa-pdf">Exporter en PDF</button>'
        : '<button class="btn clair" id="pa-pdf">Aperçu PDF</button>' +
          '<button class="btn menthe" id="pa-clore">Clôturer le pré-audit</button>') +
    '</div>';

  $$('[data-pa-r]').forEach(b => b.onclick = () => {
    const [pid, rid] = b.dataset.paR.split('|');
    repondre(a, pid, rid);
  });
  $$('[data-pa-plus]').forEach(b => b.onclick = () => feuilleAction(a, b.dataset.paPlus, null));
  $('#pa-pdf').onclick = () => imprimerPreAudit(a, P);
  if ($('#pa-clore')) $('#pa-clore').onclick = () => cloturerPreAudit(a);
  brancherActions([a]);
}

/* Une réponse : écrite aussitôt, sans attendre. Un point à reprendre ou non
   conforme ouvre la feuille d'action, une seule fois par point. */
function repondre(a, pid, rid) {
  const avant = a.reponses[pid] || {};
  /* Toucher la réponse déjà choisie la retire. */
  const r = avant.r === rid ? null : rid;
  const val = Object.assign({}, avant, { r:r, par:STATE.user.prenom, at:nowISO() });
  a.reponses = Object.assign({}, a.reponses, { [pid]:val });
  paEcrire(a, { ['r:' + pid]:val }).then(d => {
    /* Clôturé ou supprimé entre-temps sur un autre iPad. */
    if (d.statut !== 'en cours' && STATE.view === 'preaudit' && V.preaudit._id === a.id) {
      toast('Ce pré-audit a été ' + (d.statut === 'clos' ? 'clôturé' : 'supprimé') + ' sur un autre appareil', 'erreur');
      paRedessiner();
    }
  });
  paRedessiner();
  const dejaUneAction = paActions(a).some(x => x.point === pid);
  if ((r === 'p' || r === 'nc') && !dejaUneAction) feuilleAction(a, pid, null);
}

function feuilleAction(a, pid, x) {
  const p = paPoints().filter(q => q.id === pid)[0];
  if (!p) return;
  const r = (a.reponses || {})[pid] || {};
  const noms = (typeof EQUIPE !== 'undefined' ? EQUIPE : []).map(e => e && e.prenom).filter(Boolean);
  const resp = x ? x.resp : STATE.user.prenom;
  if (resp && noms.indexOf(resp) < 0) noms.unshift(resp);
  showSheet(
    '<h2 id="sheet-titre">' + (x ? 'Modifier l’action' : 'Que faut-il corriger ?') + '</h2>' +
    '<p class="sub">' + esc(p.theme.nom) + ' · ' + esc(p.libelle) + '</p>' +
    '<div class="champ" style="margin-top:14px"><label class="f" for="pa-note">Constat</label>' +
      '<textarea id="pa-note" placeholder="Ce qui a été vu, en quelques mots">' + esc(r.note || '') + '</textarea></div>' +
    '<div class="champ"><label class="f" for="pa-txt">Action à mener</label>' +
      '<input type="text" id="pa-txt" data-autofocus value="' + esc(x ? x.texte : '') + '" placeholder="Ex. Racheter des essuie-mains jetables"></div>' +
    '<div class="grid g2" style="margin-top:14px">' +
      '<div class="champ"><label class="f" for="pa-resp">Responsable</label><select id="pa-resp">' +
        noms.map(n => '<option' + (n === resp ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select></div>' +
      '<div class="champ"><label class="f" for="pa-ech">Échéance</label>' +
        '<input type="date" id="pa-ech" value="' + esc(x ? (x.echeance || '') : addD(today(), PREAUDIT.delaiAction)) + '"></div>' +
    '</div>' +
    '<div class="actions">' +
      (x ? '<button class="btn fantome" id="pa-act-sup">Supprimer</button>' : '<button class="btn clair" id="pa-sans">Sans action</button>') +
      '<button class="btn menthe" id="pa-act-ok">Enregistrer</button></div>');

  const noter = () => {
    const note = $('#pa-note').value.trim();
    if (note === (r.note || '')) return;
    const val = Object.assign({}, r, { note:note });
    a.reponses = Object.assign({}, a.reponses, { [pid]:val });
    paEcrire(a, { ['r:' + pid]:val });
  };
  if ($('#pa-sans')) $('#pa-sans').onclick = () => { noter(); closeSheet(); paRedessiner(); };
  if ($('#pa-act-sup')) $('#pa-act-sup').onclick = async () => {
    await ecrireAction(a, Object.assign({}, x, { supprime:true, suppPar:STATE.user.prenom, suppAt:nowISO() }));
    noter(); closeSheet(); toast('Action supprimée'); paRedessiner();
  };
  $('#pa-act-ok').onclick = async () => {
    const texte = $('#pa-txt').value.trim();
    if (!texte) { toast('Décrivez l’action à mener', 'erreur'); return $('#pa-txt').focus(); }
    noter();
    const nx = Object.assign({ id:uid(), point:pid, fait:false, creePar:STATE.user.prenom, creeAt:nowISO() }, x || {},
      { texte:texte, resp:$('#pa-resp').value, echeance:$('#pa-ech').value || '' });
    await ecrireAction(a, nx);
    closeSheet();
    toast(x ? 'Action modifiée' : 'Action ajoutée au plan');
    paRedessiner();
  };
}

/* ---------------------------------------------------------------------------
   Clôture
   ------------------------------------------------------------------------ */
function cloturerPreAudit(a) {
  const s = scoresAudit(a);
  const manque = s.total - s.notes;
  if (manque) {
    const premier = paPoints().filter(p => !paReponse((a.reponses[p.id] || {}).r))[0];
    toast(manque + ' ' + accord(manque, 'point') + ' à noter avant de clôturer', 'erreur');
    const el = premier && document.getElementById('pa-' + premier.id);
    if (el) el.scrollIntoView({ behavior:'smooth', block:'center' });
    return;
  }
  const sansAction = paPoints().filter(p => ['p', 'nc'].indexOf((a.reponses[p.id] || {}).r) >= 0 &&
    !paActions(a).some(x => x.point === p.id)).length;
  if (s.global === null) { toast('Tous les points sont « Sans objet » : aucun score possible', 'erreur'); return; }
  confirmer('Clôturer le pré-audit ?',
    'Score : ' + s.global + ' %. ' +
    (sansAction ? sansAction + ' ' + accord(sansAction, 'point à corriger n’a', 'points à corriger n’ont') + ' pas d’action. ' : '') +
    'Les réponses et les preuves des registres seront figées. Les actions restent à suivre.',
    'Clôturer', async () => {
      /* Preuves relues au moment de clôturer : celles de l'ouverture peuvent
         dater de plusieurs jours. Score recalculé sur la copie relue. */
      toast('Lecture des registres…');
      const P = await preuvesPreAudit(today());
      const frais = paNormaliser(await DB.get(a.id, null));
      if (!frais || frais.statut !== 'en cours') { toast('Ce pré-audit n’est plus en cours', 'erreur'); return paRedessiner(); }
      const sf = scoresAudit(frais);
      await paEcrire(a, { statut:'clos', score:sf.global, scores:sf.themes, preuves:P,
                          closPar:STATE.user.prenom, closAt:nowISO() });
      s.global = sf.global;
      await feed('ok', STATE.user.prenom + ' a clôturé le pré-audit Amorino : ' + s.global + ' %');
      await publierDernierPreAudit();
      toast('Pré-audit clôturé : ' + s.global + ' %');
      paRedessiner();
      window.scrollTo(0, 0);
    });
}

/* ---------------------------------------------------------------------------
   Export PDF (fenêtre d'impression, comme le registre sanitaire)
   ------------------------------------------------------------------------ */
async function imprimerPreAudit(a, P) {
  const s = scoresAudit(a);
  const clos = a.statut === 'clos';
  const acts = paActions(a);
  const rep = id => paReponse((a.reponses[id] || {}).r);
  $('#printview').innerHTML =
    '<div class="pv-h"><h1>Pré-audit Amorino · ' + esc(APP.nom) + '</h1>' +
    '<div>' + esc(APP.site) + ' · ' + (clos ? 'pré-audit du ' + fmtD(a.jour) + ', clôturé par ' + esc(a.closPar || '—')
      : 'pré-audit en cours, commencé le ' + fmtD(a.jour) + ' (document provisoire)') +
    '<br>Édité le ' + new Date().toLocaleString(APP.locale) + ' par ' + esc(STATE.user.prenom) + '</div></div>' +

    '<div class="pv-s">1. Score</div>' +
    '<table><thead><tr><th>Thème</th><th>Points notés</th><th>Score</th></tr></thead><tbody>' +
    PREAUDIT.themes.map(t => {
      const pts = paPoints().filter(p => p.theme.id === t.id);
      return '<tr><td>' + esc(t.nom) + '</td><td>' + pts.filter(p => rep(p.id)).length + ' / ' + pts.length + '</td>' +
        '<td>' + paScoreTxt(s.themes[t.id]) + '</td></tr>';
    }).join('') +
    '<tr><th>Score global</th><th>' + s.notes + ' / ' + s.total + '</th><th>' + paScoreTxt(s.global) + '</th></tr></tbody></table>' +
    '<div style="font-size:9.5px">Conforme = 1 point, à reprendre = ½, non conforme = 0 ; « sans objet » ne compte pas. ' +
    'Grille d’auto-contrôle inspirée des thèmes de l’audit trimestriel Amorino, pas la grille officielle.</div>' +

    '<div class="pv-s">2. Grille</div>' +
    '<table><thead><tr><th>Thème</th><th>Point contrôlé</th><th>Résultat</th><th>Constat</th></tr></thead><tbody>' +
    PREAUDIT.themes.map(t => t.points.map((p, i) => {
      const d = rep(p[0]);
      return '<tr><td>' + (i ? '' : esc(t.nom)) + '</td><td>' + esc(p[1]) + '</td>' +
        '<td' + (d && d.id === 'nc' ? ' style="font-weight:700"' : '') + '>' + (d ? esc(d.label) : '—') + '</td>' +
        '<td>' + esc((a.reponses[p[0]] || {}).note || '') + '</td></tr>';
    }).join('')).join('') + '</tbody></table>' +

    '<div class="pv-s">3. Preuves tirées des registres (' + PREAUDIT.joursPreuves + ' jours avant le pré-audit)</div>' +
    '<table><thead><tr><th>Point</th><th>Registre</th><th>État</th></tr></thead><tbody>' +
    paPoints().filter(p => p.preuve && P && P[p.preuve]).map(p =>
      '<tr><td>' + esc(p.libelle) + '</td><td>' + esc(P[p.preuve].texte) + '</td>' +
      '<td>' + ({ ok:'Conforme', warn:'À vérifier', bad:'Écart', n:'—' }[P[p.preuve].c] || '—') + '</td></tr>').join('') +
    '</tbody></table>' +

    '<div class="pv-s">4. Plan d’actions</div>' +
    (acts.length
      ? '<table><thead><tr><th>Action</th><th>Point</th><th>Responsable</th><th>Échéance</th><th>État</th></tr></thead><tbody>' +
        acts.map(x => {
          const p = paPoints().filter(q => q.id === x.point)[0];
          return '<tr><td>' + esc(x.texte) + '</td><td>' + esc(p ? p.libelle : '') + '</td><td>' + esc(x.resp || '') + '</td>' +
            '<td>' + (x.echeance ? esc(x.echeance.split('-').reverse().join('/')) : '') + '</td>' +
            '<td>' + (x.fait ? 'Faite' + (x.faitAt ? ' le ' + isoOf(new Date(x.faitAt)).split('-').reverse().join('/') : '') : paEnRetard(x) ? 'EN RETARD' : 'À faire') + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<div>Aucune action.</div>') +

    '<div class="sign">Document généré à partir des réponses saisies dans ' + esc(APP.nom) + ' et des registres horodatés de la boutique.<br><br>' +
    'Responsable de boutique : ____________________  Signature : ____________________<br><br>' +
    'Franchisé : ____________________  Signature : ____________________  Date : ____ / ____ / ________</div>';

  await feed('ok', STATE.user.prenom + ' a imprimé le pré-audit du ' + fmtD(a.jour));
  setTimeout(() => window.print(), 200);
}
