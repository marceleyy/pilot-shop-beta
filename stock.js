/* =============================================================================
   PILOT-SHOP — stock.js
   Une seule valeur de vérité : le stock réel, exprimé en bacs.

   Trois mouvements l'alimentent, et trois seulement :
     • l'INVENTAIRE le FIXE   — c'est le point de départ, il efface le passé ;
     • la RÉCEPTION l'AUGMENTE ;
     • l'OUVERTURE d'un bac le DIMINUE.

   D'où la formule, pour un article donné :
       stock réel = quantité au dernier inventaire
                  + réceptions depuis
                  − ouvertures depuis

   Le test de référence : inventaire à 10, réception de 10, ouverture de 2
   doit donner 18.

   Chargé APRÈS modules.js.
   ============================================================================= */

'use strict';

/* Devine la famille d'un produit d'après son libellé. En cas de doute, on
   retombe sur la glace : c'est 90 % des références d'une livraison Jetfreeze. */
function devinerFamille(nom) {
  const n = String(nom || '').toLowerCase();
  if (/macaron/.test(n) && /grandioso/.test(n)) return FAMILLES_PRODUIT[2];
  if (/macaron/.test(n))                         return FAMILLES_PRODUIT[1];
  if (/gianduiotto|gianduja/.test(n))            return FAMILLES_PRODUIT[3];
  if (/gaufre|waffle/.test(n))                   return FAMILLES_PRODUIT[4];
  if (/cr[eê]pe/.test(n))                        return FAMILLES_PRODUIT[5];
  if (/chantilly/.test(n))                       return FAMILLES_PRODUIT[6];
  if (/coulis/.test(n))                          return FAMILLES_PRODUIT[7];
  if (/topping|sauce|nappage/.test(n))           return FAMILLES_PRODUIT[8];
  return FAMILLES_PRODUIT[0];
}

/* -----------------------------------------------------------------------------
   CLÉ D'ARTICLE
   Un article, c'est une famille, un parfum (pour les glaces seulement) et une
   taille de bac. « glace|Noix de coco|5 » et « glace|Noix de coco|3 » sont deux
   articles distincts : on ne mélange pas un 5 litres et un 3 litres.
   -------------------------------------------------------------------------- */
function cleArticle(famille, parfum, taille) {
  return [famille || '', parfum || '', taille || ''].join('|');
}
function litArticle(cle) {
  const p = String(cle).split('|');
  return { famille: p[0] || '', parfum: p[1] || '', taille: p[2] || '' };
}
function libelleArticle(cle) {
  const a = litArticle(cle);
  const f = FAMILLES_PRODUIT.filter(x => x.id === a.famille)[0];
  return [a.parfum, f ? f.libelle : a.famille, a.taille ? a.taille + ' L' : '']
    .filter(Boolean).join(' · ');
}

/* -----------------------------------------------------------------------------
   ÉCRITURE DES MOUVEMENTS
   Journal en ajout seul : on n'efface jamais une ligne, on en ajoute une qui
   corrige. C'est ce qui permet de reconstituer l'historique lors d'un contrôle.

   Chaque ligne est tenue courte à dessein. Une ligne bavarde pèse 240 octets ;
   4 000 lignes font alors 930 Ko, au-dessus du seuil au-delà duquel une clé
   n'est plus envoyée à Supabase. Le journal serait resté sur l'iPad, sans
   erreur visible, au bout de deux à trois mois de saison.
   Le détail lisible (famille, parfum, taille) est déjà dans la clé : on ne le
   duplique pas.
   -------------------------------------------------------------------------- */
const STOCK_POIDS_MAX = 500000;     // octets, bien en deçà du seuil de synchronisation
const STOCK_LIGNES_MAX = 2500;

/* Le journal est découpé par mois. Une seule grosse clé obligeait à relire et
   réécrire 240 Ko à chaque scan : mesuré à 131 ms par bac sur une bonne
   connexion, six secondes et demie pour une série de cinquante étiquettes,
   et bien davantage sur le Wi-Fi d'une boutique de montagne.
   Un mois pèse une centaine de kilo-octets, et seul le mois courant est écrit. */
const cleMois = d => 'stock:mv:' + String(d || today()).slice(0, 7);

/* Cache du mois courant. Borné dans le TEMPS et pas seulement par nos propres
   écritures : sans cela, un scan fait sur un autre iPad n'apparaissait jamais
   ici, puisqu'on relisait indéfiniment notre propre copie. Deux appareils en
   boutique se voyaient chacun travailler seul. */
const MOIS_CACHE_MS = 15000;
let _moisCache = { cle: null, lignes: null, at: 0 };

async function lireMois(cle) {
  if (_moisCache.cle === cle && _moisCache.lignes &&
      (Date.now() - _moisCache.at) < MOIS_CACHE_MS) {
    return _moisCache.lignes;
  }
  const l = await DB.get(cle, []);
  _moisCache = { cle: cle, lignes: l, at: Date.now() };
  return l;
}

async function ajouterMouvement(type, cle, qte, extra) {
  const cm = cleMois();
  let l = await lireMois(cm);

  /* Garde-fou contre le double appui : deux mouvements identiques à moins de
     quinze secondes d'intervalle sont presque toujours une erreur de manipulation,
     et ils fausseraient le stock de façon invisible. */
  const dernier = l[l.length - 1];
  if (dernier && dernier.t === type && dernier.c === cle &&
      num(dernier.q) === num(qte) &&
      ((extra && extra.lot) ? dernier.l === extra.lot : true) &&
      (Date.now() - new Date(dernier.a)) < 15000) {
    toast('Déjà enregistré il y a quelques secondes', 'erreur');
    return dernier;
  }

  /* Champs courts : t=type, c=clé, q=quantité, a=horodatage, e=employé, l=lot */
  const m = { t:type, c:cle, q:num(qte), a:nowISO(),
              e: STATE.user ? STATE.user.id : null };
  if (extra && extra.lot) m.l = extra.lot;
  if (extra && extra.bl)  m.b = extra.bl;
  if (extra && extra.motif) m.mo = extra.motif;
  l.push(m);

  l = await purgerJournal(l);
  _moisCache = { cle: cm, lignes: l, at: Date.now() };
  invaliderStock();
  await DB.set(cm, l);
  await noterMois(cm);
  return m;
}

/* Tous les mois utiles : depuis le dernier inventaire, ou les douze derniers. */
function moisAParcourir(depuisJour) {
  const out = [];
  const fin = new Date(today() + 'T12:00:00');
  let d = depuisJour ? new Date(depuisJour + 'T12:00:00')
                     : new Date(fin.getFullYear(), fin.getMonth() - 11, 1);
  d = new Date(d.getFullYear(), d.getMonth(), 1);
  let garde = 0;
  while (d <= fin && garde++ < 60) {
    out.push('stock:mv:' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }
  return out;
}

/* Index des mois qui contiennent réellement des mouvements.
   Sans lui, on interrogeait douze mois à l'aveugle, dont onze vides. Le
   navigateur ne lançant que six requêtes simultanées par domaine, cela faisait
   trois vagues successives : 223 ms pour afficher le stock. */
async function moisConnus() {
  const idx = await DB.get('stock:mois', null);
  return Array.isArray(idx) ? idx : null;
}
async function noterMois(cle) {
  const idx = (await DB.get('stock:mois', [])) || [];
  if (idx.indexOf(cle) >= 0) return;
  idx.push(cle);
  idx.sort();
  await DB.set('stock:mois', idx.slice(-60));
}

/* Lecture de tous les mouvements utiles, anciens formats compris.
   On ne lit que les mois qui existent, et en parallèle. */
async function tousMouvements(depuisJour, connusDejaLus) {
  const attendus = moisAParcourir(depuisJour);
  const connus = (connusDejaLus !== undefined) ? connusDejaLus : await moisConnus();
  /* Premier démarrage sans index : on interroge la fenêtre complète une fois,
     puis l'index prend le relais. */
  const cles = connus
    ? attendus.filter(c => connus.indexOf(c) >= 0)
    : attendus;

  const blocs = await Promise.all(
    ['stock:mouvements'].concat(cles).map(c => DB.get(c, []).catch(() => [])));

  const out = [];
  blocs.forEach(l => { if (l && l.length) out.push.apply(out, l); });
  return out.sort((a, b) => String(a.a || a.at).localeCompare(String(b.a || b.at)));
}

/* Le stock est recalculé à chaque rendu, et deux vues peuvent le demander
   coup sur coup — la tour de contrôle puis l'écran Stock. Un cache très court
   évite de refaire les appels pour rien, sans jamais servir une valeur périmée. */
let _stockCache = { at: 0, valeur: null };
const STOCK_CACHE_MS = 3000;

function invaliderStock() { _stockCache = { at: 0, valeur: null }; }

/* Purge fondée sur le poids autant que sur le nombre. Règle intangible :
   un mouvement postérieur au dernier inventaire n'est JAMAIS supprimé, sinon
   le stock deviendrait faux sans que rien ne le signale. */
async function purgerJournal(l) {
  let poids = 0;
  try { poids = JSON.stringify(l).length; } catch (e) { poids = l.length * 240; }
  if (l.length <= STOCK_LIGNES_MAX && poids <= STOCK_POIDS_MAX) return l;

  const inv = await DB.get('stock:inventaire', null);
  const borne = inv ? inv.at : null;
  const recents = borne ? l.filter(m => (m.a || m.at) > borne) : [];
  const anciens = borne ? l.filter(m => (m.a || m.at) <= borne) : l.slice();

  /* On rogne dans les anciens jusqu'à repasser sous les deux plafonds. */
  let garde = anciens;
  while (garde.length &&
         (garde.length + recents.length > STOCK_LIGNES_MAX ||
          JSON.stringify(garde.concat(recents)).length > STOCK_POIDS_MAX)) {
    garde = garde.slice(Math.max(1, Math.ceil(garde.length * 0.2)));
  }

  if (!garde.length && recents.length > STOCK_LIGNES_MAX) {
    /* Cas extrême : plus de 2 500 mouvements depuis le dernier inventaire.
       On garde tout quand même — fausser le stock serait pire — et on alerte. */
    console.warn('Journal de stock volumineux : ' + recents.length +
                 ' mouvements depuis le dernier inventaire. Faites un inventaire.');
  }
  return garde.concat(recents);
}

/* Un inventaire remplace le précédent : il fixe la référence.
   Et il enregistre les ÉCARTS constatés : chaque bac manquant est un bac ouvert
   sans avoir été tracé — c'est la seule explication possible, puisque le stock
   ne baisse que par la traçabilité. Ces écarts serviront au calcul de fin de
   période : théoriquement on devait vendre tant, on a vendu tant. */
async function enregistrerInventaire(lignes, note, avant) {
  const ecarts = {};
  let manquants = 0, surplus = 0;
  if (avant) {
    const cles = new Set(Object.keys(avant).concat(Object.keys(lignes)));
    cles.forEach(c => {
      const d = num(lignes[c] || 0) - num(avant[c] || 0);
      if (d === 0) return;
      ecarts[c] = d;
      if (d < 0) manquants += -d; else surplus += d;
    });
  }

  const inv = {
    jour: today(), at: nowISO(),
    par: STATE.user ? STATE.user.prenom : null,
    employe: STATE.user ? STATE.user.id : null,
    note: note || '',
    lignes: lignes,            // { cleArticle : quantité }
    ecarts: ecarts,            // écart constaté par article
    manquants: manquants,      // bacs disparus sans traçabilité
    surplus: surplus           // bacs trouvés en trop : réception non saisie
  };

  const hist = await DB.get('stock:inventaires', []);
  hist.push(inv);
  await DB.set('stock:inventaires', hist.slice(-36));
  await DB.set('stock:inventaire', inv);

  /* Le calcul d'écart de période lit encore l'ancienne clé. On l'alimente pour
     qu'un seul comptage serve aux deux usages, plutôt que deux écrans qui ne
     se parlent pas. */
  try {
    const per = (typeof periodeCourante === 'function') ? await periodeCourante() : null;
    if (per && per.id && per.id !== 'attente') {
      const parParfum = {};
      Object.keys(lignes).forEach(c => {
        const a = litArticle(c);
        if (a.famille !== 'glace' || !a.parfum) return;
        parParfum[a.parfum] = parParfum[a.parfum] || {};
        parParfum[a.parfum][a.taille] = num(lignes[c]);
      });
      const cle = 'invglace:' + per.id;
      const ex = await DB.get(cle, {});
      ex[inv.jour <= per.debut ? 'debut' : 'fin'] = {
        parfums: parParfum, par: inv.par, at: inv.at
      };
      await DB.set(cle, ex);
    }
  } catch (e) { /* l'inventaire reste valide même sans période */ }

  invaliderStock();
  return inv;
}

/* -----------------------------------------------------------------------------
   CALCUL DU STOCK RÉEL
   -------------------------------------------------------------------------- */
async function stockReel() {
  if (_stockCache.valeur && (Date.now() - _stockCache.at) < STOCK_CACHE_MS) {
    return _stockCache.valeur;
  }
  /* L'inventaire et l'index des mois sont lus ensemble : en séquence, chacun
     coûtait sa propre latence avant même de commencer à lire les mois. */
  const [inv, connus] = await Promise.all([
    DB.get('stock:inventaire', null).catch(() => null),
    moisConnus().catch(() => null)
  ]);
  const mouv = await tousMouvements(inv ? inv.jour : null, connus);

  const out = {};
  const dateInv = inv ? inv.at : null;

  if (inv && inv.lignes) {
    Object.keys(inv.lignes).forEach(c => { out[c] = num(inv.lignes[c]); });
  }

  mouv.forEach(m => {
    /* Format court depuis la réduction du journal, format long avant : on lit
       les deux pour ne pas invalider l'historique déjà écrit. */
    const type = m.t || m.type;
    const c    = m.c || m.cle;
    const q    = num(m.q !== undefined ? m.q : m.qte);
    const at   = m.a || m.at;
    if (!c) return;
    if (dateInv && at <= dateInv) return;   // déjà compris dans l'inventaire
    if (out[c] === undefined) out[c] = 0;
    if (type === 'reception') out[c] += q;
    else if (type === 'ouverture' || type === 'perte') out[c] -= q;
  });

  const resultat = { articles: out, inventaire: inv, depuis: inv ? inv.jour : null };
  _stockCache = { at: Date.now(), valeur: resultat };
  return resultat;
}

/* Lecture unifiée d'un mouvement, quel que soit le format d'écriture. */
function litMouvement(m) {
  return {
    type: m.t || m.type,
    cle:  m.c || m.cle,
    qte:  num(m.q !== undefined ? m.q : m.qte),
    at:   m.a || m.at,
    jour: (m.a || m.at || '').slice(0, 10),
    lot:  m.l || m.lot || '',
    employe: m.e || m.employe || null
  };
}

/* Total en bacs et en litres, pour le calcul d'écart.
   On distingue les bacs de glace, qui ont une contenance, des autres familles
   comptées à l'unité — chantilly, coulis, toppings. Les mélanger donnait un
   total de 163 « bacs » pour 473 litres, soit 2,9 L de moyenne : en dessous du
   plus petit format, donc une moyenne qui ne veut rien dire. */
function totauxStock(articles) {
  let bacs = 0, litres = 0, unites = 0;
  Object.keys(articles).forEach(c => {
    const q = num(articles[c]);
    if (q === 0) return;
    const t = num(litArticle(c).taille);
    if (t) { bacs += q; litres += q * t; }
    else   { unites += q; }
  });
  return { bacs: bacs, unites: unites, litres: litres,
           kg: litres * FOURNISSEUR.poidsMoyenLitre };
}

/* -----------------------------------------------------------------------------
   CONTRÔLE DE VRAISEMBLANCE
   Un stock négatif veut dire qu'on a ouvert un bac que l'application ne
   connaissait pas : livraison non saisie, bac antérieur à la mise en service,
   ou erreur de taille au moment du scan. Ce n'est pas grave en soi, mais si
   personne ne le voit, l'écart de période devient faux et on cherche un vol
   là où il n'y a qu'une saisie manquante.

   Un stock absurdement élevé dit la même chose en sens inverse : une réception
   comptée deux fois, ou une quantité saisie en litres au lieu de bacs.
   -------------------------------------------------------------------------- */
const STOCK_PLAFOND_PLAUSIBLE = 400;      // bacs : au-delà, la chambre froide déborde

function anomaliesStock(articles) {
  const out = [];
  const negatifs = Object.keys(articles).filter(c => num(articles[c]) < 0);
  if (negatifs.length) {
    const pire = negatifs.reduce((a, c) => num(articles[c]) < num(articles[a]) ? c : a, negatifs[0]);
    out.push({
      niveau: 'warn',
      titre: negatifs.length + ' article(s) en stock négatif',
      detail: 'Le plus bas : ' + libelleArticle(pire) + ' à ' + articles[pire] + '. ' +
        'Des bacs ont été ouverts sans avoir été reçus dans l’application. ' +
        'Un inventaire remet les compteurs à plat.',
      cles: negatifs
    });
  }
  const t = totauxStock(articles);
  if (t.bacs > STOCK_PLAFOND_PLAUSIBLE) {
    out.push({
      niveau: 'bad',
      titre: 'Stock invraisemblable : ' + t.bacs + ' bacs',
      detail: 'Soit ' + n1(t.kg) + ' kg, bien au-delà de ce que peut contenir la ' +
        'chambre froide. Une réception a probablement été comptée deux fois, ou ' +
        'saisie en litres au lieu de bacs.',
      cles: []
    });
  }
  return out;
}

/* -----------------------------------------------------------------------------
   RECOMPTAGE DÉCLENCHÉ PAR UN ÉCART
   Le stock ne baisse que par la traçabilité. Un bac annoncé présent mais absent
   de la chambre froide veut donc dire qu'on l'a ouvert sans le scanner — et si
   c'est arrivé une fois, c'est probablement arrivé plusieurs. On ne corrige pas
   la ligne : on redemande un comptage complet.

   Limité à la chambre froide. Recompter les cornets, gobelets et serviettes
   prendrait une heure pour ce que ça rapporte ; les bacs, ça va vite.
   -------------------------------------------------------------------------- */
async function recomptageDemande() {
  const { articles, inventaire } = await stockReel();

  /* Un négatif est la preuve d'un scan manquant : on a sorti plus que ce qu'on
     avait. C'est le signal le plus sûr. */
  const negatifs = Object.keys(articles).filter(c =>
    num(articles[c]) < 0 && litArticle(c).famille === 'glace');
  if (!negatifs.length) return null;

  /* Un recomptage fait après la détection solde la demande. */
  const dejaFait = inventaire && negatifs.every(c => {
    const l = inventaire.lignes || {};
    return l[c] !== undefined && num(l[c]) >= 0;
  });
  if (dejaFait) return null;

  return {
    articles: negatifs,
    combien: negatifs.reduce((s, c) => s + Math.abs(num(articles[c])), 0),
    exemple: libelleArticle(negatifs[0])
  };
}

/* Tâche ajoutée à la journée quand un écart est constaté. */
async function tacheRecomptage() {
  const d = await recomptageDemande();
  if (!d) return null;
  return {
    id: 'recomptage',
    t: 'Recompter la chambre froide — ' + d.combien + ' bac(s) manquant(s)',
    lien: 'inventaire',
    urgent: true,
    detail: d.exemple + ' et ' + (d.articles.length - 1) + ' autre(s). ' +
            'Un bac a été ouvert sans être scanné.'
  };
}

/* -----------------------------------------------------------------------------
   VUE — STOCK RÉEL
   -------------------------------------------------------------------------- */
V.stock = async function () {
  const { articles, inventaire } = await stockReel();
  const cles = Object.keys(articles).filter(c => num(articles[c]) !== 0)
    .sort((a, b) => libelleArticle(a).localeCompare(libelleArticle(b)));
  const t = totauxStock(articles);
  const alertes = anomaliesStock(articles);

  /* Regroupement par famille, pour ne pas dérouler quarante lignes à plat. */
  const parFamille = {};
  cles.forEach(c => {
    const f = litArticle(c).famille;
    (parFamille[f] = parFamille[f] || []).push(c);
  });

  $('#vue-actions').innerHTML = '';
  $('#page').innerHTML =
    carte('<div class="grid g3">' +
      kpi('Bacs de glace', t.bacs, '', n1(t.litres) + ' L') +
      kpi('Autres produits', t.unites, '', 'comptés à l’unité') +
      kpi('Poids', n1(t.kg) + ' kg', '', 'glace seule') + '</div>' +
      '<p class="mini" style="margin-top:12px">' +
      (inventaire
        ? 'Dernier inventaire le ' + fmtD(inventaire.jour) +
          (inventaire.par ? ' par ' + esc(inventaire.par) : '') + '.'
        : 'Aucun inventaire enregistré. Le stock ne compte que les réceptions ' +
          'et les ouvertures depuis la mise en service.') + '</p>', 'solide') +

    alertes.map(a =>
      '<div class="alerte ' + a.niveau + '" style="margin-top:12px"><span class="ai">•</span>' +
      '<div><b>' + esc(a.titre) + '</b><p>' + esc(a.detail) + '</p></div></div>').join('') +

    '<button class="btn menthe bloc xl" id="st-inv" style="margin-top:14px">Faire un inventaire</button>' +

    (cles.length
      ? Object.keys(parFamille).map(f => {
          const fam = FAMILLES_PRODUIT.filter(x => x.id === f)[0];
          const sous = parFamille[f].reduce((s, c) => s + num(articles[c]), 0);
          /* Chaque famille a son unité. Annoncer « Gaufre · 6 bacs » était faux
             et brouillait la lecture : une gaufre se compte en paquets, une
             chantilly en briques, un topping en pots. */
          const u = fam ? (Math.abs(sous) > 1 ? fam.unites : fam.unite) : 'unité(s)';
          return '<div class="entete"><h3>' + esc(fam ? fam.libelle : f) + '</h3>' +
            '<span class="pousse mini num">' + sous + ' ' + u + '</span></div>' +
            '<div class="stack">' + parFamille[f].map(c => {
              const a = litArticle(c), q = num(articles[c]);
              return carte('<div class="rang">' +
                '<div style="flex:1;min-width:0"><b>' + esc(a.parfum || (fam ? fam.libelle : f)) + '</b>' +
                (a.taille ? '<div class="mini">Bac de ' + a.taille + ' L</div>'
                  : fam ? '<div class="mini">En ' + esc(fam.unites) + '</div>' : '') + '</div>' +
                '<b class="num" style="font-size:20px">' + q + '</b></div>',
                q < 0 ? 'corail' : '');
            }).join('') + '</div>';
        }).join('')
      : vide('', 'Stock vide. Commencez par un inventaire.'));

  $('#st-inv').onclick = () => rendre('inventaire');
};

/* -----------------------------------------------------------------------------
   ALERTES DE STOCK SUR LA TOUR DE CONTRÔLE
   Le manager n'ira pas consulter l'écran Stock tous les jours. Un article
   négatif depuis trois semaines fausse pourtant tout l'écart de période.
   -------------------------------------------------------------------------- */
const V_controle_origine = V.controle;
V.controle = async function () {
  await V_controle_origine.call(this);
  const page = $('#page');
  if (!page) return;

  const { articles } = await stockReel();
  const alertes = anomaliesStock(articles);
  if (!alertes.length) return;

  const bloc = document.createElement('div');
  bloc.innerHTML = alertes.map(a =>
    carte('<div class="rang" style="align-items:flex-start">' +
      '<div style="flex:1;min-width:0"><b>' + esc(a.titre) + '</b>' +
      '<p class="mini" style="margin-top:4px">' + esc(a.detail) + '</p></div>' +
      '<button class="btn clair sm" data-go="stock">Ouvrir</button></div>',
      a.niveau === 'bad' ? 'corail' : 'ambre')).join('');

  /* Juste sous l'en-tête : c'est une alerte, pas une note de bas de page. */
  page.insertBefore(bloc, page.firstChild.nextSibling);
  $$('#page [data-go]').forEach(b => b.onclick = () => rendre(b.dataset.go));
};

/* -----------------------------------------------------------------------------
   VUE — INVENTAIRE
   Saisie des quantités, article par article. Ce que la personne compte devient
   la nouvelle référence : tout ce qui précède est effacé du calcul.
   -------------------------------------------------------------------------- */
V.inventaire = async function () {
  const { articles } = await stockReel();
  const precedent = await DB.get('stock:inventaire', null);
  const secPrec   = await DB.get('stock:sec', null);

  /* Deux comptages distincts. La chambre froide se compte vite et alimente le
     calcul d'écart ; le sec se compte rarement et porte des unités variées.
     Les mélanger obligeait à parcourir cinquante lignes pour n'en vouloir que
     vingt — et en retirant l'ancien écran « Glace et sec », j'avais purement
     et simplement supprimé le seul endroit où l'on comptait le sec. */
  let partie = 'froid';

  const saisie = {};        // chambre froide : cleArticle -> quantité
  const saisieSec = {};     // sec : libellé -> quantité

  /* Un inventaire déjà validé aujourd'hui se rouvre AVEC ses quantités.
     Sans cela, corriger une seule ligne obligeait à tout recompter : les
     champs repartaient vides et une validation partielle aurait effacé le
     reste, puisque l'inventaire remplace la référence au lieu de la compléter. */
  const dejaFaitAujourdhui = precedent && precedent.jour === today();
  if (dejaFaitAujourdhui) Object.assign(saisie, precedent.lignes || {});
  const secDejaFait = secPrec && secPrec.jour === today();
  if (secDejaFait) Object.assign(saisieSec, secPrec.lignes || {});

  /* Reprise d'un comptage interrompu : cinquante lignes à remplir debout dans
     une chambre froide, et l'onglet peut être déchargé entre deux.
     Le brouillon passe APRÈS : une saisie en cours prime sur le validé. */
  const CLE_BROUILLON = 'pilotshop.v3:brouillon:inventaire';
  try {
    const b = JSON.parse(localStorage.getItem(CLE_BROUILLON) || 'null');
    if (b && b.jour === today()) {
      Object.assign(saisie, b.lignes || {});
      Object.assign(saisieSec, b.sec || {});
    }
  } catch (e) {}
  const garderBrouillon = () => {
    try {
      localStorage.setItem(CLE_BROUILLON, JSON.stringify({
        jour: today(), lignes: saisie, sec: saisieSec, at: nowISO()
      }));
    } catch (e) {}
  };

  const COURANTES = FOURNISSEUR.taillesCourantes || TAILLES_BAC;
  const RARES     = FOURNISSEUR.taillesRares || [];
  /* Tailles retirées du catalogue mais encore en stock : sans cette reprise,
     elles resteraient dans le total sans pouvoir être recomptées. */
  const ORPHELINES = [...new Set(Object.keys(articles)
    .filter(c => num(articles[c]) !== 0 && litArticle(c).famille === 'glace')
    .map(c => num(litArticle(c).taille))
    .filter(t => t && COURANTES.indexOf(t) < 0 && RARES.indexOf(t) < 0))].sort();
  let montrerRares = RARES.some(t =>
    PARFUMS.some(p => num(articles[cleArticle('glace', p, t)]) !== 0 ||
                      saisie[cleArticle('glace', p, t)] !== undefined));

  const autres = FAMILLES_PRODUIT.filter(f => !f.parfums);

  const totalBacs   = () => Object.keys(saisie).reduce((s, c) => s + num(saisie[c]), 0);
  const totalLitres = () => Object.keys(saisie).reduce((s, c) => {
    const t = num(litArticle(c).taille);
    return s + (t ? num(saisie[c]) * t : 0);
  }, 0);
  const totalSec    = () => Object.keys(saisieSec).reduce((s, k) => s + num(saisieSec[k]), 0);

  const majTotaux = () => {
    if (partie === 'froid') {
      /* Deux compteurs distincts : les bacs de glace, qui ont une contenance,
         et les autres familles comptées à l'unité. Les additionner donnait
         « 163 bacs » pour 473 litres, soit 2,9 L de moyenne — en dessous du
         plus petit format, donc une moyenne qui ne veut rien dire. */
      const t = totauxStock(Object.keys(saisie).reduce((o, c) => {
        o[c] = num(saisie[c]); return o;
      }, {}));
      if ($('#inv-t'))  $('#inv-t').textContent  = t.bacs;
      if ($('#inv-u'))  $('#inv-u').textContent  = t.bacs > 1 ? 'bacs' : 'bac';
      if ($('#inv-kg')) $('#inv-kg').textContent =
        n1(t.kg) + ' kg' + (t.unites ? ' · ' + t.unites + ' unités' : '');
    } else {
      if ($('#inv-t'))  $('#inv-t').textContent  = totalSec();
      if ($('#inv-u'))  $('#inv-u').textContent  = 'unités';
      if ($('#inv-kg')) $('#inv-kg').textContent = Object.keys(saisieSec).length + ' réf.';
    }
  };

  /* --- Chambre froide : une ligne par parfum, tailles côte à côte --------- */
  const blocFroid = () =>
    '<div class="entete"><h3>Glaces</h3>' +
    '<button class="btn clair sm pousse" id="inv-rares">' +
    (montrerRares ? 'Masquer le 7 L' : '+ 7 L') + '</button></div>' +
    '<div class="stack">' + PARFUMS.map(p => {
      const base = montrerRares ? COURANTES.concat(RARES) : COURANTES;
      const sup = ORPHELINES.filter(t => num(articles[cleArticle('glace', p, t)]) !== 0 ||
                                         saisie[cleArticle('glace', p, t)] !== undefined);
      const tailles = base.concat(sup).sort((a, b) => a - b);
      const enStock = tailles.reduce((s, t) => s + num(articles[cleArticle('glace', p, t)]), 0);
      return '<div class="invp">' +
        '<div class="invp-h"><b>' + esc(p) + '</b>' +
        (enStock ? '<span class="invc">' + enStock + ' en stock</span>' : '') + '</div>' +
        '<div class="invp-t">' + tailles.map(t => {
          const c = cleArticle('glace', p, t);
          return '<label><span>' + t + ' L</span>' +
            '<input type="number" inputmode="numeric" min="0" step="1" data-inv="' + c + '" ' +
            'value="' + (saisie[c] !== undefined ? saisie[c] : '') + '" placeholder="0"></label>';
        }).join('') + '</div></div>';
    }).join('') + '</div>' +

    '<div class="entete"><h3>Autres familles</h3>' +
    '<span class="pousse mini">comptées à l’unité</span></div>' +
    '<div class="stack">' + autres.map(f => {
    const c = cleArticle(f.id, '', '');
    const q = num(articles[c]);
    return '<div class="invl">' +
    '<span class="invn">' + esc(f.libelle) +
    '<small>en ' + esc(f.unites) + '</small></span>' +
    (q ? '<span class="invc">' + q + ' en stock</span>' : '') +
          '<input type="number" inputmode="numeric" min="0" step="1" data-inv="' + c + '" ' +
          'value="' + (saisie[c] !== undefined ? saisie[c] : '') + '" placeholder="0"></div>';
    }).join('') + '</div>';

  /* --- Sec : une ligne par référence -------------------------------------- */
  const blocSec = () =>
    '<div class="entete"><h3>Consommables et produits non congelés</h3>' +
    '<span class="pousse mini num">' + INVENTAIRE_SEC.length + '</span></div>' +
    '<div class="stack">' + INVENTAIRE_SEC.map(nom => {
      const ancien = secPrec && secPrec.lignes ? secPrec.lignes[nom] : undefined;
      return '<div class="invl">' +
        '<span class="invn">' + esc(nom) + '</span>' +
        (ancien !== undefined ? '<span class="invc">précédent ' + ancien + '</span>' : '') +
        '<input type="number" inputmode="numeric" min="0" step="1" data-sec="' + esc(nom) + '" ' +
        'value="' + (saisieSec[nom] !== undefined ? saisieSec[nom] : '') + '" placeholder="0"></div>';
    }).join('') + '</div>';

  const dessiner = () => {
    $('#vue-actions').innerHTML = '';
    const dernier = partie === 'froid' ? precedent : secPrec;
    const dejaCeJour = partie === 'froid' ? dejaFaitAujourdhui : secDejaFait;
    $('#page').innerHTML =
      carte('<h2>' + (dejaCeJour ? 'Corriger l’inventaire' : 'Faire l’inventaire') + '</h2>' +
        '<div class="cs">' + (dejaCeJour
          ? 'Les quantités comptées sont préremplies. Modifiez ce qu’il faut, ' +
            'puis revalidez — le reste est conservé.'
          : 'Comptez ce qui est physiquement présent. Ce relevé devient la ' +
            'nouvelle référence.') + '</div>' +
        (dernier
          ? '<p class="rappel" style="margin-top:12px">' +
            (dejaCeJour ? 'Validé aujourd’hui à ' + heure(dernier.at) : 'Dernier comptage : ' + fmtD(dernier.jour)) +
            (dernier.par ? ' par ' + esc(dernier.par) : '') + '</p>'
          : ''), 'solide') +

      '<div class="tseg">' +
      [['froid', 'Chambre froide', PARFUMS.length + ' parfums'],
       ['sec',   'Sec',            INVENTAIRE_SEC.length + ' références']].map(x =>
        '<button class="' + (x[0] === partie ? 'on' : '') + '" data-partie="' + x[0] + '">' +
        '<span class="tsl">' + x[1] + '</span><small>' + x[2] + '</small></button>').join('') +
      '</div>' +

      '<div class="inv-total"><b class="num" id="inv-t">0</b>' +
      '<span id="inv-u">bacs</span>' +
      '<b class="num" id="inv-kg" style="margin-left:auto">0,0 kg</b></div>' +

      (partie === 'froid' ? blocFroid() : blocSec()) +

      '<div class="champ" style="margin-top:18px"><label class="f">Note</label>' +
      '<textarea id="inv-note" placeholder="Ce qui explique un écart, un bac abîmé, un doute."></textarea></div>' +

      '<button class="btn menthe bloc xl" id="inv-ok" style="margin-top:16px">' +
      (dejaCeJour
        ? (partie === 'froid' ? 'Revalider la chambre froide' : 'Revalider le sec')
        : (partie === 'froid' ? 'Valider la chambre froide'   : 'Valider le sec')) +
      '</button>';

    $$('[data-partie]').forEach(b => b.onclick = () => {
      if (b.dataset.partie === partie) return;
      partie = b.dataset.partie;
      dessiner();
    });

    $$('[data-inv]').forEach(i => i.oninput = () => {
      if (i.value === '') delete saisie[i.dataset.inv];
      else saisie[i.dataset.inv] = i.value;
      garderBrouillon();
      majTotaux();
    });
    $$('[data-sec]').forEach(i => i.oninput = () => {
      if (i.value === '') delete saisieSec[i.dataset.sec];
      else saisieSec[i.dataset.sec] = i.value;
      garderBrouillon();
      majTotaux();
    });
    majTotaux();

    const br = $('#inv-rares');
    if (br) br.onclick = () => { montrerRares = !montrerRares; dessiner(); };

    $('#inv-ok').onclick = partie === 'froid' ? validerFroid : validerSec;
  };

  async function validerFroid() {
    const cptes = Object.keys(saisie);
    if (!cptes.length) return toast('Saisissez au moins une quantité', 'erreur');

    const lignes = {};
    cptes.forEach(c => { lignes[c] = num(saisie[c]); });
    const t = totauxStock(lignes);

    /* État AVANT le comptage : c'est lui qui révèle les bacs disparus. */
    const avant = (await stockReel()).articles;
    const ecart = Object.keys(lignes).reduce((s, c) =>
      s + (num(lignes[c]) - num(avant[c] || 0)), 0);

    confirmer('Valider la chambre froide ?',
      t.bacs + ' bacs comptés sur ' + cptes.length + ' référence(s), soit ' +
      n1(t.kg) + ' kg. ' +
      (ecart === 0 ? 'Cela correspond exactement au stock attendu.'
       : ecart < 0 ? Math.abs(ecart) + ' bac(s) de moins qu’attendu — des ouvertures non tracées.'
       : ecart + ' bac(s) de plus qu’attendu — une réception non saisie.'),
      'Valider', async () => {
        const inv = await enregistrerInventaire(lignes,
          $('#inv-note') ? $('#inv-note').value : '', avant);
        /* Le brouillon est effacé — il n'a plus lieu d'être puisque c'est
           validé — mais PAS la saisie : revenir sur l'écran doit montrer les
           quantités enregistrées, pas un formulaire vide. */
        try { localStorage.removeItem(CLE_BROUILLON); } catch (e) {}
        await feed(inv.manquants ? 'warn' : 'ok',
          STATE.user.prenom + ' a compté la chambre froide — ' + t.bacs + ' bacs, ' + n1(t.kg) + ' kg' +
          (inv.manquants ? ' · ' + inv.manquants + ' bac(s) manquant(s)' : ''));
        toast('Chambre froide enregistrée');
        rendre('stock');
      });
  }

  async function validerSec() {
    const cptes = Object.keys(saisieSec);
    if (!cptes.length) return toast('Saisissez au moins une quantité', 'erreur');
    const lignes = {};
    cptes.forEach(k => { lignes[k] = num(saisieSec[k]); });

    confirmer('Valider le sec ?',
      cptes.length + ' référence(s) comptée(s). Ce relevé remplace le précédent.',
      'Valider', async () => {
        await DB.set('stock:sec', {
          jour: today(), at: nowISO(),
          par: STATE.user ? STATE.user.prenom : null,
          employe: STATE.user ? STATE.user.id : null,
          note: $('#inv-note') ? $('#inv-note').value : '',
          lignes: lignes
        });
        try { localStorage.removeItem(CLE_BROUILLON); } catch (e) {}
        await feed('ok', STATE.user.prenom + ' a compté le sec — ' + cptes.length + ' références');
        toast('Inventaire du sec enregistré');
        rendre('stock');
      });
  }

  dessiner();
};
