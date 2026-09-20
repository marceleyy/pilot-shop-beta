/* =============================================================================
   scripts/inventaire-sec-sections.cjs

   L'inventaire du sec : par section, avec l'unité affichée AVANT la saisie et
   les décimales autorisées où le manager l'a demandé.

   « Comme ça, les personnes voient avant de taper. » L'unité — carton,
   ramette, pack, brique — est dans le champ lui-même, en suffixe. Et le pas
   de saisie est 0,5 quand la référence l'autorise : deux cartons pleins et un
   à moitié, ça se tape 2,5.

   Usage, depuis la racine du projet :
       node scripts/inventaire-sec-sections.cjs
   ============================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const cible = path.join(__dirname, '..', 'stock.js');
const src = fs.readFileSync(cible, 'utf8');

const A1 = "const blocSec = () =>";
const A2 = "const dessiner = () => {";
const d = src.indexOf(A1);
const f = src.indexOf(A2, d);
if (d < 0 || f < 0) { console.error('Ancres introuvables.'); process.exit(1); }

/* REJOUABLE : si la version en place lit déjà catalogueSec() et les sections
   en objets, il n'y a rien à faire. Sinon on remplace — y compris la version
   intermédiaire qui comparait une chaîne à un objet et rendait tout vide. */
const enPlace = src.slice(d, f);
if (enPlace.indexOf('catalogueSec()') >= 0 && enPlace.indexOf('section.id') >= 0) {
  console.log('Inventaire du sec déjà à jour — rien à faire.');
  process.exit(0);
}

/* On remonte au commentaire qui précède blocSec, s'il y en a un */
let deb = d;
const cmt = src.lastIndexOf('/*', d);
if (cmt > 0 && d - cmt < 700 && src.slice(cmt, d).indexOf('*/') > 0) deb = cmt;
/* et on s'arrête juste avant le commentaire qui précède dessiner, s'il existe */
let fin = f;
const cmt2 = src.lastIndexOf('/*', f);
if (cmt2 > d && f - cmt2 < 400 && src.slice(cmt2, f).indexOf('*/') > 0) fin = cmt2;

const NOUVEAU = `/* --- Sec : par section, unité visible, décimales où ça a du sens ---------
     Le manager l'a dit : « comme ça, les personnes voient avant de taper ».
     L'unité est dans le champ lui-même. Et le pas est 0,5 quand la référence
     l'autorise : deux cartons pleins et un à moitié, ça se tape 2,5. Zéro
     veut dire « à commander », 0,5 veut dire « je réfléchis ». */
  let deplies = {};
  const cleSec = (r, v) => 'sec|' + r.id + '|' + (v || '');

  const champSec = (r, c) => {
    const pas = r.decimal === false ? '1' : '0.5';
    const mode = r.decimal === false ? 'numeric' : 'decimal';
    return '<div class="saisie-u">' +
      '<input type="number" inputmode="' + mode + '" min="0" step="' + pas + '" ' +
      'data-sec="' + c + '" value="' + (saisieSec[c] !== undefined ? saisieSec[c] : '') + '" ' +
      'placeholder="0">' +
      '<span class="su">' + esc(r.unite) + '</span></div>';
  };

  const blocSec = () => {
    const anc = secPrec && secPrec.lignes ? secPrec.lignes : {};
    /* Le catalogue effectif : celui du manager s'il l'a modifié, sinon celui
       d'usine. Le manager peut retirer une référence, en ajouter, changer une
       unité ou une déclinaison depuis le Back-office, sans passer par le code. */
    const catalogue = catalogueSec();
    const sections = (typeof SEC_SECTIONS !== 'undefined')
      ? SEC_SECTIONS.map(s => typeof s === 'string' ? { id:s } : s)
      : [...new Set(catalogue.map(r => r.sec || 'Autres'))].map(s => ({ id:s }));

    return sections.map(section => {
      const refs = catalogue.filter(r =>
        typeof r === 'object' && (r.sec || 'Autres') === section.id && !r.masque);
      if (!refs.length) return '';
      const nb = refs.reduce((n, r) => n + (r.variantes ? r.variantes.length : 1), 0);
      const teinte = section.teinte ? ' style="--sec-teinte:' + section.teinte + '"' : '';

      return '<div class="sec-bloc"' + teinte + '>' +
        '<div class="entete sec-entete"><span class="sec-pastille"></span>' +
        '<h3>' + esc(section.id) + '</h3>' +
        '<span class="pousse mini num">' + nb + '</span></div>' +
        '<div class="stack">' + refs.map(r => {

          if (!r.variantes || !r.variantes.length) {
            const c = cleSec(r, '');
            return '<div class="invl">' +
              '<span class="invn">' + esc(r.nom) + '</span>' +
              (anc[c] !== undefined ? '<span class="invc faible">préc. ' + anc[c] + '</span>' : '') +
              champSec(r, c) + '</div>';
          }

          const ouvert = deplies[r.id];
          const saisis = r.variantes.filter(v => saisieSec[cleSec(r, v)] !== undefined).length;
          const total  = r.variantes.reduce((s, v) => s + num(saisieSec[cleSec(r, v)] || 0), 0);

          return '<div class="invp">' +
            '<button type="button" class="invp-h depliable" data-deplier="' + r.id + '">' +
            '<b>' + esc(r.nom) + '</b>' +
            '<span class="invc">' + (saisis
              ? n1(total) + ' ' + esc(r.unite) + (total > 1 ? 's' : '') + ' · ' + saisis + '/' + r.variantes.length
              : r.variantes.length + ' déclinaisons · en ' + esc(r.unite)) + '</span>' +
            '<span class="chev">' + (ouvert ? '−' : '+') + '</span></button>' +
            (ouvert
              ? '<div class="stack" style="margin-top:8px">' + r.variantes.map(v => {
                  const c = cleSec(r, v);
                  return '<div class="invl">' +
                    '<span class="invn">' + esc(v) + '</span>' +
                    (anc[c] !== undefined ? '<span class="invc faible">préc. ' + anc[c] + '</span>' : '') +
                    champSec(r, c) + '</div>';
                }).join('') + '</div>'
              : '') +
            '</div>';
        }).join('') + '</div></div>';
    }).join('');
  };

  `;

const out = src.slice(0, deb) + NOUVEAU + src.slice(fin);
try { new Function(out); }
catch (e) { console.error('ABANDON — ne compile pas : ' + e.message); process.exit(1); }

const sauvegarde = cible + '.avant-sec-sections';
if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, src, 'utf8');
fs.writeFileSync(cible, out, 'utf8');
console.log('Inventaire du sec : sections, unité visible, décimales.');
console.log('Sauvegarde : stock.js.avant-sec-sections');
