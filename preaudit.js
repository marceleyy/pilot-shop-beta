/* =============================================================================
   PILOT-SHOP — preaudit.js
   Pré-audit : contrôle automatique du contenu de l'appli, sans grille à
   remplir. Chaque contrôle lit ce que l'équipe a déjà saisi (traçabilité,
   ouvertures, relevés, nettoyage, caisse, écarts, inventaires, réceptions,
   pertes) et sort en vert, orange ou rouge, avec le produit ou le jour en
   cause et l'écran où corriger. Les jours de fermeture ne comptent pas.
   L'audit Amorino lui-même se fait dans l'outil du réseau : ici, on vérifie
   seulement que les registres de l'appli sont tenus.
   La page garde aussi l'historique des passages de l'animateur réseau
   (visite ou contrôle) et les tâches qu'il demande : celles-ci vivent dans le
   module Tâches et réparations (taches.js), catégorie « audit ».
   Chargé après app.js, modules.js, stock.js et calcul.js.
   ============================================================================= */

   'use strict';

PAGES.preaudit = { titre:'Pré-audit', sous:'Contrôle des données de l’appli' };
if (MENU_PLUS.manager.indexOf('preaudit') < 0) {
  MENU_PLUS.manager.splice(MENU_PLUS.manager.indexOf('calcul') + 1, 0, 'preaudit');
}

const PREAUDIT = {
  /* Fenêtre contrôlée, en jours calendaires (les jours fermés n'y comptent pas). */
  fenetre: 30,
  /* Score en % : vert au-dessus de ok, orange au-dessus de warn. */
  seuils: { ok:85, warn:70 },
  /* Chantilly : une brique ouverte vit 48 h, il en faut une au moins tous les
     2 jours ouverts. */
  chantillyJours: 2,
  /* Coulis et toppings en stock : au-delà de ce nombre de jours ouverts sans
     ouverture tracée, le flacon entamé est gardé trop longtemps, ou ses
     ouvertures ne sont pas notées. Rouge au double. */
  sansOuverture: { coulis:30, topping:60 },
  /* Historique des ouvertures lu pour les coulis et toppings. */
  lectureJours: 120,
  /* Inventaire chambre froide et sec : à refaire passé ce nombre de jours
     ouverts. Rouge au double. */
  inventaireJours: 31,
  /* Un passage de l'animateur prévu dans ce délai remonte en tour de contrôle. */
  alerteAvantPassage: 7,
  /* Les résultats restent en mémoire ce temps-là (lecture de 30 jours de registres). */
  cacheMs: 10 * 60 * 1000,
  blocs: [
    { id:'vitrine', nom:'Glaces et vitrine' },
    { id:'compl',   nom:'Produits complémentaires' },
    { id:'temp',    nom:'Températures' },
    { id:'net',     nom:'Nettoyage et caisse' },
    { id:'stock',   nom:'Stock et écarts' },
    { id:'recep',   nom:'Réceptions et pertes' }
  ],
  typesPassage: [
    { id:'visite',   label:'Visite' },
    { id:'controle', label:'Contrôle' }
  ]
};

/* Passages de l'animateur : un seul document, un champ « p:<id> » par passage,
   écrit avec DB.patch (deux iPads ne s'écrasent pas). */
const PA_PASSAGES = 'preaudit:passages';
/* Pré-audits enregistrés (instantanés) : « preaudit:<jour>:<id> ». Les anciens
   pré-audits de la grille Amorino gardent la même clé et restent listés. */
const PA_RE = /^preaudit:\d{4}-\d{2}-\d{2}:/;

const paClasse = s => s === null || s === undefined ? 'n' : s >= PREAUDIT.seuils.ok ? 'ok' : s >= PREAUDIT.seuils.warn ? 'warn' : 'bad';
const paScoreTxt = s => s === null || s === undefined ? '—' : s + ' %';
const PA_POINTS = { ok:1, warn:0.5, bad:0 };
const PA_ETAT = { ok:'OK', warn:'À surveiller', bad:'À corriger', n:'Sans objet' };
/* Score saisi (94.81) affiché à la française : « 94,81 % ». */
const paPct = v => v === null || v === undefined || v === '' ? '' : String(v).replace('.', ',') + ' %';
const paTypeLabel = id => (PREAUDIT.typesPassage.filter(t => t.id === id)[0] || { label:'Passage' }).label;
const paNorm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/* Jours ouverts strictement après « de », jusqu'à « a » inclus. */
const paOuvertsApres = (de, a) => de >= a ? 0 : joursEntre(addD(de, 1), a).filter(jourOuvert).length;
const paListe = (l, n) => l.slice(0, n || 3).join(', ') + (l.length > (n || 3) ? '…' : '');

/* Score d'une liste de contrôles : OK 1, à surveiller ½, à corriger 0,
   sans objet hors du compte. null si rien n'est noté. */
function scoreControles(l) {
  let t = 0, n = 0;
  (l || []).forEach(x => { if (x && x.c in PA_POINTS) { t += PA_POINTS[x.c]; n++; } });
  return n ? Math.round(t / n * 100) : null;
}
function scoresPreAudit(controles) {
  const blocs = {};
  PREAUDIT.blocs.forEach(b => { blocs[b.id] = scoreControles(controles.filter(x => x.bloc === b.id)); });
  return { global:scoreControles(controles), blocs:blocs };
}

/* ---------------------------------------------------------------------------
   Contrôles
   Chaque contrôle : { bloc, id, lib, c:'ok'|'warn'|'bad'|'n', texte, vue }.
   ------------------------------------------------------------------------ */
async function controlesPreAudit(fin, nbJours, finDue) {
  /* nbJours : fenêtre plus courte pour la tour de contrôle (7 jours).
     finDue : le dernier jour est déjà écoulé (fenêtre arrêtée à hier), ses
     relevés et sa caisse sont donc dus comme les autres jours. */
  const nbJ = nbJours || PREAUDIT.fenetre;
  /* Fermetures à jour avant de compter les jours attendus (config.js). */
  const hz = await DB.get('horaires', null).catch(() => null);
  if (hz && Array.isArray(hz.fermetures)) HORAIRES.fermetures = hz.fermetures;

  const debut = addD(fin, -(nbJ - 1));
  const jours = joursEntre(debut, fin);
  const ouverts = jours.filter(jourOuvert);
  const sur = ' en ' + nbJ + ' jours';
  const C = [];
  const add = (bloc, id, lib, c, texte, vue) => C.push({ bloc:bloc, id:id, lib:lib, c:c, texte:texte, vue:vue || '' });

  /* Registres du jour, lus par paquets de cinq jours : tous d'un coup, 150
     requêtes saturaient un Wi-Fi lent ; un par un, l'attente se comptait en
     dizaines de secondes. */
  if (typeof DB.prelire === 'function' && typeof clesEtatJour === 'function') {
    DB.prelire([].concat(...jours.map(d => clesEtatJour(d).concat(['pertes:' + d, 'reception:' + d]))));
  }
  const lus = [];
  for (let i = 0; i < jours.length; i += 5) {
    lus.push(...await Promise.all(jours.slice(i, i + 5).map(d => Promise.all([
      DB.get('temp:' + d, null).catch(() => null), DB.get('pertes:' + d, []).catch(() => []),
      DB.get('reception:' + d, []).catch(() => []),
      etatJour(d).catch(() => ({}))
    ]))));
  }

  /* --- Températures, nettoyage, caisse, pertes, réceptions -------------- */
  let attendus = 0, faits = 0, crit = 0, critSansAction = 0, vitHors = 0, vitCrit = 0, vitMesures = 0;
  const vitrines = ENCEINTES.filter(e => /vitrine/i.test(e.nom));
  const pertes = [];
  let receptions = 0, refusees = 0;
  let netFaits = 0, netTotal = 0;
  const joursSansNet = [], joursSansCaisse = [], joursCritSansAction = [];
  jours.forEach((d, i) => {
    const t = lus[i][0] || {};
    const st = lus[i][3] || {};
    const ouvert = jourOuvert(d);
    let critJour = false;
    RELEVES.moments.forEach(m => {
      const releve = releveMesure(t, m.id);
      /* Jour fermé, ou relevé d'aujourd'hui (pas forcément encore dû) : pas attendu. */
      if (releve || (ouvert && (finDue || d !== fin))) attendus++;
      if (releve) faits++;
      ENCEINTES.forEach(e => { if (etatTemp(e, t[m.id + '_' + e.id]) === 'crit') { crit++; critJour = true; } });
      vitrines.forEach(e => {
        const s = etatTemp(e, t[m.id + '_' + e.id]);
        if (s) vitMesures++;
        if (s === 'crit') vitCrit++;
        else if (s === 'rouge') vitHors++;
      });
    });
    if (critJour && !String(t.obs || '').trim()) { critSansAction++; joursCritSansAction.push(fmtDC(d)); }

    (Array.isArray(lus[i][1]) ? lus[i][1] : []).forEach(x => { if (x && !x.supprime) pertes.push(x); });
    (Array.isArray(lus[i][2]) ? lus[i][2] : []).forEach(r => { receptions++; if (r && r.refuse) refusees++; });

    if (!ouvert) return;
    if (st.netTotal) { netFaits += num(st.net); netTotal += num(st.netTotal); if (!num(st.net)) joursSansNet.push(fmtDC(d)); }
    /* La caisse du jour se ferme le soir : aujourd'hui n'est pas encore dû. */
    if ((finDue || d !== fin) && !st.caisse) joursSansCaisse.push(fmtDC(d));
  });

  if (!attendus) {
    add('temp', 'releves', 'Relevés matin et soir', 'n', 'Aucun relevé attendu' + sur + ' (boutique fermée)', 'temp');
  } else {
    const taux = faits / attendus;
    add('temp', 'releves', 'Relevés matin et soir',
      taux < 0.8 ? 'bad' : taux < 0.95 ? 'warn' : 'ok',
      faits + ' relevés faits sur ' + attendus + ' attendus' + sur, 'temp');
  }
  add('temp', 'crit', 'Dépassements critiques suivis d’une action',
    critSansAction ? 'bad' : 'ok',
    !crit ? 'Aucun dépassement critique' + sur
      : crit + ' ' + accord(crit, 'dépassement critique', 'dépassements critiques') +
        (critSansAction ? ', sans action corrective notée le ' + paListe(joursCritSansAction) : ', tous avec une action notée'), 'temp');
  add('temp', 'vitrine', 'Vitrine dans sa plage',
    !vitrines.length || !vitMesures ? 'n' : vitCrit ? 'bad' : vitHors ? 'warn' : 'ok',
    !vitrines.length || !vitMesures ? 'Aucun relevé de vitrine' + sur
      : vitMesures + ' ' + accord(vitMesures, 'relevé') + ' de vitrine' +
        (vitCrit || vitHors ? ', dont ' + (vitCrit + vitHors) + ' hors de la plage' : ', tous dans la plage'), 'temp');

  if (!netTotal) {
    add('net', 'nettoyage', 'Tâches de nettoyage validées', 'n', 'Aucune tâche de nettoyage prévue' + sur, 'clean');
  } else {
    const tauxNet = netFaits / netTotal;
    add('net', 'nettoyage', 'Tâches de nettoyage validées',
      joursSansNet.length > 2 || tauxNet < 0.7 ? 'bad' : joursSansNet.length || tauxNet < 0.9 ? 'warn' : 'ok',
      netFaits + ' ' + accord(netFaits, 'tâche validée', 'tâches validées') + ' sur ' + netTotal + ' prévues' + sur +
        (joursSansNet.length ? ' · rien de validé le ' + paListe(joursSansNet) : ''), 'clean');
  }
  const ouvertsPasses = ouverts.filter(d => finDue || d !== fin).length;
  add('net', 'caisse', 'Fermeture de caisse validée',
    !ouvertsPasses ? 'n' : joursSansCaisse.length > 2 ? 'bad' : joursSansCaisse.length ? 'warn' : 'ok',
    !ouvertsPasses ? 'Aucun jour ouvert' + sur
      : joursSansCaisse.length
        ? joursSansCaisse.length + ' ' + accord(joursSansCaisse.length, 'jour') + ' sans fermeture validée : ' + paListe(joursSansCaisse)
        : 'Validée chaque jour ouvert (' + ouvertsPasses + ' ' + accord(ouvertsPasses, 'jour') + ')', 'caisse');

  /* --- Glaces et vitrine -------------------------------------------------- */
  const fifo = await calculFIFO(monthKey(fin)).catch(() => []);
  const estGlace = f => f.type === 'g' || f.famille === 'glace';
  const glaces = fifo.filter(estGlace), autres = fifo.filter(f => !estGlace(f));
  const nomsDe = l => paListe([...new Set(l.map(f => f.nom).filter(Boolean))]);
  const joursGelato = Math.round((DLC_RULES.gelato || DLC_RULES.defaut).h / 24);
  const gR = glaces.filter(f => f.c === 'rouge'), gO = glaces.filter(f => f.c === 'orange');
  add('vitrine', 'vit-dlc', 'Bacs en vitrine depuis moins de ' + joursGelato + ' jours',
    gR.length ? 'bad' : gO.length ? 'warn' : glaces.length ? 'ok' : 'n',
    gR.length ? gR.length + ' ' + accord(gR.length, 'bac ouvert', 'bacs ouverts') + ' depuis plus de ' + joursGelato +
        ' jours : ' + nomsDe(gR) + '. À jeter, ou à déclarer fini s’il ne reste rien.'
      : gO.length ? gO.length + ' ' + accord(gO.length, 'bac', 'bacs') + ' à écouler vite : ' + nomsDe(gO)
      : glaces.length ? glaces.length + ' ' + accord(glaces.length, 'bac', 'bacs') + ' en vitrine, tous dans leur durée'
      : 'Aucun bac de glace noté en vitrine', 'frigo');

  const armoire = typeof bacsArmoire === 'function' ? await bacsArmoire().catch(() => []) : [];
  const seuilArm = seuilOrangeHeures((DLC_RULES.gelato || DLC_RULES.defaut).h);
  const aR = armoire.filter(b => b.resteH < 0), aO = armoire.filter(b => b.resteH >= 0 && b.resteH <= seuilArm);
  const parfumsArm = l => paListe(l.map(b => litArticle(b.cle).parfum || libelleArticle(b.cle)));
  add('vitrine', 'armoire', 'Bacs de l’armoire −13 dans leur durée',
    aR.length ? 'bad' : aO.length ? 'warn' : armoire.length ? 'ok' : 'n',
    aR.length ? aR.length + ' ' + accord(aR.length, 'bac', 'bacs') + ' dépassé à l’armoire : ' + parfumsArm(aR)
      : aO.length ? aO.length + ' ' + accord(aO.length, 'bac', 'bacs') + ' à monter vite en vitrine : ' + parfumsArm(aO)
      : armoire.length ? armoire.length + ' ' + accord(armoire.length, 'bac', 'bacs') + ' à l’armoire, dans leur durée'
      : 'Aucun bac noté à l’armoire −13', 'lots');

  /* Journal des ouvertures (stock.js), sur une fenêtre plus longue pour les
     coulis et toppings. */
  const depuis = addD(fin, -PREAUDIT.lectureJours);
  const mouv = ((typeof tousMouvements === 'function' ? await tousMouvements(depuis).catch(() => []) : []) || [])
    .map(litMouvement).filter(m => m.type === 'ouverture' && m.jour && m.jour >= depuis && m.jour <= fin);
  const famDe = m => litArticle(m.cle).famille;

  const ouvGlace = mouv.filter(m => famDe(m) === 'glace' && m.jour >= debut);
  const sansLot = ouvGlace.filter(m => !String(m.lot || '').trim());
  add('vitrine', 'lots', 'Numéro de lot noté à l’ouverture des bacs',
    !ouverts.length ? 'n' : !ouvGlace.length ? 'warn' : sansLot.length ? (sansLot.length > 2 ? 'bad' : 'warn') : 'ok',
    !ouverts.length ? 'Aucun jour ouvert' + sur
      : !ouvGlace.length ? 'Aucune ouverture de bac tracée' + sur + ' alors que la boutique était ouverte'
      : sansLot.length ? sansLot.length + ' ' + accord(sansLot.length, 'bac ouvert', 'bacs ouverts') + ' sans numéro de lot sur ' + ouvGlace.length +
          ' : ' + paListe([...new Set(sansLot.map(m => litArticle(m.cle).parfum).filter(Boolean))])
      : ouvGlace.length + ' ' + accord(ouvGlace.length, 'bac ouvert', 'bacs ouverts') + sur + ', tous avec leur lot', 'lots');

  /* --- Produits complémentaires ----------------------------------------- */
  /* Chantilly : un jour ouvert est couvert si une brique a été ouverte moins
     de 2 jours ouverts plus tôt (48 h de vie). */
  const joursCh = [...new Set(mouv.filter(m => famDe(m) === 'chantilly').map(m => m.jour))].sort();
  const derCh = joursCh.length ? joursCh[joursCh.length - 1] : null;
  const nonCouverts = [];
  ouverts.forEach(d => {
    const avant = joursCh.filter(x => x <= d);
    const der = avant.length ? avant[avant.length - 1] : null;
    /* En jours calendaires : une brique ouverte samedi est périmée mardi, même
       si la boutique a fermé dimanche et lundi. */
    if (!der || joursEntre(der, d).length - 1 >= PREAUDIT.chantillyJours) nonCouverts.push(d);
  });
  add('compl', 'chantilly', 'Chantilly ouverte au moins tous les ' + PREAUDIT.chantillyJours + ' jours',
    !ouverts.length ? 'n' : !derCh ? 'bad' : nonCouverts.length > 3 ? 'bad' : nonCouverts.length ? 'warn' : 'ok',
    !ouverts.length ? 'Aucun jour ouvert' + sur
      : !derCh ? 'Aucune ouverture de chantilly tracée depuis ' + PREAUDIT.lectureJours + ' jours'
      : nonCouverts.length
        ? nonCouverts.length + ' ' + accord(nonCouverts.length, 'jour ouvert', 'jours ouverts') + ' sans chantilly ouverte depuis moins de 48 h : ' +
          paListe(nonCouverts.map(fmtDC), 4) + ' · dernière ouverture le ' + fmtDC(derCh)
        : 'Une ouverture au moins tous les ' + PREAUDIT.chantillyJours + ' jours ouverts · dernière le ' + fmtDC(derCh), 'lots');

  /* Coulis et toppings en stock : dernière ouverture de chaque saveur. */
  const stock = (typeof stockReel === 'function' ? await stockReel().catch(() => null) : null) || { articles:{} };
  ['coulis', 'topping'].forEach(fid => {
    const fam = FAMILLES_PRODUIT.filter(f => f.id === fid)[0];
    if (!fam) return;
    const seuil = PREAUDIT.sansOuverture[fid];
    const enStock = [], retards = [];
    (fam.saveurs || []).forEach(sv => {
      if (num((stock.articles || {})[cleArticle(fid, sv, '')]) <= 0) return;   // pas en stock : rien n'est attendu
      enStock.push(sv);
      const js = mouv.filter(m => famDe(m) === fid && paNorm(litArticle(m.cle).parfum) === paNorm(sv)).map(m => m.jour).sort();
      const der = js.length ? js[js.length - 1] : null;
      const n = der ? paOuvertsApres(der, fin) : null;
      if (n === null || n > seuil) retards.push({ sv:sv, der:der, n:n });
    });
    const nomPluriel = fid === 'coulis' ? 'coulis' : 'toppings';
    add('compl', fid, (fid === 'coulis' ? 'Coulis' : 'Toppings') + ' en stock ouverts depuis moins de ' + seuil + ' jours',
      !enStock.length ? 'n' : !retards.length ? 'ok' : retards.some(r => r.n !== null && r.n > 2 * seuil) ? 'bad' : 'warn',
      !enStock.length ? 'Aucun ' + (fid === 'coulis' ? 'coulis' : 'topping') + ' en stock'
        : retards.length
          ? retards.map(r => r.sv + (r.der ? ' : dernière ouverture le ' + fmtDC(r.der) + ' (' + r.n + ' jours ouverts)'
              : ' : en stock, aucune ouverture depuis ' + PREAUDIT.lectureJours + ' jours')).join(' · ') +
            '. Flacon gardé trop longtemps, ou ouverture pas notée ?'
          : 'Tous les ' + nomPluriel + ' en stock ont une ouverture récente (' + enStock.length + ')', 'lots');
  });

  const xR = autres.filter(f => f.c === 'rouge'), xO = autres.filter(f => f.c === 'orange');
  add('compl', 'dlc', 'Produits ouverts dans leur date limite',
    xR.length ? 'bad' : xO.length ? 'warn' : 'ok',
    xR.length ? xR.length + ' ' + accord(xR.length, 'produit dépassé', 'produits dépassés') + ' : ' + nomsDe(xR)
      : xO.length ? xO.length + ' ' + accord(xO.length, 'produit', 'produits') + ' à écouler vite : ' + nomsDe(xO)
      : 'Aucun produit ouvert dépassé', 'frigo');

  /* --- Stock et écarts ---------------------------------------------------- */
  /* Lue directement, pas par periodeCourante() : sans période, celle-ci ouvre
     au manager la feuille bloquante « Définir la première période ». */
  const per = await DB.get('periode:courante', null).catch(() => null);
  const echue = !!(per && per.fin && fin > per.fin);
  const depuisFin = echue ? joursEntre(addD(per.fin, 1), fin).length : 0;
  add('stock', 'periode', 'Période d’écart clôturée à temps',
    !per || !per.fin ? 'n' : echue ? 'bad' : 'ok',
    !per || !per.fin ? 'Aucune période en cours'
      : echue ? 'Période du ' + fmtDC(per.debut) + ' au ' + fmtDC(per.fin) + ' terminée depuis ' + depuisFin + ' ' +
          accord(depuisFin, 'jour') + ', pas encore clôturée'
      : 'Période en cours jusqu’au ' + fmtDC(per.fin), 'periodes');

  let ecart = { c:'warn', texte:'Aucun calcul d’écart clôturé' };
  if (typeof lireCalculs === 'function' && typeof derniereCloture === 'function') {
    const c = derniereCloture(await lireCalculs().catch(() => []));
    if (c) {
      const r = resultatCalcul(c);
      const st = r.incoherent ? { c:'bad' } : etatEcart(r.pct);
      const vieux = paOuvertsApres(c.fin, fin) > PREAUDIT.inventaireJours;
      ecart = { c: vieux && st.c === 'ok' ? 'warn' : st.c,
        texte:'Dernier calcul du ' + fmtDC(c.debut) + ' au ' + fmtDC(c.fin) + ' : ' + pctTxt(r) +
          (r.incoherent ? '' : ' (' + (r.ecart > 0.05 ? '+' : r.ecart < -0.05 ? '−' : '') + kgTxt(Math.abs(r.ecart)) + ')') +
          (vieux ? ' · plus de ' + PREAUDIT.inventaireJours + ' jours ouverts sans nouveau calcul' : '') };
    }
  }
  add('stock', 'ecart', 'Écart glace dans la fourchette', ecart.c, ecart.texte, 'calcul');

  const [invF, invS] = await Promise.all([
    DB.get('stock:inventaire', null).catch(() => null), DB.get('stock:sec', null).catch(() => null)]);
  const invTxt = [], invEtats = [];
  [['Chambre froide', invF], ['Sec', invS]].forEach(([nom, inv]) => {
    if (!inv || !inv.jour) { invTxt.push(nom + ' : jamais compté'); invEtats.push('bad'); return; }
    const n = paOuvertsApres(inv.jour, fin);
    invEtats.push(n > 2 * PREAUDIT.inventaireJours ? 'bad' : n > PREAUDIT.inventaireJours ? 'warn' : 'ok');
    invTxt.push(nom + ' : ' + fmtDC(inv.jour) + ' (' + n + ' ' + accord(n, 'jour ouvert', 'jours ouverts') + ')');
  });
  add('stock', 'inventaire', 'Inventaire de moins de ' + PREAUDIT.inventaireJours + ' jours ouverts',
    invEtats.indexOf('bad') >= 0 ? 'bad' : invEtats.indexOf('warn') >= 0 ? 'warn' : 'ok', invTxt.join(' · '), 'inventaire');

  const ruptures = (await DB.get('ruptures', []).catch(() => []) || []).filter(r => r && !r.traite);
  add('stock', 'ruptures', 'Ruptures traitées',
    ruptures.length ? 'bad' : 'ok',
    ruptures.length ? ruptures.length + ' ' + accord(ruptures.length, 'rupture non traitée', 'ruptures non traitées') + ' : ' +
        paListe([...new Set(ruptures.map(r => r.article).filter(Boolean))])
      : 'Aucune rupture en attente', 'controle');

  /* --- Réceptions et pertes ----------------------------------------------- */
  add('recep', 'receptions', 'Livraisons réceptionnées dans l’appli',
    receptions ? (refusees ? 'warn' : 'ok') : ouverts.length >= 7 ? 'warn' : 'n',
    receptions ? receptions + ' ' + accord(receptions, 'réception enregistrée', 'réceptions enregistrées') + sur +
        (refusees ? ', dont ' + refusees + ' ' + accord(refusees, 'refusée', 'refusées') : '')
      : 'Aucune réception enregistrée' + sur, 'reception');
  const sansMotif = pertes.filter(x => x && !String(x.motif || x.raison || '').trim()).length;
  add('recep', 'pertes', 'Pertes enregistrées avec leur motif',
    pertes.length ? (sansMotif ? 'warn' : 'ok') : ouverts.length >= 7 ? 'warn' : 'n',
    pertes.length ? pertes.length + ' ' + accord(pertes.length, 'perte enregistrée', 'pertes enregistrées') + sur +
        (sansMotif ? ', dont ' + sansMotif + ' sans motif' : ', toutes avec un motif')
      : 'Aucune perte enregistrée' + sur + ' : rien jeté, ou rien noté ?', 'pertes');

  return { debut:debut, fin:fin, joursOuverts:ouverts.length, controles:C, at:nowISO() };
}

/* Résultats gardés quelques minutes : la page, la tour de contrôle et le PDF
   ne relisent pas 30 jours de registres chacun. */
let _paCache = null;
async function controlesEnCache(forcer) {
  const j = today();
  if (!forcer && _paCache && _paCache.jour === j && Date.now() - _paCache.t < PREAUDIT.cacheMs) return _paCache.res;
  const res = await controlesPreAudit(j);
  _paCache = { jour:j, t:Date.now(), res:res };
  return res;
}

/* Pour la tour de contrôle et la vue multi-boutiques : score de conformité
   du jour, global et par bloc. */
async function scoreConformite(forcer) {
  const r = await controlesEnCache(forcer);
  const s = scoresPreAudit(r.controles);
  return { score:s.global, classe:paClasse(s.global), at:r.at,
           aCorriger:r.controles.filter(x => x.c === 'bad').length,
           blocs:PREAUDIT.blocs.map(b => ({ id:b.id, nom:b.nom, score:s.blocs[b.id], classe:paClasse(s.blocs[b.id]) })) };
}

/* ---------------------------------------------------------------------------
   Passages de l'animateur réseau
   ------------------------------------------------------------------------ */
async function lirePassages() {
  const d = (await DB.get(PA_PASSAGES, {}).catch(() => ({}))) || {};
  return Object.keys(d).filter(k => k.indexOf('p:') === 0).map(k => d[k])
    .filter(p => p && p.id && p.jour && !p.supprime)
    .sort((a, b) => (a.jour < b.jour ? 1 : a.jour > b.jour ? -1 : String(a.at) < String(b.at) ? 1 : -1));
}
const ecrirePassage = p => DB.patch(PA_PASSAGES, { ['p:' + p.id]:p });
const paLibPassage = p => paTypeLabel(p.type) + ' du ' + fmtDC(p.jour);

/* Tâches du module Tâches et réparations (taches.js), catégorie « audit ».
   null tant que le module n'est pas chargé. */
const paTachesDispo = () => typeof lireTaches === 'function';
async function tachesAudit() {
  if (!paTachesDispo()) return null;
  try { return ((await lireTaches()) || []).filter(t => t && t.categorie === 'audit' && !t.supprime); }
  catch (e) { return null; }
}
const paTacheEnRetard = t => t.statut !== 'realisee' && t.echeance && t.echeance < today();

/* ---------------------------------------------------------------------------
   Pré-audits enregistrés (instantanés)
   ------------------------------------------------------------------------ */
async function lirePreAudits() {
  const cles = (await DB.list('preaudit:')).filter(k => PA_RE.test(k));
  /* Dans un dessin d'écran, les pré-audits partent en une requête groupée. */
  if (typeof DB.prelire === 'function') DB.prelire(cles);
  const l = await Promise.all(cles.map(k => DB.get(k, null)));
  /* Supprimé : marqué, pas effacé, sinon il revenait d'un autre iPad. */
  return l.filter(a => a && a.id && a.jour && a.statut === 'clos')
    .sort((x, y) => (x.jour < y.jour ? 1 : x.jour > y.jour ? -1 : String(x.closAt || x.at) < String(y.closAt || y.at) ? 1 : -1));
}

/* Actions de l'ancienne grille (champs « a:<id> » des anciens pré-audits) :
   celles qui restent ouvertes se suivent ici jusqu'à ce qu'on les coche. */
async function anciennesActions() {
  const cles = (await DB.list('preaudit:')).filter(k => PA_RE.test(k));
  const docs = await Promise.all(cles.map(k => DB.get(k, null).catch(() => null)));
  const out = [];
  docs.forEach(d => {
    if (!d || !d.id || d.statut === 'supprime') return;
    Object.keys(d).forEach(k => {
      const x = d[k];
      if (k.indexOf('a:') === 0 && x && x.id && !x.supprime && !x.fait) out.push({ doc:d.id, jour:d.jour, x:x });
    });
  });
  return out.sort((a, b) => String(a.x.echeance || '9999') < String(b.x.echeance || '9999') ? -1 : 1);
}
const paActionEnRetard = x => !x.fait && x.echeance && x.echeance < today();

/* Dernier score publié sous « preaudit:dernier » : la vue multi-boutiques
   (franchise.js) le lit dans le résumé de chaque boutique. */
async function publierDernierPreAudit() {
  const clos = (await lirePreAudits())[0] || null;
  await DB.set('preaudit:dernier', clos
    ? { score:clos.score, jour:clos.jour, scores:clos.scores || {}, par:clos.closPar || '', at:nowISO() }
    : { score:null, jour:null, scores:{}, par:'', at:nowISO() });
}

/* Un seul enregistrement à la fois : la lecture des registres prend du
   temps, et un second « Enregistrer » pendant ce temps créait un second
   pré-audit du jour (nouvel id). */
let _paEnregistrement = false;
async function enregistrerPreAudit() {
  if (_paEnregistrement) return;
  _paEnregistrement = true;
  try { await enregistrerPreAuditSansVerrou(); }
  finally { _paEnregistrement = false; }
}
async function enregistrerPreAuditSansVerrou() {
  toast('Lecture des registres…');
  let r;
  try { r = await controlesEnCache(true); }
  catch (e) { toast('Lecture des registres impossible, réessayez', 'erreur'); return; }
  const s = scoresPreAudit(r.controles);
  const j = today();
  const a = { id:'preaudit:' + j + ':' + uid(), version:2, jour:j, statut:'clos', score:s.global, scores:s.blocs,
              controles:r.controles, debut:r.debut, fin:r.fin, par:STATE.user.prenom, closPar:STATE.user.prenom,
              at:nowISO(), closAt:nowISO() };
  await DB.set(a.id, a);
  await publierDernierPreAudit();
  await feed('ok', STATE.user.prenom + ' a enregistré le pré-audit : ' + paScoreTxt(s.global));
  toast('Pré-audit enregistré : ' + paScoreTxt(s.global));
  paRedessiner();
}

/* Pour la tour de contrôle : [niveau, titre, texte, vue] ou null. Un passage
   de l'animateur prévu dans les jours qui viennent fait remonter le score. */
async function alertePreAudit() {
  const j = today();
  const prochain = (await lirePassages()).filter(p => p.jour >= j && p.jour <= addD(j, PREAUDIT.alerteAvantPassage))
    .sort((a, b) => (a.jour < b.jour ? -1 : 1))[0];
  if (!prochain) {
    const retard = (await anciennesActions().catch(() => [])).filter(o => paActionEnRetard(o.x));
    return retard.length
      ? ['warn', retard.length + ' ' + accord(retard.length, 'action de pré-audit en retard', 'actions de pré-audit en retard'),
         'Actions de l’ancienne grille dont l’échéance est passée.', 'preaudit']
      : null;
  }
  const s = await scoreConformite().catch(() => null);
  return [s && s.classe === 'bad' ? 'bad' : 'warn',
    paTypeLabel(prochain.type) + ' de l’animateur le ' + fmtD(prochain.jour),
    'Pré-audit du jour : ' + paScoreTxt(s ? s.score : null) +
      (s && s.aCorriger ? ', ' + s.aCorriger + ' ' + accord(s.aCorriger, 'point', 'points') + ' à corriger avant son passage.' : '.'),
    'preaudit'];
}

/* ---------------------------------------------------------------------------
   Vue principale
   ------------------------------------------------------------------------ */
const paRedessiner = () => rendre('preaudit');

function lignesControles(controles, avecLien) {
  return PREAUDIT.blocs.map(b => {
    const l = controles.filter(x => x.bloc === b.id);
    if (!l.length) return '';
    const sb = scoreControles(l);
    return carte('<div class="rang"><h2 style="flex:1">' + esc(b.nom) + '</h2>' + pastille(paClasse(sb), paScoreTxt(sb)) + '</div>' +
      l.map(x => '<div class="pa-pt"><div class="rang" style="align-items:flex-start;gap:10px">' +
        '<div style="flex:1"><div class="pa-lib">' + esc(x.lib) + '</div>' +
        '<div class="mini" style="margin-top:4px">' + esc(x.texte) + '</div></div>' +
        '<div style="text-align:right">' + pastille(x.c, PA_ETAT[x.c] || '—') +
        (avecLien && x.vue && (x.c === 'bad' || x.c === 'warn')
          ? '<div style="margin-top:6px"><button type="button" class="btn clair sm" data-go="' + esc(x.vue) + '">Ouvrir</button></div>' : '') +
        '</div></div></div>').join(''), 'solide');
  }).join('');
}

function carteTache(t, passages) {
  const p = t.passage ? passages.filter(x => x.id === t.passage)[0] : null;
  const etat = t.statut === 'realisee' ? pastille('ok', 'Fait')
    : paTacheEnRetard(t) ? pastille('bad', 'En retard')
    : t.statut === 'en_cours' ? pastille('ciel', 'En cours') : pastille('n', 'À faire');
  return '<div class="card"><div class="rang"><div style="flex:1"><b>' + esc(t.titre || '') + '</b>' +
    '<div class="cs">' + [p ? paLibPassage(p) : (t.passage ? 'Passage de l’animateur' : ''),
      t.echeance ? 'échéance ' + fmtD(t.echeance) : '', t.assigneNom || ''].filter(Boolean).map(esc).join(' · ') +
    (t.detail ? '<br>' + esc(t.detail) : '') + '</div></div>' + etat + '</div>' +
    (t.statut === 'realisee' || typeof changerStatutTache !== 'function' ? '' :
      '<div class="btn-row" style="margin-top:10px">' +
      (t.statut === 'en_cours' ? '' : '<button class="btn clair sm" data-pa-t="' + esc(t.id) + '|en_cours">En cours</button>') +
      '<button class="btn menthe sm" data-pa-t="' + esc(t.id) + '|realisee">C’est fait</button></div>') + '</div>';
}

V.preaudit = async function () {
  $('#vue-actions').innerHTML = '<button class="btn sm clair" id="pa-maj">Actualiser</button>';
  $('#page').innerHTML = '<div class="vide">Lecture des registres des ' + PREAUDIT.fenetre + ' derniers jours…</div>';
  const forcer = !!V.preaudit._forcer;
  V.preaudit._forcer = false;
  $('#pa-maj').onclick = () => { V.preaudit._forcer = true; paRedessiner(); };
  let r, passages, taches, histo, anciennes;
  try {
    [r, passages, taches, histo, anciennes] = await Promise.all([
      controlesEnCache(forcer), lirePassages(), tachesAudit(), lirePreAudits().catch(() => []), anciennesActions().catch(() => [])]);
  } catch (e) {
    if (STATE.view !== 'preaudit') return;
    $('#page').innerHTML = '<div class="vide">Lecture des registres impossible. Vérifiez la connexion, puis touchez « Actualiser ».</div>';
    return;
  }
  if (STATE.view !== 'preaudit') return;
  const s = scoresPreAudit(r.controles);
  const j = today();
  const passes = passages.filter(p => p.jour <= j), aVenir = passages.filter(p => p.jour > j).reverse();
  const tOuvertes = (taches || []).filter(t => t.statut !== 'realisee');
  const tFaites = (taches || []).filter(t => t.statut === 'realisee');
  const tRetard = tOuvertes.filter(paTacheEnRetard);
  const aCorriger = r.controles.filter(x => x.c === 'bad').length;

  $('#page').innerHTML =
    '<div class="grid g3">' +
      '<div class="kpi ' + paClasse(s.global) + '"><div class="k">Conformité des registres</div>' +
        '<div class="v">' + (s.global === null ? '—' : s.global + '<span class="u">%</span>') + '</div>' +
        '<div class="d">' + (aCorriger ? aCorriger + ' ' + accord(aCorriger, 'point', 'points') + ' à corriger' : 'Rien à corriger') + '</div></div>' +
      '<div class="kpi"><div class="k">' + (aVenir.length ? 'Prochain passage' : 'Dernier passage') + '</div>' +
        '<div class="v" style="font-size:22px">' + (aVenir.length ? esc(fmtDC(aVenir[0].jour)) : passes.length ? esc(fmtDC(passes[0].jour)) : '—') + '</div>' +
        '<div class="d">' + esc(aVenir.length ? paTypeLabel(aVenir[0].type) : passes.length ? paTypeLabel(passes[0].type) +
          (paPct(passes[0].score) ? ' · ' + paPct(passes[0].score) : '') : 'Aucun noté') + '</div></div>' +
      '<div class="kpi ' + (tRetard.length ? 'bad' : '') + '"><div class="k">Tâches d’audit</div>' +
        '<div class="v">' + (taches ? tOuvertes.length : '—') + '</div>' +
        '<div class="d">' + (taches ? (tRetard.length ? tRetard.length + ' en retard' : 'ouvertes') : 'Module à venir') + '</div></div>' +
    '</div>' +
    '<p class="mini" style="margin:12px 2px 0">Calculé sur ce que l’équipe a saisi du ' + esc(fmtDC(r.debut)) + ' au ' + esc(fmtDC(r.fin)) +
      ' (' + r.joursOuverts + ' ' + accord(r.joursOuverts, 'jour ouvert', 'jours ouverts') + '). Les jours de fermeture ne comptent pas. ' +
      'L’audit Amorino se fait dans l’outil du réseau : ici, on vérifie que les registres de l’appli sont tenus.</p>' +

    '<div class="stack" style="margin-top:12px">' + lignesControles(r.controles, true) + '</div>' +

    '<div class="entete" style="margin-top:18px"><h3>Passages de l’animateur</h3>' +
      '<button class="btn sm pousse" id="pa-pass-new">Ajouter</button></div>' +
    (passages.length
      ? '<div class="dense"><div class="dense-h"><span class="c1">Date</span><span class="c w">Type</span><span class="c w">Tâches</span></div>' +
        passages.slice(0, 30).map(p => {
          const n = (taches || []).filter(t => t.passage === p.id);
          const no = n.filter(t => t.statut !== 'realisee').length;
          return '<div class="dl" data-pa-pass="' + esc(p.id) + '" role="button" tabindex="0" style="cursor:pointer">' +
            '<span class="c1">' + esc(fmtD(p.jour)) + (p.jour > j ? ' · prévu' : '') +
              (p.note ? '<br><span class="mini">' + esc(String(p.note).slice(0, 90)) + '</span>' : '') + '</span>' +
            '<span class="c w">' + pastille(p.type === 'controle' ? 'ciel' : 'n', paTypeLabel(p.type) +
              (p.score != null && p.score !== '' ? ' · ' + paPct(p.score) : '')) + '</span>' +
            '<span class="c w">' + (taches ? (n.length ? no + ' / ' + n.length : '—') : '') + '</span></div>';
        }).join('') + '</div>'
      : vide('', 'Aucun passage noté. Ajoutez chaque visite ou contrôle de l’animateur, avec sa date.')) +

    '<div class="entete" style="margin-top:18px"><h3>Tâches suite aux audits et visites</h3>' +
      (taches && typeof ouvrirFormulaireTache === 'function' ? '<button class="btn sm pousse" id="pa-t-new">Ajouter</button>' : '') + '</div>' +
    (!taches
      ? vide('', 'Les tâches demandées par l’animateur arrivent avec le module Tâches et réparations.')
      : tOuvertes.length
        ? '<div class="stack">' + tOuvertes.sort((a, b) => String(a.echeance || '9999') < String(b.echeance || '9999') ? -1 : 1)
            .map(t => carteTache(t, passages)).join('') + '</div>'
        : vide('', tFaites.length ? 'Toutes les tâches d’audit sont faites.' : 'Aucune tâche d’audit pour l’instant.')) +
    (tFaites.length ? '<p class="mini" style="margin:8px 2px 0">' + tFaites.length + ' ' + accord(tFaites.length, 'tâche faite, visible', 'tâches faites, visibles') +
      ' dans Tâches et réparations.</p>' : '') +

    (anciennes.length ? '<div class="entete" style="margin-top:18px"><h3>Actions de l’ancienne grille</h3></div>' +
      '<div class="stack">' + anciennes.map(o => '<div class="card"><div class="rang"><div style="flex:1"><b>' + esc(o.x.texte || '') + '</b>' +
        '<div class="cs">' + esc([o.x.resp || '', o.x.echeance ? 'échéance ' + fmtD(o.x.echeance) : '', 'pré-audit du ' + fmtDC(o.jour)]
          .filter(Boolean).join(' · ')) + '</div></div>' +
        (paActionEnRetard(o.x) ? pastille('bad', 'En retard') : pastille('n', 'À faire')) + '</div>' +
        '<div class="btn-row" style="margin-top:10px"><button class="btn menthe sm" data-pa-old="' + esc(o.doc) + '|' + esc(o.x.id) + '">C’est fait</button></div></div>').join('') +
      '</div>' : '') +

    '<div class="entete" style="margin-top:18px"><h3>Pré-audits enregistrés</h3></div>' +
    (histo.length
      ? '<div class="dense"><div class="dense-h"><span class="c1">Date</span><span class="c w">Score</span></div>' +
        histo.slice(0, 24).map(a => '<div class="dl"' + (a.version === 2 ? ' data-pa-voir="' + esc(a.id) + '" role="button" tabindex="0" style="cursor:pointer"' : '') + '>' +
          '<span class="c1">' + esc(fmtD(a.jour)) + ' · ' + esc(a.closPar || a.par || '') + (a.version === 2 ? '' : ' · ancienne grille') + '</span>' +
          '<span class="c w">' + pastille(paClasse(a.score), paScoreTxt(a.score)) + '</span></div>').join('') + '</div>'
      : vide('', 'Aucun pré-audit enregistré. Enregistrez celui du jour pour garder une trace avant un passage.')) +

    '<div class="btn-row" style="margin-top:16px">' +
      '<button class="btn clair" id="pa-pdf">Exporter en PDF</button>' +
      '<button class="btn menthe" id="pa-save">Enregistrer le pré-audit du jour</button></div>';

  $$('#page [data-go]').forEach(b => b.onclick = () => rendre(b.dataset.go));
  $('#pa-pass-new').onclick = () => feuillePassage(null);
  $$('[data-pa-pass]').forEach(b => {
    const ouvrir = () => feuillePassage(passages.filter(p => p.id === b.dataset.paPass)[0] || null, taches);
    b.onclick = ouvrir;
    b.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvrir(); } };
  });
  if ($('#pa-t-new')) $('#pa-t-new').onclick = () => nouvelleTacheAudit('');
  $$('[data-pa-t]').forEach(b => b.onclick = async () => {
    const [id, st] = b.dataset.paT.split('|');
    try { await changerStatutTache(id, st); }
    catch (e) { toast('Enregistrement impossible, réessayez', 'erreur'); return; }
    toast(st === 'realisee' ? 'Tâche faite' : 'Tâche en cours');
    paRedessiner();
  });
  $$('[data-pa-old]').forEach(b => b.onclick = async () => {
    const [doc, xid] = b.dataset.paOld.split('|');
    const o = anciennes.filter(y => y.doc === doc && y.x.id === xid)[0];
    if (!o) return;
    try { await DB.patch(doc, { ['a:' + xid]:Object.assign({}, o.x, { fait:true, faitPar:STATE.user.prenom, faitAt:nowISO() }) }); }
    catch (e) { toast('Enregistrement impossible, réessayez', 'erreur'); return; }
    await feed('ok', STATE.user.prenom + ' a fait l’action de pré-audit « ' + (o.x.texte || '') + ' »');
    toast('Action faite');
    paRedessiner();
  });
  $$('[data-pa-voir]').forEach(b => {
    const ouvrir = () => voirPreAudit(histo.filter(a => a.id === b.dataset.paVoir)[0]);
    b.onclick = ouvrir;
    b.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvrir(); } };
  });
  $('#pa-pdf').onclick = () => imprimerPreAudit(r, s, passages, taches, null);
  $('#pa-save').onclick = () => confirmer('Enregistrer le pré-audit du jour ?',
    'Score : ' + paScoreTxt(s.global) + '. Les résultats sont recalculés puis figés, pour en garder une trace.',
    'Enregistrer', enregistrerPreAudit);
};

function nouvelleTacheAudit(passageId) {
  if (typeof ouvrirFormulaireTache !== 'function') { toast('Module Tâches indisponible', 'erreur'); return; }
  ouvrirFormulaireTache({ categorie:'audit', passage:passageId || '' }, () => paRedessiner());
}

/* Feuille de saisie d'un passage : date, visite ou contrôle, score (contrôle),
   note. */
function feuillePassage(p, taches) {
  let type = p ? p.type : 'visite';
  const liees = p && taches ? taches.filter(t => t.passage === p.id) : [];
  showSheet(
    '<h2 id="sheet-titre">' + (p ? esc(paLibPassage(p)) : 'Nouveau passage') + '</h2>' +
    '<p class="sub">Visite d’animation ou contrôle de conformité de l’animateur réseau.</p>' +
    '<div class="chips" style="margin-top:14px" id="pa-type">' + PREAUDIT.typesPassage.map(t =>
      '<button type="button" class="chip' + (t.id === type ? ' on' : '') + '" data-pa-type="' + t.id + '" aria-pressed="' + (t.id === type) + '">' +
      esc(t.label) + '</button>').join('') + '</div>' +
    '<div class="grid g2" style="margin-top:14px">' +
      '<div class="champ"><label class="f" for="pa-jour">Date</label>' +
        '<input type="date" id="pa-jour" value="' + esc(p ? p.jour : today()) + '"></div>' +
      '<div class="champ" id="pa-score-champ"><label class="f" for="pa-score">Score conformité (%)</label>' +
        '<input type="text" id="pa-score" inputmode="decimal" value="' + esc(p && p.score != null ? String(p.score).replace('.', ',') : '') + '" placeholder="Ex. 94,81"></div>' +
    '</div>' +
    '<div class="champ"><label class="f" for="pa-note">Note</label>' +
      '<textarea id="pa-note" placeholder="Objet du passage, points relevés">' + esc(p ? p.note || '' : '') + '</textarea></div>' +
    '<p class="mini">' + esc(CONSIGNE_TEXTE_LIBRE) + '</p>' +
    (p && liees.length ? '<p class="mini" style="margin-top:8px">' + liees.length + ' ' + accord(liees.length, 'tâche liée', 'tâches liées') +
      ' à ce passage, dont ' + liees.filter(t => t.statut !== 'realisee').length + ' ouverte(s).</p>' : '') +
    '<div class="actions">' +
      (p ? '<button class="btn fantome" id="pa-pass-sup">Supprimer</button>' : '<button class="btn clair" data-fermer>Annuler</button>') +
      (p && typeof ouvrirFormulaireTache === 'function' ? '<button class="btn clair" id="pa-pass-tache">+ Tâche</button>' : '') +
      '<button class="btn menthe" id="pa-pass-ok">Enregistrer</button></div>');

  const majType = () => {
    $$('[data-pa-type]').forEach(b => { const on = b.dataset.paType === type; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    $('#pa-score-champ').style.display = type === 'controle' ? '' : 'none';
  };
  $$('[data-pa-type]').forEach(b => b.onclick = () => { type = b.dataset.paType; majType(); });
  majType();
  if ($('#pa-pass-sup')) $('#pa-pass-sup').onclick = () => confirmer('Supprimer ce passage ?',
    paLibPassage(p) + '. Ses tâches restent dans Tâches et réparations.', 'Supprimer', async () => {
      await ecrirePassage(Object.assign({}, p, { supprime:true, suppPar:STATE.user.prenom, suppAt:nowISO() }));
      closeSheet(); toast('Passage supprimé'); paRedessiner();
    });
  if ($('#pa-pass-tache')) $('#pa-pass-tache').onclick = () => { closeSheet(); nouvelleTacheAudit(p.id); };
  $('#pa-pass-ok').onclick = async () => {
    const jour = $('#pa-jour').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) { toast('Indiquez la date du passage', 'erreur'); return $('#pa-jour').focus(); }
    const brut = String($('#pa-score').value || '').replace(',', '.').trim();
    const score = type === 'controle' && brut !== '' ? Math.round(Number(brut) * 100) / 100 : null;
    if (score !== null && !(score >= 0 && score <= 100)) { toast('Score entre 0 et 100', 'erreur'); return $('#pa-score').focus(); }
    const np = Object.assign({ id:uid(), par:STATE.user.prenom, at:nowISO() }, p || {},
      { jour:jour, type:type, score:score, note:$('#pa-note').value.trim(), modifPar:STATE.user.prenom, modifAt:nowISO() });
    try { await ecrirePassage(np); }
    catch (e) { toast('Enregistrement impossible, réessayez', 'erreur'); return; }
    if (!p) await feed('ok', STATE.user.prenom + ' a noté un passage de l’animateur : ' + paLibPassage(np));
    closeSheet();
    toast(p ? 'Passage modifié' : 'Passage ajouté');
    paRedessiner();
  };
}

/* Un pré-audit enregistré : ses contrôles figés. */
function voirPreAudit(a) {
  if (!a) return;
  showSheet('<h2 id="sheet-titre">Pré-audit du ' + esc(fmtDC(a.jour)) + ' · ' + esc(paScoreTxt(a.score)) + '</h2>' +
    '<p class="sub">Enregistré par ' + esc(a.closPar || a.par || '—') + ', registres du ' + esc(fmtDC(a.debut)) + ' au ' + esc(fmtDC(a.fin)) + '.</p>' +
    '<div class="stack" style="margin-top:12px">' + lignesControles(a.controles || [], false) + '</div>' +
    '<div class="actions"><button class="btn fantome" id="pa-voir-sup">Supprimer</button>' +
    '<button class="btn ciel" id="pa-voir-pdf">Exporter en PDF</button></div>');
  $('#pa-voir-sup').onclick = () => confirmer('Supprimer ce pré-audit ?', 'Enregistré le ' + fmtD(a.jour) + ' (' + paScoreTxt(a.score) + ').',
    'Supprimer', async () => {
      /* Marqué, pas effacé : sinon il revenait d'un autre iPad. */
      await DB.patch(a.id, { statut:'supprime', suppPar:STATE.user.prenom, suppAt:nowISO() });
      await publierDernierPreAudit();
      await feed('ok', STATE.user.prenom + ' a supprimé le pré-audit du ' + fmtD(a.jour));
      closeSheet(); toast('Pré-audit supprimé'); paRedessiner();
    });
  $('#pa-voir-pdf').onclick = () => {
    closeSheet();
    imprimerPreAudit({ debut:a.debut, fin:a.fin, controles:a.controles || [] }, { global:a.score, blocs:a.scores || {} }, null, null, a);
  };
}

/* ---------------------------------------------------------------------------
   Export PDF (fenêtre d'impression, comme le registre sanitaire)
   ------------------------------------------------------------------------ */
async function imprimerPreAudit(r, s, passages, taches, fige) {
  const fr = d => d ? String(d).split('-').reverse().join('/') : '';
  const ouvertes = (taches || []).filter(t => t.statut !== 'realisee');
  $('#printview').innerHTML =
    '<div class="pv-h"><h1>Pré-audit des registres · ' + esc(APP.nom) + '</h1>' +
    '<div>' + esc(APP.site) + ' · ' + (fige ? 'pré-audit enregistré le ' + esc(fmtD(fige.jour)) + ' par ' + esc(fige.closPar || '—')
      : 'pré-audit du ' + fmtD(today())) + ' · registres du ' + esc(fr(r.debut)) + ' au ' + esc(fr(r.fin)) +
    '<br>Édité le ' + new Date().toLocaleString(APP.locale) + ' par ' + esc(STATE.user.prenom) + '</div></div>' +

    '<div class="pv-s">1. Score</div>' +
    '<table><thead><tr><th>Bloc</th><th>Score</th></tr></thead><tbody>' +
    PREAUDIT.blocs.map(b => '<tr><td>' + esc(b.nom) + '</td><td>' + esc(paScoreTxt((s.blocs || {})[b.id])) + '</td></tr>').join('') +
    '<tr><th>Score global</th><th>' + esc(paScoreTxt(s.global)) + '</th></tr></tbody></table>' +
    '<div style="font-size:9.5px">OK = 1 point, à surveiller = ½, à corriger = 0 ; « sans objet » ne compte pas. ' +
    'Contrôle automatique des registres de l’appli, pas l’audit officiel Amorino.</div>' +

    '<div class="pv-s">2. Contrôles</div>' +
    '<table><thead><tr><th>Bloc</th><th>Contrôle</th><th>Résultat</th><th>Détail</th></tr></thead><tbody>' +
    PREAUDIT.blocs.map(b => r.controles.filter(x => x.bloc === b.id).map((x, i) =>
      '<tr><td>' + (i ? '' : esc(b.nom)) + '</td><td>' + esc(x.lib) + '</td>' +
      '<td' + (x.c === 'bad' ? ' style="font-weight:700"' : '') + '>' + esc(PA_ETAT[x.c] || '—') + '</td><td>' + esc(x.texte) + '</td></tr>').join('')).join('') +
    '</tbody></table>' +

    (passages ? '<div class="pv-s">3. Passages de l’animateur</div>' +
      (passages.length ? '<table><thead><tr><th>Date</th><th>Type</th><th>Score</th><th>Note</th></tr></thead><tbody>' +
        passages.slice(0, 12).map(p => '<tr><td>' + esc(fr(p.jour)) + '</td><td>' + esc(paTypeLabel(p.type)) + '</td><td>' +
          esc(paPct(p.score)) + '</td><td>' + esc(p.note || '') + '</td></tr>').join('') + '</tbody></table>'
        : '<div>Aucun passage noté.</div>') : '') +

    (taches ? '<div class="pv-s">4. Tâches d’audit ouvertes</div>' +
      (ouvertes.length ? '<table><thead><tr><th>Tâche</th><th>Passage</th><th>Échéance</th><th>État</th></tr></thead><tbody>' +
        ouvertes.map(t => {
          const p = (passages || []).filter(x => x.id === t.passage)[0];
          return '<tr><td>' + esc(t.titre || '') + '</td><td>' + (p ? esc(paLibPassage(p)) : '') + '</td><td>' + esc(fr(t.echeance)) + '</td>' +
            '<td>' + (paTacheEnRetard(t) ? 'EN RETARD' : t.statut === 'en_cours' ? 'En cours' : 'À faire') + '</td></tr>';
        }).join('') + '</tbody></table>' : '<div>Aucune tâche ouverte.</div>') : '') +

    '<div class="sign">Document généré à partir des registres horodatés de la boutique dans ' + esc(APP.nom) + '.<br><br>' +
    'Responsable de boutique : ____________________  Signature : ____________________  Date : ____ / ____ / ________</div>';

  await feed('ok', STATE.user.prenom + ' a imprimé le pré-audit');
  setTimeout(() => window.print(), 200);
}

/* ---------------------------------------------------------------------------
   TOUR DE CONTRÔLE : CONFORMITÉ ET TÂCHES DE LA SEMAINE
   Le manager voit d'un coup d'œil, en vert, orange ou rouge, si les registres
   que l'audit regarde sont tenus (nettoyage, températures, ouvertures), puis
   les tâches hebdomadaires de la semaine : faites, en retard, à venir.
   Mêmes contrôles que le pré-audit (controlesPreAudit), sur 7 jours au lieu de 30.
   ------------------------------------------------------------------------ */
const CONFORMITE = { jours:7, libelles:{ ok:'Conforme', warn:'À surveiller', bad:'Non conforme', n:'Pas de données' } };
const JOURS_LETTRE = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/* La pire des couleurs, « n » (sans données) ne comptant pas. */
const pireCouleur = cs => cs.indexOf('bad') >= 0 ? 'bad' : cs.indexOf('warn') >= 0 ? 'warn' : cs.indexOf('ok') >= 0 ? 'ok' : 'n';

async function htmlConformite() {
  const j = today();
  /* Fenêtre arrêtée à hier : le relevé du matin et les tâches du jour ne
     sont pas encore dus, ils faisaient passer la carte à l'orange chaque matin. */
  const C = (await controlesPreAudit(addD(j, -1), CONFORMITE.jours, true)).controles;
  const ctl = id => C.filter(x => x.id === id)[0] || { c:'n', texte:'' };
  const releves = ctl('releves'), crit = ctl('crit');
  const temp = { c: pireCouleur([releves.c, crit.c]), texte: releves.texte + ' · ' + crit.texte };
  /* Les DLC se lisent aujourd'hui (produits ouverts en ce moment). Une
     semaine sans lot ouvert n'est pas un défaut : le nombre reste en texte. */
  const fifo = await calculFIFO(monthKey(j));
  const depasses = fifo.filter(f => f.c === 'rouge');
  const ouv = { c: depasses.length ? 'bad' : 'ok',
    texte: ctl('lots').texte + ' · ' + (depasses.length
      ? depasses.length + ' ' + accord(depasses.length, 'produit dépassé', 'produits dépassés') + ' : ' +
        [...new Set(depasses.map(f => f.nom))].slice(0, 3).join(', ')
      : 'aucun produit ouvert dépassé') };
  const lignes = [
    ['Nettoyages', ctl('nettoyage'), 'clean'],
    ['Températures', temp, 'temp'],
    ['Ouvertures et DLC', ouv, 'frigo']
  ];
  const glob = pireCouleur(lignes.map(l => l[1].c));

  /* Semaine en cours, du lundi au dimanche. */
  const lundi = addD(j, 1 - jourISO(j));
  const semaine = [];
  for (let i = 0; i < 7; i++) {
    const d = addD(lundi, i);
    const n = await etatNettoyage(d);
    const ferme = typeof jourOuvert === 'function' && !jourOuvert(d);
    const c = !n.total || ferme ? 'n'
      : d > j ? 'n'
      : n.faits >= n.total ? 'ok'
      : d === j ? 'n'
      : n.faits ? 'warn' : 'bad';
    semaine.push({ d:d, n:n, ferme:ferme, c:c });
  }
  const auj = semaine.filter(s => s.d === j)[0];

  return carte(
    '<div class="rang"><div style="flex:1;min-width:0"><h2>Conformité audit</h2>' +
    '<div class="cs">Registres des ' + CONFORMITE.jours + ' derniers jours, jusqu’à hier</div></div>' +
    pastille(glob, CONFORMITE.libelles[glob]) + '</div>' +
    '<div class="conf-lignes">' + lignes.map(l =>
      '<button type="button" class="conf-l ' + l[1].c + '" data-go="' + l[2] + '">' +
      '<span class="conf-p" aria-hidden="true"></span>' +
      '<span class="conf-t"><b>' + esc(l[0]) + '</b><span class="mini">' + esc(l[1].texte.split(' en ' + CONFORMITE.jours + ' jours').join('')) + '</span></span>' +
      '<span class="conf-e">' + esc(CONFORMITE.libelles[l[1].c]) + '</span></button>').join('') + '</div>', 'plat') +

    carte(
    '<div class="rang"><div style="flex:1;min-width:0"><h2>Tâches de la semaine</h2>' +
    '<div class="cs">Semaine du ' + fmtD(lundi) + '</div></div>' +
    (() => {
      /* Jours passés seulement : couleur et compte sur les mêmes jours. */
      const passes = semaine.filter(s => s.d < j && !s.ferme && s.n.total);
      if (!passes.length) return '';
      const f = passes.reduce((a, s) => a + s.n.faits, 0), t = passes.reduce((a, s) => a + s.n.total, 0);
      return pastille(pireCouleur(passes.map(s => s.c)), f + '/' + t + ' faites');
    })() + '</div>' +
    '<div class="sem7">' + semaine.map((s, i) =>
      '<button type="button" class="sem-j ' + s.c + (s.d === j ? ' auj' : '') + '"' +
      (s.d <= j ? ' data-go="clean" data-jour="' + s.d + '"' : ' disabled') +
      ' aria-label="' + esc(fmtD(s.d) + ' : ' + (s.ferme ? 'fermé' : s.n.faits + ' sur ' + s.n.total)) + '">' +
      '<span class="sem-l">' + JOURS_LETTRE[i] + '</span>' +
      '<span class="sem-v">' + (s.ferme ? '—' : s.n.total ? s.n.faits + '/' + s.n.total : '0') + '</span></button>').join('') + '</div>' +
    (auj && auj.n.total && !auj.ferme
      ? '<div class="conf-taches">' + auj.n.liste.map(t => {
          const v = auj.n.rec[t.id] || {};
          const qui = t.assignee ? (EQUIPE.filter(e => e.id === t.assignee)[0] || {}).prenom : null;
          return '<div class="conf-tache' + (v.ok ? ' fait' : '') + '">' +
            '<span class="conf-coche" aria-hidden="true">' + (v.ok ? '✓' : '') + '</span>' +
            '<span class="conf-t"><b>' + esc(t.libelle || t.nom || '') + '</b>' +
            '<span class="mini">' + (v.ok ? 'Fait par ' + esc(v.par || '—') + (v.at ? ' à ' + heure(v.at) : '')
              : 'À faire aujourd’hui' + (qui ? ' · ' + esc(qui) : '')) + '</span></span></div>';
        }).join('') + '</div>'
      : '<p class="mini" style="margin-top:10px">' + (auj && auj.ferme ? 'Boutique fermée aujourd’hui.' : 'Aucune tâche hebdomadaire prévue aujourd’hui.') + '</p>'),
    'plat');
}

const V_controle_avantConformite = V.controle;
V.controle = async function () {
  await V_controle_avantConformite.apply(this, arguments);
  const slot = $('#ctl-conformite');
  if (!slot || !STATE.user || STATE.user.role !== 'manager') return;
  /* Sans attendre : sept jours de registres à lire, la page reste utilisable. */
  /* Un lot de lectures (DB.prelire) : une clé relue n'est demandée qu'une fois. */
  const lot = DB.ouvrirLot();
  htmlConformite().then(html => {
    if (STATE.view !== 'controle' || !document.body.contains(slot)) return;
    slot.className = 'grid g2 conf-grille';
    slot.innerHTML = html;
    slot.querySelectorAll('[data-go]').forEach(b => b.onclick = () => rendre(b.dataset.go, false, b.dataset.jour));
  }).catch(e => console.warn('Conformité indisponible', e))
    .finally(() => DB.fermerLot(lot));
};
