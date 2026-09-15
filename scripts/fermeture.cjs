/* =============================================================================
   scripts/fermeture.cjs
   Remplace la procédure de fermeture par celle relevée en boutique.

   L'ancienne version séparait « avant » et « après la fermeture aux clients ».
   Cette distinction ne correspondait à rien dans le déroulé réel : l'équipe
   enchaîne les gestes sans y penser. Un seul bloc, dans l'ordre où ça se fait.

   Usage, depuis la racine du projet :
       node scripts/fermeture.cjs
   Le script vérifie la syntaxe avant d'écrire et sauvegarde l'original.
   ============================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const cible = path.join(__dirname, '..', 'config.js');
const src = fs.readFileSync(cible, 'utf8');

const NOUVEAU = `  /* Un seul bloc : la distinction « avant » et « après la fermeture aux clients »
     ne correspondait pas au déroulé réel. Ordre relevé en boutique. */
  fermeture: [
    { bloc: 'Fermeture', taches: [
      { id:'f01', t:'Ajouter les quarts de glace' },
      { id:'f02', t:'Nettoyer les bacs de glace' },
      { id:'f03', t:'Ranger les glaces et macarons dans le frigo −13 °C' },
      { id:'f04', t:'Éteindre la vitrine et nettoyer les surfaces en inox' },
      { id:'f05', t:'Nettoyer la machine à chantilly' },
      { id:'f06', t:'Éteindre les appareils à crêpes et gaufres' },
      { id:'f07', t:'Mettre les ustensiles dans le grand bac en inox avec du Bactalim' },
      { id:'f08', t:'Nettoyer la machine à café' },
      { id:'f09', t:'Nettoyer la machine à milk-shake' },
      { id:'f10', t:'Ranger la terrasse et fermer le store' },
      { id:'f11', t:'Vider les poubelles intérieures et extérieures' },
      { id:'f12', t:'Nettoyer les surfaces en marbre noir et l’inox des frigos : portes, joints, poignées' },
      /* Ces deux-là ne se cochent pas à la main : elles se constatent quand
         l'action a réellement eu lieu dans son écran. */
      { id:'f13', t:'Compter le fond de caisse et clôturer la journée', lien:'caisse', obligatoire:true },
      { id:'f14', t:'Relever les températures des frigos', lien:'temp', obligatoire:true },
      { id:'f15', t:'Éteindre la lumière' },
      /* Saison froide seulement : la machine ne tourne pas l'été. */
      { id:'f16', t:'Nettoyer la machine à chocolat chaud', mois:[10,11,12,1,2,3] }
    ]}
  ]
};
`;

const d = src.indexOf('  fermeture: [');
const f = src.indexOf('};', d);
if (d < 0 || f < 0) {
  console.error('Bornes introuvables — rien n’a été modifié.');
  process.exit(1);
}

const resultat = src.slice(0, d) + NOUVEAU + src.slice(f + 3);

try { new Function(resultat); }
catch (e) {
  console.error('ABANDON — ne compile pas : ' + e.message);
  process.exit(1);
}

const sauvegarde = cible + '.avant-fermeture';
if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, src, 'utf8');
fs.writeFileSync(cible, resultat, 'utf8');

const avant = (src.slice(d, f).match(/\{ id:/g) || []).length;
const apres = (NOUVEAU.match(/\{ id:/g) || []).length;
console.log('Fermeture remplacée : ' + avant + ' tâches → ' + apres + ', en un seul bloc.');
console.log('Sauvegarde : config.js.avant-fermeture');
