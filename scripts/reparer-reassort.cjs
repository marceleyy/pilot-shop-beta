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
     Les intitulés reprennent ceux de l'inventaire : même vocabulaire des deux
     côtés, sinon on ne retrouve pas le produit qu'on vient de signaler. */
  { id: 'r01', cat: 'Sec', nom: 'Cornets',                detail: 'bambino, piccolo, classico, grande', unite: 'sachet' },
  { id: 'r02', cat: 'Sec', nom: 'Choco-cônes',            detail: 'toutes tailles', unite: 'sachet' },
  { id: 'r03', cat: 'Sec', nom: 'Cornets sans gluten',    unite: 'sachet' },
  { id: 'r04', cat: 'Sec', nom: 'Papier protège-cornet',  detail: 'moyen et grand', unite: 'paquet' },
  { id: 'r05', cat: 'Sec', nom: 'Pots',                   detail: 'piccolo à grandissimo', unite: 'pile' },
  { id: 'r06', cat: 'Sec', nom: 'Couvercles',             detail: 'couteau, cuillère, fourchette', unite: 'pile' },
  { id: 'r07', cat: 'Sec', nom: 'Cuillères à glace',      detail: '2 sachets', unite: 'sachet' },
  { id: 'r08', cat: 'Sec', nom: 'Serviettes',             detail: '4 paquets', unite: 'paquet' },
  { id: 'r09', cat: 'Sec', nom: 'Barquettes à crêpe',     unite: 'paquet' },
  { id: 'r10', cat: 'Sec', nom: 'Gobelets',               detail: '4 tailles', unite: 'pile' },
  { id: 'r11', cat: 'Sec', nom: 'Capsules à café',        detail: 'simple, double, décaféiné', unite: 'boîte' },
  { id: 'r12', cat: 'Sec', nom: 'Chocolat chaud',         detail: '10 parfums', unite: 'boîte' },
  { id: 'r13', cat: 'Sec', nom: 'Toppings',               detail: 'pistache, noisette, caramel, café', unite: 'pot' },
  { id: 'r14', cat: 'Sec', nom: 'Coulis',                 detail: 'gianduja, chocolat noir, caramel, pistache', unite: 'flacon' },
  { id: 'r15', cat: 'Sec', nom: 'Éclats de caramel',      unite: 'pot' },
  { id: 'r16', cat: 'Sec', nom: 'Mocca beans',            unite: 'boîte' },
  { id: 'r17', cat: 'Sec', nom: 'Lait',                   unite: 'brique' },
  { id: 'r18', cat: 'Sec', nom: 'Crème pour chantilly',   unite: 'brique' },
  { id: 'r19', cat: 'Sec', nom: 'Boissons',               detail: 'coca, Evian 50 cl et 1 L…', unite: 'pack' },
  { id: 'r20', cat: 'Sec', nom: 'Pailles',                unite: 'paquet' },
  { id: 'r21', cat: 'Sec', nom: 'Papier TPE',             unite: 'rouleau' },
  { id: 'r22', cat: 'Sec', nom: 'Sopalin',                detail: '1 rouleau', unite: 'rouleau' },
  { id: 'r23', cat: 'Sec', nom: 'Lavettes',               detail: 'rose, jaune, bleue, verte', unite: 'paquet' },

  /* --- SURGELÉ : ce qui remonte de la chambre froide --- */
  { id: 'r30', cat: 'Surgelé', nom: 'Glaces pour la journée', unite: 'bac' },
  { id: 'r31', cat: 'Surgelé', nom: 'Macarons',               detail: 'classico et grandioso', unite: 'boîte' },
  { id: 'r32', cat: 'Surgelé', nom: 'Gianduiotto',            unite: 'boîte' },
  { id: 'r33', cat: 'Surgelé', nom: 'Crêpes',                 unite: 'paquet' },
  { id: 'r34', cat: 'Surgelé', nom: 'Gaufres',                unite: 'paquet' },
  { id: 'r35', cat: 'Surgelé', nom: 'Cookies',                unite: 'paquet' }
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
