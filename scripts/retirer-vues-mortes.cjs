/* =============================================================================
   scripts/retirer-vues-mortes.cjs

   Cinq vues sont définies deux fois : une version dans app.js, une autre dans
   modules.js. Comme modules.js est chargé après, c'est lui qui gagne — la
   version d'app.js n'est JAMAIS exécutée. Même chose pour V.lots et V.stock,
   redéfinies par stock.js.

   Ce code mort n'est pas seulement inutile : il est dangereux. Il m'a déjà fait
   modifier la mauvaise version de V.caisse, et il faut ensuite un second script
   pour réparer. On le retire.

   La découpe se fait par comptage d'accolades, en ignorant celles qui se
   trouvent dans une chaîne, un gabarit ou un commentaire — une recherche
   naïve couperait au milieu d'un fragment de HTML.

   Usage, depuis la racine du projet :
       node scripts/retirer-vues-mortes.cjs
   Le script vérifie la syntaxe avant d'écrire et sauvegarde l'original.
   ============================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

/* Vues remplacées plus tard dans la chaîne de chargement.
   Ordre réel : config → auth → app → ocr → modules → stock */
const MORTES = {
  'app.js':     ['accueil', 'caisse', 'lots', 'reglages', 'temp'],
  'modules.js': ['lots', 'stock']
};

/* Fin d'un bloc `V.nom = function () { … };` en tenant compte des chaînes. */
function finDuBloc(src, depart) {
  let i = src.indexOf('{', depart);
  if (i < 0) return -1;
  let niveau = 0;
  let dans = null;          // "'", '"', '`', '//', '/*'
  for (; i < src.length; i++) {
    const c = src[i], d = src[i + 1], p = src[i - 1];

    if (dans === '//') { if (c === '\n') dans = null; continue; }
    if (dans === '/*') { if (c === '*' && d === '/') { dans = null; i++; } continue; }
    if (dans) {
      if (c === '\\') { i++; continue; }
      if (c === dans) dans = null;
      continue;
    }
    if (c === '/' && d === '/') { dans = '//'; i++; continue; }
    if (c === '/' && d === '*') { dans = '/*'; i++; continue; }
    if (c === '\'' || c === '"' || c === '`') { dans = c; continue; }

    if (c === '{') niveau++;
    else if (c === '}') {
      niveau--;
      if (niveau === 0) {
        /* On avale le « ; » de fin et le saut de ligne. */
        let j = i + 1;
        while (j < src.length && /[\s;]/.test(src[j])) {
          if (src[j] === '\n') { j++; break; }
          j++;
        }
        return j;
      }
    }
  }
  return -1;
}

let total = 0;
for (const fichier of Object.keys(MORTES)) {
  const cible = path.join(__dirname, '..', fichier);
  if (!fs.existsSync(cible)) { console.log(fichier + ' : absent'); continue; }

  const original = fs.readFileSync(cible, 'utf8');
  let src = original;
  let retirees = 0, lignes = 0;

  for (const nom of MORTES[fichier]) {
    const re = new RegExp('(^|\\n)\\s*V\\.' + nom + '\\s*=\\s*(async\\s+)?function', 'g');
    const m = re.exec(src);
    if (!m) { console.log('  ' + fichier + ' : V.' + nom + ' introuvable'); continue; }

    const debut = m.index + (m[1] ? m[1].length : 0);
    const fin = finDuBloc(src, debut);
    if (fin < 0) { console.log('  ' + fichier + ' : fin de V.' + nom + ' introuvable, ignorée'); continue; }

    const bloc = src.slice(debut, fin);
    lignes += bloc.split('\n').length - 1;
    src = src.slice(0, debut) +
          '/* V.' + nom + ' : version retirée — elle était remplacée au chargement. */\n' +
          src.slice(fin);
    retirees++;
  }

  if (!retirees) { console.log(fichier + ' : rien à faire'); continue; }

  try {
    new Function(src);
  } catch (e) {
    console.error(fichier + ' : ABANDON — le résultat ne compile pas (' + e.message + ')');
    console.error('  Le fichier n’a pas été modifié.');
    process.exitCode = 1;
    continue;
  }

  const sauvegarde = cible + '.avant-nettoyage';
  if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, original, 'utf8');
  fs.writeFileSync(cible, src, 'utf8');

  console.log(fichier.padEnd(12) + ' : ' + retirees + ' vue(s), ' + lignes + ' lignes retirées');
  total += lignes;
}

console.log('');
console.log('Total : ' + total + ' lignes de code mort supprimées.');
console.log('Sauvegardes : *.avant-nettoyage (à supprimer une fois vérifié)');
