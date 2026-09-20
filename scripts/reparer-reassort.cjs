/* =============================================================================
   scripts/reparer-reassort.cjs

   URGENT — répare config.js : mon édition a inséré la nouvelle liste de
   réassort SANS retirer l'ancienne. Le fichier contient deux tableaux
   imbriqués et ne compile plus.

   Ce script remplace tout le bloc REASSORT par la liste unique, alignée sur
   les déclinaisons de l'inventaire : même vocabulaire des deux côtés, sinon
   on ne retrouve pas le produit qu'on vient de signaler en rupture.

   Usage, depuis la racine du projet :
       node scripts/reparer-reassort.cjs
   ============================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const cible = path.join(__dirname, '..', 'config.js');
const src = fs.readFileSync(cible, 'utf8');

const NOUVEAU = `const REASSORT = [
  /* --- SEC : ce qui se recharge depuis la réserve ---
     Intitulés repris de la fiche stock opérationnel Amorino, les mêmes que
     l'inventaire : sinon on ne retrouve pas le produit qu'on vient de signaler. */
  { id: 'r01', cat: 'Sec', nom: 'Pots',                   detail: 'petit, classique, grand, géant', unite: 'box' },
  { id: 'r02', cat: 'Sec', nom: 'Cornets',                detail: 'petit, classique, grand', unite: 'box' },
  { id: 'r03', cat: 'Sec', nom: 'Cornets sans gluten',    unite: 'cornet' },
  { id: 'r04', cat: 'Sec', nom: 'Choco-cônes',            detail: 'petit, classique, grand', unite: 'box' },
  { id: 'r05', cat: 'Sec', nom: 'Cônes papier',           detail: 'petit et grand', unite: 'box' },
  { id: 'r06', cat: 'Sec', nom: 'Capsules à café',        detail: 'simple, double, déca', unite: 'boîte' },
  { id: 'r07', cat: 'Sec', nom: 'Chocolat chaud',         detail: '11 parfums', unite: 'boîte' },
  { id: 'r08', cat: 'Sec', nom: 'Thés',                   detail: '6 variétés', unite: 'box' },
  { id: 'r09', cat: 'Sec', nom: 'Gaufres et crêpes plateau', unite: 'box' },
  { id: 'r10', cat: 'Sec', nom: 'Cuillères en bois',      unite: 'pack' },
  { id: 'r11', cat: 'Sec', nom: 'Couteaux en bois',       unite: 'pack' },
  { id: 'r12', cat: 'Sec', nom: 'Gobelets',               detail: 'expresso, petit, moyen, grand', unite: 'pack' },
  { id: 'r13', cat: 'Sec', nom: 'Bagues de gobelet',      detail: 'petit, moyen, grand', unite: 'pack' },
  { id: 'r14', cat: 'Sec', nom: 'Creaspearls',            unite: 'pack' },
  { id: 'r15', cat: 'Sec', nom: 'Boissons',               detail: 'San Pellegrino, Evian 50 cl et 1 L, Coca, Fusitea', unite: 'pack' },
  { id: 'r16', cat: 'Sec', nom: 'Gobelets à eau',         unite: 'pack' },
  { id: 'r17', cat: 'Sec', nom: 'Lait',                   unite: 'brique' },
  { id: 'r18', cat: 'Sec', nom: 'Coulis',                 detail: 'chocolat, pistache, caramel, gianduja', unite: 'flacon' },
  { id: 'r19', cat: 'Sec', nom: 'Toppings sur glace',     detail: '6 références', unite: 'sachet' },
  { id: 'r20', cat: 'Sec', nom: 'Sucre cristal individuel', unite: 'pack' },
  { id: 'r21', cat: 'Sec', nom: 'Sacs kraft',             detail: 'petit et grand', unite: 'box' },
  { id: 'r22', cat: 'Sec', nom: 'Cartons macarons',       detail: '2p et 4p', unite: 'carton' },
  { id: 'r23', cat: 'Sec', nom: 'ISO box 12 macarons',    unite: 'box' },
  { id: 'r24', cat: 'Sec', nom: 'ISO bacs',               detail: '1100 et 550 ml', unite: 'box' },
  { id: 'r25', cat: 'Sec', nom: 'Bobine de papier',       unite: 'pack' },
  { id: 'r26', cat: 'Sec', nom: 'Bactalim',               unite: 'flacon' },
  { id: 'r27', cat: 'Sec', nom: 'Lavettes',               detail: 'rose, jaune, bleue', unite: 'pack' },
  { id: 'r28', cat: 'Sec', nom: 'Produit à vitres',       unite: 'flacon' },

  /* --- SURGELÉ : ce qui remonte de la chambre froide --- */
  { id: 'r30', cat: 'Surgelé', nom: 'Glaces pour la journée', unite: 'bac' },
  { id: 'r31', cat: 'Surgelé', nom: 'Macarons Classico',      detail: '10 parfums', unite: 'boîte' },
  { id: 'r32', cat: 'Surgelé', nom: 'Macarons Grandioso',     detail: '4 parfums', unite: 'boîte' },
  { id: 'r33', cat: 'Surgelé', nom: 'Gianduiotto',            detail: '3 enrobages', unite: 'boîte' },
  { id: 'r34', cat: 'Surgelé', nom: 'Crêpes',                 unite: 'paquet' },
  { id: 'r35', cat: 'Surgelé', nom: 'Gaufres',                unite: 'paquet' },
  { id: 'r36', cat: 'Surgelé', nom: 'Cookies',                unite: 'paquet' }
];`;

const d = src.indexOf('const REASSORT = [');
const f = src.indexOf('const REASSORT_CATS');
if (d < 0 || f < 0 || f < d) {
  console.error('Bornes introuvables — rien n’a été modifié.');
  process.exit(1);
}

const resultat = src.slice(0, d) + NOUVEAU + '\n\n' + src.slice(f);

try { new Function(resultat); }
catch (e) {
  console.error('ABANDON — ne compile pas : ' + e.message);
  process.exit(1);
}

const sauvegarde = cible + '.avant-reassort2';
if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, src, 'utf8');
fs.writeFileSync(cible, resultat, 'utf8');

const n = (NOUVEAU.match(/\{ id:/g) || []).length;
console.log('Réassort réparé : ' + n + ' points (23 secs, 6 surgelés).');
console.log('Sauvegarde : config.js.avant-reassort2');
