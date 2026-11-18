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
  [/stracci/i,                          'Stracciatella'],
  [/tiramis/i,                             'Tiramisu'],
  [/vanig|vanille|vaniglia|vanilla/i,      'Vanille'],
  [/yogurt|yaourt/i,                       'Yogurt']
];

/* Repli quand le libellé est mal lu (« Glace Caté ») : la référence du bon,
   « SCAFFE25 » ou « $CAFFE25 », porte aussi le parfum. Préfixes Jetfreeze,
   comparés au début de la référence sans le $ (lu « S ») ni le format. */
const REFERENCE_PARFUM = [
  ['AMARENA', 'Amarena'], ['CAFFE', 'Café'], ['CARAM', 'Caramel au beurre salé'],
  /* CIOCCOLATO seul : « CIOCCOLATOBIO », « CIOCCOLATOECUADOR » sont d'autres
     parfums, laissés à la désignation. */
  [/^CIOCCOLATO\d/, 'Chocolat noir'], ['COCCO', 'Noix de coco'], ['FRAGOLA', 'Fraise'],
  ['INIM', 'Inimitable'], ['MANGO', 'Mangue'], ['NOCCIOLA', 'Noisette'],
  ['PISTA', 'Pistache'], ['STRACCIA', 'Stracciatella'], ['TIRA', 'Tiramisu'],
  ['VANIG', 'Vanille']
];
function parfumDepuisReference(ref) {
  const R = String(ref || '').toUpperCase();
  /* Avec et sans le premier S : « $STRACCIA25 » lu « SSTRACCIA25 », mais
     aussi « STRACCIA25 » quand le $ a disparu. */
  for (const r of [R.replace(/^S?\$/, ''), R.replace(/^S/, ''), R]) {
    for (const [pre, p] of REFERENCE_PARFUM) {
      if (pre instanceof RegExp ? pre.test(r) : r.indexOf(pre) === 0) return p;
    }
  }
  return null;
}

function parfumDepuisDesignation(nom) {
  const n = String(nom || '');
  for (const [re, p] of DESIGNATION_PARFUM) if (re.test(n)) return p;
  return null;
}

/* Taille du bac lue dans la désignation : « Glace Café 3 litres », « 3L »,
   « 3 lt ». Seules les tailles de bac connues sont retenues : un « 12 L »
   lu ailleurs dans le texte ne doit pas créer un bac qui n'existe pas. */
function tailleDepuisDesignation(nom) {
  const m = String(nom || '').match(/(\d+(?:[.,]\d+)?)\s*(?:litres?|lt|l)\b/i);
  if (!m) return null;
  const t = parseFloat(m[1].replace(',', '.'));
  return (FOURNISSEUR.taillesBac || []).indexOf(t) >= 0 ? t : null;
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
   APPRENTISSAGE DES RÉFÉRENCES DU BON
   La lecture du nom de produit dépend de la photo (ombre, pli, flou) ; la
   référence du fournisseur, elle, ne change pas d'une livraison à l'autre.
   Chaque réception confirmée par un manager enseigne à l'appli l'article
   validé pour chaque référence lue (« SPISTAM25 » → glace|Pistache|3). À la
   livraison suivante, la même référence donne directement le bon article,
   même si le nom est illisible. Une variante de lecture (« SPISTAMZS ») est
   apprise à son tour la première fois qu'elle est confirmée.
   -------------------------------------------------------------------------- */
/* Préfixe « stock: » : synchronisée (table stock) pour que ce qu'apprend
   un iPad serve aux autres. Hors FUSIONNER : le dernier qui écrit gagne. */
const CLE_MEMO_BL = 'stock:memo-bl';
function cleMemoRef(ref) {
  const r = String(ref || '').toUpperCase().replace(/[^A-Z0-9$]/g, '').replace(/^\$/, 'S');
  return r.length >= 4 ? r : '';
}
async function memoBL() {
  try { return (await DB.get(CLE_MEMO_BL, {})) || {}; } catch (e) { return {}; }
}
/* lignes : [{ ref, cle }] confirmées par un manager. */
async function apprendreBL(lignes) {
  const m = await memoBL();
  let n = 0;
  (lignes || []).forEach(l => {
    const k = cleMemoRef(l.ref);
    if (!k || !l.cle) return;
    const avant = m[k];
    m[k] = { cle: l.cle, vu: avant && avant.cle === l.cle ? (avant.vu || 1) + 1 : 1, at: nowISO() };
    n++;
  });
  if (n) await DB.set(CLE_MEMO_BL, m);
  return n;
}

/* -----------------------------------------------------------------------------
   RÉCEPTIONS DU SEC
   Le sec n'a pas de mouvement à la vente : son stock est celui du dernier
   inventaire. Une livraison confirmée par un manager s'y ajoute jusqu'au
   comptage suivant : stock attendu = dernier comptage + réceptions depuis.
   Journal à part (« stock:sec-mv »), une ligne par article reçu ; les prix
   ne sont jamais touchés ici.
   -------------------------------------------------------------------------- */
const CLE_SEC_MV = 'stock:sec-mv';

/* Clés du sec qui existent dans le catalogue de la boutique. */
function clesSecConnues() {
  const s = new Set();
  (typeof catalogueSec === 'function' ? catalogueSec() : []).forEach(r => {
    if (!r || typeof r !== 'object' || r.masque) return;
    (r.variantes && r.variantes.length ? r.variantes : ['']).forEach(v => s.add('sec|' + r.id + '|' + v));
  });
  return s;
}

/* Ligne du sec pour une référence Amorino : { cle, par } ou null. */
function secDepuisCode(ref) {
  const c = typeof codeAmorino === 'function' ? codeAmorino(ref) : null;
  if (!c) return null;
  const connues = clesSecConnues();
  const cle = (c.cles || []).filter(k => connues.has(k))[0];
  return cle ? { cle: cle, par: num(c.par) > 0 ? num(c.par) : 1, vivante: cleVivanteSecSeule(cle) } : null;
}

/* Clé de famille d'une ligne du sec suivie à l'ouverture (chantilly, coulis,
   toppings), ou null. Ces lignes reçoivent leurs livraisons dans le journal
   des mouvements de la famille, comme avant : le stock vivant les lit là. */
function cleVivanteSecSeule(cle) {
  const o = {}; o[cle] = 1;
  return typeof cleVivanteSec === 'function' ? cleVivanteSec(cle, o) : null;
}

/* Identifiant d'une référence ajoutée au catalogue du sec. */
function idCatalogueSec(nom) {
  return 'm_' + String(nom || 'article').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '').slice(0, 20) + '_' + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 4);
}

/* lignes : [{ cle, q }] déjà converties en unités comptées. L'id dérive de la
   réception : confirmer deux fois n'ajoute rien. */
async function ajouterReceptionSec(lignes, meta) {
  const l = await DB.get(CLE_SEC_MV, []);
  const vus = new Set(l.map(m => m && m.id));
  let n = 0;
  (lignes || []).forEach((x, i) => {
    const id = meta.id + '|' + (x.i !== undefined ? x.i : i);
    if (!x.cle || !(num(x.q) > 0) || vus.has(id)) return;
    l.push({ id: id, at: meta.at, cle: x.cle, q: num(x.q), bl: meta.bl || '', par: meta.par || '' });
    n++;
  });
  if (n) await DB.set(CLE_SEC_MV, l.slice(-2000));
  return n;
}

/* Article reçu inconnu du catalogue, déclaré nouveau par le manager à la
   confirmation : ajouté comme depuis le catalogue (sans prix, à l'unité).
   Relu juste avant : une page catalogue ouverte ailleurs n'est pas écrasée. */
async function ajouterArticleSecRecu(nom, section) {
  const m = (await DB.get('catalogue:sec', null)) || {};
  m.masques = m.masques || []; m.modifs = m.modifs || {}; m.ajouts = m.ajouts || [];
  const id = idCatalogueSec(nom);
  m.ajouts.push({ id: id, sec: section, nom: String(nom || '').trim() || 'Article reçu', unite: 'unité', decimal: true, variantes: [] });
  await enregistrerCatalogueSec(m);
  return 'sec|' + id + '|';
}

/* Quantités reçues depuis un instant (le dernier comptage du sec). */
/* Réception écartée : ses lignes du journal du sec sont marquées
   « supprime » (et non effacées : la fusion avec la base les ferait
   revenir), et ne comptent plus. */
async function retirerReceptionSec(id) {
  const l = await DB.get(CLE_SEC_MV, []);
  let n = 0;
  l.forEach(m => { if (m && !m.supprime && String(m.id).indexOf(id + '|') === 0) { m.supprime = nowISO(); n++; } });
  if (n) await DB.set(CLE_SEC_MV, l);
  return n;
}

/* Réceptions du sec livrées entre deux instants (debut exclu, fin incluse). */
async function recusSecEntre(debut, fin) {
  const out = {};
  (await DB.get(CLE_SEC_MV, [])).forEach(m => {
    if (!m || !m.cle || m.supprime) return;
    if (debut && String(m.at) <= String(debut)) return;
    if (fin && String(m.at) > String(fin)) return;
    out[m.cle] = Math.round((num(out[m.cle]) + num(m.q)) * 1000) / 1000;
  });
  return out;
}

async function recusSecDepuis(at) {
  const out = {};
  (await DB.get(CLE_SEC_MV, [])).forEach(m => {
    if (!m || !m.cle || m.supprime || (at && String(m.at) <= String(at))) return;
    out[m.cle] = Math.round((num(out[m.cle]) + num(m.q)) * 1000) / 1000;
  });
  return out;
}

/* Stock attendu du sec : dernier comptage + réceptions depuis. */
async function stockSecAttendu(secPrec) {
  const base = Object.assign({}, (secPrec && secPrec.lignes) || {});
  const recus = await recusSecDepuis(secPrec && secPrec.at);
  Object.keys(recus).forEach(c => { base[c] = Math.round((num(base[c]) + recus[c]) * 1000) / 1000; });
  return { lignes: base, recus: recus };
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
    const a = litArticle(cle);
    const fam = FAMILLES_PRODUIT.filter(f => f.id === a.famille)[0];

    /* Les familles comptées au SEC n'ont pas de stock en chambre froide : on
       n'alerte pas sur une chantilly ou un coulis ici, leur référence est
       l'inventaire du sec. */
    if (fam && (fam.lieu === 'sec' || fam.stock === 'sec')) return null;

    /* Un article JAMAIS compté n'est pas un article à zéro. L'inventaire de
       chambre froide compte les macarons en bloc ; leurs saveurs sont arrivées
       après. Une ouverture de « Grandioso Pistacchio » cherchait donc une
       clé absente, et l'absence était lue comme une rupture. On ne connaît
       pas la quantité : on laisse passer sans alarmer, l'inventaire suivant
       fixera la référence saveur par saveur. */
    const inv = s.inventaire && s.inventaire.lignes ? s.inventaire.lignes : {};
    const connu = inv[cle] !== undefined ||
      (s.articles[cle] !== undefined && num(s.articles[cle]) !== 0);
    if (!connu) {
      /* Si la famille est comptée en bloc, on regarde ce bloc. */
      const bloc = cleArticle(a.famille, '', '');
      if (inv[bloc] !== undefined || s.articles[bloc] !== undefined) {
        const q = num(s.articles[bloc] || 0);
        if (q > 0) return null;
        return { reste: q, article: fam ? fam.libelle : a.famille,
                 depuis: s.inventaire ? s.inventaire.jour : null };
      }
      return null;
    }

    const q = num(s.articles[cle] || 0);
    if (q > 0) return null;
    /* Livraison saisie mais pas encore confirmée par un manager : le bac est
       bien là, il n'est juste pas encore compté. */
    let attente = 0;
    if (typeof receptionsEnAttente === 'function') {
      (await receptionsEnAttente()).forEach(r => (r.lignes || []).forEach(l => { if (l.cle === cle) attente += num(l.qte); }));
    }
    return { reste: q, article: libelleArticle(cle), attente: attente,
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

  /* Garde-fou contre le double appui : un mouvement identique déjà EN COURS
     d'écriture est ignoré. L'ancienne garde comparait à la dernière ligne sur
     quinze secondes : elle rejetait aussi un second bac réel du même lot —
     même après la confirmation « Ce bac n'est plus au stock » — et la seconde
     ligne identique d'une même réception. Les écrans protègent en plus leur
     bouton pendant l'enregistrement. */
  const sig = [type, cle, num(qte), (extra && extra.lot) || '', STATE.user ? STATE.user.id : ''].join('|');
  if (_mouvementsEnCours.has(sig)) {
    toast('Déjà en cours d’enregistrement', 'erreur');
    return null;
  }
  _mouvementsEnCours.add(sig);
  try {
    /* extra.at : un mouvement daté de son fait réel, pas de sa saisie. Une
       réception confirmée par le manager le surlendemain appartient au jour
       de la livraison : antérieure au dernier inventaire, elle est déjà dans
       son comptage et le journal l'écarte ; dans la période d'écart, elle
       compte le jour où les bacs sont arrivés. */
    const quand = (extra && extra.at) || nowISO();
    const cm = cleMois(isoOf(new Date(quand)));   // jour local, comme cleMois()
    let l = await lireMois(cm);

    /* Champs courts : t=type, c=clé, q=quantité, a=horodatage, e=employé, l=lot,
       d=DLC du produit fermé (réception) */
    const m = { t:type, c:cle, q:q, a:quand,
                e: STATE.user ? STATE.user.id : null };
    if (extra && extra.lot) m.l = extra.lot;
    if (extra && extra.bl)  m.b = extra.bl;
    if (extra && extra.motif) m.mo = extra.motif;
    if (extra && extra.dlc && /^\d{4}-\d{2}-\d{2}$/.test(extra.dlc)) m.d = extra.dlc;
    l.push(m);

    l = await purgerJournal(l);
    _moisCache = { cle: cm, lignes: l, at: Date.now() };
    invaliderStock();
    await DB.set(cm, l);
    await noterMois(cm);
    return m;
  } finally {
    _mouvementsEnCours.delete(sig);
  }
}
const _mouvementsEnCours = new Set();

/* Stock fermé et DLC. La réception n'écrit plus « stock:ferme » mais le
   journal du stock, DLC comprise (champ d) : l'écran Réception affichait
   « 0 article(s) » en stock fermé et les alertes DLC de Ma journée ne
   partaient jamais. Ce qui reste fermé se déduit du stock réel : les
   ouvertures prennent d'abord les bacs les plus anciens, ce sont donc les
   réceptions les plus récentes qui restent en réserve. Une unité comptée à
   l'inventaire sans réception tracée n'a pas de DLC connue : elle n'apparaît
   pas ici. */
async function stockFermeJournal() {
  const s = await stockReel();
  const mouv = await tousMouvements(null);
  const parCle = {};
  mouv.forEach(m => {
    /* Une réception sans DLC (facultative depuis le bon de livraison) reste
       dans la répartition : sans elle, ses bacs étaient attribués aux lots
       plus anciens, avec leur DLC, et déclenchaient de fausses alertes. */
    if ((m.t || m.type) !== 'reception') return;
    const c = m.c || m.cle;
    (parCle[c] = parCle[c] || []).push(m);
  });
  const out = [];
  Object.keys(parCle).forEach(c => {
    let reste = num(s.articles[c]);
    parCle[c].sort((x, y) => String(y.a || y.at).localeCompare(String(x.a || x.at)))
      .forEach(m => {
        if (reste <= 0) return;
        const q = Math.min(reste, num(m.q !== undefined ? m.q : m.qte));
        reste -= q;
        if (!m.d) return;
        out.push({ id: c + '|' + (m.a || m.at), cle: c, produit: libelleArticle(c), qte: q,
                   unite: litArticle(c).taille ? 'bac' : '', lot: m.l || '', dlc: m.d,
                   recuLe: isoOf(new Date(m.a || m.at)) });
      });
  });
  return out;
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

  /* Une requête pour tous les mois plutôt qu'une par mois (voir DB.prelire). */
  DB.prelire(['stock:mouvements'].concat(cles));
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
/* « meta » : un inventaire confirmé plus tard garde le jour et l'heure de son
   comptage (les mouvements tracés depuis s'y ajoutent) et dit qui l'a compté
   et qui l'a confirmé. */
async function enregistrerInventaire(lignes, note, avant, meta) {
  /* Prix du jour à jour avant de les figer dans l'inventaire. */
  await chargerPrixAchat().catch(() => {});
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

  const inv = Object.assign({
    jour: today(), at: nowISO(),
    par: STATE.user ? STATE.user.prenom : null,
    employe: STATE.user ? STATE.user.id : null
  }, meta || {}, {
    note: note || '',
    lignes: lignes,            // { cleArticle : quantité }
    prix: prixDuComptage(lignes),  // prix du jour : la valeur ne bouge plus ensuite
    ecarts: ecarts,            // écart constaté par article
    manquants: manquants,      // bacs disparus sans traçabilité
    surplus: surplus           // bacs trouvés en trop : réception non saisie
  });

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
   INVENTAIRE À CONFIRMER
   Un comptage, qu'il vienne d'un équipier ou du manager, n'écrase plus le
   stock : il attend qu'un manager le confirme. Un bac oublié derrière un
   autre faisait sinon disparaître du stock un parfum bien présent, sans que
   personne ne le voie.
   Avant de confirmer, le manager voit l'écart article par article et peut
   recompter (le lendemain s'il le veut). À la confirmation, le stock prend
   les quantités comptées.
   Chambre froide : les bacs manquants ne partent plus d'office en pertes. Le
   manager valide l'inventaire, voit la liste des bacs manquants, dit ce
   qu'ils sont devenus (consommés sans scan, pertes réelles, ou mal compté :
   il recompte), puis valide la mise à jour du stock. Seules les pertes
   réelles vont au registre. Le calcul des écarts de période ne change pas :
   il ne lit pas ces lignes (litresJetes les met à 0).
   Sec : rien n'y trace la consommation (cornets, gobelets), la différence
   avec le comptage précédent est donc de la consommation, pas une perte.
   Un seul inventaire en attente par partie : un nouveau comptage remplace
   le précédent.
   -------------------------------------------------------------------------- */
const INV_ATTENTE = {
  froid: { cle: 'stock:attente',     ref: 'stock:inventaire' },
  sec:   { cle: 'stock:attente-sec', ref: 'stock:sec' }
};
const CLE_INV_ATTENTE = INV_ATTENTE.froid.cle;

async function inventaireEnAttente(partie) {
  const p = INV_ATTENTE[partie] || INV_ATTENTE.froid;
  try {
    const [a, inv] = await Promise.all([DB.get(p.cle, null), DB.get(p.ref, null)]);
    /* Un comptage déjà repris, ou plus ancien que l'inventaire sur le stock
       (rejoué par un iPad revenu en ligne), n'attend plus rien. */
    if (!a || (inv && inv.at && a.at && inv.at >= a.at)) return null;
    return a;
  } catch (e) { return null; }
}

/* « sec|<réf>|<déclinaison> » → « Cornets · Petit ». */
function libelleSec(c) {
  const p = String(c).split('|');
  const r = catalogueSec().filter(x => typeof x === 'object' && x.id === p[1])[0];
  return (r ? r.nom : p[1]) + (p[2] ? ' · ' + p[2] : '');
}
/* Clé « vivante » d'une ligne du sec : chantilly, coulis et toppings sont
   tracés à l'ouverture sous « <famille>|<saveur>| ». Même correspondance que
   le Rouvrir du sec confirmé. null pour le reste du sec, sans mouvement. */
function cleVivanteSec(c, lignes) {
  const [, ref, v] = String(c).split('|');
  const nrm = x => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const f = FAMILLES_PRODUIT.filter(x => (x.lieu === 'sec' || x.stock === 'sec') && (x.refSec || x.id) === ref)[0];
  if (!f) return null;
  if (f.saveurs && f.saveurs.length) {
    const sv = f.saveurs.filter(x => nrm(x) === nrm(v))[0];
    return sv ? cleArticle(f.id, sv, '') : null;
  }
  return Object.keys(lignes || {}).filter(k => k.split('|')[1] === ref).length === 1 ? cleArticle(f.id, '', '') : null;
}

/* Mouvements tracés sur un article après une heure donnée (réceptions moins
   ouvertures et pertes). */
async function mouvementsDepuis(cle, at) {
  let d = 0;
  (await tousMouvements(String(at).slice(0, 10))).forEach(m => {
    if ((m.c || m.cle) !== cle || !((m.a || m.at) > at)) return;
    const q = num(m.q !== undefined ? m.q : m.qte), t = m.t || m.type;
    if (t === 'reception') d += q; else if (t === 'ouverture' || t === 'perte') d -= q;
  });
  return d;
}

const libelleInv = (partie, c) => partie === 'sec' ? libelleSec(c) : libelleArticle(c);

/* Article par article : compté, attendu au moment du comptage, écart.
   Les manquants d'abord, du plus gros au plus petit. */
/* Un inventaire peut ne porter que sur une partie : les glaces sans les
   macarons, trois références du sec. Ce qui n'a pas été compté du tout
   (une famille de la chambre froide, une référence du sec) n'est ni comparé
   ni touché : son stock reste celui d'avant. Dans ce qui est compté, un
   champ laissé vide vaut 0, comme à la saisie. */
const groupeInv = (partie, c) => partie === 'sec' ? String(c).split('|')[1] : litArticle(c).famille;
function groupesComptes(a, partie) {
  return new Set(Object.keys(a.lignes || {}).map(c => groupeInv(partie, c)));
}

/* Stock théorique de la chambre froide au moment du comptage : le stock réel
   d'aujourd'hui moins ce qui a été tracé depuis (réceptions, ouvertures,
   pertes), plus les livraisons arrivées avant le comptage et pas encore
   confirmées (les bacs étaient là, le comptage les a vus). Recalculé à
   chaque vérification : un scan fait hors ligne avant le comptage, arrivé
   après, est ainsi pris en compte. */
async function theoriqueAuComptage(a, maintenant) {
  const delta = {};
  (await tousMouvements(String(a.at).slice(0, 10))).forEach(m => {
    const c = m.c || m.cle, at = m.a || m.at;
    if (!c || !(at > a.at)) return;
    const q = num(m.q !== undefined ? m.q : m.qte), t = m.t || m.type;
    delta[c] = (delta[c] || 0) + (t === 'reception' ? q : (t === 'ouverture' || t === 'perte') ? -q : 0);
  });
  const froid = c => {
    const f = FAMILLES_PRODUIT.filter(x => x.id === litArticle(c).famille)[0];
    return litArticle(c).famille !== 'sec' && !(f && (f.lieu === 'sec' || f.stock === 'sec'));
  };
  const theo = {};
  new Set(Object.keys(maintenant).concat(Object.keys(delta))).forEach(c => {
    if (!froid(c)) return;
    const v = num(maintenant[c] || 0) - num(delta[c] || 0);
    if (v) theo[c] = v;
  });
  /* Livraisons en attente : avant le comptage (et après l'inventaire déjà
     sur le stock, qui les a comptées sinon), elles entrent dans l'attendu ;
     après le comptage (« apres »), elles sont là physiquement mais hors du
     stock réel et du comptage. */
  const livraisons = [], apres = {};
  if (typeof receptionsEnAttente === 'function') {
    const ref = await DB.get('stock:inventaire', null).catch(() => null);
    const borne = (ref && ref.at) || '';
    (await receptionsEnAttente()).forEach(r => {
      if (!r.at || r.at <= borne) return;
      const avantComptage = r.at <= a.at;
      let n = 0;
      (r.lignes || []).forEach(l => {
        if (!l.cle || !froid(l.cle)) return;
        if (avantComptage) { theo[l.cle] = num(theo[l.cle] || 0) + num(l.qte); n += num(l.qte); }
        else apres[l.cle] = num(apres[l.cle] || 0) + num(l.qte);
      });
      if (n) livraisons.push({ fournisseur: r.fournisseur, numero: r.numero, jour: r.jour, bacs: n });
    });
  }
  return { theo: theo, delta: delta, livraisons: livraisons, apres: apres };
}

/* Ce que l'inventaire confirmé doit porter : le compté, plus, pour ce qui
   n'a pas été compté du tout, la valeur attendue (le stock ne bouge pas). */
/* Déclinaisons retirées de la fiche : on ne peut plus les compter, leur
   stock est reporté tel quel même si le reste de la référence a été compté. */
function clesRetireesSec(partie) {
  const out = new Set();
  if (partie === 'sec') catalogueSec().forEach(r => (r.variantesRetirees || []).forEach(v => out.add('sec|' + r.id + '|' + v)));
  return out;
}
/* Même règle pour la chambre froide (parfum ou saveur retiré). */
function estRetireeInv(partie, c, retireesSec, retiresAuComptage) {
  if (partie === 'sec') return retireesSec.has(c);
  const a = litArticle(c);
  /* Retiré maintenant OU au moment du comptage : un parfum réactivé entre
     les deux n'a pas été proposé à l'équipe, son stock reste. */
  const k = a.famille + '|' + a.parfum;
  return !froidActif(a.famille, a.parfum) || (retiresAuComptage || []).indexOf(k) >= 0;
}

function lignesAReprendre(a, partie, attendu) {
  const comptes = groupesComptes(a, partie);
  const retirees = clesRetireesSec(partie);
  const out = {};
  Object.keys(attendu || {}).forEach(c => {
    if ((estRetireeInv(partie, c, retirees, a.retires) || !comptes.has(groupeInv(partie, c))) && num(attendu[c])) out[c] = num(attendu[c]);
  });
  return Object.assign(out, a.lignes || {});
}

function lignesAttente(a, partie) {
  const l = a.lignes || {}, av = a.avant || {};
  const comptes = groupesComptes(a, partie);
  const retirees = clesRetireesSec(partie);
  return [...new Set(Object.keys(av).concat(Object.keys(l)))]
    .filter(c => comptes.has(groupeInv(partie, c)) && !(estRetireeInv(partie, c, retirees, a.retires) && !(c in l)))
    .map(c => ({ c: c, compte: num(l[c] || 0), attendu: num(av[c] || 0) }))
    .filter(x => x.compte || x.attendu)
    .map(x => Object.assign(x, { d: x.compte - x.attendu }))
    .sort((x, y) => (x.d - y.d) || libelleInv(partie, x.c).localeCompare(libelleInv(partie, y.c)));
}

/* Résumé d'un comptage en attente pour les bandeaux : ce que le manager va
   trouver en l'ouvrant, sans avoir à l'ouvrir. */
async function resumeAttente(a, partie, articles) {
  if (!a) return '';
  try {
    const avant = partie === 'sec' ? (a.avant || {}) : (await theoriqueAuComptage(a, articles || {})).theo;
    const l = lignesAttente(Object.assign({}, a, { avant: avant }), partie).filter(x => x.d);
    if (partie === 'sec') return l.length ? l.length + ' ' + accord(l.length, 'référence a changé', 'références ont changé') + '.' : 'Rien n’a changé.';
    const b = l.filter(x => litArticle(x.c).taille);
    const manq = b.filter(x => x.d < 0).reduce((s2, x) => s2 - x.d, 0);
    const trop = b.filter(x => x.d > 0).reduce((s2, x) => s2 + x.d, 0);
    return !l.length ? 'Aucun écart avec le stock réel.'
      : (manq ? manq + ' ' + accord(manq, 'bac manquant', 'bacs manquants') : 'Aucun bac manquant') +
        (trop ? ', ' + trop + ' en trop' : '') + '.';
  } catch (e) { return ''; }
}

/* Écran du manager : vérifier, recompter, confirmer ou laisser en attente. */
async function verifierInventaire(partie) {
  partie = partie === 'sec' ? 'sec' : 'froid';
  const sec = partie === 'sec';
  const CLE = INV_ATTENTE[partie].cle;
  if (!(STATE.user && STATE.user.role === 'manager')) {
    return toast('Seul un manager peut confirmer un inventaire', 'erreur');
  }
  if (sec) await chargerCatalogueSec();
  /* Sans la liste des retirés, leur stock serait effacé : pas de confirmation. */
  else {
    try { await chargerCatalogueFroid(); }
    catch (e) { return toast('Catalogue de la chambre froide illisible, réessayez', 'erreur'); }
  }
  let a = await inventaireEnAttente(partie);
  if (!a) { toast('Aucun inventaire à confirmer'); return rendre(STATE.view); }
  /* Stock du moment, sur l'ancien inventaire : l'inventaire en attente n'y
     touche pas. Son écart avec « avant » donne les mouvements tracés depuis
     le comptage (réceptions, ouvertures, pertes). Le sec n'en a pas. */
  invaliderStock();
  const maintenant = sec ? {} : ((await stockReel()).articles || {});
  let th = sec ? { theo: a.avant || {}, delta: {}, livraisons: [] } : await theoriqueAuComptage(a, maintenant);
  let enCours = null;          // article en cours de recomptage
  const lib = c => libelleInv(partie, c);
  const refSec = c => catalogueSec().filter(x => typeof x === 'object' && x.id === String(c).split('|')[1])[0];

  const dessinerV = () => {
    const vue = Object.assign({}, a, { avant: th.theo });
    const lignes = lignesAttente(vue, partie);
    /* Ce qui n'a pas été compté : nommé, pour que personne ne croie à un oubli silencieux. */
    const comptes = groupesComptes(a, partie);
    const nonComptes = [...new Set(Object.keys(th.theo).map(c => groupeInv(partie, c)))]
      .filter(g => !comptes.has(g))
      .map(g => sec ? libelleSec('sec|' + g + '|').replace(/ · $/, '')
                    : ((FAMILLES_PRODUIT.filter(f => f.id === g)[0] || {}).libelle || g));
    const ecarts = lignes.filter(x => x.d !== 0);
    const justes = lignes.filter(x => x.d === 0);
    const bacs = x => !!litArticle(x.c).taille;
    const manq = sec ? 0 : ecarts.filter(x => x.d < 0 && bacs(x)).reduce((s, x) => s - x.d, 0);
    const trop = sec ? 0 : ecarts.filter(x => x.d > 0 && bacs(x)).reduce((s, x) => s + x.d, 0);
    const litres = sec ? 0 : ecarts.filter(x => x.d < 0)
      .reduce((s, x) => s - x.d * num(litArticle(x.c).taille), 0);
    const corr = a.corrections || {};
    const nb = v => Number.isInteger(v) ? String(v) : n1(v);

    const rang = x => {
      const k = corr[x.c];
      const r = sec ? refSec(x.c) : null;
      /* Jamais compté avant : pas de chiffre précédent dans « avant ». */
      const dt = sec ? secDouteux(x.c, x.compte, (a.avant || {})[x.c], true) : '';
      return '<div class="invl">' +
        '<span class="invn">' + esc(lib(x.c)) +
        '<small>compté ' + nb(x.compte) + (sec ? ' · précédent ' : ' · attendu ') + nb(x.attendu) +
        (r && r.unite ? ' ' + esc(accord(x.attendu, r.unite)) : '') +
        (k ? ' · recompté ' + nb(num(k.q)) + ' le ' + esc(fmtD(String(k.at).slice(0, 10))) + ' par ' + esc(k.par || '—') : '') +
        (dt ? '<br><b>À vérifier : ' + esc(dt) + '</b>' : '') +
        '</small></span>' +
        '<span class="invc">' + (x.d ? (sec ? '' : 'écart ') + (x.d > 0 ? '+' : '') + nb(x.d) : (sec ? 'inchangé' : 'juste')) + '<br>' +
        '<button type="button" class="btn clair sm" data-recompter="' + esc(x.c) + '">Recompter</button></span></div>' +
        (enCours === x.c
          ? '<div class="invl"><span class="invn">Combien maintenant ?' +
            (sec ? '' : '<small>attendu maintenant : ' + nb(num(maintenant[x.c] || 0)) + '</small>') + '</span>' +
            '<input type="number" inputmode="' + (sec && !(r && r.decimal === false) ? 'decimal' : 'numeric') + '" min="0" ' +
            'step="' + (sec && !(r && r.decimal === false) ? '0.5' : '1') + '" id="rc-v" data-autofocus ' +
            'aria-label="' + esc(lib(x.c) + ', recompté maintenant') + '">' +
            '<button type="button" class="btn menthe sm" id="rc-ok">OK</button></div>'
          : '');
    };

    showSheet(
      '<h2 id="sheet-titre">Confirmer l’inventaire ' + (sec ? 'du sec' : 'de la chambre froide') + '</h2>' +
      '<p class="sub">Compté le ' + esc(fmtD(a.jour)) + ' à ' + heure(a.at) + ' par ' + esc(a.par || '—') + '. ' +
      (sec
        ? (ecarts.length ? ecarts.length + ' ' + accord(ecarts.length, 'référence a changé', 'références ont changé') +
            ' depuis le comptage précédent.' : 'Rien n’a changé depuis le comptage précédent.')
        : ecarts.length
        ? manq + ' ' + accord(manq, 'bac manquant', 'bacs manquants') +
          (litres ? ' (' + n1(litres) + ' L)' : '') + ', ' + trop + ' en trop.'
        : 'Aucun écart avec le stock attendu.') +
      ' Le stock ne change pas tant que vous ne confirmez pas.</p>' +
      (th.livraisons.length
        ? '<div class="rappel" style="margin-top:10px">L’attendu compte aussi ' +
          th.livraisons.map(l => l.bacs + ' ' + accord(l.bacs, 'bac') + ' de la livraison ' + esc(l.fournisseur || '') +
            (l.numero ? ' n° ' + esc(l.numero) : '') + ' du ' + esc(fmtD(l.jour))).join(', ') +
          ', livrés avant le comptage et pas encore confirmés. Confirmez la livraison avant de reprendre cet inventaire.</div>' : '') +
      (nonComptes.length
        ? '<div class="rappel" style="margin-top:10px">Pas compté cette fois : ' + esc(nonComptes.join(', ')) +
          '. Leur stock ne change pas.</div>' : '') +
      (a.note ? '<div class="rappel" style="margin-top:10px">' + esc(a.note) + '</div>' : '') +
      (ecarts.length
        ? '<div class="entete" style="margin-top:16px"><h3>' + (sec ? 'Changements' : 'Écarts') + '</h3></div>' +
          '<div class="stack">' + ecarts.map(rang).join('') + '</div>'
        : '') +
      (justes.length
        ? '<details style="margin-top:16px"><summary>' + justes.length + ' ' +
          (sec ? accord(justes.length, 'référence inchangée', 'références inchangées')
               : accord(justes.length, 'article sans écart', 'articles sans écart')) + '</summary>' +
          '<div class="stack">' + justes.map(rang).join('') + '</div></details>'
        : '') +
      '<div class="actions"><button class="btn clair" data-fermer>Laisser en attente</button>' +
      '<button class="btn menthe" id="ci-ok">Valider l’inventaire</button></div>' +
      '<button type="button" class="btn fantome bloc sm" id="ci-ecarter" style="margin-top:8px">Écarter ce comptage</button>');

    if (enCours && justes.some(x => x.c === enCours)) {
      const d = $('#sheet-corps details'); if (d) d.open = true;
    }
    $$('[data-recompter]').forEach(b => b.onclick = () => {
      enCours = enCours === b.dataset.recompter ? null : b.dataset.recompter;
      dessinerV();
    });
    const ok = $('#rc-ok');
    if (ok) ok.onclick = async () => {
      const brut = $('#rc-v').value;
      const q = num(brut);
      const r = sec ? refSec(enCours) : null;
      const pasOk = sec && !(r && r.decimal === false) ? (q * 2) % 1 === 0 : q % 1 === 0;
      if (brut === '' || q < 0 || !pasOk) return toast('Quantité impossible', 'erreur');
      /* Le recomptage est fait maintenant ; l'inventaire garde l'heure de son
         comptage. On retire donc ce qui a bougé depuis, sinon une ouverture
         tracée entre-temps serait comptée deux fois. */
      let bouge = 0, art = null;
      if (sec) {
        const cleV = cleVivanteSec(enCours, a.lignes);
        if (cleV) bouge = await mouvementsDepuis(cleV, a.at);
      } else {
        invaliderStock();
        art = (await stockReel()).articles || {};
        th = await theoriqueAuComptage(a, art);
        /* Livraison arrivée depuis, pas encore confirmée : elle est dans le
           recomptage, elle entrera au stock à sa confirmation. */
        bouge = num(th.delta[enCours] || 0) + num(th.apres[enCours] || 0);
      }
      if (q - bouge < 0) {
        return toast('Recomptage incohérent avec les mouvements tracés depuis le comptage', 'erreur');
      }
      const cur = await inventaireEnAttente(partie);
      if (!cur || cur.at !== a.at) {
        closeSheet(); toast('Cet inventaire a changé entre-temps', 'erreur'); return rendre(STATE.view);
      }
      cur.lignes = cur.lignes || {};
      cur.lignes[enCours] = q - bouge;
      cur.corrections = Object.assign({}, cur.corrections, {
        [enCours]: { q: q, par: STATE.user.prenom, at: nowISO() }
      });
      await DB.set(CLE, cur);
      a = cur; enCours = null;
      if (art) Object.assign(maintenant, art);
      toast('Recomptage noté');
      dessinerV();
    };
    $('#ci-ecarter').onclick = () => confirmer('Écarter ce comptage ?',
      'Il est supprimé sans toucher au stock. Il faudra refaire l’inventaire.',
      'Écarter', async () => {
        const cur = await DB.get(CLE, null);
        if (cur && cur.at === a.at) await DB.del(CLE);
        await feed('warn', STATE.user.prenom + ' a écarté l’inventaire ' + (sec ? 'du sec' : 'de la chambre froide') +
          ' du ' + fmtD(a.jour) + ' (' + (a.par || '—') + ')');
        toast('Comptage écarté');
        rendre(STATE.view);
      }, () => dessinerV(), 'Retour');
    $('#ci-ok').onclick = async () => {
      /* Livraison confirmée ailleurs pendant que l'écran était ouvert. */
      if (!sec && th.livraisons.length) { invaliderStock(); th = await theoriqueAuComptage(a, (await stockReel()).articles || {}); }
      if (th.livraisons.length) return toast('Confirmez d’abord la livraison en attente : une quantité corrigée fausserait les écarts', 'erreur');
      const lieu = sec ? 'du sec' : 'de la chambre froide';
      /* Bacs manquants, recalculés sur l'attendu à jour. */
      const manquants = sec ? [] : lignesAttente(Object.assign({}, a, { avant: th.theo }), partie)
        .filter(x => x.d < 0 && bacs(x));
      const nbManq = manquants.reduce((s, x) => s - x.d, 0);
      const majStock = motif => confirmer('Mettre à jour le stock ' + lieu + ' ?',
        'Le stock prend les quantités comptées le ' + fmtD(a.jour) + '.' +
        (motif === 'pertes' ? ' ' + nbManq + ' ' + accord(nbManq, 'bac va', 'bacs vont') + ' au registre des pertes.'
         : motif === 'non_scanne' ? ' ' + nbManq + ' ' + accord(nbManq, 'bac est noté', 'bacs sont notés') +
           ' consommés sans scan, hors pertes.' : '') +
        ' Le calcul des écarts ne change pas.',
        'Mettre à jour le stock', () => confirmerInventaire(a, partie, motif, nbManq),
        () => (nbManq ? choix() : dessinerV()), 'Retour');
      if (!nbManq) return majStock('');
      /* Des bacs manquent : le manager dit ce qu'ils sont devenus. */
      const choix = () => { showSheet(
        '<h2 id="sheet-titre">' + nbManq + ' ' + accord(nbManq, 'bac manquant', 'bacs manquants') + '</h2>' +
        '<p class="sub">Par rapport au stock attendu le ' + esc(fmtD(a.jour)) + '. Que sont-ils devenus ?</p>' +
        '<div class="stack" style="margin-top:12px">' + manquants.map(x =>
          '<div class="invl"><span class="invn">' + esc(lib(x.c)) + '</span><span class="invc">' + nb(-x.d) + '</span></div>'
        ).join('') + '</div>' +
        '<div class="stack" style="margin-top:16px">' +
        '<button type="button" class="btn menthe bloc" id="ce-scan">Consommés, sortie non scannée</button>' +
        '<button type="button" class="btn clair bloc" id="ce-pertes">Pertes réelles (cassés, jetés, disparus)</button>' +
        '<button type="button" class="btn clair bloc" id="ce-recompter">Mal compté : recompter</button>' +
        '</div>' +
        '<button type="button" class="btn fantome bloc sm" data-fermer style="margin-top:8px">Retour</button>');
      $('#ce-scan').onclick = () => majStock('non_scanne');
      $('#ce-pertes').onclick = () => majStock('pertes');
      $('#ce-recompter').onclick = () => { toast('Touchez « Recompter » sur la ligne à revoir'); dessinerV(); };
      const ret = $('#sheet-corps [data-fermer]');
      if (ret) ret.onclick = () => dessinerV();
      };
      choix();
    };
  };
  dessinerV();
}

async function confirmerInventaire(a, partie, motif, nbVu) {
  partie = partie === 'sec' ? 'sec' : 'froid';
  const CLE = INV_ATTENTE[partie].cle;
  const cur = await inventaireEnAttente(partie);
  if (!cur || cur.at !== a.at) {
    toast('Cet inventaire a déjà été confirmé ou remplacé', 'erreur');
    return rendre(STATE.view);
  }
  const meta = {
    jour: cur.jour, at: cur.at, par: cur.par, employe: cur.employe,
    confirmePar: STATE.user.prenom, confirmeAt: nowISO(),
    corrections: cur.corrections || null
  };

  if (partie === 'sec') {
    /* Même enregistrement que l'ancienne validation directe du sec, à
       l'heure du comptage. */
    /* Attendu recalculé maintenant : une livraison d'avant le comptage,
       confirmée après, n'était pas dans cur.avant et serait perdue. */
    const precSec = await DB.get('stock:sec', null);
    let attenduSec = cur.avant;
    /* Comptage rejoué plus ancien que le dernier confirmé : l'attendu du
       moment du comptage (cur.avant) reste le bon. */
    if (precSec && precSec.lignes && String(precSec.at || '') < String(cur.at || '')) {
      attenduSec = Object.assign({}, precSec.lignes);
      const rec = await recusSecEntre(precSec.at, cur.at);
      Object.keys(rec).forEach(c => { attenduSec[c] = Math.round((num(attenduSec[c]) + rec[c]) * 1000) / 1000; });
    }
    const lignes = lignesAReprendre(cur, 'sec', attenduSec);
    /* Référence tracée (chantilly, coulis, toppings) non comptée : on reprend
       son stock vivant à l'heure du comptage, pas le chiffre du comptage
       précédent, sinon ses ouvertures depuis seraient effacées. */
    const comptes = groupesComptes(cur, 'sec');
    const vivant = (await stockReel()).articles || {};
    for (const c of new Set(Object.keys(lignes).concat(Object.keys(cur.avant || {})))) {
      if (comptes.has(groupeInv('sec', c))) continue;
      const cleV = cleVivanteSec(c, cur.avant);
      if (cleV && vivant[cleV] !== undefined) lignes[c] = Math.max(0, num(vivant[cleV]) - await mouvementsDepuis(cleV, cur.at));
    }
    await chargerPrixAchat().catch(() => {});
    const inv = Object.assign({}, meta, { note: cur.note || '', lignes: lignes, prix: prixDuComptage(lignes),
      /* Ce qui a vraiment été compté : un recomptage du jour ne recharge que ça. */
      comptees: Object.keys(cur.lignes || {}) });
    await DB.set('stock:sec', inv);
    invaliderStock();
    /* Historique du sec : une correction du même jour remplace son entrée. */
    const hist = await DB.get('stock:secs', []);
    const i = hist.findIndex(h => h.jour === inv.jour);
    if (i >= 0) hist[i] = inv; else hist.push(inv);
    await DB.set('stock:secs', hist.slice(-36));
    await DB.del(CLE);
    await feed('ok', STATE.user.prenom + ' a confirmé l’inventaire du sec du ' + fmtD(cur.jour) + ' (' + (cur.par || '—') + ')');
    toast('Inventaire du sec validé, stock à jour');
    return rendre(STATE.view);
  }

  /* L'attendu est recalculé maintenant : un mouvement d'avant le comptage,
     synchronisé après, et les livraisons pas encore confirmées y entrent. */
  invaliderStock();
  const { theo, livraisons } = await theoriqueAuComptage(cur, (await stockReel()).articles || {});
  if (livraisons.length) {
    toast('Confirmez d’abord la livraison en attente', 'erreur');
    return rendre(STATE.view);
  }
  /* « pertes » : les bacs manquants vont au registre. « non_scanne » :
     consommés sans scan, notés sur l'inventaire seulement. */
  const aReprendre = lignesAReprendre(cur, 'froid', theo);
  /* Le manager a choisi pour un nombre de bacs manquants : si un mouvement
     synchronisé entre-temps le change, il revoit l'écran avant d'enregistrer. */
  const nbMaintenant = Object.keys(theo).concat(Object.keys(aReprendre))
    .filter((c, i, t) => t.indexOf(c) === i && litArticle(c).taille)
    .reduce((s, c) => s + Math.max(0, num(theo[c] || 0) - num(aReprendre[c] || 0)), 0);
  if (nbVu !== undefined && nbMaintenant !== nbVu) {
    toast('Le stock a bougé depuis la vérification : revoyez les bacs manquants', 'erreur');
    return verifierInventaire('froid');
  }
  motif = nbMaintenant ? (motif === 'pertes' ? 'pertes' : 'non_scanne') : '';
  const inv = await enregistrerInventaire(aReprendre, cur.note, theo,
    motif ? Object.assign(meta, { motifEcart: motif }) : meta);

  /* En pertes réelles, chaque bac manquant devient une perte du jour du
     comptage. L'id dérive du comptage : confirmer deux fois n'en ajoute pas
     de seconde. */
  const manquants = Object.keys(inv.ecarts).filter(c => inv.ecarts[c] < 0 && litArticle(c).taille);
  if (manquants.length && motif === 'non_scanne') {
    /* Revalidé autrement après un premier choix « pertes » : on retire ses lignes. */
    const cle = 'pertes:' + cur.jour;
    const liste = await DB.get(cle, []);
    const reste = liste.filter(w => !(w && String(w.id || '').indexOf('inv|' + cur.at + '|') === 0));
    if (reste.length !== liste.length) {
      await DB.set(cle, reste);
      if (typeof cumulerPertesMois === 'function') await cumulerPertesMois(cur.jour);
    }
  }
  if (manquants.length && motif === 'pertes') {
    const cle = 'pertes:' + cur.jour;
    const liste = await DB.get(cle, []);
    manquants.forEach(c => {
      const id = 'inv|' + cur.at + '|' + c;
      if (liste.some(w => w && w.id === id)) return;
      liste.push({ id: id, produit: libelleArticle(c), nombre: -inv.ecarts[c],
                   litrage: num(litArticle(c).taille), parUnite: true, motif: 'inventaire',
                   par: STATE.user.prenom, employe: STATE.user.id, at: cur.at,
                   inventaire: cur.at });
    });
    await DB.set(cle, liste);
    if (typeof cumulerPertesMois === 'function') await cumulerPertesMois(cur.jour);
  }
  await DB.del(CLE);
  const bacsPerdus = manquants.reduce((s, c) => s - inv.ecarts[c], 0);
  await feed(bacsPerdus && motif === 'pertes' ? 'warn' : 'ok',
    STATE.user.prenom + ' a validé l’inventaire du ' + fmtD(cur.jour) + ' (' + (cur.par || '—') + ')' +
    (bacsPerdus ? ' · ' + bacsPerdus + ' ' + accord(bacsPerdus, 'bac', 'bacs') +
      (motif === 'pertes' ? ' en perte' : ' consommés sans scan') : ''));
  toast('Inventaire validé, stock de la chambre froide à jour');
  rendre(STATE.view);
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
  const [inv, connus, invSec] = await Promise.all([
    DB.get('stock:inventaire', null).catch(() => null),
    moisConnus().catch(() => null),
    DB.get('stock:sec', null).catch(() => null)
  ]);
  /* Les familles du sec sont bornées par l'inventaire du SEC, qui peut être
     plus ancien que celui de la chambre froide : on lit donc les mouvements
     depuis le plus ancien des deux (les bornes par famille, plus bas, écartent
     ce qui est déjà compté). Sans l'un des deux, on lit toute la fenêtre. */
  const depuis = (inv && inv.jour && invSec && invSec.jour)
    ? (String(inv.jour) < String(invSec.jour) ? inv.jour : invSec.jour)
    : null;
  const mouv = await tousMouvements(depuis, connus);

  const out = {};
  const dateInv = inv ? inv.at : null;

  if (inv && inv.lignes) {
    Object.keys(inv.lignes).forEach(c => { out[c] = num(inv.lignes[c]); });
  }

  /* Les familles comptées au SEC — chantilly, coulis, toppings — prennent leur
     référence dans l'inventaire du sec, pas dans celui de la chambre froide.
     Sans ce pont, la traçabilité écrivait une ouverture sur « chantilly|| »
     pendant que l'inventaire comptait « sec|creme| » : deux compteurs pour un
     même produit, et le premier passait à −1 quoi qu'on compte. La chantilly a
     un lot, elle se trace et elle se compte — il faut donc que le comptage la
     retrouve. « refSec » dit quelle référence du sec porte sa quantité. */
  const dateSec = invSec ? invSec.at : null;
  const famillesSec = FAMILLES_PRODUIT.filter(f => f.lieu === 'sec' || f.stock === 'sec');
  if (invSec && invSec.lignes) {
    famillesSec.forEach(f => {
      const ref = f.refSec || f.id;
      if (f.saveurs && f.saveurs.length) {
        /* Une saveur = une déclinaison du sec. On cherche par nom, sans accent. */
        const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        f.saveurs.forEach(sv => {
          const k = Object.keys(invSec.lignes).filter(x => {
            const p = x.split('|');
            return p[0] === 'sec' && p[1] === ref && norm(p[2]) === norm(sv);
          })[0];
          if (k !== undefined) out[cleArticle(f.id, sv, '')] = num(invSec.lignes[k]);
        });
      } else {
        /* Sans saveur : la somme de toutes les lignes de la référence. */
        let total = 0, trouve = false;
        Object.keys(invSec.lignes).forEach(x => {
          const p = x.split('|');
          if (p[0] === 'sec' && p[1] === ref) { total += num(invSec.lignes[x]); trouve = true; }
        });
        if (trouve) out[cleArticle(f.id, '', '')] = total;
      }
    });
  }

  mouv.forEach(m => {
    /* Format court depuis la réduction du journal, format long avant : on lit
       les deux pour ne pas invalider l'historique déjà écrit. */
    const type = m.t || m.type;
    const c    = m.c || m.cle;
    const q    = num(m.q !== undefined ? m.q : m.qte);
    const at   = m.a || m.at;
    if (!c) return;
    /* Un mouvement sur une famille du sec est borné par l'inventaire du SEC ;
       les autres par celui de la chambre froide. */
    const famC = FAMILLES_PRODUIT.filter(f => f.id === litArticle(c).famille)[0];
    const secC = !!(famC && (famC.lieu === 'sec' || famC.stock === 'sec'));
    const borne = secC ? dateSec : dateInv;
    if (borne && at <= borne) return;   // déjà compris dans l'inventaire
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
    jour: (m.a || m.at) ? isoOf(new Date(m.a || m.at)) : '',   // jour local, pas UTC
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
      titre: negatifs.length + ' ' + accord(negatifs.length, 'article') + ' en stock négatif',
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
  /* Tout ce qui reste ici se compte en chambre froide (l'onglet y range toutes
     les familles hors sec) : un macaron négatif n'est pas « au sec ». Seul ce
     qui vient de l'inventaire du sec y renvoie. */
  const froid = negatifs.filter(c => litArticle(c).famille !== 'sec');

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
    : noms.slice(0, 2).join(', ') + ' et ' + (noms.length - 2) + ' ' + accord(noms.length - 2, 'autre');
  const ou = d.froid ? 'Chambre froide' : 'Sec';

  return {
    id: 'recomptage',
    t: 'Recompter ' + liste + ' (inventaire ' + ou.toLowerCase() + ')',
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
   STOCK MINIMUM (manager)
   « catalogue:seuils » : { « glace|<parfum> »: bacs, toutes tailles confondues ;
   « sec|<réf>|<déclinaison> »: unités comptées }. Un article sous son minimum
   (strictement) est signalé sur Stock et sur la tour de contrôle. Absent ou 0 :
   pas de minimum.
   -------------------------------------------------------------------------- */
const CLE_SEUILS = 'catalogue:seuils';
/* Quantité sans décimale inutile : « 2 », « 2,5 ». */
const nSeuil = v => (Number(v) || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });

async function chargerSeuils() {
  const m = await DB.get(CLE_SEUILS, null);
  return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
}

/* Bacs d'un parfum, toutes tailles. */
function bacsParfum(articles, parfum) {
  return Object.keys(articles || {}).reduce((t, c) => {
    const a = litArticle(c);
    return a.famille === 'glace' && a.parfum === parfum ? t + num(articles[c]) : t;
  }, 0);
}

/* Quantité d'une ligne du sec : stock vivant pour coulis et toppings suivis
   à l'ouverture, sinon comptage + livraisons. */
function qteSec(cle, articles, secLignes) {
  /* Même lecture que l'écran Stock : une famille sans saveur suit son total,
     même si sa ligne n'a jamais été comptée. */
  const p = String(cle).split('|');
  const f = FAMILLES_PRODUIT.filter(x => (x.lieu === 'sec' || x.stock === 'sec') && (x.refSec || x.id) === p[1])[0];
  const cleV = f && !(f.saveurs && f.saveurs.length)
    ? (p[2] ? null : cleArticle(f.id, '', ''))
    : (typeof cleVivanteSec === 'function' ? cleVivanteSec(cle, secLignes || {}) : null);
  if (cleV && articles && articles[cleV] !== undefined) return num(articles[cleV]);
  return num((secLignes || {})[cle]);
}

/* Produits de la chambre froide autres que la glace (macarons, gaufres,
   crêpes, coffrets…) : [{ k: clé d'article, nom, grp, u }]. */
function articlesFroidSeuils() {
  const out = [];
  FAMILLES_PRODUIT.filter(f => f.id !== 'glace' && f.lieu !== 'sec' && f.stock !== 'sec').forEach(f => {
    if (f.parfums && f.saveurs && f.saveurs.length) {
      saveursActives(f).forEach(sv => out.push({ k: cleArticle(f.id, sv, ''), nom: f.libelle + ' · ' + sv, grp: f.libelle, u: f.unites || f.unite || 'unités' }));
    } else if (froidActif(f.id, '')) {
      out.push({ k: cleArticle(f.id, '', ''), nom: f.libelle, grp: f.libelle, u: f.unites || f.unite || 'unités' });
    }
  });
  return out;
}

/* [{ cle, nom, q, min, unite, partie }] des articles au minimum ou en
   dessous : à commander. */
function articlesSousSeuil(seuils, articles, secLignes) {
  const out = [];
  const connues = typeof clesSecConnues === 'function' ? clesSecConnues() : new Set();
  const froid = new Map(articlesFroidSeuils().map(x => [x.k, x]));
  Object.keys(seuils || {}).forEach(k => {
    const min = num(seuils[k]);
    if (!(min > 0)) return;
    const p = k.split('|');
    if (p[0] === 'glace') {
      if (!froidActif('glace', p[1])) return;
      const q = bacsParfum(articles, p[1]);
      if (q <= min) out.push({ cle: k, nom: p[1], q: q, min: min, unite: 'bac', partie: 'froid' });
    } else if (p[0] === 'sec') {
      if (!connues.has(k)) return;
      const q = qteSec(k, articles, secLignes);
      const r = catalogueSec().filter(x => typeof x === 'object' && x.id === p[1])[0];
      if (q <= min) out.push({ cle: k, nom: libelleSec(k), q: q, min: min, unite: (r && r.unite) || 'unité', partie: 'sec',
        sec: (r && r.sec) || 'Autres' });
    } else {
      const it = froid.get(k);
      if (!it) return;
      const q = num((articles || {})[k]);
      if (q <= min) out.push({ cle: k, nom: it.nom, q: q, min: min, unite: it.u, partie: 'froid' });
    }
  });
  return out.sort((a, b) => (a.q / a.min) - (b.q / b.min));
}

/* -----------------------------------------------------------------------------
   VUE — STOCK RÉEL
   -------------------------------------------------------------------------- */
V.stock = async function () {
  const { articles, inventaire } = await stockReel();
  if (typeof chargerCatalogueSec === 'function') await chargerCatalogueSec();
  const sec = await DB.get('stock:sec', null);
  /* Livraisons du sec confirmées depuis le dernier comptage. */
  const secAttendu = sec ? await stockSecAttendu(sec).catch(() => null) : null;
  const seuils = await chargerSeuils().catch(() => ({}));
  /* « À commander : 3 pour un minimum de 4 » (au minimum ou en dessous) ou « Minimum 4 ». */
  const ligneMin = (q, min, u) => !(min > 0) ? ''
    : q <= min ? '<div class="mini" style="color:var(--corail-d)"><b>À commander : ' + nSeuil(q) + ' pour un minimum de ' + nSeuil(min) + (u ? ' ' + esc(u) : '') + '</b></div>'
    : '<div class="mini">Minimum ' + nSeuil(min) + (u ? ' ' + esc(u) : '') + '</div>';
  const minGlace = Object.keys(seuils).filter(k => k.indexOf('glace|') === 0 && num(seuils[k]) > 0).map(k => k.slice(6))
    .filter(p => froidActif('glace', p));
  const attente = await inventaireEnAttente('froid');
  const attenteSec = await inventaireEnAttente('sec');
  /* Réceptions pas encore confirmées : leurs bacs ne sont pas dans ces chiffres. */
  const recAttente = typeof receptionsEnAttente === 'function' ? await receptionsEnAttente() : [];
  const [rf, rs] = await Promise.all([resumeAttente(attente, 'froid', articles), resumeAttente(attenteSec, 'sec')]);
  const resumes = { froid: rf, sec: rs };
  /* Comptage en attente : affiché, mais pas encore dans les chiffres. */
  const bandeauAttente = (a, p) => !a ? '' :
    '<div class="alerte warn" style="margin-top:12px"><div style="flex:1;min-width:0">' +
    '<b>Inventaire du ' + esc(fmtD(a.jour)) + ' à confirmer</b>' +
    '<p>Compté par ' + esc(a.par || '—') + '. ' + esc(resumes[p]) + ' Ces chiffres ne comptent qu’après la confirmation d’un manager.</p></div>' +
    (STATE.user && STATE.user.role === 'manager'
      ? '<button class="btn menthe sm" data-verif="' + p + '">Vérifier</button>' : '') + '</div>';

  /* Deux onglets, comme l'inventaire. On mémorise le dernier ouvert. */
  let partie = ['sec', 'commander'].indexOf(STATE.stockPartie) >= 0 ? STATE.stockPartie : 'froid';
  /* Articles au minimum ou en dessous (même calcul que la tour de contrôle). */
  let aCommander = [];
  try { aCommander = articlesSousSeuil(seuils, articles, secAttendu ? secAttendu.lignes : (sec && sec.lignes) || {}); } catch (e) {}
  /* Plus rien à commander : l'onglet disparaît, on revient à la chambre froide. */
  if (partie === 'commander' && !aCommander.length) partie = STATE.stockPartie = 'froid';

  const estSec = articleEstSec;
  /* Chambre froide : tout ce qui n'est pas marqué « sec ». */
  const clesFroid = Object.keys(articles)
    .filter(c => num(articles[c]) !== 0 && !estSec(c))
    .sort((a, b) => libelleArticle(a).localeCompare(libelleArticle(b)));
  const articlesFroid = {};
  clesFroid.forEach(c => articlesFroid[c] = articles[c]);
  const t = totauxStock(articlesFroid);
  const alertes = anomaliesStock(articles);

  /* ---------- Chambre froide ---------- */
  const blocFroid = () => {
    const parFamille = {};
    clesFroid.forEach(c => {
      const f = litArticle(c).famille;
      (parFamille[f] = parFamille[f] || []).push(c);
    });
    /* Un parfum à minimum reste affiché à zéro bac : c'est là qu'il manque. */
    if (minGlace.length && !parFamille.glace) parFamille.glace = [];
    articlesFroidSeuils().forEach(x => {
      if (!(num(seuils[x.k]) > 0) || clesFroid.indexOf(x.k) >= 0) return;
      const f = litArticle(x.k).famille;
      (parFamille[f] = parFamille[f] || []).push(x.k);
    });
    /* Un produit à minimum sans stock reste à sa place alphabétique. */
    Object.keys(parFamille).forEach(f => parFamille[f].sort((a, b) => libelleArticle(a).localeCompare(libelleArticle(b))));
    return carte('<div class="grid g3">' +
      kpi('Bacs de glace', t.bacs, '', n1(t.litres) + ' L') +
      kpi('Autres produits', t.unites, '', 'comptés à l’unité') +
      kpi('Poids', n1(t.kg) + ' kg', '', 'glace seule') + '</div>' +
      (inventaire
        ? '<p class="rappel" style="margin-top:14px">Dernier inventaire le ' +
          fmtD(inventaire.jour) + (inventaire.par ? ' par ' + esc(inventaire.par) : '') + '.</p>'
        : '<p class="rappel" style="margin-top:14px">Aucun inventaire : le stock part de zéro.</p>') +
      bandeauAttente(attente, 'froid') +
      (recAttente.length && typeof bandeauReceptions === 'function'
        ? '<div style="margin-top:12px">' + bandeauReceptions(recAttente) + '</div>' : ''),
      'solide') +

    (alertes.length
      ? alertes.map(a => '<div class="alerte ' + (a.niveau === 'bad' ? 'bad' : 'warn') + '" style="margin-top:12px">' +
          '<span class="ai">•</span><div><b>' + esc(a.titre) + '</b><p>' + esc(a.detail) + '</p></div></div>').join('')
      : '') +

    '<button class="btn menthe bloc xl" id="st-inv" style="margin-top:16px">Faire l’inventaire</button>' +

    (clesFroid.length || Object.keys(parFamille).length
      ? Object.keys(parFamille).map(fid => {
          const fam = FAMILLES_PRODUIT.filter(x => x.id === fid)[0];
          const sous = parFamille[fid].reduce((s, c) => s + num(articles[c]), 0);
          const u = fam ? (Math.abs(sous) > 1 ? fam.unites : fam.unite) : accord(sous, 'unité');
          const lignes = (fid === 'glace')
            ? (function () {
                const parParfum = {};
                parFamille[fid].forEach(c => { const a = litArticle(c);
                  (parParfum[a.parfum] = parParfum[a.parfum] || []).push(c); });
                minGlace.forEach(p => { if (!parParfum[p]) parParfum[p] = []; });
                return Object.keys(parParfum).sort((x, y) => x.localeCompare(y)).map(p => {
                  const tailles = parParfum[p].sort((x, y) => num(litArticle(x).taille) - num(litArticle(y).taille));
                  const n = tailles.reduce((s, c) => s + num(articles[c]), 0);
                  const negatif = tailles.some(c => num(articles[c]) < 0);
                  const min = num(seuils['glace|' + p]);
                  return carte('<div class="rang"><div style="flex:1;min-width:0"><b>' + esc(p) + '</b>' +
                    '<div class="mini tailles">' + (tailles.length ? tailles.map(c => { const q = num(articles[c]);
                      return '<span class="tq' + (q < 0 ? ' neg' : '') + '"><b>' + q + '</b>×' + esc(litArticle(c).taille) + ' L</span>';
                    }).join('') : 'aucun bac') + '</div>' + ligneMin(n, min, accord(min, 'bac')) + '</div>' +
                    '<b class="num" style="font-size:20px">' + n + '</b></div>', negatif ? 'corail' : min > 0 && n <= min ? 'ambre' : '');
                }).join('');
              })()
            : parFamille[fid].map(c => { const a = litArticle(c), q = num(articles[c]), min = num(seuils[c]);
                return carte('<div class="rang"><div style="flex:1;min-width:0"><b>' +
                  esc(a.parfum || (fam ? fam.libelle : fid)) + '</b>' +
                  (fam ? '<div class="mini">En ' + esc(fam.unites) + '</div>' : '') + ligneMin(q, min, fam ? (min > 1 ? fam.unites : fam.unite) : '') + '</div>' +
                  '<b class="num" style="font-size:20px">' + q + '</b></div>', q < 0 ? 'corail' : min > 0 && q <= min ? 'ambre' : '');
              }).join('');
          return '<div class="entete"><h3>' + esc(fam ? fam.libelle : fid) + '</h3>' +
            '<span class="pousse mini num">' + sous + ' ' + u + '</span></div>' +
            '<div class="stack">' + lignes + '</div>';
        }).join('')
      : vide('', 'Chambre froide vide. Commencez par un inventaire.'));
  };

  /* ---------- À commander : seulement les articles proches de la rupture ----------
     Chambre froide puis rayons du sec, du plus urgent au moins urgent
     (articlesSousSeuil trie déjà par quantité / minimum). */
  const blocCommander = () => {
    if (!aCommander.length) return vide('', 'Aucun article au minimum ou en dessous.');
    const groupes = [];
    const ajoute = (titre, liste) => { if (liste.length) groupes.push([titre, liste]); };
    ajoute('Chambre froide', aCommander.filter(x => x.partie === 'froid'));
    const rayons = (typeof SEC_SECTIONS !== 'undefined' ? SEC_SECTIONS.map(x => typeof x === 'string' ? x : x.id) : []);
    const secs = aCommander.filter(x => x.partie === 'sec');
    rayons.forEach(r => ajoute(r, secs.filter(x => x.sec === r)));
    ajoute('Autres', secs.filter(x => rayons.indexOf(x.sec) < 0));
    return carte('<p class="cs"><b>' + aCommander.length + ' ' + accord(aCommander.length, 'article', 'articles') +
      '</b> au minimum ou en dessous, du plus urgent au moins urgent.</p>', 'solide') +
      groupes.map(g => '<div class="entete"><h3>' + esc(g[0]) + '</h3>' +
        '<span class="pousse mini num">' + g[1].length + '</span></div>' +
        '<div class="stack">' + g[1].map(x => carte('<div class="rang"><div style="flex:1;min-width:0"><b>' + esc(x.nom) + '</b>' +
          '<div class="mini">Minimum ' + nSeuil(x.min) + ' ' + esc(x.partie === 'froid' && x.cle.indexOf('glace|') ? x.unite : accord(x.min, x.unite)) + '</div></div>' +
          '<b class="num" style="font-size:20px">' + nSeuil(x.q) + '</b>' +
          '<span class="mini" style="margin-left:6px">/ ' + nSeuil(x.min) + '</span></div>',
          x.q <= 0 ? 'corail' : 'ambre')).join('') + '</div>').join('');
  };

  /* ---------- Sec ---------- */
  const blocSec = () => {
    if (!sec || !sec.lignes || !Object.keys(sec.lignes).length) {
      return carte('<p class="cs">Le sec n’a jamais été compté.</p>' + bandeauAttente(attenteSec, 'sec') +
        '<button class="btn menthe bloc xl" id="st-inv-sec" style="margin-top:12px">Compter le sec</button>', 'solide');
    }
    const cat = (typeof catalogueSec === 'function') ? catalogueSec() : INVENTAIRE_SEC;
    const sections = (typeof SEC_SECTIONS !== 'undefined')
      ? SEC_SECTIONS.map(s => typeof s === 'string' ? { id:s } : s) : [];
    /* Comptage + réceptions confirmées depuis (voir stockSecAttendu). */
    const l = secAttendu ? secAttendu.lignes : Object.assign({}, sec.lignes);
    const nbRecus = secAttendu ? Object.keys(secAttendu.recus).length : 0;
    const parRef = {};
    Object.keys(l).forEach(k => { const p = k.split('|'); if (p[0] !== 'sec') return;
      (parRef[p[1]] = parRef[p[1]] || []).push({ v: p[2] || '', q: num(l[k]) }); });
    const totalLignes = Object.keys(l).length;
    const totalUnites = Object.keys(l).reduce((s, k) => s + num(l[k]), 0);
    /* Ligne à minimum jamais comptée : affichée à zéro. */
    const connuesSec = clesSecConnues();
    Object.keys(seuils).forEach(k => { const p = k.split('|');
      if (p[0] !== 'sec' || !(num(seuils[k]) > 0) || !connuesSec.has(k) || l[k] !== undefined) return;
      (parRef[p[1]] = parRef[p[1]] || []).push({ v: p[2] || '', q: 0 }); });

    /* Stock vivant du sec. Les familles tracées à l'ouverture (chantilly,
       coulis, toppings) ont un compte qui bouge entre deux comptages :
       stockReel le calcule déjà (comptage du sec − ouvertures depuis). On
       l'affiche à la place du chiffre figé du dernier comptage. Le reste du
       sec (cornets, gobelets…) n'a aucun mouvement : son stock est celui du
       comptage. */
    const norm = x => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const vivant = (refId, v) => {
      const f = FAMILLES_PRODUIT.filter(x => (x.lieu === 'sec' || x.stock === 'sec') &&
                                             (x.refSec || x.id) === refId)[0];
      if (!f) return null;
      let cle;
      if (f.saveurs && f.saveurs.length) {
        if (v === null) return null;
        const sv = f.saveurs.filter(x => norm(x) === norm(v))[0];
        if (!sv) return null;
        cle = cleArticle(f.id, sv, '');
      } else {
        if (v !== null) return null;          // compté en bloc : seul le total vit
        cle = cleArticle(f.id, '', '');
      }
      return articles[cle] !== undefined ? num(articles[cle]) : null;
    };

    return carte('<div class="grid g2">' +
      kpi('Références', totalLignes, '', nbRecus ? 'comptées ou reçues' : 'comptées') +
      kpi('Unités', n1(totalUnites), '', nbRecus ? 'comptage + livraisons' : 'au dernier comptage') + '</div>' +
      '<p class="rappel" style="margin-top:14px">Compté le ' + fmtD(sec.jour) +
      (sec.par ? ' par ' + esc(sec.par) : '') + '. Chantilly, coulis et toppings ' +
      'baissent à chaque ouverture tracée ; le reste suit le comptage' +
      (nbRecus ? ', plus les livraisons confirmées depuis (' + nbRecus + ' ' + accord(nbRecus, 'référence reçue', 'références reçues') + ')' : '') +
      '.</p>' + bandeauAttente(attenteSec, 'sec'), 'solide') +
      '<button class="btn menthe bloc xl" id="st-inv-sec" style="margin-top:16px">Recompter le sec</button>' +

      sections.map(s => {
        const refs = cat.filter(r => (r.sec || 'Autres') === s.id && !r.masque && parRef[r.id]);
        if (!refs.length) return '';
        return '<div class="sec-bloc"' + (s.teinte ? ' style="--sec-teinte:' + s.teinte + '"' : '') + '>' +
          '<div class="entete sec-entete"><span class="sec-pastille"></span><h3>' + esc(s.id) + '</h3></div>' +
          '<div class="stack">' + refs.map(r => {
            /* Une saveur n'est servie qu'une fois : « Café » et un ancien
               « cafe » recevraient sinon la même valeur, comptée deux fois. */
            const servies = new Set();
            const lignes = parRef[r.id].map(x => {
              const q = vivant(r.id, x.v || '');
              if (q === null || servies.has(norm(x.v))) return x;
              servies.add(norm(x.v));
              return Object.assign({}, x, { q: q, vif: true });
            });
            const enBloc = vivant(r.id, null);
            const total = enBloc !== null ? enBloc : lignes.reduce((a, x) => a + x.q, 0);
            const suivi = enBloc !== null || lignes.some(x => x.vif);
            const connues = new Set(r.variantes || []);
            const minDe = v => num(seuils['sec|' + r.id + '|' + (v || '')]);
            /* Sans déclinaison : le total (vivant si suivi) fait foi, comme le texte. */
            const sous = r.variantes && r.variantes.length
              ? lignes.filter(x => minDe(x.v) > 0 && x.q <= minDe(x.v))
              : (minDe('') > 0 && total <= minDe('') ? [{ v: '', q: total }] : []);
            const aMin = minDe('') > 0 || lignes.some(x => minDe(x.v) > 0);
            return carte('<div class="rang"><div style="flex:1;min-width:0"><b>' + esc(r.nom) + '</b>' +
              (suivi ? '<div class="mini">Suivi en direct : comptage moins ouvertures</div>' : '') +
              (r.variantes && r.variantes.length
                ? (sous.length ? '<div class="mini" style="color:var(--corail-d)"><b>À commander : ' +
                    sous.map(x => esc(x.v || '—') + ' ' + nSeuil(x.q) + ' (minimum ' + nSeuil(minDe(x.v)) + ')').join(', ') + '</b></div>' : '')
                : (aMin ? ligneMin(total, minDe(''), '') : '')) +
              (r.variantes && r.variantes.length
                ? '<div class="mini tailles">' + lignes
                    .sort((a, b) => (r.variantes.indexOf(a.v) + 99) - (r.variantes.indexOf(b.v) + 99))
                    .map(x => '<span class="tq' + (x.q < 0 ? ' neg' : '') + (connues.has(x.v) ? '' : ' ancienne') + '">' +
                      esc(x.v || '—') + ' <b>' + n1(x.q) + '</b></span>').join('') + '</div>'
                : '') + '</div>' +
              '<b class="num" style="font-size:20px">' + n1(total) + '</b>' +
              '<span class="mini" style="margin-left:6px">' + esc(r.unite) + (total > 1 ? 's' : '') + '</span></div>',
              total < 0 ? 'corail' : (sous.length ? 'ambre' : ''));
          }).join('') + '</div></div>';
      }).join('');
  };

  const dessiner = () => {
    $('#vue-actions').innerHTML = '';
    $('#page').innerHTML =
      '<div class="tseg">' +
      [['froid', 'Chambre froide', t.bacs + ' ' + accord(t.bacs, 'bac')], ['sec', 'Sec', sec ? Object.keys(sec.lignes || {}).length + ' réf.' : 'jamais compté']]
        .concat(aCommander.length ? [['commander', 'À commander', aCommander.length + ' ' + accord(aCommander.length, 'article', 'articles')]] : [])
        .map(x => '<button class="' + (x[0] === partie ? 'on' : '') + '" data-partie="' + x[0] + '">' +
          '<span class="tsl">' + x[1] + '</span><small>' + x[2] + '</small></button>').join('') +
      '</div>' +
      (partie === 'commander' ? blocCommander() : partie === 'froid' ? blocFroid() : blocSec());

    $$('[data-partie]').forEach(b => b.onclick = () => {
      partie = b.dataset.partie; STATE.stockPartie = partie; dessiner();
    });
    const bi = $('#st-inv');
    if (bi) bi.onclick = () => { STATE.inventairePartie = 'froid'; rendre('inventaire'); };
    $$('[data-verif]').forEach(b => b.onclick = () => verifierInventaire(b.dataset.verif));
    const rv = document.getElementById('rc-verif');
    if (rv && typeof verifierReceptions === 'function') rv.onclick = verifierReceptions;
    const bs = $('#st-inv-sec');
    if (bs) bs.onclick = () => { STATE.inventairePartie = 'sec'; rendre('inventaire'); };
  };
  dessiner();
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

  /* Réceptions à confirmer : la tour de contrôle est l'accueil du manager, et
     ni Réception ni Stock ne sont dans sa barre. Sans ce bandeau, un bon
     scanné par l'équipe attendait sans que personne ne le voie. */
  const recAttente = typeof receptionsEnAttente === 'function' ? await receptionsEnAttente() : [];
  if (STATE.view !== 'controle' || page !== $('#page')) return;
  let apresReceptions = null;
  if (recAttente.length && typeof bandeauReceptions === 'function' && page.firstChild) {
    const br = document.createElement('div');
    apresReceptions = br;
    br.style.marginTop = '14px';
    br.innerHTML = bandeauReceptions(recAttente);
    page.insertBefore(br, page.firstChild.nextSibling);
    const bv = br.querySelector('#rc-verif'); if (bv) bv.onclick = verifierReceptions;
  }

  /* Valeur du stock, sans passer par Inventaire : derniers comptages validés
     (chambre froide et sec), à leurs prix du jour. */
  if (STATE.user && STATE.user.role === 'manager') {
    const [, pf, ps] = await Promise.all([chargerPrixAchat().catch(() => {}),
      DB.get('stock:inventaire', null), DB.get('stock:sec', null)]);
    if (STATE.view !== 'controle' || page !== $('#page')) return;
    /* Deux dessins rapprochés (« Traité », retour d'un écran) : une seule carte. */
    const ancienne = $('#valeur-stock'); if (ancienne) ancienne.remove();
    const html = carteValeurStock(pf, ps, true);
    if (html && page.firstChild) {
      const bvs = document.createElement('div');
      bvs.id = 'valeur-stock';
      bvs.style.marginTop = '14px';
      bvs.innerHTML = html;
      /* Dans la grille de la météo et de « Personne en service » : une
         colonne de large, pas toute la page. */
      const grille = $('#ctl-meteo');
      if (grille) { bvs.style.marginTop = ''; grille.appendChild(bvs); }
      else {
        const ref = apresReceptions && apresReceptions.parentNode === page ? apresReceptions.nextSibling : page.firstChild.nextSibling;
        page.insertBefore(bvs, ref);
      }
      const go = bvs.querySelector('[data-valstock]');
      /* L'onglet qui porte la valeur : le sec s'il en a, sinon la chambre froide. */
      const secVal = ps ? valeurStock(ps.lignes, ps.prix).total : 0;
      if (go) go.onclick = () => { STATE.inventairePartie = secVal > 0 ? 'sec' : 'froid'; rendre('inventaire'); };
    }

    /* Articles sous leur stock minimum : à commander. */
    try {
      const seuils = await chargerSeuils();
      if (Object.keys(seuils).length) {
        /* Catalogue de la boutique : sans lui, les références ajoutées et les
           déclinaisons renommées étaient ignorées à l'ouverture de l'appli. */
        if (typeof chargerCatalogueSec === 'function') { try { await chargerCatalogueSec(); } catch (e) {} }
        const { articles } = await stockReel();
        const sec = ps;
        const att = sec ? await stockSecAttendu(sec).catch(() => null) : null;
        const sous = articlesSousSeuil(seuils, articles, att ? att.lignes : (sec && sec.lignes) || {});
        if (STATE.view !== 'controle' || page !== $('#page')) return;
        const vieille = $('#sous-seuil'); if (vieille) vieille.remove();
        if (sous.length) {
          const bm = document.createElement('div');
          bm.id = 'sous-seuil';
          bm.style.marginTop = '14px';
          const liste = sous.slice(0, 8).map(x => esc(x.nom) + ' ' + nSeuil(x.q) + '/' + nSeuil(x.min)).join(', ') +
            (sous.length > 8 ? ' et ' + (sous.length - 8) + ' autre' + (sous.length > 9 ? 's' : '') : '');
          bm.innerHTML = '<div class="alerte warn"><span class="ai">•</span><div style="flex:1;min-width:0"><b>' +
            sous.length + ' ' + accord(sous.length, 'article à commander', 'articles à commander') + ' (au minimum ou en dessous)</b>' +
            '<p>' + liste + '</p></div><button class="btn menthe sm" data-voirseuil>Voir</button></div>';
          /* Sous la valeur du stock, sinon sous les réceptions à confirmer. */
          const apres = $('#valeur-stock') && $('#valeur-stock').parentNode === page ? $('#valeur-stock') : $('#ctl-meteo');
          const ancre = apres && apres.parentNode === page ? apres
            : apresReceptions && apresReceptions.parentNode === page ? apresReceptions : page.firstChild;
          page.insertBefore(bm, ancre ? ancre.nextSibling : null);
          bm.querySelector('[data-voirseuil]').onclick = () => {
            STATE.stockPartie = 'commander'; rendre('stock'); };
        }
      }
    } catch (e) {}
  }

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
       ajouts:  [ { id, sec, nom, unite, decimal, variantes } ],
       retirees: ['sec|id|déclinaison'] }  déclinaisons retirées une à une
   Une déclinaison retirée disparaît de « variantes » (inventaire, réception,
   réassort, minimums) mais reste dans « variantesRetirees » pour la fiche.
   Son stock n'est jamais effacé : il reste au dernier comptage.
   -------------------------------------------------------------------------- */
let _catalogueSec = null;

function catalogueSecBrut() {
  return INVENTAIRE_SEC.map(r => typeof r === 'string'
    ? { id:r, nom:r, unite:'unité', decimal:false } : Object.assign({}, r));
}

/* Chambre froide : parfums de glace et saveurs retirés par le manager.
   catalogue:froid = { retires: ['glace|Amarena', 'mac_classico|Mangue', 'gaufre|'] }
   Retiré = absent de l'inventaire, de la réception et des minimums. Le stock
   déjà compté n'est jamais effacé : il est reporté à chaque inventaire. */
let _froidRetires = new Set();
function froidActif(famille, saveur) {
  return !_froidRetires.has((famille || '') + '|' + (saveur || ''));
}
function parfumsActifs() {
  return PARFUMS.filter(p => froidActif('glace', p));
}
function saveursActives(f) {
  return (f.saveurs || []).filter(sv => froidActif(f.id, sv));
}
/* Famille visible à l'inventaire : au moins une saveur active, ou, sans
   saveur, la famille elle-même active. */
function familleFroidActive(f) {
  return f.saveurs && f.saveurs.length ? saveursActives(f).length > 0 : froidActif(f.id, '');
}
async function chargerCatalogueFroid() {
  const m = await DB.get('catalogue:froid', null);   // une erreur garde l'ancienne liste
  _froidRetires = new Set(m && Array.isArray(m.retires) ? m.retires : []);
  return _froidRetires;
}

/* Synchrone, à partir du dernier chargement. */
function catalogueSec() {
  return _catalogueSec || catalogueSecBrut();
}

/* À appeler avant de dessiner un écran qui s'en sert. */
async function chargerCatalogueSec() {
  const [m] = await Promise.all([DB.get('catalogue:sec', null), chargerPrixAchat().catch(() => {}),
    chargerCatalogueFroid().catch(() => {})]);
  const base = catalogueSecBrut();
  if (!m) { _catalogueSec = base; return base; }
  const out = base.map(r => {
    const mod = (m.modifs || {})[r.id];
    const x = mod ? Object.assign({}, r, mod) : r;
    if ((m.masques || []).indexOf(r.id) >= 0) x.masque = true;
    return x;
  });
  /* Une référence ajoutée se modifie et se retire comme une référence
     d'usine : modifs et masques ne s'appliquaient qu'à celles-ci, si bien que
     ✎ › Enregistrer et − restaient sans effet sur une référence ajoutée. */
  (m.ajouts || []).forEach(a => {
    if (!a || !a.id || out.some(r => r.id === a.id)) return;
    const mod = (m.modifs || {})[a.id];
    const x = Object.assign({}, a, mod || {});
    if ((m.masques || []).indexOf(a.id) >= 0) x.masque = true;
    out.push(x);
  });
  /* Déclinaisons retirées une à une (fiche article). Une référence dont
     toutes les déclinaisons sont retirées est retirée elle-même. */
  const ret = new Set(Array.isArray(m.retirees) ? m.retirees : []);
  if (ret.size) out.forEach(x => {
    const vs = x.variantes || [];
    if (!vs.length) return;
    const retirees = vs.filter(v => ret.has('sec|' + x.id + '|' + v));
    if (!retirees.length) return;
    x.variantesRetirees = retirees;
    x.variantesToutes = vs.slice();
    x.variantes = vs.filter(v => retirees.indexOf(v) < 0);
    /* Garde-fou (la fiche l'empêche) : tout retiré = référence retirée. */
    if (!x.variantes.length) { x.variantes = vs; x.masque = true; }
  });
  _catalogueSec = out;
  return out;
}

async function enregistrerCatalogueSec(m) {
  await DB.set('catalogue:sec', m);
  _catalogueSec = null;
  await chargerCatalogueSec();
}

/* -----------------------------------------------------------------------------
   PRIX D'ACHAT ET VALEUR DU STOCK (manager)
   Prix de base : PRIX_ACHAT (factures fournisseur). Corrections du manager
   sous « catalogue:prix » : { clé de prix: prix HT }, 0 = pas de prix ;
   une clé absente reprend le prix du fichier.
   Chaque inventaire enregistré garde les prix du jour (champ « prix ») :
   sa valeur ne change pas quand un prix change ensuite.
   Les prix ne s'affichent qu'au manager. Renommer une déclinaison lui fait
   perdre son prix : il se ressaisit dans Catalogue (onglet Sec).
   Clé de prix : « sec|id|déclinaison » pour le sec, « glace||3 » pour un bac
   (le prix dépend de la taille, pas du parfum), « famille|| » pour le reste
   de la chambre froide.
   -------------------------------------------------------------------------- */
let _prixAchat = {};

async function chargerPrixAchat() {
  const m = await DB.get('catalogue:prix', null);
  _prixAchat = (m && typeof m === 'object') ? m : {};
  return _prixAchat;
}

function clePrix(cle) {
  const a = litArticle(cle);
  if (a.famille === 'sec') return cle;
  return cleArticle(a.famille, '', a.famille === 'glace' ? a.taille : '');
}

/* Prix de base, avant correction du manager. */
function prixAchatDefaut(cp) {
  const P = (typeof PRIX_ACHAT !== 'undefined') ? PRIX_ACHAT : {};
  const a = litArticle(cp);
  const v = a.famille === 'sec' ? (P.sec || {})[cp]
    : a.famille === 'glace' ? (P.glace || {})[a.taille]
    : (P.froid || {})[a.famille];
  return num(v) > 0 ? num(v) : null;
}

/* Prix d'une ligne d'inventaire, ou null si elle n'en a pas. */
const corrige = cp => _prixAchat[cp] !== undefined && _prixAchat[cp] !== null;

function prixArticle(cle) {
  const cp = clePrix(cle);
  if (corrige(cp)) {
    const v = num(_prixAchat[cp]);
    return v > 0 ? v : null;
  }
  return prixAchatDefaut(cp);
}

/* Prix d'une ligne d'un inventaire passé : celui gardé ce jour-là, sinon
   (inventaire d'avant les prix) le prix actuel. */
function prixLigne(cle, fige) {
  return (fige && fige[cle] !== undefined) ? (num(fige[cle]) > 0 ? num(fige[cle]) : null) : prixArticle(cle);
}

function prixDuComptage(lignes) {
  const out = {};
  Object.keys(lignes || {}).forEach(c => {
    if (num(lignes[c]) <= 0) return;
    const p = prixArticle(c);
    out[c] = p === null ? 0 : p;
  });
  return out;
}

/* Valeur d'un comptage : total, et lignes comptées (> 0) restées sans prix. */
function valeurStock(lignes, fige) {
  let total = 0, sansPrix = 0;
  Object.keys(lignes || {}).forEach(c => {
    const q = num(lignes[c]);
    if (q <= 0) return;
    const p = prixLigne(c, fige);
    if (p === null) sansPrix++; else total += q * p;
  });
  return { total: total, sansPrix: sansPrix };
}

async function enregistrerPrixAchat(modifs) {
  const m = Object.assign({}, (await DB.get('catalogue:prix', null)) || {}, modifs);
  Object.keys(m).forEach(k => { if (m[k] === null) delete m[k]; });
  await DB.set('catalogue:prix', m);
  _prixAchat = m;
}

/* Saisie « 26,47 » ou « 26.47 » ; vide = pas de prix. */
function lirePrix(txt) {
  let t = String(txt || '').replace(/[\s\u00a0€]/g, '');
  /* « 1.234,50 » : le point sépare les milliers. */
  if (t.indexOf(',') >= 0) t = t.replace(/\./g, '').replace(',', '.');
  if (!t) return 0;
  const v = Number(t);
  return (isFinite(v) && v >= 0) ? Math.round(v * 100) / 100 : NaN;
}

/* Fiche d'une référence du sec : pour chaque déclinaison, active ou
   retirée, prix d'achat et stock minimum. Un seul endroit pour ce que
   l'inventaire, la réception, les minimums et la valeur lisent. Retirer ne
   touche pas au stock déjà compté. */
/* Renommer une déclinaison du sec partout où sa clé « sec|id|nom » sert :
   dernier inventaire, inventaire en attente, réceptions depuis, prix,
   minimums, déclinaisons retirées, mémoire des bons de livraison, puis le
   catalogue. Son stock, son prix et son minimum la suivent.
   ren = { ancien: nouveau }. */
async function renommerDeclinaisonsSec(r, ren) {
  const anciens = Object.keys(ren || {}).filter(a => ren[a] && ren[a] !== a);
  if (!anciens.length) return {};
  const k = v => 'sec|' + r.id + '|' + v;
  const map = {};
  anciens.forEach(a => { map[k(a)] = k(ren[a]); });
  const deplacer = o => {
    if (!o || typeof o !== 'object') return false;
    let n = 0;
    Object.keys(map).forEach(a => {
      if (o[a] === undefined) return;
      o[map[a]] = o[a]; delete o[a]; n++;
    });
    return n > 0;
  };
  /* Prix effectif (corrigé ou d'usine) recopié sous le nouveau nom. Rien
     à recopier (nouvel essai après un échec) : le prix déjà déplacé reste. */
  const prix = {};
  Object.keys(map).forEach(a => {
    const pa = prixArticle(a);
    if (pa !== null && !corrige(map[a])) prix[map[a]] = pa;
    if (corrige(a)) prix[a] = null;
  });
  if (Object.keys(prix).length) await enregistrerPrixAchat(prix);
  const seuils = await chargerSeuils();
  if (deplacer(seuils)) await DB.set(CLE_SEUILS, seuils);
  const sp = await DB.get('stock:sec', null);
  if (sp && Array.isArray(sp.comptees)) sp.comptees = sp.comptees.map(c => map[c] || c);
  if (sp && (deplacer(sp.lignes) | deplacer(sp.prix))) await DB.set('stock:sec', sp);
  const at = await DB.get(INV_ATTENTE.sec.cle, null);
  if (at && (deplacer(at.lignes) | deplacer(at.avant))) await DB.set(INV_ATTENTE.sec.cle, at);
  const mv = await DB.get(CLE_SEC_MV, []);
  if (Array.isArray(mv) && mv.some(x => x && map[x.cle])) {
    await DB.set(CLE_SEC_MV, mv.map(x => x && map[x.cle] ? Object.assign({}, x, { cle: map[x.cle] }) : x));
  }
  const ra = await DB.get('reception:attente', []);
  if (Array.isArray(ra) && ra.some(x => x && !x.traite && (x.lignes || []).some(l => l && map[l.cle]))) {
    ra.forEach(x => { if (x && !x.traite) (x.lignes || []).forEach(l => { if (l && map[l.cle]) l.cle = map[l.cle]; }); });
    await DB.set('reception:attente', ra);
  }
  const memo = await memoBL();
  let nMemo = 0;
  Object.keys(memo).forEach(c => { if (memo[c] && map[memo[c].cle]) { memo[c].cle = map[memo[c].cle]; nMemo++; } });
  if (nMemo) await DB.set(CLE_MEMO_BL, memo);
  /* Catalogue en dernier, relu juste avant. */
  const m = (await DB.get('catalogue:sec', null)) || {};
  m.masques = m.masques || []; m.modifs = m.modifs || {}; m.ajouts = m.ajouts || [];
  const toutes = (r.variantesToutes || r.variantes || []).map(v => ren[v] || v);
  m.modifs[r.id] = Object.assign({ nom: r.nom, unite: r.unite, decimal: r.decimal !== false },
    m.modifs[r.id] || {}, { variantes: toutes });
  if (Array.isArray(m.retirees)) m.retirees = m.retirees.map(x => map[x] || x);
  await enregistrerCatalogueSec(m);
  return map;
}

/* Renommage permis ? Pas vers le nom d'une autre déclinaison existante
   (échange ou chaîne : les données se mélangeraient), et pas pour les
   coulis, toppings et crèmes : leur stock vivant suit le nom de la saveur. */
function erreurRenommage(r, ren) {
  const anciens = Object.keys(ren || {}).filter(a => ren[a] && ren[a] !== a);
  if (!anciens.length) return '';
  if (FAMILLES_PRODUIT.some(f => (f.lieu === 'sec' || f.stock === 'sec') && (f.refSec || f.id) === r.id && f.saveurs && f.saveurs.length)) {
    return 'Les saveurs de ' + r.nom + ' ne se renomment pas ici (suivies à l’ouverture)';
  }
  const toutes = r.variantesToutes || r.variantes || [];
  /* La déclinaison elle-même ne compte pas : « chocolat » → « Chocolat ». */
  const a = anciens.filter(x => toutes.some(v => v !== x && v.toLowerCase() === ren[x].toLowerCase()))[0];
  return a ? '« ' + ren[a] + ' » existe déjà : renommez en deux fois, par un nom provisoire' : '';
}

/* Contrôle des nouveaux noms : non vides, sans « | », sans doublon. */
function erreurNomsDeclinaisons(noms) {
  if (noms.some(n => !n)) return 'Une déclinaison n’a pas de nom';
  if (noms.some(n => n.indexOf('|') >= 0)) return 'Le caractère « | » n’est pas permis';
  const vus = new Set();
  for (const n of noms) { const c = n.toLowerCase(); if (vus.has(c)) return 'Deux déclinaisons portent le nom « ' + n + ' »'; vus.add(c); }
  return '';
}

async function ficheArticle(r, apres) {
  let seuils;
  try { seuils = await chargerSeuils(); } catch (e) { return toast('Minimums illisibles, réessayez', 'erreur'); }
  const toutes = r.variantesToutes || (r.variantes || []).concat(r.variantesRetirees || []);
  const lignes = (toutes.length ? toutes : ['']).map(v => ({
    v: v, cp: 'sec|' + r.id + '|' + v,
    actif: toutes.length ? (r.variantesRetirees || []).indexOf(v) < 0 : !r.masque
  }));
  /* Point décimal partout (2.5) : l'export et les calculs le lisent tel quel. */
  const val = cp => { const p = corrige(cp) ? num(_prixAchat[cp]) : prixAchatDefaut(cp); return p > 0 ? String(p) : ''; };
  showSheet(
    '<h2 id="sheet-titre">' + esc(r.nom) + '</h2>' +
    '<p class="mini">Code : ' + esc(r.id) + (r.sec ? ' · ' + esc(r.sec) : '') + '</p>' +
    '<p class="cs">Compté en ' + esc(r.unite) + '. Prix d’achat HT par ' + esc(r.unite) +
    ' ; minimum : arrivé à ce nombre, l’article est « à commander ». Retirer une déclinaison la cache ' +
    'de l’inventaire, de la réception et du réassort, sans effacer son stock.</p>' +
    (r.masque && toutes.length ? '<div class="alerte warn" style="margin-top:10px"><span class="ai">•</span><div><b>Référence retirée</b><p>Réaffichez-la avec ↺ dans le catalogue.</p></div></div>' : '') +
    lignes.map((x, i) =>
      '<div class="card plat" style="margin-top:10px"><div class="rang">' +
      (x.v ? '<input type="text" id="fn-' + i + '" value="' + esc(x.v) + '" aria-label="Nom de la déclinaison" style="flex:1;min-width:0;font-weight:600">'
           : '<b style="flex:1;min-width:0">' + esc(r.nom) + '</b>') +
      '<label class="mini" style="display:flex;align-items:center;gap:6px"><input type="checkbox" data-fa="' + i + '"' + (x.actif ? ' checked' : '') + '> Active</label></div>' +
      '<div class="grid g2" style="margin-top:8px">' +
      '<div class="champ"><label class="f" for="fp-' + i + '">Prix (€)</label><input type="text" inputmode="decimal" id="fp-' + i + '" value="' + esc(val(x.cp)) + '" placeholder="—"></div>' +
      '<div class="champ"><label class="f" for="fm-' + i + '">Minimum</label><input type="text" inputmode="decimal" id="fm-' + i + '" value="' + (num(seuils[x.cp]) > 0 ? esc(String(seuils[x.cp])) : '') + '" placeholder="—"></div>' +
      '</div></div>').join('') +
    '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
    '<button class="btn menthe" id="fa-ok">Enregistrer</button></div>');
  let enCours = false;
  $('#fa-ok').onclick = async () => {
    if (enCours) return;
    const prix = {}, mins = {}, actifs = {};
    for (let i = 0; i < lignes.length; i++) {
      const x = lignes[i];
      const v = lirePrix($('#fp-' + i).value);
      if (isNaN(v)) return toast('Prix illisible : ' + (x.v || r.nom), 'erreur');
      const d = prixAchatDefaut(x.cp);
      const avantPrix = corrige(x.cp) ? num(_prixAchat[x.cp]) : (d || 0);
      if (v !== avantPrix) prix[x.cp] = (d !== null && v === d) || (d === null && v === 0) ? null : v;
      const fm = $('#fm-' + i);
      const mt = fm.value.trim().replace(',', '.');
      const mv = mt === '' ? 0 : Number(mt);
      if (!(mv >= 0)) return toast('Minimum invalide : ' + (x.v || r.nom), 'erreur');
      if (mv !== (num(seuils[x.cp]) > 0 ? num(seuils[x.cp]) : 0)) mins[x.cp] = mv;
      const a = !!$('[data-fa="' + i + '"]').checked;
      if (a !== x.actif) actifs[x.cp] = a;
    }
    if (toutes.length && !$$('[data-fa]').some(c => c.checked)) {
      return toast('Gardez au moins une déclinaison active, ou retirez la référence avec ✕', 'erreur');
    }
    const ren = {};
    if (toutes.length) {
      const noms = lignes.map((x, i) => $('#fn-' + i).value.trim());
      const err = erreurNomsDeclinaisons(noms);
      if (err) return toast(err, 'erreur');
      lignes.forEach((x, i) => { if (noms[i] !== x.v) ren[x.v] = noms[i]; });
      const errR = erreurRenommage(r, ren);
      if (errR) return toast(errR, 'erreur');
    }
    enCours = true; $('#fa-ok').disabled = true;
    try {
      /* Renommage d'abord : la suite s'écrit sous les nouveaux noms. */
      const map = await renommerDeclinaisonsSec(r, ren);
      const suit = o => Object.keys(o).reduce((acc, c) => { acc[map[c] || c] = o[c]; return acc; }, {});
      const p2 = suit(prix), m2 = suit(mins), a2 = suit(actifs);
      Object.keys(prix).forEach(c => delete prix[c]); Object.assign(prix, p2);
      Object.keys(mins).forEach(c => delete mins[c]); Object.assign(mins, m2);
      Object.keys(actifs).forEach(c => delete actifs[c]); Object.assign(actifs, a2);
      if (Object.keys(prix).length) await enregistrerPrixAchat(prix);
      if (Object.keys(mins).length) {
        /* Relu juste avant : un autre manager garde ses minimums. */
        const frais = await chargerSeuils();
        Object.keys(mins).forEach(k => { if (mins[k] > 0) frais[k] = mins[k]; else delete frais[k]; });
        await DB.set(CLE_SEUILS, frais);
      }
      if (Object.keys(actifs).length) {
        const m = (await DB.get('catalogue:sec', null)) || {};
        m.masques = m.masques || []; m.modifs = m.modifs || {}; m.ajouts = m.ajouts || [];
        m.retirees = Array.isArray(m.retirees) ? m.retirees : [];
        Object.keys(actifs).forEach(k => {
          if (!toutes.length) {
            const i = m.masques.indexOf(r.id);
            if (actifs[k] && i >= 0) m.masques.splice(i, 1);
            if (!actifs[k] && i < 0) m.masques.push(r.id);
            return;
          }
          const j = m.retirees.indexOf(k);
          if (actifs[k] && j >= 0) m.retirees.splice(j, 1);
          if (!actifs[k] && j < 0) m.retirees.push(k);
        });
        await enregistrerCatalogueSec(m);
      }
    } catch (e) { enCours = false; $('#fa-ok').disabled = false; return toast('Enregistrement impossible, réessayez', 'erreur'); }
    const n = Object.keys(prix).length + Object.keys(mins).length + Object.keys(actifs).length + Object.keys(ren).length;
    if (Object.keys(ren).length) await feed('ok', STATE.user.prenom + ' a renommé ' +
      Object.keys(ren).map(a => a + ' en ' + ren[a]).join(', ') + ' (' + r.nom + ')');
    if (n) await feed('ok', STATE.user.prenom + ' a mis à jour la fiche ' + r.nom);
    closeSheet();
    toast(n ? 'Fiche enregistrée' : 'Rien n’a changé');
    if (apres) apres();
  };
}

/* Lignes du catalogue de la chambre froide : chaque parfum de glace et chaque
   saveur des autres familles. cr = clé actif/retiré, cs = clé du minimum. */
function lignesCatalogueFroid() {
  const lignes = PARFUMS.slice().sort((a, b) => a.localeCompare(b)).map(p =>
    ({ grp: 'Glaces (bacs, toutes tailles)', nom: p, cr: 'glace|' + p, cs: 'glace|' + p }));
  FAMILLES_PRODUIT.filter(f => f.id !== 'glace' && f.lieu !== 'sec' && f.stock !== 'sec').forEach(f => {
    if (f.saveurs && f.saveurs.length) f.saveurs.forEach(sv =>
      lignes.push({ grp: f.libelle + ' (en ' + (f.unites || 'unités') + ')', nom: sv, cr: f.id + '|' + sv, cs: cleArticle(f.id, sv, '') }));
    else lignes.push({ grp: 'Autres (à l’unité)', nom: f.libelle + ' (en ' + (f.unites || 'unités') + ')', cr: f.id + '|', cs: cleArticle(f.id, '', '') });
  });
  return lignes;
}

/* -----------------------------------------------------------------------------
   VUE — CATALOGUE (manager)
   Deux onglets, comme le stock et l'inventaire : chambre froide et sec.
   Prix et minimums se modifient en ligne ; une barre « Enregistrer » apparaît
   dès la première saisie et enregistre tout d'un coup. Seul endroit où se
   règlent les stocks minimum.
   -------------------------------------------------------------------------- */
V.catalogue = async function () {
  if (!STATE.user || STATE.user.role !== 'manager') {
    $('#page').innerHTML = vide('', 'Réservé au manager.'); return;
  }
  const m = (await DB.get('catalogue:sec', null)) || { masques:[], modifs:{}, ajouts:[] };
  m.masques = m.masques || []; m.modifs = m.modifs || {}; m.ajouts = m.ajouts || [];
  let seuils;
  try { await chargerCatalogueSec(); await chargerCatalogueFroid(); seuils = await chargerSeuils(); }
  catch (e) { $('#page').innerHTML = vide('', 'Catalogue illisible, réessayez.'); return; }
  const cat = catalogueSec();
  const froid = lignesCatalogueFroid();
  const sections = (typeof SEC_SECTIONS !== 'undefined')
    ? SEC_SECTIONS.map(s => typeof s === 'string' ? { id:s } : s) : [];
  const UNITES = ['carton','ramette','pack','boîte','brique','flacon','pot','rouleau','sachet','unité'];
  const froidPrix = () => (FOURNISSEUR.taillesBac || TAILLES_BAC || []).map(t =>
      ({ cp: cleArticle('glace', '', t), nom: 'Bac de glace ' + t + ' L', unite: 'bac' }))
    .concat(FAMILLES_PRODUIT.filter(f => f.id !== 'glace' && f.lieu !== 'sec' && f.stock !== 'sec')
      .map(f => ({ cp: cleArticle(f.id, '', ''), nom: f.libelle, unite: f.unite })));

  /* Saisies pas encore enregistrées. Gardées dans STATE : elles survivent au
     changement d'onglet, à un retour sur la page et au rafraîchissement
     automatique de la vue. Annuler ou Enregistrer les vident. */
  const brouillon = STATE.catalogueBrouillon =
    STATE.catalogueBrouillon || { prix:{}, min:{}, actif:{} };
  const noms = {};
  const nbBrouillon = () => Object.keys(brouillon.prix).length +
    Object.keys(brouillon.min).length + Object.keys(brouillon.actif).length;
  /* Point décimal (2.5), comme la fiche : l'export le lit tel quel. */
  const prixInit = cp => { const p = corrige(cp) ? num(_prixAchat[cp]) : prixAchatDefaut(cp); return p > 0 ? String(p) : ''; };
  const minInit = k => num(seuils[k]) > 0 ? String(num(seuils[k])) : '';
  const actifInit = cr => !_froidRetires.has(cr);
  const val = (o, k, init) => o[k] !== undefined ? o[k] : init(k);
  const nrm = x => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const champPrix = (cp, nom) => { noms[cp] = nom;
    return '<input type="text" inputmode="decimal" data-px="' + esc(cp) + '" value="' + esc(val(brouillon.prix, cp, prixInit)) +
      '" placeholder="—" aria-label="Prix HT ' + esc(nom) + '">'; };
  const champMin = (k, nom) => { noms[k] = nom;
    return '<input type="text" inputmode="decimal" data-mn="' + esc(k) + '" value="' + esc(val(brouillon.min, k, minInit)) +
      '" placeholder="—" aria-label="Minimum ' + esc(nom) + '">'; };

  /* ---------- Chambre froide ---------- */
  const blocFroid = () => {
    const grps = [];
    froid.forEach(x => {
      let g = grps[grps.length - 1];
      if (!g || g.nom !== x.grp) grps.push(g = { nom: x.grp, l: [] });
      g.l.push(x);
    });
    return carte('<h2>Prix d’achat</h2><div class="cs">HT, par unité comptée à l’inventaire. ' +
        'Vide : l’article n’entre pas dans la valeur du stock.</div>' +
        '<div class="cat-liste">' + froidPrix().map(x =>
          '<div class="cat-ligne" data-q="' + esc(nrm(x.nom)) + '"><span class="cat-nom"><span>' + esc(x.nom) +
          '<small class="mini">€ par ' + esc(x.unite || 'unité') + '</small></span></span>' + champPrix(x.cp, x.nom) + '</div>').join('') +
        '</div>', 'solide') +
      '<p class="cs" style="margin-top:16px">Décochez ce que la boutique ne prend plus : il disparaît de l’inventaire, ' +
      'de la réception et des minimums, son stock reste. Minimum : arrivé à ce nombre, l’article est « à commander ».</p>' +
      grps.map(g => '<div class="cat-groupe">' +
        '<div class="entete cat-tete"><h3>' + esc(g.nom) + '</h3><span class="cat-col">Minimum</span></div>' +
        carte('<div class="cat-liste">' + g.l.map(x => {
          const a = val(brouillon.actif, x.cr, actifInit);
          return '<div class="cat-ligne' + (a ? '' : ' off') + '" data-q="' + esc(nrm(x.nom + ' ' + x.grp)) + '">' +
            '<label class="cat-nom"><input type="checkbox" data-act="' + esc(x.cr) + '"' + (a ? ' checked' : '') +
            '><span>' + esc(x.nom) + '</span></label>' + champMin(x.cs, x.nom) + '</div>';
        }).join('') + '</div>') + '</div>').join('');
  };

  /* ---------- Sec ---------- */
  const refSec = r => {
    const avecDecl = !!((r.variantesToutes && r.variantesToutes.length) || (r.variantes && r.variantes.length));
    const lignes = r.masque ? [] : (avecDecl ? (r.variantes || []) : ['']);
    const nbRet = (r.variantesRetirees || []).length;
    return '<div data-q="' + esc(nrm([r.nom, r.sec].concat(r.variantesToutes || r.variantes || []).join(' '))) + '">' + carte(
      '<div class="rang"><div style="flex:1;min-width:0">' +
      '<b' + (r.masque ? ' style="text-decoration:line-through;opacity:.5"' : '') + '>' + esc(r.nom) + '</b>' +
      '<div class="mini">' + esc(r.unite) + (r.decimal === false ? ' · entiers' : ' · demi possible') +
      (nbRet ? ' · ' + nbRet + ' ' + accord(nbRet, 'déclinaison retirée', 'déclinaisons retirées') : '') +
      (r.masque ? ' · retirée du catalogue' : '') + '</div></div>' +
      '<div class="duo compact">' +
      (avecDecl ? '<button class="btn clair" data-fiche="' + esc(r.id) + '" aria-label="Déclinaisons actives ou retirées" title="Déclinaisons actives ou retirées">☰</button>' : '') +
      '<button class="btn clair" data-edit="' + esc(r.id) + '" aria-label="Modifier" title="Nom, unité, déclinaisons">✎</button>' +
      '<button class="btn ' + (r.masque ? 'menthe' : 'clair') + '" data-masque="' + esc(r.id) + '" ' +
      'aria-label="' + (r.masque ? 'Réafficher' : 'Retirer du catalogue') + '" title="' + (r.masque ? 'Réafficher' : 'Retirer du catalogue') + '">' + (r.masque ? '↺' : '✕') + '</button>' +
      '</div></div>' +
      (lignes.length ? '<div class="cat-liste cat-sous">' +
        '<div class="cat-ligne cat-entetes"><span class="cat-nom">' + (avecDecl ? 'Déclinaison' : '') + '</span>' +
        '<span class="cat-col">€ HT / ' + esc(r.unite) + '</span><span class="cat-col">Minimum</span></div>' +
        lignes.map(v => {
          const cp = 'sec|' + r.id + '|' + v, nom = v ? r.nom + ' · ' + v : r.nom;
          return '<div class="cat-ligne"><span class="cat-nom"><span>' + esc(v || 'Prix et minimum') + '</span></span>' +
            champPrix(cp, nom) + champMin(cp, nom) + '</div>';
        }).join('') + '</div>' : ''),
      r.masque ? 'plat' : '') + '</div>';
  };
  const blocSec = () =>
    '<p class="cs">Ce que l’inventaire, la réception et le réassort proposent. ✎ change le nom, l’unité ou les ' +
    'déclinaisons, ☰ retire ou réactive une déclinaison, ✕ retire la référence (↺ la réaffiche). ' +
    'Vos réglages survivent aux mises à jour.</p>' +
    sections.map(s => {
      const refs = cat.filter(r => (r.sec || 'Autres') === s.id);
      if (!refs.length) return '';
      return '<div class="sec-bloc cat-groupe"' + (s.teinte ? ' style="--sec-teinte:' + s.teinte + '"' : '') + '>' +
        '<div class="entete sec-entete"><span class="sec-pastille"></span><h3>' + esc(s.id) + '</h3>' +
        '<button class="btn clair sm" data-ajout="' + esc(s.id) + '">+ Ajouter</button></div>' +
        '<div class="stack">' + refs.map(refSec).join('') + '</div></div>';
    }).join('');

  let partie = STATE.cataloguePartie === 'sec' ? 'sec' : 'froid';

  /* Une fiche ouverte relit le catalogue en rentrant : les saisies en cours
     seraient perdues sans prévenir. */
  const libre = () => {
    if (!nbBrouillon()) return true;
    toast('Enregistrez ou annulez d’abord vos changements', 'erreur');
    return false;
  };

  const majBarre = () => {
    const n = nbBrouillon();
    $('#ct-barre').hidden = !n;
    $('#ct-nb').textContent = n + ' ' + accord(n, 'changement non enregistré', 'changements non enregistrés');
  };
  /* « 2,5 » pour « 2.5 », « 0 » pour vide : même valeur, pas un changement. */
  const lireMin = t => { t = String(t).trim().replace(',', '.'); return t === '' ? 0 : Number(t); };
  const memeValeur = (lire, a, b) => { const x = lire(a), y = lire(b); return x === y || (isNaN(x) && isNaN(y) && a.trim() === b.trim()); };
  const noter = (o, k, v, init, lire) => {
    if (memeValeur(lire, v, init(k))) delete o[k]; else o[k] = v;
    majBarre();
  };

  const dessiner = () => {
    const nbParfums = parfumsActifs().length;
    const nbSec = cat.filter(r => !r.masque).length;
    $('#vue-actions').innerHTML = '';
    $('#page').innerHTML =
      '<div class="tseg">' +
      [['froid', 'Chambre froide', nbParfums + ' ' + accord(nbParfums, 'parfum actif', 'parfums actifs')],
       ['sec', 'Sec', nbSec + ' ' + accord(nbSec, 'référence')]]
        .map(x => '<button class="' + (x[0] === partie ? 'on' : '') + '" data-partie="' + x[0] + '">' +
          '<span class="tsl">' + x[1] + '</span><small>' + x[2] + '</small></button>').join('') +
      '</div>' +
      '<input type="search" id="ct-rech" placeholder="Chercher un produit" autocomplete="off" aria-label="Chercher un produit">' +
      '<div id="ct-corps">' + (partie === 'froid' ? blocFroid() : blocSec()) + '</div>' +
      '<div class="cat-barre" id="ct-barre" hidden><span id="ct-nb"></span>' +
      '<button class="btn clair sm" id="ct-annul">Annuler</button>' +
      '<button class="btn menthe sm" id="ct-enr">Enregistrer</button></div>';
    brancher();
    majBarre();
  };

  const brancher = () => {
    $$('[data-partie]').forEach(b => b.onclick = () => {
      partie = b.dataset.partie; STATE.cataloguePartie = partie; dessiner();
    });
    $$('[data-px]').forEach(i => i.oninput = () => noter(brouillon.prix, i.dataset.px, i.value, prixInit, lirePrix));
    $$('[data-mn]').forEach(i => i.oninput = () => noter(brouillon.min, i.dataset.mn, i.value, minInit, lireMin));
    $$('[data-act]').forEach(i => i.onchange = () => {
      const k = i.dataset.act;
      if (i.checked === actifInit(k)) delete brouillon.actif[k]; else brouillon.actif[k] = i.checked;
      i.closest('.cat-ligne').classList.toggle('off', !i.checked);
      majBarre();
    });
    $('#ct-rech').oninput = e => {
      const q = nrm(e.target.value.trim());
      $$('#ct-corps [data-q]').forEach(r => { r.style.display = !q || r.dataset.q.indexOf(q) >= 0 ? '' : 'none'; });
      $$('#ct-corps .cat-groupe, #ct-corps .card.solide').forEach(g => {
        g.style.display = !q || $$('[data-q]', g).some(r => r.style.display !== 'none') ? '' : 'none';
      });
    };
    $('#ct-annul').onclick = () => {
      brouillon.prix = {}; brouillon.min = {}; brouillon.actif = {};
      enCours = false;
      dessiner();
    };
    $('#ct-enr').onclick = enregistrer;

    $$('[data-masque]').forEach(b => b.onclick = () => { if (libre()) basculer(b.dataset.masque); });
    $$('[data-edit]').forEach(b => b.onclick = () => {
      if (libre()) editer(cat.filter(r => r.id === b.dataset.edit)[0]);
    });
    $$('[data-ajout]').forEach(b => b.onclick = () => { if (libre()) editer(null, b.dataset.ajout); });
    $$('[data-fiche]').forEach(b => b.onclick = () => {
      if (!libre()) return;
      const r = cat.filter(x => x.id === b.dataset.fiche)[0];
      if (r) ficheArticle(r, () => rendre('catalogue'));
    });
  };

  let enCours = false;
  const enregistrer = async () => {
    if (enCours) return;
    const prix = {}, mins = {};
    for (const cp of Object.keys(brouillon.prix)) {
      const v = lirePrix(brouillon.prix[cp]);
      if (isNaN(v)) return toast('Prix illisible : ' + noms[cp], 'erreur');
      const d = prixAchatDefaut(cp);
      const avant = corrige(cp) ? num(_prixAchat[cp]) : (d || 0);
      /* Égal au prix du fichier : pas de correction à garder. */
      if (v !== avant) prix[cp] = (d !== null && v === d) || (d === null && v === 0) ? null : v;
    }
    for (const k of Object.keys(brouillon.min)) {
      const mv = lireMin(brouillon.min[k]);
      if (!(mv >= 0) || !isFinite(mv)) return toast('Minimum invalide : ' + noms[k], 'erreur');
      if (mv !== (num(seuils[k]) > 0 ? num(seuils[k]) : 0)) mins[k] = mv;
    }
    const actifs = Object.assign({}, brouillon.actif);
    if (Object.keys(actifs).length && !PARFUMS.some(p => val(actifs, 'glace|' + p, actifInit))) {
      return toast('Gardez au moins un parfum de glace actif', 'erreur');
    }
    enCours = true; $('#ct-enr').disabled = true;
    try {
      if (Object.keys(actifs).length) {
        /* Relu juste avant : un autre manager garde ses réglages. */
        const mf = (await DB.get('catalogue:froid', null)) || {};
        const ret = new Set(Array.isArray(mf.retires) ? mf.retires : []);
        Object.keys(actifs).forEach(k => { if (actifs[k]) ret.delete(k); else ret.add(k); });
        mf.retires = [...ret];
        await DB.set('catalogue:froid', mf);
        _froidRetires = ret;
        brouillon.actif = {};
      }
      if (Object.keys(mins).length) {
        const frais = await chargerSeuils();
        Object.keys(mins).forEach(k => { if (mins[k] > 0) frais[k] = mins[k]; else delete frais[k]; });
        await DB.set(CLE_SEUILS, frais);
        seuils = frais;
        brouillon.min = {};
      }
      if (Object.keys(prix).length) await enregistrerPrixAchat(prix);
      brouillon.prix = {};
    } catch (e) {
      /* Écritures séparées : ce qui est passé sort du brouillon, le reste attend. */
      enCours = false;
      dessiner();
      return toast('Enregistrement incomplet, réessayez', 'erreur');
    }
    const n = Object.keys(actifs).length + Object.keys(mins).length + Object.keys(prix).length;
    if (n) {
      try {
        await feed('ok', STATE.user.prenom + ' a mis à jour le catalogue (' +
          [Object.keys(prix).length ? 'prix' : '', Object.keys(mins).length ? 'minimums' : '',
           Object.keys(actifs).length ? 'produits actifs' : ''].filter(Boolean).join(', ') + ')');
      } catch (e) { /* le journal n'empêche pas l'enregistrement */ }
    }
    toast(n ? 'Catalogue enregistré' : 'Rien n’a changé');
    rendre('catalogue');
  };

  /* ✕ retire la référence (après confirmation), ↺ la réaffiche. */
  const basculer = async id => {
    const i = m.masques.indexOf(id);
    const r = cat.filter(x => x.id === id)[0];
    /* Retirer demande confirmation : le bouton est petit et sans texte. */
    if (r && !r.masque) {
      const ok = await new Promise(res => {
        showSheet('<h2 id="sheet-titre">Retirer ' + esc(r.nom) + ' ?</h2>' +
          '<p class="cs">La référence disparaît de l’inventaire, de la réception et du réassort. ' +
          'Son stock et ses prix sont gardés. Vous pourrez la réafficher avec ↺.</p>' +
          '<div class="actions"><button class="btn clair" id="rt-non">Annuler</button>' +
          '<button class="btn corail" id="rt-oui">Retirer</button></div>');
        $('#rt-non').onclick = () => { closeSheet(); res(false); };
        $('#rt-oui').onclick = () => { closeSheet(); res(true); };
      });
      if (!ok) return;
    }
    /* Toutes ses déclinaisons retirées (✎ ou deux fiches en même temps) :
       ↺ les réactive, sinon la référence resterait cachée. */
    const toutRetire = r && r.masque && r.variantesToutes && r.variantesRetirees &&
      r.variantesRetirees.length >= r.variantesToutes.length;
    if (toutRetire && Array.isArray(m.retirees)) m.retirees = m.retirees.filter(k => k.split('|')[1] !== id);
    if (i >= 0) m.masques.splice(i, 1); else if (!toutRetire) m.masques.push(id);
    const reaffiche = i >= 0 || toutRetire;
    await enregistrerCatalogueSec(m);
    await feed('ok', STATE.user.prenom + (reaffiche ? ' a réaffiché ' : ' a retiré ') + id + ' du catalogue');
    rendre('catalogue');
  };

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
      /* Toutes les déclinaisons, retirées comprises : sinon les enregistrer ici
         effaçait celles que la fiche avait seulement retirées. */
      esc((r.variantesToutes || r.variantes || []).join('\n')) + '</textarea></div>' +
      '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
      '<button class="btn menthe" id="ct-ok">Enregistrer</button></div>');

    let unite = r.unite, decimal = r.decimal !== false;
    $$('[data-u]').forEach(b => b.onclick = () => {
      unite = b.dataset.u; $$('[data-u]').forEach(x => x.classList.toggle('on', x === b)); });
    $$('[data-dec]').forEach(b => b.onclick = () => {
      decimal = b.dataset.dec === '1'; $$('[data-dec]').forEach(x => x.classList.toggle('on', x === b)); });

    let enCours = false;
    $('#ct-ok').onclick = async () => {
      /* Double appui : la référence était créée deux fois. */
      if (enCours) return;
      const nom = $('#ct-nom').value.trim();
      if (!nom) return toast('Le nom est obligatoire', 'erreur');
      enCours = true; $('#ct-ok').disabled = true;
      const variantes = $('#ct-var').value.split('\n').map(s => s.trim()).filter(Boolean);
      const errN = variantes.length ? erreurNomsDeclinaisons(variantes) : '';
      if (errN) { enCours = false; $('#ct-ok').disabled = false; return toast(errN, 'erreur'); }
      if (!neuf) {
        const avant = r.variantesToutes || r.variantes || [];
        /* Même nombre de lignes : une ligne changée est un renommage, son
           stock, son prix et son minimum la suivent. */
        /* Mêmes noms dans un autre ordre : simple réordonnancement. */
        const memes = avant.slice().sort().join('\n') === variantes.slice().sort().join('\n');
        if (avant.length && avant.length === variantes.length && !memes) {
          const ren = {};
          avant.forEach((v, i) => { if (variantes[i] !== v) ren[v] = variantes[i]; });
          const errR = erreurRenommage(r, ren);
          if (errR) { enCours = false; $('#ct-ok').disabled = false; return toast(errR, 'erreur'); }
          if (Object.keys(ren).length) {
            try {
              await renommerDeclinaisonsSec(r, ren);
              const m2 = (await DB.get('catalogue:sec', null)) || {};
              Object.assign(m, m2);
              m.masques = m.masques || []; m.modifs = m.modifs || {}; m.ajouts = m.ajouts || [];
            } catch (e) { enCours = false; $('#ct-ok').disabled = false; return toast('Renommage impossible, réessayez', 'erreur'); }
          }
        } else {
          /* Une déclinaison effacée qui a encore du stock le perdrait. */
          const enStock = (await stockSecAttendu(await DB.get('stock:sec', null))).lignes;
          const perdues = avant.filter(v => variantes.indexOf(v) < 0 && num(enStock['sec|' + r.id + '|' + v]) > 0);
          if (perdues.length) {
            enCours = false; $('#ct-ok').disabled = false;
            return toast(perdues.join(', ') + ' a encore du stock : retirez-la avec ☰ (décocher) ou renommez-la', 'erreur');
          }
        }
      }
      if (neuf) {
        const id = idCatalogueSec(nom);
        m.ajouts.push({ id, sec:section, nom, unite, decimal, variantes });
      } else {
        m.modifs[r.id] = { nom, unite, decimal, variantes };
        /* Une déclinaison effacée ou renommée ne reste pas « retirée » :
           une future déclinaison du même nom serait cachée sans raison. */
        if (Array.isArray(m.retirees)) m.retirees = m.retirees.filter(k => {
          const p = k.split('|');
          return p[1] !== r.id || variantes.indexOf(p[2]) >= 0;
        });
      }
      try { await enregistrerCatalogueSec(m); }
      catch (e) { enCours = false; $('#ct-ok').disabled = false; return toast('Enregistrement impossible, réessayez', 'erreur'); }
      await feed('ok', STATE.user.prenom + (neuf ? ' a ajouté ' : ' a modifié ') + nom + ' au catalogue');
      closeSheet();
      rendre('catalogue');
    };
  };

  dessiner();
};

/* Quantité du sec à revoir avant de valider : l'unité est souvent un carton
   (« Wafer al Gianduja : 4 » = 48 boîtes). Signalée quand elle fait plus du
   double du dernier comptage et au moins 2 de plus, ou, sans comptage
   précédent, quand elle vaut 100 € HT ou plus. Renvoie le texte, ou ''.
   Le comptage de l'équipier reste à l'aveugle : ni le chiffre précédent ni
   le prix ne lui sont montrés (manager = false). */
function secDouteux(c, q, prec, manager) {
  q = num(q);
  if (!(q > 0)) return '';
  const n = v => Number.isInteger(num(v)) ? String(num(v)) : n1(v);
  const r = catalogueSec().filter(x => typeof x === 'object' && x.id === String(c).split('|')[1])[0];
  const u = r && r.unite ? ' ' + accord(q, r.unite) : '';
  const p = prixLigne(c, null);
  const connu = prec !== undefined && prec !== null && prec !== '';
  const douteux = connu ? (q > 2 * num(prec) && q >= num(prec) + 2) : (p !== null && q * p >= 100);
  if (!douteux) return '';
  if (!manager) return n(q) + u + ', vérifiez l’unité';
  return n(q) + u + (p !== null ? ' (' + eur(q * p) + ' HT)' : '') +
    (connu ? ', contre ' + n(prec) + ' la dernière fois' : ', jamais compté avant');
}

/* Fiche d'un produit du sec : ce qu'on voit sur l'étagère. */
function ficheProduit(c) {
  const f = (typeof INFO_PRODUITS !== 'undefined') && INFO_PRODUITS[c];
  if (!f) return;
  showSheet('<h2 id="sheet-titre">' + esc(libelleSec(c)) + '</h2>' +
    (f.photo ? '<img src="' + esc(f.photo) + '" alt="' + esc(f.etiquette || '') + '" loading="lazy" ' +
      'style="display:block;width:100%;max-height:52vh;object-fit:contain;border-radius:12px;margin-top:10px;background:#eee">' : '') +
    '<div class="stack" style="margin-top:12px">' +
    (f.etiquette ? '<p><b>Sur l’étiquette :</b> ' + esc(f.etiquette) + '</p>' : '') +
    (f.code ? '<p><b>Code Amorino :</b> ' + esc(f.code) + '</p>' : '') +
    (f.compter ? '<p><b>Comment compter :</b> ' + esc(f.compter) + '</p>' : '') +
    (typeof contenuSec === 'function' && contenuSec(c) ? '<p><b>Contenu :</b> ' + esc(contenuSec(c)) + '</p>' : '') +
    '</div><div class="actions"><button class="btn clair" data-fermer>Fermer</button></div>');
}

/* Un inventaire passé, en entier : TOUS les produits du catalogue, comptés
   ou non. Un produit absent de la saisie s'affiche à 0, en grisé — l'écran
   ne montrait que les totaux, impossible de retrouver ce qui avait été
   compté pour un parfum donné. */
function voirInventaire(h, partie) {
  const l = h.lignes || {};
  const ecarts = h.ecarts || {};
  const groupes = [];          // [{ titre, lignes:[{ nom, q, saisi, ecart, unite }] }]
  const nb = v => Number.isInteger(num(v)) ? String(num(v)) : n1(v);
  const vus = new Set();
  const estManager = !!(STATE.user && STATE.user.role === 'manager');
  const ligne = (cle, nom, unite) => {
    vus.add(cle);
    const q = num(l[cle] || 0), p = prixLigne(cle, h.prix);
    return { nom: nom, q: q, saisi: l[cle] !== undefined,
             ecart: ecarts[cle] || 0, unite: unite || '', prix: p,
             val: (p !== null && q > 0) ? q * p : 0 };
  };

  if (partie === 'froid') {
    const tailles = (FOURNISSEUR.taillesCourantes || TAILLES_BAC || []).map(String);
    /* Les tailles réellement comptées s'ajoutent aux tailles courantes : un
       7 L saisi ce jour-là doit apparaître. */
    const cles = Object.keys(l).concat(Object.keys(ecarts).filter(c => l[c] === undefined));
    cles.forEach(c => {
      const a = litArticle(c);
      if (a.famille === 'glace' && a.taille && tailles.indexOf(a.taille) < 0) tailles.push(a.taille);
    });
    tailles.sort((x, y) => num(x) - num(y));
    /* Une ligne par parfum, tailles côte à côte, comme à la saisie. */
    groupes.push({ titre: 'Glaces', lignes: PARFUMS.map(p => {
      const parT = tailles.map(t => ligne(cleArticle('glace', p, t), '', ''));
      parT.forEach((x, k) => { x.nom = p + ' ' + tailles[k] + ' L'; x.unite = 'bac'; });
      return { nom: p, saisi: parT.some(x => x.saisi), det: parT,
               ecart: parT.reduce((s2, x) => s2 + num(x.ecart), 0),
               val: parT.reduce((s2, x) => s2 + x.val, 0),
               texte: tailles.map((t, k) => t + ' L : ' + nb(parT[k].q)).join(' · ') };
    }) });
    /* Les autres familles comptées en chambre froide (macarons, gaufres…),
       saveur par saveur, comptées ou non. */
    FAMILLES_PRODUIT.filter(f => f.id !== 'glace' && f.lieu !== 'sec' && f.stock !== 'sec')
      .sort((x, y) => (y.id === 'cremini') - (x.id === 'cremini'))   // Cremini avec les glaces
      .forEach(f => groupes.push({ titre: f.libelle, lignes: (f.saveurs && f.saveurs.length ? f.saveurs : [''])
        .map(sv => ligne(cleArticle(f.id, sv, ''), sv || f.libelle, f.unite)) }));
    const autres = {};
    cles.filter(c => !vus.has(c)).sort().forEach(c => {
      const f = FAMILLES_PRODUIT.filter(x => x.id === litArticle(c).famille)[0];
      if (f && (f.lieu === 'sec' || f.stock === 'sec')) return;   // écarts d'anciens inventaires
      const t = f ? f.libelle + ' (hors catalogue)' : 'Autres';
      (autres[t] = autres[t] || []).push(ligne(c, litArticle(c).parfum || (f ? f.libelle : c),
        f ? f.unite : ''));
    });
    Object.keys(autres).forEach(t => groupes.push({ titre: t, lignes: autres[t] }));
  } else {
    const parSection = {};
    /* Une référence masquée ne se compte plus : elle n'apparaît que si elle
       a été saisie ce jour-là (rubrique « Retirées du catalogue »). */
    catalogueSec().filter(r => !r.masque).forEach(r => {
      const sec = r.sec || 'Autres';
      const lst = parSection[sec] = parSection[sec] || [];
      (r.variantes && r.variantes.length ? r.variantes : ['']).forEach(v =>
        lst.push(ligne('sec|' + r.id + '|' + v, r.nom + (v ? ' · ' + v : ''), r.unite)));
    });
    /* Références retirées du catalogue depuis : on les montre quand même. */
    const retirees = Object.keys(l).filter(c => !vus.has(c)).sort()
      .map(c => ligne(c, c.split('|').slice(1).filter(Boolean).join(' · '), ''));
    /* Même ordre de sections qu'à la saisie. */
    const ordre = (typeof SEC_SECTIONS !== 'undefined')
      ? SEC_SECTIONS.map(x => typeof x === 'string' ? x : x.id) : [];
    Object.keys(parSection)
      .sort((x, y) => (ordre.indexOf(x) < 0 ? 999 : ordre.indexOf(x)) - (ordre.indexOf(y) < 0 ? 999 : ordre.indexOf(y)))
      .forEach(t => groupes.push({ titre: t, lignes: parSection[t] }));
    if (retirees.length) groupes.push({ titre: 'Retirées du catalogue', lignes: retirees });
  }

  const nbSaisis = Object.keys(l).length;
  const v0 = estManager ? valeurStock(l, h.prix) : null;
  const valeur = v0 && (v0.total > 0 || v0.sansPrix) ? v0 : null;
  groupes.forEach(g => { g.val = g.lignes.reduce((s2, x) => s2 + num(x.val), 0); });
  showSheet(
    '<h2 id="sheet-titre">Inventaire ' + (partie === 'froid' ? 'chambre froide' : 'sec') +
    ' du ' + esc(fmtD(h.jour)) + '</h2>' +
    '<p class="cs">' + esc(h.par || '—') + (h.at ? ' · ' + heure(h.at) : '') + ' · ' +
    nbSaisis + ' ' + accord(nbSaisis, 'produit saisi', 'produits saisis') + '. Les produits non saisis sont à 0, en grisé.</p>' +
    (h.note ? '<div class="rappel" style="margin-top:10px">' + esc(h.note) + '</div>' : '') +
    (valeur ? '<div class="rappel" style="margin-top:10px"><b>Valeur du stock : ' + eur(valeur.total) + ' HT</b>' +
      (valeur.sansPrix ? '<br><span class="mini">' + valeur.sansPrix + ' ' +
        accord(valeur.sansPrix, 'produit compté', 'produits comptés') + ' sans prix, hors total. ' +
        'Prix à compléter dans le catalogue.</span>' : '') + '</div>' : '') +
    groupes.filter(g => g.lignes.length).map(g =>
      '<div class="entete" style="margin-top:16px"><h3>' + esc(g.titre) + '</h3>' +
      (estManager && g.val > 0 ? '<span class="mini">' + eur(g.val) + '</span>' : '') + '</div>' +
      '<div class="stack">' + g.lignes.map(x =>
        '<div class="invl"' + (x.saisi ? '' : ' style="opacity:.45"') + '>' +
        '<span class="invn">' + esc(x.nom) +
        (x.ecart ? '<small>écart ' + (x.ecart > 0 ? '+' : '') + n1(x.ecart) + '</small>' : '') + '</span>' +
        '<span class="invc">' + (x.texte !== undefined ? esc(x.texte)
          : nb(x.q) + (x.unite ? ' ' + esc(accord(x.q, x.unite)) : '')) +
        (estManager && x.val > 0 ? '<br>' + eur(x.val) : '') + '</span></div>').join('') +
      '</div>').join('') +
    '<div class="actions">' +
    (estManager ? '<button class="btn clair" id="inv-csv">Exporter pour le comptable</button>' : '') +
    '<button class="btn clair" data-fermer>Fermer</button></div>');

  /* Le comptable veut le détail par parfum et les totaux : un fichier
     tableur, une ligne par produit compté, prix et valeur HT figés au
     comptage, puis le total de chaque groupe et le total général. */
  const bCsv = $('#inv-csv');
  if (bCsv) bCsv.onclick = () => {
    /* Nombres : point décimal et sans guillemets, comme demandé par la
       boutique (son tableur les lit ainsi comme des nombres). Un tableur
       réglé en français attendrait une virgule. */
    const q = x => { if (typeof x === 'number') return isFinite(x) ? String(x) : '';
                     x = String(x == null ? '' : x);
                     if (/^[=+\-@\t\r]/.test(x)) x = "'" + x;
                     return '"' + x.replace(/"/g, '""') + '"'; };
    const dec = v => Math.round(num(v) * 100) / 100;
    const rows = [['Groupe', 'Produit', 'Quantité', 'Unité', 'Prix HT', 'Valeur HT']];
    let total = 0;
    groupes.filter(g => g.lignes.length).forEach(g => {
      let tg = 0;
      g.lignes.forEach(x => (x.det || [x]).forEach(y => {
        if (!(num(y.q) > 0)) return;
        rows.push([g.titre, y.nom, Math.round(num(y.q) * 1000) / 1000, y.unite ? accord(y.q, y.unite) : '',
                   y.prix !== null && y.prix !== undefined ? dec(y.prix) : 'sans prix', dec(y.val)]);
        tg += num(y.val);
      }));
      if (tg > 0) rows.push([g.titre, 'Total ' + g.titre, '', '', '', dec(tg)]);
      total += tg;
    });
    /* Même total que « Valeur du stock » à l'écran : un produit d'un ancien
       catalogue, compté mais absent des groupes, va sur une ligne à part. */
    const vt = valeurStock(l, h.prix).total;
    if (Math.abs(vt - total) >= 0.005) rows.push(['Autres', 'Produits hors catalogue', '', '', '', dec(vt - total)]);
    rows.push(['', 'TOTAL ' + (partie === 'froid' ? 'CHAMBRE FROIDE' : 'SEC'), '', '', '', dec(vt)]);
    const csv = rows.map(r => r.map(q).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'inventaire-' + (partie === 'froid' ? 'chambre-froide' : 'sec') + '-' + h.jour + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Fichier téléchargé');
  };
}

/* Valeur totale du stock (manager) : dernier inventaire confirmé de la
   chambre froide + dernier du sec, chacun à ses prix du jour. Montrée sur
   l'écran Inventaire et sur la tour de contrôle (sans aller la générer).
   « bouton » ajoute un lien vers l'inventaire et son export. '' sans valeur. */
function carteValeurStock(precedent, secPrec, bouton) {
  const vf = precedent ? valeurStock(precedent.lignes, precedent.prix) : { total: 0, sansPrix: 0 };
  const vs = secPrec ? valeurStock(secPrec.lignes, secPrec.prix) : { total: 0, sansPrix: 0 };
  if (!(vf.total + vs.total > 0)) return '';
  const sp = vf.sansPrix + vs.sansPrix;
  return carte('<div class="ch"><h2>Valeur du stock actuel</h2></div>' +
    '<div class="kpi" style="margin-top:6px"><div class="v">' + eur(vf.total + vs.total) + ' HT</div></div>' +
    '<div class="mini">Chambre froide ' + eur(vf.total) + (precedent ? ' (' + esc(fmtDC(precedent.jour)) + ')' : '') +
    ' · Sec ' + eur(vs.total) + (secPrec ? ' (' + esc(fmtDC(secPrec.jour)) + ')' : '') +
    (sp ? ' · ' + sp + ' ' + accord(sp, 'produit compté', 'produits comptés') + ' sans prix' : '') +
    '</div>' +
    (bouton ? '<button class="btn clair sm" style="margin-top:10px" data-valstock>Détail et export</button>' : ''),
    'solide');
}

V.inventaire = async function () {
  await chargerCatalogueSec();
  const { articles } = await stockReel();
  const precedent = await DB.get('stock:inventaire', null);
  const secPrec   = await DB.get('stock:sec', null);
  /* Attendu du sec : dernier comptage + livraisons confirmées depuis. Sert à
     repérer une quantité douteuse et à garder le stock d'une référence non
     recomptée (réceptions comprises). */
  const secAttendu = (await stockSecAttendu(secPrec).catch(() => null)) ||
    { lignes: Object.assign({}, (secPrec && secPrec.lignes) || {}), recus: {} };
  const historique = await DB.get('stock:inventaires', []);
  /* L'historique du sec, séparé : les deux comptages ne se font pas le même
     jour ni par la même personne, et on doit pouvoir voir l'un sans l'autre. */
  const historiqueSec = await DB.get('stock:secs', []);
  /* Comptages qui attendent la confirmation d'un manager. */
  const attente = await inventaireEnAttente('froid');
  const attenteSec = await inventaireEnAttente('sec');
  const resumes = { froid: await resumeAttente(attente, 'froid', articles), sec: await resumeAttente(attenteSec, 'sec') };
  const estManager = !!(STATE.user && STATE.user.role === 'manager');
  /* Les bacs de l'armoire −13 sont encore au stock : l'inventaire de la
     chambre froide doit les compter aussi, sinon ils sortent deux fois
     (au comptage, puis à leur mise en vitrine). */
  const nbArmoire = (await bacsArmoire().catch(() => [])).length;

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
  /* Un comptage du jour encore à confirmer passe devant le dernier confirmé :
     c'est lui qu'on relit et qu'on corrige. */
  const attenteDuJour = !!(attente && attente.jour === today());
  const dejaFaitAujourdhui = attenteDuJour || !!(precedent && precedent.jour === today());
  if (dejaFaitAujourdhui) {
    const lj = (attenteDuJour ? attente : precedent).lignes || {};
    /* Une ligne retirée (reportée, sans champ à l'écran) gonflerait les totaux. */
    Object.keys(lj).forEach(c => { const x = litArticle(c); if (froidActif(x.famille, x.parfum)) saisie[c] = lj[c]; });
  }
  const attenteSecDuJour = !!(attenteSec && attenteSec.jour === today());
  const secDejaFait = attenteSecDuJour || !!(secPrec && secPrec.jour === today());
  if (secDejaFait) {
    const src = attenteSecDuJour ? attenteSec : secPrec;
    const ls0 = src.lignes || {};
    /* Inventaire confirmé : ses lignes comprennent aussi ce qui a été reporté
       sans être compté. Seules les lignes comptées reviennent à l'écran. */
    const ls = {};
    Object.keys(ls0).forEach(c => { if (!Array.isArray(src.comptees) || src.comptees.indexOf(c) >= 0) ls[c] = ls0[c]; });
    /* Déclinaison retirée ou référence masquée : reportée à la confirmation,
       pas recopiée comme « comptée » (elle écraserait ses réceptions). */
    const proposees = clesSecConnues();
    Object.keys(ls).forEach(c => { if (proposees.has(c)) saisieSec[c] = ls[c]; });
  }

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
  /* Valider une partie n'efface que SA part du brouillon commun. Valider la
     chambre froide effaçait tout : la saisie du sec en cours, pas encore
     validée, était perdue (et inversement). */
  const oublierBrouillon = quoi => {
    try {
      const b = JSON.parse(localStorage.getItem(CLE_BROUILLON) || 'null');
      if (b && b.jour === today()) {
        if (quoi === 'froid') b.lignes = {}; else b.sec = {};
        if (Object.keys(b.lignes || {}).length || Object.keys(b.sec || {}).length) {
          localStorage.setItem(CLE_BROUILLON, JSON.stringify(b));
          return;
        }
      }
      localStorage.removeItem(CLE_BROUILLON);
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
  const PARFUMS_INV = parfumsActifs();
  let montrerRares = RARES.some(t =>
    PARFUMS_INV.some(p => num(articles[cleArticle('glace', p, t)]) !== 0 ||
                      saisie[cleArticle('glace', p, t)] !== undefined));

  /* Les familles comptées en chambre froide : tout sauf les glaces (qui ont
     leur bloc) et ce qui vit au sec — coulis, toppings, chantilly. Ceux-là
     apparaissaient ici en double, avec l'inventaire du sec. */
  const autres = FAMILLES_PRODUIT.filter(f => f.id !== 'glace' && f.lieu !== 'sec' && familleFroidActive(f));

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

  /* Glaces, macarons et gianduiotti se replient comme les déclinaisons du
     sec : un bouton par famille, qui dit ce qui est déjà compté, et la liste
     des parfums ou saveurs seulement quand on l'ouvre. On compte une famille
     à la fois au lieu de faire défiler soixante champs. */
  const enteteFamille = (id, nom, cles, nbDecl, unites, mot) => {
    const saisies = cles.filter(c => saisie[c] !== undefined);
    const total = saisies.reduce((s, c) => s + num(saisie[c]), 0);
    return '<button type="button" class="invp-h depliable" data-deplier="' + esc(id) + '"' +
      ' aria-expanded="' + (deplies[id] ? 'true' : 'false') + '"' +
      (deplies[id] ? '' : ' style="margin-bottom:0"') + '>' +
      '<b>' + esc(nom) + '</b>' +
      '<span class="invc">' + (saisies.length
        ? total + ' ' + esc(unites) + ' · ' + saisies.length + ' ' + accord(saisies.length, 'saisie')
        : nbDecl + ' ' + (mot || 'déclinaisons') + ' · en ' + esc(unites)) + '</span>' +
      '<span class="chev">' + (deplies[id] ? '−' : '+') + '</span></button>';
  };

  /* --- Chambre froide : une ligne par parfum, tailles côte à côte --------- */
  const rendFamille = f => {
    /* Les familles à saveurs se comptent saveur par saveur : un coulis
       pistache et un coulis caramel ne se remplacent pas l'un l'autre,
       et « Coulis : 4 » ne disait pas lequel manquait. */
    if (f.saveurs) {
    const fid = 'f:' + f.id;
    const svs = saveursActives(f);
    return '<div class="invp">' +
      enteteFamille(fid, f.libelle, svs.map(sv => cleArticle(f.id, sv, '')),
        svs.length, f.unites) +
      (!deplies[fid] ? '' :
      '<div class="stack" style="margin-top:8px">' + svs.map(sv => {
              const c = cleArticle(f.id, sv, '');
              const q = num(articles[c]);
              return '<div class="invl">' +
                '<span class="invn">' + esc(sv) + '</span>' +
                (q ? '<span class="invc">' + q + '</span>' : '') +
                '<input type="number" inputmode="numeric" min="0" step="1" data-inv="' + esc(c) + '" ' +
                'aria-label="' + esc(f.libelle + ', ' + sv) + '" ' +
                'value="' + (saisie[c] !== undefined ? esc(saisie[c]) : '') + '" placeholder="0"></div>';
            }).join('') + '</div>') + '</div>';
        }
        const c = cleArticle(f.id, '', '');
        const q = num(articles[c]);
        return '<div class="invl">' +
          '<span class="invn">' + esc(f.libelle) +
          '<small>en ' + esc(f.unites) + '</small></span>' +
          (q ? '<span class="invc">' + q + ' en stock</span>' : '') +
          '<input type="number" inputmode="numeric" min="0" step="1" data-inv="' + esc(c) + '" ' +
          'aria-label="' + esc(f.libelle + ' (en ' + f.unites + ')') + '" ' +
          'value="' + (saisie[c] !== undefined ? esc(saisie[c]) : '') + '" placeholder="0"></div>';
  };

  const blocFroid = () =>
    '<div class="invp" style="margin-top:14px">' +
    enteteFamille('f:glace', 'Glaces',
      Object.keys(saisie).filter(c => litArticle(c).famille === 'glace'), PARFUMS_INV.length, 'bacs', 'parfums') +
    (!deplies['f:glace'] ? '' :
    '<div class="entete" style="margin-top:8px"><button class="btn clair sm pousse" id="inv-rares">' +
    (montrerRares ? 'Masquer le 7 L' : '+ 7 L') + '</button></div>' +
    '<div class="stack">' + PARFUMS_INV.map(p => {
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
            '<input type="number" inputmode="numeric" min="0" step="1" data-inv="' + esc(c) + '" ' +
            'aria-label="' + esc(p + ', bacs de ' + t + ' L') + '" ' +
            'value="' + (saisie[c] !== undefined ? esc(saisie[c]) : '') + '" placeholder="0"></label>';
        }).join('') + '</div></div>';
    }).join('') + '</div>') + '</div>' +

    /* Cremini : bacs de glace de 2,15 L, comptés avec les glaces. */
    autres.filter(f => f.id === 'cremini').map(f => '<div class="stack" style="margin-top:8px">' + rendFamille(f) + '</div>').join('') +
    '<div class="entete"><h3>Autres familles</h3>' +
    '<span class="pousse mini">comptées à l’unité</span></div>' +
    '<div class="stack">' + autres.filter(f => f.id !== 'cremini').map(rendFamille).join('') + '</div>';

  /* --- Sec : par section, unité visible, décimales où ça a du sens ---------
     Le manager l'a dit : « comme ça, les personnes voient avant de taper ».
     L'unité est dans le champ lui-même. Et le pas est 0,5 quand la référence
     l'autorise : deux cartons pleins et un à moitié, ça se tape 2,5. Zéro
     veut dire « à commander », 0,5 veut dire « je réfléchis ». */
  let deplies = {};
  /* Recherche dans le sec : nom du catalogue, déclinaison, nom de
     l'étiquette ou code Amorino (« wafer », « nocciolata », « CIALDI »). */
  let recherche = '';
  let minuterieRech = null;
  const nrmR = x => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const texteRech = c => {
    const f = (typeof INFO_PRODUITS !== 'undefined' && INFO_PRODUITS[c]) || {};
    return nrmR([f.etiquette, f.code].join(' '));
  };
  /* La note survit au redessin : ouvrir une famille redessine l'écran. */
  let note = '';
  const cleSec = (r, v) => 'sec|' + r.id + '|' + (v || '');
  const contenuLigne = c => {
    const t = typeof contenuSec === 'function' ? contenuSec(c) : '';
    return t ? '<small>' + esc(t) + '</small>' : '';
  };
  /* « ? » : fiche produit (photo, nom de l'étiquette, code, comment compter). */
  const infoSec = (c, nom) => (typeof INFO_PRODUITS !== 'undefined' && INFO_PRODUITS[c])
    ? '<button type="button" class="info-p" data-info="' + esc(c) + '" aria-label="' +
      esc('Comment reconnaître ' + nom) + '">?</button>' : '';

  /* nom : ce qu'un lecteur d'écran annonce, la ligne n'ayant pas d'étiquette. */
  const champSec = (r, c, nom) => {
    const pas = r.decimal === false ? '1' : '0.5';
    const mode = r.decimal === false ? 'numeric' : 'decimal';
    return '<div class="saisie-u">' +
      '<input type="number" inputmode="' + mode + '" min="0" step="' + pas + '" ' +
      'aria-label="' + esc(nom + ' (' + r.unite + ')') + '" ' +
      'data-sec="' + esc(c) + '" value="' + (saisieSec[c] !== undefined ? esc(saisieSec[c]) : '') + '" ' +
      'placeholder="0">' +
      '<span class="su">' + esc(r.unite) + '</span></div>';
  };

  const blocSec = () => {
    const anc = secPrec && secPrec.lignes ? secPrec.lignes : {};
    /* Le catalogue effectif : celui du manager s'il l'a modifié, sinon celui
       d'usine. Le manager peut retirer une référence, en ajouter, changer une
       unité ou une déclinaison depuis le Back-office, sans passer par le code. */
    const catalogue = catalogueSec();
    const sections = (typeof SEC_SECTIONS !== 'undefined')
      ? SEC_SECTIONS.map(s => typeof s === 'string' ? { id:s } : s)
      : [...new Set(catalogue.map(r => r.sec || 'Autres'))].map(s => ({ id:s }));

    const mots = nrmR(recherche).split(/\s+/).filter(Boolean);
    return sections.map(section => {
      /* Déclinaisons qui répondent à la recherche : chaque mot tapé doit se
         trouver dans le nom, la déclinaison, l'étiquette ou le
         code (« pot grand », « nocciolata 5 kg »). */
      const varsVues = r => {
        const vs = r.variantes && r.variantes.length ? r.variantes : [''];
        if (!mots.length) return vs;
        return vs.filter(v => {
          const t = nrmR(r.nom + ' ' + v) + ' ' + texteRech(cleSec(r, v));
          return mots.every(m => t.includes(m));
        });
      };
      const vuesDe = new Map();
      const refs = catalogue.filter(r => {
        if (typeof r !== 'object' || (r.sec || 'Autres') !== section.id || r.masque) return false;
        const vs = varsVues(r);
        vuesDe.set(r, vs);
        return vs.length > 0;
      });
      if (!refs.length) return '';
      const nb = refs.reduce((n, r) => n + vuesDe.get(r).length, 0);
      const teinte = section.teinte ? ' style="--sec-teinte:' + section.teinte + '"' : '';

      return '<div class="sec-bloc"' + teinte + '>' +
        '<div class="entete sec-entete"><span class="sec-pastille"></span>' +
        '<h3>' + esc(section.id) + '</h3>' +
        '<span class="pousse mini num">' + nb + '</span></div>' +
        '<div class="stack">' + refs.map(r => {

          if (!r.variantes || !r.variantes.length) {
            const c = cleSec(r, '');
            return '<div class="invl">' +
              '<span class="invn">' + esc(r.nom) + contenuLigne(c) + '</span>' + infoSec(c, r.nom) +
              (anc[c] !== undefined ? '<span class="invc faible">préc. ' + n1(anc[c]) + '</span>' : '') +
              champSec(r, c, r.nom) + '</div>';
          }

          const ouvert = deplies[r.id] || mots.length > 0;
          const vues = vuesDe.get(r);
          const saisis = r.variantes.filter(v => saisieSec[cleSec(r, v)] !== undefined).length;
          const total  = r.variantes.reduce((s, v) => s + num(saisieSec[cleSec(r, v)] || 0), 0);

          return '<div class="invp">' +
            '<button type="button" class="invp-h depliable" data-deplier="' + esc(r.id) + '">' +
            '<b>' + esc(r.nom) + '</b>' +
            '<span class="invc">' + (saisis
              ? n1(total) + ' ' + esc(r.unite) + (total > 1 ? 's' : '') + ' · ' + saisis + '/' + r.variantes.length +
                (vues.length < r.variantes.length ? ' · ' + vues.length + ' affichée' + (vues.length > 1 ? 's' : '') : '')
              : (vues.length < r.variantes.length ? vues.length + ' sur ' : '') +
                r.variantes.length + ' déclinaisons · en ' + esc(r.unite)) + '</span>' +
            '<span class="chev">' + (ouvert ? '−' : '+') + '</span></button>' +
            (ouvert
              ? '<div class="stack" style="margin-top:8px">' + vues.map(v => {
                  const c = cleSec(r, v);
                  return '<div class="invl">' +
                    '<span class="invn">' + esc(v) + contenuLigne(c) + '</span>' + infoSec(c, r.nom + ', ' + v) +
                    (anc[c] !== undefined ? '<span class="invc faible">préc. ' + n1(anc[c]) + '</span>' : '') +
                    champSec(r, c, r.nom + ', ' + v) + '</div>';
                }).join('') + '</div>'
              : '') +
            '</div>';
        }).join('') + '</div></div>';
    }).join('');
  };

  const listeSec = () => blocSec() ||
    '<p class="mini" style="margin-top:12px">Aucun produit ne correspond à « ' + esc(recherche) + ' ».</p>';

  const valeurTotale = estManager ? carteValeurStock(precedent, secPrec) : '';

  /* Liaisons des lignes (repli, fiche « ? », saisie du sec), dans tout l'écran
     ou seulement dans la liste du sec refaite par la recherche. */
  const lierLignes = racine => {
    const ouvert = partie === 'froid' ? ouvertFroid : ouvertSec;
    racine.querySelectorAll('[data-deplier]').forEach(b => b.onclick = () => {
      /* Pendant une recherche tout est ouvert : rien à replier. */
      if (partie === 'sec' && recherche.trim()) return;
      deplies[b.dataset.deplier] = !deplies[b.dataset.deplier];
      dessiner();
    });
    racine.querySelectorAll('[data-info]').forEach(b => b.onclick = () => ficheProduit(b.dataset.info));
    racine.querySelectorAll('[data-sec]').forEach(i => {
      i.disabled = !ouvert;
      i.oninput = () => {
        if (i.value === '') delete saisieSec[i.dataset.sec];
        else saisieSec[i.dataset.sec] = i.value;
        garderBrouillon();
        majTotaux();
      };
    });
  };

  const dessiner = () => {
    $('#vue-actions').innerHTML = '';
    const enAttente = partie === 'froid' ? attente : attenteSec;
    const enAttenteDuJour = partie === 'froid' ? attenteDuJour : attenteSecDuJour;
    const dernier = partie === 'froid' ? (attenteDuJour ? attente : precedent) : (attenteSecDuJour ? attenteSec : secPrec);
    const dejaCeJour = partie === 'froid' ? dejaFaitAujourdhui : secDejaFait;
    const ouvert = partie === 'froid' ? ouvertFroid : ouvertSec;

    $('#page').innerHTML = valeurTotale +
      carte('<h2>' + (dejaCeJour && !ouvert ? 'Inventaire du jour'
                    : ouvert && dejaCeJour ? 'Corriger l’inventaire'
                    : 'Faire l’inventaire') + '</h2>' +
        '<div class="cs">' + (dejaCeJour && !ouvert
          ? 'Compté et enregistré. Rouvrez si un chiffre doit être corrigé.'
          : ouvert && dejaCeJour
          ? 'Modifiez ce qu’il faut, puis revalidez.'
          : 'Comptez ce qui est physiquement présent. Un manager confirme ensuite ' +
            'le comptage avant qu’il remplace le stock.') + '</div>' +
        /* Comptage en attente : il est fait, mais le stock n'a pas bougé. */
        (enAttente
          ? '<div class="alerte warn" style="margin-top:12px">' +
            '<div style="flex:1;min-width:0"><b>À confirmer par un manager</b>' +
            '<p>Compté le ' + esc(fmtD(enAttente.jour)) + ' à ' + heure(enAttente.at) + ' par ' + esc(enAttente.par || '—') +
            '. ' + esc(resumes[partie]) + ' Le stock réel ne change qu’à la confirmation.</p></div>' +
            (estManager ? '<button class="btn menthe sm" id="inv-verif">Vérifier</button>' : '') +
            (enAttenteDuJour && !ouvert ? '<button class="btn clair sm" id="inv-rouvrir">Rouvrir</button>' : '') +
            '</div>'
          : '') +
        (dernier && !enAttenteDuJour
          ? (dejaCeJour
            ? '<div class="alerte ok" style="margin-top:12px">' +
              '<div style="flex:1;min-width:0"><b>Validé à ' + heure(dernier.at) + '</b>' +
              '<p>Par ' + esc(dernier.par || '—') + (dernier.confirmePar ? ', confirmé par ' + esc(dernier.confirmePar) : '') + '.</p></div>' +
              (ouvert ? '' : '<button class="btn clair sm" id="inv-rouvrir">Rouvrir</button>') +
              '</div>'
            : '<p class="rappel" style="margin-top:12px">Dernier comptage : ' +
              fmtD(dernier.jour) + (dernier.par ? ' par ' + esc(dernier.par) : '') + '</p>')
          : ''), 'solide') +

      '<div class="tseg">' +
      [['froid', 'Chambre froide', parfumsActifs().length + ' parfums'],
       ['sec',   'Sec',            (n => n + ' ' + accord(n, 'référence'))(catalogueSec().filter(r => typeof r !== 'object' || !r.masque).length)]].map(x =>
        '<button class="' + (x[0] === partie ? 'on' : '') + '" data-partie="' + x[0] + '">' +
        '<span class="tsl">' + x[1] + '</span><small>' + x[2] + '</small></button>').join('') +
      '</div>' +

      '<div class="inv-total"><b class="num" id="inv-t">0</b>' +
      '<span id="inv-u">bacs</span>' +
      '<b class="num" id="inv-kg" style="margin-left:auto">0,0 kg</b></div>' +

      (partie === 'froid' && nbArmoire
        ? '<div class="rappel" style="margin-top:12px"><b>Comptez aussi l’armoire −13</b> : ' +
          nbArmoire + ' ' + accord(nbArmoire, 'bac y est noté et fait', 'bacs y sont notés et font') + ' toujours partie du stock.</div>'
        : '') +
      (partie === 'froid' ? blocFroid()
        : '<div class="champ" style="margin-top:14px"><label class="f" for="sec-cherche">Chercher un produit</label>' +
          '<input type="search" id="sec-cherche" autocomplete="off" placeholder="Nom, étiquette ou code : wafer, nocciolata, CIALDI…" value="' +
          esc(recherche) + '"></div>' +
          '<div id="sec-liste">' + listeSec() + '</div>') +

      '<div class="champ" style="margin-top:18px"><label class="f">Note</label>' +
      '<textarea id="inv-note" placeholder="Ce qui explique un écart, un bac abîmé, un doute.">' +
      esc(note) + '</textarea></div>' +

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
          ? '<div class="entete" style="margin-top:22px"><h3>Inventaires précédents de la chambre froide</h3></div>' +
            '<div class="stack">' + historique.slice().reverse().map((h, i) => {
              const t = totauxStock(h.lignes || {});
              const v = estManager ? valeurStock(h.lignes, h.prix).total : 0;
              return '<div class="invl">' +
                '<span class="invn">' + esc(fmtD(h.jour)) +
                '<small>' + esc(h.par || '—') + ' · ' + heure(h.at) +
                (h.manquants ? ' · ' + h.manquants + ' ' + accord(h.manquants, 'manquant') : '') + '</small></span>' +
                '<span class="invc">' + t.bacs + ' bacs · ' + n1(t.kg) + ' kg' +
                (v > 0 ? ' · ' + eur(v) : '') + '<br>' +
                '<button type="button" class="btn clair sm" data-hist="froid|' + i + '">Voir tout</button></span></div>';
            }).join('') + '</div>'
          : '')
        : (historiqueSec.length
          ? '<div class="entete" style="margin-top:22px"><h3>Inventaires précédents du sec</h3></div>' +
            '<div class="stack">' + historiqueSec.slice().reverse().map((h, i) => {
              const l = h.lignes || {};
              const refs = Object.keys(l).length;
              const tot = Object.keys(l).reduce((s, k) => s + num(l[k]), 0);
              const v = estManager ? valeurStock(l, h.prix).total : 0;
              return '<div class="invl">' +
                '<span class="invn">' + esc(fmtD(h.jour)) +
                '<small>' + esc(h.par || '—') + ' · ' + heure(h.at) + '</small></span>' +
                '<span class="invc">' + refs + ' réf. · ' + n1(tot) + ' unités' +
                (v > 0 ? ' · ' + eur(v) : '') + '<br>' +
                '<button type="button" class="btn clair sm" data-hist="sec|' + i + '">Voir tout</button></span></div>';
            }).join('') + '</div>'
          : ''));

    $$('[data-hist]').forEach(b => b.onclick = () => {
      const [p, i] = b.dataset.hist.split('|');
      const liste = (p === 'froid' ? historique : historiqueSec).slice().reverse();
      if (liste[+i]) voirInventaire(liste[+i], p);
    });

    const bVerif = $('#inv-verif');
    if (bVerif) bVerif.onclick = () => verifierInventaire(partie);

    const bRouvrir = $('#inv-rouvrir');
    /* Le comptage en attente n'a pas touché le stock : on le rouvre tel quel. */
    if (bRouvrir && partie === 'froid' && attenteDuJour) bRouvrir.onclick = async () => {
      /* Revalidé, il prendra l'heure de la correction : on ajoute aux chiffres
         comptés ce qui a été tracé depuis, sinon une ouverture faite entre
         les deux serait effacée (Vanille 3 redeviendrait 4). */
      try {
        invaliderStock();
        const art = (await stockReel()).articles || {};
        /* Seulement les articles comptés : une famille non comptée le reste. */
        const { delta, apres } = await theoriqueAuComptage(attente, art);
        const comptees = groupesComptes(attente, 'froid');
        new Set(Object.keys(delta).concat(Object.keys(apres))).forEach(c => {
          const bouge = num(delta[c] || 0) + num(apres[c] || 0);
          if (!bouge || !comptees.has(litArticle(c).famille)) return;
          saisie[c] = String(Math.max(0, num(saisie[c] || 0) + bouge));
        });
      } catch (e) { /* stock illisible : on garde le comptage affiché */ }
      ouvertFroid = true;
      dessiner();
    };
    /* Le sec n'a pas de mouvements tracés : le comptage en attente se rouvre tel quel. */
    /* Sec : seules chantilly, coulis et toppings ont des mouvements ; on les
       ajoute aux chiffres comptés, comme pour la chambre froide. */
    else if (bRouvrir && partie === 'sec' && attenteSecDuJour) bRouvrir.onclick = async () => {
      try {
        for (const c of Object.keys(saisieSec)) {
          const cleV = cleVivanteSec(c, attenteSec.lignes);
          const bouge = cleV ? await mouvementsDepuis(cleV, attenteSec.at) : 0;
          if (bouge) saisieSec[c] = String(Math.max(0, num(saisieSec[c]) + bouge));
        }
      } catch (e) { /* journal illisible : on garde le comptage affiché */ }
      ouvertSec = true;
      dessiner();
    };
    else if (bRouvrir) bRouvrir.onclick = () => {
      confirmer('Rouvrir l’inventaire ?',
        'Les quantités reprennent le stock actuel, ouvertures et réceptions du jour comprises. Vous pourrez les corriger, ' +
        'puis il faudra revalider pour enregistrer.',
        'Rouvrir', async () => {
          /* Repartir du stock ACTUEL, pas des chiffres du comptage : revalidé
             avec l'heure de la correction, l'ancien comptage effaçait les
             ouvertures et réceptions tracées depuis (Vanille 3 redevenait 4). */
          try {
            if (typeof invaliderStock === 'function') invaliderStock();
            const art = (await stockReel()).articles || {};
            const famDe = c => FAMILLES_PRODUIT.filter(f => f.id === litArticle(c).famille)[0];
            const auSec = f => !!(f && (f.lieu === 'sec' || f.stock === 'sec'));
            if (partie === 'froid') {
              Object.keys(saisie).forEach(c => { saisie[c] = String(Math.max(0, num(art[c] || 0))); });
              /* Reçu depuis le comptage, sans y figurer : sinon perdu à la revalidation. */
              Object.keys(art).forEach(c => {
                if (saisie[c] !== undefined || !(num(art[c]) > 0)) return;
                const f = famDe(c);
                if (litArticle(c).famille === 'sec' || auSec(f)) return;
                saisie[c] = String(num(art[c]));
              });
            } else {
              /* Le sec compte « sec|<réf>|<déclinaison> » ; le stock vivant des
                 familles tracées (coulis, chantilly…) est sous « <famille>|<saveur>| ». */
              const nrm = x => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
              Object.keys(saisieSec).forEach(c => {
                const [, ref, v] = c.split('|');
                const f = FAMILLES_PRODUIT.filter(x => auSec(x) && (x.refSec || x.id) === ref)[0];
                if (!f) return;
                let cleV;
                if (f.saveurs && f.saveurs.length) {
                  const sv = f.saveurs.filter(x => nrm(x) === nrm(v))[0];
                  if (sv) cleV = cleArticle(f.id, sv, '');
                } else if (Object.keys(saisieSec).filter(k => k.split('|')[1] === ref).length === 1) {
                  cleV = cleArticle(f.id, '', '');
                }
                if (cleV && art[cleV] !== undefined) saisieSec[c] = String(Math.max(0, num(art[cleV])));
              });
            }
          } catch (e) { /* stock illisible : on garde le comptage affiché */ }
          if (partie === 'froid') ouvertFroid = true; else ouvertSec = true;
          dessiner();
        });
    };

    $$('[data-partie]').forEach(b => b.onclick = () => {
      if (b.dataset.partie === partie) return;
      partie = b.dataset.partie;
      note = '';
      recherche = '';
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
    lierLignes(document);
    /* Recherche : seule la liste est refaite, le champ reste en place (le
       clavier du téléphone ne se ferme pas). Pendant une composition (accent,
       prédiction), on attend qu'elle se termine. */
    const zc = $('#sec-cherche');
    if (zc) {
      zc.oninput = e => {
        recherche = zc.value;
        if (e && e.isComposing) return;
        clearTimeout(minuterieRech);
        minuterieRech = setTimeout(() => {
          const l = $('#sec-liste');
          if (l && l.isConnected) { l.innerHTML = listeSec(); lierLignes(l); }
        }, 120);
      };
      zc.addEventListener('compositionend', () => zc.oninput());
    }
    const zn = $('#inv-note');
    if (zn) { zn.disabled = !ouvert; zn.oninput = () => { note = zn.value; }; }
    majTotaux();

    const br = $('#inv-rares');
    if (br) br.onclick = () => { montrerRares = !montrerRares; dessiner(); };

    $('#inv-ok').onclick = partie === 'froid' ? validerFroid : validerSec;
  };

  /* Résumé avant de valider : ce qui a été saisi, famille par famille, et ce
     qui est resté vide dans une famille comptée (il vaudra 0 : « il devait y
     avoir du citron »). Les quantités attendues ne sont pas montrées, le
     comptage reste à l'aveugle. « Corriger » revient à la saisie. */
  function resumeAvantValider(p, lignes, avant, titre, texte, libelle, onOui) {
    const nomGroupe = g => p === 'sec' ? libelleSec('sec|' + g + '|').replace(/ · $/, '')
      : ((FAMILLES_PRODUIT.filter(f => f.id === g)[0] || {}).libelle || g);
    const court = c => {
      if (p === 'sec') return String(c).split('|')[2] || libelleSec(c);
      const a = litArticle(c);
      return [a.parfum, a.taille ? a.taille + ' L' : ''].filter(Boolean).join(' ') || libelleArticle(c);
    };
    const nb = v => Number.isInteger(v) ? String(v) : n1(v);
    const parGroupe = {};
    Object.keys(lignes).forEach(c => (parGroupe[groupeInv(p, c)] = parGroupe[groupeInv(p, c)] || []).push(c));
    const vides = Object.keys(avant || {})
      .filter(c => lignes[c] === undefined && num(avant[c]) > 0 && parGroupe[groupeInv(p, c)])
      .sort((x, y) => libelleInv(p, x).localeCompare(libelleInv(p, y)));
    /* Sec : une référence pas comptée du tout garde son ancien stock. On les
       nomme (celles qui ont une fiche « ? » d'abord : elles sont en réserve),
       et on montre les quantités qui ressemblent à une erreur d'unité. */
    const mgr = !!(STATE.user && STATE.user.role === 'manager');
    const douteux = p === 'sec' ? Object.keys(lignes)
      .map(c => ({ c: c, t: secDouteux(c, lignes[c], (avant || {})[c], mgr) })).filter(x => x.t) : [];
    /* Pas comptées : celles qui avaient du stock, et celles qui ont une fiche
       « ? » (vues en réserve). Les autres, vides depuis toujours, noieraient
       la liste. */
    const cles = r => (r.variantes && r.variantes.length ? r.variantes : ['']).map(v => 'sec|' + r.id + '|' + v);
    const aFiche = r => typeof INFO_PRODUITS !== 'undefined' && cles(r).some(k => INFO_PRODUITS[k]);
    const aStock = r => cles(r).some(k => num((avant || {})[k]) > 0);
    const pasComptes = p === 'sec' ? catalogueSec()
      .filter(r => typeof r === 'object' && !r.masque && !parGroupe[r.id] && (aStock(r) || aFiche(r)))
      .sort((x, y) => (+aFiche(y) - +aFiche(x)) || x.nom.localeCompare(y.nom))
      .map(r => r.nom) : [];
    showSheet(
      '<h2 id="sheet-titre">' + esc(titre) + '</h2>' +
      '<p class="sub">' + esc(texte) + '</p>' +
      Object.keys(parGroupe).sort((x, y) => nomGroupe(x).localeCompare(nomGroupe(y))).map(g => {
        const cs = parGroupe[g].sort((x, y) => court(x).localeCompare(court(y)));
        const total = cs.reduce((t, c) => t + num(lignes[c]), 0);
        const seul = cs.length === 1 && court(cs[0]) === nomGroupe(g);
        return '<p style="margin-top:12px"><b>' + esc(nomGroupe(g)) + '</b> · ' + nb(total) +
          (seul ? '' : '<br>' + cs.map(c => esc(court(c)) + ' : <b>' + nb(num(lignes[c])) + '</b>').join(' · ')) + '</p>';
      }).join('') +
      (vides.length
        ? '<div class="alerte warn" style="margin-top:12px"><div style="flex:1;min-width:0"><b>Laissés vides, comptés 0</b>' +
          '<p>' + esc(vides.map(libelleInv.bind(null, p)).join(', ')) + '. Corrigez si c’est un oubli.</p></div></div>'
        : '') +
      (douteux.length
        ? '<div class="alerte warn" style="margin-top:12px"><div style="flex:1;min-width:0"><b>Quantités à vérifier</b>' +
          douteux.map(x => '<p>' + esc(libelleInv(p, x.c)) + ' : ' + esc(x.t) + '.</p>').join('') +
          '<p class="mini">Vérifiez l’unité affichée (carton, ramette, pack…) : une unité entière = 1, la moitié = 0,5.</p></div></div>'
        : '') +
      (pasComptes.length
        ? '<div class="alerte" style="margin-top:12px"><div style="flex:1;min-width:0"><b>Pas comptés cette fois (' + pasComptes.length + ')</b>' +
          '<p>' + esc(pasComptes.join(', ')) + '. Leur stock reste celui du dernier inventaire. ' +
          'Comptez-les s’ils sont en réserve.</p></div></div>'
        : '') +
      '<div class="actions"><button class="btn clair" data-fermer>Corriger</button>' +
      '<button class="btn menthe" id="rv-oui">' + esc(libelle) + '</button></div>'
    );
    $('#rv-oui').onclick = () => { closeSheet(); return onOui(); };
  }

  async function validerFroid() {
    const cptes = Object.keys(saisie);
    if (!cptes.length) return toast('Saisissez au moins une quantité', 'erreur');

    /* Un bac, une boîte, un paquet se comptent en entiers positifs : « -3 » ou
       « 1.5 » passaient, et le stock affichait des bacs négatifs. */
    const faux = cptes.filter(c => { const q = num(saisie[c]); return q < 0 || q % 1 !== 0; })[0];
    if (faux) return toast(libelleArticle(faux) + ' : nombre entier et positif attendu', 'erreur');

    const lignes = {};
    cptes.forEach(c => { lignes[c] = num(saisie[c]); });
    const t = totauxStock(lignes);

    /* État AVANT le comptage : c'est lui qui révèle les bacs disparus. Sans
       les familles du sec (chantilly, coulis…) : la chambre froide ne les
       compte pas, elles passaient toutes pour manquantes à chaque inventaire. */
    /* Livraisons arrivées mais pas encore confirmées comprises : les bacs
       sont dans la chambre froide, l'équipier les a comptés. */
    const tout = (await stockReel()).articles;
    const avant = (await theoriqueAuComptage({ at: nowISO() }, tout)).theo;
    /* Un parfum retiré n'est pas proposé au comptage : son stock est reporté
       à la confirmation, il ne compte ni dans les manquants ni dans « avant ». */
    Object.keys(avant).forEach(c => { const x = litArticle(c); if (!froidActif(x.famille, x.parfum)) delete avant[c]; });
    /* Manquants et surplus sont comptés séparément, sur l'union des articles
       attendus et saisis, comme enregistrerInventaire : une somme d'écarts
       signés laissait 2 bacs manquants et 2 en trop s'annuler en
       « correspond exactement ». */
    let manq = 0, trop = 0;
    /* En bacs seulement (clés avec une taille) : boîtes et paquets s'ajoutaient
       aux bacs (« 9 bacs comptés … 16 en trop »). */
    const premier = !Object.keys(avant).length;
    /* Seules les familles comptées se comparent : compter les glaces seules
       ne doit pas annoncer tous les macarons manquants. */
    const famComptees = new Set(Object.keys(lignes).map(c => litArticle(c).famille));
    new Set(Object.keys(avant).concat(Object.keys(lignes))).forEach(c => {
      if (!litArticle(c).taille || !famComptees.has(litArticle(c).famille)) return;
      const d = num(lignes[c] || 0) - num(avant[c] || 0);
      if (d < 0) manq += -d; else trop += d;
    });

    resumeAvantValider('froid', lignes, avant, 'Valider la chambre froide ?',
      t.bacs + ' ' + accord(t.bacs, 'bac compté', 'bacs comptés') + ' sur ' + cptes.length + ' ' + accord(cptes.length, 'référence') + ', soit ' +
      n1(t.kg) + ' kg. ' +
      (premier ? 'Premier comptage : il deviendra la référence du stock.'
       : manq === 0 && trop === 0 ? 'Cela correspond exactement au stock attendu.'
       : manq + ' ' + accord(manq, 'bac manquant', 'bacs manquants') + ', ' + trop + ' en trop par rapport au stock attendu.' +
         (manq ? ' Des ouvertures non tracées ?' : '') +
         (trop ? (manq ? ' Et' : ' Peut-être') + ' une réception non saisie ?' : '')) +
      ' Compté : ' + [...famComptees].map(f => (FAMILLES_PRODUIT.filter(x => x.id === f)[0] || {}).libelle || f).join(', ') +
      ' (un article non saisi y vaut 0) ; les autres familles ne changent pas.' +
      ' L’inventaire est enregistré, à confirmer par un manager : le stock ne change pas avant.' +
      (attente && !attenteDuJour ? ' Il remplace celui du ' + fmtD(attente.jour) + ', encore à confirmer.' : ''),
      'Valider', async () => {
        /* Enregistré comme fait, pas repris sur le stock : un manager le
           confirme (verifierInventaire). « avant » est le stock attendu au
           moment du comptage, celui dont on mesure l'écart. */
        const a = {
          jour: today(), at: nowISO(),
          par: STATE.user ? STATE.user.prenom : null,
          employe: STATE.user ? STATE.user.id : null,
          note: $('#inv-note') ? $('#inv-note').value : '',
          lignes: lignes, avant: avant,
          /* Ce qui était retiré pendant le comptage : relu à la confirmation. */
          retires: [..._froidRetires]
        };
        await DB.set(CLE_INV_ATTENTE, a);
        /* Le brouillon de la chambre froide est effacé — il n'a plus lieu
           d'être puisque c'est validé — mais PAS la saisie : revenir sur
           l'écran doit montrer les quantités enregistrées. Celui du sec reste. */
        oublierBrouillon('froid');
        await feed(manq ? 'warn' : 'ok',
          STATE.user.prenom + ' a compté la chambre froide : ' + t.bacs + ' ' + accord(t.bacs, 'bac') + ', ' + n1(t.kg) + ' kg' +
          (manq ? ' · ' + manq + ' ' + accord(manq, 'bac manquant', 'bacs manquants') : '') + ' · à confirmer');
        toast('Inventaire enregistré, à confirmer par un manager');
        /* Le manager enchaîne sur la vérification ; l'équipier retourne au stock. */
        if (estManager) { await rendre('inventaire'); verifierInventaire('froid'); }
        else rendre('stock');
      });
  }

  async function validerSec() {
    const cptes = Object.keys(saisieSec);
    if (!cptes.length) return toast('Saisissez au moins une quantité', 'erreur');
    /* Positif, entier si la référence l'exige, par demis sinon (2,5). */
    const cat = catalogueSec();
    const faux = cptes.filter(k => {
      const q = num(saisieSec[k]);
      const r = cat.filter(x => typeof x === 'object' && x.id === k.split('|')[1])[0];
      return q < 0 || (r && r.decimal === false ? q % 1 !== 0 : (q * 2) % 1 !== 0);
    })[0];
    if (faux) {
      const p = faux.split('|');
      const r = cat.filter(x => typeof x === 'object' && x.id === p[1])[0];
      return toast((r ? r.nom : p[1]) + (p[2] ? ' ' + p[2] : '') + ' : quantité impossible', 'erreur');
    }
    const lignes = {};
    cptes.forEach(k => { lignes[k] = num(saisieSec[k]); });

    resumeAvantValider('sec', lignes, secAttendu.lignes, 'Valider le sec ?',
      cptes.length + ' ' + accord(cptes.length, 'référence comptée', 'références comptées') + '. ' +
      'L’inventaire est enregistré, à confirmer par un manager : le stock ne change pas avant.' +
      (attenteSec && !attenteSecDuJour ? ' Il remplace celui du ' + fmtD(attenteSec.jour) + ', encore à confirmer.' : ''),
      'Valider', async () => {
        /* Enregistré comme fait, pas repris sur le stock : un manager le
           confirme (verifierInventaire). « avant » est le dernier comptage
           confirmé, celui dont le manager voit la différence. */
        const a = {
          jour: today(), at: nowISO(),
          par: STATE.user ? STATE.user.prenom : null,
          employe: STATE.user ? STATE.user.id : null,
          note: $('#inv-note') ? $('#inv-note').value : '',
          lignes: lignes,
          avant: Object.assign({}, secAttendu.lignes)
        };
        await DB.set(INV_ATTENTE.sec.cle, a);
        oublierBrouillon('sec');
        await feed('ok', STATE.user.prenom + ' a compté le sec : ' + cptes.length + ' ' + accord(cptes.length, 'référence') + ' · à confirmer');
        toast('Inventaire enregistré, à confirmer par un manager');
        if (estManager) { STATE.inventairePartie = 'sec'; await rendre('inventaire'); verifierInventaire('sec'); }
        else rendre('stock');
      });
  }

  dessiner();
};

/* -----------------------------------------------------------------------------
   ARMOIRE −13
   Le bac de glace sort de la chambre froide (−20) et attend à l'armoire −13
   avant de monter en vitrine. Tant qu'il y est, il reste au stock : seule la
   mise en vitrine le déduit (mouvement « ouverture »).
   Sa durée de vie commence à la SORTIE de la chambre froide, pas à la mise en
   vitrine : cette date est notée ici, plus sur le bac au feutre.

   Journal en ajout seul, découpé par mois comme celui du stock :
     { id, t:'entree', c:clé article, l:lot, j:jour de sortie du −20, a, e }
     { id, t:'sortie', r:id de l'entrée, v:'vitrine'|'perte'|'erreur', a, e }
   Une sortie ne modifie pas l'entrée : deux iPads qui écrivent en même temps
   se réunissent sans s'écraser (UNIR, app.js).
   -------------------------------------------------------------------------- */
const ARMOIRE = { nom: 'Armoire −13', moisLus: 3 };
const cleArmoire = d => 'stock:m13:' + String(d || today()).slice(0, 7);

/* Bacs présents à l'armoire, du plus ancien au plus récent. Lit les trois
   derniers mois : un gelato vit dix jours, un bac plus ancien serait périmé
   depuis longtemps. Sert aussi au comptage par lieu (chambre froide / −13). */
async function bacsArmoire() {
  const fin = new Date(today() + 'T12:00:00');
  const cles = [];
  for (let i = 0; i < ARMOIRE.moisLus; i++) {
    cles.push(cleArmoire(isoOf(new Date(fin.getFullYear(), fin.getMonth() - i, 15))));
  }
  const blocs = await Promise.all(cles.map(c => DB.get(c, []).catch(() => [])));
  const ev = [];
  blocs.forEach(l => { if (Array.isArray(l)) ev.push.apply(ev, l); });
  const sortis = new Set(ev.filter(e => e && e.t === 'sortie').map(e => e.r));
  const heures = (DLC_RULES.gelato || DLC_RULES.defaut).h;
  return ev.filter(e => e && e.t === 'entree' && e.id && !sortis.has(e.id) &&
                       /^\d{4}-\d{2}-\d{2}$/.test(e.j))
    .map(e => {
      const limite = new Date(new Date(e.j + 'T08:00:00').getTime() + heures * 3600e3);
      return { id: e.id, cle: e.c, lot: e.l || '', jour: e.j, at: e.a,
               limite: isoOf(limite), resteH: Math.round((limite - Date.now()) / 3600e3) };
    })
    .sort((x, y) => (x.jour + (x.at || '')).localeCompare(y.jour + (y.at || '')));
}

async function noterArmoire(ev) {
  return DB.push(cleArmoire(), Object.assign(
    { id: uid(), a: nowISO(), e: STATE.user ? STATE.user.id : null }, ev));
}

/* Retirer un bac de l'armoire sans le monter en vitrine : jeté (il sort du
   stock, comme une perte) ou noté par erreur (le stock ne bouge pas). */
function retirerDeArmoire(b) {
  showSheet(
    '<h2 id="sheet-titre">' + esc(libelleArticle(b.cle)) + '</h2>' +
    '<p class="cs">À l’armoire depuis le ' + esc(fmtD(b.jour)) + (b.lot ? ' · lot ' + esc(b.lot) : '') + '</p>' +
    '<div class="stack" style="margin-top:14px">' +
    '<button class="btn corail bloc" id="ar-jete">Jeté (périmé ou abîmé)</button>' +
    '<button class="btn clair bloc" id="ar-err">Noté par erreur</button></div>' +
    '<div class="actions"><button class="btn clair" data-fermer>Annuler</button></div>');
  let enCours = false;
  const sortir = async (v) => {
    if (enCours) return;
    enCours = true;
    try {
      /* La sortie d'armoire d'abord : sans effet sur le stock, elle empêche
         un second appui de jeter deux fois le même bac. */
      await noterArmoire({ t: 'sortie', r: b.id, v: v });
      if (v === 'perte') await ajouterMouvement('perte', b.cle, 1, { lot: b.lot, motif: 'armoire' });
      closeSheet();
      rendre('lots');
      feed(v === 'perte' ? 'warn' : 'ok', STATE.user.prenom +
        (v === 'perte' ? ' a jeté ' : ' a retiré (erreur de saisie) ') +
        libelleArticle(b.cle) + ' de l’armoire −13').catch(() => {});
    } catch (e) {
      toast('Enregistrement impossible, réessayez', 'erreur');
    } finally { enCours = false; }
  };
  $('#ar-jete').onclick = () => sortir('perte');
  $('#ar-err').onclick = () => sortir('erreur');
}

/* Sec ou chambre froide : la même règle pour le Stock réel, l'inventaire
   et la Traçabilité (famille marquée lieu ou stock « sec »). */
function articleEstSec(c) {
  const fam = FAMILLES_PRODUIT.filter(x => x.id === litArticle(c).famille)[0];
  return !!(fam && (fam.lieu === 'sec' || fam.stock === 'sec'));
}

V.lots = async function () {
  const mouv = await tousMouvements(null);
  /* Deux onglets, comme le Stock réel : le surgelé et le sec ne se mélangent
     plus. Les 40 dernières ouvertures de CHAQUE partie, sinon une journée de
     coulis chassait les bacs de glace de la liste. */
  const toutes = mouv.map(litMouvement).filter(m => m.type === 'ouverture');
  const parPartie = { froid: [], sec: [] };
  toutes.forEach(m => parPartie[articleEstSec(m.cle) ? 'sec' : 'froid'].push(m));
  const totaux = { froid: parPartie.froid.length, sec: parPartie.sec.length };
  Object.keys(parPartie).forEach(k => parPartie[k] = parPartie[k].slice(-40).reverse());
  const partie = STATE.lotsPartie === 'sec' ? 'sec' : 'froid';
  const ouvertures = parPartie[partie];
  const armoire = partie === 'froid' ? await bacsArmoire().catch(() => []) : [];
  const seuilH = (typeof seuilOrangeHeures === 'function')
    ? seuilOrangeHeures((DLC_RULES.gelato || DLC_RULES.defaut).h) : 72;

  $('#vue-actions').innerHTML = '';
  $('#page').innerHTML =
    carte('<h2>Traçabilité</h2>' +
      '<div class="cs">À l’ouverture de tout nouveau produit, pas à la livraison. ' +
      'Un bac de glace qui sort de la chambre froide se scanne tout de suite : ' +
      'il monte en vitrine ou attend à l’armoire −13. Plus de date au feutre.</div>' +
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

    '<div class="tseg" style="margin-top:20px">' +
    [['froid', 'Chambre froide'], ['sec', 'Sec']].map(x => {
      const n = totaux[x[0]];
      return '<button type="button" class="' + (x[0] === partie ? 'on' : '') + '" data-lpartie="' + x[0] + '">' +
        '<span class="tsl">' + x[1] + '</span><small>' + n + ' ' + accord(n, 'ouverture') + '</small></button>';
    }).join('') + '</div>' +

    /* L'armoire −13 n'accueille que des bacs : elle reste côté chambre froide. */
    (partie === 'sec' ? '' : armoire.length
      ? '<div class="entete" style="margin-top:20px"><h3>À l’armoire −13</h3>' +
        '<span class="pousse mini num">' + armoire.length + '</span></div>' +
        '<div class="stack">' + armoire.map(b => {
          const a = litArticle(b.cle);
          const etat = b.resteH < 0 ? pastille('bad', 'Périmé')
            : b.resteH <= seuilH ? pastille('warn', 'Jusqu’au ' + fmtDC(b.limite))
            : pastille('ok', 'Jusqu’au ' + fmtDC(b.limite));
          return '<div class="lotl">' +
            '<span class="invn">' + esc(a.parfum || libelleArticle(b.cle)) +
            '<small>' + esc([a.taille ? a.taille + ' L' : '', 'sorti du −20 le ' + fmtDC(b.jour),
                             b.lot ? 'lot ' + b.lot : ''].filter(Boolean).join(' · ')) + '</small></span>' +
            '<span class="invc">' + etat + '<br>' +
            '<button type="button" class="btn clair sm" data-armoire="' + esc(b.id) + '">Retirer</button></span></div>';
        }).join('') + '</div>'
      /* La section reste visible même vide : sinon personne ne sait où
         regarder, et « rien ici » se lit comme « l'écran n'existe pas ». */
      : '<div class="entete" style="margin-top:20px"><h3>À l’armoire −13</h3></div>' +
        '<p class="cs">Aucun bac noté à l’armoire −13. Scannez un bac et choisissez ' +
        '« Armoire −13 » pour qu’il apparaisse ici.</p>') +

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
      : vide('', partie === 'sec' ? 'Aucune ouverture de sec enregistrée.'
                                  : 'Aucune ouverture de chambre froide enregistrée.'));

  $$('[data-lpartie]').forEach(b => b.onclick = () => {
    STATE.lotsPartie = b.dataset.lpartie; rendre('lots');
  });

  /* « Valider et scanner le suivant » : la prise de vue repart après chaque
     ouverture confirmée. Le drapeau enchainer n'était lu par personne : le
     bouton faisait la même chose que « Valider ». */
  /* dejaOuvert vaut true (et seulement true : au premier appel, c'est
     l'événement du clic) quand une ouverture de la chaîne est enregistrée.
     La fin de chaîne — prise de vue ou confirmation annulée — redessine
     alors la liste : elle affichait encore « Aucune ouverture enregistrée »
     avec deux ouvertures en base, de quoi faire rescanner et doubler la
     traçabilité. */
  $$('[data-armoire]').forEach(bt => bt.onclick = () => {
    const b = armoire.filter(x => x.id === bt.dataset.armoire)[0];
    if (b) retirerDeArmoire(b);
  });
  $('#lo-scan').onclick = async function scanner(dejaOuvert) {
    const r = await scannerPhoto('etiquette', { enchainer: true });
    if (!r) { if (dejaOuvert === true) rendre('lots'); return; }
    const ok = await confirmerOuverture(r);
    if (ok && r.enchainer && STATE.view === 'lots') return scanner(true);
    if (ok || dejaOuvert === true) rendre('lots');
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
    /* Après un scan, on ne présume PLUS que c'est une glace. Le moteur lit
       « Pistacchio » sur un macaron aussi bien que sur un bac, et la famille
       était forcée à « glace » dès qu'un parfum était reconnu : impossible
       d'atteindre les saveurs de macarons par le scanner. Le parfum lu reste
       proposé ; la famille, c'est à la personne de la choisir — et si elle
       choisit Macarons, le même mot sera cherché dans leurs saveurs. */
    let famille = r.familleDetectee || '';
    let parfum  = r.parfum || '';
    let taille  = r.volume || FOURNISSEUR.tailleParDefaut;
    /* Si le lot a la forme des macarons — L + 4 chiffres + lettre — on
       présélectionne les macarons ; si c'est la forme Amorino, une glace. */
    if (!famille && r.lot) {
      if (/^L\d{4}[A-Z]$/i.test(r.lot)) famille = 'mac_classico';
      else if (/^1[34]\d{3}[A-Z]$/i.test(r.lot)) famille = 'glace';
    }

    /* Glace seulement : où va le bac (vitrine ou armoire −13), d'où il sort
       quand il monte en vitrine (chambre froide −20 ou armoire −13), et
       lequel des bacs de l'armoire, pour reprendre sa date de sortie du −20. */
    let dest = '', orig = '', bacId = '', jourM13 = '';
    let armoire = [];
    /* Jeton propre à cette feuille : si elle a été refermée (voile, retour)
       ou remplacée par une autre, la liste qui arrive ne la redessine pas. */
    let fini = false, armoireChargee = false;
    const jeton = uid();
    const chargement = bacsArmoire().then(l => { armoire = l; })
      .catch(() => {}).then(() => {
        armoireChargee = true;
        const sh = $('#sheet');
        if (!fini && sh && !sh.hidden && $('#co-ok') && $('#co-ok').dataset.jeton === jeton) {
          garder(); dessiner();
        }
      });
    const estGlace = () => famille === 'glace';
    const cleCourante = () => cleArticle('glace', parfum, taille);
    const candidats = () => armoire.filter(b => b.cle === cleCourante());
    const bacArmoire = () => (estGlace() && dest === 'vitrine' && orig === 'm13')
      ? candidats().filter(b => b.id === bacId)[0] || null : null;

    const garder = () => {
      const l = $('#co-lot'); if (l) r.lot = l.value.trim().toUpperCase();
      const sp = $('#co-parfum'); if (sp) parfum = sp.value;
      const jm = $('#co-j13'); if (jm) jourM13 = jm.value;
    };
    /* Annuler : la feuille est redessinée par dessiner() sans passer par
       showSheet, qui seul branche [data-fermer] — le bouton ne faisait rien. */
    const annuler = () => { fini = true; closeSheet(); resolve(false); };
    let enCours = false;

    const dessiner = () => {
      const fam = FAMILLES_PRODUIT.filter(f => f.id === famille)[0];
      const glace = estGlace();
      /* Bac de l'armoire : celui dont le lot correspond au scan, sinon le plus
         ancien du parfum — c'est lui qui doit partir en premier. */
      const cands = glace ? candidats() : [];
      if (glace && dest === 'vitrine' && orig === 'm13' &&
          !cands.some(b => b.id === bacId)) {
        const parLot = r.lot ? cands.filter(b => b.lot && b.lot === String(r.lot).toUpperCase())[0] : null;
        bacId = (parLot || cands[0] || {}).id || '';
      }
      const choixDest = !glace ? ''
        : '<div class="champ" style="margin-top:16px"><label class="f">Où va ce bac ?</label>' +
          '<div class="pastilles">' +
          [['vitrine', 'Vitrine'], ['m13', ARMOIRE.nom]].map(d =>
            '<button type="button" class="pas' + (dest === d[0] ? ' on' : '') +
            '" data-dest="' + d[0] + '">' + esc(d[1]) + '</button>').join('') + '</div></div>' +
          (dest === 'vitrine'
            ? '<div class="champ" style="margin-top:14px"><label class="f">Il sort de</label>' +
              '<div class="pastilles">' +
              [['cf', 'Chambre froide −20'], ['m13', ARMOIRE.nom]].map(d =>
                '<button type="button" class="pas' + (orig === d[0] ? ' on' : '') +
                '" data-orig="' + d[0] + '">' + esc(d[1]) + '</button>').join('') + '</div></div>'
            : '') +
          (dest === 'vitrine' && orig === 'm13'
            ? (cands.length
                ? '<div class="champ" style="margin-top:14px"><label class="f">Bac de l’armoire</label>' +
                  '<div class="pastilles">' + cands.map(b =>
                    '<button type="button" class="pas' + (b.id === bacId ? ' on' : '') +
                    '" data-bac="' + esc(b.id) + '">Sorti du −20 le ' + esc(fmtDC(b.jour)) +
                    (b.lot ? ' · ' + esc(b.lot) : '') + '</button>').join('') + '</div>' +
                  '<p class="mini" style="margin-top:6px">Sa durée de vie compte depuis cette date.</p></div>'
                : '<div class="champ" style="margin-top:14px"><label class="f">Sorti du −20 le</label>' +
                  '<input type="date" id="co-j13" max="' + today() + '" value="' + esc(jourM13 || today()) + '">' +
                  '<p class="mini" style="margin-top:6px">Aucun bac de ce parfum n’est noté à l’armoire : ' +
                  'indiquez la date écrite sur le bac.</p></div>')
            : '') +
          (dest === 'vitrine' && orig === 'cf' && cands.length
            ? '<div class="rappel" style="margin-top:12px">' + cands.length + ' ' + accord(cands.length, 'bac de ce parfum attend', 'bacs de ce parfum attendent') +
              ' déjà à l’armoire −13, depuis le ' + esc(fmtDC(cands[0].jour)) +
              '. Le plus ancien part d’abord.</div>'
            : '');
      const sousTitre = !glace ? 'Ce produit est ouvert et part en service.'
        : dest === 'm13' ? 'Le bac reste au stock. La date du jour est sa date de sortie du −20.'
        : dest === 'vitrine' ? 'Le bac monte en vitrine : il sort du stock.'
        : 'Le bac sort de la chambre froide.';
      const libOk = !glace ? 'Confirmer l’ouverture'
        : dest === 'm13' ? 'Mettre à l’armoire −13'
        : 'Mettre en vitrine';

      $('#sheet-corps').innerHTML =
        '<h2 id="sheet-titre">' + (glace ? 'Sortie d’un bac de glace' : 'Ouvrir un produit') + '</h2>' +
        '<p class="cs">' + esc(sousTitre) + '</p>' +

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
            '<select id="co-parfum">' + (fam.saveurs || PARFUMS).map(p => {
              /* Le mot lu sur l'étiquette est comparé sans accent ni casse, et
                 sur ses cinq premières lettres : « Pistache » lu sur un bac et
                 « Pistacchio » de la liste des macarons se retrouvent. */
              const nrm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z]/g,'');
              const a = nrm(p), b = nrm(parfum);
              const proche = b && (a === b || (a.length >= 5 && b.length >= 5 && a.slice(0,5) === b.slice(0,5)));
              return '<option' + (proche ? ' selected' : '') + '>' + esc(p) + '</option>';
            }).join('') +
            '</select></div>' +
            (fam.id === 'glace'
              ? '<div class="champ" style="margin-top:14px"><label class="f">Taille du bac</label>' +
                '<div class="pastilles">' + (FOURNISSEUR.taillesBac || TAILLES_BAC).map(t =>
                  '<button type="button" class="pas' + (num(t) === num(taille) ? ' on' : '') +
                  '" data-taille="' + t + '">' + t + ' L</button>').join('') + '</div></div>'
              : '')
          : '') +

        '<div class="champ" style="margin-top:14px"><label class="f">Numéro de lot' +
        (glace && dest === 'm13' ? ' (facultatif)' : '') + '</label>' +
        '<input type="text" id="co-lot" value="' + esc(r.lot || '') + '" ' +
        'autocapitalize="characters" spellcheck="false" placeholder="14001A"></div>' +

        choixDest +

        '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
        '<button class="btn menthe" id="co-ok" data-jeton="' + jeton + '">' + esc(libOk) + '</button></div>';

      $$('[data-fam]').forEach(b => b.onclick = () => {
        garder(); famille = b.dataset.fam;
        if (famille !== 'glace') { dest = ''; orig = ''; bacId = ''; }
        dessiner();
      });
      $$('[data-taille]').forEach(b => b.onclick = () => {
        garder(); taille = b.dataset.taille; dessiner();
      });
      $$('[data-dest]').forEach(b => b.onclick = () => {
        garder(); dest = b.dataset.dest; if (dest !== 'vitrine') orig = ''; dessiner();
      });
      $$('[data-orig]').forEach(b => b.onclick = () => {
        garder(); orig = b.dataset.orig; dessiner();
      });
      $$('[data-bac]').forEach(b => b.onclick = () => {
        garder(); bacId = b.dataset.bac; dessiner();
      });
      const sp = $('#co-parfum');
      /* Le parfum change les bacs de l'armoire proposés : on redessine. */
      if (sp) sp.onchange = () => { garder(); if (estGlace()) dessiner(); };
      $$('#sheet-corps [data-fermer]').forEach(b => b.onclick = annuler);
      $('#co-ok').onclick = async () => {
        /* Double appui : un seul enregistrement à la fois. */
        if (enCours) return;
        enCours = true;
        try { await enregistrer(); } finally { enCours = false; }
      };
    };

    async function enregistrer() {
      garder();
      const fam = FAMILLES_PRODUIT.filter(f => f.id === famille)[0];
      if (!fam) return toast('Choisissez la famille', 'erreur');
      /* Le menu fait foi : s'il n'a pas été touché, parfum contient encore le
         texte lu par l'OCR, qui peut ne correspondre à aucune option affichée. */
      if (fam.parfums) {
        const sp = $('#co-parfum');
        if (sp) parfum = sp.value;
        if (!parfum) return toast('Choisissez le parfum', 'erreur');
      }
      if (fam.id === 'glace') {
        if (!dest) return toast('Choisissez : vitrine ou armoire −13', 'erreur');
        /* La liste de l'armoire doit être là avant de choisir le bac : sinon
           on prendrait la date du jour et le bac resterait affiché. */
        if (dest === 'vitrine' && orig === 'm13' && !armoireChargee) {
          await chargement;
          garder(); dessiner();
          return toast('Vérifiez le bac de l’armoire, puis validez');
        }
        if (dest === 'vitrine' && !orig) return toast('Indiquez d’où sort le bac', 'erreur');
        if (dest === 'vitrine' && orig === 'm13' && !bacArmoire() &&
            !(/^\d{4}-\d{2}-\d{2}$/.test(jourM13) && jourM13 <= today())) {
          return toast('Indiquez la date de sortie du −20', 'erreur');
        }
      }
      /* Le bac repris de l'armoire garde le lot noté à son entrée. */
      const bA = bacArmoire();
      const lot = ((r.lot || '').trim() || (bA && bA.lot) || '').toUpperCase();
      const versArmoire = fam.id === 'glace' && dest === 'm13';
      if (!lot && !versArmoire) return toast('Le numéro de lot est obligatoire', 'erreur');

      /* Le lot n'identifie pas un bac — deux bacs de vanille peuvent porter le
         même numéro. Le vrai signal est le stock : ouvrir un bac qu'on n'a plus
         veut dire qu'une ouverture précédente n'a pas été scannée, ou qu'une
         livraison n'a pas été saisie.
         Seules les GLACES ont une taille de bac. Un macaron ou un coulis a une
         saveur, pas un litrage : la condition « fam.parfums ? taille » leur
         collait un « 5 L » dès qu'ils ont eu des saveurs, et l'alerte cherchait
         un article qui n'existe pas. */
      const cleOuv = cleArticle(fam.id, fam.parfums ? parfum : '', fam.id === 'glace' ? taille : '');
      /* Vers l'armoire, rien ne sort du stock : pas d'alerte de rupture. */
      const manque = versArmoire ? null : await stockInsuffisant(cleOuv).catch(() => null);
      if (manque && manque.attente) {
        return confirmer('Livraison pas encore confirmée',
          'Une livraison de ' + manque.article + ' attend la confirmation d’un manager : ' +
          'ses bacs ne sont pas encore au stock. Ne la saisissez pas une seconde fois, ' +
          'demandez au manager de la confirmer.',
          'Ouvrir quand même', () => { poser(fam, lot); }, annuler);
      }
      if (manque) {
        return confirmer('Ce bac n’est plus au stock',
          'L’application n’a plus de ' + manque.article + ' en réserve' +
          (manque.reste < 0 ? ' : le compte est déjà à ' + manque.reste + '.' : '.') +
          ' Soit une ouverture précédente n’a pas été scannée, soit une livraison ' +
          'n’a pas été saisie. Confirmez si le bac est bien là : un recomptage ' +
          'sera proposé pour remettre les compteurs à plat.',
          'Confirmer l’ouverture', () => { poser(fam, lot); }, annuler);
      }
      await poser(fam, lot);
    }

    async function poser(fam, lot) {
      /* Seules les glaces ont une taille de bac ; un coulis ou un topping n'en
         a pas, mais il a une saveur qu'il faut garder dans la clé. */
      const cle = cleArticle(fam.id,
        fam.parfums ? parfum : '',
        fam.id === 'glace' ? taille : '');

      /* Vers l'armoire −13 : le bac reste au stock, on note seulement sa date
         de sortie du −20 — c'est elle qui fera partir sa durée de vie. */
      if (fam.id === 'glace' && dest === 'm13') {
        await noterArmoire({ t: 'entree', c: cle, l: lot || '', j: today() });
        fini = true;
        closeSheet();
        resolve(true);
        feed('ok', STATE.user.prenom + ' a mis ' + parfum + ' à l’armoire −13' +
          (lot ? ' · lot ' + lot : '')).catch(() => {});
        return;
      }

      /* Le bac choisi a pu être monté en vitrine depuis un autre iPad : on
         relit l'armoire juste avant d'écrire et on prend le suivant du même
         parfum s'il n'y est plus. */
      let bA = bacArmoire();
      if (bA) {
        const frais = await bacsArmoire().catch(() => null);
        if (frais && !frais.some(b => b.id === bA.id)) {
          const autres = frais.filter(b => b.cle === bA.cle);
          bA = autres.filter(b => b.lot && b.lot === lot)[0] || autres[0] || null;
          if (!bA) {
            /* Plus aucun bac de ce parfum à l'armoire : on demande la date
               plutôt que de partir d'aujourd'hui sans prévenir. */
            armoire = frais; bacId = '';
            dessiner();
            return toast('Ce bac est déjà sorti de l’armoire : indiquez sa date de sortie du −20', 'erreur');
          }
          toast('Ce bac était déjà sorti : le suivant de l’armoire est pris');
          if (!r.lot) lot = (bA.lot || lot).toUpperCase();
        }
      }
      /* La sortie d'armoire avant l'ouverture : si l'ouverture échoue, le
         bac n'est pas déduit deux fois au prochain essai. */
      if (bA) await noterArmoire({ t: 'sortie', r: bA.id, v: 'vitrine' });
      await ajouterMouvement('ouverture', cle, 1, { lot: lot, famille: fam.id, parfum: parfum });
      /* Traçabilité : on rouvre sur l'onglet de ce qui vient d'être ouvert. */
      STATE.lotsPartie = articleEstSec(cle) ? 'sec' : 'froid';

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
        /* Par saveur aussi : ouvrir un coulis pistache effaçait le suivi du
           coulis chocolat ouvert la veille (une seule entrée par règle). */
        : 'a_' + (fam.dlc || 'defaut') + (parfum ? '|' + parfum : '');
      /* « Ouvert le » de la lecture fait foi (bac ouvert la veille, scanné ce
         matin) : il était ignoré et la DLC après ouverture partait d'aujourd'hui.
         Une date future ou illisible retombe sur aujourd'hui. */
      /* Bac venu de l'armoire −13 : sa durée de vie compte depuis sa sortie
         du −20, notée à l'entrée dans l'armoire (ou saisie s'il n'y était pas
         noté). Venu directement du −20 : depuis aujourd'hui. */
      const dateValide = d => d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today();
      const ouv = (fam.id === 'glace' && orig === 'm13')
        ? (bA ? bA.jour : (dateValide(jourM13) ? jourM13 : today()))
        : (dateValide(r.ouv) ? r.ouv : today());
      lots[cleFifo] = { lot: lot, ouv: ouv, par: STATE.user.prenom, at: nowISO(),
                        famille: fam.id, taille: fam.parfums ? taille : null };
      await DB.set('lots:' + m, lots);

      await feed('ok', STATE.user.prenom +
        (fam.id === 'glace' ? ' a mis en vitrine ' : ' a ouvert ') +
        (parfum || fam.libelle) + (bA || orig === 'm13' ? ' (depuis l’armoire −13)' : '') +
        ' · lot ' + lot);
      fini = true;
      closeSheet();
      resolve(true);
    }

    showSheet('<div class="vide">…</div>');
    dessiner();
  });
}
