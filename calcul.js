/* =============================================================================
   PILOT-SHOP — calcul.js
   Calcul d'écart guidé, à part de l'inventaire et des périodes de gestion.

   On démarre quand on veut (stock de la chambre froide et de la vitrine), on
   ajoute les livraisons lues sur le bon, puis on clôture quand on veut : stock
   de fin, pertes, ventes de la caisse sur la période. L'application pose les
   questions dans l'ordre du classeur et rend le résultat :
     théorique = départ + livré − pertes − vendu ; écart = réel − théorique.
   Un calcul clôturé au moins une fois par mois : sinon la tour de contrôle
   le signale à partir du 20.
   Un « essai » rejoue d'anciens chiffres pour vérifier l'outil : dates passées
   permises, il ne compte ni pour le mois ni comme départ d'un calcul réel.
   Chargé après app.js, modules.js et stock.js.
   ============================================================================= */

   'use strict';

PAGES.calcul = { titre:'Calcul d’écart', sous:'Départ, livraisons, clôture et ventes' };
if (MENU_PLUS.manager.indexOf('calcul') < 0) MENU_PLUS.manager.unshift('calcul');

const CALCUL = {
  zones: [
    { id:'froid',   label:'Chambre froide' },
    { id:'vitrine', label:'Vitrine' }
  ],
  /* À partir de ce jour du mois, un mois sans calcul clôturé se signale. */
  jourAlerteMois: 20,
  /* Produits vendus et leur grammage, retenus d'un calcul à l'autre. */
  cleProduits: 'catalogue:ventes',
  /* Tailles du classeur Amorino : le 4 L y a sa colonne. */
  taillesBac: [3, 4, 5, 7],
  /* Produits et grammages du classeur Amorino (poids de glace théorique, cornet
     ou coque déduit), proposés tant qu'aucun catalogue n'a été retenu. */
  produitsDefaut: [
    ['Coppa enfant', 81], ['Coppa petit', 133], ['Coppa classic', 163], ['Coppa grand', 221],
    ['Coppa géant', 275], ['Coppa à partager', 529], ['Cornetto enfant', 69], ['Cornetto petit', 114],
    ['Cornetto classique', 153], ['Cornetto grand', 224], ['Choco-cône enfant', 67], ['Choco-cône petit', 112],
    ['Choco-cône classique', 149], ['Choco-cône grand', 208], ['Coffret 550 ml', 470], ['Coffret 1100 ml', 930],
    ['Brioche Glace', 100], ['Brioche x1 glace', 50], ['Brioche x2 glace', 160], ['Sorbet Drink', 160],
    ['Coupe Gourmand', 160], ['Milkshake', 160], ['Affogato al caffé', 160], ['Affogato al Chocolat', 160],
    ['Espresso Frappé', 200], ['Incontour', 80], ['Gaufre x1 glace', 50], ['Gaufre x2 glace', 100],
    ['Gaufre x3 glace', 150], ['Crêpe x1 glace', 50], ['Crêpe x2 glace', 100], ['Crêpe x3 glace', 150],
    ['Cornet Sans Gluten', 153], ['Extra glace x1', 50], ['Extra glace x2', 100]
  ]
};

   /* Poids d'un litre de glace. Un calcul réel prend la valeur mesurée ; un
      essai, qui rejoue l'ancien classeur, prend la sienne pour retrouver ses
      chiffres. Retenue sur le calcul à sa création. */
   /* Un calcul créé avant cette règle n'a pas de poids retenu : ses kg ont été
      enregistrés avec la valeur mesurée, il la garde. */
   const poidsLitre = c => (c && num(c.poidsLitre) > 0) ? num(c.poidsLitre) : FOURNISSEUR.poidsMoyenLitre;
   const poidsNeuf = w => (w.essai && FOURNISSEUR.poidsMoyenLitreClasseur) ? FOURNISSEUR.poidsMoyenLitreClasseur
     : FOURNISSEUR.poidsMoyenLitre;
   const kgDeLitres = (l, pl) => num(l) * (pl || FOURNISSEUR.poidsMoyenLitre);
   const kgTxt = v => n1(v) + ' kg';
   /* Pourcentage d'écart avec le vrai signe moins, comme l'écart en kg. */
   const pctTxt = r => r.incoherent ? 'incohérent' :
     (Math.abs(r.pct) < 0.05 ? '' : r.pct > 0 ? '−' : '+') + n1(Math.abs(r.pct)) + ' %';

   /* Un stock de zone, comme dans le classeur : bacs pleins par taille +
      litrage approximatif des bacs entamés. (entamesKg : premières saisies,
      pesées.) */
   function kgStock(s, pl) {
     if (!s) return 0;
     let l = num(s.entamesL);
     Object.keys(s.bacs || {}).forEach(t => { l += num(s.bacs[t]) * num(t); });
     return kgDeLitres(l, pl) + num(s.entamesKg);
   }
   const kgZones = (z, pl) => CALCUL.zones.reduce((t, x) => t + kgStock(z && z[x.id], pl), 0);

   function champsZones(p, z, pl) {
     return CALCUL.zones.map(x => {
       const s = (z && z[x.id]) || {};
       /* Entamés pesés en kg (premières saisies) : convertis en litres au même
          poids, pour ne pas les perdre en réenregistrant la zone. */
       const entames = s => num(s.entamesL) + (num(s.entamesKg) > 0 ? +(num(s.entamesKg) / (pl || FOURNISSEUR.poidsMoyenLitre)).toFixed(2) : 0);
       const v = n => (n === undefined || n === null || n === '' || num(n) === 0) ? '' : n;
       return '<p class="f" style="margin:16px 0 6px"><b>' + esc(x.label) + '</b></p>' +
         '<div class="grid g4">' + CALCUL.taillesBac.map(t =>
           '<div class="champ"><label class="f">Bacs pleins ' + t + ' L</label>' +
           '<input type="number" min="0" step="1" inputmode="numeric" data-zone="' + x.id + '" data-taille="' + t + '" ' +
           'id="' + p + '-' + x.id + '-' + t + '" value="' + esc(v((s.bacs || {})[t])) + '" placeholder="0"></div>').join('') +
         '<div class="champ"><label class="f">Entamés (litres approx.)</label>' +
         '<input type="number" min="0" step="0.5" inputmode="decimal" data-zone="' + x.id + '" data-entames ' +
         'id="' + p + '-' + x.id + '-el" value="' + esc(v(entames(s))) + '" placeholder="0"></div></div>';
     }).join('') +
     '<p class="mini" id="' + p + '-total" style="margin-top:12px"></p>';
   }
   function lireZones(p) {
     const z = {};
     CALCUL.zones.forEach(x => {
       const bacs = {};
       CALCUL.taillesBac.forEach(t => { const el = $('#' + p + '-' + x.id + '-' + t); bacs[t] = el ? Math.max(0, num(el.value)) : 0; });
       const el = $('#' + p + '-' + x.id + '-el');
       z[x.id] = { bacs:bacs, entamesL:el ? Math.max(0, num(el.value)) : 0 };
     });
     return z;
   }
   /* Total recalculé à chaque frappe, sous les champs. */
   function suivreTotal(p, pl) {
     const maj = () => {
       const z = lireZones(p);
       const el = $('#' + p + '-total');
       if (el) el.textContent = CALCUL.zones.map(x => x.label + ' ' + kgTxt(kgStock(z[x.id], pl))).join(' · ') +
         ' · Total ' + kgTxt(kgZones(z, pl));
     };
     $$('#sheet-corps [data-zone]').forEach(i => i.oninput = maj);
     maj();
   }

   /* ---------------------------------------------------------------------------
      Lecture des calculs
      ------------------------------------------------------------------------ */
   async function lireCalculs() {
     const cles = (await DB.list('calcul:')).filter(k => /^calcul:\d{4}-\d{2}-\d{2}:/.test(k));
     const l = await Promise.all(cles.map(k => DB.get(k, null)));
     /* Un calcul supprimé est marqué, pas effacé : effacé, il revenait du
        cache d'un autre iPad, toujours « ouvert ». */
     return l.filter(c => c && c.id && c.debut && c.statut !== 'supprime')
       .sort((a, b) => (a.debut < b.debut ? 1 : a.debut > b.debut ? -1 : String(a.at) < String(b.at) ? 1 : -1));
   }
   const reelOuvert = cs => cs.filter(c => !c.essai && c.statut === 'ouvert')[0] || null;
   function derniereCloture(cs) {
     return cs.filter(c => !c.essai && c.statut === 'clos' && c.fin)
       .sort((a, b) => (a.fin < b.fin ? 1 : a.fin > b.fin ? -1 : String(a.closAt) < String(b.closAt) ? 1 : -1))[0] || null;
   }

   /* Livraisons qui comptent : les retirées sont marquées à part (une liste
      qui ne fait que grandir, sans écraser celles d'un autre iPad) ; un calcul
      clos ne compte que celles arrêtées à sa clôture — une livraison renvoyée
      après coup par un iPad hors ligne n'en change pas le résultat. */
   function livraisonsDe(c) {
     const ret = c.livraisonsRetirees || [];
     let l = (c.livraisons || []).filter(x => x && ret.indexOf(x.id) < 0);
     if (c.statut === 'clos' && Array.isArray(c.livraisonsArretees)) l = l.filter(x => c.livraisonsArretees.indexOf(x.id) >= 0);
     return l;
   }
   /* Départ repris d'une clôture : le stock a été compté ce jour-là, en fin de
      journée. Les pertes et les ventes de ce jour appartiennent au calcul
      précédent ; le nouveau les prend à partir du lendemain. */
   const debutFlux = c => (c.depart && c.depart.source === 'precedent') ? addD(c.debut, 1) : c.debut;

   function resultatCalcul(c) {
     const debut  = num(c.depart && c.depart.kg);
     const livreL = livraisonsDe(c).reduce((t, l) => t + num(l.litres), 0);
     const livre  = kgDeLitres(livreL, poidsLitre(c));
     const perte  = num(c.pertes && c.pertes.kg);
     const vendu  = num(c.ventes && c.ventes.kg);
     const theo   = debut + livre - perte - vendu;
     const reel   = num(c.arrivee && c.arrivee.kg);
     const ecart  = reel - theo;
     /* Même convention que l'écran Écarts : positif = glace manquante. */
     /* Théorique nul ou négatif : une saisie est fausse (ventes trop fortes),
        le pourcentage n'a plus de sens. */
     const incoherent = !(theo > 0);
     const pct    = incoherent ? 0 : ((theo - reel) / theo) * 100;
     return { debut, livreL, livre, perte, vendu, theo, reel, ecart, pct, incoherent,
              valeur:ecart * FOURNISSEUR.prixMoyenKg };
   }

   /* Pertes du registre entre deux dates, en litres. */
   async function litresPertesRegistre(debut, fin) {
     let l = 0;
     const cles = (await DB.list('pertes:')).filter(k => { const d = k.slice(7); return d >= debut && d <= fin; });
     for (const k of cles) (await DB.get(k, [])).forEach(w => { l += litresPerte(w); });
     return l;
   }

   function etatMois(cs) {
     const mois = today().slice(0, 7);
     const fait = cs.filter(c => !c.essai && c.statut === 'clos' && String(c.fin).slice(0, 7) === mois)[0] || null;
     return { mois:mois, fait:fait };
   }
   /* Pour la tour de contrôle : [niveau, titre, texte, vue] ou null. */
   async function alerteCalculMensuel() {
     if (+today().slice(8, 10) < CALCUL.jourAlerteMois) return null;
     const m = etatMois(await lireCalculs());
     if (m.fait) return null;
     return ['warn', 'Calcul d’écart du mois à faire',
       'Aucun calcul clôturé en ' + fmtM(today()) + '. Il en faut au moins un par mois.', 'calcul'];
   }

   /* ---------------------------------------------------------------------------
      Vue principale
      ------------------------------------------------------------------------ */
   V.calcul = async function () {
     const cs = await lireCalculs();
     if (STATE.view !== 'calcul') return;
     const ouverts = cs.filter(c => c.statut === 'ouvert');
     const clos = cs.filter(c => c.statut === 'clos')
       .sort((a, b) => (a.fin < b.fin ? 1 : a.fin > b.fin ? -1 : 0));
     const m = etatMois(cs);

     $('#vue-actions').innerHTML = '<button class="btn sm" id="cg-new">Nouveau calcul</button>';

     const carteOuvert = c => {
       const r = resultatCalcul(c);
       return carte(
         '<div class="rang"><div style="flex:1"><h2>' + (c.essai ? 'Essai' : 'Calcul en cours') +
           ' depuis le ' + esc(fmtD(c.debut)) + '</h2>' +
         '<div class="cs">Départ ' + kgTxt(r.debut) + ' · ' + livraisonsDe(c).length + ' livraison(s), ' +
           n1(r.livreL) + ' L' + (c.brouillon ? ' · clôture commencée' : '') + '</div></div>' +
         (c.essai ? pastille('ciel', 'ESSAI') : pastille('ok', 'OUVERT')) + '</div>' +
         '<div class="actions">' +
         '<button class="btn clair" data-cg-liv="' + esc(c.id) + '">Ajouter une livraison</button>' +
         '<button class="btn menthe" data-cg-clo="' + esc(c.id) + '">' + (c.brouillon ? 'Reprendre la clôture' : 'Clôturer') + '</button></div>' +
         '<button class="btn fantome bloc" data-cg-sup="' + esc(c.id) + '" style="margin-top:8px">Supprimer ce calcul</button>',
         c.essai ? '' : 'solide');
     };

     $('#page').innerHTML =
       (m.fait
         ? '<div class="alerte ok"><span class="ai">✓</span><div><b>Calcul de ' + esc(fmtM(today())) + ' fait</b>' +
           '<p>Clôturé le ' + esc(fmtD(m.fait.fin)) + '. Rien n’empêche d’en faire d’autres en cours de mois.</p></div></div>'
         : '<div class="alerte ' + (+today().slice(8, 10) >= CALCUL.jourAlerteMois ? 'warn' : 'info') + '"><span class="ai">●</span>' +
           '<div><b>Calcul de ' + esc(fmtM(today())) + ' à faire</b>' +
           '<p>Au moins un calcul clôturé par mois. Les comptages pour l’écart se font ici, pas dans l’inventaire.</p></div></div>') +

       '<div class="stack" style="margin-top:12px">' + ouverts.map(carteOuvert).join('') + '</div>' +

       (ouverts.length ? '' : carte(entete('', 'Aucun calcul en cours',
           'Démarrez quand vous voulez : on compte la chambre froide et la vitrine, puis on clôture plus tard.') +
         '<button class="btn menthe bloc xl" id="cg-new2" style="margin-top:12px">Démarrer un calcul</button>')) +

       '<div class="entete" style="margin-top:18px"><h3>Calculs clôturés</h3></div>' +
       (clos.length
         ? '<div class="dense"><div class="dense-h"><span class="c1">Période</span>' +
           '<span class="c w">Écart</span><span class="c w">%</span></div>' +
           clos.slice(0, 24).map(c => {
             const r = resultatCalcul(c);
             const st = r.incoherent ? { c:'bad' } : etatEcart(r.pct);
             return '<div class="dl" data-cg-voir="' + esc(c.id) + '" style="cursor:pointer">' +
               '<span class="c1">' + (c.essai ? '<b>Essai</b> · ' : '') + esc(fmtDC(c.debut)) + ' → ' + esc(fmtDC(c.fin)) + '</span>' +
               '<span class="c w num">' + (r.ecart > 0.05 ? '+' : r.ecart < -0.05 ? '−' : '') + kgTxt(Math.abs(r.ecart)) + '</span>' +
               '<span class="c w">' + pastille(st.c, pctTxt(r)) + '</span></div>';
           }).join('') + '</div>'
         : vide('', 'Aucun calcul clôturé pour l’instant.'));

     $('#cg-new').onclick = () => demarrerCalcul();
     if ($('#cg-new2')) $('#cg-new2').onclick = () => demarrerCalcul();
     const parId = id => cs.filter(c => c.id === id)[0];
     $$('[data-cg-liv]').forEach(b => b.onclick = () => ajouterLivraison(parId(b.dataset.cgLiv)));
     $$('[data-cg-clo]').forEach(b => b.onclick = () => cloturerCalcul(parId(b.dataset.cgClo)));
     $$('[data-cg-voir]').forEach(b => b.onclick = () => voirCalcul(parId(b.dataset.cgVoir)));
     $$('[data-cg-sup]').forEach(b => b.onclick = () => {
       const c = parId(b.dataset.cgSup);
       confirmer('Supprimer ce calcul ?',
         (c.essai ? 'Essai' : 'Calcul') + ' démarré le ' + fmtD(c.debut) + '. Les chiffres saisis seront perdus.',
         'Supprimer', async () => {
           await DB.patch(c.id, { statut:'supprime', suppPar:STATE.user.prenom, suppAt:nowISO() });
           await feed('ok', STATE.user.prenom + ' a supprimé le calcul d’écart démarré le ' + fmtD(c.debut));
           rendre('calcul');
         });
     });
   };

   /* ---------------------------------------------------------------------------
      Démarrage
      ------------------------------------------------------------------------ */
   async function demarrerCalcul() {
     const cs = await lireCalculs();
     const prec = derniereCloture(cs);
     const w = { essai:false, debut:today(), source:prec ? 'precedent' : 'manuel', zones:null, livraisons:[] };
     const debutReel = () => (!w.essai && w.source === 'precedent' && prec) ? prec.fin : w.debut;

     const e1 = () => {
       showSheet(
         '<h2 id="sheet-titre">Nouveau calcul d’écart</h2>' +
         '<p class="sub">Étape 1 · Le départ</p>' +
         '<label class="f">Type de calcul</label><div class="chips" id="cd-type">' +
         '<button type="button" class="chip' + (w.essai ? '' : ' on') + '" data-t="reel">Calcul réel</button>' +
         '<button type="button" class="chip' + (w.essai ? ' on' : '') + '" data-t="essai">Essai (vérification)</button></div>' +
         '<p class="mini" id="cd-essai" style="margin-top:6px"' + (w.essai ? '' : ' hidden') + '>Un essai rejoue d’anciens chiffres ' +
           'pour vérifier l’outil. Il ne compte ni pour le calcul du mois, ni comme départ d’un calcul réel.</p>' +
         '<div id="cd-src-bloc"' + (w.essai || !prec ? ' hidden' : '') + '>' +
         '<label class="f" style="margin-top:14px">Stock de départ</label><div class="chips" id="cd-src">' +
         (prec ? '<button type="button" class="chip' + (w.source === 'precedent' ? ' on' : '') + '" data-s="precedent">' +
           'Reprendre la clôture du ' + esc(fmtDC(prec.fin)) + ' (' + kgTxt(num(prec.arrivee && prec.arrivee.kg)) + ')</button>' : '') +
         '<button type="button" class="chip' + (w.source === 'manuel' ? ' on' : '') + '" data-s="manuel">Compter maintenant</button></div></div>' +
         '<div class="champ" style="margin-top:14px"><label class="f">Date de départ</label>' +
         '<input type="date" id="cd-debut" max="' + today() + '" value="' + esc(debutReel()) + '"></div>' +
         '<div id="cd-ouvert"></div>' +
         '<div class="actions"><button class="btn clair" data-fermer>Fermer</button>' +
         '<button class="btn menthe" id="cd-suiv">Suivant</button></div>');
       const majDate = () => {
         const d = $('#cd-debut');
         const verrou = !w.essai && w.source === 'precedent' && !!prec;
         d.disabled = verrou;
         if (verrou) d.value = prec.fin;
       };
       majDate();
       $$('#cd-type .chip').forEach(b => b.onclick = () => {
         w.debut = $('#cd-debut').value || w.debut;
         w.essai = b.dataset.t === 'essai';
         if (w.essai) w.source = 'manuel';
         else if (prec) w.source = 'precedent';
         e1();
       });
       $$('#cd-src .chip').forEach(b => b.onclick = () => {
         w.source = b.dataset.s;
         $$('#cd-src .chip').forEach(x => x.classList.toggle('on', x === b));
         majDate();
       });
       $('#cd-suiv').onclick = () => {
         const d = $('#cd-debut').value;
         if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { toast('Indiquez la date de départ', 'erreur'); return; }
         if (d > today()) { toast('La date de départ ne peut pas être dans le futur', 'erreur'); return; }
         if (!w.essai) {
           const ouvert = reelOuvert(cs);
           if (ouvert) {
             $('#cd-ouvert').innerHTML = '<div class="alerte warn" style="margin-top:14px"><span class="ai">●</span><div>' +
               '<b>Un calcul est déjà en cours</b><p>Démarré le ' + esc(fmtD(ouvert.debut)) +
               '. Clôturez-le d’abord, ou choisissez « Essai ».</p></div></div>';
             return;
           }
         }
         w.debut = d;
         if (!w.essai && w.source === 'precedent' && prec) e3(); else e2();
       };
     };

     const e2 = () => {
       showSheet(
         '<h2 id="sheet-titre">Stock de départ</h2>' +
         '<p class="sub">Étape 2 · Comptage du ' + esc(fmtD(w.debut)) + '</p>' +
         champsZones('cz', w.zones, poidsNeuf(w)) +
         '<div class="actions"><button class="btn clair" id="cz-ret">Retour</button>' +
         '<button class="btn menthe" id="cz-suiv">Suivant</button></div>');
       suivreTotal('cz', poidsNeuf(w));
       $('#cz-ret').onclick = () => { w.zones = lireZones('cz'); e1(); };
       $('#cz-suiv').onclick = () => {
         w.zones = lireZones('cz');
         if (!(kgZones(w.zones, poidsNeuf(w)) > 0)) { toast('Le stock de départ est vide : comptez au moins une zone', 'erreur'); return; }
         e3();
       };
     };

     const e3 = () => {
       showSheet(
         '<h2 id="sheet-titre">Une livraison ?</h2>' +
         '<p class="sub">Étape 3 · Seulement une livraison arrivée après le comptage de départ</p>' +
         listeLivraisons(w.livraisons, true) +
         formLivraison(w.source === 'precedent' && !w.essai && w.debut < today() ? addD(w.debut, 1) : w.debut) +
         '<div id="lv-doublon"></div>' +
         '<div class="actions"><button class="btn clair" id="lv-ret">Retour</button>' +
         '<button class="btn menthe" id="lv-suiv">Suivant</button></div>');
       brancherLivraisons(w.livraisons, e3);
       $('#lv-ret').onclick = () => (!w.essai && w.source === 'precedent' && prec) ? e1() : e2();
       $('#lv-suiv').onclick = () => {
         if (num($('#lv-litres').value) > 0) { toast('Touchez « Ajouter cette livraison » ou videz le champ des litres', 'erreur'); return; }
         e4();
       };
     };

     const e4 = () => {
       showSheet(
         '<h2 id="sheet-titre">Clôturer aujourd’hui ?</h2>' +
         '<p class="sub">Étape 4 · Le calcul reste ouvert tant qu’il n’est pas clôturé</p>' +
         '<p class="mini">Vous pourrez ajouter des livraisons et clôturer à n’importe quel moment : ' +
           'dans trois jours, une semaine ou deux.</p>' +
         '<div class="actions"><button class="btn clair" id="cl-non">Non, plus tard</button>' +
         '<button class="btn menthe" id="cl-oui">Oui, clôturer</button></div>' +
         '<button class="btn fantome bloc" id="cl-ret" style="margin-top:8px">Retour</button>');
       let enCours = false, cree = null;
       const boutons = on => ['#cl-non', '#cl-oui', '#cl-ret'].forEach(x => { if ($(x)) $(x).disabled = !on; });
       const enregistrer = async () => {
         /* Déjà créé (appui répété pendant l'ouverture de la clôture) : on
            reprend le même calcul au lieu d'en créer un second. */
         if (cree) return cree;
         if (enCours) return null;
         enCours = true;
         boutons(false);
         try {
           const id = 'calcul:' + w.debut + ':' + uid();
           const depart = (!w.essai && w.source === 'precedent' && prec)
             ? { source:'precedent', ref:prec.id, zones:(prec.arrivee && prec.arrivee.zones) || null,
                 kg:+num(prec.arrivee && prec.arrivee.kg).toFixed(3) }
             : { source:'manuel', zones:w.zones, kg:+kgZones(w.zones, poidsNeuf(w)).toFixed(3) };
           const c = { id:id, essai:w.essai, debut:w.debut, statut:'ouvert', depart:depart, poidsLitre:poidsNeuf(w),
                       livraisons:w.livraisons, par:STATE.user.prenom, at:nowISO() };
           await DB.patch(id, c);
           await feed('ok', STATE.user.prenom + ' a démarré ' + (w.essai ? 'un essai de calcul' : 'un calcul d’écart') +
             ' au ' + fmtD(w.debut) + ' (' + kgTxt(depart.kg) + ')');
           cree = c;
           return c;
         } finally { enCours = false; if (!cree) boutons(true); }
       };
       $('#cl-ret').onclick = e3;
       $('#cl-non').onclick = async () => {
         const c = await enregistrer();
         if (!c) return;
         closeSheet();
         toast('Calcul démarré. Revenez le clôturer quand vous voulez');
         rendre('calcul');
       };
       $('#cl-oui').onclick = async () => {
         const c = await enregistrer();
         if (!c) return;
         cloturerCalcul(c);
       };
     };

     e1();
   }

   /* ---------------------------------------------------------------------------
      Livraisons (litres lus sur le bon)
      ------------------------------------------------------------------------ */
   function listeLivraisons(l, retirable) {
     if (!l.length) return '<p class="mini">Aucune livraison pour l’instant.</p>';
     return '<div class="dense"><div class="dense-h"><span class="c1">Bon</span><span class="c w">Litres</span>' +
       (retirable ? '<span class="c w"></span>' : '') + '</div>' + l.map(x =>
       '<div class="dl"><span class="c1">' + esc(x.numero || 'sans numéro') + ' · ' + esc(fmtDC(x.date)) + '</span>' +
       '<span class="c w num">' + n1(x.litres) + ' L</span>' +
       (retirable ? '<span class="c w"><button type="button" class="btn fantome sm" data-lv-ret="' + esc(x.id) + '">Retirer</button></span>' : '') +
       '</div>').join('') + '</div>';
   }
   function formLivraison(dateDefaut) {
     return '<div class="grid g3" style="margin-top:14px">' +
       '<div class="champ"><label class="f">N° du bon</label>' +
       '<input type="text" id="lv-num" autocapitalize="characters" spellcheck="false" placeholder="Facultatif"></div>' +
       '<div class="champ"><label class="f">Date</label>' +
       '<input type="date" id="lv-date" max="' + today() + '" value="' + esc(dateDefaut) + '"></div>' +
       '<div class="champ"><label class="f">Litres livrés</label>' +
       '<input type="number" id="lv-litres" min="0" step="0.5" inputmode="decimal" placeholder="Ex. 120"></div></div>' +
       '<button type="button" class="btn clair bloc" id="lv-ajout" style="margin-top:10px">Ajouter cette livraison</button>';
   }
   /* Ajout et retrait dans une liste tenue en mémoire (assistants). */
   function brancherLivraisons(l, redessiner, ecrire) {
     let doublonVu = '';
     $('#lv-num').oninput = () => { doublonVu = ''; $('#lv-doublon').innerHTML = ''; };
     $('#lv-ajout').onclick = () => {
       const litres = num($('#lv-litres').value);
       if (!(litres > 0)) { toast('Indiquez le nombre de litres livrés', 'erreur'); return $('#lv-litres').focus(); }
       const numero = $('#lv-num').value.trim().toUpperCase();
       if (numero && doublonVu !== numero && l.some(x => x.numero === numero)) {
         doublonVu = numero;
         $('#lv-doublon').innerHTML = '<div class="alerte warn" style="margin-top:10px"><span class="ai">●</span><div>' +
           '<b>Bon « ' + esc(numero) + ' » déjà compté</b><p>Touchez encore « Ajouter » s’il s’agit d’un autre bon.</p></div></div>';
         return;
       }
       const x = { id:uid(), numero:numero, date:$('#lv-date').value || today(), litres:litres,
                   par:STATE.user.prenom, at:nowISO() };
       l.push(x);
       if (ecrire) ecrire('ajout', x);
       redessiner();
     };
     $$('[data-lv-ret]').forEach(b => b.onclick = () => {
       const i = l.findIndex(x => x.id === b.dataset.lvRet);
       if (i >= 0) { const x = l.splice(i, 1)[0]; if (ecrire) ecrire('retrait', x); }
       redessiner();
     });
   }

   /* Livraison ajoutée à un calcul déjà ouvert : écriture partielle. */
   async function ajouterLivraison(c0) {
     if (!c0) return;
     const c = (await DB.get(c0.id, null)) || c0;
     if (c.statut !== 'ouvert') { toast('Ce calcul n’est plus ouvert'); rendre('calcul'); return; }
     const l = livraisonsDe(c).slice();
     const avant = l.length;
     const dessiner = () => {
       showSheet(
         '<h2 id="sheet-titre">Ajouter une livraison</h2>' +
         '<p class="sub">Calcul démarré le ' + esc(fmtD(c.debut)) + ' · litres lus sur le bon</p>' +
         listeLivraisons(l, false) + formLivraison(today()) + '<div id="lv-doublon"></div>' +
         '<div class="actions"><button class="btn clair" data-fermer>Fermer</button>' +
         '<button class="btn menthe" id="lv-fin">Enregistrer</button></div>');
       brancherLivraisons(l, dessiner);
       let enCours = false;
       $('#lv-fin').onclick = async () => {
         if (enCours) return;
         /* Litres tapés sans « Ajouter » : on les ajoute plutôt que de les perdre. */
         if (num($('#lv-litres').value) > 0) { const n = l.length; $('#lv-ajout').click(); if (l.length === n) return; }
         const neufs = l.slice(avant);
         if (!neufs.length) { closeSheet(); return; }
         enCours = true;
         try {
           const actuel = await DB.get(c.id, null);
           if (actuel && actuel.statut !== 'ouvert') { closeSheet(); toast('Ce calcul vient d’être clôturé ou supprimé', 'erreur'); rendre('calcul'); return; }
           await DB.patch(c.id, {}, { livraisons:neufs });
           const litres = neufs.reduce((t, x) => t + x.litres, 0);
           await feed('ok', STATE.user.prenom + ' a ajouté ' + n1(litres) + ' L livrés au calcul d’écart');
           closeSheet();
           toast(n1(litres) + ' L ajoutés');
           rendre('calcul');
         } finally { enCours = false; }
       };
     };
     dessiner();
   }

   /* ---------------------------------------------------------------------------
      Clôture
      ------------------------------------------------------------------------ */
   async function cloturerCalcul(c0) {
     if (!c0) return;
     /* Relu : une livraison a pu être ajoutée sur un autre iPad. */
     const c = (await DB.get(c0.id, null)) || c0;
     if (c.statut !== 'ouvert') { toast('Ce calcul n’est plus ouvert'); rendre('calcul'); return; }
     const b = c.brouillon || {};
     const w = {
       fin: b.fin || today(),
       livraisons: livraisonsDe(c).slice(),
       zones: b.zones || null,
       perteL: b.perteL !== undefined ? b.perteL : null,
       perteSource: b.perteSource || '',
       perteKg: num(b.perteKg),
       ventes: b.ventes || { mode:'produits', lignes:null, kg:0 }
     };
     const brouillon = () => DB.patch(c.id, { brouillon:{ fin:w.fin, zones:w.zones, perteL:w.perteL, perteKg:w.perteKg,
                                                          perteSource:w.perteSource, ventes:w.ventes } });

     const eA = () => {
       showSheet(
         '<h2 id="sheet-titre">Clôture du calcul</h2>' +
         '<p class="sub">Étape 1 sur 4 · Fin de période et livraisons (départ le ' + esc(fmtD(c.debut)) + ')</p>' +
         '<div class="champ"><label class="f">Date de clôture</label>' +
         '<input type="date" id="ca-fin" min="' + esc(c.debut) + '" max="' + today() + '" value="' + esc(w.fin) + '"></div>' +
         '<label class="f" style="margin-top:14px">Livraisons depuis le départ</label>' +
         listeLivraisons(w.livraisons, true) + formLivraison(w.fin) + '<div id="lv-doublon"></div>' +
         '<div class="actions"><button class="btn clair" id="ca-tard">Plus tard</button>' +
         '<button class="btn menthe" id="ca-suiv">Suivant</button></div>');
       /* Les livraisons ajoutées ou retirées ici partent tout de suite, par
          ajout à des listes : fermer l'assistant ne les perd pas, et celles
          ajoutées entre-temps sur un autre iPad ne sont pas écrasées. */
       brancherLivraisons(w.livraisons, () => { changerFin($('#ca-fin').value || w.fin); eA(); },
         (quoi, x) => quoi === 'ajout'
           ? DB.patch(c.id, {}, { livraisons:[x] })
           : DB.patch(c.id, {}, { livraisonsRetirees:[x.id] }));
       const changerFin = f => {
         /* Pertes reprises du registre : relues pour la nouvelle période. */
         if (f !== w.fin && w.perteSource !== 'Saisie') w.perteL = null;
         w.fin = f;
       };
       $('#ca-tard').onclick = async () => {
         const f = $('#ca-fin').value;
         if (/^\d{4}-\d{2}-\d{2}$/.test(f) && f >= c.debut && f <= today()) { changerFin(f); await brouillon(); }
         closeSheet();
         rendre('calcul');
       };
       $('#ca-suiv').onclick = async () => {
         const f = $('#ca-fin').value;
         if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || f < c.debut || f > today()) {
           toast('La clôture doit tomber entre le ' + fmtDC(c.debut) + ' et aujourd’hui', 'erreur'); return;
         }
         if (num($('#lv-litres').value) > 0) { toast('Touchez « Ajouter cette livraison » ou videz le champ des litres', 'erreur'); return; }
         changerFin(f);
         await brouillon();
         eB();
       };
     };

     const eB = () => {
       showSheet(
         '<h2 id="sheet-titre">Stock de fin</h2>' +
         '<p class="sub">Étape 2 sur 4 · Comptage du ' + esc(fmtD(w.fin)) + '</p>' +
         champsZones('cf', w.zones, poidsLitre(c)) +
         '<div class="actions"><button class="btn clair" id="cf-ret">Retour</button>' +
         '<button class="btn menthe" id="cf-suiv">Suivant</button></div>');
       suivreTotal('cf', poidsLitre(c));
       $('#cf-ret').onclick = () => { w.zones = lireZones('cf'); eA(); };
       $('#cf-suiv').onclick = async () => {
         w.zones = lireZones('cf');
         if (!(kgZones(w.zones, poidsLitre(c)) > 0)) { toast('Le stock de fin est vide : comptez au moins une zone', 'erreur'); return; }
         await brouillon();
         eC();
       };
     };

     const eC = async () => {
       /* Calcul réel : pertes reprises du registre, corrigeables. Essai : les
          chiffres viennent de l'ancien classeur, on part de zéro. */
       let reg = null;
       const d0 = debutFlux(c);
       if (!c.essai) reg = d0 <= w.fin ? await litresPertesRegistre(d0, w.fin) : 0;
       if (w.perteL === null) { w.perteL = reg || 0; w.perteSource = c.essai ? 'Saisie' : 'Registre des pertes'; }
       showSheet(
         '<h2 id="sheet-titre">Pertes de la période</h2>' +
         '<p class="sub">Étape 3 sur 4 · Glace jetée ' + esc(texteDates(debutFlux(c), w.fin)) + '</p>' +
         (reg !== null ? '<p class="mini">Registre des pertes : ' + n1(reg) + ' L sur ces dates.</p>' : '') +
         '<div class="champ" style="margin-top:10px"><label class="f">Litres jetés</label>' +
         '<input type="number" id="cp-l" min="0" step="0.1" inputmode="decimal" value="' + (w.perteL || '') + '" placeholder="0"></div>' +
         '<div class="champ" style="margin-top:10px"><label class="f">Et/ou kg jetés (pesés)</label>' +
         '<input type="number" id="cp-k" min="0" step="0.01" inputmode="decimal" value="' + (w.perteKg || '') + '" placeholder="0"></div>' +
         '<p class="mini" id="cp-kg" style="margin-top:8px"></p>' +
         '<div class="actions"><button class="btn clair" id="cp-ret">Retour</button>' +
         '<button class="btn menthe" id="cp-suiv">Suivant</button></div>');
       const maj = () => { $('#cp-kg').textContent = 'Pertes : ' +
         kgTxt(kgDeLitres($('#cp-l').value, poidsLitre(c)) + Math.max(0, num($('#cp-k').value))); };
       $('#cp-l').oninput = maj; $('#cp-k').oninput = maj; maj();
       const lire = () => {
         const v = Math.max(0, num($('#cp-l').value));
         if (reg === null || Math.abs(v - reg) > 0.001) w.perteSource = 'Saisie';
         else w.perteSource = 'Registre des pertes';
         w.perteL = v;
         w.perteKg = Math.max(0, num($('#cp-k').value));
         if (w.perteKg > 0) w.perteSource = 'Saisie';
       };
       $('#cp-ret').onclick = () => { lire(); eB(); };
       $('#cp-suiv').onclick = async () => { lire(); await brouillon(); eD(); };
     };

     const eD = async () => {
       if (!w.ventes.lignes) {
         const cat = await DB.get(CALCUL.cleProduits, []);
         const base = (Array.isArray(cat) && cat.length) ? cat : CALCUL.produitsDefaut.map(x => ({ nom:x[0], g:x[1] }));
         w.ventes.lignes = base.map(p => ({ nom:p.nom, g:p.g, q:'' }));
         if (!w.ventes.lignes.length) w.ventes.lignes = [{ nom:'', g:'', q:'' }];
       }
       const v = w.ventes;
       const modes = [['produits', 'Par produit'], ['total', 'Total en kg'], ['fichier', 'Fichier de caisse']];
       showSheet(
         '<h2 id="sheet-titre">Ventes de la période</h2>' +
         '<p class="sub">Étape 4 sur 4 · Exportez de la caisse les ventes ' + esc(texteDates(debutFlux(c), w.fin)) + '</p>' +
         '<div class="chips" id="cv-mode">' + modes.map(m =>
           '<button type="button" class="chip' + (v.mode === m[0] ? ' on' : '') + '" data-m="' + m[0] + '">' + m[1] + '</button>').join('') + '</div>' +
         '<div id="cv-corps" style="margin-top:14px">' +
         (v.mode === 'produits'
           ? '<p class="mini">Quantité vendue de chaque produit et grammage de glace par unité. ' +
               'Les produits et grammages sont retenus pour le prochain calcul.</p>' +
             '<div class="grid g3" style="margin-top:8px"><label class="f">Produit</label><label class="f">Grammes / unité</label><label class="f">Quantité vendue</label></div>' +
             v.lignes.map((l, i) =>
               '<div class="grid g3 cv-l" data-i="' + i + '" style="margin-top:6px">' +
               '<input type="text" data-k="nom" value="' + esc(l.nom || '') + '" placeholder="Ex. Coupe classique">' +
               '<input type="number" data-k="g" min="0" step="1" inputmode="numeric" value="' + esc(l.g || '') + '" placeholder="g">' +
               '<input type="number" data-k="q" min="0" step="1" inputmode="numeric" value="' + esc(l.q || '') + '" placeholder="0"></div>').join('') +
             '<button type="button" class="btn clair bloc" id="cv-plus" style="margin-top:10px">Ajouter un produit</button>'
           : v.mode === 'total'
           ? '<div class="champ"><label class="f">Poids de glace vendu (kg)</label>' +
             '<input type="number" id="cv-kg" min="0" step="0.01" inputmode="decimal" value="' + (v.kg || '') + '" placeholder="0"></div>'
           : '<button type="button" class="btn ciel bloc xl" id="cv-imp">Choisir l’export de caisse (Excel ou CSV)</button>' +
             '<input type="file" id="cv-fichier" accept=".xlsx,.xls,.csv,.txt,text/csv" hidden>' +
             '<p class="mini" id="cv-lu" style="margin-top:10px">' +
               (v.fichier ? esc(v.fichier) + ' · ' + esc(v.methode || '') + ' · ' + kgTxt(v.kg) : 'Aucun fichier lu.') + '</p>') +
         '</div>' +
         '<p class="mini" id="cv-total" style="margin-top:12px"></p>' +
         '<div class="actions"><button class="btn clair" id="cv-ret">Retour</button>' +
         '<button class="btn menthe" id="cv-suiv">Voir le résultat</button></div>');

       const lireLignes = () => {
         if (v.mode !== 'produits') return;
         v.lignes = $$('#cv-corps .cv-l').map(r => ({
           nom:$('[data-k="nom"]', r).value.trim(),
           g:Math.max(0, num($('[data-k="g"]', r).value)) || '',
           q:Math.max(0, num($('[data-k="q"]', r).value)) || ''
         }));
       };
       const calcule = () => {
         if (v.mode === 'produits') v.kg = v.lignes.reduce((t, l) => t + num(l.g) * num(l.q), 0) / 1000;
         else if (v.mode === 'total') v.kg = Math.max(0, num($('#cv-kg').value));
         const sansG = v.mode === 'produits' ? v.lignes.filter(l => num(l.q) > 0 && !(num(l.g) > 0)).length : 0;
         $('#cv-total').textContent = 'Vendu : ' + kgTxt(v.kg) +
           (sansG ? ' · ' + sansG + ' produit(s) vendu(s) sans grammage, non comptés' : '');
       };
       $$('#cv-corps input').forEach(i => i.oninput = () => { lireLignes(); calcule(); });
       calcule();
       $$('#cv-mode .chip').forEach(bt => bt.onclick = () => {
         lireLignes();
         if (v.mode === 'total') v.kg = Math.max(0, num($('#cv-kg').value));
         v.mode = bt.dataset.m;
         if (v.mode !== 'fichier') { delete v.fichier; delete v.methode; }
         eD();
       });
       if ($('#cv-plus')) $('#cv-plus').onclick = () => { lireLignes(); v.lignes.push({ nom:'', g:'', q:'' }); eD(); };
       if ($('#cv-imp')) {
         $('#cv-imp').onclick = () => $('#cv-fichier').click();
         $('#cv-fichier').onchange = async ev => {
           const f = ev.target.files && ev.target.files[0];
           ev.target.value = '';
           if (!f) return;
           $('#cv-lu').textContent = 'Analyse du fichier…';
           if (!(await chargerXLSX())) { $('#cv-lu').textContent = 'Aucun fichier lu.'; return toast('Lecture des fichiers de caisse indisponible : réessayez avec le réseau', 'erreur'); }
           let r;
           try { r = await lireExportCaisse(f); }
           catch (err) { $('#cv-lu').textContent = 'Aucun fichier lu.'; return toast(err && err.message ? err.message : 'Fichier illisible', 'erreur'); }
           if (!$('#cv-lu')) return;   // feuille fermée entre-temps
           v.kg = +num(r.kg).toFixed(3);
           v.fichier = f.name;
           v.methode = r.methode + (r.fiable ? '' : ' · approximatif') +
             (r.inconnus && r.inconnus.length ? ' · ' + r.inconnus.length + ' SKU sans grammage' : '');
           $('#cv-lu').textContent = v.fichier + ' · ' + v.methode + ' · ' + kgTxt(v.kg);
           calcule();
         };
       }
       $('#cv-ret').onclick = () => { lireLignes(); calcule(); eC(); };
       $('#cv-suiv').onclick = async () => {
         lireLignes(); calcule();
         if (v.mode === 'fichier' && !v.fichier) { toast('Choisissez le fichier de la caisse', 'erreur'); return; }
         if (!(v.kg > 0)) { toast('Aucune vente saisie : le résultat n’aurait pas de sens', 'erreur'); return; }
         await brouillon();
         eE();
       };
     };

     const eE = async () => {
       /* Livraisons relues : une autre a pu être ajoutée sur un autre iPad. */
       const frais = (await DB.get(c.id, null)) || c;
       if (frais.statut !== 'ouvert') { closeSheet(); toast('Ce calcul vient d’être clôturé ou supprimé', 'erreur'); rendre('calcul'); return; }
       const livs = livraisonsDe(frais);
       w.livraisons = livs.slice();
       const horsPeriode = livs.filter(x => x.date && (x.date < debutFlux(c) || x.date > w.fin));
       const fini = Object.assign({}, frais, {
         statut:'clos', fin:w.fin, livraisonsArretees:livs.map(x => x.id),
         arrivee:{ zones:w.zones, kg:+kgZones(w.zones, poidsLitre(c)).toFixed(3) },
         pertes:{ litres:w.perteL, kgSaisis:w.perteKg,
                  kg:+(kgDeLitres(w.perteL, poidsLitre(c)) + num(w.perteKg)).toFixed(3), source:w.perteSource },
         ventes:ventesAEnregistrer(w.ventes)
       });
       const r = resultatCalcul(fini);
       showSheet(
         '<h2 id="sheet-titre">Résultat</h2>' +
         '<p class="sub">' + (c.essai ? 'Essai · ' : '') + esc(fmtD(c.debut)) + ' → ' + esc(fmtD(w.fin)) + '</p>' +
         blocResultat(r) +
         (horsPeriode.length ? '<div class="alerte warn" style="margin-top:12px"><span class="ai">●</span><div>' +
           '<b>' + horsPeriode.length + ' livraison(s) datée(s) hors de la période</b><p>' +
           esc(horsPeriode.map(x => (x.numero || 'sans numéro') + ' du ' + fmtDC(x.date)).join(', ')) +
           '. Elles sont comptées : retirez-les à l’étape 1 si elles n’ont rien à faire ici.</p></div></div>' : '') +
         (STATE.enLigne ? '' : '<div class="alerte warn" style="margin-top:12px"><span class="ai">●</span><div>' +
           '<b>iPad hors ligne</b><p>La clôture partira au retour du réseau. Vérifiez que personne ne clôture ' +
           'ce calcul sur un autre iPad entre-temps.</p></div></div>') +
         '<div class="actions"><button class="btn clair" id="ce-ret">Retour</button>' +
         '<button class="btn menthe" id="ce-ok">Valider la clôture</button></div>');
       $('#ce-ret').onclick = eD;
       let enCours = false;
       $('#ce-ok').onclick = async () => {
         if (enCours) return;
         enCours = true;
         try {
           const actuel = await DB.get(c.id, null);
           if (actuel && actuel.statut !== 'ouvert') { closeSheet(); toast('Ce calcul vient d’être clôturé ou supprimé', 'erreur'); rendre('calcul'); return; }
           /* Livraison ajoutée ou retirée sur un autre iPad depuis l'affichage
              du résultat : on recalcule et on le remontre avant de clôturer. */
           const ids = l => l.map(x => x.id).sort().join('|');
           if (actuel && ids(livraisonsDe(actuel)) !== ids(livs)) {
             toast('Les livraisons ont changé sur un autre iPad : résultat recalculé', 'erreur');
             return eE();
           }
           await DB.patch(c.id, {
             statut:'clos', fin:fini.fin, livraisonsArretees:fini.livraisonsArretees, arrivee:fini.arrivee,
             pertes:fini.pertes, ventes:fini.ventes,
             resultat:{ theo:+r.theo.toFixed(3), reel:+r.reel.toFixed(3), ecart:+r.ecart.toFixed(3), pct:+r.pct.toFixed(2),
                        incoherent:r.incoherent },
             brouillon:null, closPar:STATE.user.prenom, closAt:nowISO()
           });
           if (w.ventes.mode === 'produits') await retenirProduits(w.ventes.lignes);
           await feed(r.incoherent || etatEcart(r.pct).c === 'bad' ? 'bad' : 'ok', STATE.user.prenom + ' a clôturé ' +
             (c.essai ? 'un essai de calcul' : 'le calcul d’écart') + ' du ' + fmtDC(c.debut) + ' au ' + fmtDC(w.fin) +
             ' : ' + (r.ecart >= 0 ? '+' : '−') + kgTxt(Math.abs(r.ecart)) + ' (' + pctTxt(r) + ')');
           if (c.essai) { closeSheet(); toast('Essai clôturé'); rendre('calcul'); return; }
           showSheet(
             '<h2 id="sheet-titre">Calcul clôturé</h2>' +
             '<p class="sub">Le stock compté aujourd’hui peut servir de départ au calcul suivant.</p>' +
             '<div class="actions"><button class="btn clair" id="cs-non">Plus tard</button>' +
             '<button class="btn menthe" id="cs-oui">Démarrer le suivant</button></div>');
           $('#cs-non').onclick = () => { closeSheet(); rendre('calcul'); };
           $('#cs-oui').onclick = () => { rendre('calcul'); demarrerCalcul(); };
         } finally { enCours = false; }
       };
     };

     eA();
   }

   function texteDates(a, b) {
     if (a > b) return 'de la période (aucun jour après le comptage de départ)';
     return a === b ? 'du ' + fmtD(a) : 'du ' + fmtD(a) + ' au ' + fmtD(b);
   }

   function ventesAEnregistrer(v) {
     const o = { mode:v.mode, kg:+num(v.kg).toFixed(3) };
     if (v.mode === 'produits') o.lignes = (v.lignes || []).filter(l => l.nom || num(l.q) > 0)
       .map(l => ({ nom:l.nom, g:num(l.g), q:num(l.q) }));
     if (v.mode === 'fichier') { o.fichier = v.fichier || ''; o.methode = v.methode || ''; }
     o.source = v.mode === 'produits' ? 'Saisie par produit' : v.mode === 'total' ? 'Total saisi' : 'Fichier de caisse';
     return o;
   }

   async function retenirProduits(lignes) {
     const vus = {};
     const cat = (lignes || []).filter(l => l.nom && num(l.g) > 0)
       .filter(l => { const k = l.nom.toLowerCase(); if (vus[k]) return false; vus[k] = 1; return true; })
       .map(l => ({ nom:l.nom, g:num(l.g) }));
     if (cat.length) await DB.set(CALCUL.cleProduits, cat);
   }

   function blocResultat(r) {
     const st = r.incoherent ? { c:'bad', t:'Calcul incohérent' } : etatEcart(r.pct);
     const signe = Math.abs(r.ecart) < 0.05 ? '' : r.ecart > 0 ? '+' : '−';
     return '<div class="dense"><div class="dense-h"><span class="c1">Calcul</span><span class="c w">Poids</span></div>' +
       [['Stock de départ', r.debut, ''], ['+ Livré (' + n1(r.livreL) + ' L)', r.livre, ''],
        ['− Pertes', r.perte, ''], ['− Vendu', r.vendu, ''], ['= Stock théorique', r.theo, 'b'],
        ['Stock réel compté', r.reel, 'b']].map(x =>
         '<div class="dl"><span class="c1">' + (x[2] ? '<b>' + esc(x[0]) + '</b>' : esc(x[0])) + '</span>' +
         '<span class="c w num">' + kgTxt(x[1]) + '</span></div>').join('') + '</div>' +
       '<div class="grid g2" style="margin-top:14px">' +
       kpi('Écart', signe + n1(Math.abs(r.ecart)) + '<span class="u">kg</span>', st.c,
           st.t + (r.incoherent ? '' : ' · ' + pctTxt(r))) +
       kpi('Coût', eur(Math.abs(r.ecart) < 0.05 ? 0 : r.valeur), st.c, 'à ' + eur(FOURNISSEUR.prixMoyenKg) + '/kg') + '</div>' +
       (r.incoherent ? '<div class="alerte bad" style="margin-top:12px"><span class="ai">▲</span><div>' +
         '<b>Stock théorique nul ou négatif</b><p>Il a été vendu ou jeté plus que le départ et les livraisons : ' +
         'une saisie est fausse (ventes, livraisons ou stock de départ).</p></div></div>' : '') +
       '<p class="mini" style="margin-top:10px">Écart négatif : il manque de la glace par rapport au calcul. ' +
         'Objectif ±' + SEUILS.ecartGlacePct + ' %.</p>';
   }

   function voirCalcul(c) {
     if (!c) return;
     const r = resultatCalcul(c);
     const v = c.ventes || {};
     showSheet(
       '<h2 id="sheet-titre">' + (c.essai ? 'Essai · ' : '') + esc(fmtD(c.debut)) + ' → ' + esc(fmtD(c.fin)) + '</h2>' +
       '<p class="sub">Démarré par ' + esc(c.par || '?') + ', clôturé par ' + esc(c.closPar || '?') + '</p>' +
       blocResultat(r) +
       '<p class="mini" style="margin-top:14px"><b>Départ</b> : ' +
         (c.depart && c.depart.source === 'precedent' ? 'clôture du calcul précédent' : 'comptage') + '. ' +
       '<b>Pertes</b> : ' + kgTxt(num(c.pertes && c.pertes.kg)) + ' (' + esc((c.pertes && c.pertes.source) || '') + '). ' +
       '<b>Ventes</b> : ' + esc(v.source || '') + (v.fichier ? ' · ' + esc(v.fichier) : '') + '.</p>' +
       (v.lignes && v.lignes.length
         ? '<div class="dense" style="margin-top:10px"><div class="dense-h"><span class="c1">Produit</span>' +
           '<span class="c w">Qté</span><span class="c w">Poids</span></div>' + v.lignes.map(l =>
           '<div class="dl"><span class="c1">' + esc(l.nom || '?') + ' · ' + num(l.g) + ' g</span>' +
           '<span class="c w num">' + num(l.q) + '</span><span class="c w num">' + kgTxt(num(l.g) * num(l.q) / 1000) + '</span></div>').join('') + '</div>'
         : '') +
       (livraisonsDe(c).length ? '<p class="mini" style="margin-top:14px"><b>Livraisons</b></p>' + listeLivraisons(livraisonsDe(c), false) : '') +
       '<div class="actions"><button class="btn clair" data-fermer>Fermer</button>' +
       (c.essai ? '<button class="btn corail" id="cv-sup">Supprimer l’essai</button>' : '') + '</div>');
     if ($('#cv-sup')) $('#cv-sup').onclick = () => confirmer('Supprimer cet essai ?',
       'Essai du ' + fmtD(c.debut) + ' au ' + fmtD(c.fin) + '.', 'Supprimer', async () => {
         await DB.patch(c.id, { statut:'supprime', suppPar:STATE.user.prenom, suppAt:nowISO() });
         rendre('calcul');
       });
   }

   /* L'écran Écarts mène au calcul guidé. */
   (function () {
     const ancien = V.ecarts;
     if (typeof ancien !== 'function') return;
     V.ecarts = async function () {
       await ancien.apply(this, arguments);
       const a = $('#vue-actions');
       if (STATE.view !== 'ecarts' || !a || $('#cg-ouvrir')) return;
       a.insertAdjacentHTML('afterbegin', '<button class="btn sm" id="cg-ouvrir">Calcul guidé</button>');
       $('#cg-ouvrir').onclick = () => rendre('calcul');
     };
   })();
