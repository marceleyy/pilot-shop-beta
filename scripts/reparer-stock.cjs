/* =============================================================================
   scripts/reparer-stock.cjs

   URGENT — répare stock.js, tronqué par scripts/reecrire-inventaire.cjs.

   Ce que ce script d'inventaire a fait de travers : il remplaçait tout ce qui
   suivait V.inventaire au lieu de s'arrêter à la fin de cette fonction. Comme
   V.lots venait après, elle a été effacée — la traçabilité entière.

   La leçon, et je la note pour ne plus la répéter : couper « depuis ici jusqu'à
   la fin du fichier » n'est jamais sûr. Il faut délimiter les deux bornes.

   Ce script remet V.lots, dans sa version d'origine, plus la vérification du
   lot déjà ouvert :

     Un bac ne sort qu'une fois de la chambre froide. Sortie, ouverture et mise
     en vitrine sont le même geste. Rescanner un bac déjà en vitrine décompte un
     second bac qui n'existe pas — c'est arrivé le 15 septembre, quinze scans un
     matin dont onze sur des bacs ouverts la veille.

   Usage, depuis la racine du projet :
       node scripts/reparer-stock.cjs
   ============================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const cible = path.join(__dirname, '..', 'stock.js');
const src = fs.readFileSync(cible, 'utf8');

if (src.indexOf('V.lots = async function') >= 0) {
  console.log('V.lots est déjà présente — rien à faire.');
  process.exit(0);
}

const V_LOTS = `
V.lots = async function () {
  const mouv = await tousMouvements(null);
  const ouvertures = mouv.map(litMouvement)
    .filter(m => m.type === 'ouverture').slice(-40).reverse();

  $('#vue-actions').innerHTML = '';
  $('#page').innerHTML =
    carte('<h2>Traçabilité</h2>' +
      '<div class="cs">À l’ouverture de tout nouveau produit, pas à la livraison. ' +
      'Le bac sort de la chambre froide, on l’ouvre, il monte en vitrine : ' +
      'un seul geste.</div>' +
      '<button class="btn menthe bloc xl" id="lo-scan" style="margin-top:14px">' +
      'Scanner une étiquette</button>' +
      '<button class="btn clair bloc" id="lo-main" style="margin-top:8px">' +
      'Saisir à la main</button>', 'solide') +

    (ouvertures.length
      ? '<div class="entete" style="margin-top:20px"><h3>Dernières ouvertures</h3>' +
        '<span class="pousse mini num">' + ouvertures.length + '</span></div>' +
        '<div class="stack">' + ouvertures.map(m => {
          const a = litArticle(m.cle);
          const f = FAMILLES_PRODUIT.filter(x => x.id === a.famille)[0];
          return '<div class="lotl">' +
            '<span class="invn">' + esc(a.parfum || (f ? f.libelle : a.famille)) +
            '<small>' + (f ? esc(f.libelle) : '') +
            (a.taille ? ' · ' + a.taille + ' L' : '') + '</small></span>' +
            '<span class="invc">' + fmtD(m.jour) + '<br>' + esc(m.lot || '—') + '</span></div>';
        }).join('') + '</div>'
      : vide('', 'Aucune ouverture enregistrée.'));

  $('#lo-scan').onclick = async () => {
    const r = await scannerPhoto('etiquette');
    if (!r) return;
    const ok = await confirmerOuverture(r);
    if (ok) rendre('lots');
  };
  $('#lo-main').onclick = async () => {
    const ok = await confirmerOuverture({ lot:'', parfum:'', volume:null });
    if (ok) rendre('lots');
  };
};

/* Feuille de confirmation après un scan : famille, parfum, taille, lot. */
function confirmerOuverture(r) {
  return new Promise(resolve => {
    let famille = r.parfum ? 'glace' : '';
    let parfum  = r.parfum || '';
    let taille  = r.volume || FOURNISSEUR.tailleParDefaut;

    const garder = () => {
      const l = $('#co-lot'); if (l) r.lot = l.value.trim().toUpperCase();
    };

    const dessiner = () => {
      const fam = FAMILLES_PRODUIT.filter(f => f.id === famille)[0];
      $('#sheet-corps').innerHTML =
        '<h2 id="sheet-titre">Ouvrir un produit</h2>' +
        '<p class="cs">Ce bac sort de la chambre froide et monte en vitrine.</p>' +

        '<div class="champ" style="margin-top:16px"><label class="f">Famille</label>' +
        '<div class="pastilles">' + FAMILLES_PRODUIT.map(f =>
          '<button type="button" class="pas' + (f.id === famille ? ' on' : '') +
          '" data-fam="' + f.id + '">' + esc(f.libelle) + '</button>').join('') + '</div></div>' +

        (fam && fam.parfums
          ? '<div class="champ" style="margin-top:14px"><label class="f">Parfum</label>' +
            '<select id="co-parfum">' + PARFUMS.map(p =>
              '<option' + (p === parfum ? ' selected' : '') + '>' + esc(p) + '</option>').join('') +
            '</select></div>' +
            '<div class="champ" style="margin-top:14px"><label class="f">Taille du bac</label>' +
            '<div class="pastilles">' + (FOURNISSEUR.taillesBac || TAILLES_BAC).map(t =>
              '<button type="button" class="pas' + (num(t) === num(taille) ? ' on' : '') +
              '" data-taille="' + t + '">' + t + ' L</button>').join('') + '</div></div>'
          : '') +

        '<div class="champ" style="margin-top:14px"><label class="f">Numéro de lot</label>' +
        '<input type="text" id="co-lot" value="' + esc(r.lot || '') + '" ' +
        'autocapitalize="characters" spellcheck="false" placeholder="14001A"></div>' +

        '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
        '<button class="btn menthe" id="co-ok">Confirmer l’ouverture</button></div>';

      $$('[data-fam]').forEach(b => b.onclick = () => {
        garder(); famille = b.dataset.fam; dessiner();
      });
      $$('[data-taille]').forEach(b => b.onclick = () => {
        garder(); taille = b.dataset.taille; dessiner();
      });
      const sp = $('#co-parfum');
      if (sp) sp.onchange = () => { parfum = sp.value; };
      $('#co-ok').onclick = enregistrer;
    };

    async function enregistrer() {
      garder();
      const fam = FAMILLES_PRODUIT.filter(f => f.id === famille)[0];
      if (!fam) return toast('Choisissez la famille', 'erreur');
      if (fam.parfums && !parfum) {
        const sp = $('#co-parfum');
        if (sp) parfum = sp.value;
        if (!parfum) return toast('Choisissez le parfum', 'erreur');
      }
      const lot = (r.lot || '').trim().toUpperCase();
      if (!lot) return toast('Le numéro de lot est obligatoire', 'erreur');

      /* Un bac ne sort qu'une fois de la chambre froide : sortie, ouverture et
         mise en vitrine sont le même geste. Rescanner un bac déjà en vitrine —
         par habitude, ou parce qu'on ne sait plus si c'est fait — décompterait
         un second bac qui n'existe pas. C'est arrivé le 15 septembre : quinze
         scans en une matinée, dont onze sur des bacs ouverts la veille. */
      const deja = await lotDejaOuvert(lot).catch(() => null);
      if (deja) {
        return confirmer('Ce lot est déjà ouvert',
          'Le lot ' + lot + ' a été ouvert le ' + fmtD(deja.jour) + '. Ce bac est ' +
          'donc déjà en vitrine, et déjà retiré du stock. Confirmer en retirerait ' +
          'un second — à ne faire que s’il s’agit vraiment d’un autre bac.',
          'Ouvrir quand même', () => { poser(fam, lot); });
      }
      await poser(fam, lot);
    }

    async function poser(fam, lot) {
      const cle = cleArticle(fam.id, fam.parfums ? parfum : '', fam.parfums ? taille : '');
      await ajouterMouvement('ouverture', cle, 1, { lot: lot, famille: fam.id, parfum: parfum });
      await feed('ok', STATE.user.prenom + ' a ouvert ' +
        (parfum || fam.libelle) + ' — lot ' + lot);
      closeSheet();
      resolve(true);
    }

    showSheet('<div class="vide">…</div>');
    dessiner();
  });
}
`;

const resultat = src.replace(/\s*$/, '\n') + V_LOTS;

try { new Function(resultat); }
catch (e) {
  console.error('ABANDON — ne compile pas : ' + e.message);
  process.exit(1);
}

fs.writeFileSync(cible, resultat, 'utf8');

const vues = (resultat.match(/^V\.\w+ = async function/gm) || []).length;
console.log('V.lots restaurée, avec la vérification du lot déjà ouvert.');
console.log('  vues dans stock.js : ' + vues + ' (stock, controle, inventaire, lots)');
console.log('  lignes : ' + resultat.split('\n').length);
