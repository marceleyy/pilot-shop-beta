/* =============================================================================
   PILOT-SHOP — taches.js
   Tâches et réparations de la boutique, hors procédures Amorino : dégivrer la
   chambre froide, réparer un panneau, déco de Noël, changer le gaz… et les
   actions demandées par l'animateur lors d'une visite ou d'un contrôle
   (catégorie « audit »). Remplace le Trello du gérant.

   Stockage : un document par tâche, « tache:<id> ». Chaque écriture passe par
   DB.patch avec les SEULS champs modifiés, et l'historique en ajout : deux
   iPads (ou une saisie rejouée au retour du réseau) qui touchent la même
   tâche ne s'écrasent pas. Les photos vont à part (« tache-photo:<id> »).

   Tâche : { id, titre, detail, categorie, priorite, statut, echeance,
             assigne, assigneNom, aPhoto, par, employe, at, historique:[
             { statut, par, at }], supprimee?, passage? }
   Statuts : creee → en_cours → realisee. Une suppression pose
   « supprimee: true », un champ que les changements de statut ne touchent
   pas : une saisie rejouée plus tard ne la fait pas revenir.

   API pour les autres modules (le pré-audit s'y branchera) : ajouterTache(obj),
   lireTaches(), changerStatutTache(id, statut) (la tâche si elle a changé,
   sinon null), ouvrirFormulaireTache(pre, apres).
   Chargé après app.js et modules.js.
   ============================================================================= */

'use strict';

PAGES.taches = { titre:'Tâches et réparations', sous:'À faire en boutique, hors procédures' };
if (MENU_PLUS.manager.indexOf('taches') < 0) MENU_PLUS.manager.unshift('taches');

const TACHES_B = {
  prefixe: 'tache:',
  categories: [
    { id:'boutique',   libelle:'Boutique' },
    { id:'audit',      libelle:'Audit Amorino' },
    { id:'reparation', libelle:'Réparation' },
    { id:'entretien',  libelle:'Entretien' },
    { id:'deco',       libelle:'Déco' },
    { id:'achat',      libelle:'Achat' }
  ],
  priorites: [
    { id:'urgente', libelle:'Urgente',        pill:'bad',  rang:0 },
    { id:'normale', libelle:'Normale',        pill:'warn', rang:1 },
    { id:'basse',   libelle:'Quand possible', pill:'n',    rang:2 }
  ],
  statuts: [
    { id:'creee',    libelle:'Créée',    pill:'n'  },
    { id:'en_cours', libelle:'En cours', pill:'warn' },
    { id:'realisee', libelle:'Réalisée', pill:'ok' }
  ],
  /* « Refaire dans… » à la réalisation : dégivrage, bouteilles de gaz. */
  relances: [ { j:7, libelle:'1 semaine' }, { j:30, libelle:'1 mois' }, { j:90, libelle:'3 mois' } ],
  realiseesAffichees: 30
};

const tbCat  = id => TACHES_B.categories.filter(c => c.id === id)[0] || TACHES_B.categories[0];
const tbPrio = id => TACHES_B.priorites.filter(p => p.id === id)[0] || TACHES_B.priorites[1];
const tbStat = id => TACHES_B.statuts.filter(s => s.id === id)[0] || TACHES_B.statuts[0];
const tbEnRetard = t => !!t.echeance && t.statut !== 'realisee' && t.echeance < today();
const tbNomEquipe = id => { const e = EQUIPE.filter(x => x.id === id)[0]; return e ? e.prenom : ''; };

/* Ordre de travail : en retard, puis priorité, puis échéance la plus proche. */
function tbTrier(a, b) {
  const r = (tbEnRetard(b) ? 1 : 0) - (tbEnRetard(a) ? 1 : 0);
  if (r) return r;
  const p = tbPrio(a.priorite).rang - tbPrio(b.priorite).rang;
  if (p) return p;
  const ea = a.echeance || '9999', eb = b.echeance || '9999';
  if (ea !== eb) return ea < eb ? -1 : 1;
  const aa = String(a.at), ab = String(b.at);
  return aa === ab ? 0 : (aa < ab ? -1 : 1);
}

const tbCle = id => TACHES_B.prefixe + id;

/* Historique trié par heure : une entrée rejouée au retour du réseau arrive
   en fin de liste, même si elle est plus ancienne. */
const tbMs = x => { const n = Date.parse(x); return isNaN(n) ? 0 : n; };
const tbHisto = t => (t.historique || []).filter(h => h && h.at)
  .slice().sort((a, b) => tbMs(a.at) - tbMs(b.at));

/* Le statut affiché est celui de la DERNIÈRE entrée de l'historique, pas le
   champ « statut » : un « Démarrer » fait hors ligne à 10 h et rejoué à midi
   ne fait pas revenir une tâche réalisée à 11 h sur un autre iPad (l'historique
   s'unit, le champ se remplace). */
function tbNormaliser(t) {
  if (!t || !t.id) return t;
  const h = tbHisto(t).filter(x => TACHES_B.statuts.some(s => s.id === x.statut));
  if (h.length) t.statut = h[h.length - 1].statut;
  return t;
}

async function lireTaches() {
  const cles = (await DB.list(TACHES_B.prefixe)).filter(k => k.indexOf(TACHES_B.prefixe) === 0);
  DB.prelire(cles);   // une seule requête pour toutes les tâches (dans un dessin d'écran)
  const l = await Promise.all(cles.map(k => DB.get(k, null)));
  return l.map(tbNormaliser).filter(t => t && t.id && t.titre && !t.supprimee);
}

/* Seuls les champs donnés partent ; l'entrée d'historique s'ajoute à celles
   déjà en base au lieu de remplacer la liste. */
async function tbEcrire(id, champs, entree) {
  return DB.patch(tbCle(id), champs || {}, entree ? { historique:[entree] } : {});
}

/* Relue fraîche avant modification : la copie de l'écran peut dater. */
async function tbLire(id) {
  const t = tbNormaliser(await DB.get(tbCle(id), null, true));
  return t && t.id && !t.supprimee ? t : null;
}

async function ajouterTache(o) {
  o = o || {};
  const qui = STATE.user ? STATE.user.prenom : '';
  const t = {
    /* Une relance a un id fixe : deux iPads qui terminent la même tâche hors
       ligne avec la même relance n'en créent qu'une. */
    id: o.id || (o.relanceDe && o.echeance ? 'r-' + o.relanceDe + '-' + o.echeance : uid()),
    titre: String(o.titre || '').trim(),
    detail: String(o.detail || '').trim(),
    categorie: tbCat(o.categorie).id,
    priorite: tbPrio(o.priorite).id,
    statut: 'creee',
    echeance: /^\d{4}-\d{2}-\d{2}$/.test(o.echeance || '') ? o.echeance : '',
    assigne: o.assigne || '',
    assigneNom: o.assigne ? (o.assigneNom || tbNomEquipe(o.assigne)) : '',
    aPhoto: !!o.aPhoto,
    par: qui,
    employe: STATE.user ? STATE.user.id : '',
    at: nowISO(),
    historique: [{ statut:'creee', par:qui, at:nowISO() }]
  };
  if (o.passage) t.passage = o.passage;
  if (o.relanceDe) t.relanceDe = o.relanceDe;
  if (!t.titre) throw new Error('Tâche sans titre');
  await DB.patch(tbCle(t.id), t);
  await feed('ok', qui + ' a créé la tâche : ' + t.titre + (t.assigneNom ? ' (pour ' + t.assigneNom + ')' : ''));
  return t;
}

async function changerStatutTache(id, statut) {
  if (!tbStat(statut) || tbStat(statut).id !== statut) return null;
  const t = await tbLire(id);
  if (!t || t.statut === statut) return null;   // déjà fait (autre iPad) : rien à tracer
  const qui = STATE.user ? STATE.user.prenom : '';
  const e = { statut:statut, par:qui, at:nowISO() };
  t.statut = statut;
  t.historique = (t.historique || []).concat([e]);
  await tbEcrire(id, { statut:statut }, e);
  await feed('ok', qui + ' a passé la tâche « ' + t.titre + ' » en : ' +
    tbStat(statut).libelle.toLowerCase());
  return t;
}

/* Le manager touche à tout ; l'équipier, seulement à ce qui lui est assigné. */
function tbPeutAgir(t) {
  if (!STATE.user || !t) return false;
  return STATE.user.role === 'manager' || (!!t.assigne && t.assigne === STATE.user.id);
}

/* ---------------------------------------------------------------------------
   Carte d'une tâche
   ------------------------------------------------------------------------ */
function carteTache(t, compacte) {
  const p = tbPrio(t.priorite), s = tbStat(t.statut);
  const retard = tbEnRetard(t);
  const infos = [tbCat(t.categorie).libelle,
    t.assigneNom ? 'pour ' + t.assigneNom : 'non assignée',
    t.echeance ? (retard ? 'en retard depuis le ' : 'avant le ') + fmtDC(t.echeance) : '',
    t.passage ? 'passage de l’animateur' : ''].filter(Boolean).join(' · ');
  const agir = tbPeutAgir(t);
  const boutons = [];
  if (agir && t.statut === 'creee') boutons.push('<button class="btn clair sm" data-tb-st="en_cours" data-tb="' + esc(t.id) + '">Démarrer</button>');
  if (agir && t.statut !== 'realisee') boutons.push('<button class="btn menthe sm" data-tb-fin="' + esc(t.id) + '">Réalisée</button>');
  const manager = !!STATE.user && STATE.user.role === 'manager';
  if (agir && t.statut === 'realisee' && manager) boutons.push('<button class="btn fantome sm" data-tb-st="creee" data-tb="' + esc(t.id) + '">Rouvrir</button>');
  if (!compacte && manager) boutons.push('<button class="btn fantome sm" data-tb-mod="' + esc(t.id) + '">Modifier</button>');
  if (t.aPhoto) boutons.push('<button class="btn fantome sm" data-tb-ph="' + esc(t.id) + '">Photo</button>');
  const histo = tbHisto(t).map(h =>
    '<div class="mini">' + esc(h.statut === 'supprimee' ? 'Supprimée' : tbStat(h.statut).libelle) + ' · ' +
    esc(h.par || '—') + ' · ' + fmtDC(isoOf(new Date(h.at))) + ' ' + heure(h.at) + '</div>').join('');
  return carte(
    '<div class="rang" style="align-items:flex-start">' +
    '<div style="flex:1;min-width:0"><b>' + esc(t.titre) + '</b>' +
    '<div class="mini" style="margin-top:3px' + (retard ? ';color:var(--corail-d);font-weight:600' : '') + '">' + esc(infos) + '</div>' +
    (t.detail ? '<p class="mini" style="margin-top:4px">' + esc(t.detail) + '</p>' : '') + '</div>' +
    '<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">' +
    (t.statut === 'realisee' ? '' : pastille(p.pill, p.libelle)) + pastille(s.pill, s.libelle) + '</div></div>' +
    (compacte ? '' : '<details style="margin-top:8px"><summary class="mini">Historique</summary>' + histo + '</details>') +
    (boutons.length ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' + boutons.join('') + '</div>' : ''),
    t.statut === 'realisee' ? 'plat' : (retard || t.priorite === 'urgente' ? 'corail' : ''));
}

/* Boutons des cartes, pour l'écran Tâches et pour Ma journée. */
function brancherTaches(redessiner) {
  $$('#page [data-tb-st]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    await changerStatutTache(b.dataset.tb, b.dataset.tbSt);
    redessiner();
  });
  $$('#page [data-tb-fin]').forEach(b => b.onclick = () => feuilleRealisee(b.dataset.tbFin, redessiner));
  $$('#page [data-tb-mod]').forEach(b => b.onclick = async () => {
    const t = await tbLire(b.dataset.tbMod);
    if (t) ouvrirFormulaireTache(t, redessiner);
  });
  $$('#page [data-tb-ph]').forEach(b => b.onclick = async () => {
    const ph = await DB.get('tache-photo:' + b.dataset.tbPh, null);
    tbOublierPhotos();
    if (!ph || !ph.img) return toast('Photo pas encore disponible sur cet iPad', 'erreur');
    const plein = document.createElement('div');
    plein.className = 'photo-plein';
    plein.innerHTML = '<img src="' + esc(ph.img) + '" alt="">' +
      '<button type="button" class="pp-fermer" aria-label="Fermer">✕</button>';
    plein.onclick = () => plein.remove();
    document.body.appendChild(plein);
  });
}

/* Réalisée, avec la possibilité de reprogrammer la suivante. */
function feuilleRealisee(id, redessiner) {
  showSheet(
    '<h2 id="sheet-titre">Tâche réalisée ?</h2>' +
    '<p class="sub">Elle passe dans « Réalisées », avec votre nom et l’heure.</p>' +
    '<div class="entete"><h3>À refaire plus tard ? (facultatif)</h3></div>' +
    '<div class="chips" id="tb-rel">' + TACHES_B.relances.map(r =>
      '<button type="button" class="chip" data-j="' + r.j + '">Dans ' + esc(r.libelle) + '</button>').join('') + '</div>' +
    '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
    '<button class="btn menthe" id="tb-ok">Marquer réalisée</button></div>');
  let relance = 0;
  $$('#sheet-corps [data-fermer]').forEach(b => b.onclick = closeSheet);
  $$('#tb-rel [data-j]').forEach(b => b.onclick = () => {
    relance = relance === +b.dataset.j ? 0 : +b.dataset.j;
    $$('#tb-rel [data-j]').forEach(x => x.classList.toggle('on', +x.dataset.j === relance));
  });
  $('#tb-ok').onclick = async () => {
    $('#tb-ok').disabled = true;
    const t = await changerStatutTache(id, 'realisee');
    if (!t) {
      closeSheet();
      toast('Déjà réalisée ou introuvable : rien n’a changé', 'erreur');
      return redessiner();
    }
    if (relance) {
      await ajouterTache({ titre:t.titre, detail:t.detail, categorie:t.categorie, priorite:t.priorite,
        assigne:t.assigne, assigneNom:t.assigneNom, echeance:addD(today(), relance), relanceDe:t.id });
    }
    closeSheet();
    toast(relance ? 'Réalisée, la suivante est programmée' : 'Tâche réalisée');
    redessiner();
  };
}

/* ---------------------------------------------------------------------------
   Formulaire : création (pre sans id) ou modification (tâche existante).
   ------------------------------------------------------------------------ */
function ouvrirFormulaireTache(pre, apres) {
  pre = pre || {};
  const modif = !!(pre.id && pre.at);
  const f = { titre:pre.titre || '', detail:pre.detail || '', categorie:tbCat(pre.categorie).id,
              priorite:tbPrio(pre.priorite).id, echeance:pre.echeance || '', assigne:pre.assigne || '' };
  /* Valeurs à l'ouverture : seules celles que l'on change partent en base,
     pour ne pas écraser ce qu'un autre iPad a modifié entre-temps. */
  const avant = Object.assign({}, f);
  /* Personne assignée qui n'est plus dans l'équipe : gardée dans la liste,
     sinon enregistrer une autre modification la retirait sans le dire. */
  const horsEquipe = f.assigne && !EQUIPE.some(e => e.id === f.assigne)
    ? { id:f.assigne, prenom:(pre.assigneNom || 'Ancien équipier') + ' (plus dans l’équipe)' } : null;
  let photo = null;
  const garder = () => {
    if ($('#tb-t')) f.titre = $('#tb-t').value.trim();
    if ($('#tb-d')) f.detail = $('#tb-d').value.trim();
    if ($('#tb-e')) f.echeance = $('#tb-e').value;
    if ($('#tb-a')) f.assigne = $('#tb-a').value;
  };
  const dessiner = () => {
    $('#sheet-corps').innerHTML =
      '<h2 id="sheet-titre">' + (modif ? 'Modifier la tâche' : 'Nouvelle tâche') + '</h2>' +
      '<div class="champ"><label class="f">Quoi</label>' +
      '<input type="text" id="tb-t" value="' + esc(f.titre) + '" placeholder="Ex. changer les bouteilles de gaz"></div>' +
      '<div class="entete"><h3>Catégorie</h3></div>' +
      '<div class="chips" id="tb-cat">' + TACHES_B.categories.map(c =>
        '<button type="button" class="chip' + (f.categorie === c.id ? ' on' : '') + '" data-c="' + c.id + '">' + esc(c.libelle) + '</button>').join('') + '</div>' +
      '<div class="entete"><h3>Priorité</h3></div>' +
      '<div class="chips" id="tb-pr">' + TACHES_B.priorites.map(p =>
        '<button type="button" class="chip' + (f.priorite === p.id ? ' on' : '') + '" data-p="' + p.id + '">' + esc(p.libelle) + '</button>').join('') + '</div>' +
      '<div class="champ" style="margin-top:14px"><label class="f">Pour qui</label>' +
      '<select id="tb-a"><option value="">Personne pour l’instant</option>' +
      (horsEquipe ? [horsEquipe] : []).concat(EQUIPE).map(e => '<option value="' + esc(e.id) + '"' + (f.assigne === e.id ? ' selected' : '') + '>' +
        esc(e.prenom) + '</option>').join('') + '</select></div>' +
      '<div class="champ" style="margin-top:14px"><label class="f">Avant le (facultatif)</label>' +
      '<input type="date" id="tb-e" value="' + esc(f.echeance) + '"></div>' +
      '<div class="champ" style="margin-top:14px"><label class="f">Détail (facultatif)</label>' +
      '<textarea id="tb-d" placeholder="Où, quoi acheter, qui appeler.">' + esc(f.detail) + '</textarea></div>' +
      '<button class="btn ' + (photo ? 'menthe' : 'ciel') + ' bloc" id="tb-ph" style="margin-top:14px">' +
      (photo ? '✓ Photo jointe (en reprendre une)' : (pre.aPhoto ? 'Remplacer la photo' : 'Ajouter une photo')) + '</button>' +
      '<div class="actions">' +
      (modif ? '<button class="btn fantome" id="tb-sup">Supprimer</button>' : '') +
      '<button class="btn clair" data-fermer>Annuler</button>' +
      '<button class="btn menthe" id="tb-ok">Enregistrer</button></div>';
    $$('#sheet-corps [data-fermer]').forEach(b => b.onclick = closeSheet);
    $$('#tb-cat [data-c]').forEach(b => b.onclick = () => { garder(); f.categorie = b.dataset.c; dessiner(); });
    $$('#tb-pr [data-p]').forEach(b => b.onclick = () => { garder(); f.priorite = b.dataset.p; dessiner(); });
    $('#tb-ph').onclick = async () => { garder(); const p = await prendrePhoto(); if (p) photo = p.img; dessiner(); };
    const sup = $('#tb-sup');
    if (sup) sup.onclick = () => { garder(); confirmer('Supprimer cette tâche ?', '« ' + f.titre + ' » disparaîtra de la liste.',
      'Supprimer', async () => {
        const t = await tbLire(pre.id);
        if (t) {
          await tbEcrire(t.id, { supprimee:true }, { statut:'supprimee', par:STATE.user.prenom, at:nowISO() });
          if (t.aPhoto) await DB.del('tache-photo:' + t.id);
          await feed('warn', STATE.user.prenom + ' a supprimé la tâche : ' + t.titre);
        }
        if (apres) apres();
      },
      /* « Annuler » revient au formulaire, avec ce qui était déjà tapé. */
      () => { showSheet('<div class="vide">…</div>'); dessiner(); }); };
    $('#tb-ok').onclick = async () => {
      garder();
      if (!f.titre) return toast('Écrivez la tâche en quelques mots', 'erreur');
      $('#tb-ok').disabled = true;
      let id;
      if (modif) {
        const t = await tbLire(pre.id);
        if (!t) { closeSheet(); return toast('Tâche introuvable', 'erreur'); }
        const champs = {};
        Object.keys(f).forEach(k => { if (f[k] !== avant[k]) champs[k] = f[k]; });
        if ('assigne' in champs) champs.assigneNom = f.assigne ? (tbNomEquipe(f.assigne) || pre.assigneNom || '') : '';
        if (photo) champs.aPhoto = true;
        if (Object.keys(champs).length) await tbEcrire(t.id, champs);
        id = t.id;
      } else {
        id = (await ajouterTache(Object.assign({}, pre, f, { aPhoto:!!photo }))).id;
      }
      if (photo) await DB.set('tache-photo:' + id, { img:photo, at:nowISO() });
      closeSheet();
      const fait = modif ? 'Tâche modifiée' : 'Tâche ajoutée';
      const msg = messageEnvoi(tbCle(id), fait);
      toast(msg !== fait || !photo ? msg : messageEnvoi('tache-photo:' + id, fait));
      if (apres) apres();
    };
  };
  showSheet('<div class="vide">…</div>');
  dessiner();
}

/* ---------------------------------------------------------------------------
   Écran du gérant
   ------------------------------------------------------------------------ */
V.taches = async function () {
  const vue = V.taches;
  vue._onglet = vue._onglet || 'afaire';
  vue._cat = vue._cat || '';
  const toutes = await lireTaches();
  if (STATE.view !== 'taches') return;
  const parCat = toutes.filter(t => !vue._cat || t.categorie === vue._cat);
  const afaire = parCat.filter(t => t.statut !== 'realisee').sort(tbTrier);
  const finie = t => { const h = tbHisto(t).filter(x => x.statut === 'realisee').pop(); return String((h && h.at) || t.at); };
  const faites = parCat.filter(t => t.statut === 'realisee')
    .sort((a, b) => (finie(a) === finie(b) ? 0 : finie(b) < finie(a) ? -1 : 1))
    .slice(0, TACHES_B.realiseesAffichees);
  const retard = afaire.filter(tbEnRetard).length;
  const liste = vue._onglet === 'afaire' ? afaire : faites;

  $('#page').innerHTML =
    carte('<h2>Tâches et réparations</h2>' +
      '<div class="cs">' + afaire.length + ' à faire' + (retard ? ' · ' + retard + ' en retard' : '') + '</div>' +
      '<button class="btn menthe bloc xl" id="tb-new" style="margin-top:14px">Nouvelle tâche</button>', 'solide') +
    '<div class="chips" style="margin-top:14px">' +
      '<button type="button" class="chip' + (vue._onglet === 'afaire' ? ' on' : '') + '" data-tb-o="afaire">À faire (' + afaire.length + ')</button>' +
      '<button type="button" class="chip' + (vue._onglet === 'faites' ? ' on' : '') + '" data-tb-o="faites">Réalisées</button></div>' +
    '<div class="chips" style="margin-top:9px">' +
      '<button type="button" class="chip' + (!vue._cat ? ' on' : '') + '" data-tb-c="">Toutes</button>' +
      TACHES_B.categories.map(c => '<button type="button" class="chip' + (vue._cat === c.id ? ' on' : '') +
        '" data-tb-c="' + c.id + '">' + esc(c.libelle) + '</button>').join('') + '</div>' +
    (liste.length
      ? '<div class="stack" style="margin-top:14px">' + liste.map(t => carteTache(t)).join('') + '</div>'
      : '<div style="margin-top:14px">' + vide('', vue._onglet === 'afaire' ? 'Rien à faire pour l’instant.' : 'Aucune tâche réalisée.') + '</div>');

  $('#tb-new').onclick = () => ouvrirFormulaireTache({ categorie: vue._cat || 'boutique' }, () => rendre('taches'));
  $$('[data-tb-o]').forEach(b => b.onclick = () => { vue._onglet = b.dataset.tbO; rendre('taches'); });
  $$('[data-tb-c]').forEach(b => b.onclick = () => { vue._cat = b.dataset.tbC; rendre('taches'); });
  brancherTaches(() => rendre('taches'));
};

/* Tour de contrôle (app.js) : tâches en retard ou urgentes. */
async function alerteTaches() {
  const l = (await lireTaches()).filter(t => t.statut !== 'realisee');
  const retard = l.filter(tbEnRetard), urg = l.filter(t => !tbEnRetard(t) && t.priorite === 'urgente');
  if (!retard.length && !urg.length) return null;
  const noms = retard.concat(urg).sort(tbTrier).map(t => t.titre);
  const titre = retard.length
    ? retard.length + ' ' + accord(retard.length, 'tâche en retard', 'tâches en retard')
    : urg.length + ' ' + accord(urg.length, 'tâche urgente', 'tâches urgentes');
  return [retard.length ? 'bad' : 'warn', titre,
    noms.slice(0, 3).join(', ') + (noms.length > 3 ? ' et ' + (noms.length - 3) + ' ' + accord(noms.length - 3, 'autre') : '') + '.',
    'taches'];
}

/* Ma journée : les tâches assignées à la personne connectée. */
const V_accueil_taches = V.accueil;
V.accueil = async function () {
  await V_accueil_taches.apply(this, arguments);
  if (STATE.view !== 'accueil' || !STATE.user) return;
  const miennes = (await lireTaches())
    .filter(t => t.assigne === STATE.user.id && t.statut !== 'realisee').sort(tbTrier);
  if (!miennes.length || STATE.view !== 'accueil') return;
  const page = $('#page');
  if (!page || page.querySelector('#tb-miennes')) return;
  const bloc = document.createElement('div');
  bloc.id = 'tb-miennes';
  bloc.innerHTML = '<div class="entete"><h3>Mes tâches</h3><span class="pousse mini num">' + miennes.length + '</span></div>' +
    '<div class="stack">' + miennes.slice(0, 5).map(t => carteTache(t, true)).join('') + '</div>';
  const haut = page.querySelector('.accueil-haut');
  if (haut && haut.nextSibling) page.insertBefore(bloc, haut.nextSibling); else page.prepend(bloc);
  brancherTaches(() => rendre('accueil'));
};

/* Photos : la copie locale (40 à 80 Ko chacune) ne sert qu'à l'envoi. Une fois
   sur le serveur, elle est retirée de l'iPad pour ne pas remplir sa mémoire ;
   elle se relit à la demande. Jamais une photo encore en file d'attente ou
   trop lourde pour la base, et seulement après avoir vérifié que la base l'a
   bien : la copie locale pourrait être la seule. */
async function tbOublierPhotos() {
  try {
    if (!(SUPABASE.url && SUPABASE.anonKey) || !STATE.enLigne) return;
    const enFile = new Set(fileLire().map(x => x.cle));
    for (const k of DB._clesLocales().filter(c => c.indexOf('tache-photo:') === 0)) {
      if (enFile.has(k) || (DB._gros && DB._gros[k])) continue;
      const brut = DB._lire(k);
      if (brut && brut.length > OFFLINE.tailleMaxOctets) continue;
      const l = await DB._appel(DB._table(k) + '?id=eq.' + encodeURIComponent(k) + '&select=id&limit=1');
      if (l && l.length) DB._oter(k);
    }
  } catch (e) { /* sans conséquence : réessayé au prochain démarrage */ }
}
setTimeout(tbOublierPhotos, 15000);
