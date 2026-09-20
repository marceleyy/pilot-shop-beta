/* =============================================================================
   scripts/stock-sec-lien.cjs

   Relie la traçabilité au stock du sec, pour les familles comptées au sec.

   Le défaut : une ouverture de chantilly enregistrait le lot — c'est la
   traçabilité, il la faut — mais décrémentait un compteur « chantilly|| » que
   personne n'inventoriait jamais, puisque l'inventaire du sec compte
   « sec|creme| ». Le négatif était permanent par construction.

   Désormais, pour une famille marquée « lieu:'sec' » :
     • l'ouverture enregistre le lot et démarre la DLC, comme avant ;
     • le mouvement de stock porte la CLÉ DU SEC — sec|creme|, sec|coulis|Gianduja —
       celle-là même que l'inventaire du sec compte ;
     • le stock de la chambre froide ignore ces mouvements ;
     • le stock du sec les applique : inventaire du sec, moins les ouvertures
       postérieures. Il se recale à chaque comptage, comme la chambre froide.

   Ajoute à stock.js :
     • cleSecDeFamille(fam, saveur)  — la clé du sec pour une ouverture ;
     • stockSec()                    — le stock du sec, inventaire moins ouvertures.
   Et modifie stockReel() pour écarter les clés « sec| ».

   REJOUABLE. Usage, depuis la racine du projet :
       node scripts/stock-sec-lien.cjs
   ============================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const cible = path.join(__dirname, '..', 'stock.js');
const src = fs.readFileSync(cible, 'utf8');

if (src.indexOf('async function stockSec') >= 0) {
  console.log('Lien traçabilité → stock du sec déjà en place — rien à faire.');
  process.exit(0);
}

let out = src;

/* --- 1. stockReel ignore les mouvements du sec ---------------------------- */
const A1 = "    if (!c) return;\n    if (dateInv && at <= dateInv) return;   // déjà compris dans l'inventaire";
if (out.indexOf(A1) < 0) { console.error('Ancre stockReel introuvable.'); process.exit(1); }
out = out.replace(A1,
"    if (!c) return;\n" +
"    /* Les mouvements du SEC ont leur propre stock (stockSec) : ils ne touchent\n" +
"       pas la chambre froide. */\n" +
"    if (String(c).indexOf('sec|') === 0) return;\n" +
"    if (dateInv && at <= dateInv) return;   // déjà compris dans l'inventaire");

/* --- 2. Les deux fonctions, avant stockInsuffisant ------------------------ */
const A2 = 'async function stockInsuffisant(cle) {';
const i2 = out.indexOf(A2);
if (i2 < 0) { console.error('stockInsuffisant introuvable.'); process.exit(1); }
/* on remonte au commentaire qui précède */
let ins = i2;
const cmt = out.lastIndexOf('/*', i2);
if (cmt > 0 && i2 - cmt < 900 && out.slice(cmt, i2).indexOf('*/') > 0) ins = cmt;

const BLOC = `/* -----------------------------------------------------------------------------
   STOCK DU SEC
   Le sec a son propre stock, calculé comme la chambre froide : le dernier
   inventaire du sec, moins les ouvertures postérieures. Une ouverture de
   chantilly, de coulis ou de topping porte la clé du sec — celle que
   l'inventaire compte — et se voit donc ici, pas en chambre froide.
   -------------------------------------------------------------------------- */
function cleSecDeFamille(fam, saveur) {
  if (!fam) return null;
  const ref = fam.ref || fam.refSec;
  if (!ref) return null;
  return 'sec|' + ref + '|' + (saveur || '');
}

async function stockSec() {
  const inv = await DB.get('stock:sec', null);
  const out = {};
  const dateInv = inv ? inv.at : null;
  if (inv && inv.lignes) Object.keys(inv.lignes).forEach(c => out[c] = num(inv.lignes[c]));
  const mouv = await tousMouvements(null);
  mouv.forEach(m => {
    const c = m.c || m.cle; if (!c || String(c).indexOf('sec|') !== 0) return;
    const at = m.a || m.at;
    if (dateInv && at <= dateInv) return;
    const type = m.t || m.type;
    const q = num(m.q !== undefined ? m.q : m.qte);
    if (out[c] === undefined) out[c] = 0;
    if (type === 'reception') out[c] += q;
    else if (type === 'ouverture' || type === 'perte') out[c] -= q;
  });
  return { articles: out, inventaire: inv };
}

`;
out = out.slice(0, ins) + BLOC + out.slice(ins);

/* --- 3. L'ouverture écrit sur la clé du sec quand la famille y est --------- */
const A3 = "    async function poser(fam, lot) {";
const i3 = out.indexOf(A3);
if (i3 < 0) { console.error('poser introuvable.'); process.exit(1); }
const fin3 = out.indexOf("      await ajouterMouvement('ouverture', cle, 1,", i3);
if (fin3 < 0) { console.error('ajouterMouvement dans poser introuvable.'); process.exit(1); }
out = out.slice(0, i3) +
`    async function poser(fam, lot) {
      /* Seules les glaces ont une taille de bac ; les autres familles ont
         éventuellement une saveur. Et une famille comptée au SEC écrit sur la
         clé du sec, pour que l'inventaire du sec la retrouve. */
      const cle = (fam.lieu === 'sec' || fam.stock === 'sec')
        ? (cleSecDeFamille(fam, fam.parfums ? parfum : '') ||
           cleArticle(fam.id, fam.parfums ? parfum : '', ''))
        : cleArticle(fam.id, fam.parfums ? parfum : '', fam.id === 'glace' ? taille : '');
` + out.slice(fin3);

/* on retire l'ancienne construction de clé qui suivait, si elle est encore là */
out = out.replace(
  /\n      const cle = cleArticle\(fam\.id,\n\s+fam\.parfums \? parfum : '',\n\s+fam\.id === 'glace' \? taille : ''\);\n/,
  '\n');

try { new Function(out); }
catch (e) { console.error('ABANDON — ne compile pas : ' + e.message); process.exit(1); }

const sauvegarde = cible + '.avant-stock-sec';
if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, src, 'utf8');
fs.writeFileSync(cible, out, 'utf8');
console.log('Traçabilité reliée au stock du sec : stockSec(), clés sec| sur les ouvertures.');
