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
     if (l.length >= PREUVE.maxParJour) {
       toast('Trop de photos aujourd’hui — les plus anciennes sont conservées', 'erreur');
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
   function voirPreuve(jour, idPreuve, apresSuppression) {
     (async function () {
       const cle = 'preuves:' + jour;
       const l = await DB.get(cle, []);
       const p = l.filter(x => x.id === idPreuve)[0];
       if (!p) return toast('Photo introuvable', 'erreur');

       showSheet(
         '<h2 id="sheet-titre">' + esc(p.libelle || 'Photo') + '</h2>' +
         '<p class="cs">' + esc(p.par || '—') + ' · ' + fmtD(jour) +
         (p.at ? ' à ' + heure(p.at) : '') + '</p>' +
         '<img src="' + p.img + '" alt="" class="preuve-plein">' +
         '<div class="actions">' +
         '<button class="btn clair" data-fermer>Fermer</button>' +
         '<button class="btn corail" id="pv-suppr">Supprimer</button></div>');

       $('#pv-suppr').onclick = () => {
         confirmer('Supprimer cette photo ?',
           'Elle ne servira plus de preuve pour « ' + (p.libelle || 'cette tâche') + ' ». ' +
           'La tâche reste cochée, mais si la photo était obligatoire il faudra ' +
           'en reprendre une.',
           'Supprimer', async () => {
             const l2 = await DB.get(cle, []);
             await DB.set(cle, l2.filter(x => x.id !== idPreuve));
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
       '<img src="' + p.img + '" alt=""></button>').join('') + '</div>';
   }

   /* À appeler après chaque rendu qui contient des vignettes. */
   function brancherVignettes(revenir) {
     $$('[data-vign]').forEach(b => b.onclick = () =>
       voirPreuve(b.dataset.vjour, b.dataset.vign, revenir));
   }
   
   /* =============================================================================
      C. STOCK FERMÉ / OUVERT
      Réception → stock fermé. Ouverture → sortie du stock fermé, entrée en
      produits ouverts. Le croisement des deux donne les alertes DLC.
      ========================================================================== */
   async function stockFerme() {
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
   
     function lignesReception(bl) {
       const lignes = (bl.lignes || []).map(l => ({
         produit:l.parfum || l.ref || '', qte:l.bacs || 1, unite:'bac', lot:'', dlc:''
       }));
       if (!lignes.length) lignes.push({ produit:'', qte:1, unite:'bac', lot:'', dlc:'' });
   
       const rendre2 = () => {
         $('#sheet-corps').innerHTML =
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
           '<button class="btn menthe" id="rl-ok">Enregistrer la réception</button></div>';
   
         $$('[data-fermer]').forEach(b => b.onclick = closeSheet);
         $$('[data-r]').forEach(inp => inp.oninput = () => {
           const [i, k] = inp.dataset.r.split('.');
           lignes[+i][k] = inp.value;
         });
         $$('[data-scandlc]').forEach(b => b.onclick = async () => {
           const i = +b.dataset.scandlc;
           const r = await scannerPhoto('etiquette');
           if (!r) return;
           const d = (r.texte || '').match(/(\d{2})[\/.\-](\d{2})[\/.\-](\d{2,4})/);
           if (d) {
             const an = d[3].length === 2 ? '20' + d[3] : d[3];
             lignes[i].dlc = an + '-' + d[2] + '-' + d[1];
           }
           if (r.lot) lignes[i].lot = r.lot;
           if (r.parfum && !lignes[i].produit) lignes[i].produit = r.parfum;
           if (!d) toast('Aucune date lisible — saisissez-la à la main', 'erreur');
           rendre2();
         });
         $('#rl-plus').onclick = () => { lignes.push({ produit:'', qte:1, unite:'bac', lot:'', dlc:'' }); rendre2(); };
         $('#rl-ok').onclick = enregistrer;
       };
   
       async function enregistrer() {
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
          const cle = cleArticle(fam.id, fam.parfums ? l.produit.trim() : '',
                                 fam.parfums ? (num(l.taille) || FOURNISSEUR.tailleParDefaut) : '');
          await ajouterMouvement('reception', cle, num(l.qte) || 1,
            { lot:l.lot, bl:bl.numero, dlc:l.dlc, famille:fam.id });
        }
      }
         await feed(bl.refuse ? 'bad' : 'ok',
           STATE.user.prenom + (bl.refuse ? ' a REFUSÉ la livraison ' : ' a réceptionné ') + bl.numero +
           ' (' + valides.length + ' réf.)');
         closeSheet();
         toast(bl.refuse ? 'Réception refusée et tracée' : valides.length + ' article(s) en stock fermé');
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
   const preuves = await DB.get('preuves:' + j, []);
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
      return { fait: !!v, ou: 'temp',
               quoi: 'le relévé des températures du ' + (mom === 'm' ? 'matin' : 'soir'),
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
     if (!e.tempM) R.push(['bad', 'Frigos du matin non relevés', 'À faire dès l’ouverture, avant la mise en vitrine.', 'temp']);
     if (e.tempCrit) R.push(['bad', e.tempCrit + ' frigo(s) en limite critique', 'Transférez les produits et prévenez Eve.', 'temp']);
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
     return '<div class="tache' + (faite ? ' on' : '') + (lie ? ' liee' : '') + '">' +
     '<span class="tnum">' + n + '</span>' +
     (lie
       ? '<span class="box" aria-hidden="true">✓</span>'
       : '<button class="box" data-t="' + t.id + '">✓</button>') +
     '<span class="tx"><span class="tn">' + esc(t.t) + '</span>' +
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
     (t.lien ? '<button class="btn ' + (lie && !lie.fait ? 'menthe' : 'clair') + ' sm" data-go="' + t.lien + '">' +
       (lie && !lie.fait ? 'Y aller' : '→') + '</button>' : '') +
         '</div>' +
         /* Vignettes sous la tâche : plusieurs clichés possibles, avant et après.
            Cliquables pour voir en grand et supprimer. */
         vignettes(clichés, j);
  };
   
     const m = (typeof meteo === 'function') ? await meteo().catch(() => null) : null;

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
     (m ? (function () {
       const c = METEO.codes[m.code] || METEO.codes[3];
       return '<div class="meteo-mini"><span class="mm-t">' + m.t + '°</span>' +
              '<span class="mm-d">' + esc(c.l) + '</span>' +
              '<span class="mm-p">max ' + m.max + '° · pluie ' + m.pluie + ' %</span></div>';
     })() : '') +
     '</div>' +

       (R.length
         ? '<div class="stack">' + R.slice(0, 4).map(r =>
             '<div class="alerte ' + r[0] + '"><div style="flex:1;min-width:0">' +
             '<b>' + esc(r[1]) + '</b><p>' + esc(r[2]) + '</p></div>' +
             '<button class="btn clair sm" data-go="' + r[3] + '">Ouvrir</button></div>').join('') + '</div>'
         : '<div class="alerte ok"><div style="flex:1"><b>Tout est à jour</b>' +
           '<p>Aucun relévé ni contrôle en retard.</p></div></div>') +
   
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

    /* Compteur et barre d'avancement, recalculés sans tout reconstruire */
    const total2 = $$('#page .tache [data-t]').length;
    const faits2 = $$('#page .tache.on [data-t]').length;
    const cs = $('#page .card .cs');
    if (cs && /sur \d+ tâches/.test(cs.textContent)) {
      cs.textContent = cs.textContent.replace(/^\d+ sur \d+/, faits2 + ' sur ' + total2);
    }
    const barre = $('#page .jauge i');
    if (barre && total2) barre.style.width = Math.round(faits2 / total2 * 100) + '%';

    await DB.set('checklist:' + j, rec);
    if (actif) await feed('ok', STATE.user.prenom + ' : ' + ligne2.querySelector('.tn').textContent);
  });
   
     brancherVignettes(() => rendre('accueil'));
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
     const t = setInterval(() => {
       reste--;
       const box = document.getElementById('sheet-corps');
       if (!box || $('#sheet').hidden) return clearInterval(t);
       if (reste <= 0) {
         clearInterval(t);
         vibrer([200, 100, 200]);
         box.innerHTML = '<h2>Temps écoulé</h2><p class="sub">Vous pouvez rincer.</p>' +
           '<div class="actions"><button class="btn menthe" data-fermer>Terminé</button></div>';
         $$('[data-fermer]').forEach(b => b.onclick = closeSheet);
         return;
       }
       box.innerHTML = html();
       $$('[data-fermer]').forEach(b => b.onclick = () => { clearInterval(t); closeSheet(); });
     }, 1000);
     $$('[data-fermer]').forEach(b => b.onclick = () => { clearInterval(t); closeSheet(); });
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
    if (brouillon) Object.keys(brouillon).forEach(k => {
      if (r[k] === undefined || r[k] === '') r[k] = brouillon[k];
    });
  } catch (e) {}
  const veille = await DB.get('caisse:' + addD(j, -1), null);

  /* Fond laissé hier soir : nouvelle clé, sinon l'ancienne. */
  const fondVeille = veille
    ? (veille.s_fond !== undefined && veille.s_fond !== '' ? num(veille.s_fond)
       : (veille.ff !== undefined && veille.ff !== '' ? num(veille.ff) : null))
    : null;

  if (!V.caisse._m) {
    const h = new Date().getHours();
    V.caisse._m = (h < 15 && !r.m_valide) ? 'm' : (r.s_valide ? 'm' : 's');
  }
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

      '<button class="btn ' + (valide ? 'clair' : 'menthe') + ' bloc xl" id="cv" style="margin-top:16px">' +
      (valide ? '✓ Déjà validé — revalider'
              : 'Valider le comptage ' + (mom === 'm' ? 'd’ouverture' : 'de fermeture')) + '</button>' +

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
        await sauver();
        toast('Signalement transmis au manager');
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
        : { ok:false, t:'Carte : ' + eur(dC) + ' d’écart. ' + eur(num(cb)) +
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
        : { ok:false, t:'Espèces : ' + eur(dE) + ' d’écart. ' + eur(fondOuv) + ' au départ + ' +
                        eur(num(esp)) + ' encaissés − ' + eur(num(ret)) + ' retirés = ' +
                        eur(attendu) + ' attendus, ' + eur(num(fond)) + ' laissés.' });
    }

    if (!lignes.length) {
      box.innerHTML = '<p class="verdict n">Renseignez les recettes pour le contrôle.</p>';
      return;
    }
    const soucis = lignes.filter(l => !l.ok);
    box.innerHTML = soucis.length
      ? '<div class="verdict bad"><b>' + soucis.length + ' écart(s)</b><span>' +
        soucis.map(l => esc(l.t)).join('<br>') + '<br>Expliquez-le dans le commentaire.</span></div>'
      : '<p class="verdict ok">' + lignes.map(l => esc(l.t)).join(' ') + '</p>';
  }

  /* Champs de saisie UNIQUEMENT. Le sélecteur large [data-k] ramassait aussi
     les touches du pavé numérique de l'écran de connexion, qui portent le même
     attribut : la caisse enregistrait douze champs parasites nommés 0 à 9,
     annuler et effacer. Sans conséquence sur les calculs, mais chaque relevé
     en était pollué et le diagnostic devenait illisible. */
  const champsSaisie = () =>
    $$('#page input[data-k], #page textarea[data-k], #page select[data-k]');

  const sauver = debounce(async () => {
    champsSaisie().forEach(i => { r[i.dataset.k] = i.value; });
    await DB.set('caisse:' + j, r);
  }, 400);

  function brancher() {
    brancherNavJour('caisse');
    if (!peutModifier(j)) return;
    $$('[data-mom]').forEach(b => b.onclick = () => {
      if (b.dataset.mom === mom) return;
      mom = b.dataset.mom; V.caisse._m = mom; dessiner();
    });
    champsSaisie().forEach(i => i.oninput = () => {
      r[i.dataset.k] = i.value;
      if (r[mom + '_valide']) delete r[mom + '_valide'];
      /* Écriture locale IMMÉDIATE, avant l'enregistrement différé : si l'onglet
         est déchargé entre deux frappes, rien n'est perdu. */
      try { localStorage.setItem('pilotshop.v3:brouillon:caisse:' + j, JSON.stringify(r)); } catch (e) {}
      sauver();
      verdict();
    });
    $('#cv').onclick = async () => {
      const p = mom + '_';
      const requis = (mom === 'm') ? ['m_fond'] : ['s_cb', 's_esp', 's_tpe', 's_retrait', 's_fond'];
      const vides = requis.filter(k => r[k] === undefined || r[k] === '');
      if (vides.length) return toast(mom === 'm'
        ? 'Renseignez le fond de caisse initial'
        : 'Renseignez tous les montants du soir', 'erreur');
      r[mom + '_valide'] = { par:STATE.user.prenom, id:STATE.user.id, at:nowISO() };
      champsSaisie().forEach(i => { r[i.dataset.k] = i.value; });
      await DB.set('caisse:' + j, r);
      await feed('ok', STATE.user.prenom + ' a validé le comptage ' +
        (mom === 'm' ? 'd’ouverture' : 'de fermeture'));
      toast('Comptage validé');
      rendre('accueil');
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
      'période s’en ressentira. Eve verra le signalement dans le fil.</p></div></div>' +
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
    /* Compatibilité avec l'ancien format à jour unique */
    if (!Array.isArray(f.jours)) f.jours = (f.jour ? [+f.jour] : []);
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
  const preuves = await DB.get('preuves:' + j, []);
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

            (ph.length
              ? '<div class="rang" style="margin-top:12px;gap:8px">' + ph.map(p =>
                  '<img src="' + p.img + '" alt="Preuve" style="width:74px;height:74px;' +
                  'object-fit:cover;border-radius:10px;border:1px solid var(--line)">').join('') + '</div>'
              : '') +

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
function defautEnceinte(e) {
  return Math.round((e.vert[0] + e.vert[1]) / 2);
}

V.temp = async function () {
  if (!V.temp._d) V.temp._d = today();
  const j = V.temp._d;
  const rec = await DB.get('temp:' + j, {});
  if (!rec.valide) rec.valide = {};

  /* Un seul moment à l'écran : le matin ou le soir, jamais les deux.
     Le moment proposé dépend de l'heure et de ce qui reste à faire. */
  const moments = RELEVES.moments;
  if (!V.temp._m || V.temp._j !== j) {
    V.temp._j = j;
    const h = new Date().getHours();
    if (!rec.valide.m && h < 15)      V.temp._m = 'm';
    else if (!rec.valide.s)           V.temp._m = 's';
    else if (!rec.valide.m)           V.temp._m = 'm';
    else                              V.temp._m = (h < 15) ? 'm' : 's';
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
    const etat = hs ? '' : etatTemp(e, v);
    /* Trois états lisibles d'un coup d'œil : à relever, relevé, validé. */
    const cls = valideMoment() && ok ? 'tligne valide' : ok ? 'tligne saisi' : 'tligne';
    return '<div class="' + cls + '">' +
      '<div class="tl-haut"><b>' + esc(e.nom) + '</b>' +
      '<span class="tl-cible">' + esc(e.cible) + '</span>' +
      '<span class="tl-etat">' + (valideMoment() && ok ? '✓ validé' : ok ? 'relevé' : 'à relever') + '</span></div>' +
      '<div class="tl-bas">' +
      (hs
        ? '<span class="tm-hs">Hors service</span>'
        : '<button class="tm-pas" data-pas="-1" data-e="' + e.id + '">−</button>' +
          '<button class="tm-val ' + etat + '" data-libre="' + e.id + '">' + v + '<small>°C</small></button>' +
          '<button class="tm-pas" data-pas="1" data-e="' + e.id + '">+</button>') +
      '<button class="tm-off' + (hs ? ' on' : '') + '" data-hs="' + e.id + '">HS</button>' +
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
          '<b>Relévé du ' + mom.label.toLowerCase() + ' validé</b>' +
          '<p>Par ' + esc(vm.par) + ' à ' + heure(vm.at) + '. Toute modification demandera ' +
          'une nouvelle validation.</p></div></div>'
        : '') +

      '<div class="stack">' + ENCEINTES.map(ligne).join('') + '</div>' +

      carte(entete('📝', 'Action corrective',
        'Obligatoire dès qu’une enceinte dépasse sa limite critique.') +
        '<textarea id="obs" placeholder="Ex. vitrine à −9 °C : bacs transférés en chambre froide, Eve prévenue.">' +
        esc(rec.obs || '') + '</textarea>') +

      '<button class="btn ' + (vm ? 'clair' : 'menthe') + ' bloc xl" id="tvalider" style="margin-top:16px">' +
      (vm ? '✓ Déjà validé — revalider'
          : reste.length ? 'Valider le ' + mom.label.toLowerCase() + ' (' + reste.length + ' manquante' + (reste.length > 1 ? 's' : '') + ')'
                         : 'Valider le relévé du ' + mom.label.toLowerCase()) +
      '</button>';

    brancher();
  };

  const sauver = async () => {
    if ($('#obs')) rec.obs = $('#obs').value;
    await DB.set('temp:' + j, rec);
  };

  /* Modifier une valeur après validation annule celle-ci : le registre doit
     porter la signature de la personne qui a vu la dernière valeur. */
  const invalider = () => { if (rec.valide[mom.id]) delete rec.valide[mom.id]; };

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
      const nv = (actuel === 'HS' ? defautEnceinte(e) : actuel) + (+b.dataset.pas);
      if (nv < e.lo - 5 || nv > e.hi + 5) return;
      rec[cle(e)] = nv;
      invalider();
      vibrer(UI.vibration.ok);
      await sauver();
      dessiner();
      if (etatTemp(e, nv) === 'crit') alerteCritique(e, nv);
    });

    $$('[data-hs]').forEach(b => b.onclick = async () => {
      const e = ENCEINTES.filter(x => x.id === b.dataset.hs)[0];
      rec[cle(e)] = (rec[cle(e)] === 'HS') ? '' : 'HS';
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

    if ($('#obs')) $('#obs').oninput = debounce(sauver, 600);

    $('#tvalider').onclick = async () => {
      const reste = manquants();
      const crit = ENCEINTES.filter(e => etatTemp(e, brut(e)) === 'crit');
      if (crit.length && !(rec.obs || '').trim()) {
        toast('Renseignez l’action corrective', 'erreur');
        if ($('#obs')) $('#obs').focus();
        return;
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
      toast('Relévé du ' + mom.label.toLowerCase() + ' validé');
      rendre('accueil');
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
         '<div class="champ"><label class="f">Ouverture boutique</label><input type="time" id="h1" value="' + HORAIRES.ouverture + '"></div>' +
         '<div class="champ"><label class="f">Fermeture boutique</label><input type="time" id="h2" value="' + HORAIRES.fermeture + '"></div>' +
         '<div class="champ"><label class="f">Début phase ouverture</label><input type="time" id="h3" value="' + HORAIRES.debutOuverture + '"></div>' +
         '<div class="champ"><label class="f">Fin phase ouverture</label><input type="time" id="h4" value="' + HORAIRES.finOuverture + '"></div>' +
         '<div class="champ"><label class="f">Début phase fermeture</label><input type="time" id="h5" value="' + HORAIRES.debutFermeture + '"></div>' +
         '<div class="champ"><label class="f">Fin phase fermeture</label><input type="time" id="h6" value="' + HORAIRES.finFermeture + '"></div></div>' +
         '<button class="btn menthe bloc" id="hv" style="margin-top:14px">Enregistrer les horaires</button>', 'solide') +
   
       carte(entete('❄️', 'Unités frigorifiques', 'Nom, cible et plage de boutons du relevé de températures.') +
         '<div class="stack">' + ENCEINTES.map((e, i) =>
           '<div class="card plat"><div class="champ"><label class="f">Nom</label>' +
           '<input type="text" data-e="' + i + '.nom" value="' + esc(e.nom) + '"></div>' +
           '<div class="grid g3" style="margin-top:10px">' +
           '<div class="champ"><label class="f">Cible affichée</label><input type="text" data-e="' + i + '.cible" value="' + esc(e.cible) + '"></div>' +
           '<div class="champ"><label class="f">Vert de</label><input type="number" data-e="' + i + '.v0" value="' + e.vert[0] + '"></div>' +
           '<div class="champ"><label class="f">Vert à</label><input type="number" data-e="' + i + '.v1" value="' + e.vert[1] + '"></div></div>' +
           '<div class="grid g3" style="margin-top:10px">' +
           '<div class="champ"><label class="f">Critique au-dessus de</label><input type="number" data-e="' + i + '.crit" value="' + e.crit + '"></div>' +
           '<div class="champ"><label class="f">Bouton min</label><input type="number" data-e="' + i + '.lo" value="' + e.lo + '"></div>' +
           '<div class="champ"><label class="f">Bouton max</label><input type="number" data-e="' + i + '.hi" value="' + e.hi + '"></div></div>' +
           '<button class="btn fantome bloc sm" data-supp="' + i + '" style="margin-top:8px">Supprimer cette unité</button></div>').join('') + '</div>' +
         '<button class="btn clair bloc" id="ea" style="margin-top:12px">+ Ajouter une unité</button>' +
         '<button class="btn menthe bloc" id="ev" style="margin-top:8px">Enregistrer les unités</button>') +
   
       carte(entete('🗓️', 'Tâches hebdomadaires', 'Jour de passage de chaque tâche récurrente.') +
         '<div class="stack">' + NETTOYAGE.zones.map(z =>
           '<div><div class="entete"><h3>' + z.icone + ' ' + esc(z.nom) + '</h3></div>' +
           z.taches.filter(t => t.jours).map(t =>
             '<div class="tache"><span class="tx"><span class="tn">' + esc(t.nom) + '</span>' +
             '<span class="tm">' + t.jours.map(x => JOURS_SEMAINE[x]).join(', ') + '</span></span>' +
             '<select data-h="' + t.id + '" style="width:auto;min-width:130px">' +
             JOURS_SEMAINE.slice(1).map((jn, k) =>
               '<option value="' + (k + 1) + '"' + (t.jours[0] === k + 1 ? ' selected' : '') + '>' + jn + '</option>').join('') +
             '</select></div>').join('') + '</div>').join('') + '</div>' +
         '<div class="entete"><h3>Tâches asynchrones</h3></div>' +
         NETTOYAGE.asynchrones.map(a =>
           '<div class="tache"><span class="tx"><span class="tn">' + a.icone + ' ' + esc(a.nom) + '</span>' +
           '<span class="tm">' + (a.type === 'jours-fixes'
             ? a.jours.map(x => JOURS_SEMAINE[x]).join(', ')
             : 'tous les ' + a.intervalleJours + ' jours') + '</span></span></div>').join('') +
         '<button class="btn menthe bloc" id="hbv" style="margin-top:14px">Enregistrer les jours</button>');
   
     $('#hv').onclick = async () => {
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
       ENCEINTES.push({ id:'u' + uid().slice(0, 4), nom:'Nouvelle unité', cible:'—',
                        lo:-24, hi:8, pas:1, vert:[-20, -17], crit:-15, zone:'boutique' });
       await DB.set('enceintes', ENCEINTES);
       rendre('parametres');
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
     $('#hbv').onclick = async () => {
       const map = {};
       $$('[data-h]').forEach(s => map[s.dataset.h] = [+s.value]);
       NETTOYAGE.zones.forEach(z => z.taches.forEach(t => { if (map[t.id]) t.jours = map[t.id]; }));
       await DB.set('hebdo', map);
       toast('Jours enregistrés');
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
        '" data-j="' + t.id + '.' + k + '">' + JOURS_COURTS[k] + '</button>').join('') + '</div>' +
      '<div class="champ" style="margin-top:10px"><label class="f">Attribuée à</label>' +
      '<select data-a="' + t.id + '"><option value="">— toute l’équipe —</option>' +
      EQUIPE.map(e => '<option value="' + e.id + '"' +
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
        TACHES_HEBDO = TACHES_HEBDO_DEF.map(t => Object.assign({}, t));
        closeSheet(); toast('Tableau rétabli'); rendre('parametres');
      });
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
      '<select data-r="' + r.id + '"><option value="">— personne —</option>' +
      EQUIPE.map(e => '<option value="' + e.id + '"' +
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
  const preuves = await DB.get('preuves:' + j, []);
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
            '<button class="box" data-hb="' + t.id + '">✓</button>' +
            '<span class="tx"><span class="tn">' + esc(t.libelle) + '</span>' +
            '<span class="tm">' + (v.ok ? esc(v.par) + ' · ' + heure(v.at)
              : (qui ? 'Attribuée à ' + esc(qui) : 'Photo obligatoire')) +
            (ph.length ? ' · ' + ph.length + ' photo(s)' : '') + '</span></span>' +
            '<button class="btn ' + (ph.length ? 'menthe' : 'clair') + ' sm" data-hbp="' + t.id + '"' +
            (ph.length >= HEBDO.photosMax ? ' disabled' : '') + '>' +
            (ph.length ? '✓ Photo' : 'Photo') + '</button></div>' +
            (ph.length
              ? '<div class="rang" style="margin-top:10px;gap:8px">' + ph.map(p =>
                '<img src="' + p.img + '" alt="" style="width:62px;height:62px;object-fit:cover;' +
                'border-radius:9px;border:1px solid var(--line)">').join('') + '</div>'
              : ''),
            v.ok ? 'menthe' : '');
        }).join('') + '</div>'
      : vide('', 'Rien de prévu au tableau ce jour.'));

  brancherNavJour('clean');
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
    plein.innerHTML = '<img src="' + a.photo + '" alt="">' +
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
  $$('[data-res]').forEach(b => b.onclick = async () => {
    const l = await DB.get('anomalies', []);
    const a = l.filter(x => x.id === b.dataset.res)[0];
    if (a) { a.resolue = true; a.resoluePar = STATE.user.prenom; a.resolueAt = nowISO(); }
    await DB.set('anomalies', l);
    if (a) await feed('ok', STATE.user.prenom + ' a traité : ' + a.titre);
    rendre('anomalie');
  });
};

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
    (a.photo ? '<img src="' + a.photo + '" alt="" data-anoph="' + esc(a.id) + '" ' +
      'style="width:100%;max-height:190px;object-fit:cover;border-radius:10px;' +
      'margin-top:10px;cursor:pointer">' : '') +
    (a.resolue ? '' : '<button class="btn clair bloc sm" data-res="' + a.id +
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
      '<p class="sub">Eve le verra immédiatement dans sa tour de contrôle.</p>' +

      '<div class="entete"><h3>De quoi s’agit-il ?</h3></div>' +
      '<div class="chips" id="an-cat">' + ANOMALIES.categories.map(c =>
        '<button type="button" class="chip' + (categorie === c.id ? ' on' : '') +
        '" data-c="' + c.id + '">' + esc(c.libelle) + '</button>').join('') + '</div>' +

      '<div class="champ" style="margin-top:16px"><label class="f">En une phrase</label>' +
      '<input type="text" id="an-t" value="' + esc(memo.titre) + '" placeholder="Ex. la crêpière ne chauffe plus"></div>' +

      '<div class="champ" style="margin-top:14px"><label class="f">Détail (facultatif)</label>' +
      '<textarea id="an-d" placeholder="Depuis quand, ce qui a été tenté, conséquence sur le service.">' +
      esc(memo.detail) + '</textarea></div>' +

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

    $$('[data-fermer]').forEach(b => b.onclick = closeSheet);
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
      toast('Signalement transmis');
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
             '<input type="number" min="0" step="1" data-g="p' + i + '.' + t + '" value="' +
             (v.t[t] === undefined || v.t[t] === '' ? '' : v.t[t]) + '"' + (rec.valide ? ' disabled' : '') + '></div>').join('') +
           '</div>' +
           '<div class="champ" style="margin-top:10px"><label class="f">Entamé, tous formats confondus (L)</label>' +
           '<input type="number" min="0" step="0.5" data-e="p' + i + '" value="' +
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
       '<div class="dl"><span class="c1">Clé</span><span class="c ww">' +
       (SUPABASE.anonKey ? esc(SUPABASE.anonKey.slice(0, 18)) + '…' : 'absente') + '</span></div>' +
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
       '<button class="btn clair bloc" id="dg-test" style="margin-top:14px">Tester lecture et écriture</button>' +
       '<div id="dg-res" style="margin-top:12px"></div>' +
       '<button class="btn fantome bloc" id="dg-purge" style="margin-top:8px">Vider la file d’attente</button>', 'plat');
     page.appendChild(bloc.firstChild);
   
     $('#dg-test').onclick = async () => {
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