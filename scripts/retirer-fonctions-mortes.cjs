/* =============================================================================
   scripts/retirer-fonctions-mortes.cjs

   Deux fonctions ne sont appelées nulle part, vérification faite ligne par ligne :

     debutNaturel (app.js)
       Calculait le début naturel d'une période. Remplacée quand on est passé au
       choix manuel de la date de départ par le manager.

     scannerPhotoNatif (ocr.js)
       Ancien repli sur l'appareil photo natif. Le repli existe désormais à
       l'intérieur de scannerPhoto, qui rattrape le refus de caméra et enchaîne
       sur l'entrée fichier. Son propre commentaire annonçait sa suppression.

   Les six autres fonctions que mon audit avait signalées sont en réalité
   utilisées : elles sont référencées par affectation — « onclick = maFonction »
   — et non par appel direct, ce que la mesure ne voyait pas.

   Usage, depuis la racine du projet :
       node scripts/retirer-fonctions-mortes.cjs
   ============================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const MORTES = {
  'app.js': ['debutNaturel'],
  'ocr.js': ['scannerPhotoNatif']
};

/* Fin d'un bloc de fonction, en ignorant les accolades des chaînes et des
   commentaires : une recherche naïve couperait au milieu d'un fragment HTML. */
function finDuBloc(src, depart) {
  let i = src.indexOf('{', depart);
  if (i < 0) return -1;
  let niveau = 0, dans = null;
  for (; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
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
        let j = i + 1;
        while (j < src.length && /[\s;]/.test(src[j])) { if (src[j] === '\n') { j++; break; } j++; }
        return j;
      }
    }
  }
  return -1;
}

/* Un commentaire de bloc juste au-dessus de la fonction part avec elle. */
function debutAvecCommentaire(src, debut) {
  const avant = src.slice(0, debut);
  const m = avant.match(/\/\*[\s\S]*?\*\/\s*$/);
  return m ? debut - m[0].length : debut;
}

let total = 0;
for (const fichier of Object.keys(MORTES)) {
  const cible = path.join(__dirname, '..', fichier);
  if (!fs.existsSync(cible)) { console.log(fichier + ' : absent'); continue; }

  const original = fs.readFileSync(cible, 'utf8');
  let src = original;
  let n = 0, lignes = 0;

  for (const nom of MORTES[fichier]) {
    /* Sécurité : on refuse de supprimer si la fonction est référencée ailleurs. */
    const refs = (src.match(new RegExp('\\b' + nom + '\\b', 'g')) || []).length;
    if (refs > 1) {
      console.log('  ' + fichier + ' : ' + nom + ' référencée ' + refs +
                  ' fois — NON supprimée, vérifiez à la main');
      continue;
    }

    const re = new RegExp('(^|\\n)\\s*(?:async\\s+)?function\\s+' + nom + '\\s*\\(', 'g');
    const m = re.exec(src);
    if (!m) { console.log('  ' + fichier + ' : ' + nom + ' introuvable'); continue; }

    let debut = m.index + (m[1] ? m[1].length : 0);
    debut = debutAvecCommentaire(src, debut);
    const fin = finDuBloc(src, m.index);
    if (fin < 0) { console.log('  ' + fichier + ' : fin de ' + nom + ' introuvable'); continue; }

    lignes += src.slice(debut, fin).split('\n').length - 1;
    src = src.slice(0, debut) + src.slice(fin);
    n++;
  }

  if (!n) { console.log(fichier.padEnd(10) + ' : rien à faire'); continue; }

  try { new Function(src); }
  catch (e) {
    console.error(fichier + ' : ABANDON — ne compile pas (' + e.message + ')');
    process.exitCode = 1;
    continue;
  }

  const sauvegarde = cible + '.avant-fonctions';
  if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, original, 'utf8');
  fs.writeFileSync(cible, src, 'utf8');
  console.log(fichier.padEnd(10) + ' : ' + n + ' fonction(s), ' + lignes + ' lignes retirées');
  total += lignes;
}

console.log('\nTotal : ' + total + ' lignes.');
