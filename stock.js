/* =============================================================================
   PILOT-SHOP — stock.js
   Une seule valeur de vérité : le stock réel, exprimé en bacs.

   Trois mouvements l'alimentent, et trois seulement :
     • l'INVENTAIRE le FIXE   — c'est le point de départ, il efface le passé ;
     • la RÉCEPTION l'AUGMENTE ;
     • l'OUVERTURE d'un bac le DIMINUE.

   D'où la formule, pour un article donné :
       stock réel = quantité au dernier inventaire
                  + réceptions depuis
                  − ouvertures depuis

   Le test de référence : inventaire à 10, réception de 10, ouverture de 2
   doit donner 18.

   Chargé APRÈS modules.js.
   ============================================================================= */

'use strict';

/* Devine la famille d'un produit d'après son libellé. En cas de doute, on
   retombe sur la glace : c'est 90 % des références d'une livraison Jetfreeze. */
function devinerFamille(nom) {
  const n = String(nom || '').toLowerCase();
  if (/macaron/.test(n) && /grandioso/.test(n)) return FAMILLES_PRODUIT[2];
  if (/macaron/.test(n))                         return FAMILLES_PRODUIT[1];
  if (/gianduiotto|gianduja/.test(n))            return FAMILLES_PRODUIT[3];
  if (/gaufre|waffle/.test(n))                   return FAMILLES_PRODUIT[4];
  if (/cr[eê]pe/.test(n))                        return FAMILLES_PRODUIT[5];
  if (/chantilly/.test(n))                       return FAMILLES_PRODUIT[6];
  if (/coulis/.test(n))                          return FAMILLES_PRODUIT[7];
  if (/topping|sauce|nappage/.test(n))           return FAMILLES_PRODUIT[8];
  return FAMILLES_PRODUIT[0];
}

/* -----------------------------------------------------------------------------
   CLÉ D'ARTICLE
   Un article, c'est une famille, un parfum (pour les glaces seulement) et une
   taille de bac. « glace|Noix de coco|5 » et « glace|Noix de coco|3 » sont deux
   articles distincts : on ne mélange pas un 5 litres et un 3 litres.
   -------------------------------------------------------------------------- */
function cleArticle(famille, parfum, taille) {
  return [famille || '', parfum || '', taille || ''].join('|');
}
function litArticle(cle) {
  const p = String(cle).split('|');
  return { famille: p[0] || '', parfum: p[1] || '', taille: p[2] || '' };
}
function libelleArticle(cle) {
  const a = litArticle(cle);
  const f = FAMILLES_PRODUIT.filter(x => x.id === a.famille)[0];
  return [a.parfum, f ? f.libelle : a.famille, a.taille ? a.taille + ' L' : '']
    .filter(Boolean).join(' · ');
}

/* -----------------------------------------------------------------------------
   ÉCRITURE DES MOUVEMENTS
   Journal en ajout seul : on n'efface jamais une ligne, on en ajoute une qui
   corrige. C'est ce qui permet de reconstituer l'historique lors d'un contrôle.

   Chaque ligne est tenue courte à dessein. Une ligne bavarde pèse 240 octets ;
   4 000 lignes font alors 930 Ko, au-dessus du seuil au-delà duquel une clé
   n'est plus envoyée à Supabase. Le journal serait resté sur l'iPad, sans
   erreur visible, au bout de deux à trois mois de saison.
   Le détail lisible (famille, parfum, taille) est déjà dans la clé : on ne le
   duplique pas.
   -------------------------------------------------------------------------- */
const STOCK_POIDS_MAX = 500000;     // octets, bien en deçà du seuil de synchronisation
const STOCK_LIGNES_MAX = 2500;

async function ajouterMouvement(type, cle, qte, extra) {
  let l = await DB.get('stock:mouvements', []);

  /* Garde-fou contre le double appui : deux mouvements identiques à moins de
     quinze secondes d'intervalle sont presque toujours une erreur de manipulation,
     et ils fausseraient le stock de façon invisible. */
  const dernier = l[l.length - 1];
  if (dernier && dernier.t === type && dernier.c === cle &&
      num(dernier.q) === num(qte) &&
      ((extra && extra.lot) ? dernier.l === extra.lot : true) &&
      (Date.now() - new Date(dernier.a)) < 15000) {
    toast('Déjà enregistré il y a quelques secondes', 'erreur');
    return dernier;
  }

  /* Champs courts : t=type, c=clé, q=quantité, a=horodatage, e=employé, l=lot */
  const m = { t:type, c:cle, q:num(qte), a:nowISO(),
              e: STATE.user ? STATE.user.id : null };
  if (extra && extra.lot) m.l = extra.lot;
  if (extra && extra.bl)  m.b = extra.bl;
  if (extra && extra.motif) m.mo = extra.motif;
  l.push(m);

  l = await purgerJournal(l);
  await DB.set('stock:mouvements', l);
  return m;
}

/* Purge fondée sur le poids autant que sur le nombre. Règle intangible :
   un mouvement postérieur au dernier inventaire n'est JAMAIS supprimé, sinon
   le stock deviendrait faux sans que rien ne le signale. */
async function purgerJournal(l) {
  let poids = 0;
  try { poids = JSON.stringify(l).length; } catch (e) { poids = l.length * 240; }
  if (l.length <= STOCK_LIGNES_MAX && poids <= STOCK_POIDS_MAX) return l;

  const inv = await DB.get('stock:inventaire', null);
  const borne = inv ? inv.at : null;
  const recents = borne ? l.filter(m => (m.a || m.at) > borne) : [];
  const anciens = borne ? l.filter(m => (m.a || m.at) <= borne) : l.slice();

  /* On rogne dans les anciens jusqu'à repasser sous les deux plafonds. */
  let garde = anciens;
  while (garde.length &&
         (garde.length + recents.length > STOCK_LIGNES_MAX ||
          JSON.stringify(garde.concat(recents)).length > STOCK_POIDS_MAX)) {
    garde = garde.slice(Math.max(1, Math.ceil(garde.length * 0.2)));
  }

  if (!garde.length && recents.length > STOCK_LIGNES_MAX) {
    /* Cas extrême : plus de 2 500 mouvements depuis le dernier inventaire.
       On garde tout quand même — fausser le stock serait pire — et on alerte. */
    console.warn('Journal de stock volumineux : ' + recents.length +
                 ' mouvements depuis le dernier inventaire. Faites un inventaire.');
  }
  return garde.concat(recents);
}

/* Un inventaire remplace le précédent : il fixe la référence. */
async function enregistrerInventaire(lignes, note) {
  const inv = {
    jour: today(), at: nowISO(),
    par: STATE.user ? STATE.user.prenom : null,
    employe: STATE.user ? STATE.user.id : null,
    note: note || '',
    lignes: lignes            // { cleArticle : quantité }
  };
  /* On garde les précédents pour l'historique, mais seul le dernier compte. */
  const hist = await DB.get('stock:inventaires', []);
  hist.push(inv);
  await DB.set('stock:inventaires', hist.slice(-36));
  await DB.set('stock:inventaire', inv);
  return inv;
}

/* -----------------------------------------------------------------------------
   CALCUL DU STOCK RÉEL
   -------------------------------------------------------------------------- */
async function stockReel() {
  const inv = await DB.get('stock:inventaire', null);
  const mouv = await DB.get('stock:mouvements', []);

  const out = {};
  const dateInv = inv ? inv.at : null;

  if (inv && inv.lignes) {
    Object.keys(inv.lignes).forEach(c => { out[c] = num(inv.lignes[c]); });
  }

  mouv.forEach(m => {
    /* Format court depuis la réduction du journal, format long avant : on lit
       les deux pour ne pas invalider l'historique déjà écrit. */
    const type = m.t || m.type;
    const c    = m.c || m.cle;
    const q    = num(m.q !== undefined ? m.q : m.qte);
    const at   = m.a || m.at;
    if (!c) return;
    if (dateInv && at <= dateInv) return;   // déjà compris dans l'inventaire
    if (out[c] === undefined) out[c] = 0;
    if (type === 'reception') out[c] += q;
    else if (type === 'ouverture' || type === 'perte') out[c] -= q;
  });

  return { articles: out, inventaire: inv, depuis: inv ? inv.jour : null };
}

/* Lecture unifiée d'un mouvement, quel que soit le format d'écriture. */
function litMouvement(m) {
  return {
    type: m.t || m.type,
    cle:  m.c || m.cle,
    qte:  num(m.q !== undefined ? m.q : m.qte),
    at:   m.a || m.at,
    jour: (m.a || m.at || '').slice(0, 10),
    lot:  m.l || m.lot || '',
    employe: m.e || m.employe || null
  };
}

/* Total en bacs et en litres, pour le calcul d'écart. */
function totauxStock(articles) {
  let bacs = 0, litres = 0;
  Object.keys(articles).forEach(c => {
    const q = num(articles[c]);
    if (q === 0) return;
    bacs += q;
    const t = num(litArticle(c).taille);
    if (t) litres += q * t;
  });
  return { bacs: bacs, litres: litres, kg: litres * FOURNISSEUR.poidsMoyenLitre };
}

/* -----------------------------------------------------------------------------
   VUE — STOCK RÉEL
   -------------------------------------------------------------------------- */
V.stock = async function () {
  const { articles, inventaire } = await stockReel();
  const cles = Object.keys(articles).filter(c => num(articles[c]) !== 0)
    .sort((a, b) => libelleArticle(a).localeCompare(libelleArticle(b)));
  const t = totauxStock(articles);

  /* Regroupement par famille, pour ne pas dérouler quarante lignes à plat. */
  const parFamille = {};
  cles.forEach(c => {
    const f = litArticle(c).famille;
    (parFamille[f] = parFamille[f] || []).push(c);
  });

  $('#vue-actions').innerHTML = '';
  $('#page').innerHTML =
    carte('<div class="grid g3">' +
      kpi('Bacs', t.bacs, '', 'En stock') +
      kpi('Litres', n1(t.litres), '', 'Volume total') +
      kpi('Poids', n1(t.kg) + ' kg', '', 'Stock réel') + '</div>' +
      '<p class="mini" style="margin-top:12px">' +
      (inventaire
        ? 'Dernier inventaire le ' + fmtD(inventaire.jour) +
          (inventaire.par ? ' par ' + esc(inventaire.par) : '') + '.'
        : 'Aucun inventaire enregistré. Le stock ne compte que les réceptions ' +
          'et les ouvertures depuis la mise en service.') + '</p>', 'solide') +

    '<button class="btn menthe bloc xl" id="st-inv" style="margin-top:14px">Faire un inventaire</button>' +

    (cles.length
      ? Object.keys(parFamille).map(f => {
          const fam = FAMILLES_PRODUIT.filter(x => x.id === f)[0];
          const sous = parFamille[f].reduce((s, c) => s + num(articles[c]), 0);
          return '<div class="entete"><h3>' + esc(fam ? fam.libelle : f) + '</h3>' +
            '<span class="pousse mini num">' + sous + ' bac(s)</span></div>' +
            '<div class="stack">' + parFamille[f].map(c => {
              const a = litArticle(c), q = num(articles[c]);
              return carte('<div class="rang">' +
                '<div style="flex:1;min-width:0"><b>' + esc(a.parfum || (fam ? fam.libelle : f)) + '</b>' +
                (a.taille ? '<div class="mini">Bac de ' + a.taille + ' L</div>' : '') + '</div>' +
                '<b class="num" style="font-size:20px">' + q + '</b></div>',
                q < 0 ? 'corail' : '');
            }).join('') + '</div>';
        }).join('')
      : vide('', 'Stock vide. Commencez par un inventaire.'));

  $('#st-inv').onclick = () => rendre('inventaire');
};

/* -----------------------------------------------------------------------------
   VUE — INVENTAIRE
   Saisie des quantités, article par article. Ce que la personne compte devient
   la nouvelle référence : tout ce qui précède est effacé du calcul.
   -------------------------------------------------------------------------- */
V.inventaire = async function () {
  const { articles } = await stockReel();
  const precedent = await DB.get('stock:inventaire', null);
  const saisie = {};          // cle -> quantité tapée

  /* Une ligne par parfum, avec ses quatre tailles côte à côte. En dépliant
     chaque taille sur sa propre ligne, l'écran faisait 96 lignes — soit six
     mètres de défilement pour un comptage de chambre froide. */
  const autres = FAMILLES_PRODUIT.filter(f => !f.parfums);

  const total = () => Object.keys(saisie).reduce((s, c) => s + num(saisie[c]), 0);
  const totalLitres = () => Object.keys(saisie).reduce((s, c) => {
    const t = num(litArticle(c).taille);
    return s + (t ? num(saisie[c]) * t : 0);
  }, 0);

  const majTotaux = () => {
    const b = total(), l = totalLitres();
    if ($('#inv-t')) $('#inv-t').textContent = b;
    if ($('#inv-kg')) $('#inv-kg').textContent = n1(l * FOURNISSEUR.poidsMoyenLitre) + ' kg';
  };

  const dessiner = () => {
    $('#vue-actions').innerHTML = '';
    $('#page').innerHTML =
      carte('<h2>Inventaire</h2>' +
        '<div class="cs">Comptez ce qui est physiquement présent. Ce relevé ' +
        'devient la nouvelle référence du stock.</div>' +
        (precedent
          ? '<p class="rappel" style="margin-top:12px">Dernier inventaire : ' +
            fmtD(precedent.jour) + (precedent.par ? ' par ' + esc(precedent.par) : '') + '</p>'
          : ''), 'solide') +

      '<div class="inv-total"><b class="num" id="inv-t">0</b><span>bacs</span>' +
      '<b class="num" id="inv-kg" style="margin-left:auto">0,0 kg</b></div>' +

      '<div class="entete"><h3>Glaces</h3>' +
      '<span class="pousse mini">' + TAILLES_BAC.join(' · ') + ' L</span></div>' +
      '<div class="stack">' + PARFUMS.map(p => {
        const enStock = TAILLES_BAC.reduce((s, t) => s + num(articles[cleArticle('glace', p, t)]), 0);
        return '<div class="invp">' +
          '<div class="invp-h"><b>' + esc(p) + '</b>' +
          (enStock ? '<span class="invc">' + enStock + ' en stock</span>' : '') + '</div>' +
          '<div class="invp-t">' + TAILLES_BAC.map(t => {
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
      }).join('') + '</div>' +

      '<div class="champ" style="margin-top:18px"><label class="f">Note</label>' +
      '<textarea id="inv-note" placeholder="Ce qui explique un écart, un bac abîmé, un doute."></textarea></div>' +

      '<button class="btn menthe bloc xl" id="inv-ok" style="margin-top:16px">Valider l’inventaire</button>';

    $$('[data-inv]').forEach(i => i.oninput = () => {
      if (i.value === '') delete saisie[i.dataset.inv];
      else saisie[i.dataset.inv] = i.value;
      majTotaux();
    });
    majTotaux();

    $('#inv-ok').onclick = async () => {
      const cptes = Object.keys(saisie);
      if (!cptes.length) return toast('Saisissez au moins une quantité', 'erreur');

      const lignes = {};
      cptes.forEach(c => { lignes[c] = num(saisie[c]); });
      const t = totauxStock(lignes);

      confirmer('Valider l’inventaire ?',
        t.bacs + ' bacs comptés sur ' + cptes.length + ' référence(s), soit ' +
        n1(t.kg) + ' kg. Ce relevé remplace la référence actuelle : tout ce qui ' +
        'précède ne sera plus compté.',
        'Valider', async () => {
          await enregistrerInventaire(lignes, $('#inv-note') ? $('#inv-note').value : '');
          await feed('ok', STATE.user.prenom + ' a fait l’inventaire — ' +
            t.bacs + ' bacs, ' + n1(t.kg) + ' kg');
          toast('Inventaire enregistré');
          rendre('stock');
        });
    };
  };

  dessiner();
};

/* -----------------------------------------------------------------------------
   VUE — TRAÇABILITÉ
   Un bouton, puis la liste des dernières ouvertures. Rien d'autre : l'équipe
   scanne et vérifie d'un coup d'œil que la ligne est apparue.
   Une ouverture décrémente le stock du même geste.
   -------------------------------------------------------------------------- */
V.lots = async function () {
  const mouv = await DB.get('stock:mouvements', []);
  const ouvertures = mouv.map(litMouvement)
    .filter(m => m.type === 'ouverture').slice(-40).reverse();

  $('#vue-actions').innerHTML = '';
  $('#page').innerHTML =
    carte('<h2>Traçabilité</h2>' +
      '<div class="cs">À l’ouverture de tout nouveau produit, pas à la livraison.</div>' +
      '<button class="btn menthe bloc xl" id="tr-scan" style="margin-top:14px">' +
      'Scanner une étiquette</button>' +
      '<button class="btn clair bloc" id="tr-main" style="margin-top:8px">Saisir à la main</button>',
      'solide') +

    (ouvertures.length
      ? '<div class="entete"><h3>Derniers produits ouverts</h3>' +
        '<span class="pousse mini num">' + ouvertures.length + '</span></div>' +
        '<div class="stack">' + ouvertures.map(m => {
          const a = litArticle(m.cle);
          const f = FAMILLES_PRODUIT.filter(x => x.id === a.famille)[0];
          return '<div class="lotl">' +
            '<span class="lotn">' + esc(a.parfum || (f ? f.libelle : a.famille)) + '</span>' +
            '<span class="lotf">' + esc(f ? f.libelle : a.famille) + '</span>' +
            '<span class="lotd">' + fmtDC(m.jour) + '</span>' +
            '<span class="lotb">' + esc(m.lot || '—') + '</span>' +
            '</div>';
        }).join('') + '</div>'
      : vide('', 'Aucun produit ouvert pour l’instant.'));

  $('#tr-scan').onclick = async () => {
    let n = 0;
    for (;;) {
      const r = await scannerPhoto('etiquette');
      if (!r) break;
      const ok = await confirmerOuverture(r);
      if (ok) n++;
      if (!r.enchainer || !ok) break;
    }
    if (n) toast(n + ' produit(s) tracé(s)');
    rendre('lots');
  };
  $('#tr-main').onclick = async () => {
    const ok = await confirmerOuverture({ lot:'', parfum:'', volume:null });
    if (ok) rendre('lots');
  };
};

/* Confirmation après scan : famille d'abord, parfum ensuite si c'est une glace.
   Neuf familles, pas vingt-deux parfums à faire défiler. */
function confirmerOuverture(r) {
  return new Promise(resolve => {
    /* Pré-sélection : si l'OCR a reconnu un parfum, c'est une glace. */
    let famille = r.parfum ? 'glace' : null;
    let parfum  = r.parfum || '';
    let taille  = r.volume || FOURNISSEUR.tailleParDefaut;

    const dessiner = () => {
      const fam = FAMILLES_PRODUIT.filter(f => f.id === famille)[0];
      $('#sheet-corps').innerHTML =
        '<h2 id="sheet-titre">Produit ouvert</h2>' +
        '<p class="sub">' + (r.lot ? 'Lot lu : ' + esc(r.lot) : 'Saisie manuelle') + '</p>' +

        '<div class="entete"><h3>Famille</h3></div>' +
        '<div class="chips" id="co-fam">' + FAMILLES_PRODUIT.map(f =>
          '<button type="button" class="chip' + (famille === f.id ? ' on' : '') +
          '" data-f="' + f.id + '">' + esc(f.libelle) + '</button>').join('') + '</div>' +

        (fam && fam.parfums
          ? '<div class="champ" style="margin-top:16px"><label class="f">Parfum</label>' +
            '<select id="co-p"><option value="">— choisir —</option>' +
            PARFUMS.map(p => '<option value="' + esc(p) + '"' +
              (p === parfum ? ' selected' : '') + '>' + esc(p) + '</option>').join('') +
            '</select></div>' +
            '<div class="champ" style="margin-top:14px"><label class="f">Taille du bac</label>' +
            '<select id="co-t">' + TAILLES_BAC.map(t =>
              '<option value="' + t + '"' + (t === taille ? ' selected' : '') + '>' +
              t + ' L</option>').join('') + '</select></div>'
          : '') +

        '<div class="champ" style="margin-top:14px"><label class="f">Numéro de lot</label>' +
        '<input type="text" id="co-l" value="' + esc(r.lot || '') + '" ' +
        'autocapitalize="characters" spellcheck="false" ' +
        'style="font-size:20px;letter-spacing:.12em;text-align:center"></div>' +

        (fam
          ? '<p class="aide">Conservation après ouverture : ' +
            Math.round(DLC_RULES[fam.dlc].h / 24) + ' jours.</p>'
          : '') +

        '<div class="actions"><button class="btn clair" id="co-x">Annuler</button>' +
        '<button class="btn menthe" id="co-ok">Enregistrer</button></div>';

      $$('#co-fam [data-f]').forEach(b => b.onclick = () => {
        garder(); famille = b.dataset.f; dessiner();
      });
      $('#co-x').onclick = () => { closeSheet(); resolve(false); };
      $('#co-ok').onclick = enregistrer;
    };

    const garder = () => {
      if ($('#co-p')) parfum = $('#co-p').value;
      if ($('#co-t')) taille = num($('#co-t').value);
      if ($('#co-l')) r.lot = $('#co-l').value;
    };

    async function enregistrer() {
      garder();
      const fam = FAMILLES_PRODUIT.filter(f => f.id === famille)[0];
      if (!fam) return toast('Choisissez la famille', 'erreur');
      if (fam.parfums && !parfum) return toast('Choisissez le parfum', 'erreur');
      const lot = (r.lot || '').trim().toUpperCase();
      if (!lot) return toast('Le numéro de lot est obligatoire', 'erreur');

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
