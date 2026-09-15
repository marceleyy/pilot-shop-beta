/* =============================================================================
   scripts/reecrire-inventaire.cjs

   Réécrit V.inventaire d'un bloc. Les éditions successives ont désordonné la
   fonction — un « let » après son usage, un bloc HTML orphelin. Plutôt que de
   raccommoder, on remplace la vue entière par une version cohérente.

   Ce qu'elle apporte :
     • deux comptages séparés, chambre froide et sec, avec une bascule ;
     • le sec était revenu nulle part depuis le retrait de l'ancien écran ;
     • le brouillon distingue les deux parties.

   Usage, depuis la racine du projet :
       node scripts/reecrire-inventaire.cjs
   Le script vérifie la syntaxe avant d'écrire et sauvegarde l'original.
   ============================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const cible = path.join(__dirname, '..', 'stock.js');
const src = fs.readFileSync(cible, 'utf8');

const DEBUT = 'V.inventaire = async function () {';
const d = src.indexOf(DEBUT);
if (d < 0) { console.error('V.inventaire introuvable.'); process.exit(1); }

const NOUVELLE = `V.inventaire = async function () {
  const { articles } = await stockReel();
  const precedent = await DB.get('stock:inventaire', null);
  const secPrec   = await DB.get('stock:sec', null);

  /* Deux comptages distincts. La chambre froide se compte vite et alimente le
     calcul d'écart ; le sec se compte rarement et porte des unités variées.
     Les mélanger obligeait à parcourir cinquante lignes pour n'en vouloir que
     vingt — et en retirant l'ancien écran « Glace et sec », j'avais purement
     et simplement supprimé le seul endroit où l'on comptait le sec. */
  let partie = 'froid';

  const saisie = {};        // chambre froide : cleArticle -> quantité
  const saisieSec = {};     // sec : libellé -> quantité

  /* Reprise d'un comptage interrompu : cinquante lignes à remplir debout dans
     une chambre froide, et l'onglet peut être déchargé entre deux. */
  const CLE_BROUILLON = 'pilotshop.v3:brouillon:inventaire';
  try {
    const b = JSON.parse(localStorage.getItem(CLE_BROUILLON) || 'null');
    if (b && b.jour === today()) {
      Object.assign(saisie, b.lignes || {});
      Object.assign(saisieSec, b.sec || {});
    }
  } catch (e) {}
  const garderBrouillon = () => {
    try {
      localStorage.setItem(CLE_BROUILLON, JSON.stringify({
        jour: today(), lignes: saisie, sec: saisieSec, at: nowISO()
      }));
    } catch (e) {}
  };

  const COURANTES = FOURNISSEUR.taillesCourantes || TAILLES_BAC;
  const RARES     = FOURNISSEUR.taillesRares || [];
  /* Tailles retirées du catalogue mais encore en stock : sans cette reprise,
     elles resteraient dans le total sans pouvoir être recomptées. */
  const ORPHELINES = [...new Set(Object.keys(articles)
    .filter(c => num(articles[c]) !== 0 && litArticle(c).famille === 'glace')
    .map(c => num(litArticle(c).taille))
    .filter(t => t && COURANTES.indexOf(t) < 0 && RARES.indexOf(t) < 0))].sort();
  let montrerRares = RARES.some(t =>
    PARFUMS.some(p => num(articles[cleArticle('glace', p, t)]) !== 0 ||
                      saisie[cleArticle('glace', p, t)] !== undefined));

  const autres = FAMILLES_PRODUIT.filter(f => !f.parfums);

  const totalBacs   = () => Object.keys(saisie).reduce((s, c) => s + num(saisie[c]), 0);
  const totalLitres = () => Object.keys(saisie).reduce((s, c) => {
    const t = num(litArticle(c).taille);
    return s + (t ? num(saisie[c]) * t : 0);
  }, 0);
  const totalSec    = () => Object.keys(saisieSec).reduce((s, k) => s + num(saisieSec[k]), 0);

  const majTotaux = () => {
    if (partie === 'froid') {
      if ($('#inv-t'))  $('#inv-t').textContent  = totalBacs();
      if ($('#inv-u'))  $('#inv-u').textContent  = 'bacs';
      if ($('#inv-kg')) $('#inv-kg').textContent = n1(totalLitres() * FOURNISSEUR.poidsMoyenLitre) + ' kg';
    } else {
      if ($('#inv-t'))  $('#inv-t').textContent  = totalSec();
      if ($('#inv-u'))  $('#inv-u').textContent  = 'unités';
      if ($('#inv-kg')) $('#inv-kg').textContent = Object.keys(saisieSec).length + ' réf.';
    }
  };

  /* --- Chambre froide : une ligne par parfum, tailles côte à côte --------- */
  const blocFroid = () =>
    '<div class="entete"><h3>Glaces</h3>' +
    '<button class="btn clair sm pousse" id="inv-rares">' +
    (montrerRares ? 'Masquer le 7 L' : '+ 7 L') + '</button></div>' +
    '<div class="stack">' + PARFUMS.map(p => {
      const base = montrerRares ? COURANTES.concat(RARES) : COURANTES;
      const sup = ORPHELINES.filter(t => num(articles[cleArticle('glace', p, t)]) !== 0 ||
                                         saisie[cleArticle('glace', p, t)] !== undefined);
      const tailles = base.concat(sup).sort((a, b) => a - b);
      const enStock = tailles.reduce((s, t) => s + num(articles[cleArticle('glace', p, t)]), 0);
      return '<div class="invp">' +
        '<div class="invp-h"><b>' + esc(p) + '</b>' +
        (enStock ? '<span class="invc">' + enStock + ' en stock</span>' : '') + '</div>' +
        '<div class="invp-t">' + tailles.map(t => {
          const c = cleArticle('glace', p, t);
          return '<label><span>' + t + ' L</span>' +
            '<input type="number" inputmode="numeric" min="0" step="1" data-inv="' + c + '" ' +
            'value="' + (saisie[c] !== undefined ? saisie[c] : '') + '" placeholder="0"></label>';
        }).join('') + '</div></div>';
    }).join('') + '</div>' +

    '<div class="entete"><h3>Autres familles</h3></div>' +
    '<div class="stack">' + autres.map(f => {
      const c = cleArticle(f.id, '', '');
      const q = num(articles[c]);
      return '<div class="invl">' +
        '<span class="invn">' + esc(f.libelle) + '</span>' +
        (q ? '<span class="invc">' + q + ' en stock</span>' : '') +
        '<input type="number" inputmode="numeric" min="0" step="1" data-inv="' + c + '" ' +
        'value="' + (saisie[c] !== undefined ? saisie[c] : '') + '" placeholder="0"></div>';
    }).join('') + '</div>';

  /* --- Sec : une ligne par référence -------------------------------------- */
  const blocSec = () =>
    '<div class="entete"><h3>Consommables et produits non congelés</h3>' +
    '<span class="pousse mini num">' + INVENTAIRE_SEC.length + '</span></div>' +
    '<div class="stack">' + INVENTAIRE_SEC.map(nom => {
      const ancien = secPrec && secPrec.lignes ? secPrec.lignes[nom] : undefined;
      return '<div class="invl">' +
        '<span class="invn">' + esc(nom) + '</span>' +
        (ancien !== undefined ? '<span class="invc">précédent ' + ancien + '</span>' : '') +
        '<input type="number" inputmode="numeric" min="0" step="1" data-sec="' + esc(nom) + '" ' +
        'value="' + (saisieSec[nom] !== undefined ? saisieSec[nom] : '') + '" placeholder="0"></div>';
    }).join('') + '</div>';

  const dessiner = () => {
    $('#vue-actions').innerHTML = '';
    const dernier = partie === 'froid' ? precedent : secPrec;
    $('#page').innerHTML =
      carte('<h2>Faire l’inventaire</h2>' +
        '<div class="cs">Comptez ce qui est physiquement présent. Ce relevé ' +
        'devient la nouvelle référence.</div>' +
        (dernier
          ? '<p class="rappel" style="margin-top:12px">Dernier comptage : ' +
            fmtD(dernier.jour) + (dernier.par ? ' par ' + esc(dernier.par) : '') + '</p>'
          : ''), 'solide') +

      '<div class="tseg">' +
      [['froid', 'Chambre froide', PARFUMS.length + ' parfums'],
       ['sec',   'Sec',            INVENTAIRE_SEC.length + ' références']].map(x =>
        '<button class="' + (x[0] === partie ? 'on' : '') + '" data-partie="' + x[0] + '">' +
        '<span class="tsl">' + x[1] + '</span><small>' + x[2] + '</small></button>').join('') +
      '</div>' +

      '<div class="inv-total"><b class="num" id="inv-t">0</b>' +
      '<span id="inv-u">bacs</span>' +
      '<b class="num" id="inv-kg" style="margin-left:auto">0,0 kg</b></div>' +

      (partie === 'froid' ? blocFroid() : blocSec()) +

      '<div class="champ" style="margin-top:18px"><label class="f">Note</label>' +
      '<textarea id="inv-note" placeholder="Ce qui explique un écart, un bac abîmé, un doute."></textarea></div>' +

      '<button class="btn menthe bloc xl" id="inv-ok" style="margin-top:16px">' +
      (partie === 'froid' ? 'Valider la chambre froide' : 'Valider le sec') + '</button>';

    $$('[data-partie]').forEach(b => b.onclick = () => {
      if (b.dataset.partie === partie) return;
      partie = b.dataset.partie;
      dessiner();
    });

    $$('[data-inv]').forEach(i => i.oninput = () => {
      if (i.value === '') delete saisie[i.dataset.inv];
      else saisie[i.dataset.inv] = i.value;
      garderBrouillon();
      majTotaux();
    });
    $$('[data-sec]').forEach(i => i.oninput = () => {
      if (i.value === '') delete saisieSec[i.dataset.sec];
      else saisieSec[i.dataset.sec] = i.value;
      garderBrouillon();
      majTotaux();
    });
    majTotaux();

    const br = $('#inv-rares');
    if (br) br.onclick = () => { montrerRares = !montrerRares; dessiner(); };

    $('#inv-ok').onclick = partie === 'froid' ? validerFroid : validerSec;
  };

  async function validerFroid() {
    const cptes = Object.keys(saisie);
    if (!cptes.length) return toast('Saisissez au moins une quantité', 'erreur');

    const lignes = {};
    cptes.forEach(c => { lignes[c] = num(saisie[c]); });
    const t = totauxStock(lignes);

    /* État AVANT le comptage : c'est lui qui révèle les bacs disparus. */
    const avant = (await stockReel()).articles;
    const ecart = Object.keys(lignes).reduce((s, c) =>
      s + (num(lignes[c]) - num(avant[c] || 0)), 0);

    confirmer('Valider la chambre froide ?',
      t.bacs + ' bacs comptés sur ' + cptes.length + ' référence(s), soit ' +
      n1(t.kg) + ' kg. ' +
      (ecart === 0 ? 'Cela correspond exactement au stock attendu.'
       : ecart < 0 ? Math.abs(ecart) + ' bac(s) de moins qu’attendu — des ouvertures non tracées.'
       : ecart + ' bac(s) de plus qu’attendu — une réception non saisie.'),
      'Valider', async () => {
        const inv = await enregistrerInventaire(lignes,
          $('#inv-note') ? $('#inv-note').value : '', avant);
        Object.keys(saisie).forEach(k => delete saisie[k]);
        garderBrouillon();
        await feed(inv.manquants ? 'warn' : 'ok',
          STATE.user.prenom + ' a compté la chambre froide — ' + t.bacs + ' bacs, ' + n1(t.kg) + ' kg' +
          (inv.manquants ? ' · ' + inv.manquants + ' bac(s) manquant(s)' : ''));
        toast('Chambre froide enregistrée');
        rendre('stock');
      });
  }

  async function validerSec() {
    const cptes = Object.keys(saisieSec);
    if (!cptes.length) return toast('Saisissez au moins une quantité', 'erreur');
    const lignes = {};
    cptes.forEach(k => { lignes[k] = num(saisieSec[k]); });

    confirmer('Valider le sec ?',
      cptes.length + ' référence(s) comptée(s). Ce relevé remplace le précédent.',
      'Valider', async () => {
        await DB.set('stock:sec', {
          jour: today(), at: nowISO(),
          par: STATE.user ? STATE.user.prenom : null,
          employe: STATE.user ? STATE.user.id : null,
          note: $('#inv-note') ? $('#inv-note').value : '',
          lignes: lignes
        });
        Object.keys(saisieSec).forEach(k => delete saisieSec[k]);
        garderBrouillon();
        await feed('ok', STATE.user.prenom + ' a compté le sec — ' + cptes.length + ' références');
        toast('Inventaire du sec enregistré');
        rendre('stock');
      });
  }

  dessiner();
};
`;

const resultat = src.slice(0, d) + NOUVELLE;

try { new Function(resultat); }
catch (e) {
  console.error('ABANDON — ne compile pas : ' + e.message);
  process.exit(1);
}

const sauvegarde = cible + '.avant-inventaire';
if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, src, 'utf8');
fs.writeFileSync(cible, resultat, 'utf8');

console.log('V.inventaire réécrite.');
console.log('  chambre froide : ' + '22 parfums + familles');
console.log('  sec            : liste INVENTAIRE_SEC');
console.log('Sauvegarde : stock.js.avant-inventaire');
