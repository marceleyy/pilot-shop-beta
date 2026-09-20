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
/* Reconnaît le parfum dans une désignation de bon de livraison.
   « Glace Cerise Griotte 3 litres » doit devenir « Amarena », pas la phrase
   entière : sans ça la réception crée un article fantôme que l'inventaire ne
   retrouvera jamais, et le stock se dédouble silencieusement.

   Les désignations Jetfreeze n'emploient pas les mêmes mots que notre
   catalogue : Cerise Griotte pour Amarena, Cioccolato pour Chocolat noir,
   Limone Bio pour Citron bio. */
const DESIGNATION_PARFUM = [
  [/cerise|griotte|amarena/i,              'Amarena'],
  [/banan/i,                               'Banane'],
  [/caff|café|cafe\b|coffee/i,             'Café'],
  [/caramel/i,                             'Caramel au beurre salé'],
  [/cioccolato amorino|chocolat amorino/i, 'Chocolat noir'],
  [/equateur|équateur/i,                   'Chocolat équateur'],
  [/chocolat.*bio|cioccolato.*bio/i,       'Chocolat bio (sorbet)'],
  [/limone.*b|citron bio/i,                'Citron bio'],
  [/basilic|basilico/i,                    'Citron vert basilic'],
  [/dulce|leche/i,                         'Dulce de leche'],
  [/fragola|fraise|strawberr/i,            'Fraise'],
  [/lampone|framboise|raspberr/i,          'Framboise'],
  [/passion/i,                             'Fruit de la passion'],
  [/inimitable/i,                          'Inimitable'],
  [/mango|mangue/i,                        'Mangue'],
  [/nocciola|noisette|hazelnut/i,          'Noisette'],
  [/cocco|coco\b/i,                        'Noix de coco'],
  [/sanguin|arancia/i,                     'Orange sanguine'],
  [/pista/i,                               'Pistache'],
  [/stracciatella/i,                       'Stracciatella'],
  [/tiramis/i,                             'Tiramisu'],
  [/vanig|vanille|vaniglia|vanilla/i,      'Vanille'],
  [/yogurt|yaourt/i,                       'Yogurt']
];

function parfumDepuisDesignation(nom) {
  const n = String(nom || '');
  for (const [re, p] of DESIGNATION_PARFUM) if (re.test(n)) return p;
  return null;
}

/* Taille du bac lue dans la désignation : « Glace Café 3 litres ». */
function tailleDepuisDesignation(nom) {
  const m = String(nom || '').match(/(\d+)\s*litres?/i);
  return m ? +m[1] : null;
}

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

/* Le numéro de lot n'identifie PAS un bac : deux bacs de vanille d'une même
   production portent souvent le même numéro. C'est l'inventaire qui fait foi —
   s'il dit quatre vanilles, il y a quatre bacs, quels que soient leurs numéros.

   Le bon repère est donc le stock disponible, pas le lot. On alerte quand on
   ouvre un bac qu'on n'a plus : le stock est à zéro ou déjà négatif.

   Une alerte fondée sur le lot se serait déclenchée à chaque ouverture
   légitime. Et une alerte qui se trompe souvent ne sert plus à rien : on prend
   l'habitude de confirmer sans lire, et le jour où elle a raison, on confirme
   aussi. */
async function stockInsuffisant(cle) {
  try {
    const s = await stockReel();
    const q = num(s.articles[cle] || 0);
    if (q > 0) return null;
    return { reste: q, article: libelleArticle(cle),
             depuis: s.inventaire ? s.inventaire.jour : null };
  } catch (e) { return null; }
}

async function ajouterMouvement(type, cle, qte, extra) {
  /* Garde-fous d'entrée. Une quantité négative sur une réception équivaut à
     une sortie déguisée, et un type non prévu ne compterait nulle part :
     mieux vaut refuser que d'écrire une ligne que le calcul ignorera. */
  const TYPES = ['reception', 'ouverture', 'perte'];
  if (TYPES.indexOf(type) < 0) {
    console.error('Type de mouvement refusé :', type);
    return null;
  }
  const q = Math.abs(num(qte));
  if (!q) {
    console.warn('Mouvement de quantité nulle, ignoré :', type, cle);
    return null;
  }

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
  const m = { t:type, c:cle, q:q, a:nowISO(),
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
  /* Une correction du même jour REMPLACE son entrée au lieu d'en ajouter une :
     rouvrir et revalider trois fois ne doit pas laisser trois lignes dans
     l'historique, dont deux qui ne correspondent à aucun comptage réel. */
  const i = hist.findIndex(h => h.jour === inv.jour);
  if (i >= 0) hist[i] = inv; else hist.push(inv);
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
    /* Les trois types sont nommés explicitement, et rien d'autre n'agit sur le
       stock. La version précédente décrémentait pour TOUT ce qui n'était pas une
       réception : le jour où j'ajouterai un « transfert » ou un « retour
       fournisseur » sans toucher à cette ligne, il aurait faussé le stock en
       silence — le pire type d'erreur, celui qu'on ne voit qu'à l'inventaire. */
    if (type === 'reception')      out[c] += q;
    else if (type === 'ouverture') out[c] -= q;
    else if (type === 'perte')     out[c] -= q;
    else console.warn('Type de mouvement inconnu, ignoré :', type, c);
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
  const negatifs = Object.keys(articles).filter(c => {
    if (num(articles[c]) >= 0) return false;
    /* Les familles comptées au SEC ne déclenchent pas de recomptage ici :
       chantilly, coulis, toppings. Leur stock de référence est l'inventaire du
       sec, pas celui de la chambre froide. Une ouverture de chantilly passait
       la clé « chantilly|| » en négatif, et l'inventaire du sec — qui compte
       « sec|creme| » — ne pouvait jamais la remettre à zéro. La tâche
       « Recompter Chantilly » restait donc affichée après un comptage complet. */
    const fam = FAMILLES_PRODUIT.filter(f => f.id === litArticle(c).famille)[0];
    if (fam && (fam.lieu === 'sec' || fam.stock === 'sec')) return false;
    return true;
  });
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
     avait. C'est le signal le plus sûr.

     Toutes les familles comptent, pas seulement les glaces. Un coulis à −1 dit
     la même chose qu'un bac à −1 : une ouverture non tracée ou une livraison
     non saisie. Le filtre sur la seule famille « glace » laissait passer en
     silence les coulis, toppings, chantilly, macarons et gaufres — vérifié sur
     un Coulis à −1 qui ne déclenchait aucune demande.

     La chambre froide reste prioritaire dans le libellé de la tâche, parce que
     c'est là que le recomptage va vite. */
  const negatifs = Object.keys(articles).filter(c => {
    if (num(articles[c]) >= 0) return false;
    /* Même règle que anomaliesStock : les familles comptées au sec n'ont pas
       leur référence en chambre froide, on ne demande pas de les y recompter. */
    const fam = FAMILLES_PRODUIT.filter(f => f.id === litArticle(c).famille)[0];
    return !(fam && (fam.lieu === 'sec' || fam.stock === 'sec'));
  });
  if (!negatifs.length) return null;
  const froid = negatifs.filter(c => litArticle(c).famille === 'glace');

  /* Un recomptage ne solde la demande que s'il a eu lieu APRÈS le négatif.
     La version précédente vérifiait seulement que l'article figurait dans
     l'inventaire à une valeur positive ou nulle. Or un parfum compté à zéro
     puis ouvert donne −1, et ce comptage est bien antérieur au problème :
     l'alerte restait donc muette précisément dans le cas qu'elle devait
     détecter. Vérifié sur le Citron bio à −1, aucun recomptage n'était demandé.

     La seule preuve qu'un recomptage a eu lieu depuis, c'est qu'il ne reste
     plus de négatif. Et on vient de constater qu'il y en a. */
  return {
    articles: negatifs,
    froid: froid.length,
    combien: negatifs.reduce((s, c) => s + Math.abs(num(articles[c])), 0),
    exemple: libelleArticle(negatifs[0]),
    depuis: inventaire ? inventaire.jour : null
  };
}

/* Tâche ajoutée à la journée quand un écart est constaté. */
async function tacheRecomptage() {
  const d = await recomptageDemande();
  if (!d) return null;

  /* Le titre NOMME le produit et dit QUEL inventaire faire. « Recompter le
     stock — 1 manquant » ne disait ni quoi ni où : l'équipière ouvrait
     l'inventaire sans savoir si c'était la chambre froide ou le sec.
     La chantilly est au sec ; un bac de vanille est en chambre froide. */
  const noms = d.articles.map(c => libelleArticle(c).split(' · ')[0]);
  const liste = noms.length <= 3 ? noms.join(', ')
    : noms.slice(0, 2).join(', ') + ' et ' + (noms.length - 2) + ' autre(s)';
  const ou = d.froid ? 'Chambre froide' : 'Sec';

  return {
    id: 'recomptage',
    t: 'Recompter ' + liste + ' — inventaire ' + ou.toLowerCase(),
    lien: 'inventaire',
    partie: d.froid ? 'froid' : 'sec',
    urgent: true,
    /* Le détail explique POURQUOI la tâche est là et QUOI faire, pour qu'un
       appui l'affiche en clair au lieu de renvoyer vers un écran muet. */
    detail: 'Le stock annonce ' + (d.articles.length > 1 ? 'des quantités négatives' : 'une quantité négative') +
      ' : on a sorti plus que ce qui était compté. Soit un produit a été ouvert ' +
      'sans être saisi, soit une livraison n’a pas été enregistrée. ' +
      'Ouvrez « Faire l’inventaire », onglet ' + ou + ', comptez ' + liste +
      ' et validez : le compte repart sur ce qui est physiquement là.'
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

  /* Le dernier comptage du sec, par section et par référence. */
  if (typeof chargerCatalogueSec === 'function') await chargerCatalogueSec();
  const sec = await DB.get('stock:sec', null);
  const secBloc = (function () {
    if (!sec || !sec.lignes || !Object.keys(sec.lignes).length) {
      return '<div class="entete" style="margin-top:22px"><h3>Sec</h3></div>' +
        carte('<p class="cs">Le sec n’a jamais été compté.</p>' +
          '<button class="btn clair bloc" id="st-inv-sec" style="margin-top:10px">Compter le sec</button>', 'plat');
    }
    const cat = (typeof catalogueSec === 'function') ? catalogueSec() : INVENTAIRE_SEC;
    const sections = (typeof SEC_SECTIONS !== 'undefined')
      ? SEC_SECTIONS.map(s => typeof s === 'string' ? { id:s } : s) : [];
    const l = sec.lignes;
    const nomRef = (id) => { const r = cat.filter(x => x.id === id)[0]; return r || null; };

    /* On regroupe les lignes comptées par référence : sec|cornet|Petit → cornet */
    const parRef = {};
    Object.keys(l).forEach(k => {
      const p = k.split('|'); if (p[0] !== 'sec') return;
      (parRef[p[1]] = parRef[p[1]] || []).push({ v: p[2] || '', q: num(l[k]) });
    });

    return '<div class="entete" style="margin-top:22px"><h3>Sec</h3>' +
      '<span class="pousse mini">compté le ' + fmtD(sec.jour) + (sec.par ? ' par ' + esc(sec.par) : '') + '</span></div>' +
      sections.map(s => {
        const refs = cat.filter(r => (r.sec || 'Autres') === s.id && parRef[r.id]);
        if (!refs.length) return '';
        return '<div class="sec-bloc"' + (s.teinte ? ' style="--sec-teinte:' + s.teinte + '"' : '') + '>' +
          '<div class="entete sec-entete"><span class="sec-pastille"></span><h3>' + esc(s.id) + '</h3></div>' +
          '<div class="stack">' + refs.map(r => {
            const lignes = parRef[r.id];
            const tot = lignes.reduce((a, x) => a + x.q, 0);
            const detail = lignes.filter(x => x.v).map(x => esc(x.v) + ' ' + n1(x.q)).join(' · ');
            return carte('<div class="rang"><div style="flex:1;min-width:0"><b>' + esc(r.nom) + '</b>' +
              (detail ? '<div class="mini">' + detail + '</div>' : '') + '</div>' +
              '<b class="num" style="font-size:18px">' + n1(tot) + ' <small style="font-size:11px;color:var(--brume)">' +
              esc(r.unite) + (tot > 1 ? 's' : '') + '</small></b></div>', tot === 0 ? 'corail' : '');
          }).join('') + '</div></div>';
      }).join('') +
      '<button class="btn clair bloc" id="st-inv-sec" style="margin-top:12px">Recompter le sec</button>';
  })();

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
          const u = fam ? (Math.abs(sous) > 1 ? fam.unites : fam.unite) : 'unité(s)';

          /* Les glaces se regroupent par PARFUM, avec le détail des tailles sur
             la même ligne. En listant une ligne par taille, « 6 Amarena » ne
             disait pas s'il s'agissait de six bacs de 3 L ou d'un mélange — et
             c'est précisément ce qu'on a besoin de savoir devant la chambre
             froide pour vérifier ce qui est réellement là. */
          const lignes = (f === 'glace')
            ? (function () {
                const parParfum = {};
                parFamille[f].forEach(c => {
                  const a = litArticle(c);
                  (parParfum[a.parfum] = parParfum[a.parfum] || []).push(c);
                });
                return Object.keys(parParfum).sort((x, y) => x.localeCompare(y)).map(p => {
                  const tailles = parParfum[p]
                    .sort((x, y) => num(litArticle(x).taille) - num(litArticle(y).taille));
                  const n = tailles.reduce((s, c) => s + num(articles[c]), 0);
                  const negatif = tailles.some(c => num(articles[c]) < 0);
                  return carte('<div class="rang">' +
                    '<div style="flex:1;min-width:0"><b>' + esc(p) + '</b>' +
                    '<div class="mini tailles">' + tailles.map(c => {
                      const q = num(articles[c]);
                      return '<span class="tq' + (q < 0 ? ' neg' : '') + '">' +
                             '<b>' + q + '</b>×' + litArticle(c).taille + ' L</span>';
                    }).join('') + '</div></div>' +
                    '<b class="num" style="font-size:20px">' + n + '</b></div>',
                    negatif ? 'corail' : '');
                }).join('');
              })()
            : parFamille[f].map(c => {
                const a = litArticle(c), q = num(articles[c]);
                return carte('<div class="rang">' +
                  '<div style="flex:1;min-width:0"><b>' + esc(a.parfum || (fam ? fam.libelle : f)) + '</b>' +
                  (fam ? '<div class="mini">En ' + esc(fam.unites) + '</div>' : '') + '</div>' +
                  '<b class="num" style="font-size:20px">' + q + '</b></div>',
                  q < 0 ? 'corail' : '');
              }).join('');

          return '<div class="entete"><h3>' + esc(fam ? fam.libelle : f) + '</h3>' +
            '<span class="pousse mini num">' + sous + ' ' + u + '</span></div>' +
            '<div class="stack">' + lignes + '</div>';
        }).join('')
      : vide('', 'Stock vide. Commencez par un inventaire.')) +

    /* Le sec, tel que compté au dernier inventaire. Il ne bouge pas avec la
       traçabilité — on ne scanne pas un carton de serviettes —, donc on affiche
       le dernier comptage avec sa date. L'écran s'appelait « ce qui reste en
       chambre froide » et n'en montrait que la moitié. */
    secBloc;

  $('#st-inv').onclick = () => rendre('inventaire');
  const bs = $('#st-inv-sec');
  if (bs) bs.onclick = () => { STATE.inventairePartie = 'sec'; rendre('inventaire'); };
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

  /* -----------------------------------------------------------------------------
     ANOMALIES SIGNALÉES
     Elles étaient enregistrées et affichées à l'équipe, mais la tour de contrôle
     ne les lisait jamais : le manager ne voyait donc rien remonter. Une panne
     signalée à 14 h restait invisible tant que personne n'ouvrait l'écran
     Anomalie — qui n'est même pas dans la barre du manager.
     -------------------------------------------------------------------------- */
  const anomalies = (await DB.get('anomalies', [])).filter(a => !a.resolue);
  if (anomalies.length) {
    /* Ce qui remonte en tête : les signalements bloquants, ET tout ce qui
       touche au froid ou à la sécurité alimentaire, quelle que soit la gravité
       choisie par la personne.

       « Congélateur crêpe gaufre » avait été classé en « gêne » : c'est
       compréhensible du point de vue de l'équipe, qui juge la façon dont ça
       perturbe le service. Mais une unité froide qui défaille est un risque
       sanitaire, pas une gêne, et ça ne peut pas attendre en bas de page. */
    const urgente = a => a.gravite === 'bloquant' ||
                         a.categorie === 'froid' || a.categorie === 'securite' ||
                         /congélateur|congelateur|frigo|vitrine|chambre froide|température/i
                           .test((a.titre || '') + ' ' + (a.detail || ''));
    const urgentes = anomalies.filter(urgente);
    const ordre = urgentes.concat(anomalies.filter(a => !urgente(a)));

    const bloc = document.createElement('div');
    bloc.innerHTML =
      '<div class="entete" style="margin-top:18px"><h3>Signalements en attente</h3>' +
      '<span class="pousse mini num">' + anomalies.length + '</span></div>' +
      '<div class="stack">' +
      ordre.slice(0, 6).map(a => {
        const cat = (ANOMALIES.categories.filter(c => c.id === a.categorie)[0] || {}).libelle || a.categorie;
        return carte('<div class="rang" style="align-items:flex-start">' +
          '<div style="flex:1;min-width:0"><b>' + esc(a.titre) + '</b>' +
          '<p class="mini" style="margin-top:3px">' + esc(cat) + ' · ' +
          esc(a.par) + ' · ' + fmtD(a.jour) + (a.at ? ' à ' + heure(a.at) : '') + '</p>' +
          (a.detail ? '<p class="mini" style="margin-top:4px">' + esc(a.detail) + '</p>' : '') +
          '</div>' +
          '<button class="btn clair sm" data-anores="' + esc(a.id) + '">Traité</button></div>',
          urgente(a) ? 'corail' : 'ambre');
      }).join('') +
      (anomalies.length > 6
        ? '<button class="btn clair bloc" data-go="anomalie">Voir les ' +
          anomalies.length + ' signalements</button>'
        : '') +
      '</div>';

    /* En tête de page dès qu'un signalement touche le froid ou bloque le service. */
    if (urgentes.length) page.insertBefore(bloc, page.firstChild.nextSibling);
    else page.appendChild(bloc);

    $$('#page [data-anores]').forEach(b => b.onclick = async () => {
      const l = await DB.get('anomalies', []);
      const a = l.filter(x => x.id === b.dataset.anores)[0];
      if (a) { a.resolue = true; a.resoluePar = STATE.user.prenom; a.resolueAt = nowISO(); }
      await DB.set('anomalies', l);
      if (a) await feed('ok', STATE.user.prenom + ' a traité : ' + a.titre);
      rendre('controle');
    });
    $$('#page [data-go]').forEach(b => b.onclick = () => rendre(b.dataset.go));
  }

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

/* -----------------------------------------------------------------------------
   CATALOGUE DU SEC, MODIFIABLE PAR LE MANAGER
   Le catalogue d'usine vit dans config.js. Le manager peut le corriger depuis
   le Back-office : ses modifications sont enregistrées en base et se
   superposent, référence par référence. Une mise à jour du code ne perd donc
   jamais les réglages de la boutique.

   Forme des modifications, sous la clé « catalogue:sec » :
     { masques: ['id1','id2'],            références retirées de l'affichage
       modifs:  { id: { unite, decimal, variantes, nom } },
       ajouts:  [ { id, sec, nom, unite, decimal, variantes } ] }
   -------------------------------------------------------------------------- */
let _catalogueSec = null;

function catalogueSecBrut() {
  return INVENTAIRE_SEC.map(r => typeof r === 'string'
    ? { id:r, nom:r, unite:'unité', decimal:false } : Object.assign({}, r));
}

/* Synchrone, à partir du dernier chargement. */
function catalogueSec() {
  return _catalogueSec || catalogueSecBrut();
}

/* À appeler avant de dessiner un écran qui s'en sert. */
async function chargerCatalogueSec() {
  const m = await DB.get('catalogue:sec', null);
  const base = catalogueSecBrut();
  if (!m) { _catalogueSec = base; return base; }
  const out = base.map(r => {
    const mod = (m.modifs || {})[r.id];
    const x = mod ? Object.assign({}, r, mod) : r;
    if ((m.masques || []).indexOf(r.id) >= 0) x.masque = true;
    return x;
  });
  (m.ajouts || []).forEach(a => { if (a && a.id && !out.some(r => r.id === a.id)) out.push(a); });
  _catalogueSec = out;
  return out;
}

async function enregistrerCatalogueSec(m) {
  await DB.set('catalogue:sec', m);
  _catalogueSec = null;
  await chargerCatalogueSec();
}

/* -----------------------------------------------------------------------------
   VUE — CATALOGUE (manager)
   -------------------------------------------------------------------------- */
V.catalogue = async function () {
  if (!STATE.user || STATE.user.role !== 'manager') {
    $('#page').innerHTML = vide('', 'Réservé au manager.'); return;
  }
  const m = (await DB.get('catalogue:sec', null)) || { masques:[], modifs:{}, ajouts:[] };
  m.masques = m.masques || []; m.modifs = m.modifs || {}; m.ajouts = m.ajouts || [];
  await chargerCatalogueSec();
  const cat = catalogueSec();
  const sections = (typeof SEC_SECTIONS !== 'undefined')
    ? SEC_SECTIONS.map(s => typeof s === 'string' ? { id:s } : s) : [];
  const UNITES = ['carton','ramette','pack','boîte','brique','flacon','pot','rouleau','sachet','unité'];

  $('#vue-actions').innerHTML = '';
  $('#page').innerHTML =
    carte('<h2>Catalogue du sec</h2>' +
      '<div class="cs">Ce que l’inventaire et le réassort proposent. Retirez ce que ' +
      'vous ne comptez plus, ajoutez ce qui manque, changez une unité ou une ' +
      'déclinaison. Vos réglages survivent aux mises à jour.</div>', 'solide') +

    sections.map(s => {
      const refs = cat.filter(r => (r.sec || 'Autres') === s.id);
      if (!refs.length) return '';
      return '<div class="sec-bloc"' + (s.teinte ? ' style="--sec-teinte:' + s.teinte + '"' : '') + '>' +
        '<div class="entete sec-entete"><span class="sec-pastille"></span><h3>' + esc(s.id) + '</h3>' +
        '<button class="btn clair sm" data-ajout="' + esc(s.id) + '">+ Ajouter</button></div>' +
        '<div class="stack">' + refs.map(r =>
          carte('<div class="rang">' +
            '<div style="flex:1;min-width:0">' +
            '<b' + (r.masque ? ' style="text-decoration:line-through;opacity:.5"' : '') + '>' +
            esc(r.nom) + '</b>' +
            '<div class="mini">' + esc(r.unite) + (r.decimal === false ? ' · entiers' : ' · demi possible') +
            (r.variantes && r.variantes.length ? ' · ' + r.variantes.length + ' déclinaisons' : '') +
            '</div></div>' +
            '<div class="duo compact">' +
            '<button class="btn clair" data-edit="' + esc(r.id) + '" aria-label="Modifier">✎</button>' +
            '<button class="btn ' + (r.masque ? 'menthe' : 'clair') + '" data-masque="' + esc(r.id) + '" ' +
            'aria-label="' + (r.masque ? 'Réafficher' : 'Retirer') + '">' + (r.masque ? '↺' : '−') + '</button>' +
            '</div></div>', r.masque ? 'plat' : '')
        ).join('') + '</div></div>';
    }).join('');

  $$('[data-masque]').forEach(b => b.onclick = async () => {
    const id = b.dataset.masque;
    const i = m.masques.indexOf(id);
    if (i >= 0) m.masques.splice(i, 1); else m.masques.push(id);
    await enregistrerCatalogueSec(m);
    await feed('ok', STATE.user.prenom + (i >= 0 ? ' a réaffiché ' : ' a retiré ') + id + ' du catalogue');
    rendre('catalogue');
  });

  const editer = (r, section) => {
    const neuf = !r;
    r = r || { id:'', sec:section, nom:'', unite:'carton', decimal:true, variantes:[] };
    showSheet(
      '<h2 id="sheet-titre">' + (neuf ? 'Nouvelle référence' : 'Modifier') + '</h2>' +
      '<div class="champ" style="margin-top:14px"><label class="f">Nom</label>' +
      '<input type="text" id="ct-nom" value="' + esc(r.nom) + '" placeholder="Ex. Cornets"></div>' +
      '<div class="champ" style="margin-top:12px"><label class="f">Unité comptée</label>' +
      '<div class="pastilles">' + UNITES.map(u =>
        '<button type="button" class="pas' + (u === r.unite ? ' on' : '') + '" data-u="' + u + '">' + u + '</button>').join('') +
      '</div></div>' +
      '<div class="champ" style="margin-top:12px"><label class="f">Saisie</label>' +
      '<div class="pastilles">' +
      '<button type="button" class="pas' + (r.decimal !== false ? ' on' : '') + '" data-dec="1">Demi possible (2,5)</button>' +
      '<button type="button" class="pas' + (r.decimal === false ? ' on' : '') + '" data-dec="0">Entiers seulement</button>' +
      '</div></div>' +
      '<div class="champ" style="margin-top:12px"><label class="f">Déclinaisons, une par ligne</label>' +
      '<textarea id="ct-var" rows="4" placeholder="Petit\nClassique\nGrand">' +
      esc((r.variantes || []).join('\n')) + '</textarea></div>' +
      '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
      '<button class="btn menthe" id="ct-ok">Enregistrer</button></div>');

    let unite = r.unite, decimal = r.decimal !== false;
    $$('[data-u]').forEach(b => b.onclick = () => {
      unite = b.dataset.u; $$('[data-u]').forEach(x => x.classList.toggle('on', x === b)); });
    $$('[data-dec]').forEach(b => b.onclick = () => {
      decimal = b.dataset.dec === '1'; $$('[data-dec]').forEach(x => x.classList.toggle('on', x === b)); });

    $('#ct-ok').onclick = async () => {
      const nom = $('#ct-nom').value.trim();
      if (!nom) return toast('Le nom est obligatoire', 'erreur');
      const variantes = $('#ct-var').value.split('\n').map(s => s.trim()).filter(Boolean);
      if (neuf) {
        const id = 'm_' + nom.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '').slice(0, 20) + '_' + Date.now().toString(36).slice(-4);
        m.ajouts.push({ id, sec:section, nom, unite, decimal, variantes });
      } else {
        m.modifs[r.id] = { nom, unite, decimal, variantes };
      }
      await enregistrerCatalogueSec(m);
      await feed('ok', STATE.user.prenom + (neuf ? ' a ajouté ' : ' a modifié ') + nom + ' au catalogue');
      closeSheet();
      rendre('catalogue');
    };
  };

  $$('[data-edit]').forEach(b => b.onclick = () => {
    editer(cat.filter(r => r.id === b.dataset.edit)[0]);
  });
  $$('[data-ajout]').forEach(b => b.onclick = () => editer(null, b.dataset.ajout));
};

V.inventaire = async function () {
  await chargerCatalogueSec();
  const { articles } = await stockReel();
  const precedent = await DB.get('stock:inventaire', null);
  const secPrec   = await DB.get('stock:sec', null);
  const historique = await DB.get('stock:inventaires', []);
  /* L'historique du sec, séparé : les deux comptages ne se font pas le même
     jour ni par la même personne, et on doit pouvoir voir l'un sans l'autre. */
  const historiqueSec = await DB.get('stock:secs', []);

  /* Deux comptages distincts. La chambre froide se compte vite et alimente le
     calcul d'écart ; le sec se compte rarement et porte des unités variées.
     Les mélanger obligeait à parcourir cinquante lignes pour n'en vouloir que
     vingt — et en retirant l'ancien écran « Glace et sec », j'avais purement
     et simplement supprimé le seul endroit où l'on comptait le sec. */
  let partie = 'froid';
  /* Une tâche de recomptage peut demander l'onglet directement : on l'ouvre
     sur le sec ou la chambre froide selon le produit concerné, puis on oublie
     la demande pour ne pas y revenir au prochain passage. */
  if (STATE.inventairePartie === 'sec' || STATE.inventairePartie === 'froid') {
    partie = STATE.inventairePartie;
    STATE.inventairePartie = null;
  }

  const saisie = {};        // chambre froide : cleArticle -> quantité
  const saisieSec = {};     // sec : libellé -> quantité

  /* Un inventaire validé est VERROUILLÉ, pas modifiable au fil de l'eau.
     Le geste correct est celui des commandes : c'est figé, et si un doute
     surgit — « il devait y avoir du citron » — on rouvre explicitement, on
     corrige, on revalide. L'ouverture permanente laissait croire qu'on peut
     tripoter les chiffres après coup, ce qui n'a pas sa place sur un registre.

     Et ça ne vaut QUE pour la journée en cours : le lendemain, on ne revient
     pas sur l'inventaire de la veille, on en fait un nouveau. */
  const dejaFaitAujourdhui = precedent && precedent.jour === today();
  if (dejaFaitAujourdhui) Object.assign(saisie, precedent.lignes || {});
  const secDejaFait = secPrec && secPrec.jour === today();
  if (secDejaFait) Object.assign(saisieSec, secPrec.lignes || {});

  /* Verrouillé tant que la personne n'a pas demandé à rouvrir. */
  let ouvertFroid = !dejaFaitAujourdhui;
  let ouvertSec   = !secDejaFait;

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

  /* Les familles comptées en chambre froide : tout sauf les glaces (qui ont
     leur bloc) et ce qui vit au sec — coulis, toppings, chantilly. Ceux-là
     apparaissaient ici en double, avec l'inventaire du sec. */
  const autres = FAMILLES_PRODUIT.filter(f => f.id !== 'glace' && f.lieu !== 'sec');

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
        /* Le détail par taille, pas seulement le total. « 6 en stock » ne dit pas
           s'il s'agit de six bacs de 3 L ou d'un mélange — or c'est précisément
           ce qu'on vérifie, bac par bac, devant la chambre froide. Corrigé sur
           l'écran Stock, oublié ici. */
        (enStock
          ? '<span class="invc">attendu · ' +
            tailles.filter(t => num(articles[cleArticle('glace', p, t)]))
              .map(t => num(articles[cleArticle('glace', p, t)]) + '×' + t + ' L').join(', ') +
            '</span>'
          : '<span class="invc faible">rien attendu</span>') + '</div>' +
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
    /* Les familles à saveurs se comptent saveur par saveur : un coulis
       pistache et un coulis caramel ne se remplacent pas l'un l'autre,
       et « Coulis : 4 » ne disait pas lequel manquait. */
    if (f.saveurs) {
    return '<div class="invp">' +
      '<div class="invp-h"><b>' + esc(f.libelle) + '</b>' +
      '<span class="invc">en ' + esc(f.unites) + '</span></div>' +
      '<div class="stack">' + f.saveurs.map(sv => {
              const c = cleArticle(f.id, sv, '');
              const q = num(articles[c]);
              return '<div class="invl">' +
                '<span class="invn">' + esc(sv) + '</span>' +
                (q ? '<span class="invc">' + q + '</span>' : '') +
                '<input type="number" inputmode="numeric" min="0" step="1" data-inv="' + c + '" ' +
                'value="' + (saisie[c] !== undefined ? saisie[c] : '') + '" placeholder="0"></div>';
            }).join('') + '</div></div>';
        }
        const c = cleArticle(f.id, '', '');
        const q = num(articles[c]);
        return '<div class="invl">' +
          '<span class="invn">' + esc(f.libelle) +
          '<small>en ' + esc(f.unites) + '</small></span>' +
          (q ? '<span class="invc">' + q + ' en stock</span>' : '') +
          '<input type="number" inputmode="numeric" min="0" step="1" data-inv="' + c + '" ' +
          'value="' + (saisie[c] !== undefined ? saisie[c] : '') + '" placeholder="0"></div>';
    }).join('') + '</div>';

  /* --- Sec : par section, unité visible, décimales où ça a du sens ---------
     Le manager l'a dit : « comme ça, les personnes voient avant de taper ».
     L'unité est dans le champ lui-même. Et le pas est 0,5 quand la référence
     l'autorise : deux cartons pleins et un à moitié, ça se tape 2,5. Zéro
     veut dire « à commander », 0,5 veut dire « je réfléchis ». */
  let deplies = {};
  const cleSec = (r, v) => 'sec|' + r.id + '|' + (v || '');

  const champSec = (r, c) => {
    const pas = r.decimal === false ? '1' : '0.5';
    const mode = r.decimal === false ? 'numeric' : 'decimal';
    return '<div class="saisie-u">' +
      '<input type="number" inputmode="' + mode + '" min="0" step="' + pas + '" ' +
      'data-sec="' + c + '" value="' + (saisieSec[c] !== undefined ? saisieSec[c] : '') + '" ' +
      'placeholder="0">' +
      '<span class="su">' + esc(r.unite) + '</span></div>';
  };

  const blocSec = () => {
    const anc = secPrec && secPrec.lignes ? secPrec.lignes : {};
    const sections = (typeof SEC_SECTIONS !== 'undefined') ? SEC_SECTIONS
      : [...new Set(INVENTAIRE_SEC.map(r => r.sec || 'Autres'))];

    return sections.map(section => {
      const refs = INVENTAIRE_SEC.filter(r =>
        typeof r === 'object' && (r.sec || 'Autres') === section);
      if (!refs.length) return '';
      const nb = refs.reduce((n, r) => n + (r.variantes ? r.variantes.length : 1), 0);

      return '<div class="entete"><h3>' + esc(section) + '</h3>' +
        '<span class="pousse mini num">' + nb + '</span></div>' +
        '<div class="stack">' + refs.map(r => {

          if (!r.variantes || !r.variantes.length) {
            const c = cleSec(r, '');
            return '<div class="invl">' +
              '<span class="invn">' + esc(r.nom) + '</span>' +
              (anc[c] !== undefined ? '<span class="invc faible">préc. ' + anc[c] + '</span>' : '') +
              champSec(r, c) + '</div>';
          }

          const ouvert = deplies[r.id];
          const saisis = r.variantes.filter(v => saisieSec[cleSec(r, v)] !== undefined).length;
          const total  = r.variantes.reduce((s, v) => s + num(saisieSec[cleSec(r, v)] || 0), 0);

          return '<div class="invp">' +
            '<button type="button" class="invp-h depliable" data-deplier="' + r.id + '">' +
            '<b>' + esc(r.nom) + '</b>' +
            '<span class="invc">' + (saisis
              ? n1(total) + ' ' + esc(r.unite) + (total > 1 ? 's' : '') + ' · ' + saisis + '/' + r.variantes.length
              : r.variantes.length + ' déclinaisons · en ' + esc(r.unite)) + '</span>' +
            '<span class="chev">' + (ouvert ? '−' : '+') + '</span></button>' +
            (ouvert
              ? '<div class="stack" style="margin-top:8px">' + r.variantes.map(v => {
                  const c = cleSec(r, v);
                  return '<div class="invl">' +
                    '<span class="invn">' + esc(v) + '</span>' +
                    (anc[c] !== undefined ? '<span class="invc faible">préc. ' + anc[c] + '</span>' : '') +
                    champSec(r, c) + '</div>';
                }).join('') + '</div>'
              : '') +
            '</div>';
        }).join('') + '</div>';
    }).join('');
  };

  const dessiner = () => {
    $('#vue-actions').innerHTML = '';
    const dernier = partie === 'froid' ? precedent : secPrec;
    const dejaCeJour = partie === 'froid' ? dejaFaitAujourdhui : secDejaFait;
    const ouvert = partie === 'froid' ? ouvertFroid : ouvertSec;

    $('#page').innerHTML =
      carte('<h2>' + (dejaCeJour && !ouvert ? 'Inventaire du jour'
                    : ouvert && dejaCeJour ? 'Corriger l’inventaire'
                    : 'Faire l’inventaire') + '</h2>' +
        '<div class="cs">' + (dejaCeJour && !ouvert
          ? 'Compté et enregistré. Rouvrez si un chiffre doit être corrigé.'
          : ouvert && dejaCeJour
          ? 'Modifiez ce qu’il faut, puis revalidez.'
          : 'Comptez ce qui est physiquement présent. Ce relevé devient la ' +
            'nouvelle référence.') + '</div>' +
        (dernier
          ? (dejaCeJour
            ? '<div class="alerte ok" style="margin-top:12px">' +
              '<div style="flex:1;min-width:0"><b>Validé à ' + heure(dernier.at) + '</b>' +
              '<p>Par ' + esc(dernier.par || '—') + '.</p></div>' +
              (ouvert ? '' : '<button class="btn clair sm" id="inv-rouvrir">Rouvrir</button>') +
              '</div>'
            : '<p class="rappel" style="margin-top:12px">Dernier comptage : ' +
              fmtD(dernier.jour) + (dernier.par ? ' par ' + esc(dernier.par) : '') + '</p>')
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

      '<button class="btn menthe bloc xl" id="inv-ok" style="margin-top:16px"' +
      (ouvert ? '' : ' disabled') + '>' +
      (!ouvert ? 'Inventaire verrouillé'
       : dejaCeJour
       ? (partie === 'froid' ? 'Revalider la chambre froide' : 'Revalider le sec')
       : (partie === 'froid' ? 'Vérifier et valider la chambre froide' : 'Vérifier et valider le sec')) +
      '</button>' +

      /* Historique, comme sur la traçabilité : savoir qui a compté quoi et
         quand, sans avoir à fouiller le journal d'activité. */
      /* L'historique suit l'onglet : celui du sec sur l'onglet sec, celui de la
         chambre froide sur l'onglet chambre froide. Avant, seul le froid
         s'affichait, et un comptage du sec validé le matin n'apparaissait
         nulle part. */
      (partie === 'froid'
        ? (historique.length
          ? '<div class="entete" style="margin-top:22px"><h3>Inventaires précédents — chambre froide</h3></div>' +
            '<div class="stack">' + historique.slice().reverse().slice(0, 12).map(h => {
              const t = totauxStock(h.lignes || {});
              return '<div class="invl">' +
                '<span class="invn">' + fmtD(h.jour) +
                '<small>' + esc(h.par || '—') + ' · ' + heure(h.at) +
                (h.manquants ? ' · ' + h.manquants + ' manquant(s)' : '') + '</small></span>' +
                '<span class="invc">' + t.bacs + ' bacs · ' + n1(t.kg) + ' kg</span></div>';
            }).join('') + '</div>'
          : '')
        : (historiqueSec.length
          ? '<div class="entete" style="margin-top:22px"><h3>Inventaires précédents — sec</h3></div>' +
            '<div class="stack">' + historiqueSec.slice().reverse().slice(0, 12).map(h => {
              const l = h.lignes || {};
              const refs = Object.keys(l).length;
              const tot = Object.keys(l).reduce((s, k) => s + num(l[k]), 0);
              return '<div class="invl">' +
                '<span class="invn">' + fmtD(h.jour) +
                '<small>' + esc(h.par || '—') + ' · ' + heure(h.at) + '</small></span>' +
                '<span class="invc">' + refs + ' réf. · ' + n1(tot) + ' unités</span></div>';
            }).join('') + '</div>'
          : ''));

    $$('[data-deplier]').forEach(b => b.onclick = () => {
      deplies[b.dataset.deplier] = !deplies[b.dataset.deplier];
      dessiner();
    });

    const bRouvrir = $('#inv-rouvrir');
    if (bRouvrir) bRouvrir.onclick = () => {
      confirmer('Rouvrir l’inventaire ?',
        'Les quantités comptées restent en place. Vous pourrez les corriger, ' +
        'puis il faudra revalider pour enregistrer.',
        'Rouvrir', () => {
          if (partie === 'froid') ouvertFroid = true; else ouvertSec = true;
          dessiner();
        });
    };

    $$('[data-partie]').forEach(b => b.onclick = () => {
      if (b.dataset.partie === partie) return;
      partie = b.dataset.partie;
      dessiner();
    });

    $$('[data-inv]').forEach(i => {
      i.disabled = !ouvert;
      i.oninput = () => {
        if (i.value === '') delete saisie[i.dataset.inv];
        else saisie[i.dataset.inv] = i.value;
        garderBrouillon();
        majTotaux();
      };
    });
    $$('[data-sec]').forEach(i => {
      i.disabled = !ouvert;
      i.oninput = () => {
        if (i.value === '') delete saisieSec[i.dataset.sec];
        else saisieSec[i.dataset.sec] = i.value;
        garderBrouillon();
        majTotaux();
      };
    });
    const zn = $('#inv-note');
    if (zn) zn.disabled = !ouvert;
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
        const inv = {
          jour: today(), at: nowISO(),
          par: STATE.user ? STATE.user.prenom : null,
          employe: STATE.user ? STATE.user.id : null,
          note: $('#inv-note') ? $('#inv-note').value : '',
          lignes: lignes
        };
        await DB.set('stock:sec', inv);
        /* Historique du sec : une correction du même jour remplace son entrée. */
        const hist = await DB.get('stock:secs', []);
        const i = hist.findIndex(h => h.jour === inv.jour);
        if (i >= 0) hist[i] = inv; else hist.push(inv);
        await DB.set('stock:secs', hist.slice(-36));
        try { localStorage.removeItem(CLE_BROUILLON); } catch (e) {}
        await feed('ok', STATE.user.prenom + ' a compté le sec — ' + cptes.length + ' références');
        toast('Inventaire du sec enregistré');
        rendre('stock');
      });
  }

  dessiner();
};

V.lots = async function () {
  const mouv = await tousMouvements(null);
  const ouvertures = mouv.map(litMouvement)
    .filter(m => m.type === 'ouverture').slice(-40).reverse();

  $('#vue-actions').innerHTML = '';
  $('#page').innerHTML =
    carte('<h2>Traçabilité</h2>' +
      '<div class="cs">À l’ouverture de tout nouveau produit, pas à la livraison. ' +
      'Le bac sort de la chambre froide, on l’ouvre, il monte en vitrine : ' +
      'un seul geste.</div>' +
      /* Le scanner ne lit que les étiquettes de glace et de macarons : ce sont
         les seules avec un numéro de lot imprimé en clair. La chantilly, les
         coulis, les cakes n'en ont pas de lisible — on les saisit à la main.
         Sans ce rappel, on scannait pour rien et on croyait le scanner cassé. */
      '<div class="rappel" style="margin-top:12px"><b>Scanner</b> : glaces et macarons. ' +
      '<b>À la main</b> : chantilly, coulis, toppings, cakes, gaufres, crêpes.</div>' +
      '<button class="btn menthe bloc xl" id="lo-scan" style="margin-top:14px">' +
      'Scanner une étiquette</button>' +
      '<button class="btn clair bloc" id="lo-main" style="margin-top:8px">' +
      'Saisir à la main</button>', 'solide') +

    (ouvertures.length
      ? '<div class="entete" style="margin-top:20px"><h3>Dernières ouvertures</h3>' +
        '<span class="pousse mini num">' + ouvertures.length + '</span></div>' +
        '<div class="stack">' + ouvertures.map(m => {
          const a = litArticle(m.cle);
          const f = FAMILLES_PRODUIT.filter(x => x.id === a.famille)[0];
          /* Le titre porte la saveur ou le parfum ; la famille ne vient en
             sous-titre QUE si elle apporte quelque chose. Sans ce test, un
             coulis sans saveur s'affichait « Coulis · Coulis », ce qui ne dit
             ni de quel coulis il s'agit ni pourquoi c'est répété. */
          const titre = a.parfum || (f ? f.libelle : a.famille);
          const sous = [];
          if (f && f.libelle !== titre) sous.push(f.libelle);
          if (a.taille) sous.push(a.taille + ' L');
          if (!a.parfum && f && f.saveurs) sous.push('saveur non précisée');
          return '<div class="lotl">' +
            '<span class="invn">' + esc(titre) +
            (sous.length ? '<small>' + esc(sous.join(' · ')) + '</small>' : '') + '</span>' +
            '<span class="invc">' + fmtD(m.jour) + '<br>' + esc(m.lot || '—') + '</span></div>';
        }).join('') + '</div>'
      : vide('', 'Aucune ouverture enregistrée.'));

  $('#lo-scan').onclick = async () => {
    const r = await scannerPhoto('etiquette');
    if (!r) return;
    const ok = await confirmerOuverture(r);
    if (ok) rendre('lots');
  };
  /* Saisie manuelle : on demande d'abord la famille. Un coulis ou un topping
     n'a pas d'étiquette lisible — l'équipe le saisit à la main, et on ne veut
     pas qu'elle passe par la caméra pour rien. */
  $('#lo-main').onclick = async () => {
    const ok = await confirmerOuverture({ lot:'', parfum:'', volume:null, manuel:true });
    if (ok) rendre('lots');
  };
};

/* Feuille de confirmation après un scan : famille, parfum, taille, lot. */
function confirmerOuverture(r) {
  return new Promise(resolve => {
    let famille = r.parfum ? 'glace' : '';
    let parfum  = r.parfum || '';
    let taille  = r.volume || FOURNISSEUR.tailleParDefaut;

    const garder = () => {
      const l = $('#co-lot'); if (l) r.lot = l.value.trim().toUpperCase();
    };

    const dessiner = () => {
      const fam = FAMILLES_PRODUIT.filter(f => f.id === famille)[0];
      $('#sheet-corps').innerHTML =
        '<h2 id="sheet-titre">Ouvrir un produit</h2>' +
        '<p class="cs">Ce bac sort de la chambre froide et monte en vitrine.</p>' +

        '<div class="champ" style="margin-top:16px"><label class="f">Famille</label>' +
        '<div class="pastilles">' + FAMILLES_PRODUIT.map(f =>
          '<button type="button" class="pas' + (f.id === famille ? ' on' : '') +
          '" data-fam="' + f.id + '">' + esc(f.libelle) + '</button>').join('') + '</div></div>' +

        (fam && fam.parfums
          ? '<div class="champ" style="margin-top:14px"><label class="f">' +
            (fam.saveurs ? 'Saveur' : 'Parfum') + '</label>' +
            /* Les coulis et toppings ont leurs propres saveurs : proposer les
               vingt-trois parfums de glace pour un flacon de coulis n'avait
               aucun sens et rendait le choix impraticable. */
            '<select id="co-parfum">' + (fam.saveurs || PARFUMS).map(p =>
              '<option' + (p === parfum ? ' selected' : '') + '>' + esc(p) + '</option>').join('') +
            '</select></div>' +
            (fam.id === 'glace'
              ? '<div class="champ" style="margin-top:14px"><label class="f">Taille du bac</label>' +
                '<div class="pastilles">' + (FOURNISSEUR.taillesBac || TAILLES_BAC).map(t =>
                  '<button type="button" class="pas' + (num(t) === num(taille) ? ' on' : '') +
                  '" data-taille="' + t + '">' + t + ' L</button>').join('') + '</div></div>'
              : '')
          : '') +

        '<div class="champ" style="margin-top:14px"><label class="f">Numéro de lot</label>' +
        '<input type="text" id="co-lot" value="' + esc(r.lot || '') + '" ' +
        'autocapitalize="characters" spellcheck="false" placeholder="14001A"></div>' +

        '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
        '<button class="btn menthe" id="co-ok">Confirmer l’ouverture</button></div>';

      $$('[data-fam]').forEach(b => b.onclick = () => {
        garder(); famille = b.dataset.fam; dessiner();
      });
      $$('[data-taille]').forEach(b => b.onclick = () => {
        garder(); taille = b.dataset.taille; dessiner();
      });
      const sp = $('#co-parfum');
      if (sp) sp.onchange = () => { parfum = sp.value; };
      $('#co-ok').onclick = enregistrer;
    };

    async function enregistrer() {
      garder();
      const fam = FAMILLES_PRODUIT.filter(f => f.id === famille)[0];
      if (!fam) return toast('Choisissez la famille', 'erreur');
      if (fam.parfums && !parfum) {
        const sp = $('#co-parfum');
        if (sp) parfum = sp.value;
        if (!parfum) return toast('Choisissez le parfum', 'erreur');
      }
      const lot = (r.lot || '').trim().toUpperCase();
      if (!lot) return toast('Le numéro de lot est obligatoire', 'erreur');

      /* Le lot n'identifie pas un bac — deux bacs de vanille peuvent porter le
         même numéro. Le vrai signal est le stock : ouvrir un bac qu'on n'a plus
         veut dire qu'une ouverture précédente n'a pas été scannée, ou qu'une
         livraison n'a pas été saisie. */
      const manque = await stockInsuffisant(
        cleArticle(fam.id, fam.parfums ? parfum : '', fam.parfums ? taille : '')
      ).catch(() => null);
      if (manque) {
        return confirmer('Ce bac n’est plus au stock',
          'L’application n’a plus de ' + manque.article + ' en réserve' +
          (manque.reste < 0 ? ' — le compte est déjà à ' + manque.reste + '.' : '.') +
          ' Soit une ouverture précédente n’a pas été scannée, soit une livraison ' +
          'n’a pas été saisie. Confirmez si le bac est bien là : un recomptage ' +
          'sera proposé pour remettre les compteurs à plat.',
          'Confirmer l’ouverture', () => { poser(fam, lot); });
      }
      await poser(fam, lot);
    }

    async function poser(fam, lot) {
      /* Seules les glaces ont une taille de bac ; un coulis ou un topping n'en
         a pas, mais il a une saveur qu'il faut garder dans la clé. */
      const cle = cleArticle(fam.id,
        fam.parfums ? parfum : '',
        fam.id === 'glace' ? taille : '');
      await ajouterMouvement('ouverture', cle, 1, { lot: lot, famille: fam.id, parfum: parfum });

      /* Le frigo virtuel lit la clé « lots: », pas le journal de stock : sans
         cette écriture il restait désespérément vide alors que l'équipe scannait
         tous les jours. C'est lui qui suit les DLC après ouverture — la
         chantilly à 48 h, le gelato à dix jours — donc le manquer revient à
         perdre la surveillance des péremptions.

         Les glaces sont indexées par parfum, les autres familles par leur
         règle de DLC : c'est ce que calculFIFO attend. */
      const m = monthKey(today());
      const lots = await DB.get('lots:' + m, {});
      const cleFifo = (fam.id === 'glace' && parfum)
        ? 'g_' + parfum
        : 'a_' + (fam.dlc || 'defaut');
      lots[cleFifo] = { lot: lot, ouv: today(), par: STATE.user.prenom, at: nowISO(),
                        famille: fam.id, taille: fam.parfums ? taille : null };
      await DB.set('lots:' + m, lots);

      await feed('ok', STATE.user.prenom + ' a ouvert ' +
        (parfum || fam.libelle) + ' — lot ' + lot);
      closeSheet();
      resolve(true);
    }

    showSheet('<div class="vide">…</div>');
    dessiner();
  });
}
