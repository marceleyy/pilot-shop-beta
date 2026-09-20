/* =============================================================================
   scripts/sec-variantes.cjs

   Catalogue du sec, relevé sur la fiche stock opérationnel Amorino et corrigé
   à l'oral avec le manager le 20 septembre.

   LES RÈGLES DE COMPTAGE, telles que dites :

     • On compte des CARTONS pour presque tout. L'unité est affichée avant la
       saisie, pour que les filles voient ce qu'on attend d'elles.

     • Les DÉCIMALES sont autorisées : « j'ai deux cartons pleins et un à
       moitié » se tape 2,5. Zéro veut dire « à commander » ; 0,5 veut dire
       « je réfléchis ». Sur un topping proche de la DLC qui met un mois à se
       vider, la différence compte.

     • Les POTS se comptent en RAMETTES — un sachet fermé dans le carton —,
       pas en cartons : un carton contient 3 000 pièces, on ne va pas dire
       zéro parce qu'il est ouvert.

     • Pas de Bambino. Les cornets sont petit, classique, grand.

     • Ce qui s'appelait « couvercles » était en fait les COUVERTS en bois :
       couteau, cuillère, fourchette. Les vrais couvercles existent aussi,
       en deux tailles.

     • Café en grains et mocca beans sont la même chose : le topping CAFÉ.
       Les éclats de caramel sont le topping CARAMEL. Quatre toppings sur
       glace : pistache, noisette, caramel, café.

     • Tout ce qui est surgelé — crêpes, gaufres, macarons, gianduiotto,
       cookies — est regroupé dans sa propre section.

     • Les produits d'entretien sont regroupés, avec leurs déclinaisons.

   Chaque entrée porte un identifiant stable : c'est lui qui sert de clé,
   pour qu'un changement de nom ne perde pas l'historique.

   Le script est REJOUABLE.

   Usage, depuis la racine du projet :
       node scripts/sec-variantes.cjs
   ============================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const cible = path.join(__dirname, '..', 'config.js');
const src = fs.readFileSync(cible, 'utf8');

const NOUVEAU = `/* Le sec, par section. « unite » est ce qu'on compte ; « decimal » autorise
   les demi-cartons. Une référence avec « variantes » se déplie au clic. */
const INVENTAIRE_SEC = [
  /* ==================== CORNETS ET POTS ==================== */
  { id:'cornet',    sec:'Cornets et pots', nom:'Cornets',            unite:'carton', decimal:true,
    variantes:['Petit','Classique','Grand'] },
  { id:'chococone', sec:'Cornets et pots', nom:'Choco-cônes',        unite:'carton', decimal:true,
    variantes:['Petit','Classique','Grand'] },
  { id:'cornetsg',  sec:'Cornets et pots', nom:'Cornets sans gluten',unite:'carton', decimal:true },
  { id:'protege',   sec:'Cornets et pots', nom:'Papier protège-cornet',unite:'carton', decimal:true,
    variantes:['Moyen','Grand'] },
  { id:'conepapier',sec:'Cornets et pots', nom:'Cônes papier',       unite:'carton', decimal:true,
    variantes:['Petit','Grand'] },
  { id:'pot',       sec:'Cornets et pots', nom:'Pots',               unite:'ramette', decimal:false,
    variantes:['Petit','Classique','Grand','Géant','À partager'] },
  { id:'couvercle', sec:'Cornets et pots', nom:'Couvercles',         unite:'carton', decimal:true,
    variantes:['Petit','Grand'] },

  /* ==================== SERVICE ==================== */
  { id:'couvert',   sec:'Service', nom:'Couverts en bois',           unite:'carton', decimal:true,
    variantes:['Couteau','Cuillère','Fourchette'] },
  { id:'cuillere',  sec:'Service', nom:'Cuillères à glace',          unite:'carton', decimal:true },
  { id:'serviette', sec:'Service', nom:'Serviettes',                 unite:'carton', decimal:true },
  { id:'barquette', sec:'Service', nom:'Barquettes à crêpe',         unite:'carton', decimal:true },
  { id:'gaufrecrepe',sec:'Service', nom:'Gaufres et crêpes plateau', unite:'carton', decimal:true },
  { id:'gobelet',   sec:'Service', nom:'Gobelets',                   unite:'pack', decimal:true,
    variantes:['Expresso','Petit','Moyen','Grand'] },
  { id:'bague',     sec:'Service', nom:'Bagues de gobelet',          unite:'pack', decimal:true,
    variantes:['Petit','Moyen','Grand'] },
  { id:'gobeleteau',sec:'Service', nom:'Gobelets à eau',             unite:'pack', decimal:true },
  { id:'paille',    sec:'Service', nom:'Pailles',                    unite:'carton', decimal:true },
  { id:'creaspearl',sec:'Service', nom:'Creaspearls',                unite:'pack', decimal:true },
  { id:'wafer',     sec:'Service', nom:'Wafers 5p 30 g',             unite:'pack', decimal:true },
  { id:'sucrecristal',sec:'Service', nom:'Sucre cristal individuel', unite:'pack', decimal:true },

  /* ==================== CAFÉ, CHOCOLAT, THÉ ==================== */
  { id:'capsule',   sec:'Café, chocolat, thé', nom:'Capsules à café', unite:'boîte', decimal:true,
    variantes:['Simple','Double','Déca'] },
  { id:'chocochaud',sec:'Café, chocolat, thé', nom:'Chocolat chaud',  unite:'boîte', decimal:true,
    variantes:['Noir','Lait','Noisette','Amande','Blanc','Caramel',
               'Aztèque','Orange cannelle','Gianduja','Coco','Panettone'] },
  { id:'tablette',  sec:'Café, chocolat, thé', nom:'Chocolat 220 g',  unite:'carton', decimal:true,
    variantes:['Noir','Lait','Noisette'] },
  { id:'the',       sec:'Café, chocolat, thé', nom:'Thés',            unite:'boîte', decimal:true,
    variantes:['Breakfast','Earl grey','Vert','Vert Yuanne','Rooibos',
               'Infusion pomme orange'] },

  /* ==================== BOISSONS ET FRAIS ==================== */
  { id:'boisson',   sec:'Boissons et frais', nom:'Boissons',          unite:'pack', decimal:true,
    variantes:['San Pellegrino','Evian 50 cl','Evian 1 L','Coca Cola','Coca zéro','Fusitea'] },
  { id:'lait',      sec:'Boissons et frais', nom:'Lait',              unite:'brique', decimal:false },
  { id:'creme',     sec:'Boissons et frais', nom:'Crème pour chantilly',unite:'brique', decimal:false },

  /* ==================== COULIS ET TOPPINGS ==================== */
  { id:'coulis',    sec:'Coulis et toppings', nom:'Coulis',           unite:'flacon', decimal:true,
    variantes:['Chocolat','Pistache','Caramel','Gianduja'] },
  { id:'topping',   sec:'Coulis et toppings', nom:'Toppings sur glace',unite:'pot', decimal:true,
    variantes:['Pistache','Noisette','Caramel','Café'] },

  /* ==================== EMBALLAGES À EMPORTER ==================== */
  { id:'sackraft',  sec:'Emballages', nom:'Sacs kraft',               unite:'carton', decimal:true,
    variantes:['Petit','Grand'] },
  { id:'macaroncarton',sec:'Emballages', nom:'Cartons macarons',     unite:'carton', decimal:true,
    variantes:['Petit 2p','Moyen 4p'] },
  { id:'isobox',    sec:'Emballages', nom:'ISO box 12 macarons',      unite:'carton', decimal:true },
  { id:'isobac',    sec:'Emballages', nom:'ISO bacs',                 unite:'carton', decimal:true,
    variantes:['1100 ml','550 ml'] },
  { id:'papier',    sec:'Emballages', nom:'Rouleaux',                 unite:'rouleau', decimal:false,
    variantes:['Papier TPE','Papier caisse','Sopalin'] },

  /* ==================== ENTRETIEN ==================== */
  { id:'desinfectant',sec:'Entretien', nom:'Désinfectants',           unite:'flacon', decimal:true,
    variantes:['Bactalim','Moussana','Savon main','Produit sol','Produit à vitres'] },
  { id:'lavette',   sec:'Entretien', nom:'Lavettes',                  unite:'pack', decimal:true,
    variantes:['Rose','Jaune','Bleue'] },
  { id:'guillere',  sec:'Entretien', nom:'Guillère à glace',          unite:'pack', decimal:true },
  { id:'sacpoubelle',sec:'Entretien', nom:'Sacs poubelle',            unite:'rouleau', decimal:false },

  /* ==================== SURGELÉ ==================== */
  { id:'crepe',     sec:'Surgelé', nom:'Crêpes',                      unite:'carton', decimal:true },
  { id:'gaufre',    sec:'Surgelé', nom:'Gaufres',                     unite:'carton', decimal:true },
  { id:'cookie',    sec:'Surgelé', nom:'Cookies',                     unite:'carton', decimal:true },
  { id:'macclassico', sec:'Surgelé', nom:'Macarons Classico',         unite:'boîte', decimal:false,
    variantes:['Cioccolato Amorino','Pistacchio','Vaniglia','Caramello',
               'Lampone','Tiramisù','Fior di latte & coulis exotique',
               'Litchi framboise rose','Cacahuète','Mangue'] },
  { id:'macgrandioso',sec:'Surgelé', nom:'Macarons Grandioso',        unite:'boîte', decimal:false,
    variantes:['Cioccolato','Pistacchio','Vaniglia','Lampone'] },
  { id:'gianduiotto', sec:'Surgelé', nom:'Gianduiotto',               unite:'boîte', decimal:true,
    variantes:['Chocolat noir & gelato chocolat',
               'Chocolat au lait & gelato noisette',
               'Chocolat blanc & gelato pistache'] }
];

/* Sections dans l'ordre d'affichage, avec leur couleur. Le code couleur est
   celui de la fiche papier Amorino : les filles le connaissent déjà. */
const SEC_SECTIONS = [
  { id:'Cornets et pots',     couleur:'sable',   teinte:'#FDF3E3' },
  { id:'Service',             couleur:'rose',    teinte:'#FCE7F3' },
  { id:'Café, chocolat, thé', couleur:'corail',  teinte:'#FEE2E2' },
  { id:'Boissons et frais',   couleur:'ciel',    teinte:'#DBEAFE' },
  { id:'Coulis et toppings',  couleur:'lavande', teinte:'#EDE9FE' },
  { id:'Emballages',          couleur:'menthe',  teinte:'#D1FAE5' },
  { id:'Entretien',           couleur:'gris',    teinte:'#F1F5F9' },
  { id:'Surgelé',             couleur:'glace',   teinte:'#E0F2FE' }
];

/* Nombre de lignes réellement à compter, déclinaisons comprises. */
const SEC_LIGNES = INVENTAIRE_SEC.reduce(
  (n, r) => n + (r.variantes ? r.variantes.length : 1), 0);`;

const d = src.indexOf('const INVENTAIRE_SEC');
if (d < 0) { console.error('INVENTAIRE_SEC introuvable.'); process.exit(1); }
let deb = d;
const avant = src.lastIndexOf('/*', d);
if (avant > 0 && src.slice(avant, d).indexOf('*/') === src.slice(avant, d).lastIndexOf('*/')
    && d - avant < 600) deb = avant;

/* Fin : on englobe SEC_SECTIONS et SEC_LIGNES s'ils existent déjà. */
let f = src.indexOf('];', d);
if (f < 0) { console.error('Fin du tableau introuvable.'); process.exit(1); }
f += 2;
for (const nom of ['const SEC_SECTIONS', 'const SEC_LIGNES']) {
  const suite = src.slice(f, f + 900);
  const i = suite.indexOf(nom);
  if (i >= 0) { const fin = suite.indexOf(';', i); if (fin >= 0) f += fin + 1; }
}

const resultat = src.slice(0, deb) + NOUVEAU + src.slice(f);
try { new Function(resultat); }
catch (e) { console.error('ABANDON — ne compile pas : ' + e.message); process.exit(1); }

const sauvegarde = cible + '.avant-sec';
if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, src, 'utf8');
fs.writeFileSync(cible, resultat, 'utf8');

const refs = (NOUVEAU.match(/\{ id:/g) || []).length;
const lignes = [...NOUVEAU.matchAll(/variantes:\[([^\]]*)\]/g)]
  .reduce((n, m) => n + m[1].split(',').length, 0);
console.log('Catalogue du sec : ' + refs + ' références, ' + lignes + ' déclinaisons, 8 sections.');
console.log('  Unités affichées avant la saisie, décimales autorisées où ça a du sens.');
console.log('Sauvegarde : config.js.avant-sec');
