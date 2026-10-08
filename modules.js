/* =============================================================================
   PILOT-SHOP — modules.js
   Chargé APRÈS app.js : redéfinit certaines vues et en ajoute de nouvelles.
   Contient les cinq lots de la réunion d'équipe.
   ============================================================================= */

   'use strict';

   /* =============================================================================
      A. NAVIGATION — nouvelles entrées
      ========================================================================== */
   PAGES.reception  = { titre:'Réception',   sous:'Livraison, DLC et stock fermé' };
PAGES.stock      = { titre:'Stock réel', sous:'Ce qui reste en chambre froide' };
PAGES.inventaire = { titre:'Faire l’inventaire', sous:'Compter ce qui est physiquement là' };
PAGES.catalogue  = { titre:'Catalogue du sec', sous:'Ce que l’inventaire propose' };
PAGES.parametres = { titre:'Back-office', sous:'Tâches, horaires et unités froides' };
PAGES.hebdo      = { titre:'Tâches du jour', sous:'Plan hebdomadaire de la boutique' };
PAGES.lots.titre = 'Traçabilité';
PAGES.lots.sous  = 'Ouverture de tout nouveau produit';
   
   if (MENU_PLUS.equipe.indexOf('reception') < 0)  MENU_PLUS.equipe.splice(2, 0, 'reception', 'stock', 'inventaire');
if (MENU_PLUS.manager.indexOf('reception') < 0) MENU_PLUS.manager.splice(2, 0, 'reception', 'stock', 'inventaire');
/* L'ancien écran « Glace et sec » faisait doublon avec « Faire l'inventaire »,
   dans une autre table : un comptage fait dans l'un n'alimentait pas l'autre,
   et rien ne disait lequel choisir. On le retire du menu ; ses données restent
   en base pour l'historique. */
['equipe', 'manager'].forEach(r => {
  const i = MENU_PLUS[r].indexOf('inv');
  if (i >= 0) MENU_PLUS[r].splice(i, 1);
});
/* Le manager n'avait aucun accès à l'écran Anomalie : ni dans sa barre, ni dans
   son menu. Les signalements de l'équipe étaient donc enregistrés sans que
   personne ne puisse les consulter ni les marquer traités. */
if (MENU_PLUS.manager.indexOf('anomalie') < 0) MENU_PLUS.manager.unshift('anomalie');
/* Le catalogue du sec est modifiable par le manager depuis l'application :
   retirer une référence, en ajouter, changer une unité. Sans passer par le code. */
if (MENU_PLUS.manager.indexOf('catalogue') < 0) {
  const i = MENU_PLUS.manager.indexOf('inventaire');
  MENU_PLUS.manager.splice(i >= 0 ? i + 1 : MENU_PLUS.manager.length, 0, 'catalogue');
}
if (MENU_PLUS.manager.indexOf('parametres') < 0) MENU_PLUS.manager.push('parametres');
/* Les tâches hebdomadaires méritent leur onglet : c'est le tableau que l'équipe
   consultait au mur, consulté plusieurs fois par jour. */
if (MENU_PLUS.equipe.indexOf('hebdo') < 0)  MENU_PLUS.equipe.unshift('hebdo');
if (MENU_PLUS.manager.indexOf('hebdo') < 0) MENU_PLUS.manager.unshift('hebdo');
   
   /* =============================================================================
      B. PHOTO DE PREUVE
      Compression agressive : une preuve de nettoyage n'a pas besoin d'être nette,
      elle doit tenir dans le quota du navigateur. 640 px / qualité 0,45 ≈ 40 Ko.
      ========================================================================== */
   function prendrePhoto() {
     return new Promise(resolve => {
       const cam = document.getElementById('cam');
       cam.value = '';
       cam.onchange = async () => {
         const f = cam.files && cam.files[0];
         if (!f) return resolve(null);
         try {
           const { canvas } = await chargerImage(f, PREUVE.cotePx);
           const url = canvas.toDataURL('image/jpeg', PREUVE.qualite);
           canvas.width = 0; canvas.height = 0;
           resolve({ img:url, at:nowISO(), par:STATE.user.prenom, poids:Math.round(url.length * 0.75 / 1024) });
         } catch (e) { toast('Photo illisible', 'erreur'); resolve(null); }
       };
       cam.click();
     });
   }
   
   async function attacherPreuve(jour, cleTache, libelle) {
     const p = await prendrePhoto();
     if (!p) return null;
     const cle = 'preuves:' + jour;
     const l = await DB.get(cle, []);

     /* Le plafond au NOMBRE ne protégeait pas : douze photos de 82 Ko font
        984 Ko, au-dessus du seuil de 879 Ko au-delà duquel une clé cesse d'être
        envoyée à Supabase. La journée entraînait alors sa propre disparition,
        en silence. Mesuré le 14 septembre : 511 Ko pour neuf photos, il n'en
        restait que six avant blocage.
        On borne donc au poids, avec une marge sous le seuil. */
     const POIDS_MAX = Math.round(OFFLINE.tailleMaxOctets * 0.65);   // ~570 Ko
     const poidsActuel = JSON.stringify(l).length;
     const poidsNouvelle = (p.img || '').length;

     if (poidsActuel + poidsNouvelle > POIDS_MAX) {
       toast('Trop de photos aujourd’hui — celle-ci ne peut pas être ajoutée', 'erreur');
       await feed('warn', 'Photo refusée : la journée atteint ' +
         Math.round(poidsActuel / 1024) + ' Ko. Supprimez-en une pour en reprendre.');
       return null;
     }
     if (l.filter(x => !x.supprime).length >= PREUVE.maxParJour) {
       toast('Maximum de ' + PREUVE.maxParJour + ' photos par jour atteint', 'erreur');
       return null;
     }

     l.push(Object.assign({ id:uid(), tache:cleTache, libelle:libelle }, p));
     await DB.set(cle, l);
     await feed('ok', STATE.user.prenom + ' a photographié : ' + libelle);
     return p;
   }

   /* -----------------------------------------------------------------------------
      VOIR ET SUPPRIMER UNE PREUVE
      Une vignette de 58 px ne permet pas de vérifier qu'on a bien cadré le joint
      ou le fond du bac. Et une photo ratée — floue, dans le vide, prise par
      erreur — restait dans le registre sans moyen de la retirer.
      -------------------------------------------------------------------------- */
   function voirPreuve(jour, idPreuve, apresSuppression, lectureSeule) {
     (async function () {
       const cle = 'preuves:' + jour;
       const l = await DB.get(cle, []);
       const p = l.filter(x => x.id === idPreuve && !x.supprime)[0];
       if (!p) return toast('Photo introuvable', 'erreur');

       showSheet(
         '<h2 id="sheet-titre">' + esc(p.libelle || 'Photo') + '</h2>' +
         '<p class="cs">' + esc(p.par || '—') + ' · ' + fmtD(jour) +
         (p.at ? ' à ' + heure(p.at) : '') + '</p>' +
         '<img src="' + esc(p.img) + '" alt="" class="preuve-plein">' +
         '<div class="actions">' +
         '<button class="btn clair" data-fermer>Fermer</button>' +
         /* Jour en consultation seule : on regarde, on ne supprime pas. */
         (lectureSeule ? '' : '<button class="btn corail" id="pv-suppr">Supprimer</button>') + '</div>');

       if (lectureSeule) return;
       $('#pv-suppr').onclick = () => {
         confirmer('Supprimer cette photo ?',
           'Elle ne servira plus de preuve pour « ' + (p.libelle || 'cette tâche') + ' ». ' +
           'La tâche reste cochée, mais si la photo était obligatoire il faudra ' +
           'en reprendre une.',
           'Supprimer', async () => {
             const l2 = await DB.get(cle, []);
             /* Marquée, pas retirée : la liste est réunie avec celle du
                serveur, une ligne retirée reviendrait. La photo elle-même est
                effacée pour libérer la place. */
             await DB.set(cle, l2.map(x => x.id === idPreuve
               ? Object.assign({}, x, { supprime:{ par:STATE.user.prenom, at:nowISO() }, img:'' }) : x));
             await feed('warn', STATE.user.prenom + ' a supprimé une photo : ' +
               (p.libelle || 'sans libellé'));
             closeSheet();
             toast('Photo supprimée');
             if (typeof apresSuppression === 'function') apresSuppression();
           });
       };
     })();
   }

   /* Vignettes cliquables, factorisées : quatre écrans les affichaient chacun
      à sa façon, et aucun ne permettait de les ouvrir. */
   function vignettes(liste, jour) {
     if (!liste || !liste.length) return '';
     return '<div class="rang vignettes">' + liste.map(p =>
       '<button type="button" class="vign" data-vign="' + esc(p.id) + '" ' +
       'data-vjour="' + esc(jour) + '" aria-label="Voir la photo">' +
       '<img src="' + esc(p.img) + '" alt=""></button>').join('') + '</div>';
   }

   /* À appeler après chaque rendu qui contient des vignettes. */
   function brancherVignettes(revenir, lectureSeule) {
     $$('[data-vign]').forEach(b => b.onclick = () =>
       voirPreuve(b.dataset.vjour, b.dataset.vign, revenir, lectureSeule));
   }
   
   /* =============================================================================
      C. STOCK FERMÉ / OUVERT
      Réception → stock fermé. Ouverture → sortie du stock fermé, entrée en
      produits ouverts. Le croisement des deux donne les alertes DLC.
      ========================================================================== */
   async function stockFerme() {
     /* La réception n'écrit plus « stock:ferme » mais le journal du stock : la
        liste restait à « 0 article(s) » et les alertes DLC ne partaient jamais.
        Ce qui reste fermé se déduit maintenant du journal (stock.js). */
     if (typeof stockFermeJournal === 'function') {
       try { return await stockFermeJournal(); } catch (e) { return []; }
     }
     const l = await DB.get('stock:ferme', []);
     return l.filter(x => !x.ouvert && !x.jete);
   }
   
   async function alertesDLC() {
     const ferme = await stockFerme();
     const out = [];
     for (const a of ferme) {
       if (!a.dlc) continue;
       const reste = Math.round((new Date(a.dlc + 'T12:00:00') - new Date(today() + 'T12:00:00')) / 864e5);
       if (reste > STOCK.alerteDlcJours) continue;
       out.push(Object.assign({}, a, {
         reste: reste,
         niveau: reste < 0 ? 'rouge' : reste <= STOCK.alerteCritiqueJours ? 'orange' : 'jaune'
       }));
     }
     return out.sort((x, y) => x.reste - y.reste);
   }
   
   async function ouvrirArticle(id, lot) {
     const l = await DB.get('stock:ferme', []);
     const a = l.filter(x => x.id === id)[0];
     if (!a) return null;
     a.ouvert = true; a.ouvertLe = today(); a.ouvertPar = STATE.user.prenom;
     a.lotOuverture = lot || a.lot || '';
     a.qte = Math.max(0, num(a.qte) - 1);
     if (a.qte > 0) {                       // il reste des unités fermées du même lot
       l.push(Object.assign({}, a, { id:uid(), ouvert:false, qte:a.qte, ouvertLe:null, ouvertPar:null }));
       a.qte = 1;
     }
     await DB.set('stock:ferme', l);
     await feed('ok', STATE.user.prenom + ' a ouvert ' + a.produit + ' (lot ' + a.lotOuverture + ')');
     return a;
   }
   
   /* =============================================================================
      D. RÉCEPTION DE LIVRAISON
      ========================================================================== */
   V.reception = async function () {
     const j = STATE.jour;
     const recus = (await DB.get('reception:' + j, []));
     const ferme = await stockFerme();
   
     $('#page').innerHTML =
       carte(entete('🚚', 'Réception d’une livraison',
         'Deux scans : le bon de livraison, puis la DLC de chaque produit entrant.') +
         '<button class="btn ciel bloc xl" id="scan-bl">1. Scanner le bon de livraison</button>' +
         '<button class="btn clair bloc" id="saisie-bl" style="margin-top:10px">Saisir sans scanner</button>', 'ciel') +
   
       (recus.length
         ? '<div class="entete"><h3>Reçu aujourd’hui</h3></div><div class="stack">' + recus.map(r =>
             carte('<div class="rang">' +
               '<div style="flex:1;min-width:0"><b>' + esc(r.fournisseur) + ' · ' + esc(r.numero) + '</b>' +
               '<div class="mini">' + r.lignes.length + ' référence(s) · sonde ' + (r.temp === '' ? '—' : r.temp + ' °C') +
               ' · ' + esc(r.par) + ' à ' + heure(r.at) + '</div></div>' +
               pastille(r.refuse ? 'bad' : 'ok', r.refuse ? 'Refusée' : 'Conforme') + '</div>',
               r.refuse ? 'corail' : 'menthe')).join('') + '</div>'
         : '') +
   
       '<div class="entete"><h3>Stock fermé</h3><span class="pousse mini num">' + ferme.length + ' article(s)</span></div>' +
       (ferme.length
         ? '<div class="dense"><div class="dense-h"><span class="c1">Produit</span>' +
           '<span class="c w">Qté</span><span class="c ww">DLC</span></div><div class="dense-scroll">' +
           ferme.slice().sort((a, b) => String(a.dlc).localeCompare(String(b.dlc))).map(a =>
             '<div class="dl"><span class="c1">' + esc(a.produit) + (a.lot ? ' · ' + esc(a.lot) : '') + '</span>' +
             '<span class="c w num">' + a.qte + ' ' + esc(a.unite || '') + '</span>' +
             '<span class="c ww">' + (a.dlc ? fmtDC(a.dlc) : '—') + '</span></div>').join('') + '</div></div>'
         : vide('📦', 'Aucun article en stock fermé.'));
   
     $('#scan-bl').onclick = async () => {
       const r = await scannerPhoto('bl');
       if (!r) return;
       formulaireReception({ fournisseur:r.fournisseur || FOURNISSEUR.nom, numero:r.numero || r.lot || '', lignes:r.lignes || [] });
     };
     $('#saisie-bl').onclick = () => formulaireReception({ fournisseur:FOURNISSEUR.nom, numero:'', lignes:[] });
   
     function formulaireReception(bl) {
       showSheet(
         '<h2 id="sheet-titre">Contrôle à réception</h2>' +
         '<p class="sub">Ce contrôle est exigé par la fiche de traçabilité. Il conditionne l’acceptation.</p>' +
         '<div class="grid g2">' +
         '<div class="champ"><label class="f">Fournisseur</label><input type="text" id="rc-f" value="' + esc(bl.fournisseur) + '"></div>' +
         '<div class="champ"><label class="f">N° de bon</label><input type="text" id="rc-n" value="' + esc(bl.numero) + '"></div></div>' +
         '<div class="champ" style="margin-top:14px"><label class="f">Température du produit sondé (°C)</label>' +
         '<input type="number" step="0.1" id="rc-t" placeholder="Ex. −18"></div>' +
         '<div style="margin-top:14px"><label class="f">Conformités</label><div class="chips" id="rc-c">' +
         RECEPTION.conformites.map(c => '<button type="button" class="chip menthe on" data-c="' + c.id + '">✅ ' + esc(c.label) + '</button>').join('') +
         '</div></div>' +
         '<div id="rc-alerte"></div>' +
         '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
         '<button class="btn menthe" id="rc-ok">Saisir les produits</button></div>');
   
       const conf = {}; RECEPTION.conformites.forEach(c => conf[c.id] = true);
       $$('#rc-c [data-c]').forEach(b => b.onclick = () => {
         const on = !b.classList.contains('on');
         b.classList.toggle('on', on);
         b.textContent = (on ? '✅ ' : '❌ ') + RECEPTION.conformites.filter(x => x.id === b.dataset.c)[0].label;
         conf[b.dataset.c] = on;
         controle();
       });
       $('#rc-t').oninput = controle;
   
       function controle() {
         const t = $('#rc-t').value;
         const tropChaud = t !== '' && num(t) > RECEPTION.tempMax;
         const nonConf = Object.keys(conf).filter(k => !conf[k]);
         $('#rc-alerte').innerHTML = (tropChaud || nonConf.length)
           ? '<div class="alerte bad" style="margin-top:14px"><span class="ai">▲</span><div><b>Livraison à refuser</b>' +
             '<p>' + (tropChaud ? 'Produit relevé à ' + t + ' °C, au-dessus de ' + RECEPTION.tempMax + ' °C. ' : '') +
             (nonConf.length ? nonConf.length + ' point(s) de conformité non validés. ' : '') +
             'Notez le motif et prévenez le manager.</p></div></div>'
           : '';
       }
   
       $('#rc-ok').onclick = () => {
         const t = $('#rc-t').value;
         const refuse = (t !== '' && num(t) > RECEPTION.tempMax) || Object.keys(conf).some(k => !conf[k]);
         lignesReception({ fournisseur:$('#rc-f').value.trim(), numero:$('#rc-n').value.trim(),
                           temp:t, conf:conf, refuse:refuse, lignes:bl.lignes });
       };
     }
   
     /* Saveur de fam.saveurs reconnue dans un libellé de bon de livraison.
        D'abord la saveur entière contenue dans le libellé, sinon un mot du
        libellé qui partage ses cinq premières lettres avec la saveur. */
     function saveurDepuisLibelle(saveurs, libelle) {
       const nrm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z]/g,'');
       const tout = nrm(libelle);
       if (!tout) return null;
       const exact = saveurs.filter(sv => nrm(sv) && tout.indexOf(nrm(sv)) >= 0)
         .sort((a, b) => nrm(b).length - nrm(a).length)[0];
       if (exact) return exact;
       const mots = String(libelle).split(/[\s,;:\/\-]+/).map(nrm).filter(m => m.length >= 5);
       return saveurs.filter(sv => {
         const a = nrm(sv);
         return a.length >= 5 && mots.some(m => m.slice(0,5) === a.slice(0,5));
       })[0] || null;
     }

     function lignesReception(bl) {
       const lignes = (bl.lignes || []).map(l => ({
         produit:l.parfum || l.ref || '', qte:l.bacs || 1, unite:'bac', lot:'', dlc:''
       }));
       if (!lignes.length) lignes.push({ produit:'', qte:1, unite:'bac', lot:'', dlc:'' });
   
       /* showSheet et non #sheet-corps : le scan d'une DLC remplace la feuille
          par celle du cadrage puis la ferme. Réécrite dans une feuille fermée,
          la réception en cours (bon, conformités, lignes) disparaissait. */
       const rendre2 = () => {
         showSheet(
           '<h2 id="sheet-titre">Produits entrants</h2>' +
           '<p class="sub">' + esc(bl.fournisseur) + ' · ' + esc(bl.numero) +
           (bl.refuse ? ' · <b style="color:var(--corail-d)">livraison refusée</b>' : '') + '</p>' +
           '<div class="stack">' + lignes.map((l, i) =>
             '<div class="card plat"><div class="champ"><label class="f">Produit</label>' +
             '<input type="text" data-r="' + i + '.produit" value="' + esc(l.produit) + '" placeholder="Ex. Gelato pistache"></div>' +
             '<div class="grid g3" style="margin-top:10px">' +
             '<div class="champ"><label class="f">Quantité</label><input type="number" min="1" data-r="' + i + '.qte" value="' + l.qte + '"></div>' +
             '<div class="champ"><label class="f">Unité</label><select data-r="' + i + '.unite">' +
             STOCK.unites.map(u => '<option' + (u === l.unite ? ' selected' : '') + '>' + u + '</option>').join('') + '</select></div>' +
             '<div class="champ"><label class="f">N° de lot</label><input type="text" data-r="' + i + '.lot" value="' + esc(l.lot) + '"></div></div>' +
             '<div class="champ" style="margin-top:10px"><label class="f">DLC / DLUO</label>' +
             '<input type="date" data-r="' + i + '.dlc" value="' + l.dlc + '"></div>' +
             '<button class="btn clair sm bloc" data-scandlc="' + i + '" style="margin-top:10px">Scanner la DLC</button>' +
             '</div>').join('') + '</div>' +
           '<button class="btn clair bloc" id="rl-plus" style="margin-top:12px">+ Ajouter un produit</button>' +
           '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
           '<button class="btn menthe" id="rl-ok">Enregistrer la réception</button></div>');
         /* showSheet tient tout contenu pour neuf : sans cette ligne, un
            toucher du voile jetait sans confirmation le bon, la température,
            les conformités et les lignes déjà saisis. À cette étape, il y a
            toujours une saisie à perdre : celle de l'étape 1. */
         _feuilleModifiee = true;

         $$('[data-r]').forEach(inp => inp.oninput = () => {
           const [i, k] = inp.dataset.r.split('.');
           lignes[+i][k] = inp.value;
         });
         $$('[data-scandlc]').forEach(b => b.onclick = async () => {
           const i = +b.dataset.scandlc;
           const r = await scannerPhoto('etiquette');
           if (!r) return rendre2();          // scan annulé : la réception revient telle quelle
           /* La lecture « code » ne garde que chiffres et majuscules : « 15/11/2026 »
              revient « 15112026 », et l'expression jj/mm/aaaa ne trouvait jamais
              rien. extraireCarton lit les deux formes et retient l'expiration. */
           const c = (typeof extraireCarton === 'function') ? extraireCarton(r.texte || '') : null;
           const dlc = (c && c.expiration) || r.dluo || '';
           if (dlc) lignes[i].dlc = dlc;
           if (r.lot) lignes[i].lot = r.lot;
           if (r.parfum && !lignes[i].produit) lignes[i].produit = r.parfum;
           if (dlc) toast('DLC lue : ' + fmtD(dlc) + ' — vérifiez-la sur l’étiquette');
           else toast('Aucune date lisible — saisissez-la à la main', 'erreur');
           rendre2();
         });
         $('#rl-plus').onclick = () => { lignes.push({ produit:'', qte:1, unite:'bac', lot:'', dlc:'' }); rendre2(); };
         $('#rl-ok').onclick = enregistrer;
       };
   
       let enCours = false;
       async function enregistrer() {
         /* Double appui : une seule réception à la fois. */
         if (enCours) return;
         enCours = true;
         try { await enregistrer1(); } finally { enCours = false; }
       }
       async function enregistrer1() {
         const valides = lignes.filter(l => l.produit.trim());
         if (!valides.length) return toast('Saisissez au moins un produit', 'erreur');
         const sansDlc = valides.filter(l => !l.dlc).length;
         if (sansDlc) return toast(sansDlc + ' produit(s) sans DLC — elle est obligatoire', 'erreur');
   
         const rec = { id:uid(), fournisseur:bl.fournisseur, numero:bl.numero, temp:bl.temp,
                       conf:bl.conf, refuse:bl.refuse, lignes:valides,
                       par:STATE.user.prenom, at:nowISO(), jour:today() };
         await DB.push('reception:' + today(), rec);
   
         if (!bl.refuse) {
        /* La réception incrémente le stock réel. C'est le seul enregistrement :
           l'ancien « stock fermé » tenait une comptabilité parallèle que les
           ouvertures ne décrémentaient pas — elle dérivait en silence. */
        for (const l of valides) {
          const fam = devinerFamille(l.produit);
          /* Même clé que l'ouverture : « Gelato pistache 3 litres » doit
             alimenter glace|Pistache|3, pas un article fantôme en 5 L que
             l'inventaire ne compte jamais. Seules les glaces ont une taille. */
          const glace = fam.id === 'glace';
          let parfum = glace ? (parfumDepuisDesignation(l.produit) || l.produit.trim()) : l.produit.trim();
          /* Macarons, gianduiotti, coulis, toppings : la saveur est retrouvée
             dans fam.saveurs avec la même normalisation que confirmerOuverture
             (sans accent ni casse, cinq premières lettres), pour tomber sur la
             même clé « famille|Saveur| » que l'ouverture. Sans correspondance,
             on garde le libellé tel quel, comme avant. */
          if (!glace && fam.saveurs && fam.saveurs.length) {
            const sv = saveurDepuisLibelle(fam.saveurs, l.produit);
            if (sv) parfum = sv;
          }
          const cle = cleArticle(fam.id, fam.parfums ? parfum : '',
                                 glace ? (num(l.taille) || tailleDepuisDesignation(l.produit) ||
                                          FOURNISSEUR.tailleParDefaut) : '');
          await ajouterMouvement('reception', cle, num(l.qte) || 1,
            { lot:l.lot, bl:bl.numero, dlc:l.dlc, famille:fam.id });
        }
      }
         await feed(bl.refuse ? 'bad' : 'ok',
           STATE.user.prenom + (bl.refuse ? ' a REFUSÉ la livraison ' : ' a réceptionné ') + bl.numero +
           ' (' + valides.length + ' réf.)');
         closeSheet();
         toast(bl.refuse ? 'Réception refusée et tracée' : valides.length + ' produit(s) ajouté(s) au stock, DLC suivie');
         rendre('reception');
       }
   
       rendre2();
     }
   };
   
   /* =============================================================================
      E. STOCK FERMÉ — vue et alertes
      ========================================================================== */
/* V.stock : version retirée — elle était remplacée au chargement. */
   
   async function ouvertureGuidee(id) {
     const l = await DB.get('stock:ferme', []);
     const a = l.filter(x => x.id === id)[0];
     if (!a) return;
   
     showSheet(
       '<h2 id="sheet-titre">Ouvrir ' + esc(a.produit) + '</h2>' +
       '<p class="sub">Le produit sort du stock fermé et entre en traçabilité des produits ouverts.</p>' +
       '<button class="btn ciel bloc" id="og-scan">Scanner l’étiquette</button>' +
       '<div class="champ" style="margin-top:14px"><label class="f">N° de lot</label>' +
       '<input type="text" id="og-lot" value="' + esc(a.lot || '') + '" autocapitalize="characters"></div>' +
       '<div class="champ" style="margin-top:14px"><label class="f">Produit confirmé</label>' +
       '<select id="og-prod"><option value="' + esc(a.produit) + '" selected>' + esc(a.produit) + '</option>' +
       PARFUMS.filter(p => p !== a.produit).map(p => '<option>' + esc(p) + '</option>').join('') + '</select></div>' +
       '<div class="alerte info" style="margin-top:14px"><span class="ai">⏱️</span><div><b>Durée de vie après ouverture</b>' +
       '<p>' + esc(DLC_RULES[regleDLC(a.produit, 'g')].label) + ' : ' +
       Math.round(DLC_RULES[regleDLC(a.produit, 'g')].h / 24) + ' jours.</p></div></div>' +
       '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
       '<button class="btn menthe" id="og-ok">Confirmer l’ouverture</button></div>');
   
     $('#og-scan').onclick = async () => {
       const r = await scannerPhoto('etiquette');
       if (!r) return;
       if (r.lot) $('#og-lot').value = r.lot;
       if (r.parfum) { const s = $('#og-prod'); if ([...s.options].some(o => o.value === r.parfum)) s.value = r.parfum; }
     };
     $('#og-ok').onclick = async () => {
       const lot = $('#og-lot').value.trim().toUpperCase();
       if (!lot) return toast('Le numéro de lot est obligatoire', 'erreur');

       /* Le lot n'identifie pas un bac : deux bacs d'une même production portent
          souvent le même numéro, et c'est l'inventaire qui donne la quantité.
          Le vrai signal est donc le stock, pas le lot. */
       if (typeof stockInsuffisant === 'function') {
         /* Cet écran n'ouvre que des glaces, la taille est donc légitime ici. */
         const cle = cleArticle('glace', $('#og-prod').value, FOURNISSEUR.tailleParDefaut);
         const manque = await stockInsuffisant(cle).catch(() => null);
         if (manque) {
           return confirmer('Ce bac n’est plus au stock',
             'L’application n’a plus de ' + manque.article + ' en réserve' +
             (manque.reste < 0 ? ' — le compte est déjà à ' + manque.reste + '.' : '.') +
             ' Soit une ouverture précédente n’a pas été scannée, soit une livraison ' +
             'n’a pas été saisie. Confirmez si le bac est bien là.',
             'Confirmer l’ouverture', async () => { await validerOuverture(lot); });
         }
       }
       await validerOuverture(lot);
     };

     async function validerOuverture(lot) {
       a.produit = $('#og-prod').value;
       await ouvrirArticle(id, lot);
       const m = monthKey(today());
       const lots = await DB.get('lots:' + m, {});
       lots['g_' + a.produit] = { lot:lot, ouv:today(), par:STATE.user.prenom, at:nowISO() };
       await DB.set('lots:' + m, lots);
       closeSheet();
       toast(a.produit + ' ouvert et tracé');
       rendre(STATE.view === 'stock' ? 'stock' : 'lots');
     };
   }
   
   /* =============================================================================
      F. MA JOURNÉE — check-listes officielles
      ========================================================================== */
   function tachesChecklist(phase, jour) {
     const j = jourISO(jour);
     const mois = +String(jour).slice(5, 7);
     /* Cette ligne ne connaissait que deux phases : tout ce qui n'était pas
        « fermeture » retombait sur « ouverture ». La liste du service existait
        bien, mais on affichait celle de l'ouverture à sa place. */
     const src = CHECKLISTS[phase];
     if (!src) return [];
     return src.map(b => ({
       bloc: b.bloc,
       taches: b.taches.filter(t =>
         (!t.jours || t.jours.indexOf(j) >= 0) &&
         (!t.joursSauf || t.joursSauf.indexOf(j) < 0) &&
         /* Filtrage saisonnier : la machine à chocolat chaud ne tourne pas
            l'été, et une tâche qu'on ne peut pas faire décourage de cocher
            les autres. */
         (!t.mois || t.mois.indexOf(mois) >= 0))
     })).filter(b => b.taches.length);
   }
   
   V.accueil = async function () {
   const j = STATE.jour;
   STATE.phase = STATE.phase || phaseCourante();
   const e = await etatJour(j);
   const rec = await DB.get('checklist:' + j, {});
   const preuves = (await DB.get('preuves:' + j, [])).filter(p => !p.supprime);
   const alertes = await alertesDLC();
   const releve = await DB.get('releve', []);
   const msgs = releve.filter(m => !m.lu || m.epingle).slice(-3).reverse();

  /* Deux étapes ne se cochent pas à la main : elles se constatent. Le relevé
     des températures et le comptage de caisse doivent avoir été réellement
     faits dans leur écran. Cocher à la main un registre sanitaire sans l'avoir
     rempli, c'est exactement ce que l'outil doit empêcher. */
  const tempJour = await DB.get('temp:' + j, {});
  const caisseJour = await DB.get('caisse:' + j, {});
  const etatLie = (t, phase) => {
    if (!t.lien || !t.obligatoire) return null;
    if (t.lien === 'temp') {
      const mom = (phase === 'fermeture') ? 's' : 'm';
      const v = tempJour.valide && tempJour.valide[mom];
      /* Signé sans aucune mesure : pas fait (voir releveMesure). */
      return { fait: !!v && releveMesure(tempJour, mom), ou: 'temp',
               quoi: 'le relevé des températures du ' + (mom === 'm' ? 'matin' : 'soir'),
               par: v ? v.par : null, at: v ? v.at : null };
    }
    if (t.lien === 'caisse') {
      /* La caisse a changé de nommage : m_fond, s_cb, s_esp, s_tpe, s_retrait,
         s_fond. Cette vérification cherchait encore fi, cb, esp, tpe, depot, ff
         — les anciens champs — si bien que l'étape ne se cochait JAMAIS, même
         après un comptage validé. On lit les deux nommages. */
      const rempli = k => caisseJour[k] !== undefined && caisseJour[k] !== '';
      if (phase === 'fermeture') {
        const nouveau = ['s_cb', 's_esp', 's_tpe', 's_retrait', 's_fond'].every(rempli);
        const ancien  = ['cb', 'esp', 'tpe', 'depot', 'ff'].every(rempli);
        const v = caisseJour.s_valide;
        return { fait: nouveau || ancien, ou: 'caisse', quoi: 'la clôture de caisse',
                 par: v ? v.par : caisseJour.par, at: v ? v.at : caisseJour.at };
      }
      const v = caisseJour.m_valide;
      return { fait: rempli('m_fond') || rempli('fi'), ou: 'caisse',
               quoi: 'le comptage du fond de caisse',
               par: v ? v.par : caisseJour.par, at: v ? v.at : caisseJour.at };
    }
    return null;
  };
   
     $('#vue-actions').innerHTML = STATE.service
       ? '<button class="btn corail sm" id="ptg">Fin de service</button>'
       : '<button class="btn menthe sm" id="ptg">Début de service</button>';
   
     const R = [];
     if (!e.tempM) R.push(['bad', 'Frigos du matin non relevés', 'À faire dès l’ouverture, avant la mise en vitrine.', 'temp', 'm']);
     if (e.tempCrit) R.push(['bad', e.tempCrit + ' frigo(s) en limite critique', 'Transférez les produits et prévenez ' + (typeof nomManager === 'function' ? nomManager() : 'le manager') + '.', 'temp',
       /* Le moment du dépassement (le soir s'il y en a un), pas celui de l'heure. */
       ENCEINTES.some(en => etatTemp(en, tempJour['s_' + en.id]) === 'crit') ? 's' : 'm']);
     alertes.filter(a => a.niveau !== 'jaune').forEach(a => R.push(['bad',
       'DLC ' + (a.reste < 0 ? 'dépassée' : 'dans ' + a.reste + ' j') + ' : ' + a.produit,
       'Produit non ouvert reçu le ' + fmtDC(a.recuLe) + '. À écouler ou à jeter.', 'stock']));
   
     const phase = STATE.phase === 'service' ? 'service' : STATE.phase;
     /* Le service a désormais sa propre liste : réassort, remontée des glaces,
        remplissage des biberons et des sucres. Elle était vide jusqu'ici. */
     const blocs = tachesChecklist(phase, j);
     /* Recomptage déclenché par un écart de stock : il s'ajoute à la journée
        au lieu d'attendre que quelqu'un pense à ouvrir l'écran Stock. */
     const recompte = (typeof tacheRecomptage === 'function')
       ? await tacheRecomptage().catch(() => null) : null;
     if (recompte && blocs.length) {
       blocs[0] = { bloc: blocs[0].bloc,
                    taches: [recompte].concat(blocs[0].taches) };
     } else if (recompte) {
       blocs.push({ bloc: 'À faire en priorité', taches: [recompte] });
     }
     const total = blocs.reduce((s, b) => s + b.taches.length, 0);
     /* Une étape liée compte comme faite quand l'action réelle a eu lieu, pas
      quand la case est cochée — elle ne l'est plus à la main. */
   const estFaite = t => {
     const lie = etatLie(t, phase);
     return lie ? lie.fait : !!(rec[t.id] && rec[t.id].ok);
   };
   const faits = blocs.reduce((s, b) => s + b.taches.filter(estFaite).length, 0);
   
     const ligne = (t, n) => {
     const v = rec[t.id] || {};
     const clichés = preuves.filter(p => p.tache === t.id);
     const preuve = clichés[0];
     const lie = etatLie(t, phase);
     const besoinPhoto = PREUVE.actif &&
     (PREUVE.tachesObligatoires.indexOf(t.id) >= 0 ||
     (PREUVE.hebdoObligatoire && (t.jours || t.joursSauf || t.async)));
     /* Une étape liée n'est cochée que si l'action a vraiment eu lieu. */
     const faite = lie ? lie.fait : !!v.ok;
     /* Une tâche urgente porte son explication : un appui sur son libellé
        l'affiche en clair — pourquoi elle est là, quel inventaire faire — au
        lieu de renvoyer vers un écran muet. Le bouton « Y aller » ouvre
        ensuite l'inventaire sur le bon onglet. */
     const urgente = !!t.urgent;
     return '<div class="tache' + (faite ? ' on' : '') + (lie ? ' liee' : '') +
       (urgente ? ' urgente' : '') + '">' +
     '<span class="tnum">' + (urgente ? '!' : n) + '</span>' +
     (lie || urgente
       ? '<span class="box" aria-hidden="true">' + (urgente ? '' : '✓') + '</span>'
       : '<button class="box" data-t="' + t.id + '">✓</button>') +
     '<span class="tx">' +
     (urgente
       ? '<button type="button" class="tn tn-btn" data-explique="' + esc(t.id) + '">' + esc(t.t) + '</button>'
       : '<span class="tn">' + esc(t.t) + '</span>') +
     (urgente ? '<span class="tm">Touchez pour comprendre · puis « Y aller »</span>' : '') +
     (lie
       ? '<span class="tm">' + (lie.fait
           ? (lie.par ? esc(lie.par) + ' · ' + heure(lie.at) : 'fait')
           : 'À faire dans l’écran dédié') + '</span>'
       : (faite || besoinPhoto
         ? '<span class="tm">' + (faite ? esc(v.par) + ' · ' + heure(v.at) : '') +
           (besoinPhoto ? (faite ? ' · ' : '') + 'photo requise' : '') + '</span>'
         : '')) +
     '</span>' +
     (t.minuteur ? '<button class="btn clair sm" data-min="' + t.minuteur + '" data-nom="' + esc(t.t) + '">⏱️</button>' : '') +
     (besoinPhoto && !lie ? '<button class="btn ' + (preuve ? 'menthe' : 'clair') + ' sm" data-photo="' + t.id +
       '" data-lib="' + esc(t.t) + '">' +
       (clichés.length ? '✓ ' + clichés.length : 'Photo') + '</button>' : '') +
     (t.lien ? '<button class="btn ' + (lie && !lie.fait ? 'menthe' : urgente ? 'corail' : 'clair') + ' sm" data-go="' + t.lien + '"' +
       (t.partie ? ' data-partie="' + esc(t.partie) + '"' : '') +
       /* Relevé ou caisse : le moment de la phase, comme etatLie. */
       (t.lien === 'temp' || t.lien === 'caisse' ? ' data-moment="' + (phase === 'fermeture' ? 's' : 'm') + '"' : '') + '>' +
       /* Même mot que la consigne « puis « Y aller » » de la tâche urgente. */
       ((lie && !lie.fait) || urgente ? 'Y aller' : '→') + '</button>' : '') +
         '</div>' +
         /* Vignettes sous la tâche : plusieurs clichés possibles, avant et après.
            Cliquables pour voir en grand et supprimer. */
         vignettes(clichés, j);
  };
   
     /* Sans attendre open-meteo (#49) : voir meteoRapide. */
     const mt = (typeof meteoRapide === 'function') ? await meteoRapide() : { m:null, suite:null };
     const m = mt.m;
     const meteoMini = m => {
       const c = METEO.codes[m.code] || METEO.codes[3];
       return '<div class="meteo-mini"><span class="mm-t">' + m.t + '°</span>' +
              '<span class="mm-d">' + esc(c.l) + '</span>' +
              '<span class="mm-p">max ' + m.max + '° · pluie ' + m.pluie + ' %</span></div>';
     };

  $('#page').innerHTML =
     /* Salutation et météo sur une seule bande : le prénom parce qu'on tient
        un outil qui sait qui on est, la météo parce qu'elle détermine
        l'affluence — et donc ce qu'il faut sortir en vitrine. Elle n'était
        visible que du manager, alors qu'elle sert surtout en boutique. */
     '<div class="accueil-haut">' +
     '<div class="salut-bloc"><b>Bonjour ' + esc(STATE.user.prenom) + '</b>' +
     '<span>' + nomJour(j) + ' ' + fmtD(j) + ' · ' +
     (STATE.service ? 'en service depuis ' + heure(STATE.service.debut) : 'pas encore pointé') +
     '</span></div>' +
     (m ? meteoMini(m) : '') +
     '</div>' +

       (R.length
         ? '<div class="stack">' + R.slice(0, 4).map(r =>
             '<div class="alerte ' + r[0] + '"><div style="flex:1;min-width:0">' +
             '<b>' + esc(r[1]) + '</b><p>' + esc(r[2]) + '</p></div>' +
             '<button class="btn clair sm" data-go="' + r[3] + '"' + (r[4] ? ' data-moment="' + r[4] + '"' : '') +
             '>Ouvrir</button></div>').join('') + '</div>'
         : '<div class="alerte ok"><div style="flex:1"><b>Tout est à jour</b>' +
           '<p>Aucun relevé ni contrôle en retard.</p></div></div>') +
   
       (msgs.length ? '<div class="entete"><h3>Carnet de relève</h3>' +
         '<button class="btn fantome sm pousse" data-go="releve">Tout voir</button></div>' +
         '<div class="stack">' + msgs.map(m => carte('<div class="rang">' +
           '<div style="flex:1"><b>' + esc(m.texte) + '</b><div class="mini">' + esc(m.par) + ' · ' +
           fmtDC(m.jour) + '</div></div></div>', 'ambre')).join('') + '</div>' : '') +
   
       '<div class="phase-nav" style="margin-top:18px">' + PHASES.map(p =>
       '<button type="button" data-ph="' + p.id + '" class="' + (STATE.phase === p.id ? 'on' : '') + '">' +
       ic(p.id === 'ouverture' ? 'matin' : p.id === 'fermeture' ? 'soir' : 'service', 20) +
     '<span>' + esc(p.label) + '</span></button>').join('') + '</div>' +
   
       /* Le service affichait un menu de raccourcis À LA PLACE de la check-liste :
          l'écran restait donc vide de tâches, alors que les sept existaient bien.
          On dessine maintenant la check-liste pour les trois phases, et les
          raccourcis viennent en dessous — ils restent utiles pendant le service,
          où tout arrive sans prévenir. */
       (false
         ? carte(entete('⚡', 'Service', 'Ce qui se déclare au fil de la journée.') +
             '<div class="stack">' +
             ['clean|🧽|Nettoyage en cours de service', 'pertes|🗑️|Déclarer une perte',
             'lots|#️⃣|Traçabilité à l’ouverture d’un produit',
             'reception|🚚|Réceptionner une livraison', 'reas|📦|Signaler une rupture'].map(x => {
             const [id, ic, lb] = x.split('|');
             return '<button type="button" class="menu-item" data-go="' + id + '">' +
             '<span class="mi-tx"><span class="mi-t">' + lb + '</span></span>' +
             '<span class="mi-fl">›</span></button>';
             }).join('') + '</div>')
   
         : (function () {
         /* Numérotation continue sur toute la procédure, tous blocs confondus. */
         let n = 0;
         const vp = rec['_valide_' + phase];
         return carte(entete(PHASES.filter(p => p.id === phase)[0].icone,
           (phase === 'ouverture' ? 'Procédure d’ouverture'
            : phase === 'service' ? 'Pendant le service'
            : 'Procédure de fermeture'),
         faits + ' sur ' + total + ' tâches') +
            '<div class="jauge" style="margin-bottom:16px"><i style="width:' +
            (total ? Math.round(faits / total * 100) : 0) + '%"></i></div>' +
            (vp ? '<div class="alerte ok" style="margin-bottom:14px"><span class="ai">•</span>' +
              '<div><b>Procédure validée</b><p>Par ' + esc(vp.par) + ' à ' + heure(vp.at) + '.</p></div></div>' : '') +
            blocs.map(b => (blocs.length > 1 ? '<div class="entete"><h3>' + esc(b.bloc) + '</h3></div>' : '') +
              '<div class="stack">' + b.taches.map(t => ligne(t, ++n)).join('') + '</div>').join('') +
            '<button class="btn ' + (vp ? 'clair' : 'menthe') + ' bloc xl" id="valproc" style="margin-top:18px">' +
            (vp ? '✓ Déjà validée — revalider'
                : 'Valider la procédure' + (faits < total ? ' (' + (total - faits) + ' restante' + (total - faits > 1 ? 's' : '') + ')' : '')) +
            '</button>', 'solide');
        })()) +

       (phase === 'service'
         ? '<div class="entete"><h3>À tout moment</h3></div><div class="stack">' +
           ['clean|Nettoyage en cours de service', 'pertes|Déclarer une perte',
            'lots|Traçabilité à l’ouverture d’un produit',
            'reception|Réceptionner une livraison', 'reas|Signaler une rupture',
            'anomalie|Signaler un problème'].map(x => {
             const [id, lb] = x.split('|');
             return '<button type="button" class="menu-item" data-go="' + id + '">' +
               '<span class="mi-tx"><span class="mi-t">' + lb + '</span></span>' +
               '<span class="mi-fl">›</span></button>';
           }).join('') + '</div>'
         : '');
   
     $('#ptg').onclick = () => pointer(!STATE.service);
     $$('[data-ph]').forEach(b => b.onclick = () => { STATE.phase = b.dataset.ph; rendre('accueil'); });
   
     $$('[data-t]').forEach(b => b.onclick = async () => {
     const id = b.dataset.t, actif = !b.parentElement.classList.contains('on');
     const tache = blocs.reduce((a, bl) => a.concat(bl.taches), []).filter(t => t.id === id)[0] || {};
     const besoinPhoto = PREUVE.actif &&
     (PREUVE.tachesObligatoires.indexOf(id) >= 0 ||
        (PREUVE.hebdoObligatoire && (tache.jours || tache.joursSauf || tache.async)));
    if (actif && besoinPhoto && !preuves.filter(p => p.tache === id)[0]) {
      toast('Photographiez d’abord le résultat', 'erreur');
      const ph = $('[data-photo="' + id + '"]');
      if (ph) ph.click();
      return;
    }
       rec[id] = actif ? { ok:1, par:STATE.user.prenom, at:nowISO() } : { ok:0 };

       /* Mise à jour sur place : pas de redessin de la page, donc pas de saut
          ni de clignotement. Sur téléphone, cocher la tâche 20 renvoyait en haut. */
         const ligne2 = b.parentElement;
    ligne2.classList.toggle('on', actif);
    const tm = ligne2.querySelector('.tm');
    if (tm) tm.textContent = actif ? STATE.user.prenom + ' · ' + heure(nowISO()) : '';
    vibrer(UI.vibration.ok);

    /* Compteur et barre d'avancement, recalculés sans tout reconstruire — avec
       la MÊME règle que l'affichage initial. Compter les cases du DOM oubliait
       les tâches liées et urgentes (« 0 sur 10 » devenait « 1 sur 8 »), et le
       libellé « Valider la procédure (N restantes) » ne bougeait jamais. */
    const toutes2 = blocs.reduce((a, bl) => a.concat(bl.taches), []);
    const total2 = toutes2.length;
    const faits2 = toutes2.filter(estFaite).length;
    const cs = $('#page .card .cs');
    if (cs && /sur \d+ tâches/.test(cs.textContent)) {
      cs.textContent = cs.textContent.replace(/^\d+ sur \d+/, faits2 + ' sur ' + total2);
    }
    const barre = $('#page .jauge i');
    if (barre && total2) barre.style.width = Math.round(faits2 / total2 * 100) + '%';
    const vpb = $('#valproc');
    if (vpb && !rec['_valide_' + phase]) {
      const reste2 = total2 - faits2;
      vpb.textContent = 'Valider la procédure' + (reste2 > 0 ? ' (' + reste2 + ' restante' + (reste2 > 1 ? 's' : '') + ')' : '');
    }

    await DB.set('checklist:' + j, rec);
    if (actif) await feed('ok', STATE.user.prenom + ' : ' + ligne2.querySelector('.tn').textContent);
  });
   
     brancherVignettes(() => rendre('accueil'));

     /* Tâche urgente : un appui sur son libellé ouvre l'explication. On
        retrouve la tâche par son identifiant dans les blocs dessinés. */
     $$('[data-explique]').forEach(b => b.onclick = () => {
       const t = blocs.flatMap(x => x.taches).filter(x => x.id === b.dataset.explique)[0];
       if (!t) return;
       showSheet('<h2 id="sheet-titre">' + esc(t.t) + '</h2>' +
         '<p style="margin-top:12px;font-size:15px;line-height:1.55">' + esc(t.detail || '') + '</p>' +
         '<div class="actions"><button class="btn clair" data-fermer>Plus tard</button>' +
         (t.lien ? '<button class="btn menthe" id="exp-go">Y aller maintenant</button>' : '') + '</div>');
       const g = $('#exp-go');
       if (g) g.onclick = () => { closeSheet(); if (t.partie) STATE.inventairePartie = t.partie; rendre(t.lien); };
     });
     /* Le bouton « Y aller » d'une tâche de recomptage ouvre l'inventaire
        directement sur le bon onglet — sec ou chambre froide. */
     $$('[data-go][data-partie]').forEach(b => b.onclick = () => {
       STATE.inventairePartie = b.dataset.partie; rendre(b.dataset.go);
     });
     $$('[data-photo]').forEach(b => b.onclick = async () => {
       const p = await attacherPreuve(j, b.dataset.photo, b.dataset.lib);
       if (p) { toast('Photo enregistrée (' + p.poids + ' Ko)'); rendre('accueil'); }
     });
   
     $$('[data-min]').forEach(b => b.onclick = () => minuteur(+b.dataset.min, b.dataset.nom));

  const vp = $('#valproc');
  if (vp) vp.onclick = async () => {
    const toutes = blocs.reduce((a, b) => a.concat(b.taches), []);

    /* Blocage dur sur les étapes constatées : on ne valide pas une procédure
       en affirmant qu'un relévé a été fait alors qu'il n'existe pas. */
    const manquantes = toutes.map(t => ({ t:t, lie:etatLie(t, phase) }))
      .filter(x => x.lie && !x.lie.fait);
    if (manquantes.length) {
      const premier = manquantes[0];
      showSheet(
        '<h2 id="sheet-titre">Il manque ' + esc(premier.lie.quoi) + '</h2>' +
        '<p class="sub">Cette étape ne peut pas être cochée à la main.</p>' +
        '<div class="alerte bad"><span class="ai">•</span><div>' +
        '<b>' + manquantes.length + ' étape(s) à faire dans leur écran</b><p>' +
        esc(manquantes.map(x => x.lie.quoi).join(' · ')) +
        '. Ce sont des pièces du registre sanitaire : elles doivent porter des ' +
        'valeurs réelles et une signature.</p></div></div>' +
        '<div class="actions"><button class="btn clair" data-fermer>Fermer</button>' +
        '<button class="btn menthe" id="vp-go">' + esc('Aller à ' + premier.t.t) + '</button></div>');
      $('#vp-go').onclick = () => { closeSheet(); rendre(premier.lie.ou); };
      return;
    }

    const restants = toutes.filter(t => !estFaite(t));
    const finir = async () => {
      rec['_valide_' + phase] = { par:STATE.user.prenom, id:STATE.user.id, at:nowISO() };
      await DB.set('checklist:' + j, rec);
      await feed('ok', STATE.user.prenom + ' a validé ' +
        (phase === 'ouverture' ? 'la procédure d’ouverture'
         : phase === 'service' ? 'les tâches du service'
         : 'la procédure de fermeture'));
      toast('Procédure validée');
      rendre('accueil');
    };
    if (restants.length) {
      confirmer('Valider avec ' + restants.length + ' tâche(s) non faite(s) ?',
        'Non faites : ' + restants.map(t => t.t).join(' · ') + '.',
        'Valider quand même', finir);
      return;
    }
    finir();
  };

  /* Météo arrivée après le dessin (meteoRapide) : la bande du haut se
     complète, sans redessiner la page ni toucher une case en cours. */
  if (mt.suite) mt.suite.then(mm => {
    const h = document.querySelector('#page .accueil-haut');
    if (!mm || !h || STATE.view !== 'accueil') return;
    const ancien = h.querySelector('.meteo-mini');
    if (ancien) ancien.outerHTML = meteoMini(mm);
    else h.insertAdjacentHTML('beforeend', meteoMini(mm));
  });
};
   
   /* Minuteur des 10 minutes de contact du Bactalim */
   function minuteur(secondes, nom) {
     let reste = secondes;
     const html = () => '<h2 id="sheet-titre">⏱️ ' + esc(nom) + '</h2>' +
       '<p class="sub">Temps de contact obligatoire avant rinçage.</p>' +
       '<div style="text-align:center;font-size:64px;font-weight:700;font-variant-numeric:tabular-nums;margin:24px 0">' +
       Math.floor(reste / 60) + ':' + String(reste % 60).padStart(2, '0') + '</div>' +
       '<div class="actions"><button class="btn clair" data-fermer>Fermer</button></div>';
     showSheet(html());
     /* Marqueur du minuteur : le voile ferme la feuille sans passer par le
        bouton qui arrêtait l'intervalle. Si une autre feuille s'ouvre ensuite,
        showSheet efface le marqueur et le tick s'arrête au lieu d'écraser
        son contenu. */
     const idMin = uid();
     $('#sheet').dataset.minuteur = idMin;
     const t = setInterval(() => {
       reste--;
       const box = document.getElementById('sheet-corps');
       if (!box || $('#sheet').hidden || $('#sheet').dataset.minuteur !== idMin) return clearInterval(t);
       if (reste <= 0) {
         clearInterval(t);
         vibrer([200, 100, 200]);
         box.innerHTML = '<h2>Temps écoulé</h2><p class="sub">Vous pouvez rincer.</p>' +
           '<div class="actions"><button class="btn menthe" data-fermer>Terminé</button></div>';
         $$('#sheet-corps [data-fermer]').forEach(b => b.onclick = closeSheet);
         return;
       }
       box.innerHTML = html();
       $$('#sheet-corps [data-fermer]').forEach(b => b.onclick = () => { clearInterval(t); closeSheet(); });
     }, 1000);
     $$('#sheet-corps [data-fermer]').forEach(b => b.onclick = () => { clearInterval(t); closeSheet(); });
   }
   
   /* =============================================================================
      G. CAISSE — comptage d'ouverture et équilibre de fermeture
      Équilibre vérifié :
          TPE + dépôt espèces + fond final  ==  fond initial + CA total
      Vérifié sur l'exemple : 300 + 100 + 150 = 150 + 400 = 550.
      ========================================================================== */
   /* =============================================================================
    G. CAISSE — mêmes champs matin et soir
   Trois saisies seulement : espèces comptées, TPE compté, fond de caisse.
    Les contrôles se font en arrière-plan et se résument à une phrase.

    Nommage : m_* pour le matin, s_* pour le soir, z_* pour le ticket Z.
    Les anciennes clés (fi, ff, cb, esp, tpe, depot, ret) sont relues en secours
    pour ne pas invalider les feuilles déjà signées.
   ========================================================================== */
function equilibreCaisse(o) {
  /* Compatibilité : les feuilles antérieures à modules.js stockent le dépôt sous
     « ret ». On lit les deux plutôt que de réécrire un historique déjà signé. */
  const depot = (o.depot !== undefined && o.depot !== '') ? o.depot : o.ret;
  const gauche = num(o.tpe) + num(depot) + num(o.ff);
  const droite = num(o.fi) + num(o.cb) + num(o.esp);
  const ecart = +(gauche - droite).toFixed(2);
  return { gauche, droite, ecart, conforme: Math.abs(ecart) < 0.01,
           depot: num(depot), ca: num(o.cb) + num(o.esp) };
}

V.caisse = async function () {
  const j = STATE.jour;
  const r = await DB.get('caisse:' + j, {});
  /* Reprise d'une saisie interrompue. Safari décharge les onglets sous pression
     mémoire, et l'application vient de prendre 7,7 Mo pour le moteur de lecture :
     une personne qui compte sa caisse ne doit pas tout retaper pour autant. */
  try {
    const brouillon = JSON.parse(localStorage.getItem('pilotshop.v3:brouillon:caisse:' + j) || 'null');
    /* Le brouillon ne complète un moment que s'il a été tapé sous la même
       signature. Arrêté par le pré-contrôle, le manager voyait sinon la
       validation de Lucas avec son propre commentaire, repris du brouillon,
       et sa correction l'archivait comme celui de Lucas. */
    const signature = (o, m) => (o[m + '_valide'] && o[m + '_valide'].at) ||
      (o[m + '_avant'] && 'avant ' + o[m + '_avant'].at) || '';
    const momentDe = k => /^m_/.test(k) ? 'm'
      : (/^s_/.test(k) || CHAMPS_CAISSE_SOIR.indexOf(k) >= 0) ? 's' : null;
    if (brouillon) Object.keys(brouillon).forEach(k => {
      const m = momentDe(k);
      if (m && signature(brouillon, m) !== signature(r, m)) return;
      if (r[k] === undefined || r[k] === '') r[k] = brouillon[k];
    });
  } catch (e) {}
  const veille = await DB.get('caisse:' + addD(j, -1), null);

  /* Fond laissé hier soir : nouvelle clé, sinon l'ancienne. */
  const fondVeille = veille
    ? (veille.s_fond !== undefined && veille.s_fond !== '' ? num(veille.s_fond)
       : (veille.ff !== undefined && veille.ff !== '' ? num(veille.ff) : null))
    : null;

  if (!V.caisse._m) V.caisse._m = (!soirCommence() && !r.m_valide) ? 'm' : (r.s_valide ? 'm' : 's');
  let mom = V.caisse._m;

  /* Relecture des anciennes clés pour préremplir sans rien perdre */
  const legacy = { m_fond:'fi', s_fond:'ff', s_tpe:'tpe', s_cb:'cb', s_retrait:'depot' };
  const lire = k => {
    if (r[k] !== undefined && r[k] !== '') return r[k];
    const a = legacy[k];
    return (a && r[a] !== undefined) ? r[a] : '';
  };

  $('#vue-actions').innerHTML = '';

  const champ = (k, l, ph) =>
    '<div class="champ"><label class="f">' + l + '</label>' +
    '<input type="number" inputmode="decimal" step="0.01" data-k="' + k + '" value="' +
    lire(k) + '" placeholder="' + (ph || '') + '"></div>';

  const dessiner = () => {
    const p = mom + '_';
    const valide = r[mom + '_valide'];
    const verrou = verrouille();

    $('#page').innerHTML =
      navJour(j) +
      '<div class="tseg">' +
      [['m', 'Ouverture', 'matin'], ['s', 'Fermeture', 'soir']].map(x =>
        '<button class="' + (x[0] === mom ? 'on' : '') + '" data-mom="' + x[0] + '">' +
        ic(x[2], 20) + '<span class="tsl">' + x[1] + '</span>' +
        '<small>' + (r[x[0] + '_valide'] ? '✓ ' + heure(r[x[0] + '_valide'].at) : 'à faire') +
        '</small></button>').join('') + '</div>' +

      /* Rappel discret du fond laissé la veille, à l'ouverture seulement */
      (mom === 'm' && fondVeille !== null
        ? '<p class="rappel">Fond de caisse final d’hier soir : <b>' + eur(fondVeille) + '</b>' +
          (veille.s_valide ? ' · ' + esc(veille.s_valide.par) : '') + '</p>'
        : '') +

      (verrou
        ? (valide
          ? '<p class="lecture">Comptage validé par ' + esc(valide.par) + ' à ' + heure(valide.at) +
            '. Seul le manager peut le corriger.</p>'
          : '<p class="lecture">Comptage en cours de correction par le manager. ' +
            'Il sera de nouveau lisible une fois revalidé.</p>')
        : '') +

      carte(
        (mom === 'm'
          ? '<div class="champ">' +
            '<label class="f">Fond de caisse initial</label>' +
            '<input type="number" inputmode="decimal" step="0.01" data-k="m_fond" value="' +
            lire('m_fond') + '" placeholder="compté à l’ouverture"></div>'

          /* Le soir, l'ordre suit le geste : les recettes, puis ce qu'on
             retire, puis ce qu'on laisse dans le tiroir. */
          : '<div class="grid g2">' +
            champ('s_cb',  'Recettes CB sur la caisse') +
            champ('s_esp', 'Recettes espèces sur la caisse') + '</div>' +
            '<div style="margin-top:14px">' + champ('s_tpe', 'Recettes sur le TPE') + '</div>' +
            '<div style="margin-top:14px">' + champ('s_retrait', 'Retrait d’espèces') + '</div>' +
            '<p class="aide">Retirez uniquement des billets, pour un montant rond : ' +
            '50, 55, 60 €… La monnaie reste dans le tiroir pour le lendemain.</p>' +
            '<div style="margin-top:14px"><div class="champ">' +
            '<label class="f">Fond de caisse final</label>' +
            '<input type="number" inputmode="decimal" step="0.01" data-k="s_fond" value="' +
            lire('s_fond') + '" placeholder="laissé pour demain"></div></div>')) +

      '<div id="cverdict"></div>' +

      carte('<div class="champ"><label class="f">Commentaire</label>' +
        '<textarea data-k="' + p + 'com" placeholder="Toute explication utile.">' +
        esc(r[p + 'com'] || '') + '</textarea></div>', 'plat') +

      (verrou ? '' :
      '<button class="btn ' + (valide ? 'clair' : 'menthe') + ' bloc xl" id="cv" style="margin-top:16px">' +
      (valide ? '✓ Déjà validé — revalider'
              : 'Valider le comptage ' + (mom === 'm' ? 'd’ouverture' : 'de fermeture')) + '</button>') +

      /* Le manager voit le détail du calcul, pas seulement le verdict.
         Un équipier a besoin de savoir si ça tombe juste ; un manager a besoin
         de savoir POURQUOI ça ne tombe pas, et où chercher. */
      (STATE.user.role === 'manager' ? blocManager() : '');

    brancher();
    verdict();
  };

  /* Détail réservé au manager : les deux contrôles posés en clair. */
  function blocManager() {
    const fi = num(lire('m_fond')), cb = num(lire('s_cb')), esp = num(lire('s_esp'));
    const tpe = num(lire('s_tpe')), ret = num(lire('s_retrait')), ff = num(lire('s_fond'));
    const rempli = ['s_cb','s_esp','s_tpe','s_retrait','s_fond'].some(k => lire(k) !== '');
    if (!rempli) return '';

    const dCarte = tpe - cb;
    const attendu = fi + esp - ret;
    const dEsp = ff - attendu;
    const seuil = (typeof SEUILS !== 'undefined' && SEUILS.ecartFondEur) ? SEUILS.ecartFondEur : 5;
    const ligne = (lb, v, fort) =>
      '<div class="rang detail-l"><span>' + lb + '</span>' +
      '<b class="num' + (fort ? ' fort' : '') + '">' + eur(v) + '</b></div>';

    return '<div class="entete" style="margin-top:22px"><h3>Détail du contrôle</h3>' +
      '<span class="pousse mini">manager</span></div>' +

      carte('<b class="detail-t">Carte</b>' +
        ligne('Encaissé sur la caisse', cb) +
        ligne('Relevé sur le TPE', tpe) +
        '<div class="detail-sep"></div>' +
        ligne('Écart', dCarte, true) +
        '<p class="mini">' + (Math.abs(dCarte) < 0.01
          ? 'Les deux totaux concordent.'
          : dCarte > 0
          ? 'Le TPE a encaissé plus que ce qui est saisi en caisse : une vente n’a pas été enregistrée.'
          : 'La caisse annonce plus que le TPE : une vente a été saisie en carte sans passer par le terminal.') +
        '</p>',
        Math.abs(dCarte) >= seuil ? 'corail' : Math.abs(dCarte) < 0.01 ? '' : 'ambre') +

      carte('<b class="detail-t">Espèces</b>' +
        ligne('Fond du matin', fi) +
        ligne('Recettes espèces', esp) +
        ligne('Retrait', -ret) +
        '<div class="detail-sep"></div>' +
        ligne('Fond attendu ce soir', attendu) +
        ligne('Fond compté', ff) +
        ligne('Écart', dEsp, true) +
        '<p class="mini">' + (Math.abs(dEsp) < 0.01
          ? 'Le tiroir correspond exactement au calcul.'
          : dEsp < 0
          ? 'Il manque ' + eur(-dEsp) + ' : rendu de monnaie, vente non saisie, ou erreur de comptage.'
          : 'Il y a ' + eur(dEsp) + ' de trop : monnaie rendue en moins, ou recette non déclarée.') +
        '</p>',
        Math.abs(dEsp) >= seuil ? 'corail' : Math.abs(dEsp) < 0.01 ? '' : 'ambre') +

      carte('<b class="detail-t">Journée</b>' +
        ligne('Recettes totales', cb + esp) +
        ligne('dont carte', cb) +
        ligne('dont espèces', esp) +
        '<div class="detail-sep"></div>' +
        '<div class="rang detail-l"><span>Part carte</span><b class="num">' +
        ((cb + esp) ? Math.round(cb / (cb + esp) * 100) : 0) + ' %</b></div>' +
        (r.m_valide ? '<p class="mini">Ouverture validée par ' + esc(r.m_valide.par) +
          ' à ' + heure(r.m_valide.at) + '.</p>' : '') +
        (r.s_valide ? '<p class="mini">Fermeture validée par ' + esc(r.s_valide.par) +
          ' à ' + heure(r.s_valide.at) + '.</p>' : '') +
        (r.m_ecartSignale ? '<p class="mini">Écart du matin signalé par ' +
          esc(r.m_ecartSignale.par) + ' : ' + eur(r.m_ecartSignale.montant) + '.</p>' : ''),
        'plat');
  }

  /* --- Les deux contrôles, réduits à une phrase ------------------------- */
  function verdict() {
    const p = mom + '_';
    const box = $('#cverdict');
    if (!box) return;

    if (mom === 'm') {
      const compte = r.m_fond;
      if (fondVeille === null || compte === undefined || compte === '') { box.innerHTML = ''; return; }
      const d = +(num(compte) - fondVeille).toFixed(2);
      const seuil = (typeof SEUILS !== 'undefined' && SEUILS.ecartFondEur) ? SEUILS.ecartFondEur : 5;
      /* En deçà du seuil, on le dit sans dramatiser. À partir du seuil, en rouge
         et avec la possibilité de prévenir le manager. */
      const grave = Math.abs(d) >= seuil;

      if (Math.abs(d) < 0.01) {
        box.innerHTML = '<p class="verdict ok">Fond conforme au fond de caisse final d’hier soir.</p>';
      } else if (!grave) {
        box.innerHTML = '<p class="verdict n">Écart de ' + eur(d) + ' avec hier soir.</p>';
      } else {
        box.innerHTML =
          '<div class="verdict bad"><b>Écart de ' + eur(d) + ' avec hier soir</b>' +
          '<span>' + eur(fondVeille) + ' laissés hier, ' + eur(num(compte)) + ' comptés ce matin. ' +
          'L’écart date de la veille, pas de votre comptage.</span>' +
          '<button class="btn corail sm" id="signaler-ecart">Signaler au manager</button></div>';
      }
      const sg = $('#signaler-ecart');
      if (sg) sg.onclick = async () => {
        await feed('bad', STATE.user.prenom + ' signale un écart de fond de caisse : ' +
          eur(fondVeille) + ' laissés hier, ' + eur(num(compte)) + ' comptés ce matin (' + eur(d) + ')');
        await DB.push('anomalies', { id:uid(), categorie:'autre', gravite:'gene',
          titre:'Écart de fond de caisse : ' + eur(d),
          detail: eur(fondVeille) + ' laissés hier soir' +
            (veille && veille.s_valide ? ' par ' + veille.s_valide.par : '') +
            ', ' + eur(num(compte)) + ' comptés ce matin.',
          jour:today(), par:STATE.user.prenom, employe:STATE.user.id, at:nowISO(), resolue:false });
        r.m_ecartSignale = { par:STATE.user.prenom, at:nowISO(), montant:d };
        /* Le seul champ du signalement : la fiche entière, lue avant une
           correction du manager, serait refusée avec lui (garderComptagesValides). */
        await DB.patch('caisse:' + j, { m_ecartSignale:r.m_ecartSignale });
        toast(messageEnvoi('anomalies', 'Signalement transmis au manager'));
        dessiner();
      };
      if (r.m_ecartSignale) {
        box.innerHTML += '<p class="verdict ok">Signalé par ' + esc(r.m_ecartSignale.par) +
          ' à ' + heure(r.m_ecartSignale.at) + '.</p>';
      }
      return;
    }

    /* Soir : deux contrôles indépendants.
       Carte   — ce que la caisse a enregistré doit égaler ce que le TPE a encaissé.
       Espèces — fond initial + recettes espèces − retrait doit donner le fond final. */
    const cb = r.s_cb, tpe = r.s_tpe, esp = r.s_esp, fond = r.s_fond, ret = r.s_retrait;
    const lignes = [];

    if (cb !== '' && cb !== undefined && tpe !== '' && tpe !== undefined) {
      const dC = +(num(tpe) - num(cb)).toFixed(2);
      lignes.push(Math.abs(dC) < 0.01
        ? { ok:true,  t:'Carte : caisse et TPE au même montant.' }
        : { ok:false, montant:dC, t:'Carte : ' + eur(dC) + ' d’écart. ' + eur(num(cb)) +
                        ' sur la caisse, ' + eur(num(tpe)) + ' sur le TPE.' });
    }

    const fondOuv = (r.m_fond !== undefined && r.m_fond !== '') ? num(r.m_fond)
                  : (fondVeille !== null ? fondVeille : null);
    if (fondOuv !== null && esp !== '' && esp !== undefined &&
        fond !== '' && fond !== undefined && ret !== '' && ret !== undefined) {
      const attendu = +(fondOuv + num(esp) - num(ret)).toFixed(2);
      const dE = +(num(fond) - attendu).toFixed(2);
      lignes.push(Math.abs(dE) < 0.01
        ? { ok:true,  t:'Espèces : le tiroir tombe juste.' }
        : { ok:false, montant:dE, t:'Espèces : ' + eur(dE) + ' d’écart. ' + eur(fondOuv) + ' au départ + ' +
                        eur(num(esp)) + ' encaissés − ' + eur(num(ret)) + ' retirés = ' +
                        eur(attendu) + ' attendus, ' + eur(num(fond)) + ' laissés.' });
    }

    if (!lignes.length) {
      box.innerHTML = '<p class="verdict n">Renseignez les recettes pour le contrôle.</p>';
      return;
    }
    /* Le rouge est réservé aux écarts qui dépassent le seuil de 5 €. En
       dessous, un écart de quelques centimes se dit sans dramatiser — la
       même règle que le matin. Avant, le soir passait au rouge dès un
       centime, et l'équipe voyait une alerte tous les jours : quand tout est
       rouge, plus rien ne l'est. */
    const seuil = (typeof SEUILS !== 'undefined' && SEUILS.ecartFondEur) ? SEUILS.ecartFondEur : 5;
    const soucis = lignes.filter(l => !l.ok);
    const graves = soucis.filter(l => Math.abs(l.montant || 0) >= seuil);
    if (!soucis.length) {
      box.innerHTML = '<p class="verdict ok">' + lignes.map(l => esc(l.t)).join(' ') + '</p>';
    } else if (!graves.length) {
      box.innerHTML = '<p class="verdict n">' + soucis.map(l => esc(l.t)).join('<br>') +
        '<br>Sous le seuil de ' + eur(seuil) + ' : pas de justification demandée.</p>';
    } else {
      box.innerHTML = '<div class="verdict bad"><b>' + graves.length + ' écart(s) au-delà de ' +
        eur(seuil) + '</b><span>' + soucis.map(l => esc(l.t)).join('<br>') +
        '<br>Expliquez-le dans le commentaire.</span></div>';
    }
  }

  /* Champs de saisie UNIQUEMENT. Le sélecteur large [data-k] ramassait aussi
     les touches du pavé numérique de l'écran de connexion, qui portent le même
     attribut : la caisse enregistrait douze champs parasites nommés 0 à 9,
     annuler et effacer. Sans conséquence sur les calculs, mais chaque relevé
     en était pollué et le diagnostic devenait illisible. */
  const champsSaisie = () =>
    $$('#page input[data-k], #page textarea[data-k], #page select[data-k]');

  /* r est tenu à jour par oninput : l'enregistrement différé ne relit plus
     l'écran. 400 ms après la frappe, #page pouvait montrer un autre jour :
     « Jour précédent » touché aussitôt, le fond de la veille (999 €) partait
     sous aujourd'hui, prêt à être validé. */
  const sauver = debounce(() => DB.set('caisse:' + j, r), 400);

  /* Un comptage déjà validé ne se corrige que par le manager. Un équipier le
     réécrivait sans trace : signature et montants d'origine perdus, journal
     muet. L'équipe corrige librement un comptage tant qu'il n'est pas validé. */
  function verrouille() {
    /* Pendant une correction du manager, la signature vaut null mais
       <moment>_avant garde l'ancienne : le comptage reste fermé à l'équipe.
       Sinon, un équipier qui ouvrait l'écran à ce moment saisissait des
       montants qui écrasaient ensuite la nouvelle signature. */
    return !!(r[mom + '_valide'] || r[mom + '_avant']) && STATE.user.role !== 'manager';
  }
  const LIBELLES_CAISSE = { m_fond:'fond initial', s_cb:'recettes CB', s_esp:'recettes espèces',
    s_tpe:'TPE', s_retrait:'retrait', s_fond:'fond final' };
  const champsMoment = m => (m === 'm' ? ['m_fond'] : ['s_cb', 's_esp', 's_tpe', 's_retrait', 's_fond']).concat([m + '_com']);
  const instantane = m => {
    const v = {};
    champsMoment(m).forEach(k => { v[k] = String(lire(k)); });
    return v;
  };

  function brancher() {
    brancherNavJour('caisse');
    if (!peutModifier(j)) return;
    $$('[data-mom]').forEach(b => b.onclick = () => {
      if (b.dataset.mom === mom) return;
      mom = b.dataset.mom; V.caisse._m = mom; dessiner();
    });
    if (verrouille()) champsSaisie().forEach(i => { i.disabled = true; });
    else champsSaisie().forEach(i => i.oninput = () => {
      /* Correction d'un comptage validé : la signature et les montants
         d'origine sont gardés jusqu'à la revalidation, qui les journalise. */
      if (r[mom + '_valide'] && !r[mom + '_avant']) {
        r[mom + '_avant'] = Object.assign({ valeurs:instantane(mom) }, r[mom + '_valide']);
      }
      /* Numéro de saisie : une copie lue pendant la correction en porte un plus
         petit, et la fusion ne la laisse pas remettre ses montants. */
      if (r[mom + '_avant']) r[mom + '_avant'] = Object.assign({}, r[mom + '_avant'], { n:(+r[mom + '_avant'].n || 0) + 1 });
      r[i.dataset.k] = i.value;
      /* null et non delete : la fusion avec la copie du serveur ferait revenir
         une clé supprimée, et l'ancienne signature avec elle. */
      if (r[mom + '_valide']) r[mom + '_valide'] = null;
      /* Écriture locale IMMÉDIATE, avant l'enregistrement différé : si l'onglet
         est déchargé entre deux frappes, rien n'est perdu. */
      try { localStorage.setItem('pilotshop.v3:brouillon:caisse:' + j, JSON.stringify(r)); } catch (e) {}
      sauver();
      verdict();
    });
    if ($('#cv')) $('#cv').onclick = async () => {
      /* Moment et montants pris au clic : la relecture ci-dessous peut durer
         8 s, et l'équipier peut entre-temps changer d'onglet, de jour ou
         d'écran. Relus après, c'était l'autre onglet qui était signé, et les
         montants affichés (ceux de la veille) partaient sous ce jour. */
      const mo = mom, p = mo + '_';
      /* L'écran d'abord, puis le contrôle des champs vides : une fiche à
         anciennes clés (fi, cb, tpe…) s'affiche remplie sans que r le soit, et
         sauver ne recopie plus l'écran. « Renseignez… » arrêtait alors une
         validation dont tous les montants étaient à l'écran. */
      champsSaisie().forEach(i => { r[i.dataset.k] = i.value; });
      const requis = (mo === 'm') ? ['m_fond'] : ['s_cb', 's_esp', 's_tpe', 's_retrait', 's_fond'];
      const vides = requis.filter(k => r[k] === undefined || r[k] === '');
      if (vides.length) return toast(mo === 'm'
        ? 'Renseignez le fond de caisse initial'
        : 'Renseignez tous les montants du soir', 'erreur');
      /* Bouton désactivé dès le clic, pour tous : un double appui du manager
         validait deux fois, et la seconde validation, prenant la première pour
         un comptage à corriger, journalisait une correction fictive (« Marie →
         Marie, montants inchangés »). */
      const bouton = $('#cv');
      bouton.disabled = true; bouton.textContent = 'Vérification…';
      /* Écran ouvert avant une validation ou une correction faite sur un autre
         iPad : la fusion refuserait cette validation (correction en cours) ou la
         laisserait remplacer celle du collègue (comptage validé), et le fil
         annoncerait « a validé ». On relit d'abord la fiche. L'équipier s'arrête
         devant toute signature. Le manager, qui peut corriger, devant une
         signature que son écran ne connaît pas : il voit d'abord ce qui a été
         validé, puis corrige s'il le faut (Lucas valide 150 €, Marie, écran
         resté ouvert, validait 155 € par-dessus sans le savoir).
         Une saisie de cette fiche encore en file d'attente (réponse perdue,
         réseau tout juste revenu) : DB.get rendait la copie de l'iPad, qui
         ignore la validation du collègue, et laissait tout passer (vérifié :
         une réponse perdue sur la saisie de Marie, Lucas valide 150 €, Marie
         valide 155 € sans arrêt). La file part d'abord, un délai réseau au
         plus : la relecture lit alors le serveur, et l'écran rechargé après
         un arrêt montre la validation. */
      if (STATE.enLigne && fileLire().some(x => x.cle === 'caisse:' + j)) {
        try { await Promise.race([journaliserSync(), new Promise(ok => setTimeout(ok, OFFLINE.timeoutReseauMs))]); } catch (e) {}
      }
      const frais = await DB.get('caisse:' + j, null);
      const sig = frais && (frais[p + 'valide'] || frais[p + 'avant']);
      const manager = STATE.user.role === 'manager';
      const connue = s => [r[p + 'valide'], r[p + 'avant']]
        .concat(Array.isArray(r[p + 'corrections']) ? r[p + 'corrections'] : [])
        .some(x => x && x.at === s.at);
      if (sig && (!manager || !connue(sig))) {
        toast(manager
          ? (frais[p + 'valide']
            ? 'Comptage validé entre-temps par ' + (sig.par || 'un collègue') + ' : vérifiez-le avant de le corriger'
            : 'Comptage en cours de correction sur un autre iPad')
          : (frais[p + 'valide']
            ? 'Comptage déjà validé par ' + (sig.par || 'un collègue') + ' : seul le manager peut le modifier'
            : 'Comptage en cours de correction par le manager'), 'erreur');
        /* Parti entre-temps sur un autre onglet, un autre jour ou un autre
           écran : le message suffit, on ne l'en arrache pas. */
        return bouton.isConnected ? rendre('caisse') : undefined;
      }
      /* Revalidation d'un comptage déjà signé, corrigé ou non : l'ancienne
         signature et les anciens montants vont au journal et restent dans la
         fiche (p_corrections), au lieu d'être écrasés sans trace. */
      const avant = r[p + 'avant'] ||
        (r[p + 'valide'] ? Object.assign({ valeurs:instantane(mo) }, r[p + 'valide']) : null);
      r[mo + '_valide'] = { par:STATE.user.prenom, id:STATE.user.id, at:nowISO() };
      let correction = '';
      if (avant) {
        const apres = instantane(mo), av = avant.valeurs || {};
        const change = k => k === p + 'com' ? (av[k] || '') !== (apres[k] || '') : num(av[k]) !== num(apres[k]);
        const diffs = champsMoment(mo).filter(change).map(k =>
          k === p + 'com' ? 'commentaire modifié'
            : LIBELLES_CAISSE[k] + ' ' + eur(num(av[k])) + ' → ' + eur(num(apres[k])));
        correction = ' — déjà validé par ' + (avant.par || '?') + (avant.at ? ' à ' + heure(avant.at) : '') +
          ' : ' + (diffs.length ? diffs.join(', ') : 'montants inchangés');
        r[p + 'corrections'] = (Array.isArray(r[p + 'corrections']) ? r[p + 'corrections'] : []).concat([{
          par:avant.par || null, id:avant.id || null, at:avant.at || null, valeurs:avant.valeurs || {},
          corrigePar:STATE.user.prenom, le:nowISO() }]);
        r[p + 'avant'] = null;
      }
      /* Le tableau de bord, l'historique et les tendances lisent encore
         ecart / par : sans eux, chaque soir s'affichait à 0 €, sans écart. */
      if (mo === 's') {
        const fondOuv = (r.m_fond !== undefined && r.m_fond !== '') ? num(r.m_fond)
                      : (fondVeille !== null ? fondVeille : null);
        /* ecart garde son ancien sens : carte + espèces, comme les fiches
           d'avant, pour que les tendances comparent des choses comparables. */
        r.ecartCB = +(num(r.s_tpe) - num(r.s_cb)).toFixed(2);
        r.ecartEsp = fondOuv === null ? null
          : +(num(r.s_fond) - (fondOuv + num(r.s_esp) - num(r.s_retrait))).toFixed(2);
        r.ecart = +(r.ecartCB + (r.ecartEsp || 0)).toFixed(2);
        r.par = STATE.user.prenom;
      }
      await DB.set('caisse:' + j, r);
      await feed(avant ? 'warn' : 'ok', STATE.user.prenom + (avant ? ' a revalidé' : ' a validé') + ' le comptage ' +
        (mo === 'm' ? 'd’ouverture' : 'de fermeture') + correction);
      toast('Comptage validé');
      /* Le manager revient à sa Tour de contrôle, pas à la vue équipier. */
      rendre(vueAccueil());
    };
  }

  dessiner();
};

   /* =============================================================================
      H. TRAÇABILITÉ — libellé et liste déroulante de confirmation
      ========================================================================== */
   /* Même situation que pour V.reglages : la version d'app.js a été retirée,
      et stock.js redéfinit complètement V.lots. Cette enveloppe ne sert donc
      plus à rien, mais elle doit rester inoffensive. */
   const V_lots_origine = (typeof V.lots === 'function') ? V.lots : null;
/* V.lots : version retirée — elle était remplacée au chargement. */
   
   /* Ouverture d'un produit absent du stock fermé : on avertit sans bloquer.
   Bloquer empêcherait de tracer un bac réellement ouvert, ce qui serait pire
   qu'un stock inexact lors d'un contrôle sanitaire. */
function confirmerHorsStock(produit, lot) {
  return new Promise(resolve => {
    showSheet(
      '<h2 id="sheet-titre">Absent du stock fermé</h2>' +
      '<p class="sub">' + esc(produit) + ' · lot ' + esc(lot) + '</p>' +
      '<div class="alerte warn"><span class="ai">●</span><div>' +
      '<b>Aucun bac correspondant en stock</b>' +
      '<p>Ce lot n’a jamais été entré en stock. Trois explications courantes : ' +
      'la livraison n’a pas été saisie, le bac vient d’une autre boutique, ou le ' +
      'numéro de lot a été mal lu.</p></div></div>' +
      '<div class="alerte info" style="margin-top:10px"><span class="ai">ℹ️</span><div>' +
      '<b>Si vous continuez</b><p>L’ouverture sera traçée normalement — c’est ce qui ' +
      'compte pour un contrôle — mais le stock ne sera pas décrémenté et l’écart de ' +
      'période s’en ressentira. ' + esc((m => m.charAt(0).toUpperCase() + m.slice(1))(typeof nomManager === 'function' ? nomManager() : 'le manager')) + ' verra le signalement dans le fil.</p></div></div>' +
      '<div class="actions"><button class="btn clair" id="hs-x">Vérifier le lot</button>' +
      '<button class="btn ambre" id="hs-ok">Tracer quand même</button></div>' +
      '<button class="btn clair bloc" id="hs-rec" style="margin-top:10px">' +
      'Saisir d’abord la réception</button>');
    $('#hs-x').onclick   = () => { closeSheet(); resolve(false); };
    $('#hs-ok').onclick  = () => { resolve(true); };
    $('#hs-rec').onclick = () => { closeSheet(); resolve(false); rendre('reception'); };
  });
}

/* =============================================================================
   M. TÂCHES HEBDOMADAIRES
   Le tableau affiché en boutique, en version numérique. L'équipier ne choisit
   rien : il se connecte, on est samedi, il voit les tâches du samedi. C'est le
   manager qui a décidé du jour et, si besoin, de la personne.
   ========================================================================== */
async function planHebdo() {
  const perso = await DB.get('hebdo:plan', null);
  return TACHES_HEBDO.map(t => {
    const p = perso && perso[t.id];
    const f = Object.assign({}, t, p || {});
    /* Compatibilité avec l'ancien format à jour unique. Les jours sont
       COPIÉS : l'éditeur de la semaine les modifie sur place, et ces tableaux
       étaient ceux de TACHES_HEBDO_DEF (copie superficielle). « Annuler »
       laissait donc la bascule appliquée, et « Rétablir le tableau
       d'origine » repartait d'une référence d'usine déjà altérée. */
    f.jours = Array.isArray(f.jours) ? f.jours.slice() : (f.jour ? [+f.jour] : []);
    return f;
  }).filter(t => !t.retiree);
}
async function tachesHebdoDuJour(jour) {
  const j = jourISO(jour);
  return (await planHebdo())
    /* Déjà faite chaque jour par la procédure : on ne la redemande pas ici. */
    .filter(t => !t.procedure && t.jours.indexOf(j) >= 0)
    .sort((a, b) => (a.rang || 0) - (b.rang || 0));
}

V.hebdo = async function () {
  const j = STATE.jour;
  const taches = await tachesHebdoDuJour(j);
  const rec = await DB.get('hebdo:' + j, {});
  const preuves = (await DB.get('preuves:' + j, [])).filter(p => !p.supprime);
  const resp = await DB.get('hebdo:responsables', {});
  const faits = taches.filter(t => rec[t.id] && rec[t.id].ok).length;

  $('#vue-actions').innerHTML = '';

  const photosDe = id => preuves.filter(p => p.tache === id);

  $('#page').innerHTML =
    navJour(j) +
    carte('<div class="cs">' + (taches.length
        ? faits + ' sur ' + taches.length + ' tâches du jour'
        : 'Aucune tâche hebdomadaire prévue ce jour') + '</div>' +
      (taches.length
        ? '<div class="jauge" style="margin-top:10px"><i style="width:' + Math.round(faits / taches.length * 100) + '%"></i></div>'
        : ''), 'solide') +

    (taches.length
      ? '<div class="stack" style="margin-top:12px">' + taches.map((t, i) => {
          const v = rec[t.id] || {};
          const ph = photosDe(t.id);
          const assignee = t.assignee ? (EQUIPE.filter(e => e.id === t.assignee)[0] || {}).prenom : null;
          return carte(
            '<div class="rang" style="align-items:flex-start">' +
            '<span class="stepnum">' + (i + 1) + '</span>' +
            '<div style="flex:1;min-width:0">' +
            '<b style="font-size:15.5px;line-height:1.3;display:block">' + esc(t.libelle) + '</b>' +
            '<div class="mini" style="margin-top:4px">' +
            (v.ok ? '✓ ' + esc(v.par) + ' · ' + heure(v.at)
                  : (assignee ? 'Attribuée à ' + esc(assignee)
                              : (t.perso ? 'Aucune personne attribuée' : 'À faire aujourd’hui'))) +
            ' · ' + ph.length + '/' + HEBDO.photosMax + ' photo(s)</div></div>' +
            (v.ok ? pastille('ok', 'Fait') : pastille('n', 'À faire')) + '</div>' +

            /* Vignettes communes : un appui agrandit la photo et permet de
               retirer une photo ratée. Ici, de simples images ne s'ouvraient pas. */
            vignettes(ph, j) +

            '<div class="btn-row" style="margin-top:12px">' +
            '<button class="btn ' + (ph.length ? 'clair' : 'ciel') + '" data-ph="' + t.id + '"' +
            (ph.length >= HEBDO.photosMax ? ' disabled' : '') + '>' +
            (ph.length ? 'Ajouter une photo' : 'Photographier') + '</button>' +
            '<button class="btn ' + (v.ok ? 'clair' : 'menthe') + '" data-v="' + t.id + '">' +
            (v.ok ? 'Annuler' : '✓ Valider') + '</button></div>',
            v.ok ? 'menthe' : '');
        }).join('') + '</div>'
      : vide('🗓️', 'Rien de prévu ce jour dans le plan hebdomadaire.')) +

    '<div class="entete"><h3>Responsables de la semaine</h3></div>' +
    '<div class="stack">' + RESPONSABLES.map(r => {
      const qui = resp[r.id] ? (EQUIPE.filter(e => e.id === resp[r.id])[0] || {}).prenom : null;
      return carte('<div class="rang">' +
        '<div style="flex:1;min-width:0"><b>' + esc(r.libelle) + '</b></div>' +
        (qui ? pastille('ok', esc(qui)) : pastille('n', 'non attribué')) + '</div>',
        qui ? 'menthe' : 'sable');
    }).join('') + '</div>';

  brancherNavJour('hebdo');
  brancherVignettes(() => rendre('hebdo'), !peutModifier(j));
  if (!peutModifier(j)) return;

  $$('[data-ph]').forEach(b => b.onclick = async () => {
    const p = await attacherPreuve(j, b.dataset.ph,
      taches.filter(t => t.id === b.dataset.ph)[0].libelle);
    if (p) { toast('Photo ajoutée (' + p.poids + ' Ko)'); rendre('hebdo'); }
  });

  $$('[data-v]').forEach(b => b.onclick = async () => {
    const id = b.dataset.v, actif = !(rec[id] && rec[id].ok);
    if (actif && HEBDO.photosObligatoires && photosDe(id).length < HEBDO.photosMin) {
      toast('Photographiez d’abord le résultat', 'erreur');
      const ph = $('[data-ph="' + id + '"]');
      if (ph) ph.click();
      return;
    }
    rec[id] = actif
      ? { ok:1, par:STATE.user.prenom, employe:STATE.user.id, at:nowISO(),
          photos:photosDe(id).length }
      : { ok:0 };
    await DB.set('hebdo:' + j, rec);
    if (actif) {
      const t = taches.filter(x => x.id === id)[0];
      await feed('ok', STATE.user.prenom + ' : ' + t.libelle);
    }
    rendre('hebdo');
  });
};

/* =============================================================================
   N. TEMPÉRATURES — saisie au pas, pas en liste
   L'ancien écran affichait jusqu'à quinze boutons par enceinte sur dix
   enceintes : illisible et interminable à faire défiler. Ici, une valeur par
   défaut, deux flèches, un bouton hors service, une saisie libre, et un
   bouton de validation unique en bas qui ramène à l'accueil.
   ========================================================================== */
/* Le soir commence avec la phase de fermeture de la boutique, comme dans la
   check-liste. Températures et Caisse basculaient à 15 h fixes : une demi-heure
   après une ouverture à 14:30, elles ouvraient le soir, matin pas encore fait. */
function soirCommence() {
  const d = new Date(), bf = HORAIRES.debutFermeture;
  return /^\d{2}:\d{2}$/.test(bf || '')
    ? d.getHours() * 60 + d.getMinutes() >= +bf.slice(0, 2) * 60 + +bf.slice(3, 5)
    : d.getHours() >= 15;
}

function defautEnceinte(e) {
  return Math.round((e.vert[0] + e.vert[1]) / 2);
}

V.temp = async function () {
  /* L'iPad reste ouvert plusieurs jours : au changement de date, on revient au
     jour en cours au lieu de rester bloqué sur la veille, verrouillée. */
  if (!V.temp._d || V.temp._auj !== today()) {
    if (V.temp._auj) STATE.jour = today();   // sinon la saisie resterait verrouillée
    V.temp._d = today(); V.temp._auj = today();
  }
  const j = V.temp._d;
  const rec = await DB.get('temp:' + j, {});
  if (!rec.valide) rec.valide = {};

  /* Un seul moment à l'écran : le matin ou le soir, jamais les deux.
     Le moment proposé dépend de l'heure et de ce qui reste à faire. */
  const moments = RELEVES.moments;
  /* Un lien demande un moment précis (voir rendre) : il passe avant ce choix. */
  if (V.temp._voulu) { V.temp._m = V.temp._voulu; V.temp._j = j; V.temp._voulu = null; }
  else if (!V.temp._m || V.temp._j !== j) {
    V.temp._j = j;
    const soir = soirCommence();
    if (!rec.valide.m && !soir)       V.temp._m = 'm';
    else if (!rec.valide.s)           V.temp._m = 's';
    else if (!rec.valide.m)           V.temp._m = 'm';
    else                              V.temp._m = soir ? 's' : 'm';
  }
  /* « let » et non « const » : le moment change quand on bascule, et toutes
     les fonctions ci-dessous doivent suivre. Avec const, le clic sur « Soir »
     changeait la mémoire mais l'écran restait sur le matin. */
  let mom = moments.filter(x => x.id === V.temp._m)[0] || moments[0];

  const cle = e => mom.id + '_' + e.id;
  const brut = e => rec[cle(e)];
  const saisi = e => { const v = brut(e); return v !== undefined && v !== ''; };
  const val = e => {
    const v = brut(e);
    if (v === 'HS') return 'HS';
    return (v === undefined || v === '') ? defautEnceinte(e) : Number(v);
  };
  const valideMoment = () => rec.valide[mom.id];

  $('#vue-actions').innerHTML = '';

  const manquants = () => ENCEINTES.filter(e => !saisi(e));

  const ligne = e => {
    const v = val(e), hs = v === 'HS', ok = saisi(e);
    /* Pas encore relevée : on n'affiche pas la valeur cible en vert, ce qui
       laissait croire à un relevé conforme. « — » et aucune classe d'état. */
    const etat = (hs || !ok) ? '' : etatTemp(e, v);
    /* Trois états lisibles d'un coup d'œil : à relever, relevé, validé. */
    const cls = valideMoment() && ok ? 'tligne valide' : ok ? 'tligne saisi' : 'tligne';
    return '<div class="' + cls + '">' +
      '<div class="tl-haut"><b>' + esc(e.nom) + '</b>' +
      '<span class="tl-cible">' + esc(e.cible) + '</span>' +
      '<span class="tl-etat">' + (valideMoment() && ok ? '✓ validé' : ok ? 'relevé' : 'à relever') + '</span></div>' +
      '<div class="tl-bas">' +
      (hs
        ? '<span class="tm-hs">Hors service</span>'
        : '<button class="tm-pas" data-pas="-1" data-e="' + esc(e.id) + '">−</button>' +
          '<button class="tm-val ' + etat + '" data-libre="' + esc(e.id) + '">' +
          (ok ? esc(v) + '<small>°C</small>' : '—') + '</button>' +
          '<button class="tm-pas" data-pas="1" data-e="' + esc(e.id) + '">+</button>') +
      '<button class="tm-off' + (hs ? ' on' : '') + '" data-hs="' + esc(e.id) + '">HS</button>' +
      '</div></div>';
  };

  const dessiner = () => {
    const reste = manquants();
    const vm = valideMoment();

    $('#page').innerHTML =
      navJour(j) +
      /* Sélecteur matin / soir, avec l'état de chacun */
      '<div class="tseg">' + moments.map(m => {
        const v = rec.valide[m.id];
        return '<button class="' + (m.id === mom.id ? 'on' : '') + '" data-mom="' + m.id + '">' +
          ic(m.id === 'm' ? 'matin' : 'soir', 20) +
          '<span class="tsl">' + m.label + '</span>' +
          '<small>' + (v ? '✓ validé à ' + heure(v.at) : 'à faire') + '</small></button>';
      }).join('') + '</div>' +

      (vm
        ? '<div class="alerte ok" style="margin-bottom:12px"><span class="ai">•</span><div>' +
          '<b>Relevé du ' + mom.label.toLowerCase() + ' validé</b>' +
          '<p>Par ' + esc(vm.par) + ' à ' + heure(vm.at) + '. Toute modification demandera ' +
          'une nouvelle validation.</p></div></div>'
        : '') +

      '<div class="stack">' + ENCEINTES.map(ligne).join('') + '</div>' +

      carte(entete('📝', 'Action corrective',
        'Obligatoire dès qu’une enceinte dépasse sa limite critique.') +
        '<textarea id="obs" aria-label="Action corrective" placeholder="Ex. vitrine à −9 °C : bacs transférés en chambre froide, ' +
        esc((typeof nomManager === 'function' ? nomManager() : 'le manager')) + ' prévenu.">' +
        esc(rec.obs || '') + '</textarea>') +

      '<button class="btn ' + (vm ? 'clair' : 'menthe') + ' bloc xl" id="tvalider" style="margin-top:16px">' +
      (vm ? '✓ Déjà validé — revalider'
          : reste.length ? 'Valider le ' + mom.label.toLowerCase() + ' (' + reste.length + ' manquante' + (reste.length > 1 ? 's' : '') + ')'
                         : 'Valider le relevé du ' + mom.label.toLowerCase()) +
      '</button>';

    brancher();
  };

  /* rec.obs suit la frappe (voir #obs plus bas) : l'enregistrement ne relit
     plus l'écran, qui peut être déjà celui d'un autre jour. */
  const sauver = () => DB.set('temp:' + j, rec);

  /* Modifier une valeur après validation annule celle-ci : le registre doit
     porter la signature de la personne qui a vu la dernière valeur. */
  const invalider = () => { if (rec.valide[mom.id]) rec.valide[mom.id] = null; };   // null : voir caisse

  function brancher() {
    brancherNavJour('temp');
    if (!peutModifier(j)) return;
    $$('[data-mom]').forEach(b => b.onclick = () => {
      if (b.dataset.mom === mom.id) return;
      V.temp._m = b.dataset.mom;
      mom = moments.filter(x => x.id === V.temp._m)[0] || moments[0];
      dessiner();
    });

    $$('[data-pas]').forEach(b => b.onclick = async () => {
      const e = ENCEINTES.filter(x => x.id === b.dataset.e)[0];
      const actuel = val(e);
      /* Premier appui sur une enceinte non relevée : il pose la cible telle
         quelle (affichée « — » jusque-là) ; les appuis suivants font ±1. */
      const nv = !saisi(e) ? defautEnceinte(e)
               : (actuel === 'HS' ? defautEnceinte(e) : actuel) + (+b.dataset.pas);
      /* Hors de la plage des flèches (ex. 20 °C tapé au lieu de −20), elles
         restaient muettes. On laisse revenir vers la plage ; s'éloigner encore
         est refusé, mais en le disant et en indiquant la saisie libre. */
      const bas = e.lo - 5, haut = e.hi + 5;
      if ((nv < bas && nv < actuel) || (nv > haut && nv > actuel)) {
        return toast('Valeur hors de la plage des flèches : touchez la température pour la saisir', 'erreur');
      }
      rec[cle(e)] = nv;
      invalider();
      vibrer(UI.vibration.ok);
      await sauver();
      dessiner();
      if (etatTemp(e, nv) === 'crit') alerteCritique(e, nv);
    });

    $$('[data-hs]').forEach(b => b.onclick = async () => {
      const e = ENCEINTES.filter(x => x.id === b.dataset.hs)[0];
      /* HS puis HS de nouveau effaçait la température déjà relevée : on garde
         la valeur d'avant pour la remettre si l'on revient sur le HS.
         Gardée dans le relevé du jour (rec.avantHS), plus en mémoire vive :
         un rechargement de l'application la perdait (B5). null plutôt que
         delete : la fusion de « temp: » garderait sinon la valeur de la base.
         « avantHS » ne commence ni par m_ ni par s_ : il ne compte pas comme
         une mesure (releveMesure). */
      const memo = rec.avantHS || (rec.avantHS = {});
      const k = cle(e);
      if (rec[k] === 'HS') {
        rec[k] = (memo[k] !== undefined && memo[k] !== null) ? memo[k] : '';
        memo[k] = null;
      } else {
        memo[k] = saisi(e) ? rec[k] : null;
        rec[k] = 'HS';
      }
      invalider();
      await sauver();
      dessiner();
    });

    $$('[data-libre]').forEach(b => b.onclick = () => {
      const e = ENCEINTES.filter(x => x.id === b.dataset.libre)[0];
      showSheet(
        '<h2 id="sheet-titre">' + esc(e.nom) + '</h2>' +
        '<p class="sub">' + mom.label + ' · cible ' + esc(e.cible) + '</p>' +
        '<div class="champ"><label class="f">Température relevée (°C)</label>' +
        '<input type="number" step="0.1" id="tl" data-autofocus value="' +
        (val(e) === 'HS' ? '' : val(e)) + '" style="font-size:30px;text-align:center"></div>' +
        '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
        '<button class="btn menthe" id="tlok">Enregistrer</button></div>');
      $('#tlok').onclick = async () => {
        const v = $('#tl').value;
        if (v === '') return toast('Saisissez une température', 'erreur');
        rec[cle(e)] = num(v);
        invalider();
        await sauver();
        closeSheet();
        dessiner();
        if (etatTemp(e, num(v)) === 'crit') alerteCritique(e, num(v));
      };
    });

    /* L'action corrective entre dans rec à chaque frappe ; seule l'écriture est
       différée. Relue 600 ms plus tard, #obs pouvait être celui d'un autre jour
       (« Jour précédent » touché aussitôt) : son texte partait sous ce jour. Et
       « Valider » touché dans ce délai demandait une action déjà tapée. */
    const ecrireObs = debounce(sauver, 600);
    if ($('#obs')) $('#obs').oninput = ev => { rec.obs = ev.target.value; ecrireObs(); };

    $('#tvalider').onclick = async () => {
      const reste = manquants();
      const crit = ENCEINTES.filter(e => etatTemp(e, brut(e)) === 'crit');
      if (crit.length && !(rec.obs || '').trim()) {
        toast('Renseignez l’action corrective', 'erreur');
        if ($('#obs')) $('#obs').focus();
        return;
      }
      /* Aucune enceinte relevée : « Valider quand même » signait un registre
         vide, que Ma journée et la Tour de contrôle comptaient comme fait. */
      if (ENCEINTES.length && reste.length === ENCEINTES.length) {
        return toast('Aucune température relevée : relevez au moins une enceinte (ou marquez-la HS)', 'erreur');
      }
      if (reste.length) {
        confirmer('Valider avec ' + reste.length + ' enceinte(s) non relevée(s) ?',
          'Manquantes : ' + reste.map(e => e.nom).join(', ') + '. Un registre incomplet ' +
          'est contestable lors d’un contrôle.',
          'Valider quand même', finir);
        return;
      }
      finir();
    };

    async function finir() {
      rec.valide[mom.id] = { par:STATE.user.prenom, id:STATE.user.id, at:nowISO() };
      await sauver();
      await feed('ok', STATE.user.prenom + ' a validé les températures du ' + mom.label.toLowerCase());
      toast('Relevé du ' + mom.label.toLowerCase() + ' validé');
      /* Le manager revient à sa Tour de contrôle, pas à la vue équipier. */
      rendre(vueAccueil());
    }
  }

  dessiner();
};

/* =============================================================================
   I. BACK-OFFICE
   ========================================================================== */
V.parametres = async function () {
     const h = await DB.get('horaires', HORAIRES);
     Object.assign(HORAIRES, h);
     const ench = await DB.get('enceintes', null);
     if (ench) ENCEINTES = ench;
     const hebdo = await DB.get('hebdo', null);
   
     $('#page').innerHTML =
       carte(entete('🗓️', 'Tâches hebdomadaires', 'Qui fait quoi, et quel jour.') +
      '<p class="mini">Le tableau du mur, en numérique. L’équipier ne choisit rien : ' +
      'il voit les tâches du jour où il se connecte. Vous seul décidez du jour et, ' +
      'quand c’est utile, de la personne.</p>' +
      '<button class="btn clair bloc" id="hb-ouvrir" style="margin-top:14px">Organiser la semaine</button>' +
      '<button class="btn clair bloc" id="hb-resp" style="margin-top:8px">Attribuer les responsables</button>', 'solide') +

    carte(entete('🕐', 'Horaires', 'Bornes des phases de la journée dans « Ma journée ».') +
         '<div class="grid g2">' +
         '<div class="champ"><label class="f">Ouverture boutique</label><input type="time" id="h1" value="' + esc(HORAIRES.ouverture) + '"></div>' +
         '<div class="champ"><label class="f">Fermeture boutique</label><input type="time" id="h2" value="' + esc(HORAIRES.fermeture) + '"></div>' +
         '<div class="champ"><label class="f">Début phase ouverture</label><input type="time" id="h3" value="' + esc(HORAIRES.debutOuverture) + '"></div>' +
         '<div class="champ"><label class="f">Fin phase ouverture</label><input type="time" id="h4" value="' + esc(HORAIRES.finOuverture) + '"></div>' +
         '<div class="champ"><label class="f">Début phase fermeture</label><input type="time" id="h5" value="' + esc(HORAIRES.debutFermeture) + '"></div>' +
         '<div class="champ"><label class="f">Fin phase fermeture</label><input type="time" id="h6" value="' + esc(HORAIRES.finFermeture) + '"></div></div>' +
         '<button class="btn menthe bloc" id="hv" style="margin-top:14px">Enregistrer les horaires</button>', 'solide') +
   
       carte(entete('❄️', 'Unités frigorifiques', 'Nom, cible et plage de boutons du relevé de températures.') +
         '<div class="stack">' + ENCEINTES.map((e, i) =>
           '<div class="card plat"><div class="champ"><label class="f">Nom</label>' +
           '<input type="text" data-e="' + i + '.nom" value="' + esc(e.nom) + '"></div>' +
           '<div class="grid g3" style="margin-top:10px">' +
           '<div class="champ"><label class="f">Cible affichée</label><input type="text" data-e="' + i + '.cible" value="' + esc(e.cible) + '"></div>' +
           '<div class="champ"><label class="f">Vert de</label><input type="number" data-e="' + i + '.v0" value="' + esc(e.vert[0]) + '"></div>' +
           '<div class="champ"><label class="f">Vert à</label><input type="number" data-e="' + i + '.v1" value="' + esc(e.vert[1]) + '"></div></div>' +
           '<div class="grid g3" style="margin-top:10px">' +
           '<div class="champ"><label class="f">Critique au-dessus de</label><input type="number" data-e="' + i + '.crit" value="' + esc(e.crit) + '"></div>' +
           '<div class="champ"><label class="f">Bouton min</label><input type="number" data-e="' + i + '.lo" value="' + esc(e.lo) + '"></div>' +
           '<div class="champ"><label class="f">Bouton max</label><input type="number" data-e="' + i + '.hi" value="' + esc(e.hi) + '"></div></div>' +
           '<button class="btn fantome bloc sm" data-supp="' + i + '" style="margin-top:8px">Supprimer cette unité</button></div>').join('') + '</div>' +
         '<button class="btn clair bloc" id="ea" style="margin-top:12px">+ Ajouter une unité</button>' +
         '<button class="btn menthe bloc" id="ev" style="margin-top:8px">Enregistrer les unités</button>') +
   
       /* Une seconde carte « Tâches hebdomadaires » proposait ici un jour pour
          les tâches du plan de nettoyage et répondait « Jours enregistrés » :
          aucun écran ne lit ces jours (Tâches du jour et Nettoyage suivent
          « Organiser la semaine », ci-dessus). On ne garde que le rappel, en
          lecture, des tâches qui ont leur propre rythme. */
       carte(entete('🔁', 'Tâches à rythme propre', 'Hors tableau de la semaine : jours fixes ou intervalle.') +
         NETTOYAGE.asynchrones.map(a =>
           '<div class="tache"><span class="tx"><span class="tn">' + esc(a.nom) + '</span>' +
           '<span class="tm">' + (a.type === 'jours-fixes'
             ? a.jours.map(x => JOURS_SEMAINE[x]).join(', ')
             : 'tous les ' + a.intervalleJours + ' jours') + '</span></span></div>').join(''));
   
     $('#hv').onclick = async () => {
     /* Contrôle de cohérence avant d'enregistrer : un début de phase à 18:00
        et une fin à 09:00 étaient acceptés, et Ma journée ne trouvait plus la
        phase en cours. Les heures « HH:MM » se comparent comme du texte. */
     /* Une fin après minuit (09:30 → 00:30) est refusée, et c'est voulu : Ma
        journée (phaseCourante) et la date des saisies coupent la journée à
        minuit. Le message le dit et donne la parade, au lieu de laisser
        croire à une faute de frappe (B3). */
     const h = ['#h1', '#h2', '#h3', '#h4', '#h5', '#h6'].map(x => $(x).value);
     const apresMinuit = (de, a) => a < de && a <= '06:00';    // 22:00 → 00:30, pas 18:00 → 17:00
     if (h.some(x => !/^\d\d:\d\d$/.test(x))) return toast('Renseignez les six horaires', 'erreur');
     if (!(h[0] < h[1])) return toast(apresMinuit(h[0], h[1])
       ? 'Fermeture après minuit non prise en charge (' + h[0] + ' → ' + h[1] + ') : indiquez 23:59 au plus tard'
       : 'La boutique doit fermer après son ouverture (' + h[0] + ' → ' + h[1] + ')', 'erreur');
     if (!(h[2] < h[3])) return toast('La phase d’ouverture doit finir après son début (' + h[2] + ' → ' + h[3] + ')', 'erreur');
     if (!(h[3] <= h[4])) return toast('La phase de fermeture doit commencer après la fin de l’ouverture (' + h[3] + ')', 'erreur');
     if (!(h[4] < h[5])) return toast(apresMinuit(h[4], h[5])
       ? 'La phase de fermeture ne peut pas finir après minuit (' + h[4] + ' → ' + h[5] + ') : indiquez 23:59 au plus tard'
       : 'La phase de fermeture doit finir après son début (' + h[4] + ' → ' + h[5] + ')', 'erreur');
     Object.assign(HORAIRES, { ouverture:$('#h1').value, fermeture:$('#h2').value,
     debutOuverture:$('#h3').value, finOuverture:$('#h4').value,
     debutFermeture:$('#h5').value, finFermeture:$('#h6').value });
     PHASES[0].de = HORAIRES.debutOuverture; PHASES[0].a = HORAIRES.finOuverture;
     PHASES[1].de = HORAIRES.finOuverture;   PHASES[1].a = HORAIRES.debutFermeture;
     PHASES[2].de = HORAIRES.debutFermeture; PHASES[2].a = HORAIRES.finFermeture;
     await DB.set('horaires', HORAIRES);
     toast('Horaires enregistrés');
     };

  $('#hb-ouvrir').onclick = organiserSemaine;
  $('#hb-resp').onclick   = attribuerResponsables;
   
     $$('[data-supp]').forEach(b => b.onclick = () => {
       const e = ENCEINTES[+b.dataset.supp];
       confirmer('Supprimer ' + e.nom + ' ?',
         'L’unité disparaîtra du relevé de températures. L’historique déjà saisi est conservé.',
         'Supprimer', async () => {
           ENCEINTES.splice(+b.dataset.supp, 1);
           await DB.set('enceintes', ENCEINTES);
           toast('Unité supprimée'); rendre('parametres');
         });
     });
     $('#ea').onclick = async () => {
       /* Le redessin effaçait sans prévenir un nom ou une plage modifiés mais
          pas encore enregistrés : on les remet dans leurs champs, toujours à
          enregistrer avec « Enregistrer les unités ». */
       const enCours = {};
       $$('[data-e]').forEach(i => { enCours[i.dataset.e] = i.value; });
       ENCEINTES.push({ id:'u' + uid().slice(0, 4), nom:'Nouvelle unité', cible:'—',
                        lo:-24, hi:8, pas:1, vert:[-20, -17], crit:-15, zone:'boutique' });
       await DB.set('enceintes', ENCEINTES);
       await rendre('parametres');
       $$('[data-e]').forEach(i => { if (enCours[i.dataset.e] !== undefined) i.value = enCours[i.dataset.e]; });
     };
     $('#ev').onclick = async () => {
       $$('[data-e]').forEach(i => {
         const [k, f] = i.dataset.e.split('.');
         const e = ENCEINTES[+k];
         if (f === 'v0') e.vert[0] = num(i.value);
         else if (f === 'v1') e.vert[1] = num(i.value);
         else if (['crit','lo','hi'].indexOf(f) >= 0) e[f] = num(i.value);
         else e[f] = i.value;
       });
       await DB.set('enceintes', ENCEINTES);
       toast('Unités enregistrées');
     };
   };
   
   /* Organisation de la semaine : le manager déplace les tâches d'un jour à
   l'autre et désigne qui s'en charge. L'équipe ne voit que le résultat. */
async function organiserSemaine() {
  const plan = await planHebdo();
  const JOURS_COURTS = ['', 'L', 'M', 'M', 'J', 'V', 'S', 'D'];

  const rendreEditeur = () => {
    const programmees = plan.filter(t => !t.procedure && t.jours.length);
    const libres      = plan.filter(t => !t.procedure && !t.jours.length);
    const enProcedure = plan.filter(t => t.procedure);

    const ligne = t =>
      '<div class="card plat" style="margin-bottom:10px">' +
      '<b style="font-size:14px;line-height:1.3;display:block">' + esc(t.libelle) + '</b>' +
      '<div class="jours" style="margin-top:10px">' +
      [1,2,3,4,5,6,7].map(k =>
        '<button type="button" class="jbtn' + (t.jours.indexOf(k) >= 0 ? ' on' : '') +
        '" data-j="' + esc(t.id) + '.' + k + '">' + JOURS_COURTS[k] + '</button>').join('') + '</div>' +
      '<div class="champ" style="margin-top:10px"><label class="f">Attribuée à</label>' +
      '<select data-a="' + esc(t.id) + '"><option value="">— toute l’équipe —</option>' +
      EQUIPE.map(e => '<option value="' + esc(e.id) + '"' +
        (t.assignee === e.id ? ' selected' : '') + '>' + esc(e.prenom) + '</option>').join('') +
      '</select></div></div>';

    $('#sheet-corps').innerHTML =
      '<h2 id="sheet-titre">Organiser la semaine</h2>' +
      '<p class="sub">Cochez les jours où chaque tâche doit être faite.</p>' +

      '<div style="max-height:58vh;overflow:auto">' +

      '<div class="entete"><h3>Programmées</h3>' +
      '<span class="pousse mini num">' + programmees.length + '</span></div>' +
      (programmees.length ? programmees.map(ligne).join('') : '<p class="mini">Aucune</p>') +

      '<div class="entete"><h3>Non programmées</h3>' +
      '<span class="pousse mini num">' + libres.length + '</span></div>' +
      (libres.length ? libres.map(ligne).join('') : '<p class="mini">Aucune</p>') +

      (enProcedure.length
        ? '<div class="entete"><h3>Déjà faites chaque jour</h3></div>' +
          '<p class="mini" style="margin-bottom:10px">Ces postes figurent dans la procédure ' +
          'd’ouverture ou de fermeture. Les programmer ici les ferait demander deux fois.</p>' +
          enProcedure.map(t =>
            '<div class="tache"><span class="tx"><span class="tn">' + esc(t.libelle) + '</span>' +
            '<span class="tm">Procédure ' + (t.procedure === 'ouverture' ? 'd’ouverture' : 'de fermeture') +
            '</span></span></div>').join('')
        : '') +

      '</div>' +
      '<div class="actions"><button class="btn clair" id="os-x">Annuler</button>' +
      '<button class="btn menthe" id="os-ok">Enregistrer</button></div>' +
      '<button class="btn fantome bloc" id="os-raz" style="margin-top:8px">' +
      'Rétablir le tableau d’origine</button>';

    $('#os-x').onclick = closeSheet;

    $$('[data-j]').forEach(b => b.onclick = () => {
      const [id, k] = b.dataset.j.split('.');
      const t = plan.filter(x => x.id === id)[0];
      if (!t) return;
      const n = +k, i = t.jours.indexOf(n);
      if (i >= 0) t.jours.splice(i, 1); else t.jours.push(n);
      t.jours.sort();
      b.classList.toggle('on', i < 0);
    });
    $$('[data-a]').forEach(s => s.onchange = () => {
      const t = plan.filter(x => x.id === s.dataset.a)[0];
      if (t) t.assignee = s.value || null;
    });

    $('#os-ok').onclick = async () => {
      const out = {};
      plan.forEach(t => { out[t.id] = { jours:t.jours, assignee:t.assignee || null }; });
      await DB.set('hebdo:plan', out);
      TACHES_HEBDO.forEach(t => { if (out[t.id]) Object.assign(t, out[t.id]); });
      await feed('ok', STATE.user.prenom + ' a réorganisé les tâches de la semaine');
      closeSheet();
      toast('Semaine enregistrée');
      rendre('parametres');
    };

    $('#os-raz').onclick = () => confirmer('Rétablir le tableau d’origine ?',
      'Les jours et les attributions reviendront à la transcription du tableau ' +
      'affiché en boutique. Les tâches déjà validées ne sont pas touchées.',
      'Rétablir', async () => {
        await DB.del('hebdo:plan');
        TACHES_HEBDO = TACHES_HEBDO_DEF.map(t => Object.assign({}, t, { jours:(t.jours || []).slice() }));
        closeSheet(); toast('Tableau rétabli'); rendre('parametres');
      },
      /* La confirmation occupe la même feuille : « Annuler » fermait tout et
         perdait l'organisation en cours. On y revient, bascules comprises. */
      () => rendreEditeur());
  };

  showSheet('<div class="vide">Chargement…</div>');
  rendreEditeur();
}

/* Les trois responsabilités de la semaine, en bas du tableau du mur */
async function attribuerResponsables() {
  const resp = await DB.get('hebdo:responsables', {}) || {};
  showSheet(
    '<h2 id="sheet-titre">Responsables de la semaine</h2>' +
    '<p class="sub">Trois rôles à désigner, comme au bas du tableau.</p>' +
    RESPONSABLES.map(r =>
      '<div class="champ" style="margin-top:14px"><label class="f">' + r.icone + ' ' + esc(r.libelle) + '</label>' +
      '<select data-r="' + esc(r.id) + '"><option value="">— personne —</option>' +
      EQUIPE.map(e => '<option value="' + esc(e.id) + '"' +
        (resp[r.id] === e.id ? ' selected' : '') + '>' + esc(e.prenom) + '</option>').join('') +
      '</select></div>').join('') +
    '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
    '<button class="btn menthe" id="ar-ok">Enregistrer</button></div>');

  $('#ar-ok').onclick = async () => {
    const out = {};
    $$('[data-r]').forEach(s => { if (s.value) out[s.dataset.r] = s.value; });
    await DB.set('hebdo:responsables', out);
    await feed('ok', STATE.user.prenom + ' a désigné les responsables de la semaine');
    closeSheet();
    toast('Responsables enregistrés');
    rendre('parametres');
  };
}

/* =============================================================================
   P. NETTOYAGE — le tableau hebdomadaire, et rien d'autre
   L'écran montre les tâches du jour telles qu'elles figurent sur le tableau
   affiché en boutique. Un jour, une colonne. Le registre quotidien des postes
   7/7 reste dans l'historique mais n'encombre plus cet écran.
   ========================================================================== */
V.clean = async function () {
  const j = STATE.jour;
  const taches = await tachesHebdoDuJour(j);
  const rec = await DB.get('hebdo:' + j, {});
  const preuves = (await DB.get('preuves:' + j, [])).filter(p => !p.supprime);
  const photosDe = id => preuves.filter(p => p.tache === id);
  const faits = taches.filter(t => rec[t.id] && rec[t.id].ok).length;

  $('#vue-actions').innerHTML = '';

  $('#page').innerHTML =
    navJour(j) +
    /* L'avancement tient dans une bande plutôt que dans une carte à moitié
       vide : une ligne de texte et une jauge ne justifiaient pas soixante
       pixels de hauteur à elles seules. */
    '<div class="avanc"><span>' + (taches.length
      ? faits + ' sur ' + taches.length + ' tâches faites'
      : 'Aucune tâche prévue ce jour') + '</span>' +
    (taches.length
      ? '<div class="jauge"><i style="width:' +
        Math.round(faits / taches.length * 100) + '%"></i></div>'
      : '') + '</div>' +

    (taches.length
      ? '<div class="stack" style="margin-top:12px">' + taches.map((t, i) => {
          const v = rec[t.id] || {};
          const ph = photosDe(t.id);
          const qui = t.assignee ? (EQUIPE.filter(e => e.id === t.assignee)[0] || {}).prenom : null;
          return carte(
            '<div class="tache' + (v.ok ? ' on' : '') + '">' +
            '<span class="tnum">' + (i + 1) + '</span>' +
            '<button class="box" data-hb="' + esc(t.id) + '">✓</button>' +
            '<span class="tx"><span class="tn">' + esc(t.libelle) + '</span>' +
            '<span class="tm">' + (v.ok ? esc(v.par) + ' · ' + heure(v.at)
              : (qui ? 'Attribuée à ' + esc(qui) : 'Photo obligatoire')) +
            (ph.length ? ' · ' + ph.length + ' photo(s)' : '') + '</span></span>' +
            '<button class="btn ' + (ph.length ? 'menthe' : 'clair') + ' sm" data-hbp="' + esc(t.id) + '"' +
            (ph.length >= HEBDO.photosMax ? ' disabled' : '') + '>' +
            (ph.length ? '✓ Photo' : 'Photo') + '</button></div>' +
            /* Vignettes communes, cliquables (voir en grand, supprimer). */
            vignettes(ph, j),
            v.ok ? 'menthe' : '');
        }).join('') + '</div>'
      : vide('', 'Rien de prévu au tableau ce jour.'));

  brancherNavJour('clean');
  brancherVignettes(() => rendre('clean'), !peutModifier(j));
  if (!peutModifier(j)) return;

  $$('[data-hbp]').forEach(b => b.onclick = async () => {
    const t = taches.filter(x => x.id === b.dataset.hbp)[0];
    const p = await attacherPreuve(j, t.id, t.libelle);
    if (p) { toast('Photo ajoutée'); rendre('clean'); }
  });

  $$('[data-hb]').forEach(b => b.onclick = async () => {
    const id = b.dataset.hb, actif = !(rec[id] && rec[id].ok);
    if (actif && HEBDO.photosObligatoires && photosDe(id).length < HEBDO.photosMin) {
      toast('Photographiez d’abord le résultat', 'erreur');
      const ph = $('[data-hbp="' + id + '"]');
      if (ph) ph.click();
      return;
    }
    rec[id] = actif ? { ok:1, par:STATE.user.prenom, employe:STATE.user.id, at:nowISO() } : { ok:0 };
    await DB.set('hebdo:' + j, rec);
    if (actif) {
      const t = taches.filter(x => x.id === id)[0];
      await feed('ok', STATE.user.prenom + ' : ' + t.libelle);
    }
    rendre('clean');
  });
};

/* =============================================================================
   O. ANOMALIES
   Tout ce qui ne rentre dans aucun registre : une panne, un carreau cassé, un
   client mécontent. Sans cet endroit, ces choses se disent à l'oral et se
   perdent — ou finissent dans le carnet de relève, où personne ne les suit.
   ========================================================================== */
PAGES.anomalie = { titre:'Anomalie', sous:'Signaler un problème constaté en boutique' };

V.anomalie = async function () {
  const liste = (await DB.get('anomalies', [])).slice().reverse();
  const ouvertes = liste.filter(a => !a.resolue);
  const traitees = liste.filter(a => a.resolue).slice(0, 10);

  $('#vue-actions').innerHTML = '';
  $('#page').innerHTML =
    carte('<h2>Signaler un problème</h2>' +
      '<div class="cs">Panne, casse, produit non conforme, incident client.</div>' +
      '<button class="btn corail bloc xl" id="an-new" style="margin-top:14px">Signaler</button>', 'solide') +

    (ouvertes.length
      ? '<div class="entete"><h3>En cours</h3><span class="pousse mini num">' + ouvertes.length + '</span></div>' +
        '<div class="stack">' + ouvertes.map(carteAnomalie).join('') + '</div>'
      : carte('<div class="alerte ok"><span class="ai">•</span><div><b>Aucune anomalie en cours</b>' +
        '<p>Tout ce qui a été signalé a été traité.</p></div></div>', 'plat')) +

    (traitees.length
      ? '<div class="entete"><h3>Traitées</h3></div><div class="stack">' +
        traitees.map(carteAnomalie).join('') + '</div>'
      : '');

  $('#an-new').onclick = formulaireAnomalie;
  /* Photo en grand, avec la possibilité de la retirer du signalement. */
  $$('[data-anoph]').forEach(im => im.onclick = async () => {
    const l = await DB.get('anomalies', []);
    const a = l.filter(x => x.id === im.dataset.anoph)[0];
    if (!a || !a.photo) return;
    const plein = document.createElement('div');
    plein.className = 'photo-plein';
    plein.innerHTML = '<img src="' + esc(a.photo) + '" alt="">' +
      '<div class="pp-barre">' +
      '<button type="button" class="btn clair sm" data-pp-fermer>Fermer</button>' +
      (a.resolue ? '' : '<button type="button" class="btn corail sm" data-pp-suppr>Retirer la photo</button>') +
      '</div>';
    document.body.appendChild(plein);
    plein.querySelector('[data-pp-fermer]').onclick = () => plein.remove();
    const bs = plein.querySelector('[data-pp-suppr]');
    if (bs) bs.onclick = () => {
      plein.remove();
      confirmer('Retirer la photo ?',
        'Le signalement « ' + (a.titre || '') + ' » restera, sans son illustration.',
        'Retirer', async () => {
          const l2 = await DB.get('anomalies', []);
          const a2 = l2.filter(x => x.id === a.id)[0];
          if (a2) delete a2.photo;
          await DB.set('anomalies', l2);
          await feed('warn', STATE.user.prenom + ' a retiré la photo de : ' + a.titre);
          toast('Photo retirée');
          rendre('anomalie');
        });
    };
  });
  /* Un seul appui, sans confirmation, et ouvert à toute l'équipe : un
     signalement quittait « En cours » avant que le manager l'ait vu. On
     confirme, et l'équipier ne clôt que ce qu'il a lui-même signalé. */
  $$('[data-res]').forEach(b => b.onclick = () => {
    const vue = liste.filter(x => x.id === b.dataset.res)[0];
    if (!vue || !peutClore(vue)) return;
    confirmer('Marquer comme traitée ?',
      '« ' + (vue.titre || '') + ' » passera dans « Traitées »' +
      (STATE.user.role === 'manager' ? '.' : ' et ne sera plus suivi par ' +
        (typeof nomManager === 'function' ? nomManager() : 'le manager') + '.'),
      'Marquer traitée', async () => {
        const l = await DB.get('anomalies', []);
        const a = l.filter(x => x.id === b.dataset.res)[0];
        if (a) { a.resolue = true; a.resoluePar = STATE.user.prenom; a.resolueAt = nowISO(); }
        await DB.set('anomalies', l);
        if (a) await feed('ok', STATE.user.prenom + ' a traité : ' + a.titre);
        rendre('anomalie');
      });
  });
};

/* Le manager clôt tout signalement ; l'équipier, seulement les siens. */
function peutClore(a) {
  if (!STATE.user || !a) return false;
  return STATE.user.role === 'manager' || (!!a.employe && a.employe === STATE.user.id);
}

function carteAnomalie(a) {
  const c = ANOMALIES.categories.filter(x => x.id === a.categorie)[0] || ANOMALIES.categories[6];
  const g = ANOMALIES.gravites.filter(x => x.id === a.gravite)[0] || ANOMALIES.gravites[2];
  return carte(
    '<div class="rang" style="align-items:flex-start">' +
    '<div style="flex:1;min-width:0"><b>' + esc(a.titre) + '</b>' +
    '<div class="mini" style="margin-top:3px">' + esc(c.libelle) + '</div>' +
    (a.detail ? '<p class="mini" style="margin-top:4px">' + esc(a.detail) + '</p>' : '') +
    '<div class="mini" style="margin-top:4px">' + esc(a.par) + ' · ' + fmtDC(a.jour) + ' ' + heure(a.at) +
    (a.resolue ? ' · traitée par ' + esc(a.resoluePar) : '') + '</div></div>' +
    pastille(a.resolue ? 'n' : g.couleur, a.resolue ? 'Traitée' : g.id) + '</div>' +
    /* Cliquable : l'aperçu est rogné en hauteur, et c'est justement le détail
       qu'on a photographié — une fuite, un joint, une pièce cassée — qu'on a
       besoin de voir en entier. */
    (a.photo ? '<img src="' + esc(a.photo) + '" alt="" data-anoph="' + esc(a.id) + '" ' +
      'style="width:100%;max-height:190px;object-fit:cover;border-radius:10px;' +
      'margin-top:10px;cursor:pointer">' : '') +
    (a.resolue || !peutClore(a) ? '' : '<button class="btn clair bloc sm" data-res="' + esc(a.id) +
      '" style="margin-top:10px">Marquer comme traitée</button>'),
    a.resolue ? 'plat' : (g.couleur === 'bad' ? 'corail' : g.couleur === 'warn' ? 'ambre' : ''));
}

function formulaireAnomalie() {
  let categorie = null, gravite = 'gene', photo = null;
  const memo = { titre:'', detail:'' };
  const garder = () => {
    if ($('#an-t')) memo.titre = $('#an-t').value.trim();
    if ($('#an-d')) memo.detail = $('#an-d').value.trim();
  };

  const dessiner = () => {
    $('#sheet-corps').innerHTML =
      '<h2 id="sheet-titre">Signaler un problème</h2>' +
      '<p class="sub">' + esc((m => m.charAt(0).toUpperCase() + m.slice(1))(typeof nomManager === 'function' ? nomManager() : 'le manager')) + ' le verra immédiatement dans sa tour de contrôle.</p>' +

      '<div class="entete"><h3>De quoi s’agit-il ?</h3></div>' +
      '<div class="chips" id="an-cat">' + ANOMALIES.categories.map(c =>
        '<button type="button" class="chip' + (categorie === c.id ? ' on' : '') +
        '" data-c="' + c.id + '">' + esc(c.libelle) + '</button>').join('') + '</div>' +

      '<div class="champ" style="margin-top:16px"><label class="f">En une phrase</label>' +
      '<input type="text" id="an-t" value="' + esc(memo.titre) + '" placeholder="Ex. la crêpière ne chauffe plus"></div>' +

      '<div class="champ" style="margin-top:14px"><label class="f">Détail (facultatif)</label>' +
      '<textarea id="an-d" placeholder="Depuis quand, ce qui a été tenté, conséquence sur le service.">' +
      esc(memo.detail) + '</textarea>' +
      '<p class="mini" style="margin-top:6px">' + esc(CONSIGNE_TEXTE_LIBRE) + '</p></div>' +

      '<div class="entete"><h3>Gravité</h3></div>' +
      '<div class="stack">' + ANOMALIES.gravites.map(g =>
        '<button type="button" class="menu-item" data-g="' + g.id + '"' +
        (gravite === g.id ? ' style="border-color:var(--encre);border-width:1.5px"' : '') + '>' +
        '<span class="mi-tx"><span class="mi-t">' + esc(g.libelle) + '</span></span>' +
        '<span class="mi-fl">' + (gravite === g.id ? '✓' : '') + '</span></button>').join('') + '</div>' +

      '<button class="btn ' + (photo ? 'menthe' : 'ciel') + ' bloc" id="an-ph" style="margin-top:14px">' +
      (photo ? '✓ Photo jointe — en reprendre une' : 'Photographier le problème') + '</button>' +
      /* On peut la voir en grand et la retirer : une photo ratée ne doit pas
         rester attachée à un signalement qu'on transmet au manager. */
      (photo
        ? '<img src="' + photo + '" alt="" id="an-apercu" style="width:100%;max-height:200px;' +
          'object-fit:cover;border-radius:10px;margin-top:10px;cursor:pointer">' +
          '<button class="btn fantome bloc sm" id="an-ph-suppr" style="margin-top:6px">' +
          'Retirer la photo</button>'
        : '') +

      '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
      '<button class="btn corail" id="an-ok">Signaler</button></div>';

    $$('#sheet-corps [data-fermer]').forEach(b => b.onclick = closeSheet);
    $$('#an-cat [data-c]').forEach(b => b.onclick = () => { garder(); categorie = b.dataset.c; dessiner(); });
    $$('[data-g]').forEach(b => b.onclick = () => { garder(); gravite = b.dataset.g; dessiner(); });
    $('#an-ph').onclick = async () => {
      garder();
      const p = await prendrePhoto();
      if (p) photo = p.img;
      dessiner();
    };
    /* Voir en grand : l'aperçu est rogné, on ne vérifie pas dessus qu'on a bien
       cadré la fuite ou la pièce cassée. */
    const ap = $('#an-apercu');
    if (ap) ap.onclick = () => {
      const plein = document.createElement('div');
      plein.className = 'photo-plein';
      plein.innerHTML = '<img src="' + photo + '" alt="">' +
        '<button type="button" class="pp-fermer" aria-label="Fermer">✕</button>';
      plein.onclick = () => plein.remove();
      document.body.appendChild(plein);
    };
    const sup = $('#an-ph-suppr');
    if (sup) sup.onclick = () => {
      garder();
      photo = null;
      dessiner();
      toast('Photo retirée');
    };
    $('#an-ok').onclick = async () => {
      garder();
      if (!categorie) return toast('Choisissez une catégorie', 'erreur');
      if (!memo.titre) return toast('Décrivez le problème en une phrase', 'erreur');
      await DB.push('anomalies', { id:uid(), categorie:categorie, gravite:gravite,
        titre:memo.titre, detail:memo.detail, photo:photo, jour:today(),
        par:STATE.user.prenom, employe:STATE.user.id, at:nowISO(), resolue:false });
      await feed(gravite === 'bloquant' ? 'bad' : 'warn',
        STATE.user.prenom + ' signale : ' + memo.titre);
      closeSheet();
      toast(messageEnvoi('anomalies', 'Signalement transmis'));
      rendre('anomalie');
    };
  };

  showSheet('<div class="vide">…</div>');
  dessiner();
}

/* =============================================================================
   J. RESTAURATION DES RÉGLAGES AU DÉMARRAGE
   ========================================================================== */
   /* Les réglages partagés sont relus périodiquement, pas une seule fois au
      démarrage. Sans cela, un manager qui réorganise la semaine ou change une
      enceinte sur son iPad laissait toute l'équipe sur l'ancienne version
      jusqu'à ce que chacun ferme et rouvre l'application — ce que personne ne
      fait en plein service. */
   async function appliquerReglages() {
     try {
       const h = await DB.get('horaires', null);
       if (h) {
         Object.assign(HORAIRES, h);
         PHASES[0].de = HORAIRES.debutOuverture; PHASES[0].a = HORAIRES.finOuverture;
         PHASES[1].de = HORAIRES.finOuverture;   PHASES[1].a = HORAIRES.debutFermeture;
         PHASES[2].de = HORAIRES.debutFermeture; PHASES[2].a = HORAIRES.finFermeture;
       }
       const e = await DB.get('enceintes', null);
       if (e && e.length) ENCEINTES = e;
       const hb = await DB.get('hebdo', null);
       if (hb) NETTOYAGE.zones.forEach(z => z.taches.forEach(t => { if (hb[t.id]) t.jours = hb[t.id]; }));
       /* Plan hebdomadaire décidé par le manager. On repart de la référence
          d'usine avant d'appliquer : sinon une tâche retirée du plan gardait
          ses anciens jours, puisqu'on ne faisait qu'ajouter par-dessus. */
       const plan = await DB.get('hebdo:plan', null);
       TACHES_HEBDO = TACHES_HEBDO_DEF.map(t => Object.assign({}, t));
       if (plan) TACHES_HEBDO.forEach(t => { if (plan[t.id]) Object.assign(t, plan[t.id]); });
     } catch (err) { /* réglages d'usine */ }
   }
   appliquerReglages();
   /* Toutes les deux minutes : assez pour qu'un changement de planning arrive
      dans la même heure, assez peu pour ne rien coûter en réseau. */
   setInterval(appliquerReglages, 120000);
   /* Et immédiatement quand on revient sur l'application. */
   document.addEventListener('visibilitychange', function () {
     if (document.visibilityState === 'visible') appliquerReglages();
   });
   
   /* =============================================================================
      K. INVENTAIRE GLACE — plusieurs tailles pour un même parfum
      La chambre froide contient couramment de la pistache en 5 L et en 3 L.
      L'ancien modèle imposait une taille unique par parfum : le comptage était
      donc faux dès qu'un parfum existait en deux formats.
      Nouveau modèle : rec.l['p3'] = { t:{ '3':2, '5':7 }, ent:1.5 }
      ========================================================================== */
   function migrerInventaire(rec) {
     /* Conversion silencieuse de l'ancien format vers le nouveau */
     Object.keys(rec.l || {}).forEach(k => {
       const v = rec.l[k];
       if (v && v.t === undefined && (v.taille !== undefined || v.n !== undefined)) {
         const taille = String(num(v.taille) || FOURNISSEUR.tailleParDefaut);
         rec.l[k] = { t: num(v.n) ? { [taille]: num(v.n) } : {}, ent: v.ent };
       }
       if (rec.l[k] && !rec.l[k].t) rec.l[k].t = {};
     });
     return rec;
   }
   
   async function invGlace(per) {
     const cle = 'invglace:' + per.id;
     const rec = migrerInventaire(await DB.get(cle, { l:{}, valide:false }));
     if (!rec.l) rec.l = {};
   
     const ligne = i => rec.l['p' + i] || { t:{}, ent:'' };
     const calc = () => {
       let bacs = 0, litres = 0;
       PARFUMS.forEach((p, i) => {
         const v = ligne(i);
         TAILLES_BAC.forEach(t => { const n = num(v.t[t]); bacs += n; litres += n * t; });
         litres += num(v.ent);
       });
       return { bacs, litres, kg: litres * FOURNISSEUR.poidsMoyenLitre };
     };
     const c = calc();
     const parTaille = t => PARFUMS.reduce((s, p, i) => s + num(ligne(i).t[t]), 0);
   
     $('#page').innerHTML =
       carte(entete('🍦', 'Inventaire glace · ' + libellePeriode(per),
         'Un parfum peut exister en plusieurs formats : saisissez chaque taille séparément.') +
         (rec.valide
           ? '<div class="alerte ok"><span class="ai">•</span><div><b>Validé</b><p>' + esc(rec.par) + ' · ' +
             fmtD(rec.jour) + ' ' + heure(rec.at) + ' — ' + rec.bacs + ' bacs, ' + n1(rec.kg) + ' kg</p></div>' +
             '<span class="go"><button class="btn clair sm" id="rouvrir">Rouvrir</button></span></div>'
           : '<div class="grid g3">' +
             kpi('Bacs comptés', '<span id="tb">' + c.bacs + '</span>', '', 'Toutes tailles') +
             kpi('Litres', '<span id="tl">' + n1(c.litres) + '</span>', '', 'Bacs + entamés') +
             kpi('Poids', '<span id="tk">' + n1(c.kg) + '</span><span class="u">kg</span>', '', 'Stock réel') + '</div>' +
             '<div class="dense" style="margin-top:14px"><div class="dense-h"><span class="c1">Répartition</span>' +
             TAILLES_BAC.map(t => '<span class="c w">' + t + ' L</span>').join('') + '</div>' +
             '<div class="dl"><span class="c1">Nombre de bacs</span>' +
             TAILLES_BAC.map(t => '<span class="c w num" data-pt="' + t + '">' + parTaille(t) + '</span>').join('') +
             '</div></div>'), 'solide') +
   
       '<div class="entete"><h3>Parfums</h3><span class="pousse mini">' + PARFUMS.length + '</span></div>' +
       '<div class="stack">' + PARFUMS.map((p, i) => {
         const v = ligne(i);
         const tot = TAILLES_BAC.reduce((s, t) => s + num(v.t[t]), 0);
         const lit = TAILLES_BAC.reduce((s, t) => s + num(v.t[t]) * t, 0) + num(v.ent);
         return carte(
           '<div class="rang"><b style="flex:1">' + esc(p) + '</b>' +
           (tot ? pastille('ok', tot + ' bac' + (tot > 1 ? 's' : '')) : pastille('n', '—')) +
           '<span class="mini num" data-lg="p' + i + '">' + n1(lit) + ' L</span></div>' +
           '<div class="grid g4" style="margin-top:12px;gap:8px">' +
           TAILLES_BAC.map(t =>
             '<div class="champ"><label class="f">' + t + ' L</label>' +
             '<input type="number" min="0" step="1" aria-label="' + esc(p) + ', bacs de ' + t + ' L" data-g="p' + i + '.' + t + '" value="' +
             (v.t[t] === undefined || v.t[t] === '' ? '' : v.t[t]) + '"' + (rec.valide ? ' disabled' : '') + '></div>').join('') +
           '</div>' +
           '<div class="champ" style="margin-top:10px"><label class="f">Entamé, tous formats confondus (L)</label>' +
           '<input type="number" min="0" step="0.5" aria-label="' + esc(p) + ', entamé, tous formats confondus (L)" data-e="p' + i + '" value="' +
           (v.ent === undefined ? '' : v.ent) + '"' + (rec.valide ? ' disabled' : '') + '></div>',
           tot ? 'menthe' : '');
       }).join('') + '</div>' +
   
       (rec.valide ? '' : carte(entete('✅', 'Confirmation du comptage',
         'Recomptez les bacs présents toutes chambres et tous formats confondus.') +
         '<div class="grid g2"><div class="champ"><label class="f">Total recompté</label>' +
         '<input type="number" min="0" id="cf" placeholder="Ex. 120"></div>' +
         '<div class="champ"><label class="f">Total calculé</label>' +
         '<input type="text" id="cc" value="' + c.bacs + '" readonly></div></div>' +
         '<button class="btn menthe bloc xl" id="val" style="margin-top:16px">Valider l’inventaire</button>' +
         '<div id="vm" style="margin-top:14px"></div>', 'ambre'));
   
     const refresh = () => {
       $$('[data-g]').forEach(inp => {
         const [k, t] = inp.dataset.g.split('.');
         if (!rec.l[k]) rec.l[k] = { t:{}, ent:'' };
         if (!rec.l[k].t) rec.l[k].t = {};
         rec.l[k].t[t] = inp.value;
       });
       $$('[data-e]').forEach(inp => {
         const k = inp.dataset.e;
         if (!rec.l[k]) rec.l[k] = { t:{}, ent:'' };
         rec.l[k].ent = inp.value;
       });
       PARFUMS.forEach((p, i) => {
         const v = ligne(i);
         const lit = TAILLES_BAC.reduce((s, t) => s + num(v.t[t]) * t, 0) + num(v.ent);
         const el = $('[data-lg="p' + i + '"]');
         if (el) el.textContent = n1(lit) + ' L';
       });
       const c2 = calc();
       if ($('#tb')) { $('#tb').textContent = c2.bacs; $('#tl').textContent = n1(c2.litres); $('#tk').textContent = n1(c2.kg); }
       TAILLES_BAC.forEach(t => { const e = $('[data-pt="' + t + '"]'); if (e) e.textContent = parTaille(t); });
       if ($('#cc')) $('#cc').value = c2.bacs;
       DB.set(cle, rec);
     };
     $$('[data-g],[data-e]').forEach(i => { i.oninput = refresh; i.onchange = refresh; });
   
     const rv = $('#rouvrir');
     if (rv) rv.onclick = () => confirmer('Rouvrir l’inventaire ?',
       'Les chiffres redeviennent modifiables et la clôture de période sera bloquée.',
       'Rouvrir', async () => { rec.valide = false; await DB.set(cle, rec); rendre('inv'); });
   
     const vb = $('#val');
     if (vb) vb.onclick = async () => {
       const c2 = calc(), saisi = num($('#cf').value);
       if ($('#cf').value === '') {
         $('#vm').innerHTML = '<div class="alerte warn"><span class="ai">●</span><div><b>Confirmation manquante</b>' +
           '<p>Saisissez le nombre total de bacs recomptés.</p></div></div>';
         return;
       }
       if (saisi !== c2.bacs) {
         $('#vm').innerHTML = '<div class="alerte bad"><span class="ai">▲</span><div><b>Les comptages ne correspondent pas</b>' +
           '<p>Vous avez compté ' + saisi + ' bacs, l’application en totalise ' + c2.bacs + '. ' +
           'Détail par format : ' + TAILLES_BAC.map(t => parTaille(t) + ' en ' + t + ' L').join(', ') +
           '. Recomptez ou corrigez avant de valider.</p></div></div>';
         vibrer(UI.vibration.erreur);
         return;
       }
       const par = {}; TAILLES_BAC.forEach(t => par[t] = parTaille(t));
       let ent = 0;
       PARFUMS.forEach((p, i) => ent += num(ligne(i).ent));
       Object.assign(rec, { valide:true, par:STATE.user.prenom, jour:today(), at:nowISO(),
                            bacs:c2.bacs, litres:c2.litres, kg:c2.kg, parTaille:par });
       await DB.set(cle, rec);
       await DB.patch('ecart:' + per.id, { fin:{ bacs:par, entames:ent, kg:c2.kg } });
       await feed('ok', STATE.user.prenom + ' a validé l’inventaire glace (' + c2.bacs + ' bacs, ' + n1(c2.kg) + ' kg)');
       toast('Inventaire validé et reporté dans les écarts');
       rendre('inv');
     };
   }
   
   /* =============================================================================
      L. DIAGNOSTIC DE SYNCHRONISATION
      Ajouté à Réglages : au lieu d'un bandeau qui dit « Table introuvable » sans
      dire laquelle, on affiche la dernière requête refusée et un bouton de test.
      ========================================================================== */
   /* La version d'app.js a été retirée lors du nettoyage du code mort. Or cette
      vue-ci la COMPLÈTE au lieu de la remplacer : elle ajoute le bloc Diagnostic
      sous les réglages existants. Sans garde, l'écran ne s'ouvrait plus du tout
      — « Cannot read properties of undefined (reading 'call') ».
      On dessine donc les réglages nous-mêmes si la version d'origine a disparu. */
   const V_reglages_origine = V.reglages;
   V.reglages = async function () {
     if (typeof V_reglages_origine === 'function') {
       await V_reglages_origine.call(this);
     } else {
       $('#vue-actions').innerHTML = '';
       $('#page').innerHTML =
         carte('<h2>Réglages</h2><div class="cs">Paramètres de la boutique ' +
           esc(APP.site) + ' · version ' + esc(APP.version) + '.</div>' +
           '<button class="btn clair bloc" data-go="parametres" style="margin-top:14px">' +
           'Back-office — tâches, horaires et unités froides</button>' +
           '<button class="btn clair bloc" data-go="equipe" style="margin-top:8px">Équipe</button>',
           'solide');
       $$('#page [data-go]').forEach(b => b.onclick = () => rendre(b.dataset.go));
     }
     const page = $('#page');
     if (!page) return;
   
     const bloc = document.createElement('div');
     bloc.innerHTML = carte(entete('🩺', 'Diagnostic de la base',
       'Ce que l’application a réellement envoyé et reçu.') +
       '<div class="dense"><div class="dl"><span class="c1">Projet</span>' +
       '<span class="c ww">' + esc(String(SUPABASE.url).replace('https://', '').split('.')[0] || 'non configuré') + '</span></div>' +
       /* Présence seulement : le début de la clé n'aide pas au diagnostic et
          s'affichait à quiconque regardait l'écran. */
       '<div class="dl"><span class="c1">Clé</span><span class="c ww">' +
       (SUPABASE.anonKey ? 'présente (masquée)' : 'absente') + '</span></div>' +
       '<div class="dl"><span class="c1">File d’attente</span><span class="c ww num">' + STATE.fileAttente + '</span></div>' +
       '<div class="dl"><span class="c1">Dernière erreur</span><span class="c ww">' +
       (STATE.erreurBase ? esc(STATE.erreurBase) : 'aucune') + '</span></div>' +
       (STATE.dernierEchec
       ? '<div class="dl"><span class="c1">Requête refusée</span><span class="c ww">' +
       esc(STATE.dernierEchec.methode + ' ' + STATE.dernierEchec.chemin) + '</span></div>' +
       '<div class="dl"><span class="c1">Code HTTP</span><span class="c ww num">' + STATE.dernierEchec.status + '</span></div>' +
         (STATE.dernierEchec.motif
             ? '<div class="dl"><span class="c1">Motif renvoyé</span><span class="c ww">' +
            esc(STATE.dernierEchec.motif.slice(0, 120)) + '</span></div>' : '')
      : '') +
    '</div>' +
    (Object.keys(DB._gros || {}).length
      ? '<div class="alerte warn" style="margin-top:12px"><span class="ai">●</span><div>' +
        '<b>' + Object.keys(DB._gros).length + ' donnée(s) trop lourde(s) pour la base</b>' +
        '<p>' + esc(Object.keys(DB._gros).slice(0, 4).join(', ')) + '. Ces éléments — des ' +
        'journées de photos, en pratique — restent sur cet appareil et ne remonteront pas. ' +
        'Le passage à Supabase Storage réglera ce point.</p></div></div>'
      : '') +
       /* Mode local : aucune base, rien à tester — le test envoyait des
          requêtes vers « /rest/v1/… » sur l'hôte de l'application. */
       (DB.configure
         ? '<button class="btn clair bloc" id="dg-test" style="margin-top:14px">Tester lecture et écriture</button>'
         : '<p class="mini" style="margin-top:14px">Mode local : aucune base configurée, rien à tester.</p>') +
       '<div id="dg-res" style="margin-top:12px"></div>' +
       '<button class="btn fantome bloc" id="dg-purge" style="margin-top:8px">Vider la file d’attente</button>', 'plat');
     page.appendChild(bloc.firstChild);
   
     /* Le test écrit puis efface une ligne dans des tables du registre : on le
        dit avant de le faire, au lieu de le découvrir après. */
     if ($('#dg-test')) $('#dg-test').onclick = () => confirmer('Tester la base ?',
       'Le test lit quatre tables, puis y écrit et efface aussitôt une ligne « diagnostic:test ».',
       'Lancer le test', testerBase);
     const testerBase = async () => {
       $('#dg-res').innerHTML = '<div class="vide">Test en cours…</div>';
       const lignes = [];
       for (const t of ['journal', 'taches_nettoyage', 'checklists', 'reglages']) {
         let lect = '—', ecr = '—';
         try { await DB._appel(t + '?select=id&limit=1'); lect = '200'; }
         catch (e) { lect = e.http || 'réseau'; }
         try {
         await DB._appel(t, { method:'POST',
         headers:{ 'Prefer':'resolution=merge-duplicates,return=minimal' },
         body: JSON.stringify({ id:'diagnostic:test', site:APP.site, data:{ at:nowISO() } }) });
         ecr = '200';
           /* On retire immédiatement la ligne de test : un registre sanitaire ne
           doit pas conserver les traces de nos propres essais techniques. */
        try { await DB._appel(t + '?id=eq.diagnostic%3Atest', { method:'DELETE' }); } catch (x) {}
      } catch (e) { ecr = e.http || 'réseau'; }
         lignes.push([t, lect, ecr]);
       }
       const ok = lignes.every(l => l[1] === '200' && l[2] === '200');
       $('#dg-res').innerHTML =
         '<div class="dense"><div class="dense-h"><span class="c1">Table</span>' +
         '<span class="c w">Lecture</span><span class="c w">Écriture</span></div>' +
         lignes.map(l => '<div class="dl"><span class="c1">' + l[0] + '</span>' +
           '<span class="c w">' + pastille(l[1] === '200' ? 'ok' : 'bad', String(l[1])) + '</span>' +
           '<span class="c w">' + pastille(l[2] === '200' ? 'ok' : 'bad', String(l[2])) + '</span></div>').join('') +
         '</div>' +
         (ok ? '<div class="alerte ok" style="margin-top:12px"><span class="ai">•</span><div>' +
               '<b>Tout passe</b><p>Lecture et écriture fonctionnent sur les quatre tables testées.</p></div></div>'
             : '<div class="alerte bad" style="margin-top:12px"><span class="ai">▲</span><div>' +
               '<b>Blocage identifié</b><p>401 : droits manquants ou RLS active. 404 : table absente ou cache de schéma ' +
               'à recharger dans Supabase.</p></div></div>');
       if (ok) { STATE.erreurBase = null; STATE.dernierEchec = null; majBandeau(); }
     };
   
     $('#dg-purge').onclick = () => confirmer('Vider la file d’attente ?',
       STATE.fileAttente + ' écriture(s) en attente seront abandonnées. Les données restent sur cet appareil ' +
       'mais ne remonteront jamais dans la base.', 'Vider', async () => {
         await DB.del(OFFLINE.fileAttente);
         STATE.fileAttente = 0; STATE.erreurBase = null; STATE.dernierEchec = null;
         majBandeau(); toast('File vidée'); rendre('reglages');
       });
   };