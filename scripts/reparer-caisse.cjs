/* =============================================================================
   scripts/reparer-caisse.cjs
   Retire le corps de l'ancienne vue Caisse, resté orphelin dans modules.js
   après son remplacement par la version à trois champs.

   Le script supprime tout ce qui se trouve entre la fin de la nouvelle vue
   (« dessiner(); };ration ») et l'en-tête du bloc suivant (« H. TRAÇABILITÉ »),
   puis vérifie que le fichier compile avant d'écrire quoi que ce soit.

   Usage, depuis la racine du projet :
       node scripts/reparer-caisse.cjs
   ============================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const cible = path.join(__dirname, '..', 'modules.js');
const src = fs.readFileSync(cible, 'utf8');

const FIN_NOUVELLE = '  dessiner();\n};\n';
const DEBUT_SUIVANT = '   /* =============================================================================\n      H. TRAÇABILITÉ';

/* On repère la DERNIÈRE occurrence de « dessiner(); }; » avant l'en-tête
   suivant : c'est la fin de la nouvelle vue Caisse. */
const posSuivant = src.indexOf(DEBUT_SUIVANT);
if (posSuivant < 0) {
  console.error('En-tête « H. TRAÇABILITÉ » introuvable — rien n’a été modifié.');
  process.exit(1);
}

const posFin = src.lastIndexOf(FIN_NOUVELLE, posSuivant);
if (posFin < 0) {
  console.error('Fin de la nouvelle vue introuvable — rien n’a été modifié.');
  process.exit(1);
}

const debutResidu = posFin + FIN_NOUVELLE.length;
const residu = src.slice(debutResidu, posSuivant);

if (residu.trim() === '') {
  console.log('Rien à faire : aucun résidu entre les deux blocs.');
  process.exit(0);
}

const resultat = src.slice(0, debutResidu) + '\n' + src.slice(posSuivant);

/* Contrôle de syntaxe avant d'écrire : mieux vaut ne rien faire que casser. */
try {
  new Function(resultat);
} catch (e) {
  console.error('ABANDON — le résultat ne compile pas : ' + e.message);
  console.error('Le fichier n’a pas été modifié.');
  process.exit(1);
}

/* Sauvegarde horodatée, au cas où. */
const sauvegarde = cible + '.avant-reparation';
if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, src, 'utf8');

fs.writeFileSync(cible, resultat, 'utf8');

console.log('Résidu supprimé : ' + residu.length + ' caractères, ' +
            (residu.split('\n').length - 1) + ' lignes.');
console.log('Sauvegarde de l’ancien fichier : modules.js.avant-reparation');
console.log('Syntaxe vérifiée avant écriture.');
