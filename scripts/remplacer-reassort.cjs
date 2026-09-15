/* =============================================================================
   scripts/remplacer-reassort.cjs
   Remplace la liste de réassort par celle relevée en boutique, en deux
   sections : le sec et le surgelé.

   L'ancienne liste de 34 points était une invention de départ. Celle-ci vient
   du terrain : elle regroupe ce qui se compte ensemble — « cornets, toutes
   tailles » plutôt que trois lignes distinctes — pour qu'un réassort tienne à
   l'écran sans faire défiler.

   Usage, depuis la racine du projet :
       node scripts/remplacer-reassort.cjs
   Le script vérifie la syntaxe avant d'écrire et sauvegarde l'original.
   ============================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const cible = path.join(__dirname, '..', 'config.js');
const src = fs.readFileSync(cible, 'utf8');

const NOUVEAU = `const REASSORT = [
  /* --- SEC : ce qui se recharge depuis la réserve --- */
  { id: 'r01', cat: 'Sec', nom: 'Cornets, choco-cône, sans gluten', detail: 'toutes tailles', unite: 'sachet' },
  { id: 'r02', cat: 'Sec', nom: 'Papier protège-cornet',           unite: 'paquet' },
  { id: 'r03', cat: 'Sec', nom: 'Pots',                            detail: 'toutes tailles', unite: 'pile' },
  { id: 'r04', cat: 'Sec', nom: 'Cuillères à glace',               detail: '2 sachets', unite: 'sachet' },
  { id: 'r05', cat: 'Sec', nom: 'Serviettes',                      detail: '4 paquets', unite: 'paquet' },
  { id: 'r06', cat: 'Sec', nom: 'Barquettes à crêpe',              unite: 'paquet' },
  { id: 'r07', cat: 'Sec', nom: 'Toppings',                        detail: 'pistache, noisette, caramel, café', unite: 'pot' },
  { id: 'r08', cat: 'Sec', nom: 'Coulis',                          detail: 'gianduja, chocolat, caramel, pistache', unite: 'flacon' },
  { id: 'r09', cat: 'Sec', nom: 'Sopalin',                         detail: '1 rouleau', unite: 'rouleau' },
  { id: 'r10', cat: 'Sec', nom: 'Gobelets',                        detail: '4 tailles', unite: 'pile' },
  { id: 'r11', cat: 'Sec', nom: 'Capsules à café',                 detail: 'simple, double, décaféiné', unite: 'boîte' },
  { id: 'r12', cat: 'Sec', nom: 'Sachets de chocolat chaud',       unite: 'boîte' },
  { id: 'r13', cat: 'Sec', nom: 'Boissons',                        detail: 'coca, Evian…', unite: 'pack' },
  { id: 'r14', cat: 'Sec', nom: 'Lait et crème pour chantilly',    unite: 'brique' },
  { id: 'r15', cat: 'Sec', nom: 'Pailles',                         unite: 'paquet' },
  { id: 'r16', cat: 'Sec', nom: 'Papier TPE',                      unite: 'rouleau' },
  { id: 'r17', cat: 'Sec', nom: 'Lavettes',                        detail: 'rose, jaune, bleue, verte', unite: 'paquet' },

  /* --- SURGELÉ : ce qui remonte de la chambre froide --- */
  { id: 'r20', cat: 'Surgelé', nom: 'Glaces pour la journée',      unite: 'bac' },
  { id: 'r21', cat: 'Surgelé', nom: 'Macarons',                    detail: 'classico et grandioso', unite: 'boîte' },
  { id: 'r22', cat: 'Surgelé', nom: 'Gianduiotto',                 unite: 'boîte' },
  { id: 'r23', cat: 'Surgelé', nom: 'Crêpes',                      unite: 'paquet' },
  { id: 'r24', cat: 'Surgelé', nom: 'Gaufres',                     unite: 'paquet' },
  { id: 'r25', cat: 'Surgelé', nom: 'Cookies',                     unite: 'paquet' }
];

`;

const d = src.indexOf('const REASSORT = [');
const f = src.indexOf('const REASSORT_CATS');
if (d < 0 || f < 0 || f < d) {
  console.error('Bornes introuvables — rien n’a été modifié.');
  process.exit(1);
}

let resultat = src.slice(0, d) + NOUVEAU + src.slice(f);

/* Les catégories suivent : deux sections au lieu de trois. */
resultat = resultat.replace(
  /const REASSORT_CATS = \[[\s\S]*?\];/,
  `const REASSORT_CATS = [
  { id: 'Sec',     icone: '', couleur: 'sable'  },
  { id: 'Surgelé', icone: '', couleur: 'menthe' }
];`);

try {
  new Function(resultat);
} catch (e) {
  console.error('ABANDON — le résultat ne compile pas : ' + e.message);
  process.exit(1);
}

const sauvegarde = cible + '.avant-reassort';
if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, src, 'utf8');
fs.writeFileSync(cible, resultat, 'utf8');

const avant = (src.slice(d, f).match(/\{ id:/g) || []).length;
const apres = (NOUVEAU.match(/\{ id:/g) || []).length;
console.log('Réassort remplacé : ' + avant + ' points → ' + apres + ' points.');
console.log('  Sec      : 17');
console.log('  Surgelé  : 6');
console.log('Sauvegarde : config.js.avant-reassort');
