/* =============================================================================
   scripts/stock-onglets.cjs

   Le Stock réel en deux onglets, comme l'inventaire : Chambre froide et Sec.
   Tout était sur une seule page, et la chantilly — comptée au sec — apparaissait
   sous la chambre froide à −1.

   Chambre froide : les glaces par parfum avec le détail des tailles, plus les
   familles congelées comptées à l'unité — macarons, gianduiotti, crêpes,
   gaufres. Les familles marquées « lieu:'sec' » n'y figurent plus.

   Sec : le dernier comptage, par section et par référence, avec les couleurs
   de la fiche Amorino. Une déclinaison qui n'est plus au catalogue — « Taille
   1 », « Piccolo », « Verte » d'un comptage antérieur — s'affiche quand même,
   en italique : c'est ce qui a été compté, on ne le cache pas.

   REJOUABLE. Usage, depuis la racine du projet :
       node scripts/stock-onglets.cjs
   ============================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const cible = path.join(__dirname, '..', 'stock.js');
const src = fs.readFileSync(cible, 'utf8');

const A1 = 'V.stock = async function () {';
const d = src.indexOf(A1);
if (d < 0) { console.error('V.stock introuvable.'); process.exit(1); }
/* Fin : la prochaine définition de vue ou d'enveloppe */
const suite = src.slice(d + A1.length);
const m = suite.match(/\n(?:const V_\w+_origine|V\.\w+ = async function|\/\* -{20,})/);
if (!m) { console.error('Fin de V.stock introuvable.'); process.exit(1); }
const f = d + A1.length + m.index + 1;

if (src.slice(d, f).indexOf("STATE.stockPartie") >= 0) {
  console.log('Stock réel déjà en onglets — rien à faire.');
  process.exit(0);
}

const NOUVEAU = `V.stock = async function () {
  const { articles, inventaire } = await stockReel();
  if (typeof chargerCatalogueSec === 'function') await chargerCatalogueSec();
  const sec = await DB.get('stock:sec', null);

  /* Deux onglets, comme l'inventaire. On mémorise le dernier ouvert. */
  let partie = STATE.stockPartie === 'sec' ? 'sec' : 'froid';

  const estSec = c => {
    const fam = FAMILLES_PRODUIT.filter(x => x.id === litArticle(c).famille)[0];
    return !!(fam && (fam.lieu === 'sec' || fam.stock === 'sec'));
  };
  /* Chambre froide : tout ce qui n'est pas marqué « sec ». */
  const clesFroid = Object.keys(articles)
    .filter(c => num(articles[c]) !== 0 && !estSec(c))
    .sort((a, b) => libelleArticle(a).localeCompare(libelleArticle(b)));
  const articlesFroid = {};
  clesFroid.forEach(c => articlesFroid[c] = articles[c]);
  const t = totauxStock(articlesFroid);
  const alertes = anomaliesStock(articles);

  /* ---------- Chambre froide ---------- */
  const blocFroid = () => {
    const parFamille = {};
    clesFroid.forEach(c => {
      const f = litArticle(c).famille;
      (parFamille[f] = parFamille[f] || []).push(c);
    });
    return carte('<div class="grid g3">' +
      kpi('Bacs de glace', t.bacs, '', n1(t.litres) + ' L') +
      kpi('Autres produits', t.unites, '', 'comptés à l’unité') +
      kpi('Poids', n1(t.kg) + ' kg', '', 'glace seule') + '</div>' +
      (inventaire
        ? '<p class="rappel" style="margin-top:14px">Dernier inventaire le ' +
          fmtD(inventaire.jour) + (inventaire.par ? ' par ' + esc(inventaire.par) : '') + '.</p>'
        : '<p class="rappel" style="margin-top:14px">Aucun inventaire : le stock part de zéro.</p>'),
      'solide') +

    (alertes.length
      ? alertes.map(a => '<div class="alerte ' + (a.niveau === 'bad' ? 'bad' : 'warn') + '" style="margin-top:12px">' +
          '<span class="ai">•</span><div><b>' + esc(a.titre) + '</b><p>' + esc(a.detail) + '</p></div></div>').join('')
      : '') +

    '<button class="btn menthe bloc xl" id="st-inv" style="margin-top:16px">Faire l’inventaire</button>' +

    (clesFroid.length
      ? Object.keys(parFamille).map(fid => {
          const fam = FAMILLES_PRODUIT.filter(x => x.id === fid)[0];
          const sous = parFamille[fid].reduce((s, c) => s + num(articles[c]), 0);
          const u = fam ? (Math.abs(sous) > 1 ? fam.unites : fam.unite) : 'unité(s)';
          const lignes = (fid === 'glace')
            ? (function () {
                const parParfum = {};
                parFamille[fid].forEach(c => { const a = litArticle(c);
                  (parParfum[a.parfum] = parParfum[a.parfum] || []).push(c); });
                return Object.keys(parParfum).sort((x, y) => x.localeCompare(y)).map(p => {
                  const tailles = parParfum[p].sort((x, y) => num(litArticle(x).taille) - num(litArticle(y).taille));
                  const n = tailles.reduce((s, c) => s + num(articles[c]), 0);
                  const negatif = tailles.some(c => num(articles[c]) < 0);
                  return carte('<div class="rang"><div style="flex:1;min-width:0"><b>' + esc(p) + '</b>' +
                    '<div class="mini tailles">' + tailles.map(c => { const q = num(articles[c]);
                      return '<span class="tq' + (q < 0 ? ' neg' : '') + '"><b>' + q + '</b>×' + litArticle(c).taille + ' L</span>';
                    }).join('') + '</div></div>' +
                    '<b class="num" style="font-size:20px">' + n + '</b></div>', negatif ? 'corail' : '');
                }).join('');
              })()
            : parFamille[fid].map(c => { const a = litArticle(c), q = num(articles[c]);
                return carte('<div class="rang"><div style="flex:1;min-width:0"><b>' +
                  esc(a.parfum || (fam ? fam.libelle : fid)) + '</b>' +
                  (fam ? '<div class="mini">En ' + esc(fam.unites) + '</div>' : '') + '</div>' +
                  '<b class="num" style="font-size:20px">' + q + '</b></div>', q < 0 ? 'corail' : '');
              }).join('');
          return '<div class="entete"><h3>' + esc(fam ? fam.libelle : fid) + '</h3>' +
            '<span class="pousse mini num">' + sous + ' ' + u + '</span></div>' +
            '<div class="stack">' + lignes + '</div>';
        }).join('')
      : vide('', 'Chambre froide vide. Commencez par un inventaire.'));
  };

  /* ---------- Sec ---------- */
  const blocSec = () => {
    if (!sec || !sec.lignes || !Object.keys(sec.lignes).length) {
      return carte('<p class="cs">Le sec n’a jamais été compté.</p>' +
        '<button class="btn menthe bloc xl" id="st-inv-sec" style="margin-top:12px">Compter le sec</button>', 'solide');
    }
    const cat = (typeof catalogueSec === 'function') ? catalogueSec() : INVENTAIRE_SEC;
    const sections = (typeof SEC_SECTIONS !== 'undefined')
      ? SEC_SECTIONS.map(s => typeof s === 'string' ? { id:s } : s) : [];
    const l = sec.lignes;
    const parRef = {};
    Object.keys(l).forEach(k => { const p = k.split('|'); if (p[0] !== 'sec') return;
      (parRef[p[1]] = parRef[p[1]] || []).push({ v: p[2] || '', q: num(l[k]) }); });
    const totalLignes = Object.keys(l).length;
    const totalUnites = Object.keys(l).reduce((s, k) => s + num(l[k]), 0);

    return carte('<div class="grid g2">' +
      kpi('Références', totalLignes, '', 'comptées') +
      kpi('Unités', n1(totalUnites), '', 'toutes confondues') + '</div>' +
      '<p class="rappel" style="margin-top:14px">Compté le ' + fmtD(sec.jour) +
      (sec.par ? ' par ' + esc(sec.par) : '') + '.</p>', 'solide') +
      '<button class="btn menthe bloc xl" id="st-inv-sec" style="margin-top:16px">Recompter le sec</button>' +

      sections.map(s => {
        const refs = cat.filter(r => (r.sec || 'Autres') === s.id && !r.masque && parRef[r.id]);
        if (!refs.length) return '';
        return '<div class="sec-bloc"' + (s.teinte ? ' style="--sec-teinte:' + s.teinte + '"' : '') + '>' +
          '<div class="entete sec-entete"><span class="sec-pastille"></span><h3>' + esc(s.id) + '</h3></div>' +
          '<div class="stack">' + refs.map(r => {
            const lignes = parRef[r.id];
            const total = lignes.reduce((a, x) => a + x.q, 0);
            const connues = new Set(r.variantes || []);
            return carte('<div class="rang"><div style="flex:1;min-width:0"><b>' + esc(r.nom) + '</b>' +
              (r.variantes && r.variantes.length
                ? '<div class="mini tailles">' + lignes
                    .sort((a, b) => (r.variantes.indexOf(a.v) + 99) - (r.variantes.indexOf(b.v) + 99))
                    .map(x => '<span class="tq' + (x.q < 0 ? ' neg' : '') + (connues.has(x.v) ? '' : ' ancienne') + '">' +
                      esc(x.v || '—') + ' <b>' + n1(x.q) + '</b></span>').join('') + '</div>'
                : '') + '</div>' +
              '<b class="num" style="font-size:20px">' + n1(total) + '</b>' +
              '<span class="mini" style="margin-left:6px">' + esc(r.unite) + (total > 1 ? 's' : '') + '</span></div>',
              total < 0 ? 'corail' : '');
          }).join('') + '</div></div>';
      }).join('');
  };

  const dessiner = () => {
    $('#vue-actions').innerHTML = '';
    $('#page').innerHTML =
      '<div class="tseg">' +
      [['froid', 'Chambre froide', t.bacs + ' bacs'], ['sec', 'Sec', sec ? Object.keys(sec.lignes || {}).length + ' réf.' : 'jamais compté']]
        .map(x => '<button class="' + (x[0] === partie ? 'on' : '') + '" data-partie="' + x[0] + '">' +
          '<span class="tsl">' + x[1] + '</span><small>' + x[2] + '</small></button>').join('') +
      '</div>' +
      (partie === 'froid' ? blocFroid() : blocSec());

    $$('[data-partie]').forEach(b => b.onclick = () => {
      partie = b.dataset.partie; STATE.stockPartie = partie; dessiner();
    });
    const bi = $('#st-inv');
    if (bi) bi.onclick = () => { STATE.inventairePartie = 'froid'; rendre('inventaire'); };
    const bs = $('#st-inv-sec');
    if (bs) bs.onclick = () => { STATE.inventairePartie = 'sec'; rendre('inventaire'); };
  };
  dessiner();
};

`;

const out = src.slice(0, d) + NOUVEAU + src.slice(f);
try { new Function(out); }
catch (e) { console.error('ABANDON — ne compile pas : ' + e.message); process.exit(1); }

const sauvegarde = cible + '.avant-stock-onglets';
if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, src, 'utf8');
fs.writeFileSync(cible, out, 'utf8');
console.log('Stock réel en deux onglets : chambre froide et sec.');
