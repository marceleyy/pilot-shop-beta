/* =============================================================================
   scripts/sec-variantes.cjs

   Catalogue du sec, relevé sur la FICHE STOCK OPÉRATIONNEL Amorino de la
   boutique — le document papier de référence, annoté à la main par l'équipe.

   Ce que la fiche corrige par rapport à ce que j'avais écrit :
     • pas de « Bambino » : les cornets sont petit, classique, grand ;
     • les pots ont un « Géant » et un « Pot à partager » ;
     • les gobelets sont expresso, petit, moyen, grand — pas quatre tailles
       anonymes — et ont chacun leur bague ;
     • les coulis sont chocolat, pistache, caramel, gianduja ;
     • les toppings ont six références, pas quatre ;
     • il existe des chocolats en tablette 220 g, cinq thés, des sacs kraft,
       des ISO box et bacs, des pâtes à tartiner.

   Les articles barrés au marqueur sur la fiche — pot à partager, couvercles,
   cône papier classique, fourchette, serviette, paille, touillette, gobelet
   expresso, pâtes à tartiner, amarena pot, boîtes de wafer, poudre de cacao,
   sucre glace, mini wafer, films et sacs isothermes — sont retirés du
   catalogue : l'équipe a signifié qu'elle ne les compte plus.

   Une référence sans déclinaison garde une seule ligne. Une référence avec
   déclinaisons se déplie au clic. Chaque entrée porte un identifiant stable :
   c'est lui qui sert de clé, pour qu'un changement de nom ne perde pas
   l'historique.

   Le script est REJOUABLE : il remplace aussi le SEC_LIGNES qu'il a pu écrire
   à un passage précédent.

   Usage, depuis la racine du projet :
       node scripts/sec-variantes.cjs
   ============================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const cible = path.join(__dirname, '..', 'config.js');
const src = fs.readFileSync(cible, 'utf8');

const NOUVEAU = `/* Le sec, relevé sur la fiche stock opérationnel Amorino de la boutique.
   « min » est le seuil de réassort annoté à la main sur la fiche, quand il
   est lisible ; on le garde comme repère, pas comme règle. */
const INVENTAIRE_SEC = [
  /* --- Pots et cornets --- */
  { id:'pot',       nom:'Pots',                     unite:'box',
    variantes:['Petit','Classique','Grand','Géant'] },
  { id:'cornet',    nom:'Cornets',                  unite:'box',
    variantes:['Petit','Classique','Grand'] },
  { id:'cornetsg',  nom:'Cornets sans gluten',      unite:'cornet' },
  { id:'chococone', nom:'Choco-cônes',              unite:'box',
    variantes:['Petit','Classique','Grand'] },
  { id:'conepapier',nom:'Cônes papier',             unite:'box',
    variantes:['Petit','Grand'] },

  /* --- Café, chocolat, thé --- */
  { id:'capsule',   nom:'Capsules à café',          unite:'boîte',
    variantes:['Simple','Double','Déca'] },
  { id:'chocochaud',nom:'Chocolat chaud',           unite:'boîte',
    variantes:['Noir','Lait','Noisette','Amande','Blanc','Caramel',
               'Aztèque','Orange cannelle','Gianduja','Coco','Panettone'] },
  { id:'tablette',  nom:'Chocolat 220 g',           unite:'box',
    variantes:['Noir','Lait','Noisette'] },
  { id:'the',       nom:'Thés',                     unite:'box',
    variantes:['Breakfast','Earl grey','Vert','Vert Yuanne','Rooibos',
               'Infusion pomme orange'] },

  /* --- Service --- */
  { id:'gaufrecrepe',nom:'Gaufres et crêpes plateau',unite:'box' },
  { id:'cuillere',  nom:'Cuillères en bois',        unite:'pack' },
  { id:'couteau',   nom:'Couteaux en bois',         unite:'pack' },
  { id:'gobelet',   nom:'Gobelets',                 unite:'pack',
    variantes:['Expresso','Petit','Moyen','Grand'] },
  { id:'bague',     nom:'Bagues de gobelet',        unite:'pack',
    variantes:['Petit','Moyen','Grand'] },
  { id:'creaspearl',nom:'Creaspearls',              unite:'pack' },
  { id:'wafer',     nom:'Wafers 5p 30 g',           unite:'pack' },

  /* --- Boissons --- */
  { id:'boisson',   nom:'Boissons',                 unite:'pack',
    variantes:['San Pellegrino','Evian','Evian 1 L','Coca Cola','Coca zéro','Fusitea'] },
  { id:'gobeleteau',nom:'Gobelets à eau',           unite:'pack' },
  { id:'lait',      nom:'Lait',                     unite:'brique' },

  /* --- Coulis et toppings --- */
  { id:'coulis',    nom:'Coulis',                   unite:'flacon',
    variantes:['Chocolat','Pistache','Caramel','Gianduja'] },
  { id:'topping',   nom:'Toppings sur glace',       unite:'sachet',
    variantes:['Pistache','Noisette','Éclats de noisette',
               'Éclats de caramel','Cacao cagé','Amarena'] },
  { id:'sucrecristal',nom:'Sucre cristal individuel',unite:'pack' },

  /* --- Emballages à emporter --- */
  { id:'sackraft',  nom:'Sacs kraft',               unite:'box',
    variantes:['Petit','Grand'] },
  { id:'macaroncarton',nom:'Cartons macarons',      unite:'carton',
    variantes:['Petit 2p','Moyen 4p'] },
  { id:'isobox',    nom:'ISO box 12 macarons',      unite:'box' },
  { id:'isobac',    nom:'ISO bacs',                 unite:'box',
    variantes:['1100 ml','550 ml'] },

  /* --- Entretien --- */
  { id:'guillere',  nom:'Guillère à glace',         unite:'pack' },
  { id:'bobine',    nom:'Bobine de papier',         unite:'pack' },
  { id:'moussana',  nom:'Moussana',                 unite:'flacon' },
  { id:'bactalim',  nom:'Bactalim',                 unite:'flacon' },
  { id:'savon',     nom:'Savon main',               unite:'flacon' },
  { id:'sacpoubelle',nom:'Sacs poubelle',           unite:'rouleau' },
  { id:'produitsol',nom:'Produit sol',              unite:'flacon' },
  { id:'lavette',   nom:'Lavettes',                 unite:'pack',
    variantes:['Rose','Jaune','Bleue'] },
  { id:'vitres',    nom:'Produit à vitres',         unite:'flacon' },

  /* --- Surgelé, compté avec le sec car même fiche --- */
  { id:'macclassico', nom:'Macarons Classico',      unite:'boîte',
    variantes:['Cioccolato Amorino','Pistacchio','Vaniglia','Caramello',
               'Lampone','Tiramisù','Fior di latte & coulis exotique',
               'Litchi framboise rose','Cacahuète','Mangue'] },
  { id:'macgrandioso',nom:'Macarons Grandioso',     unite:'boîte',
    variantes:['Cioccolato','Pistacchio','Vaniglia','Lampone'] },
  { id:'gianduiotto', nom:'Gianduiotto',            unite:'boîte',
    variantes:['Chocolat noir & gelato chocolat',
               'Chocolat au lait & gelato noisette',
               'Chocolat blanc & gelato pistache'] },
  { id:'gaufre',    nom:'Gaufres',                  unite:'paquet' },
  { id:'crepe',     nom:'Crêpes',                   unite:'paquet' },
  { id:'cookie',    nom:'Cookies',                  unite:'paquet' }
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

let f = src.indexOf('];', d);
if (f < 0) { console.error('Fin du tableau introuvable.'); process.exit(1); }
f += 2;
const suite = src.slice(f, f + 800);
const iL = suite.indexOf('const SEC_LIGNES');
if (iL >= 0) {
  const finL = suite.indexOf(';', iL);
  if (finL >= 0) f += finL + 1;
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
console.log('Catalogue du sec relevé sur la fiche Amorino.');
console.log('  ' + refs + ' références, ' + lignes + ' déclinaisons');
console.log('  Bambino retiré — la fiche ne le connaît pas.');
console.log('Sauvegarde : config.js.avant-sec');
