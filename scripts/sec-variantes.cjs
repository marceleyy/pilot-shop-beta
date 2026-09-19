/* =============================================================================
   scripts/sec-variantes.cjs

   Le sec n'est pas une liste plate : presque chaque référence existe en
   plusieurs déclinaisons, et c'est la déclinaison qu'on compte.

   Relevé auprès de la boutique :
     • Cornets : piccola, classico, grande — et les mêmes en choco-cône
     • Papier protège-cornet : moyen et grand
     • Pots : piccolo, classico, grande, grandissimo
     • Couvercles : couteau, cuillère, fourchette
     • Gobelets : quatre tailles
     • Capsules : simple, double, décaféiné
     • Chocolat chaud : plusieurs parfums
     • Lait et crème sont deux produits distincts
     • Pas de pâte à gaufre : seulement des gaufres

   Une référence sans déclinaison garde une seule ligne. Une référence avec
   déclinaisons se déplie au clic : « Cornets : 4 » ne disait pas lequel
   manquait, et c'est précisément ce qu'on a besoin de savoir.

   Usage, depuis la racine du projet :
       node scripts/sec-variantes.cjs
   ============================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const cible = path.join(__dirname, '..', 'config.js');
const src = fs.readFileSync(cible, 'utf8');

const NOUVEAU = `/* Le sec, avec ses déclinaisons. Chaque entrée porte un identifiant stable :
   c'est lui qui sert de clé de comptage, pas le libellé, pour qu'un
   changement de nom ne perde pas l'historique.

   « variantes » vide ou absent = une seule ligne à compter.
   Sinon, la référence se déplie et chaque variante se compte à part. */
const INVENTAIRE_SEC = [
  { id:'cornet',    nom:'Cornets',                  unite:'sachet',
    variantes:['Piccola','Classico','Grande'] },
  { id:'chococone', nom:'Choco-cônes',              unite:'sachet',
    variantes:['Piccola','Classico','Grande'] },
  { id:'cornetsg',  nom:'Cornets sans gluten',      unite:'sachet' },
  { id:'protege',   nom:'Papier protège-cornet',    unite:'paquet',
    variantes:['Moyen','Grand'] },
  { id:'pot',       nom:'Pots',                     unite:'pile',
    variantes:['Piccolo','Classico','Grande','Grandissimo'] },
  { id:'couvercle', nom:'Couvercles',               unite:'pile',
    variantes:['Couteau','Cuillère','Fourchette'] },
  { id:'cuillere',  nom:'Cuillères à glace',        unite:'sachet' },
  { id:'serviette', nom:'Serviettes',               unite:'paquet' },
  { id:'barquette', nom:'Barquettes à crêpe',       unite:'paquet' },
  { id:'gobelet',   nom:'Gobelets',                 unite:'pile',
    variantes:['Taille 1','Taille 2','Taille 3','Taille 4'] },
  { id:'capsule',   nom:'Capsules à café',          unite:'boîte',
    variantes:['Simple','Double','Décaféiné'] },
  { id:'chocochaud',nom:'Sachets de chocolat chaud',unite:'boîte',
    variantes:['Noir','Lait','Blanc','Gianduja','Noisette',
               'Aztèque','Orange cannelle','Caramel','Amande','Coco'] },
  { id:'cafegrain', nom:'Café en grains',           unite:'paquet' },
  { id:'lait',      nom:'Lait',                     unite:'brique' },
  { id:'creme',     nom:'Crème pour chantilly',     unite:'brique' },
  { id:'coulis',    nom:'Coulis',                   unite:'flacon',
    variantes:['Gianduja','Chocolat','Caramel','Pistache','Dulce de leche'] },
  { id:'topping',   nom:'Toppings',                 unite:'pot',
    variantes:['Pistache','Noisette','Caramel','Café'] },
  { id:'gaufre',    nom:'Gaufres',                  unite:'paquet' },
  { id:'crepe',     nom:'Crêpes',                   unite:'paquet' },
  { id:'boisson',   nom:'Boissons',                 unite:'pack',
    variantes:['Coca','Coca zéro','Evian 50 cl','Evian 1 L','San Pellegrino','Ice tea'] },
  { id:'paille',    nom:'Pailles',                  unite:'paquet' },
  { id:'papiertpe', nom:'Papier TPE',               unite:'rouleau' },
  { id:'sopalin',   nom:'Sopalin',                  unite:'rouleau' },
  { id:'bactalim',  nom:'Bactalim',                 unite:'flacon' },
  { id:'degraissant',nom:'Dégraissant',             unite:'flacon' },
  { id:'vitres',    nom:'Produit à vitres',         unite:'flacon' },
  { id:'savon',     nom:'Savon',                    unite:'flacon' },
  { id:'lavette',   nom:'Lavettes',                 unite:'paquet',
    variantes:['Rose','Jaune','Bleue','Verte'] },
  { id:'gants',     nom:'Gants jetables',           unite:'boîte' }
];

/* Nombre de lignes réellement à compter, déclinaisons comprises. */
const SEC_LIGNES = INVENTAIRE_SEC.reduce(
  (n, r) => n + (r.variantes ? r.variantes.length : 1), 0);`;

const d = src.indexOf('const INVENTAIRE_SEC');
if (d < 0) { console.error('INVENTAIRE_SEC introuvable.'); process.exit(1); }
/* On remonte au commentaire qui précède, s'il existe */
let deb = d;
const avant = src.lastIndexOf('/*', d);
if (avant > 0 && src.slice(avant, d).indexOf('*/') === src.slice(avant, d).lastIndexOf('*/')
    && d - avant < 600) deb = avant;
const f = src.indexOf('];', d);
if (f < 0) { console.error('Fin du tableau introuvable.'); process.exit(1); }

const resultat = src.slice(0, deb) + NOUVEAU + src.slice(f + 2);

try { new Function(resultat); }
catch (e) { console.error('ABANDON — ne compile pas : ' + e.message); process.exit(1); }

const sauvegarde = cible + '.avant-sec';
if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, src, 'utf8');
fs.writeFileSync(cible, resultat, 'utf8');

const refs = (NOUVEAU.match(/\{ id:/g) || []).length;
const lignes = [...NOUVEAU.matchAll(/variantes:\[([^\]]*)\]/g)]
  .reduce((n, m) => n + m[1].split(',').length, 0);
console.log('Catalogue du sec mis à jour.');
console.log('  ' + refs + ' références');
console.log('  ' + lignes + ' déclinaisons');
console.log('Sauvegarde : config.js.avant-sec');
