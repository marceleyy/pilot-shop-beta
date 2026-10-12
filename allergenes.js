/* =============================================================================
   PILOT-SHOP — allergenes.js
   Allergènes et régimes au comptoir : une fiche par parfum, tirée du document
   officiel Amorino, et une recherche rapide (« sans fruits à coque », « vegan »).
   L'affichage des allergènes est obligatoire (règlement INCO, UE 1169/2011).

   MISE À JOUR : à chaque nouvelle version du PDF Amorino, reprendre la colonne
   « Allergènes » parfum par parfum, changer ALLERGENES.source (date et lien),
   puis monter la version du cache dans sw.js. Rien n'est stocké en base :
   la fiche est la même pour toutes les boutiques et marche hors ligne.
   Chargé après app.js (esc, carte, pastille, showSheet, rendre).
   ============================================================================= */

   'use strict';

PAGES.allergenes = { titre:'Allergènes', sous:'Parfums, nappages et cornets' };
/* En tête du menu de l'équipe : c'est au comptoir que la question se pose. */
if (MENU_PLUS.equipe.indexOf('allergenes') < 0) MENU_PLUS.equipe.unshift('allergenes');
if (MENU_PLUS.manager.indexOf('allergenes') < 0) MENU_PLUS.manager.push('allergenes');

const ALLERGENES = {
  source: {
    titre: 'Allergènes et valeurs nutritionnelles',
    date: '15 novembre 2025',
    url: 'https://admin.amorino.com/wp-content/uploads/2025/11/AMORINO_Allergens-nutri_15nov25.pdf'
  },

  /* Les 14 allergènes de l'annexe II du règlement INCO. « mots » sert à la
     recherche tapée (sans accents) : « sans cacahuète » vaut « sans arachide ». */
  liste: [
    { id:'gluten',   libelle:'Gluten',          mots:['gluten', 'ble', 'froment'] },
    { id:'crustaces',libelle:'Crustacés',       mots:['crustace', 'crustaces'] },
    { id:'oeufs',    libelle:'Œufs',            mots:['oeufs', 'oeuf'] },
    { id:'poissons', libelle:'Poissons',        mots:['poissons', 'poisson'] },
    { id:'arachide', libelle:'Arachide',        mots:['arachides', 'arachide', 'cacahuetes', 'cacahuete'] },
    { id:'soja',     libelle:'Soja',            mots:['soja'] },
    { id:'lait',     libelle:'Lait',            mots:['lactose', 'laitier', 'lait'] },
    { id:'coque',    libelle:'Fruits à coque',  mots:['fruits a coque', 'fruit a coque', 'fruits a coques', 'noix', 'noisettes', 'noisette', 'amandes', 'amande', 'pistaches', 'pistache'] },
    { id:'celeri',   libelle:'Céleri',          mots:['celeri'] },
    { id:'moutarde', libelle:'Moutarde',        mots:['moutarde'] },
    { id:'sesame',   libelle:'Sésame',          mots:['sesame'] },
    { id:'sulfites', libelle:'Sulfites',        mots:['sulfites', 'sulfite'] },
    { id:'lupin',    libelle:'Lupin',           mots:['lupin'] },
    { id:'mollusques', libelle:'Mollusques',    mots:['mollusques', 'mollusque'] }
  ],

  /* Filtres en un appui, les plus demandés au comptoir. */
  rapides: ['lait', 'oeufs', 'coque', 'arachide', 'soja', 'gluten'],

  familles: [
    { id:'glace',   libelle:'Glaces' },
    { id:'sorbet',  libelle:'Sorbets' },
    { id:'nappage', libelle:'Nappages et toppings' },
    { id:'support', libelle:'Cornets, gaufres et crêpes' }
  ],

  /* a : allergènes contenus ; t : traces possibles (« peut contenir ») ;
     vegan : aucun ingrédient animal dans la liste Amorino (ni lait, ni œuf,
     ni beurre, ni miel). Le document ne porte pas de mention « vegan » : c'est
     déduit des ingrédients, et seulement pour les parfums.
     Les glaces et sorbets ne contiennent pas de gluten ; c'est le support
     (cornet, gaufre…) qui en apporte. */
  produits: [
    { f:'glace', nom:'Amarena (cerise griotte et son coulis)', a:['lait', 'oeufs', 'soja'] },
    { f:'glace', nom:'Cacahuètes grillées',                   a:['oeufs', 'lait', 'soja', 'arachide'] },
    { f:'glace', nom:'Café 100 % arabica',                    a:['lait', 'oeufs', 'coque', 'soja'] },
    { f:'glace', nom:'Caramel au beurre demi-sel',            a:['lait', 'oeufs', 'soja'] },
    { f:'glace', nom:'Chai latte',                            a:['lait', 'soja'] },
    { f:'glace', nom:'Cheesecake myrtille',                   a:['lait', 'soja'] },
    { f:'glace', nom:'Chocolat Amorino',                      a:['lait', 'oeufs', 'soja'] },
    { f:'glace', nom:'Chocolat blanc myrtille',               a:['lait', 'soja'] },
    { f:'glace', nom:'Chocolat Équateur pure origine',        a:['lait', 'soja'] },
    { f:'glace', nom:'Crema fleur d’oranger',                 a:['lait', 'oeufs', 'soja'] },
    { f:'glace', nom:'Dulce de leche',                        a:['lait', 'soja'] },
    { f:'glace', nom:'Fleur de lait et nappage pistache',     a:['lait', 'coque', 'soja'] },
    { f:'glace', nom:'L’Inimitable crème chocolat noisette',  a:['lait', 'oeufs', 'coque', 'soja'] },
    { f:'glace', nom:'Marron glacé au rhum',                  a:['lait', 'coque', 'soja'], note:'Contient du rhum (1,9 %).' },
    { f:'glace', nom:'Mascarpone figues',                     a:['lait', 'soja'] },
    { f:'glace', nom:'Menthe et copeaux de chocolat',         a:['lait', 'soja'] },
    { f:'glace', nom:'Noisette',                              a:['lait', 'oeufs', 'coque', 'soja'] },
    { f:'glace', nom:'Noisette et nappage gianduja',          a:['lait', 'oeufs', 'coque', 'soja'] },
    { f:'glace', nom:'Noix de coco du Sri Lanka',             a:['lait', 'soja'] },
    { f:'glace', nom:'Nougat',                                a:['lait', 'oeufs', 'coque', 'soja'], note:'Contient du miel.' },
    { f:'glace', nom:'Pistache Mawardi',                      a:['lait', 'oeufs', 'coque', 'soja'] },
    { f:'glace', nom:'Stracciatella',                         a:['lait', 'soja'] },
    { f:'glace', nom:'Speculoos sans gluten',                 a:['lait', 'oeufs', 'soja'] },
    { f:'glace', nom:'Tiramisu sans gluten',                  a:['lait', 'oeufs', 'coque', 'soja'] },
    { f:'glace', nom:'Vanille Bourbon de Madagascar',         a:['lait', 'soja'] },
    { f:'glace', nom:'Yaourt 0 % de matière grasse',          a:['lait', 'soja'] },

    { f:'sorbet', nom:'Ananas menthe',                        a:[], vegan:true },
    { f:'sorbet', nom:'Banane Nanica du Brésil',              a:[], vegan:true },
    { f:'sorbet', nom:'Chocolat biologique',                  a:[], vegan:true },
    { f:'sorbet', nom:'Citron bio Femminello de Syracuse',    a:[], vegan:true },
    { f:'sorbet', nom:'Citron vert basilic',                  a:[], vegan:true },
    { f:'sorbet', nom:'Coco mangue citron vert',              a:[], vegan:true },
    { f:'sorbet', nom:'Fraise',                               a:[], vegan:true },
    { f:'sorbet', nom:'Framboise',                            a:[], vegan:true },
    { f:'sorbet', nom:'Framboise et nappage chocolat blanc',  a:['lait', 'soja'] },
    { f:'sorbet', nom:'Fruit de la passion',                  a:[], vegan:true },
    { f:'sorbet', nom:'Fruits rouges IG bas',                 a:[], vegan:true, note:'Édulcorant : érythritol.' },
    { f:'sorbet', nom:'Mandarine',                            a:[], vegan:true },
    { f:'sorbet', nom:'Mangue Alphonso d’Inde',               a:[], vegan:true },
    { f:'sorbet', nom:'Orange cannelle bio',                  a:[], vegan:true },
    { f:'sorbet', nom:'Orange sanguine',                      a:[], vegan:true },
    { f:'sorbet', nom:'Pistache',                             a:['coque'], vegan:true },
    { f:'sorbet', nom:'Poire hibiscus',                       a:[], vegan:true },

    { f:'nappage', nom:'Gianduja',                            a:['lait', 'coque', 'soja'] },
    { f:'nappage', nom:'Crème à la pistache',                 a:['soja', 'lait', 'coque'], t:['coque'] },
    { f:'nappage', nom:'Chocolat noir (fondente)',            a:['lait', 'soja'], t:['coque'] },
    { f:'nappage', nom:'Dulce de leche',                      a:['lait'] },
    { f:'nappage', nom:'Caramel au beurre salé',              a:['lait'] },
    { f:'nappage', nom:'Marmelade et cerise amarena',         a:[] },
    { f:'nappage', nom:'Coulis de fruits rouges',             a:[] },
    { f:'nappage', nom:'Éclats de noisettes',                 a:['coque'] },
    { f:'nappage', nom:'Chocolat noir en poudre',             a:[] },
    { f:'nappage', nom:'Crispearl noir',                      a:['lait', 'soja', 'gluten'] },
    { f:'nappage', nom:'Grains de chocolat au café, éclats de caramel', a:['coque', 'soja'],
      t:['arachide', 'oeufs', 'gluten', 'sesame', 'lait'] },

    { f:'support', nom:'Cornet (petit, moyen, grand)',        a:['gluten', 'soja'] },
    { f:'support', nom:'Choco-cône',                          a:['gluten', 'soja', 'coque'] },
    { f:'support', nom:'Cornet sans gluten',                  a:['soja'] },
    { f:'support', nom:'Gaufre de Bruxelles',                 a:['gluten', 'oeufs', 'lait', 'soja'] },
    { f:'support', nom:'Crêpe',                               a:['gluten', 'lait', 'oeufs'] },
    { f:'support', nom:'Brioche',                             a:['gluten', 'oeufs', 'lait'] }
  ]
};

/* Minuscules sans accents, ligatures ni ponctuation : « Œufs, » vaut « oeufs ». */
function allNorm(s) {
  return String(s || '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function allLibelle(id) {
  const x = ALLERGENES.liste.filter(l => l.id === id)[0];
  return x ? x.libelle : id;
}

/* Lit une recherche tapée, mot à mot. « sans » (ou « pas de ») ouvre une
   liste d'exclusions qui court tant qu'on lit des allergènes et des mots de
   liaison : « sans lait et œufs », « sans les pistaches ». « vegan » garde les
   parfums sans ingrédient animal ; le reste cherche dans le nom. */
const ALL_LIAISON = ['et', 'ou', 'ni', 'de', 'd', 'du', 'des', 'la', 'le', 'les', 'l',
  'aucun', 'aucune', 'pas', 'sans', 'avec'];
const ALL_VEGAN = ['vegan', 'vegans', 'vegane', 'veganes', 'vegetalien', 'vegetalienne', 'vegetaliens'];

function allLireRecherche(texte) {
  const t = allNorm(texte).split(' ').filter(Boolean);
  /* Synonymes découpés en mots, les plus longs d'abord : « fruits a coque ». */
  const syn = [];
  ALLERGENES.liste.forEach(l => l.mots.forEach(m => syn.push([m.split(' '), l.id])));
  syn.sort((x, y) => y[0].length - x[0].length);
  const lire = i => {
    for (const [m, id] of syn)
      if (m.every((w, k) => t[i + k] === w)) return { id, n:m.length };
    return null;
  };

  const sans = [], mots = [];
  let vegan = false, exclure = false;
  for (let i = 0; i < t.length; ) {
    const w = t[i];
    if (ALL_VEGAN.indexOf(w) >= 0) { vegan = true; i++; continue; }
    if (w === 'sans' || (w === 'pas' && t[i + 1] === 'de')) { exclure = true; i++; continue; }
    const a = exclure ? lire(i) : null;
    if (a) { if (sans.indexOf(a.id) < 0) sans.push(a.id); i += a.n; continue; }
    if (ALL_LIAISON.indexOf(w) >= 0) { i++; continue; }
    exclure = false;
    mots.push(w);
    i++;
  }
  return { sans, vegan, mots };
}

function allFiltrer(r) {
  return ALLERGENES.produits.filter(p => {
    if (r.vegan && !p.vegan) return false;
    for (const id of r.sans) if (p.a.indexOf(id) >= 0 || (p.t || []).indexOf(id) >= 0) return false;
    if (!r.mots.length) return true;
    const fam = ALLERGENES.familles.filter(x => x.id === p.f)[0];
    const cible = allNorm(p.nom + ' ' + (fam ? fam.libelle : '') + ' ' + p.f);
    return r.mots.every(m => cible.indexOf(m) >= 0);
  });
}

/* =============================================================================
   VUE — ALLERGÈNES
   ========================================================================== */
V.allergenes = async function () {
  const st = V.allergenes._st || (V.allergenes._st = { q:'', sans:[], vegan:false });
  const src = ALLERGENES.source;

  $('#page').innerHTML =
    carte(
      '<div class="champ"><label class="f" for="al-q">Rechercher</label>' +
      '<input type="search" id="al-q" autocomplete="off" enterkeyhint="search" ' +
        'placeholder="Ex. : sans fruits à coque, vegan, pistache" value="' + esc(st.q) + '"></div>' +
      '<div class="chips" id="al-chips" style="margin-top:12px">' +
        ALLERGENES.rapides.map(id =>
          '<button type="button" class="chip corail' + (st.sans.indexOf(id) >= 0 ? ' on' : '') +
          '" data-sans="' + id + '" aria-pressed="' + (st.sans.indexOf(id) >= 0) + '">Sans ' +
          esc(allLibelle(id).toLowerCase()) + '</button>').join('') +
        '<button type="button" class="chip menthe' + (st.vegan ? ' on' : '') +
          '" data-vegan="1" aria-pressed="' + st.vegan + '">Vegan</button>' +
      '</div>', 'solide') +
    '<p class="mini" id="al-n" aria-live="polite" style="margin:14px 2px 0"></p><div id="al-res"></div>' +
    '<div class="alerte warn" style="margin-top:16px"><span class="ai">•</span><div>' +
      '<b>Allergie sévère</b><p>Le document Amorino ne couvre pas le service : prenez une spatule ' +
      'propre et servez en pot ou dans le cornet sans gluten si besoin.</p></div></div>' +
    '<p class="mini" style="margin-top:14px">Source : document Amorino « ' + esc(src.titre) + ' » du ' +
      esc(src.date) + '. À mettre à jour à chaque nouvelle version.</p>';

  const dessiner = () => {
    const r = allLireRecherche(st.q);
    st.sans.forEach(id => { if (r.sans.indexOf(id) < 0) r.sans.push(id); });
    if (st.vegan) r.vegan = true;
    const res = allFiltrer(r);

    const filtres = r.sans.map(id => 'sans ' + allLibelle(id).toLowerCase())
      .concat(r.vegan ? ['vegan'] : []);
    $('#al-n').textContent =
      (res.length ? res.length + ' produit' + (res.length > 1 ? 's' : '') : 'Aucun produit') +
      (filtres.length ? ' ' + filtres.join(', ') : '') +
      /* Le « vegan » n'est établi que pour les parfums : les cornets et
         nappages sortent de la liste, il faut le dire. */
      (r.vegan ? '. Vegan vérifié pour les glaces et sorbets seulement.' : '');
    let html = '';

    ALLERGENES.familles.forEach(fam => {
      const l = res.filter(p => p.f === fam.id);
      if (!l.length) return;
      html += '<div class="entete"><h3>' + esc(fam.libelle) + '</h3></div><div class="stack">' +
        l.map(p => {
          const i = ALLERGENES.produits.indexOf(p);
          const pills = (p.a.length
            ? p.a.map(id => pastille('bad', allLibelle(id))).join('')
            : pastille('ok', 'Aucun allergène majeur')) +
            (p.t && p.t.length ? pastille('warn', 'Traces') : '') +
            (p.vegan ? pastille('ok', 'Vegan') : '');
          return '<div class="card tap" data-al="' + i + '" role="button" tabindex="0">' +
            '<b>' + esc(p.nom) + '</b><div class="pastilles">' + pills + '</div></div>';
        }).join('') + '</div>';
    });
    if (!res.length) html += vide('', 'Rien ne correspond. Retirez un filtre ou changez la recherche.');

    $('#al-res').innerHTML = html;
    $$('#al-res [data-al]').forEach(c => {
      const ouvrir = () => allFiche(ALLERGENES.produits[+c.dataset.al]);
      c.onclick = ouvrir;
      c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvrir(); } };
    });
  };

  $('#al-q').oninput = e => { st.q = e.target.value; dessiner(); };
  $$('#al-chips [data-sans]').forEach(b => b.onclick = () => {
    const id = b.dataset.sans, k = st.sans.indexOf(id);
    if (k >= 0) st.sans.splice(k, 1); else st.sans.push(id);
    b.classList.toggle('on', k < 0);
    b.setAttribute('aria-pressed', String(k < 0));
    dessiner();
  });
  $('#al-chips [data-vegan]').onclick = e => {
    st.vegan = !st.vegan;
    e.currentTarget.classList.toggle('on', st.vegan);
    e.currentTarget.setAttribute('aria-pressed', String(st.vegan));
    dessiner();
  };
  dessiner();
};

function allFiche(p) {
  const parfum = p.f === 'glace' || p.f === 'sorbet';
  const fam = ALLERGENES.familles.filter(x => x.id === p.f)[0];
  const ligne = (titre, texte, cls) =>
    '<div class="alerte ' + cls + '"><span class="ai">•</span><div><b>' + esc(titre) + '</b><p>' + esc(texte) + '</p></div></div>';

  showSheet(
    '<h2 id="sheet-titre">' + esc(p.nom) + '</h2>' +
    '<p class="sub">' + esc(fam ? fam.libelle : '') + '</p>' +
    '<div class="stack">' +
      (p.a.length
        ? ligne('Contient', p.a.map(allLibelle).join(', '), 'bad')
        : ligne('Contient', 'Aucun des 14 allergènes majeurs.', 'ok')) +
      (p.t && p.t.length ? ligne('Peut contenir des traces de', p.t.map(allLibelle).join(', '), 'warn') : '') +
      (parfum
        ? ligne('Gluten', 'Le parfum n’en contient pas. Le cornet, le choco-cône, la gaufre, la crêpe et la ' +
            'brioche en contiennent : servir en pot ou dans le cornet sans gluten.', 'info') +
          ligne('Vegan', p.vegan
            ? 'Oui : aucun ingrédient animal dans la liste Amorino (ni lait, ni œuf, ni beurre, ni miel).'
            : 'Non : contient ' + (p.a.indexOf('lait') >= 0 ? 'du lait' : 'un ingrédient animal') + '.',
            p.vegan ? 'ok' : 'info')
        : '') +
      (p.note ? ligne('À savoir', p.note, 'info') : '') +
    '</div>' +
    '<p class="mini" style="margin-top:14px">Document Amorino du ' + esc(ALLERGENES.source.date) + '.</p>' +
    '<div class="actions"><button class="btn clair" data-fermer>Fermer</button></div>');
}
