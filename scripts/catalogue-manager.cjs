/* =============================================================================
   scripts/catalogue-manager.cjs

   Le manager peut modifier le catalogue du sec depuis le Back-office, sans
   passer par le code : retirer une référence, en ajouter une, changer son
   unité, ajouter ou retirer une déclinaison.

   Le principe : le catalogue d'usine (INVENTAIRE_SEC) reste dans config.js.
   Les modifications du manager sont enregistrées en base sous la clé
   « catalogue:sec » et se superposent au catalogue d'usine. Une mise à jour
   du code ne perd donc jamais les réglages de la boutique.

   Ce script ajoute à stock.js :
     • catalogueSec()  — le catalogue effectif, usine + modifications ;
     • V.catalogue     — l'écran d'édition, réservé au manager.

   Usage, depuis la racine du projet :
       node scripts/catalogue-manager.cjs
   ============================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const cible = path.join(__dirname, '..', 'stock.js');
const src = fs.readFileSync(cible, 'utf8');

if (src.indexOf('function catalogueSec') >= 0) {
  console.log('catalogueSec déjà présent — rien à faire.');
  process.exit(0);
}

const BLOC = `
/* -----------------------------------------------------------------------------
   CATALOGUE DU SEC, MODIFIABLE PAR LE MANAGER
   Le catalogue d'usine vit dans config.js. Le manager peut le corriger depuis
   le Back-office : ses modifications sont enregistrées en base et se
   superposent, référence par référence. Une mise à jour du code ne perd donc
   jamais les réglages de la boutique.

   Forme des modifications, sous la clé « catalogue:sec » :
     { masques: ['id1','id2'],            références retirées de l'affichage
       modifs:  { id: { unite, decimal, variantes, nom } },
       ajouts:  [ { id, sec, nom, unite, decimal, variantes } ] }
   -------------------------------------------------------------------------- */
let _catalogueSec = null;

function catalogueSecBrut() {
  return INVENTAIRE_SEC.map(r => typeof r === 'string'
    ? { id:r, nom:r, unite:'unité', decimal:false } : Object.assign({}, r));
}

/* Synchrone, à partir du dernier chargement. */
function catalogueSec() {
  return _catalogueSec || catalogueSecBrut();
}

/* À appeler avant de dessiner un écran qui s'en sert. */
async function chargerCatalogueSec() {
  const m = await DB.get('catalogue:sec', null);
  const base = catalogueSecBrut();
  if (!m) { _catalogueSec = base; return base; }
  const out = base.map(r => {
    const mod = (m.modifs || {})[r.id];
    const x = mod ? Object.assign({}, r, mod) : r;
    if ((m.masques || []).indexOf(r.id) >= 0) x.masque = true;
    return x;
  });
  (m.ajouts || []).forEach(a => { if (a && a.id && !out.some(r => r.id === a.id)) out.push(a); });
  _catalogueSec = out;
  return out;
}

async function enregistrerCatalogueSec(m) {
  await DB.set('catalogue:sec', m);
  _catalogueSec = null;
  await chargerCatalogueSec();
}

/* -----------------------------------------------------------------------------
   VUE — CATALOGUE (manager)
   -------------------------------------------------------------------------- */
V.catalogue = async function () {
  if (!STATE.user || STATE.user.role !== 'manager') {
    $('#page').innerHTML = vide('', 'Réservé au manager.'); return;
  }
  const m = (await DB.get('catalogue:sec', null)) || { masques:[], modifs:{}, ajouts:[] };
  m.masques = m.masques || []; m.modifs = m.modifs || {}; m.ajouts = m.ajouts || [];
  await chargerCatalogueSec();
  const cat = catalogueSec();
  const sections = (typeof SEC_SECTIONS !== 'undefined')
    ? SEC_SECTIONS.map(s => typeof s === 'string' ? { id:s } : s) : [];
  const UNITES = ['carton','ramette','pack','boîte','brique','flacon','pot','rouleau','sachet','unité'];

  $('#vue-actions').innerHTML = '';
  $('#page').innerHTML =
    carte('<h2>Catalogue du sec</h2>' +
      '<div class="cs">Ce que l’inventaire et le réassort proposent. Retirez ce que ' +
      'vous ne comptez plus, ajoutez ce qui manque, changez une unité ou une ' +
      'déclinaison. Vos réglages survivent aux mises à jour.</div>', 'solide') +

    sections.map(s => {
      const refs = cat.filter(r => (r.sec || 'Autres') === s.id);
      if (!refs.length) return '';
      return '<div class="sec-bloc"' + (s.teinte ? ' style="--sec-teinte:' + s.teinte + '"' : '') + '>' +
        '<div class="entete sec-entete"><span class="sec-pastille"></span><h3>' + esc(s.id) + '</h3>' +
        '<button class="btn clair sm" data-ajout="' + esc(s.id) + '">+ Ajouter</button></div>' +
        '<div class="stack">' + refs.map(r =>
          carte('<div class="rang">' +
            '<div style="flex:1;min-width:0">' +
            '<b' + (r.masque ? ' style="text-decoration:line-through;opacity:.5"' : '') + '>' +
            esc(r.nom) + '</b>' +
            '<div class="mini">' + esc(r.unite) + (r.decimal === false ? ' · entiers' : ' · demi possible') +
            (r.variantes && r.variantes.length ? ' · ' + r.variantes.length + ' déclinaisons' : '') +
            '</div></div>' +
            '<div class="duo compact">' +
            '<button class="btn clair" data-edit="' + esc(r.id) + '" aria-label="Modifier">✎</button>' +
            '<button class="btn ' + (r.masque ? 'menthe' : 'clair') + '" data-masque="' + esc(r.id) + '" ' +
            'aria-label="' + (r.masque ? 'Réafficher' : 'Retirer') + '">' + (r.masque ? '↺' : '−') + '</button>' +
            '</div></div>', r.masque ? 'plat' : '')
        ).join('') + '</div></div>';
    }).join('');

  $$('[data-masque]').forEach(b => b.onclick = async () => {
    const id = b.dataset.masque;
    const i = m.masques.indexOf(id);
    if (i >= 0) m.masques.splice(i, 1); else m.masques.push(id);
    await enregistrerCatalogueSec(m);
    await feed('ok', STATE.user.prenom + (i >= 0 ? ' a réaffiché ' : ' a retiré ') + id + ' du catalogue');
    rendre('catalogue');
  });

  const editer = (r, section) => {
    const neuf = !r;
    r = r || { id:'', sec:section, nom:'', unite:'carton', decimal:true, variantes:[] };
    showSheet(
      '<h2 id="sheet-titre">' + (neuf ? 'Nouvelle référence' : 'Modifier') + '</h2>' +
      '<div class="champ" style="margin-top:14px"><label class="f">Nom</label>' +
      '<input type="text" id="ct-nom" value="' + esc(r.nom) + '" placeholder="Ex. Cornets"></div>' +
      '<div class="champ" style="margin-top:12px"><label class="f">Unité comptée</label>' +
      '<div class="pastilles">' + UNITES.map(u =>
        '<button type="button" class="pas' + (u === r.unite ? ' on' : '') + '" data-u="' + u + '">' + u + '</button>').join('') +
      '</div></div>' +
      '<div class="champ" style="margin-top:12px"><label class="f">Saisie</label>' +
      '<div class="pastilles">' +
      '<button type="button" class="pas' + (r.decimal !== false ? ' on' : '') + '" data-dec="1">Demi possible (2,5)</button>' +
      '<button type="button" class="pas' + (r.decimal === false ? ' on' : '') + '" data-dec="0">Entiers seulement</button>' +
      '</div></div>' +
      '<div class="champ" style="margin-top:12px"><label class="f">Déclinaisons, une par ligne</label>' +
      '<textarea id="ct-var" rows="4" placeholder="Petit\\nClassique\\nGrand">' +
      esc((r.variantes || []).join('\\n')) + '</textarea></div>' +
      '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
      '<button class="btn menthe" id="ct-ok">Enregistrer</button></div>');

    let unite = r.unite, decimal = r.decimal !== false;
    $$('[data-u]').forEach(b => b.onclick = () => {
      unite = b.dataset.u; $$('[data-u]').forEach(x => x.classList.toggle('on', x === b)); });
    $$('[data-dec]').forEach(b => b.onclick = () => {
      decimal = b.dataset.dec === '1'; $$('[data-dec]').forEach(x => x.classList.toggle('on', x === b)); });

    $('#ct-ok').onclick = async () => {
      const nom = $('#ct-nom').value.trim();
      if (!nom) return toast('Le nom est obligatoire', 'erreur');
      const variantes = $('#ct-var').value.split('\\n').map(s => s.trim()).filter(Boolean);
      if (neuf) {
        const id = 'm_' + nom.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '').slice(0, 20) + '_' + Date.now().toString(36).slice(-4);
        m.ajouts.push({ id, sec:section, nom, unite, decimal, variantes });
      } else {
        m.modifs[r.id] = { nom, unite, decimal, variantes };
      }
      await enregistrerCatalogueSec(m);
      await feed('ok', STATE.user.prenom + (neuf ? ' a ajouté ' : ' a modifié ') + nom + ' au catalogue');
      closeSheet();
      rendre('catalogue');
    };
  };

  $$('[data-edit]').forEach(b => b.onclick = () => {
    editer(cat.filter(r => r.id === b.dataset.edit)[0]);
  });
  $$('[data-ajout]').forEach(b => b.onclick = () => editer(null, b.dataset.ajout));
};
`;

/* On insère juste avant V.inventaire */
const A = 'V.inventaire = async function';
const i = src.indexOf(A);
if (i < 0) { console.error('V.inventaire introuvable.'); process.exit(1); }
let out = src.slice(0, i) + BLOC + '\n' + src.slice(i);

/* Et V.inventaire doit charger le catalogue avant de dessiner */
const B = "V.inventaire = async function () {\n  const { articles } = await stockReel();";
if (out.indexOf(B) >= 0) {
  out = out.replace(B, "V.inventaire = async function () {\n  await chargerCatalogueSec();\n  const { articles } = await stockReel();");
} else {
  console.warn('Avertissement : appel à chargerCatalogueSec non inséré dans V.inventaire — à faire à la main.');
}

try { new Function(out); }
catch (e) { console.error('ABANDON — ne compile pas : ' + e.message); process.exit(1); }

const sauvegarde = cible + '.avant-catalogue';
if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, src, 'utf8');
fs.writeFileSync(cible, out, 'utf8');
console.log('Catalogue modifiable par le manager : catalogueSec() et V.catalogue ajoutés.');
console.log('Sauvegarde : stock.js.avant-catalogue');
