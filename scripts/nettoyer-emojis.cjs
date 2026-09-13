/* =============================================================================
   scripts/nettoyer-emojis.cjs
   Retire les pictogrammes décoratifs de l'interface.

   Ce qui part : les emojis en tête de libellé de bouton, de titre de section
   et de feuille, ainsi que les pictogrammes logés dans des <span> dédiés.
   Ce qui reste : ✓ ✅ ❌ (états d'une case), ☀️ 🌙 (matin / soir),
   🔴 🟠 🟢 ⚪ (indicateur de synchronisation) — ceux-là portent une
   information, ils ne décorent pas.

   Usage, depuis la racine du projet :
       node scripts/nettoyer-emojis.cjs
   Le script est sans effet s'il est relancé : il ne trouve plus rien à faire.
   ============================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const EMO = '[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}][\\u{FE0F}\\u{20E3}]?';
const GARDE = new Set(['✓', '✅', '❌', '☀️', '🌙']);

/* --- Remplacements exacts, propres à chaque fichier ---------------------- */
const EXACTS = [
  ["'📸 ", "'"], [">📸 ", ">"], ["'📷 ", "'"], [">📷 ", ">"],
  [">📌 Épingler<", ">Épingler<"], [">🛡️ Registre<", ">Registre<"],
  ["(prise ? '✓📷' : '📷')", "(prise ? '✓ Photo' : 'Photo')"],
  ["(preuve ? '✓📷' : '📷')", "(preuve ? '✓ Photo' : 'Photo')"],
  ['<span class="ic">🎙️</span>', ''],
  ['<span class="ic">📸</span>', ''],
  ['<span class="ci">💬</span>', ''],
  ['(m.epingle ? \'<span class="pill ambre">📌</span>\' : \'\')',
   '(m.epingle ? \'<span class="pill ambre">Épinglé</span>\' : \'\')'],
  ['">🚨 ', '">'], ['">⚠️ ', '">'], ['">📦 ', '">'], ["'<h2>✅ ", "'<h2>"],
  ['">📦 Entrée en stock<', '">Entrée en stock<'],
  ['">🍦 Ouverture d’un bac<', '">Ouverture d’un bac<'],
  ['\'<span class="mi-tx"><span class="mi-t">\' + ic + \' \' + lb + \'</span></span>\' +',
   '\'<span class="mi-tx"><span class="mi-t">\' + lb + \'</span></span>\' +'],
  ['<h3>⚠️ DLC qui approchent</h3>', '<h3>DLC qui approchent</h3>'],
  ['\'<span class="box">✓</span><span class="tx"><span class="tn">\' + a.icone + \' \' + esc(a.n',
   '\'<span class="box">✓</span><span class="tx"><span class="tn">\' + esc(a.n'],
  ["out.push({ icone:'📅', niveau:'warn'", "out.push({ icone:'', niveau:'warn'"],
  ["out.push({ icone:'👤', niveau:'warn'", "out.push({ icone:'', niveau:'warn'"],
  ["out.push({ icone:'🗑️', niveau:'n'",  "out.push({ icone:'', niveau:'n'"],
  ['carte(\'<div class="rang"><span class="ci">\' + (r.refuse ? \'⛔\' : \'📦\') + \'</span>\' +',
   'carte(\'<div class="rang">\' +'],
  ['carte(\'<div class="rang"><span class="ci">\' + r.icone + \'</span>\' +',
   'carte(\'<div class="rang">\' +']
];

function nettoyer(src) {
  let n = 0;
  for (const [a, b] of EXACTS) {
    const c = src.split(a).length - 1;
    if (c) { src = src.split(a).join(b); n += c; }
  }
  /* Pictogrammes dans des conteneurs dédiés */
  src = src.replace(new RegExp('<span class="vi">' + EMO + '</span>', 'gu'), () => { n++; return ''; });
  src = src.replace(new RegExp('<span class="ci">' + EMO + '</span>', 'gu'), () => { n++; return ''; });
  src = src.replace(new RegExp('<span class="ai">' + EMO + '</span>', 'gu'),
    () => { n++; return '<span class="ai">•</span>'; });
  /* Emoji en tête de libellé rendu : >X texte  ou  'X texte */
  src = src.replace(new RegExp('(>|\')(' + EMO + ') (?=[A-ZÀÉÈa-zà-ÿ0-9])', 'gu'),
    (m, p1, e) => { if (GARDE.has(e)) return m; n++; return p1; });
  /* Emoji en tête de titre de section */
  src = src.replace(new RegExp('(<h3>)(' + EMO + ') ', 'gu'), (m, p1) => { n++; return p1; });
  return { src, n };
}

let total = 0;
for (const f of ['app.js', 'modules.js']) {
  const p = path.join(__dirname, '..', f);
  if (!fs.existsSync(p)) { console.log(f + ' : absent, ignoré'); continue; }
  const avant = fs.readFileSync(p, 'utf8');
  const { src, n } = nettoyer(avant);
  if (n === 0) { console.log(f.padEnd(12) + ' : rien à faire'); continue; }
  /* Contrôle de syntaxe avant d'écrire : mieux vaut ne rien faire
     qu'écrire un fichier cassé. */
  try {
    new Function(src);
  } catch (e) {
    console.error(f + ' : ABANDON — le résultat ne compile pas (' + e.message + ')');
    process.exitCode = 1;
    continue;
  }
  fs.writeFileSync(p, src, 'utf8');
  console.log(f.padEnd(12) + ' : ' + n + ' pictogrammes retirés');
  total += n;
}
console.log('\nTotal : ' + total);
