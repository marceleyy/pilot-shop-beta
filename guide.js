/* =============================================================================
   PILOT-SHOP — guide.js
   Mise en route d'une boutique toute neuve, étape par étape.

   Une boutique qui démarre de zéro n'a ni horaires, ni appareils à relever, ni
   parfums, ni stock de départ. Sans guide, le manager tombait sur la tour de
   contrôle vide et sur la modale « Définir la première période » avant même
   d'avoir compté sa glace. Ici, l'application le prend par la main : chaque
   étape dit quoi faire, ouvre le bon écran, et se coche toute seule quand la
   donnée existe en base.

   Le guide ne s'affiche que si la clé « boutique » (table reglages) vaut
   { guide: 'a-faire' }. Une boutique déjà en service (Paccard) n'a pas cette
   clé : rien ne change pour elle. La clé est posée à la création du compte
   d'une nouvelle boutique, ou par l'écran « Créer l'équipe » d'une base vide.

   Aussi ici : « Changer de boutique », pour une personne qui travaille dans
   deux boutiques avec le même appareil.

   Chargé après calcul.js.
   ============================================================================= */

'use strict';

PAGES.miseenroute = { titre:'Mise en route', sous:'Votre boutique, étape par étape' };

/* -----------------------------------------------------------------------------
   CATALOGUE DES PARFUMS PROPRE À LA BOUTIQUE
   La liste d'usine (config.js) reste la référence. La boutique peut en masquer
   et en ajouter, sous la clé « catalogue:parfums » :
     { masques: ['Banane', …], ajouts: ['Speculoos', …] }
   PARFUMS est modifié sur place : tous les écrans le lisent déjà.
   -------------------------------------------------------------------------- */
const PARFUMS_USINE = PARFUMS.slice();

function appliquerParfums(m) {
  if (!m || typeof m !== 'object') return;
  const masques = Array.isArray(m.masques) ? m.masques : [];
  const ajouts = (Array.isArray(m.ajouts) ? m.ajouts : [])
    .map(p => String(p || '').trim()).filter(Boolean);
  const liste = PARFUMS_USINE.filter(p => masques.indexOf(p) < 0)
    .concat(ajouts.filter(p => PARFUMS_USINE.indexOf(p) < 0));
  /* L'inventaire glace range ses lignes par position dans PARFUMS : on ne
     touche à la liste que si elle change vraiment. */
  if (liste.length === PARFUMS.length && liste.every((p, i) => p === PARFUMS[i])) return;
  PARFUMS.splice(0, PARFUMS.length, ...liste);
  /* Un parfum ajouté se reconnaît au moins sous son propre nom (OCR). */
  ajouts.forEach(p => { if (!PARFUMS_ALIAS[p]) PARFUMS_ALIAS[p] = [p.toLowerCase()]; });
}

/* Relu toutes les deux minutes, mais seulement dans une boutique qui a sa
   propre liste : les autres gardent la liste d'usine sans requête de plus. */
let _parfumsPropres = false;
async function chargerParfums() {
  try {
    const m = await DB.get('catalogue:parfums', null);
    if (m) { _parfumsPropres = true; appliquerParfums(m); }
  } catch (e) { /* liste d'usine */ }
}
chargerParfums();
setInterval(() => { if (_parfumsPropres) chargerParfums(); }, 120000);

/* -----------------------------------------------------------------------------
   ÉTAT DU GUIDE
   -------------------------------------------------------------------------- */
let _guide = null;          // dernière lecture de la clé « boutique »
let _guideMasque = false;   // « Voir la tour de contrôle quand même », le temps de la session

/* Une boutique sans guide (Paccard) ou au guide terminé ne le verra plus :
   on cesse de relire la clé, la tour de contrôle n'attend plus le réseau. */
let _guideClos = false;
async function lireGuide() {
  if (_guideClos) return _guide;
  try { _guide = await DB.get('boutique', null); } catch (e) { /* on garde la dernière lecture */ }
  if (!_guide || _guide.guide === 'fait') _guideClos = true;
  return _guide;
}
function guideEnCours() {
  return !!(_guide && _guide.guide === 'a-faire' && STATE.user && STATE.user.role === 'manager');
}
/* Lecture fraîche juste avant d'écrire : deux managers peuvent avancer en même temps. */
async function majGuide(modif) {
  const b = Object.assign({ guide:'a-faire', etapes:{} }, (await DB.get('boutique', null)) || {});
  b.etapes = Object.assign({}, b.etapes);
  modif(b);
  await DB.set('boutique', b);
  _guide = b;
  return b;
}
async function cocherEtape(id) {
  await majGuide(b => { b.etapes[id] = { par:STATE.user.prenom, at:nowISO() }; });
}

/* -----------------------------------------------------------------------------
   LES ÉTAPES
   « auto » lit la base : l'étape se coche dès que la donnée existe, même si
   elle a été saisie depuis un autre écran ou un autre appareil.
   -------------------------------------------------------------------------- */
const ETAPES_GUIDE = [
  { id:'horaires', titre:'Jours et heures d’ouverture',
    texte:'Ils règlent les moments du relevé des frigos et les rappels d’ouverture et de fermeture.',
    bouton:'Régler les horaires' },
  { id:'equipe', titre:'Votre équipe',
    texte:'Chaque personne a son prénom et son code à 4 chiffres. Ajoutez vos équipiers et, si besoin, un second manager.',
    bouton:'Ajouter une personne', bouton2:'L’équipe est complète' },
  { id:'appareils', titre:'Les appareils de froid',
    texte:'Chambre froide, armoire, vitrine, frigo… Cochez ceux que vous avez : ce sont eux que l’équipe relèvera matin et soir.',
    bouton:'Choisir les appareils' },
  { id:'parfums', titre:'Les parfums proposés',
    texte:'Le catalogue Amorino est déjà prêt. Décochez ce que vous ne servez pas, ajoutez vos parfums à vous.',
    bouton:'Choisir les parfums' },
  { id:'produits', titre:'Les produits vendus',
    texte:'Coppa, cornet, brioche… avec le poids de glace de chacun. Ils servent au calcul de l’écart glace.',
    bouton:'Revoir les produits' },
  { id:'sec', titre:'Les articles du sec',
    texte:'Cornets, sauces, gobelets, serviettes : la liste proposée à l’inventaire du sec. Gardez-la telle quelle ou adaptez-la.',
    bouton:'Ouvrir le catalogue du sec', bouton2:'La liste me convient' },
  { id:'periode', titre:'La première période', auto:true,
    texte:'La date de départ des calculs : prenez le jour où vous comptez votre glace.',
    bouton:'Ouvrir la première période' },
  { id:'invglace', titre:'Inventaire initial : la glace', auto:true,
    texte:'Comptez les bacs de la chambre froide, parfum par parfum. C’est votre stock de départ.',
    bouton:'Compter la glace' },
  { id:'invsec', titre:'Inventaire actuel : le sec', auto:true,
    texte:'Comptez ce que vous avez en réserve. Ensuite, le stock se tient à jour tout seul avec les réceptions et la traçabilité.',
    bouton:'Compter le sec' },
  { id:'releve', titre:'Premier relevé des frigos', auto:true,
    texte:'Un premier relevé pour vérifier que tout est prêt. L’équipe fera ensuite le même, matin et soir.',
    bouton:'Faire le relevé' }
];

async function etatEtapes() {
  const b = (await lireGuide()) || {};
  const fait = Object.assign({}, b.etapes || {});
  const [per, inv, sec, temp] = await Promise.all([
    DB.get('periode:courante', null).catch(() => null),
    DB.get('stock:inventaire', null).catch(() => null),
    DB.get('stock:sec', null).catch(() => null),
    DB.get('temp:' + today(), null).catch(() => null)
  ]);
  if (per) fait.periode = fait.periode || true;
  if (inv && inv.at) fait.invglace = fait.invglace || true;
  if (sec && (sec.at || sec.jour)) fait.invsec = fait.invsec || true;
  /* Un relevé VALIDÉ, matin ou soir : une valeur saisie puis abandonnée ne compte pas. */
  if (temp && temp.valide && (temp.valide.m || temp.valide.s)) fait.releve = fait.releve || true;
  /* Une étape constatée est retenue : le relevé d'hier ne doit pas se
     décocher aujourd'hui. */
  const nouvelles = ETAPES_GUIDE.filter(e => e.auto && fait[e.id] === true && !(b.etapes || {})[e.id]);
  if (nouvelles.length && b.guide === 'a-faire') {
    await majGuide(g => nouvelles.forEach(e => { g.etapes[e.id] = { par:STATE.user.prenom, at:nowISO(), auto:true }; }));
  }
  return { fait:fait, inventaireFait:!!(inv && inv.at) };
}

/* -----------------------------------------------------------------------------
   VUE — MISE EN ROUTE
   -------------------------------------------------------------------------- */
V.miseenroute = async function () {
  if (!STATE.user || STATE.user.role !== 'manager') {
    $('#page').innerHTML = carte(entete('', 'Réservé au manager', 'La mise en route se fait depuis la session d’un manager.') +
      '<button class="btn clair bloc" data-go="' + vueAccueil() + '" style="margin-top:12px">Revenir à ma journée</button>');
    return;
  }
  $('#vue-titre').textContent = PAGES.miseenroute.titre;
  $('#vue-sous').textContent = PAGES.miseenroute.sous;
  const { fait, inventaireFait } = await etatEtapes();
  /* Étape « parfums » verrouillée parce que la glace est déjà comptée : la liste
     ne change plus, le catalogue Amorino en place est de fait accepté. On la
     compte alors comme satisfaite. Sans ça, compter la glace avant d'ouvrir les
     parfums figeait la mise en route à 9/10 — « Terminer » jamais actif, bandeau
     « Mise en route en cours » collé sur la tour de contrôle (CF-01). */
  const verrouille = e => e.id === 'parfums' && inventaireFait;
  const estFait = e => !!fait[e.id] || verrouille(e);
  const n = ETAPES_GUIDE.filter(estFait).length;
  const prochaine = ETAPES_GUIDE.filter(e => !estFait(e))[0];
  const termine = !!(_guide && _guide.guide === 'fait');

  $('#page').innerHTML =
    carte(entete('', 'Bienvenue, ' + STATE.user.prenom,
      'Dix étapes pour que la boutique ' + APP.site + ' soit prête à ouvrir. Faites-les dans l’ordre : chacune se coche toute seule ' +
      'quand c’est fait, et vous pouvez revenir ici à tout moment depuis la tour de contrôle.') +
      '<div class="rang" style="margin-top:12px"><b class="num">' + n + ' / ' + ETAPES_GUIDE.length + '</b>' +
      '<span class="mini">' + (n === ETAPES_GUIDE.length ? 'Tout est prêt.' :
        'Prochaine étape : ' + esc(prochaine.titre)) + '</span></div>' +
      '<div style="height:6px;border-radius:3px;background:rgba(15,32,39,.08);margin-top:10px;overflow:hidden">' +
      '<div style="height:100%;width:' + Math.round(n * 100 / ETAPES_GUIDE.length) + '%;background:var(--menthe-d)"></div></div>',
      'solide') +
    '<div class="stack" style="margin-top:14px">' +
    ETAPES_GUIDE.map((e, i) => {
      const verrou = e.id === 'parfums' && inventaireFait;
      const ok = estFait(e);
      const courante = prochaine && prochaine.id === e.id;
      return carte(
        '<div class="rang" style="align-items:flex-start;flex-wrap:nowrap">' +
        '<span class="num" style="flex:0 0 auto;width:28px;height:28px;border-radius:50%;display:inline-flex;' +
        'align-items:center;justify-content:center;font-weight:600;' +
        (ok ? 'background:var(--menthe-d);color:#fff' : 'background:rgba(15,32,39,.08)') + '">' +
        (ok ? '✓' : (i + 1)) + '</span>' +
        '<div style="flex:1;min-width:0"><b>' + esc(e.titre) + '</b>' +
        '<p class="mini" style="margin-top:3px">' + esc(e.texte) + '</p>' +
        (verrou ? '<p class="mini" style="margin-top:4px">La glace est déjà comptée : la liste des parfums ' +
          'ne change plus ici, pour ne pas décaler l’inventaire.</p>' : '') +
        ((courante || !ok) && !verrou ? '<div class="rang" style="margin-top:10px">' +
          '<button class="btn ' + (courante ? 'menthe' : 'clair') + ' sm" data-guide="' + e.id + '">' + esc(e.bouton) + '</button>' +
          (e.bouton2 ? '<button class="btn fantome sm" data-guide2="' + e.id + '">' + esc(e.bouton2) + '</button>' : '') +
          '</div>' : '') +
        (ok && !e.auto && !verrou ? '<button class="btn fantome sm" data-guide="' + e.id + '" style="margin-top:6px">Modifier</button>' : '') +
        '</div></div>',
        courante ? 'ambre' : (ok ? 'menthe' : ''));
    }).join('') +
    '</div>' +
    '<div class="stack" style="margin-top:16px">' +
    (termine ? '' :
      '<button class="btn ' + (n === ETAPES_GUIDE.length ? 'menthe' : 'clair') + ' bloc xl" id="gd-fin"' +
      (n === ETAPES_GUIDE.length ? '' : ' disabled') + '>Terminer la mise en route</button>') +
    '<button class="btn fantome bloc" id="gd-ctrl">Voir la tour de contrôle</button>' +
    '</div>';

  $$('#page [data-guide]').forEach(b => b.onclick = () => lancerEtape(b.dataset.guide));
  $$('#page [data-guide2]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    await cocherEtape(b.dataset.guide2);
    rendre('miseenroute');
  });
  const fin = $('#gd-fin');
  if (fin) fin.onclick = async () => {
    fin.disabled = true;
    await majGuide(b => { b.guide = 'fait'; b.fin = nowISO(); b.finPar = STATE.user.prenom; });
    await feed('ok', STATE.user.prenom + ' a terminé la mise en route de la boutique');
    toast('La boutique est prête. Bon service !');
    rendre('controle');
  };
  $('#gd-ctrl').onclick = () => { _guideMasque = true; rendre('controle'); };
};

function lancerEtape(id) {
  if (id === 'horaires')  return feuilleHoraires();
  if (id === 'equipe')    return editerPersonne(null);
  if (id === 'appareils') return feuilleAppareils();
  if (id === 'parfums')   return feuilleParfums();
  if (id === 'produits')  return feuilleProduits();
  if (id === 'sec')       return rendre('catalogue');
  if (id === 'periode')   return ouvrirPeriodeGuide();
  if (id === 'invglace')  { STATE.inventairePartie = 'froid'; return rendre('inventaire'); }
  if (id === 'invsec')    { STATE.inventairePartie = 'sec';   return rendre('inventaire'); }
  if (id === 'releve')    return rendre('temp');
}

/* periodeCourante relit la base et n'ouvre la modale que si aucune période
   n'existe vraiment : jamais de seconde période créée hors ligne. */
async function ouvrirPeriodeGuide() {
  oublierPeriode();
  const p = await periodeCourante();
  if (p && p.id === 'attente') toast('Connexion nécessaire pour ouvrir la période. Réessayez.', 'erreur');
  rendre('miseenroute');
}

/* --- Étape 1 : horaires -------------------------------------------------- */
function feuilleHoraires() {
  const jours = (HORAIRES.joursOuverture || [1, 2, 3, 4, 5, 6, 7]).slice();
  showSheet(
    '<h2 id="sheet-titre">Jours et heures d’ouverture</h2>' +
    '<p class="sub">Vous pourrez les affiner plus tard dans le back-office.</p>' +
    '<div class="entete"><h3>Jours d’ouverture</h3></div>' +
    '<div class="chips" id="gh-j">' + [1, 2, 3, 4, 5, 6, 7].map(j =>
      '<button type="button" class="chip' + (jours.indexOf(j) >= 0 ? ' on' : '') + '" data-j="' + j + '" aria-pressed="' +
      (jours.indexOf(j) >= 0) + '">' + JOURS_SEMAINE[j] + '</button>').join('') + '</div>' +
    '<div class="grid g2" style="margin-top:16px">' +
    '<div class="champ"><label class="f" for="gh-o">Ouverture au public</label>' +
    '<input type="time" id="gh-o" value="' + esc(HORAIRES.ouverture || '12:00') + '"></div>' +
    '<div class="champ"><label class="f" for="gh-f">Fermeture au public</label>' +
    '<input type="time" id="gh-f" value="' + esc(HORAIRES.fermeture || '22:00') + '"></div></div>' +
    '<p class="mini" style="margin-top:8px">L’ouverture commence 30 minutes avant, la fermeture dure une heure après.</p>' +
    '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
    '<button class="btn menthe" id="gh-ok">Enregistrer</button></div>');

  $$('#gh-j [data-j]').forEach(b => b.onclick = () => {
    const on = !b.classList.contains('on');
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const enMin = h => { const p = String(h || '').split(':'); return (+p[0]) * 60 + (+p[1] || 0); };
  const enH = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  $('#gh-ok').onclick = async () => {
    const choix = $$('#gh-j .chip.on').map(b => +b.dataset.j);
    const o = $('#gh-o').value, f = $('#gh-f').value;
    if (!choix.length) return toast('Choisissez au moins un jour', 'erreur');
    if (!o || !f) return toast('Indiquez les deux heures', 'erreur');
    const mo = enMin(o), mf = enMin(f);
    if (mf <= mo) return toast('La fermeture doit venir après l’ouverture', 'erreur');
    /* Même découpage que Paccard : préparation 30 min avant l'ouverture,
       fermeture d'une heure, jamais au-delà de minuit. */
    Object.assign(HORAIRES, {
      joursOuverture: choix,
      ouverture: o, fermeture: f,
      debutOuverture: enH(Math.max(0, mo - 30)), finOuverture: o,
      debutFermeture: f, finFermeture: enH(Math.min(23 * 60 + 59, mf + 60))
    });
    PHASES[0].de = HORAIRES.debutOuverture; PHASES[0].a = HORAIRES.finOuverture;
    PHASES[1].de = HORAIRES.finOuverture;   PHASES[1].a = HORAIRES.debutFermeture;
    PHASES[2].de = HORAIRES.debutFermeture; PHASES[2].a = HORAIRES.finFermeture;
    $('#gh-ok').disabled = true;
    await DB.set('horaires', HORAIRES);
    await cocherEtape('horaires');
    closeSheet();
    toast('Horaires enregistrés');
    rendre('miseenroute');
  };
}

/* --- Étape 3 : appareils de froid --------------------------------------- */
const TYPES_APPAREIL = {
  neg18: { label:'Négatif −18 °C (chambre froide, congélateur)', cible:'−18 °C', lo:-24, hi:-12, vert:[-20, -17], crit:-15, zone:'reserve' },
  neg13: { label:'Négatif −13 °C (armoire, vitrine à glace)',   cible:'−13 °C', lo:-18, hi:-8,  vert:[-15, -11], crit:-10, zone:'boutique' },
  pos:   { label:'Positif +3 °C (frigo, chantilly)',            cible:'+3 °C',  lo:-2,  hi:8,   vert:[0, 3],     crit:5,   zone:'boutique' }
};

function feuilleAppareils() {
  /* Ceux d'usine, plus ceux déjà ajoutés par la boutique. */
  const tous = ENCEINTES_DEF.map(e => Object.assign({}, e))
    .concat(ENCEINTES.filter(e => !ENCEINTES_DEF.some(d => d.id === e.id)).map(e => Object.assign({}, e)));
  const coches = new Set(ENCEINTES.map(e => e.id));

  const dessiner = () => {
    showSheet(
      '<h2 id="sheet-titre">Les appareils de froid</h2>' +
      '<p class="sub">Cochez ceux qui sont dans votre boutique. Les plages de température se règlent ensuite dans le back-office.</p>' +
      '<div class="stack" style="margin-top:12px">' + tous.map((e, i) =>
        '<label class="rang" style="gap:12px;flex-wrap:nowrap">' +
        '<input type="checkbox" data-ap="' + i + '" style="width:22px;height:22px;flex:0 0 auto"' +
        (coches.has(e.id) ? ' checked' : '') + '>' +
        '<span style="flex:1;min-width:0"><b>' + esc(e.nom) + '</b>' +
        '<span class="mini" style="display:block">Cible ' + esc(e.cible) + '</span></span></label>').join('') +
      '</div>' +
      '<div class="entete"><h3>Ajouter un appareil</h3></div>' +
      '<div class="champ"><label class="f" for="ga-nom">Nom</label>' +
      '<input type="text" id="ga-nom" maxlength="40" placeholder="ex. Congélateur réserve"></div>' +
      '<div class="champ" style="margin-top:10px"><label class="f" for="ga-type">Type</label>' +
      '<select id="ga-type">' + Object.keys(TYPES_APPAREIL).map(k =>
        '<option value="' + k + '">' + esc(TYPES_APPAREIL[k].label) + '</option>').join('') + '</select></div>' +
      '<button class="btn clair bloc" id="ga-plus" style="margin-top:10px">+ Ajouter à la liste</button>' +
      '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
      '<button class="btn menthe" id="ga-ok">Enregistrer</button></div>');

    const lire = () => $$('#sheet [data-ap]').forEach(c => {
      const id = tous[+c.dataset.ap].id;
      if (c.checked) coches.add(id); else coches.delete(id);
    });
    $('#ga-plus').onclick = () => {
      lire();
      const nom = $('#ga-nom').value.trim().replace(/\s+/g, ' ');
      if (!nom) return toast('Donnez un nom à l’appareil', 'erreur');
      if (tous.some(e => e.nom.toLowerCase() === nom.toLowerCase())) return toast('« ' + nom + ' » est déjà dans la liste', 'erreur');
      const t = TYPES_APPAREIL[$('#ga-type').value];
      const e = { id:'u' + uid(), nom:nom, cible:t.cible, lo:t.lo, hi:t.hi, pas:1,
                  vert:t.vert.slice(), crit:t.crit, zone:t.zone };
      tous.push(e);
      coches.add(e.id);
      dessiner();
    };
    $('#ga-ok').onclick = async () => {
      lire();
      const choix = tous.filter(e => coches.has(e.id));
      if (!choix.length) return toast('Cochez au moins un appareil', 'erreur');
      $('#ga-ok').disabled = true;
      ENCEINTES = choix;
      await DB.set('enceintes', ENCEINTES);
      await cocherEtape('appareils');
      closeSheet();
      toast(choix.length + ' ' + accord(choix.length, 'appareil enregistré', 'appareils enregistrés'));
      rendre('miseenroute');
    };
  };
  dessiner();
}

/* --- Étape 4 : parfums ---------------------------------------------------- */
async function feuilleParfums() {
  const m = Object.assign({ masques:[], ajouts:[] }, (await DB.get('catalogue:parfums', null)) || {});
  const tous = PARFUMS_USINE.concat((m.ajouts || []).filter(p => PARFUMS_USINE.indexOf(p) < 0));
  const coches = new Set(tous.filter(p => (m.masques || []).indexOf(p) < 0));
  let envoi = false;

  const dessiner = () => {
    showSheet(
      '<h2 id="sheet-titre">Les parfums proposés</h2>' +
      '<p class="sub">' + coches.size + ' ' + accord(coches.size, 'parfum coché', 'parfums cochés') +
      '. Ce sont eux qui apparaîtront à l’inventaire, à la traçabilité et au réassort.</p>' +
      '<div class="rang" style="margin-top:8px"><button class="btn fantome sm" id="gp-tout">Tout cocher</button>' +
      '<button class="btn fantome sm" id="gp-rien">Tout décocher</button></div>' +
      '<div class="grid g2" style="margin-top:8px">' + tous.map((p, i) =>
        '<label class="rang" style="gap:10px;flex-wrap:nowrap;padding:6px 0">' +
        '<input type="checkbox" data-pf="' + i + '" style="width:22px;height:22px;flex:0 0 auto"' +
        (coches.has(p) ? ' checked' : '') + '>' +
        '<span style="flex:1;min-width:0">' + esc(p) +
        (PARFUMS_USINE.indexOf(p) < 0 ? ' <span class="pill n">ajouté</span>' : '') + '</span></label>').join('') +
      '</div>' +
      '<div class="entete"><h3>Ajouter un parfum</h3></div>' +
      '<div class="rang" style="flex-wrap:nowrap"><input type="text" id="gp-nom" maxlength="40" ' +
      'placeholder="ex. Speculoos" style="flex:1;min-width:0" aria-label="Nom du parfum">' +
      '<button class="btn clair sm" id="gp-plus">Ajouter</button></div>' +
      '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
      '<button class="btn menthe" id="gp-ok">Enregistrer</button></div>');

    const lire = () => $$('#sheet [data-pf]').forEach(c => {
      const p = tous[+c.dataset.pf];
      if (c.checked) coches.add(p); else coches.delete(p);
    });
    $('#gp-tout').onclick = () => { tous.forEach(p => coches.add(p)); dessiner(); };
    $('#gp-rien').onclick = () => { coches.clear(); dessiner(); };
    const ajouter = () => {
      lire();
      /* « | » sépare famille, parfum et taille dans les clés du stock. */
      const nom = $('#gp-nom').value.replace(/\|/g, ' ').trim().replace(/\s+/g, ' ');
      if (!nom) return toast('Écrivez le nom du parfum', 'erreur');
      const deja = tous.filter(p => p.toLowerCase() === nom.toLowerCase())[0];
      if (deja) { coches.add(deja); dessiner(); return toast('« ' + deja + ' » est déjà dans la liste : il est coché'); }
      tous.push(nom);
      coches.add(nom);
      dessiner();
    };
    $('#gp-plus').onclick = ajouter;
    $('#gp-nom').onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); ajouter(); } };
    $('#gp-ok').onclick = async () => {
      /* Drapeau de fermeture plutôt que « disabled » : redessiner la feuille
         pendant l'attente recrée un bouton actif. */
      if (envoi) return;
      lire();
      if (!coches.size) return toast('Cochez au moins un parfum', 'erreur');
      envoi = true;
      $('#gp-ok').disabled = true;
      /* Revérification : la glace a pu être comptée sur un autre appareil. */
      const inv = await DB.get('stock:inventaire', null);
      if (inv && inv.at) { closeSheet(); toast('La glace est déjà comptée : la liste ne peut plus changer ici', 'erreur'); return rendre('miseenroute'); }
      const nouveau = {
        masques: PARFUMS_USINE.filter(p => !coches.has(p)),
        ajouts:  tous.filter(p => PARFUMS_USINE.indexOf(p) < 0 && coches.has(p))
      };
      await DB.set('catalogue:parfums', nouveau);
      appliquerParfums(nouveau);
      await cocherEtape('parfums');
      closeSheet();
      toast(PARFUMS.length + ' parfums retenus');
      rendre('miseenroute');
    };
  };
  dessiner();
}

/* --- Étape 5 : produits vendus et grammages ------------------------------ */
async function feuilleProduits() {
  const enBase = await DB.get(CALCUL.cleProduits, []);
  const actuels = (Array.isArray(enBase) && enBase.length)
    ? enBase.map(p => ({ nom:p.nom, g:num(p.g) }))
    : CALCUL.produitsDefaut.map(p => ({ nom:p[0], g:p[1] }));
  /* Les produits Amorino d'usine restent proposés même s'ils ont été retirés. */
  const tous = actuels.slice();
  CALCUL.produitsDefaut.forEach(p => { if (!tous.some(x => x.nom === p[0])) tous.push({ nom:p[0], g:p[1], retire:true }); });
  const coches = new Set(tous.filter(p => !p.retire).map(p => p.nom));

  const dessiner = () => {
    showSheet(
      '<h2 id="sheet-titre">Les produits vendus</h2>' +
      '<p class="sub">Le poids de glace est celui d’une portion, cornet ou coque déduit. ' +
      'Les valeurs proposées sont celles du classeur Amorino.</p>' +
      '<div class="stack" style="margin-top:10px">' + tous.map((p, i) =>
        '<div class="rang" style="gap:10px;flex-wrap:nowrap">' +
        '<input type="checkbox" data-pc="' + i + '" style="width:22px;height:22px;flex:0 0 auto"' +
        (coches.has(p.nom) ? ' checked' : '') + ' aria-label="Vendu : ' + esc(p.nom) + '">' +
        '<span style="flex:1;min-width:0">' + esc(p.nom) + '</span>' +
        '<input type="number" inputmode="numeric" min="0" max="2000" data-pg="' + i + '" value="' + num(p.g) + '" ' +
        'style="width:84px;flex:0 0 auto" aria-label="Grammes de glace : ' + esc(p.nom) + '">' +
        '<span class="mini" style="flex:0 0 auto">g</span></div>').join('') +
      '</div>' +
      '<div class="entete"><h3>Ajouter un produit</h3></div>' +
      '<div class="rang" style="flex-wrap:nowrap"><input type="text" id="gc-nom" maxlength="40" ' +
      'placeholder="Nom du produit" style="flex:1;min-width:0" aria-label="Nom du produit">' +
      '<input type="number" inputmode="numeric" id="gc-g" min="0" max="2000" placeholder="g" ' +
      'style="width:84px;flex:0 0 auto" aria-label="Grammes de glace">' +
      '<button class="btn clair sm" id="gc-plus">Ajouter</button></div>' +
      '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
      '<button class="btn menthe" id="gc-ok">Enregistrer</button></div>');

    const lire = () => {
      $$('#sheet [data-pc]').forEach(c => { const p = tous[+c.dataset.pc]; if (c.checked) coches.add(p.nom); else coches.delete(p.nom); });
      $$('#sheet [data-pg]').forEach(c => { tous[+c.dataset.pg].g = num(c.value); });
    };
    $('#gc-plus').onclick = () => {
      lire();
      const nom = $('#gc-nom').value.trim().replace(/\s+/g, ' ');
      const g = num($('#gc-g').value);
      if (!nom) return toast('Écrivez le nom du produit', 'erreur');
      if (!(g > 0)) return toast('Indiquez le poids de glace en grammes', 'erreur');
      /* Le champ est plafonné à 2000 g : une saisie hors bornes (99 999 g,
         doigt qui glisse) fausserait le calcul d'écart glace (F-13). */
      if (g > 2000) return toast('Poids trop élevé (2000 g max par produit)', 'erreur');
      if (tous.some(p => p.nom.toLowerCase() === nom.toLowerCase())) return toast('« ' + nom + ' » est déjà dans la liste', 'erreur');
      tous.push({ nom:nom, g:g });
      coches.add(nom);
      dessiner();
    };
    $('#gc-ok').onclick = async () => {
      lire();
      const choix = tous.filter(p => coches.has(p.nom));
      if (!choix.length) return toast('Cochez au moins un produit', 'erreur');
      const sansPoids = choix.filter(p => !(p.g > 0))[0];
      if (sansPoids) return toast(sansPoids.nom + ' : indiquez le poids de glace', 'erreur');
      const horsBornes = choix.filter(p => p.g > 2000)[0];
      if (horsBornes) return toast(horsBornes.nom + ' : poids trop élevé (2000 g max)', 'erreur');
      $('#gc-ok').disabled = true;
      await DB.set(CALCUL.cleProduits, choix.map(p => ({ nom:p.nom, g:p.g })));
      await cocherEtape('produits');
      closeSheet();
      toast(choix.length + ' produits enregistrés');
      rendre('miseenroute');
    };
  };
  dessiner();
}

/* -----------------------------------------------------------------------------
   BRANCHEMENTS
   La tour de contrôle cède la place au guide tant qu'il n'est pas terminé :
   elle aurait ouvert la modale « première période » avant tout le reste.
   Les écrans ouverts depuis le guide gardent un lien de retour.
   -------------------------------------------------------------------------- */
const V_controle_avantGuide = V.controle;
V.controle = async function () {
  await lireGuide();
  if (guideEnCours() && !_guideMasque) return V.miseenroute();
  await V_controle_avantGuide.call(this);
  /* Guide en cours mais masqué : un rappel discret en tête. */
  if (guideEnCours() && $('#page')) {
    const bloc = document.createElement('div');
    bloc.innerHTML = carte('<div class="rang"><div style="flex:1;min-width:0"><b>Mise en route en cours</b>' +
      '<p class="mini" style="margin-top:3px">Quelques étapes restent à faire pour que les chiffres soient justes.</p></div>' +
      '<button class="btn menthe sm" id="gd-rep">Reprendre</button></div>', 'ambre');
    $('#page').insertBefore(bloc, $('#page').firstChild);
    $('#gd-rep').onclick = () => { _guideMasque = false; rendre('miseenroute'); };
  }
};

['equipe', 'catalogue', 'inventaire', 'temp', 'parametres', 'stock'].forEach(id => {
  const origine = V[id];
  if (!origine) return;
  V[id] = async function () {
    await origine.apply(this, arguments);
    if (!guideEnCours() || STATE.view !== id || !$('#page')) return;
    const b = document.createElement('div');
    b.innerHTML = '<button class="btn clair bloc" data-guide-retour style="margin-bottom:12px">← Revenir à la mise en route</button>';
    $('#page').insertBefore(b.firstChild, $('#page').firstChild);
    $('#page [data-guide-retour]').onclick = () => rendre('miseenroute');
  };
});

/* -----------------------------------------------------------------------------
   CHANGER DE BOUTIQUE
   Un appareil est rattaché à UNE boutique : ses copies locales ne portent pas
   le nom du site. Passer à l'autre boutique, c'est donc vider l'appareil et le
   rattacher avec les identifiants de l'autre — jamais tant qu'une saisie
   attend d'être envoyée, elle serait perdue.
   -------------------------------------------------------------------------- */
/* Ce qui empêche de quitter la boutique sans rien perdre. Rend le motif, ou null. */
function obstacleChangement() {
  /* Hors ligne, l'application vidée de son cache ne se rechargerait plus. */
  if (!STATE.enLigne || !navigator.onLine) return 'Connexion nécessaire pour changer de boutique';
  /* Ce qui n'existe que sur l'appareil : brouillon d'inventaire, saisies trop lourdes pour la base.
     Un brouillon ne gêne que s'il est DU JOUR et contient des lignes : un
     brouillon de la veille, invisible à l'écran Inventaire (repris seulement
     s'il est du jour), bloquait sinon le changement à vie, sans rien à
     « terminer » (F-08). Un brouillon périmé est nettoyé au passage. */
  let brouillonActif = false;
  try {
    const b = JSON.parse(localStorage.getItem(OFFLINE.storeLocal + ':brouillon:inventaire') || 'null');
    if (b && b.jour === today() &&
        (Object.keys(b.lignes || {}).length || Object.keys(b.sec || {}).length)) brouillonActif = true;
    else if (b) localStorage.removeItem(OFFLINE.storeLocal + ':brouillon:inventaire');
  } catch (e) {}
  if (brouillonActif || Object.keys(DB._gros || {}).length)
    return 'Un inventaire en cours ou des photos restent sur cet appareil : terminez-les avant de changer de boutique';
  /* Seules les saisies de CETTE boutique bloquent. Une saisie en attente d'une
     AUTRE boutique (déjà étiquetée de son site) ne part que chez elle : elle ne
     doit ni interdire le changement, ni être effacée, et le message « Reconnectez
     le Wi-Fi » était faux puisque l'appareil est en ligne (F-06). Le résumé
     franchise, lui, se recalcule tout seul. */
  const enAttente = fileLire().filter(x => ici(x) && String(x.cle).indexOf('franchise:') !== 0).length;
  if (enAttente) return enAttente + ' ' + accord(enAttente, 'saisie attend', 'saisies attendent') +
    ' d’être envoyée' + (enAttente > 1 ? 's' : '') + ' pour cette boutique. Patientez qu’' +
    (enAttente > 1 ? 'elles partent' : 'elle parte') + ', puis réessayez.';
  return null;
}

/* On demande les identifiants de l'autre boutique AVANT de quitter celle-ci :
   des identifiants faux ou une boutique injoignable laissent l'appareil
   tel quel, au lieu de le laisser détaché. Depuis l'écran des prénoms, il
   faut ces identifiants pour aller où que ce soit : un équipier ne peut pas
   détacher l'iPad par erreur. Dans l'application, réservé au manager. */
function changerDeBoutique() {
  if (STATE.user && STATE.user.role !== 'manager') return;
  const obstacle = obstacleChangement();
  if (obstacle) { toast(obstacle, 'erreur'); return; }
  showSheet(
    '<h2 id="sheet-titre">Changer de boutique</h2>' +
    '<p class="sub">Cet appareil est sur ' + esc(APP.site) + '. Saisissez le compte de l’autre boutique : ' +
    'tout ce qui a été saisi ici est déjà dans la base et y reste.</p>' +
    '<form id="cb-form" novalidate>' +
    '<div class="champ" style="margin-top:14px"><label class="f" for="cb-mail">Compte de la boutique</label>' +
    /* Pas de mot de passe proposé par Safari sur un iPad partagé : n'importe
       qui pourrait sinon sortir l'appareil de sa boutique. */
    '<input type="email" id="cb-mail" autocapitalize="none" autocomplete="off" spellcheck="false"></div>' +
    '<div class="champ" style="margin-top:12px"><label class="f" for="cb-mdp">Mot de passe</label>' +
    '<input type="password" id="cb-mdp" autocomplete="new-password"></div>' +
    '<div class="actions"><button type="button" class="btn clair" data-fermer>Annuler</button>' +
    '<button type="submit" class="btn menthe" id="cb-ok">Changer</button></div></form>' +
    '<p class="mini" id="cb-etat" role="status" style="text-align:center;margin-top:10px"></p>');
  const etat = m => { const e = $('#cb-etat'); if (e) e.textContent = m; };
  $('#cb-form').onsubmit = async ev => {
    ev.preventDefault();
    const bouton = $('#cb-ok');
    if (bouton.disabled) return;
    const mail = $('#cb-mail').value.trim(), mdp = $('#cb-mdp').value;
    if (!mail || !mdp) return etat('Renseignez les deux champs.');
    bouton.disabled = true;
    etat('Connexion…');
    try {
      const d = await appelAuth('/token?grant_type=password', { email:mail, password:mdp });
      const site = d.user && d.user.app_metadata ? d.user.app_metadata.site : null;
      if (!site) throw new Error('Ce compte n’a pas de boutique attribuée.');
      if (site === APP.site) throw new Error('Cet appareil est déjà sur ' + site + '.');
      const obstacle2 = obstacleChangement();
      if (obstacle2) throw new Error(obstacle2);
      etat('Passage sur ' + site + '…');
      /* On garde les saisies en attente, étiquetées de leur boutique, à travers
         le vidage. Une saisie d'une autre boutique repartira chez elle ; une
         saisie de l'ancienne boutique (cas limite) ne doit pas disparaître.
         viderAppareil efface la file : on la réécrit juste après (F-06). */
      const ancienSite = APP.site;
      const fileGardee = fileLire().map(x => x.site ? x : Object.assign({}, x, { site: ancienSite }));
      await viderAppareil(false);
      try { if (fileGardee.length) fileEcrire(fileGardee); } catch (e) {}
      memoriser(d);
      /* recharger() : livré par la branche d'audit (annule le retour arrière
         différé de closeSheet). Ici aucune feuille n'a été fermée avant. */
      if (typeof recharger === 'function') recharger(); else location.reload();
    } catch (e) {
      bouton.disabled = false;
      etat(e.statut === 400 ? 'Identifiants refusés.'
         : e.statut === 429 ? 'Trop d’essais : patientez une minute.'
         : e.statut ? 'La base refuse la connexion (erreur ' + e.statut + ').'
         : e.message && !/fetch|abort/i.test(e.message) ? e.message
         : 'Base injoignable. Vérifiez le Wi-Fi, puis réessayez.');
    }
  };
}

/* Sur l'écran des prénoms : seulement si l'appareil est rattaché à une base. */
(function () {
  const b = document.getElementById('lg-boutique');
  if (!b) return;
  if (!SUPABASE.url || !SUPABASE.anonKey) { b.hidden = true; return; }
  b.onclick = changerDeBoutique;
})();
