/* =============================================================================
   PILOT-SHOP — commande.js
   Proposition de commande Orly : ce qu'il faut commander, parfum par parfum et
   en bacs, pour tenir jusqu'à la livraison suivante.

   Le manager recopie la liste sur le portail BtoB d'Amorino le jour de
   commande (le dimanche). Aucun envoi automatique : le portail n'a pas d'API.

   Pour chaque parfum :
       besoin (L) = consommation par jour × facteur météo × jours à couvrir
                  + réserve de sécurité
                  − stock réel actuel
       bacs       = besoin arrondi au bac supérieur, dans la taille habituelle

   Jours à couvrir : d'aujourd'hui jusqu'à la livraison qui suivra celle de
   cette commande. Ce qu'on commande dimanche doit tenir jusqu'à ce que la
   commande du dimanche d'après arrive.

   Consommation : mesurée entre deux inventaires quand il y en a, parce qu'un
   comptage voit aussi les bacs ouverts sans scan. À défaut, ce sont les
   ouvertures tracées des quatre dernières semaines.

   Chargé APRÈS stock.js.
   ============================================================================= */

'use strict';

PAGES.commande = { titre:'Commande Orly', sous:'Ce qu’il faut commander, en bacs' };
if (MENU_PLUS.manager.indexOf('commande') < 0) {
  const i = MENU_PLUS.manager.indexOf('inventaire');
  MENU_PLUS.manager.splice(i >= 0 ? i + 1 : MENU_PLUS.manager.length, 0, 'commande');
}

const COMMANDE = {
  /* Jours de la semaine au format Date.getDay() : 0 = dimanche. */
  jourCommande: 0,
  jourLivraison: 2,          // mardi par défaut, réglable dans l'écran
  joursSecurite: 2,          // réserve en jours de consommation
  fenetreJours: 28,          // fenêtre de mesure de la consommation
  inventaireMinJours: 7,     // un inventaire de référence a au moins 7 jours
  /* Effet de la météo : +3 % de glace par degré de plus que la moyenne de la
     fenêtre de mesure, borné pour qu'une prévision fausse ne double pas la
     commande. */
  meteoParDegre: 0.03,
  facteurMin: 0.7,
  facteurMax: 1.4,
  /* Au-delà de trois semaines de stock, le parfum est signalé en surstock. */
  surstockJours: 21
};
const JOURS_CMD = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const jourSemaine = iso => new Date(iso + 'T12:00:00').getDay();
const fmtJour = iso => JOURS_CMD[jourSemaine(iso)] + ' ' + fmtDC(iso);
const ecartJours = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);

/* Prochain jour de commande (aujourd'hui compris), la livraison qui le suit,
   et celle d'après, qui borne ce que la commande doit couvrir. */
function calendrierCommande(jour, jourCommande, jourLivraison) {
  let commande = jour;
  while (jourSemaine(commande) !== jourCommande) commande = addD(commande, 1);
  let livraison = addD(commande, 1);
  while (jourSemaine(livraison) !== jourLivraison) livraison = addD(livraison, 1);
  return { commande: commande, livraison: livraison, suivante: addD(livraison, 7) };
}

/* -----------------------------------------------------------------------------
   CALCUL — pur, sans accès à la base, pour pouvoir le vérifier à la main.
     stock        { parfum: litres }  stock réel actuel, négatifs ramenés à 0
     conso        { parfum: litres }  consommation sur la fenêtre
     joursMesure  durée de la fenêtre, en jours
     tailles      { parfum: litres }  taille de bac habituellement reçue
     joursCouvrir de maintenant à la livraison suivante
     facteur      correction météo (1 = sans effet)
   -------------------------------------------------------------------------- */
function calculerCommande(o) {
  const parfums = new Set(Object.keys(o.stock).concat(Object.keys(o.conso)));
  const lignes = [];
  parfums.forEach(p => {
    const stock = Math.max(0, num(o.stock[p]));
    const parJour = Math.max(0, num(o.conso[p])) / Math.max(1, o.joursMesure);
    if (!stock && !parJour) return;
    const taille = num(o.tailles[p]) || FOURNISSEUR.tailleParDefaut;
    const parJourCorrige = parJour * o.facteur;
    const besoin = parJourCorrige * (o.joursCouvrir + o.joursSecurite);
    const manque = besoin - stock;
    /* Un reste de moins d'un dixième de bac ne déclenche pas un bac de plus :
       c'est en dessous de la précision de la mesure. */
    const bacs = manque > 0 ? Math.max(1, Math.ceil(manque / taille - 0.1)) : 0;
    lignes.push({
      parfum: p, stock: stock, parJour: parJourCorrige, taille: taille,
      bacs: bacs,
      couverture: parJourCorrige > 0 ? stock / parJourCorrige : Infinity,
      rupture: parJourCorrige > 0 && stock < parJourCorrige * o.joursAvantLivraison
    });
  });
  return lignes.sort((a, b) => b.bacs - a.bacs || a.couverture - b.couverture ||
                               a.parfum.localeCompare(b.parfum));
}

/* -----------------------------------------------------------------------------
   DONNÉES
   -------------------------------------------------------------------------- */
const estBacGlace = c => litArticle(c).famille === 'glace' && !!litArticle(c).parfum;

/* Litres de glace par parfum, toutes tailles confondues. Un article négatif
   compte pour zéro : il ne doit pas effacer les bacs bien comptés d'une
   autre taille du même parfum. */
function litresParParfum(articles) {
  const out = {};
  Object.keys(articles || {}).forEach(c => {
    if (!estBacGlace(c)) return;
    const a = litArticle(c);
    out[a.parfum] = (out[a.parfum] || 0) + Math.max(0, num(articles[c])) * num(a.taille);
  });
  return out;
}

/* Consommation par parfum, en litres, et la période sur laquelle on l'a
   mesurée ([depuis, fin[, en jours).

   Avec deux inventaires espacés d'au moins sept jours, le plus récent datant
   de moins de quatre semaines : ce qui a disparu entre les deux, réceptions
   comprises. Le débit est pris sur cet intervalle seulement : les jours qui
   suivent le dernier comptage ne reposent que sur les scans, et les bacs
   ouverts sans scan y manqueraient.
   Sans : les ouvertures (et pertes) tracées sur les quatre dernières semaines,
   qui mesurent la même chose que le comptage, la vigilance du scan en moins. */
async function consommationGlace(jour) {
  const debutFenetre = addD(jour, -COMMANDE.fenetreJours);
  const [hist, mouvBruts] = await Promise.all([
    DB.get('stock:inventaires', []).catch(() => []),
    tousMouvements(addD(jour, -2 * COMMANDE.fenetreJours))
  ]);
  const mouv = mouvBruts.map(litMouvement).filter(m => m.cle && estBacGlace(m.cle) && m.at);
  const invs = (Array.isArray(hist) ? hist : [])
    .filter(h => h && h.at && h.jour && h.lignes)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const dernier = invs[invs.length - 1] || null;
  const ref = (dernier && dernier.jour >= debutFenetre)
    ? invs.filter(h => h !== dernier && h.jour >= addD(dernier.jour, -COMMANDE.fenetreJours) &&
                       ecartJours(h.jour, dernier.jour) >= COMMANDE.inventaireMinJours)[0] || null
    : null;

  const ajoute = (o, cle, litres) => { const p = litArticle(cle).parfum; o[p] = (o[p] || 0) + litres; };
  const conso = {};

  if (ref) {
    const avant = litresParParfum(ref.lignes);
    const apres = litresParParfum(dernier.lignes);
    Object.keys(avant).forEach(p => { conso[p] = (conso[p] || 0) + avant[p]; });
    Object.keys(apres).forEach(p => { conso[p] = (conso[p] || 0) - apres[p]; });
    mouv.forEach(m => {
      if (m.type === 'reception' && m.at > ref.at && m.at <= dernier.at)
        ajoute(conso, m.cle, m.qte * num(litArticle(m.cle).taille));
    });
    /* Un parfum compté en hausse sans réception saisie donnerait une
       consommation négative : on la ramène à zéro plutôt que de la déduire. */
    Object.keys(conso).forEach(p => { if (conso[p] < 0) conso[p] = 0; });
    return { conso: conso, jours: ecartJours(ref.jour, dernier.jour), source: 'inventaires',
             depuis: ref.jour, fin: dernier.jour, mouv: mouv, dernier: dernier };
  }

  /* Quatre semaines pleines : d'il y a 27 jours à aujourd'hui inclus. */
  const debut = addD(jour, -(COMMANDE.fenetreJours - 1));
  const sorties = mouv.filter(m => (m.type === 'ouverture' || m.type === 'perte') && m.jour >= debut);
  sorties.forEach(m => ajoute(conso, m.cle, m.qte * num(litArticle(m.cle).taille)));
  /* Moins de quatre semaines d'historique : on divise par ce qui existe, pas
     par 28 jours, sinon une appli mise en service hier sous-commande. */
  const premiere = mouv.filter(m => m.type === 'ouverture' || m.type === 'perte')[0];
  const depuis = (premiere && premiere.jour > debut) ? premiere.jour : debut;
  return { conso: conso, jours: ecartJours(depuis, jour) + 1, source: 'ouvertures',
           depuis: depuis, fin: addD(jour, 1), mouv: mouv, dernier: dernier };
}

/* Taille de bac la plus souvent reçue pour chaque parfum. Un parfum sans
   réception récente prend la taille la plus comptée au dernier inventaire :
   une fraise toujours livrée en 3 L ne doit pas passer en 5 L. */
function taillesHabituelles(mouv, inventaire) {
  const compte = {};
  const note = (cle, q) => {
    const a = litArticle(cle);
    const t = compte[a.parfum] = compte[a.parfum] || {};
    t[a.taille] = (t[a.taille] || 0) + q;
  };
  mouv.forEach(m => { if (m.type === 'reception') note(m.cle, m.qte); });
  const lignes = (inventaire && inventaire.lignes) || {};
  Object.keys(lignes).forEach(c => {
    if (estBacGlace(c) && num(lignes[c]) > 0 && !compte[litArticle(c).parfum]) note(c, num(lignes[c]));
  });
  const out = {};
  Object.keys(compte).forEach(p => {
    const t = compte[p];
    out[p] = num(Object.keys(t).sort((x, y) => t[y] - t[x])[0]);
  });
  return out;
}

/* Facteur météo : température maximale prévue jusqu'à la livraison suivante,
   comparée à celle de la fenêtre de mesure. Une seule requête open-meteo
   donne les deux (past_days + forecast_days). Hors ligne : sans effet. */
let _meteoCommande = { cle: null, at: 0, valeur: null };
async function facteurMeteo(depuis, fin, jour, jusqua) {
  const neutre = { facteur: 1, passe: null, prevu: null };
  if (!METEO.actif || !STATE.enLigne) return neutre;
  const passe = Math.min(92, Math.max(1, ecartJours(depuis, jour)));
  const cle = jour + '|' + passe;
  let d = (_meteoCommande.cle === cle && Date.now() - _meteoCommande.at < 3600e3) ? _meteoCommande.valeur : null;
  if (!d) {
    try {
      const u = METEO.endpoint + '?latitude=' + METEO.lat + '&longitude=' + METEO.lon +
        '&daily=temperature_2m_max&past_days=' + passe + '&forecast_days=16' +
        '&timezone=' + encodeURIComponent(METEO.parametres.timezone);
      const r = await fetch(u, { signal: signalDelai() });
      if (!r.ok) return neutre;
      d = await r.json();
      _meteoCommande = { cle: cle, at: Date.now(), valeur: d };
    } catch (e) { return neutre; }
  }
  const jours = (d.daily && d.daily.time) || [];
  const tmax = (d.daily && d.daily.temperature_2m_max) || [];
  const moyenne = filtre => {
    const v = jours.map((j, i) => filtre(j) ? tmax[i] : null).filter(x => typeof x === 'number');
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const tPasse = moyenne(j => j >= depuis && j < fin && j <= jour);
  const tPrevu = moyenne(j => j >= jour && j <= jusqua);
  if (tPasse === null || tPrevu === null) return neutre;
  const f = 1 + COMMANDE.meteoParDegre * (tPrevu - tPasse);
  return { facteur: Math.min(COMMANDE.facteurMax, Math.max(COMMANDE.facteurMin, f)),
           passe: tPasse, prevu: tPrevu };
}

/* -----------------------------------------------------------------------------
   VUE
   -------------------------------------------------------------------------- */
V.commande = async function () {
  const jour = today();
  const reglages = Object.assign({}, COMMANDE, await DB.get('catalogue:commande', {}).catch(() => ({})));
  const cal = calendrierCommande(jour, reglages.jourCommande, reglages.jourLivraison);
  const [{ articles }, mesure] = await Promise.all([stockReel(), consommationGlace(jour)]);
  const meteoC = await facteurMeteo(mesure.depuis, mesure.fin, jour, cal.suivante);

  const lignes = calculerCommande({
    stock: litresParParfum(articles),
    conso: mesure.conso,
    joursMesure: mesure.jours,
    tailles: taillesHabituelles(mesure.mouv, mesure.dernier),
    joursCouvrir: ecartJours(jour, cal.suivante),
    joursAvantLivraison: ecartJours(jour, cal.livraison),
    joursSecurite: num(reglages.joursSecurite),
    facteur: meteoC.facteur
  });
  const aCommander = lignes.filter(l => l.bacs > 0);
  const couverts = lignes.filter(l => l.bacs === 0);
  const totalBacs = aCommander.reduce((s, l) => s + l.bacs, 0);
  const negatifs = Object.keys(articles).filter(c => estBacGlace(c) && num(articles[c]) < 0);
  const dernierInv = mesure.dernier;
  /* Sans aucune sortie mesurée, « rien à commander » serait un mensonge :
     l'écran le dit et ne propose pas de liste. */
  const sansMesure = !Object.keys(mesure.conso).some(p => mesure.conso[p] > 0);
  const invVieux = !dernierInv || ecartJours(dernierInv.jour, jour) > 7;
  /* Entre la commande précédente et sa livraison, les bacs déjà commandés ne
     sont pas encore au stock : la liste les redemanderait. */
  const enRoute = ecartJours(cal.commande, cal.livraison) < 7 &&
                  jour > addD(cal.commande, -7) && jour <= addD(cal.livraison, -7);

  const texteCopie = () =>
    'Commande Orly du ' + fmtJour(cal.commande) + ', livraison ' + fmtJour(cal.livraison) + '\n' +
    aCommander.map(l => l.parfum + ' : ' + l.bacs + ' ' + accord(l.bacs, 'bac') + ' de ' + l.taille + ' L').join('\n');

  const pctMeteo = Math.round((meteoC.facteur - 1) * 100);
  const lMeteo = meteoC.prevu === null
    ? 'Météo indisponible : pas de correction.'
    : 'Météo : ' + Math.round(meteoC.prevu) + '° de max prévu contre ' + Math.round(meteoC.passe) +
      '° sur la période mesurée, ' + (pctMeteo === 0 ? 'sans correction.' :
      (pctMeteo > 0 ? '+' : '') + pctMeteo + ' % de glace.');

  const ligne = l => carte('<div class="rang"><div style="flex:1;min-width:0"><b>' + esc(l.parfum) + '</b>' +
    '<div class="mini">En stock ' + n1(l.stock) + ' L · ' +
    (l.parJour > 0 ? n1(l.parJour) + ' L par jour' : 'aucune sortie sur la période') +
    (l.couverture === Infinity ? '' : ' · tient ' + Math.floor(l.couverture) + ' j') + '</div></div>' +
    (l.bacs
      ? '<b class="num" style="font-size:20px">' + l.bacs + '</b><span class="mini" style="margin-left:6px">× ' + l.taille + ' L</span>'
      : '') + '</div>',
    l.rupture ? 'corail' : (l.bacs ? '' : (l.couverture > COMMANDE.surstockJours ? 'ambre' : '')));

  const options = (sel) => JOURS_CMD.map((j, i) =>
    '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>' + j + '</option>').join('');

  $('#vue-actions').innerHTML = '';
  $('#page').innerHTML =
    carte('<div class="grid g3">' +
      kpi('À commander', totalBacs, '', accord(totalBacs, 'bac')) +
      kpi('Commande', fmtDC(cal.commande), '', JOURS_CMD[jourSemaine(cal.commande)] + ', sur le portail') +
      kpi('Livraison', fmtDC(cal.livraison), '', JOURS_CMD[jourSemaine(cal.livraison)] + ', doit tenir au ' + fmtDC(cal.suivante)) + '</div>' +
      '<p class="rappel" style="margin-top:14px">Consommation mesurée ' +
      (mesure.source === 'inventaires'
        ? 'entre les inventaires du ' + esc(fmtDC(mesure.depuis)) + ' et du ' + esc(fmtDC(mesure.fin)) +
          ' (' + mesure.jours + ' jours).'
        : 'sur les bacs ouverts et scannés depuis le ' + esc(fmtDC(mesure.depuis)) + ' (' + mesure.jours + ' jours). ' +
          'Deux inventaires à une semaine d’écart rendent le calcul plus juste.') +
      ' ' + esc(lMeteo) + ' Réserve : ' + num(reglages.joursSecurite) + ' ' + accord(num(reglages.joursSecurite), 'jour') + '.</p>',
      'solide') +

    (invVieux
      ? '<div class="alerte warn" style="margin-top:12px"><span class="ai">•</span><div><b>' +
        (dernierInv ? 'Dernier inventaire le ' + esc(fmtD(dernierInv.jour)) : 'Aucun inventaire') + '</b>' +
        '<p>Le stock compté sert de base à la commande. Un inventaire de la chambre froide avant de commander ' +
        'évite de commander sur des bacs ouverts sans scan.</p></div></div>'
      : '') +
    (enRoute
      ? '<div class="alerte warn" style="margin-top:12px"><span class="ai">•</span><div><b>' +
        'Commande du ' + fmtJour(addD(cal.commande, -7)) + ' en route</b>' +
        '<p>Tant qu’elle n’est pas réceptionnée, ses bacs ne sont pas comptés et la liste les redemande. ' +
        'Refaites le calcul après la réception du ' + fmtJour(addD(cal.livraison, -7)) + '.</p></div></div>'
      : '') +
    (negatifs.length
      ? '<div class="alerte warn" style="margin-top:12px"><span class="ai">•</span><div><b>' +
        negatifs.length + ' ' + accord(negatifs.length, 'article') + ' en stock négatif</b>' +
        '<p>Ils sont comptés à zéro. Un inventaire remet les compteurs à plat.</p></div></div>'
      : '') +

    (sansMesure
      ? '<div class="alerte bad" style="margin-top:12px"><span class="ai">•</span><div><b>' +
        'Aucune consommation mesurée</b><p>Ni deux inventaires à une semaine d’écart, ni bacs scannés à ' +
        'l’ouverture sur les quatre dernières semaines : l’appli ne peut pas encore proposer de commande. ' +
        'Faites un inventaire aujourd’hui et un autre dans une semaine, ou scannez chaque bac ouvert.</p></div></div>'
      : '') +
    (sansMesure ? '' : aCommander.length
      ? '<button class="btn menthe bloc xl" id="cm-copier" style="margin-top:16px">Copier la liste</button>' +
        '<div class="entete"><h3>À commander</h3><span class="pousse mini num">' + aCommander.length + ' ' +
        accord(aCommander.length, 'parfum') + '</span></div>' +
        '<div class="stack">' + aCommander.map(ligne).join('') + '</div>'
      : vide('', lignes.length ? 'Le stock tient jusqu’au ' + fmtD(cal.suivante) + ' : rien à commander.'
                               : 'Pas encore de stock ni de consommation. Commencez par un inventaire.')) +

    (couverts.length && !sansMesure
      ? '<div class="entete"><h3>Stock suffisant</h3><span class="pousse mini num">' + couverts.length + '</span></div>' +
        '<div class="stack">' + couverts.map(ligne).join('') + '</div>'
      : '') +

    '<div class="entete"><h3>Réglages</h3></div>' +
    carte('<div class="grid g3">' +
      '<div class="champ"><label class="f">Jour de commande</label><select id="cm-jc">' + options(reglages.jourCommande) + '</select></div>' +
      '<div class="champ"><label class="f">Jour de livraison</label><select id="cm-jl">' + options(reglages.jourLivraison) + '</select></div>' +
      '<div class="champ"><label class="f">Réserve (jours)</label><select id="cm-js">' +
        [0, 1, 2, 3, 4, 5].map(n => '<option value="' + n + '"' + (n === num(reglages.joursSecurite) ? ' selected' : '') + '>' + n + '</option>').join('') +
      '</select></div></div>' +
      '<p class="mini" style="margin-top:10px">En rouge : rupture avant la livraison. En orange : plus de ' +
      COMMANDE.surstockJours + ' jours de stock.</p>');

  const bc = $('#cm-copier');
  if (bc) bc.onclick = async () => {
    const t = texteCopie();
    try { await navigator.clipboard.writeText(t); toast('Liste copiée'); }
    catch (e) {
      /* Presse-papiers refusé (ancien Safari, page non sécurisée) : on passe
         par une zone de texte sélectionnée. */
      const z = document.createElement('textarea');
      z.value = t; z.style.position = 'fixed'; z.style.opacity = '0';
      document.body.appendChild(z); z.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { /* rien */ }
      z.remove();
      toast(ok ? 'Liste copiée' : 'Copie impossible sur cet appareil', ok ? undefined : 'erreur');
    }
  };
  ['cm-jc', 'cm-jl', 'cm-js'].forEach(id => {
    const s = $('#' + id);
    if (s) s.onchange = async () => {
      await DB.set('catalogue:commande', {
        jourCommande: num($('#cm-jc').value),
        jourLivraison: num($('#cm-jl').value),
        joursSecurite: num($('#cm-js').value)
      });
      rendre('commande');
    };
  });
};
