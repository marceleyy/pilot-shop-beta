/* =============================================================================
   scripts/familles.cjs
   Met à jour FAMILLES_PRODUIT : unités propres à chaque famille, et saveurs
   pour les coulis et les toppings.

   Deux constats de terrain :

     • L'écran annonçait « Gaufre · 6 bacs ». Une gaufre n'est pas un bac, et
       mélanger les deux dans un total fausse la moyenne — on obtenait
       2,9 litres par bac, soit moins que le plus petit format existant.

     • Un coulis pistache et un coulis caramel sont deux produits distincts,
       avec leur propre lot et leur propre DLC. Les compter ensemble empêchait
       de savoir lequel manque. La « crème fondue » du langage de la boutique,
       c'est le gianduja.

   Usage, depuis la racine du projet :
       node scripts/familles.cjs
   ============================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const cible = path.join(__dirname, '..', 'config.js');
const src = fs.readFileSync(cible, 'utf8');

const d = src.indexOf('const FAMILLES_PRODUIT = [');
if (d < 0) { console.error('FAMILLES_PRODUIT introuvable.'); process.exit(1); }
const f = src.indexOf('];', d);
if (f < 0) { console.error('Fin du tableau introuvable.'); process.exit(1); }

const NOUVEAU = `const FAMILLES_PRODUIT = [
  { id:'glace',        libelle:'Glace',              parfums:true,  dlc:'gelato',
    unite:'bac',    unites:'bacs' },
  { id:'mac_classico', libelle:'Macarons Classico',  parfums:false, dlc:'macaron_gelato',
    unite:'boîte',  unites:'boîtes' },
  { id:'mac_grandioso',libelle:'Macarons Grandioso', parfums:false, dlc:'macaron_gelato',
    unite:'boîte',  unites:'boîtes' },
  { id:'gianduiotto',  libelle:'Gianduiotto',        parfums:false, dlc:'gianduiotto',
    unite:'boîte',  unites:'boîtes' },
  { id:'gaufre',       libelle:'Gaufre',             parfums:false, dlc:'gaufre',
    unite:'paquet', unites:'paquets' },
  { id:'crepe',        libelle:'Crêpe',              parfums:false, dlc:'crepe_negatif',
    unite:'paquet', unites:'paquets' },
  { id:'chantilly',    libelle:'Chantilly',          parfums:false, dlc:'chantilly',
    unite:'brique', unites:'briques' },
  /* Coulis et toppings ont des saveurs, comme les glaces ont des parfums.
     Le gianduja est ce que l'équipe appelle la crème fondue. */
  { id:'coulis',       libelle:'Coulis',             parfums:true,  dlc:'coulis',
    unite:'flacon', unites:'flacons',
    saveurs:['Gianduja','Chocolat','Caramel','Pistache','Dulce de leche'] },
  { id:'topping',      libelle:'Topping',            parfums:true,  dlc:'topping',
    unite:'pot',    unites:'pots',
    saveurs:['Pistache','Noisette','Caramel','Café'] }
];`;

const resultat = src.slice(0, d) + NOUVEAU + src.slice(f + 2);

try { new Function(resultat); }
catch (e) {
  console.error('ABANDON — ne compile pas : ' + e.message);
  process.exit(1);
}

const sauvegarde = cible + '.avant-familles';
if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, src, 'utf8');
fs.writeFileSync(cible, resultat, 'utf8');

console.log('FAMILLES_PRODUIT mis à jour.');
console.log('  unités : bac, boîte, paquet, brique, flacon, pot');
console.log('  coulis  : Gianduja, Chocolat, Caramel, Pistache, Dulce de leche');
console.log('  toppings: Pistache, Noisette, Caramel, Café');
