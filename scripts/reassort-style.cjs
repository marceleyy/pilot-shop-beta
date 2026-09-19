/* =============================================================================
   scripts/reassort-style.cjs

   Le réassort mélangeait deux styles : douze lignes avec un chevron et des
   boutons compacts, dix-sept avec les gros boutons « Fait » et « Rupture »
   sur toute la largeur. Le même écran avait deux apparences selon la ligne.

   Ce script unifie : toutes les lignes ont la même hauteur et les mêmes deux
   boutons à droite. Celles qui ont des déclinaisons portent en plus un
   chevron pour les déplier.

   Usage, depuis la racine du projet :
       node scripts/reassort-style.cjs
   ============================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const cible = path.join(__dirname, '..', 'app.js');
const src = fs.readFileSync(cible, 'utf8');

const A1 = "const items = REASSORT.filter(r => r.cat === c.id);";
const A2 = "}).join('');";
const d = src.indexOf(A1);
if (d < 0) { console.error('Ancre 1 introuvable.'); process.exit(1); }
const f = src.indexOf(A2, d);
if (f < 0) { console.error('Ancre 2 introuvable.'); process.exit(1); }

const CORPS = `const items = REASSORT.filter(r => r.cat === c.id);
         /* Une référence est faite quand elle est cochée, ou quand toutes ses
            déclinaisons le sont. */
         const estFaite = r => {
           const dc = declinaisonsReassort(r);
           if (!dc.length) return !!(rec[r.id] && rec[r.id].ok);
           return dc.every(x => (rec[r.id + '|' + x] || {}).ok);
         };
         const ok = items.filter(estFaite).length;

         return '<div class="entete"><h3>' + esc(c.id) + '</h3>' +
           '<span class="pousse mini num">' + ok + '/' + items.length + '</span></div>' +
           '<div class="stack">' + items.map(r => {
             const v = rec[r.id] || {};
             const dc = declinaisonsReassort(r);
             const ouvert = deplies[r.id];
             const rupt = dc.filter(x => (rec[r.id + '|' + x] || {}).rupture);
             const faites = dc.filter(x => (rec[r.id + '|' + x] || {}).ok).length;
             const fait = estFaite(r);
             const enRupture = rupt.length || v.rupture;

             /* Toutes les lignes ont la MÊME structure : libellé à gauche,
                deux boutons compacts à droite, chevron en plus si la référence
                a des déclinaisons. Avant, dix-sept lignes portaient de gros
                boutons pleine largeur et douze des boutons compacts — le même
                écran avait deux apparences. */
             return carte(
               '<div class="rang">' +
               '<div style="flex:1;min-width:0">' +
               '<b>' + esc(r.nom) + '</b>' +
               '<div class="mini">' + (
                 rupt.length ? esc(rupt.join(', ')) + ' — en rupture'
                 : v.rupture ? 'Reste ' + v.reste + ' ' + esc(r.unite) + ' — signalé'
                 : fait && !dc.length ? 'Vérifié par ' + esc(v.par || '') + ' · ' + heure(v.at)
                 : dc.length ? faites + '/' + dc.length + ' · ' + esc(r.detail || ('en ' + r.unite))
                 : esc(r.detail || ('en ' + r.unite))) + '</div></div>' +

               (dc.length
                 ? '<button type="button" class="chev" data-deplier="' + r.id + '" ' +
                   'aria-label="Voir les déclinaisons">' + (ouvert ? '−' : '+') + '</button>'
                 : '<div class="duo compact">' +
                   '<button type="button" class="btn ok' + (v.ok ? ' on' : '') +
                   '" data-ok="' + r.id + '" aria-label="Fait">' + ic('valide', 17) + '</button>' +
                   '<button type="button" class="btn ko' + (v.rupture ? ' on' : '') +
                   '" data-ko="' + r.id + '" aria-label="Rupture">!</button></div>') +
               '</div>' +

               (dc.length && ouvert
                 ? '<div class="stack" style="margin-top:10px">' + dc.map(x => {
                     const k = r.id + '|' + x;
                     const vd = rec[k] || {};
                     return '<div class="rang decl">' +
                       '<span class="invn">' + esc(x) +
                       (vd.ok ? '<small>✓ ' + esc(vd.par || '') + '</small>'
                        : vd.rupture ? '<small>en rupture</small>' : '') + '</span>' +
                       '<div class="duo compact">' +
                       '<button type="button" class="btn ok' + (vd.ok ? ' on' : '') +
                       '" data-ok="' + k + '" aria-label="Fait">' + ic('valide', 16) + '</button>' +
                       '<button type="button" class="btn ko' + (vd.rupture ? ' on' : '') +
                       '" data-ko="' + k + '" aria-label="Rupture">!</button></div></div>';
                   }).join('') + '</div>'
                 : ''),
               enRupture ? 'corail' : fait ? 'menthe' : c.couleur);
           }).join('') + '</div>';
       `;

const out = src.slice(0, d) + CORPS + src.slice(f);

try { new Function(out); }
catch (e) { console.error('ABANDON — ne compile pas : ' + e.message); process.exit(1); }

const sauvegarde = cible + '.avant-style-reassort';
if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, src, 'utf8');
fs.writeFileSync(cible, out, 'utf8');
console.log('Réassort : style unifié sur toutes les lignes.');
console.log('Sauvegarde : app.js.avant-style-reassort');
