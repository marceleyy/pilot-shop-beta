/* =============================================================================
   scripts/retirer-pins.cjs
   Supprime du code source le tableau des codes PIN, devenu inutile depuis que
   l'équipe est chargée depuis la table « equipe ».

   Tant que ces lignes restent dans config.js, les cinq codes sont lisibles par
   quiconque affiche la source de la page — même si l'application ne s'en sert
   plus. Un secret laissé dans un fichier public n'est pas un secret.

   Usage, depuis la racine du projet :
       node scripts/retirer-pins.cjs
   Le script vérifie la syntaxe avant d'écrire et sauvegarde l'original.
   ============================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const cible = path.join(__dirname, '..', 'config.js');
const src = fs.readFileSync(cible, 'utf8');

const DEBUT = 'const _EQUIPE_IGNOREE = [';
const i = src.indexOf(DEBUT);
if (i < 0) {
  console.log('Rien à faire : le tableau a déjà été retiré.');
  process.exit(0);
}

/* On coupe jusqu'au « ]; » qui ferme le tableau. */
const j = src.indexOf('];', i);
if (j < 0) {
  console.error('Fin du tableau introuvable — rien n’a été modifié.');
  process.exit(1);
}

const retire = src.slice(i, j + 2);
const resultat = src.slice(0, i) + src.slice(j + 2).replace(/^\s*\n/, '');

try {
  new Function(resultat);
} catch (e) {
  console.error('ABANDON — le résultat ne compile pas : ' + e.message);
  process.exit(1);
}

const sauvegarde = cible + '.avec-pins';
if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, src, 'utf8');
fs.writeFileSync(cible, resultat, 'utf8');

const pins = (retire.match(/pin:\s*'(\d+)'/g) || []).length;
console.log('Retiré : ' + (retire.split('\n').length - 1) + ' lignes, ' + pins + ' code(s) PIN.');
console.log('Sauvegarde : config.js.avec-pins  (À NE PAS COMMITTER)');
console.log('');
console.log('Ajoutez-la au .gitignore :');
console.log('    echo config.js.avec-pins >> .gitignore');
