/* =============================================================================
   scripts/reparer-reassort.cjs

   Le réassort, aligné sur l'inventaire du sec. Chaque point porte « ref » :
   l'identifiant de sa référence dans INVENTAIRE_SEC. C'est par cet identifiant
   que les déclinaisons sont trouvées — plus par ressemblance de nom, qui
   faisait hériter à « Gobelets à eau » les quatre tailles de « Gobelets ».

   Corrections du 20 septembre :
     • papier protège-cornet et cônes papier : le même produit ;
     • barquettes à crêpe et plateaux gaufres-crêpes : le même produit ;
     • couvercles → « couvercles gobelet » ;
     • gobelets à eau : une seule taille ;
     • les surgelés n'ont pas de déclinaison au réassort — on remonte « des
       macarons », le détail des parfums est l'affaire de l'inventaire.

   Usage, depuis la racine du projet :
       node scripts/reparer-reassort.cjs
   ============================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const cible = path.join(__dirname, '..', 'config.js');
const src = fs.readFileSync(cible, 'utf8');

const NOUVEAU = `const REASSORT = [
  /* --- SEC : ce qui se recharge depuis la réserve.
     « ref » pointe vers INVENTAIRE_SEC : mêmes déclinaisons, même vocabulaire. */
  { id: 'r01', ref:'cornet',      cat: 'Sec', nom: 'Cornets',                unite: 'carton' },
  { id: 'r02', ref:'chococone',   cat: 'Sec', nom: 'Choco-cônes',            unite: 'carton' },
  { id: 'r03', ref:'cornetsg',    cat: 'Sec', nom: 'Cornets sans gluten',    unite: 'carton' },
  { id: 'r05', ref:'conepapier',  cat: 'Sec', nom: 'Cônes papier',           unite: 'carton' },
  { id: 'r06', ref:'pot',         cat: 'Sec', nom: 'Pots',                   unite: 'ramette' },
  { id: 'r07', ref:'couvercle',   cat: 'Sec', nom: 'Couvercles gobelet',     unite: 'carton' },
  { id: 'r08', ref:'couvert',     cat: 'Sec', nom: 'Couverts en bois',       unite: 'carton' },
  { id: 'r09', ref:'cuillere',    cat: 'Sec', nom: 'Cuillères à glace',      unite: 'carton' },
  { id: 'r10', ref:'serviette',   cat: 'Sec', nom: 'Serviettes',             unite: 'carton' },
  { id: 'r11', ref:'barquette',   cat: 'Sec', nom: 'Barquettes crêpes et gaufres', unite: 'carton' },
  { id: 'r13', ref:'gobelet',     cat: 'Sec', nom: 'Gobelets',               unite: 'pack' },
  { id: 'r14', ref:'bague',       cat: 'Sec', nom: 'Bagues de gobelet',      unite: 'pack' },
  { id: 'r15', ref:'gobeleteau',  cat: 'Sec', nom: 'Gobelets à eau',         unite: 'pack' },
  { id: 'r16', ref:'paille',      cat: 'Sec', nom: 'Pailles',                unite: 'carton' },
  { id: 'r17', ref:'creaspearl',  cat: 'Sec', nom: 'Creaspearls',            unite: 'pack' },
  { id: 'r18', ref:'wafer',       cat: 'Sec', nom: 'Wafers 5p 30 g',         unite: 'pack' },
  { id: 'r19', ref:'sucrecristal',cat: 'Sec', nom: 'Sucre cristal individuel', unite: 'pack' },
  { id: 'r20', ref:'capsule',     cat: 'Sec', nom: 'Capsules à café',        unite: 'boîte' },
  { id: 'r21', ref:'chocochaud',  cat: 'Sec', nom: 'Chocolat chaud',         unite: 'boîte' },
  { id: 'r22', ref:'tablette',    cat: 'Sec', nom: 'Chocolat 220 g',         unite: 'carton' },
  { id: 'r23', ref:'the',         cat: 'Sec', nom: 'Thés',                   unite: 'boîte' },
  { id: 'r24', ref:'boisson',     cat: 'Sec', nom: 'Boissons',               unite: 'pack' },
  { id: 'r25', ref:'lait',        cat: 'Sec', nom: 'Lait',                   unite: 'brique' },
  { id: 'r26', ref:'creme',       cat: 'Sec', nom: 'Crème pour chantilly',   unite: 'brique' },
  { id: 'r27', ref:'coulis',      cat: 'Sec', nom: 'Coulis',                 unite: 'flacon' },
  { id: 'r28', ref:'topping',     cat: 'Sec', nom: 'Toppings sur glace',     unite: 'pot' },
  { id: 'r29', ref:'sackraft',    cat: 'Sec', nom: 'Sacs kraft',             unite: 'carton' },
  { id: 'r30', ref:'macaroncarton',cat: 'Sec', nom: 'Cartons macarons',      unite: 'carton' },
  { id: 'r31', ref:'isobox',      cat: 'Sec', nom: 'ISO box 12 macarons',    unite: 'carton' },
  { id: 'r32', ref:'isobac',      cat: 'Sec', nom: 'ISO bacs',               unite: 'carton' },
  { id: 'r33', ref:'papier',      cat: 'Sec', nom: 'Rouleaux',               unite: 'rouleau' },
  { id: 'r34', ref:'desinfectant',cat: 'Sec', nom: 'Désinfectants',          unite: 'flacon' },
  { id: 'r35', ref:'lavette',     cat: 'Sec', nom: 'Lavettes',               unite: 'pack' },
  { id: 'r36', ref:'guillere',    cat: 'Sec', nom: 'Guillère à glace',       unite: 'pack' },

  /* --- SURGELÉ : ce qui remonte de la chambre froide.
     Sans déclinaison ici : on remonte « des macarons », le détail des parfums
     est l'affaire de l'inventaire chambre froide. */
  { id: 'r40', cat: 'Surgelé', nom: 'Glaces pour la journée', unite: 'bac' },
  { id: 'r41', cat: 'Surgelé', nom: 'Macarons Classico',      unite: 'boîte' },
  { id: 'r42', cat: 'Surgelé', nom: 'Macarons Grandioso',     unite: 'boîte' },
  { id: 'r43', cat: 'Surgelé', nom: 'Gianduiotto',            unite: 'boîte' },
  { id: 'r44', cat: 'Surgelé', nom: 'Crêpes',                 unite: 'carton' },
  { id: 'r45', cat: 'Surgelé', nom: 'Gaufres',                unite: 'carton' },
  { id: 'r46', cat: 'Surgelé', nom: 'Cookies',                unite: 'carton' }
];`;

const d = src.indexOf('const REASSORT = [');
const f = src.indexOf('const REASSORT_CATS');
if (d < 0 || f < 0 || f < d) { console.error('Bornes introuvables.'); process.exit(1); }

const resultat = src.slice(0, d) + NOUVEAU + '\n\n' + src.slice(f);
try { new Function(resultat); }
catch (e) { console.error('ABANDON — ne compile pas : ' + e.message); process.exit(1); }

const sauvegarde = cible + '.avant-reassort2';
if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, src, 'utf8');
fs.writeFileSync(cible, resultat, 'utf8');
console.log('Réassort : ' + (NOUVEAU.match(/\{ id:/g) || []).length + ' points, liés par identifiant à l’inventaire.');
