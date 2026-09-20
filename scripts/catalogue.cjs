/* =============================================================================
   scripts/catalogue.cjs — UN SEUL SCRIPT POUR TOUT LE CATALOGUE

   Lance dans le bon ordre les scripts qui construisent le catalogue, et
   vérifie la compilation à la fin. Un seul point d'entrée, pour ne plus
   oublier une étape ni se tromper d'ordre — ce qui est arrivé trois fois.

   Usage, depuis la racine du projet :
       node scripts/catalogue.cjs
   ============================================================================= */

'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const racine = path.join(__dirname, '..');
const etapes = [
  ['familles.cjs',                'familles de produits (unités, saveurs, lieu)'],
  ['reparer-reassort.cjs',        'catalogue du réassort'],
  ['sec-variantes.cjs',           'catalogue du sec (déclinaisons, sections, couleurs)'],
  ['inventaire-sec-sections.cjs', 'écran d’inventaire du sec'],
  ['catalogue-manager.cjs',       'catalogue modifiable par le manager'],
  ['stock-onglets.cjs',           'écran Stock réel en deux onglets'],
  ['reassort-style.cjs',          'écran de réassort'],
];

console.log('Construction du catalogue — ' + etapes.length + ' étapes\n');
let echecs = 0;
for (const [script, quoi] of etapes) {
  const chemin = path.join(__dirname, script);
  if (!fs.existsSync(chemin)) { console.log('  ✗ ' + script + ' — introuvable'); echecs++; continue; }
  try {
    const out = execSync('node "' + chemin + '"', { cwd: racine, encoding: 'utf8' });
    const derniere = out.trim().split('\n').pop();
    console.log('  ✓ ' + quoi.padEnd(52) + (derniere ? '· ' + derniere.slice(0, 60) : ''));
  } catch (e) {
    console.log('  ✗ ' + quoi);
    console.log('    ' + String(e.stdout || e.message).trim().split('\n').slice(-2).join('\n    '));
    echecs++;
    /* On s'arrête au premier échec : un script qui échoue laisse le fichier
       dans un état que les suivants ne connaissent pas. */
    break;
  }
}

console.log('\nVérification de la syntaxe');
for (const f of ['config.js', 'app.js', 'stock.js', 'modules.js']) {
  try { execSync('node --check "' + path.join(racine, f) + '"', { encoding: 'utf8' });
    console.log('  ✓ ' + f); }
  catch (e) { console.log('  ✗ ' + f + ' : ' + String(e.stderr || e.message).trim().split('\n')[0]); echecs++; }
}

console.log(echecs ? '\n' + echecs + ' problème(s) — ne poussez pas.' : '\nTout est en ordre. Vous pouvez pousser.');
process.exit(echecs ? 1 : 0);
