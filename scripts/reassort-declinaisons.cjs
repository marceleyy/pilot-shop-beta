/* =============================================================================
   scripts/reassort-declinaisons.cjs

   Le réassort affichait « Cornets » en une seule ligne. Or un bambino et un
   grande ne se remplacent pas : signaler « cornets en rupture » sans dire
   laquelle oblige à tout vérifier en réserve.

   Ce script rend la ligne dépliable, comme dans l'inventaire. Chaque
   déclinaison se coche ou se signale séparément, et la ligne parente résume
   ce qui manque : « Bambino, Grande — signalé ».

   Les déclinaisons sont lues dans INVENTAIRE_SEC, par correspondance de nom :
   une seule source de vérité, et le vocabulaire reste le même des deux côtés.

   Usage, depuis la racine du projet :
       node scripts/reassort-declinaisons.cjs
   ============================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const cible = path.join(__dirname, '..', 'app.js');
const src = fs.readFileSync(cible, 'utf8');

/* --- 1. On repère le corps de la liste, entre deux ancres stables --------- */
const A1 = "const items = REASSORT.filter(r => r.cat === c.id);";
const A2 = "}).join('');";
const d = src.indexOf(A1);
if (d < 0) { console.error('Ancre 1 introuvable.'); process.exit(1); }
const f = src.indexOf(A2, d);
if (f < 0) { console.error('Ancre 2 introuvable.'); process.exit(1); }

const CORPS = `const items = REASSORT.filter(r => r.cat === c.id);
         const ok = items.filter(r => rec[r.id] && rec[r.id].ok).length;
         return '<div class="entete"><h3>' + esc(c.id) + '</h3>' +
           '<span class="pousse mini num">' + ok + '/' + items.length + '</span></div>' +
           '<div class="stack">' + items.map(r => {
             const v = rec[r.id] || {};
             /* Déclinaisons : un cornet bambino et un cornet grande ne se
                remplacent pas. On déplie au clic, et chaque taille se signale
                séparément. */
             const decl = declinaisonsReassort(r);
             const ouvert = deplies[r.id];
             const enRupture = decl.filter(x => (rec[r.id + '|' + x] || {}).rupture);
             const faites = decl.filter(x => (rec[r.id + '|' + x] || {}).ok).length;

             return carte(
               '<div class="rang"><div style="flex:1;min-width:0">' +
               '<b>' + esc(r.nom) + '</b>' +
               '<div class="mini">' + (
                 enRupture.length ? esc(enRupture.join(', ')) + ' — signalé'
                 : v.ok ? 'Vérifié par ' + esc(v.par) + ' · ' + heure(v.at)
                 : v.rupture ? 'Reste ' + v.reste + ' ' + r.unite + ' — signalé'
                 : decl.length ? faites + '/' + decl.length + ' · ' + esc(r.detail || ('en ' + r.unite))
                 : (r.detail ? esc(r.detail) : 'En ' + r.unite)) + '</div></div>' +
               (decl.length
                 ? '<button type="button" class="chev" data-deplier="' + r.id + '">' +
                   (ouvert ? '−' : '+') + '</button>'
                 : '') + '</div>' +

               (decl.length && ouvert
                 ? '<div class="stack" style="margin-top:10px">' + decl.map(x => {
                     const k = r.id + '|' + x;
                     const vd = rec[k] || {};
                     return '<div class="rang decl">' +
                       '<span class="invn">' + esc(x) +
                       (vd.ok ? '<small>✓ ' + esc(vd.par || '') + '</small>'
                        : vd.rupture ? '<small>rupture signalée</small>' : '') + '</span>' +
                       '<div class="duo compact">' +
                       '<button type="button" class="btn ok' + (vd.ok ? ' on' : '') +
                       '" data-ok="' + k + '">' + ic('valide', 16) + '</button>' +
                       '<button type="button" class="btn ko' + (vd.rupture ? ' on' : '') +
                       '" data-ko="' + k + '">!</button></div></div>';
                   }).join('') + '</div>'
                 : decl.length ? ''
                 : '<div class="duo" style="margin-top:12px">' +
                   '<button type="button" class="btn ok' + (v.ok ? ' on' : '') + '" data-ok="' + r.id + '">' +
                   ic('valide', 18) + '<span>Fait</span></button>' +
                   '<button type="button" class="btn ko' + (v.rupture ? ' on' : '') + '" data-ko="' + r.id + '">Rupture</button>' +
                   '</div>'),
               (v.rupture || enRupture.length) ? 'corail' : (v.ok || (decl.length && faites === decl.length)) ? 'menthe' : c.couleur);
           }).join('') + '</div>';
       `;

let out = src.slice(0, d) + CORPS + src.slice(f);

/* --- 2. On branche le dépliage juste après le rendu ---------------------- */
const A3 = "$$('[data-ok]').forEach(b => b.onclick = async () => {";
const i3 = out.indexOf(A3);
if (i3 < 0) { console.error('Ancre 3 introuvable.'); process.exit(1); }
out = out.slice(0, i3) +
`$$('[data-deplier]').forEach(b => b.onclick = () => {
       deplies[b.dataset.deplier] = !deplies[b.dataset.deplier];
       rendre('reas');
     });

     ` + out.slice(i3);

/* --- 3. Les fonctions d'appui, avant la vue ------------------------------ */
const A4 = "   V.reas = async function";
const i4 = out.indexOf(A4);
if (i4 < 0) { console.error('V.reas introuvable.'); process.exit(1); }
out = out.slice(0, i4) +
`   /* Déclinaisons d'un point de réassort. Elles viennent d'INVENTAIRE_SEC,
      par correspondance de nom : une seule source de vérité, et le vocabulaire
      reste le même entre le réassort et l'inventaire. */
   const deplies = {};
   function declinaisonsReassort(r) {
     if (typeof INVENTAIRE_SEC === 'undefined') return [];
     const norm = s => String(s || '').toLowerCase()
       .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z]/g, '');
     const cible = norm(r.nom);
     const ref = INVENTAIRE_SEC.filter(x =>
       typeof x === 'object' && x.variantes && x.variantes.length &&
       (norm(x.nom) === cible || norm(x.nom).indexOf(cible) === 0 ||
        cible.indexOf(norm(x.nom)) === 0))[0];
     return ref ? ref.variantes : [];
   }

` + out.slice(i4);

try { new Function(out); }
catch (e) { console.error('ABANDON — ne compile pas : ' + e.message); process.exit(1); }

const sauvegarde = cible + '.avant-declinaisons';
if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, src, 'utf8');
fs.writeFileSync(cible, out, 'utf8');
console.log('Réassort : déclinaisons dépliables branchées.');
console.log('Sauvegarde : app.js.avant-declinaisons');
