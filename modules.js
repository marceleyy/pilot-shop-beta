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
PAGES.stock      = { titre:'Stock fermé', sous:'Produits reçus non encore ouverts' };
PAGES.parametres = { titre:'Back-office', sous:'Tâches, horaires et unités froides' };
PAGES.hebdo      = { titre:'Tâches du jour', sous:'Plan hebdomadaire de la boutique' };
PAGES.lots.titre = 'Traçabilité';
PAGES.lots.sous  = 'Ouverture de tout nouveau produit';
   
   if (MENU_PLUS.equipe.indexOf('reception') < 0)  MENU_PLUS.equipe.splice(2, 0, 'reception', 'stock');
if (MENU_PLUS.manager.indexOf('reception') < 0) MENU_PLUS.manager.splice(2, 0, 'reception', 'stock');
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
         '<button class="btn ciel bloc xl" id="scan-bl">📸 1. Scanner le bon de livraison</button>' +
         '<button class="btn clair bloc" id="saisie-bl" style="margin-top:10px">Saisir sans scanner</button>', 'ciel') +
   
       (recus.length
         ? '<div class="entete"><h3>Reçu aujourd’hui</h3></div><div class="stack">' + recus.map(r =>
             carte('<div class="rang"><span class="ci">' + (r.refuse ? '⛔' : '📦') + '</span>' +
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
             '<button class="btn clair sm bloc" data-scandlc="' + i + '" style="margin-top:10px">📸 Scanner la DLC</button>' +
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
           const stock = await DB.get('stock:ferme', []);
           valides.forEach(l => stock.push({
             id:uid(), produit:l.produit.trim(), qte:num(l.qte) || 1, unite:l.unite,
             lot:l.lot, dlc:l.dlc, recuLe:today(), bl:bl.numero, fournisseur:bl.fournisseur,
             ouvert:false, par:STATE.user.prenom
           }));
           await DB.set('stock:ferme', stock);
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
   V.stock = async function () {
     const ferme = await stockFerme();
     const alertes = await alertesDLC();
     const ouverts = (await DB.get('stock:ferme', [])).filter(x => x.ouvert).slice(-30).reverse();
   
     $('#page').innerHTML =
       (alertes.length
         ? '<div class="entete"><h3>⚠️ DLC qui approchent</h3></div><div class="stack">' + alertes.map(a =>
             '<div class="fifo ' + (a.niveau === 'jaune' ? 'orange' : a.niveau) + '">' +
             '<div class="fn"><b>' + esc(a.produit) + '</b>' +
             '<div class="fd">Non ouvert · reçu le ' + fmtDC(a.recuLe) + ' · ' + a.qte + ' ' + esc(a.unite) +
             (a.lot ? ' · lot ' + esc(a.lot) : '') + '</div></div>' +
             '<div class="fr"><b>' + (a.reste < 0 ? 'Périmé' : a.reste === 0 ? 'Dernier jour' : 'J−' + a.reste) + '</b>' +
             '<span>DLC ' + fmtDC(a.dlc) + '</span></div>' +
             '<button class="btn clair sm" data-ouvrir="' + a.id + '">Ouvrir</button></div>').join('') + '</div>'
         : carte('<div class="alerte ok"><span class="ai">✓</span><div><b>Aucune DLC proche</b>' +
           '<p>Rien en stock fermé n’expire dans les ' + STOCK.alerteDlcJours + ' jours.</p></div></div>', 'plat')) +
   
       '<div class="entete"><h3>Stock fermé</h3><span class="pousse mini num">' + ferme.length + '</span></div>' +
       (ferme.length
         ? '<div class="stack">' + ferme.slice().sort((a, b) => String(a.dlc).localeCompare(String(b.dlc))).map(a =>
             carte('<div class="rang"><div style="flex:1;min-width:0"><b>' + esc(a.produit) + '</b>' +
               '<div class="mini">' + a.qte + ' ' + esc(a.unite) + (a.lot ? ' · lot ' + esc(a.lot) : '') +
               ' · DLC ' + (a.dlc ? fmtDC(a.dlc) : '—') + '</div></div>' +
               '<button class="btn menthe sm" data-ouvrir="' + a.id + '">Ouvrir</button></div>')).join('') + '</div>'
         : vide('📦', 'Stock fermé vide. Passez par Réception après une livraison.')) +
   
       (ouverts.length ? '<div class="entete"><h3>Derniers produits ouverts</h3></div>' +
         '<div class="dense"><div class="dense-h"><span class="c1">Produit</span>' +
         '<span class="c w">Lot</span><span class="c ww">Ouvert le</span></div>' +
         ouverts.map(a => '<div class="dl"><span class="c1">' + esc(a.produit) + '</span>' +
           '<span class="c w">' + esc(a.lotOuverture || '—') + '</span>' +
           '<span class="c ww">' + fmtDC(a.ouvertLe) + ' · ' + esc(a.ouvertPar || '') + '</span></div>').join('') +
         '</div>' : '');
   
     $$('[data-ouvrir]').forEach(b => b.onclick = () => ouvertureGuidee(b.dataset.ouvrir));
   };
   
   async function ouvertureGuidee(id) {
     const l = await DB.get('stock:ferme', []);
     const a = l.filter(x => x.id === id)[0];
     if (!a) return;
   
     showSheet(
       '<h2 id="sheet-titre">Ouvrir ' + esc(a.produit) + '</h2>' +
       '<p class="sub">Le produit sort du stock fermé et entre en traçabilité des produits ouverts.</p>' +
       '<button class="btn ciel bloc" id="og-scan">📸 Scanner l’étiquette</button>' +
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
     const src = CHECKLISTS[phase === 'fermeture' ? 'fermeture' : 'ouverture'];
     return src.map(b => ({
       bloc: b.bloc,
       taches: b.taches.filter(t =>
         (!t.jours || t.jours.indexOf(j) >= 0) &&
         (!t.joursSauf || t.joursSauf.indexOf(j) < 0))
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
     const blocs = phase === 'service' ? [] : tachesChecklist(phase, j);
     const total = blocs.reduce((s, b) => s + b.taches.length, 0);
     const faits = blocs.reduce((s, b) => s + b.taches.filter(t => rec[t.id] && rec[t.id].ok).length, 0);
   
     const ligne = t => {
     const v = rec[t.id] || {};
     const preuve = preuves.filter(p => p.tache === t.id)[0];
     /* Une tâche restreinte à certains jours est une tâche périodique :
        elle exige une photo, comme les tâches hebdomadaires du nettoyage. */
     const besoinPhoto = PREUVE.actif &&
     (PREUVE.tachesObligatoires.indexOf(t.id) >= 0 ||
      (PREUVE.hebdoObligatoire && (t.jours || t.joursSauf || t.async)));
     return '<div class="tache' + (v.ok ? ' on' : '') + '">' +
     '<button class="box" data-t="' + t.id + '">✓</button>' +
     '<span class="tx"><span class="tn">' + esc(t.t) + '</span>' +
     '<span class="tm" data-min="' + t.min + '">' + (v.ok ? esc(v.par) + ' · ' + heure(v.at) : t.min + ' min') +
     (besoinPhoto ? ' · photo requise' : '') + '</span></span>' +
     (t.minuteur ? '<button class="btn clair sm" data-min="' + t.minuteur + '" data-nom="' + esc(t.t) + '">⏱️</button>' : '') +
         (besoinPhoto ? '<button class="btn ' + (preuve ? 'menthe' : 'clair') + ' sm" data-photo="' + t.id +
        '" data-lib="' + esc(t.t) + '">' + (preuve ? '✓📷' : '📷') + '</button>' : '') +
      (t.lien ? '<button class="btn clair sm" data-go="' + t.lien + '">→</button>' : '') +
      '</div>';
  };
   
     $('#page').innerHTML =
       carte('<div class="rang">' + avatar(STATE.user, 'av') +
         '<div><h2>Bonjour ' + esc(STATE.user.prenom) + '</h2>' +
         '<div class="mini">' + nomJour(j) + ' ' + fmtD(j) + ' · ' +
         (STATE.service ? 'en service depuis ' + heure(STATE.service.debut) : 'pas encore pointé') + '</div></div>' +
         '<span class="pousse">' + pastille(R.length ? 'bad' : 'ok', R.length ? R.length + ' alerte(s)' : 'Tout va bien') +
         '</span></div>', 'solide') +
   
       (R.length ? '<div class="stack" style="margin-top:12px">' + R.slice(0, 4).map(r =>
         '<div class="alerte ' + r[0] + '"><span class="ai">▲</span><div><b>' + esc(r[1]) + '</b><p>' + esc(r[2]) + '</p></div>' +
         '<span class="go"><button class="btn clair sm" data-go="' + r[3] + '">Ouvrir</button></span></div>').join('') + '</div>' : '') +
   
       (msgs.length ? '<div class="entete"><h3>Carnet de relève</h3>' +
         '<button class="btn fantome sm pousse" data-go="releve">Tout voir</button></div>' +
         '<div class="stack">' + msgs.map(m => carte('<div class="rang"><span class="ci">💬</span>' +
           '<div style="flex:1"><b>' + esc(m.texte) + '</b><div class="mini">' + esc(m.par) + ' · ' +
           fmtDC(m.jour) + '</div></div></div>', 'ambre')).join('') + '</div>' : '') +
   
       '<div class="phase-nav" style="margin-top:18px">' + PHASES.map(p =>
         '<button type="button" data-ph="' + p.id + '" class="' + (STATE.phase === p.id ? 'on' : '') + '">' +
         '<span class="pi">' + p.icone + '</span>' + esc(p.label) + '</button>').join('') + '</div>' +
   
       (phase === 'service'
         ? carte(entete('⚡', 'Service', 'Ce qui se déclare au fil de la journée.') +
             '<div class="stack">' +
             ['clean|🧽|Nettoyage en cours de service', 'pertes|🗑️|Déclarer une perte',
             'lots|#️⃣|Traçabilité à l’ouverture d’un produit',
             'reception|🚚|Réceptionner une livraison', 'reas|📦|Signaler une rupture'].map(x => {
             const [id, ic, lb] = x.split('|');
             return '<button type="button" class="menu-item" data-go="' + id + '">' +
             '<span class="mi-tx"><span class="mi-t">' + ic + ' ' + lb + '</span></span>' +
             '<span class="mi-fl">›</span></button>';
             }).join('') + '</div>')
   
         : carte(entete(PHASES.filter(p => p.id === phase)[0].icone,
             'Check-liste officielle · ' + (phase === 'ouverture' ? 'ouverture' : 'fermeture'),
             faits + ' sur ' + total + ' tâches · procédure Amorino MOP') +
             '<div class="jauge" style="margin-bottom:16px"><i style="width:' +
             (total ? Math.round(faits / total * 100) : 0) + '%"></i></div>' +
             blocs.map(b => '<div class="entete"><h3>' + esc(b.bloc) + '</h3></div>' +
               '<div class="stack">' + b.taches.map(ligne).join('') + '</div>').join(''), 'solide'));
   
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
    if (tm) tm.textContent = actif
      ? STATE.user.prenom + ' · ' + heure(nowISO())
      : (tm.dataset.min || '') + ' min';
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
   
     $$('[data-photo]').forEach(b => b.onclick = async () => {
       const p = await attacherPreuve(j, b.dataset.photo, b.dataset.lib);
       if (p) { toast('Photo enregistrée (' + p.poids + ' Ko)'); rendre('accueil'); }
     });
   
     $$('[data-min]').forEach(b => b.onclick = () => minuteur(+b.dataset.min, b.dataset.nom));
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
         box.innerHTML = '<h2>✅ Temps écoulé</h2><p class="sub">Vous pouvez rincer.</p>' +
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
     const veille = await DB.get('caisse:' + addD(j, -1), null);
     const attendu = veille ? num(veille.ff) : null;
   
     const champ = (k, l, ph) => '<div class="champ"><label class="f">' + l + '</label>' +
     '<input type="number" inputmode="decimal" step="0.01" data-k="' + k + '" value="' +
     (r[k] !== undefined && r[k] !== '' ? r[k]
      : (k === 'depot' && r.ret !== undefined ? r.ret : '')) +
    '" placeholder="' + (ph || '') + '"></div>';
   
     $('#vue-actions').innerHTML = '<input type="date" id="jj" value="' + j + '" style="width:auto;min-height:42px">';
   
     $('#page').innerHTML =
       carte(entete('☀️', 'Comptage d’ouverture', 'Tâche obligatoire du matin : compter le fond de caisse.') +
         '<div class="grid g2">' + champ('fi', 'Fond de caisse initial compté') +
         '<div class="champ"><label class="f">Fond final de la veille</label>' +
         '<input type="text" value="' + (attendu === null ? 'aucune donnée' : eur(attendu)) + '" readonly></div></div>' +
         '<div id="ct-croise" style="margin-top:12px"></div>', 'sable') +
   
       carte(entete('🌙', 'Fermeture', 'Ticket Z, totalisateur TPE, puis comptage des espèces.') +
         '<div class="grid g2">' + champ('cb', 'CA carte (ticket Z)') + champ('esp', 'CA espèces (ticket Z)') + '</div>' +
         '<div class="grid g2" style="margin-top:14px">' + champ('tpe', 'Total TPE') + champ('depot', 'Dépôt d’espèces retiré') + '</div>' +
         '<div class="grid g2" style="margin-top:14px">' + champ('ff', 'Fond de caisse final laissé') +
         '<div class="champ"><label class="f">Commandes annulées</label>' +
         '<input type="text" data-k="ann" value="' + esc(r.ann || '') + '" placeholder="Nombre, montant, personne"></div></div>' +
         '<div class="champ" style="margin-top:14px"><label class="f">Commentaire</label>' +
         '<textarea data-k="com" placeholder="Toute explication d’écart.">' + esc(r.com || '') + '</textarea></div>', 'solide') +
   
       '<div id="ct-bilan"></div>' +
       '<button class="btn menthe bloc xl" id="cv" style="margin-top:16px">Enregistrer la feuille</button>';
   
     const sauver = debounce(async (o, eq) => {
       await DB.set('caisse:' + j, Object.assign({}, o, {
         ecart:eq.ecart, conforme:eq.conforme, ca:eq.ca,
         ecartOuverture: attendu === null ? null : +(num(o.fi) - attendu).toFixed(2),
         par:STATE.user.prenom, employe:STATE.user.id, at:nowISO()
       }));
     }, 450);
   
     const refresh = () => {
       const o = {}; $$('[data-k]').forEach(i => o[i.dataset.k] = i.value);
       const eq = equilibreCaisse(o);
   
       /* Contrôle croisé du matin */
       if (attendu === null) {
         $('#ct-croise').innerHTML = '<div class="alerte info"><span class="ai">ℹ️</span><div>' +
           '<b>Pas de feuille la veille</b><p>Le contrôle croisé démarrera demain.</p></div></div>';
       } else if (o.fi === '' || o.fi === undefined) {
         $('#ct-croise').innerHTML = '<div class="alerte warn"><span class="ai">●</span><div>' +
           '<b>Comptage du matin à faire</b><p>Le fond doit être compté avant l’ouverture aux clients.</p></div></div>';
       } else {
         const d = +(num(o.fi) - attendu).toFixed(2);
         $('#ct-croise').innerHTML = Math.abs(d) < 0.01
           ? '<div class="alerte ok"><span class="ai">✓</span><div><b>Fond conforme à la veille</b>' +
             '<p>' + eur(num(o.fi)) + ' comptés, identique au fond laissé hier soir.</p></div></div>'
           : '<div class="alerte bad"><span class="ai">▲</span><div><b>Écart avec la veille : ' + eur(d) + '</b>' +
             '<p>' + eur(attendu) + ' laissés hier par ' + esc(veille.par || '—') + ', ' + eur(num(o.fi)) +
             ' comptés ce matin. À élucider avant d’ouvrir.</p></div></div>';
       }
   
       /* Équilibre de fermeture */
       const rempli = ['cb','esp','tpe','depot','ff'].every(k => o[k] !== '' && o[k] !== undefined);
       $('#ct-bilan').innerHTML =
         '<div class="grid g3" style="margin-top:12px">' +
         kpi('CA total', eur(eq.ca), '', 'Carte + espèces') +
         kpi('Écart d’équilibre', eur(eq.ecart), rempli ? (eq.conforme ? 'ok' : 'bad') : '', 'Doit être nul') +
         kpi('Contrôle', rempli ? (eq.conforme ? 'CONFORME' : 'ÉCART') : '—',
             rempli ? (eq.conforme ? 'ok' : 'bad') : '', 'Équation de caisse') + '</div>' +
         (rempli
           ? (eq.conforme
               ? '<div class="alerte ok" style="margin-top:12px"><span class="ai">✅</span><div>' +
                 '<b>Conforme</b><p>' + eur(num(o.tpe)) + ' TPE + ' + eur(eq.depot) + ' dépôt + ' +
                 eur(num(o.ff)) + ' fond final = ' + eur(num(o.fi)) + ' fond initial + ' + eur(eq.ca) + ' de CA.</p></div></div>'
               : '<div class="alerte bad" style="margin-top:12px"><span class="ai">▲</span><div>' +
                 '<b>L’équation ne tombe pas juste : ' + eur(eq.ecart) + '</b>' +
                 '<p>' + eur(eq.gauche) + ' d’un côté, ' + eur(eq.droite) + ' de l’autre. ' +
                 (Math.abs(num(o.tpe) - num(o.cb)) > 0.01
                   ? 'Le TPE (' + eur(num(o.tpe)) + ') ne correspond pas au CA carte (' + eur(num(o.cb)) + ') : côté banque. '
                   : 'Le CA carte correspond au TPE : l’écart est du côté des espèces. ') +
                 'Expliquez-le dans le commentaire.</p></div></div>')
           : '<div class="alerte info" style="margin-top:12px"><span class="ai">ℹ️</span><div>' +
             '<b>Contrôle en attente</b><p>Renseignez CA carte, CA espèces, TPE, dépôt et fond final.</p></div></div>');
   
       sauver(o, eq);
       return eq;
     };
   
     $$('[data-k]').forEach(i => i.oninput = refresh);
     refresh();
   
     $('#cv').onclick = async () => {
       const eq = refresh();
       await feed(eq.conforme ? 'ok' : 'bad',
         STATE.user.prenom + ' a fermé la caisse — ' + (eq.conforme ? 'conforme' : 'écart ' + eur(eq.ecart)));
       toast(eq.conforme ? 'Caisse conforme' : 'Enregistré — écart à expliquer');
     };
     $('#jj').onchange = e => { STATE.jour = e.target.value; rendre('caisse'); };
   };
   
   /* =============================================================================
      H. TRAÇABILITÉ — libellé et liste déroulante de confirmation
      ========================================================================== */
   const V_lots_origine = V.lots;
V.lots = async function () {
   await V_lots_origine.call(this);
   const h = $('#page');
   if (!h) return;

  /* La vue d'origine affiche déjà une carte « Scanner l'étiquette ». On la
     retire avant d'ajouter la nôtre, sinon l'écran présente deux boutons
     identiques qui font la même chose — signalé par l'équipe. */
  const doublon = $('#scan');
  if (doublon) {
    const carteDoublon = doublon.closest('.card');
    if (carteDoublon) carteDoublon.remove();
  }

  const bandeau = document.createElement('div');
     bandeau.innerHTML = carte(entete('#️⃣', 'Traçabilité pour l’ouverture de tout nouveau produit',
       'Le lot se note au moment où le produit est ouvert et mis en vitrine, jamais à la livraison.') +
       '<button class="btn ciel bloc xl" id="tr-scan">📸 Scanner l’étiquette</button>' +
       '<button class="btn clair bloc" id="tr-stock" style="margin-top:10px">Ouvrir depuis le stock fermé</button>', 'ciel');
     h.insertBefore(bandeau.firstChild, h.firstChild);
   
     $('#tr-scan').onclick = async () => {
     const mode = await choisirModeScan();
     if (!mode) return;
     /* Mode chaîne : tant que l'équipier demande « le suivant », on renchîne. */
     let compteur = 0;
     for (;;) {
     const r = await scannerPhoto('etiquette');
     if (!r) break;
     const enregistre = mode === 'stock'
         ? await entrerEnStock(r)
         : await choisirProduit(r, r.enchainer === true);
       if (enregistre) compteur++;
         if (!r.enchainer || !enregistre) break;
       }
    if (compteur) toast(compteur + (mode === 'stock' ? ' bac(s) entré(s) en stock' : ' produit(s) tracé(s)'));
    rendre(mode === 'stock' ? 'stock' : 'lots');
  };
  $('#tr-stock').onclick = () => rendre('stock');

  /* Deux gestes distincts, deux conséquences distinctes sur le stock :
     l'entrée ajoute un bac fermé, l'ouverture le sort du stock et déclenche
     le compte à rebours de la DLC. Les confondre fausse les deux. */
  function choisirModeScan() {
    return new Promise(resolve => {
      showSheet(
        '<h2 id="sheet-titre">Que scannez-vous ?</h2>' +
        '<p class="sub">Le stock se met à jour automatiquement selon votre choix.</p>' +
        '<div class="stack">' +
        '<button type="button" class="menu-item" data-mode="stock">' +
        '<span class="mi-tx"><span class="mi-t">📦 Entrée en stock</span>' +
        '<span class="mi-s">Bac fermé, rangé en chambre froide — ajouté au stock</span></span>' +
        '<span class="mi-fl">›</span></button>' +
        '<button type="button" class="menu-item" data-mode="ouverture">' +
        '<span class="mi-tx"><span class="mi-t">🍦 Ouverture d’un bac</span>' +
        '<span class="mi-s">Mis en vitrine — sorti du stock, DLC lancée</span></span>' +
        '<span class="mi-fl">›</span></button></div>' +
        '<div class="actions"><button class="btn clair" id="cm-x">Annuler</button></div>');
      $('#cm-x').onclick = () => { closeSheet(); resolve(null); };
      $$('[data-mode]').forEach(b => b.onclick = () => { closeSheet(); resolve(b.dataset.mode); });
    });
  }

  /* Entrée en stock : le bac reste fermé. Le volume et le poids lus sur
     l'étiquette préremplissent la fiche, il ne reste qu'à confirmer. */
  function entrerEnStock(r) {
    return new Promise(resolve => {
      const taille = r.volume || FOURNISSEUR.tailleParDefaut;
      showSheet(
        '<h2 id="sheet-titre">📦 Entrée en stock</h2>' +
        '<p class="sub">Lot <b>' + esc(r.lot || '—') + '</b>' +
        (r.volume ? ' · ' + r.volume + ' L lus sur l’étiquette' : '') + '</p>' +
        (r.dluo ? '<div class="alerte info"><span class="ai">⏱️</span><div><b>DLUO du bac fermé : ' +
          fmtD(r.dluo) + '</b><p>Les 10 jours de conservation ne commenceront qu’à l’ouverture.</p></div></div>' : '') +
        '<div class="champ" style="margin-top:14px"><label class="f">Parfum</label>' +
        '<select id="es-p"><option value="">— choisir —</option>' +
        PARFUMS.map(p => '<option value="' + esc(p) + '"' + (p === r.parfum ? ' selected' : '') + '>' +
          esc(p) + '</option>').join('') + '</select></div>' +
        '<div class="grid g3" style="margin-top:14px">' +
        '<div class="champ"><label class="f">Taille</label><select id="es-t">' +
        TAILLES_BAC.map(x => '<option value="' + x + '"' + (x === taille ? ' selected' : '') + '>' +
          x + ' L</option>').join('') + '</select></div>' +
        '<div class="champ"><label class="f">Nombre</label>' +
        '<input type="number" id="es-n" min="1" step="1" value="1"></div>' +
        '<div class="champ"><label class="f">N° de lot</label>' +
        '<input type="text" id="es-l" value="' + esc(r.lot || '') + '" autocapitalize="characters"></div></div>' +
        '<div class="champ" style="margin-top:14px"><label class="f">DLUO (bac fermé)</label>' +
        '<input type="date" id="es-d" value="' + (r.dluo || '') + '"></div>' +
        '<div class="actions"><button class="btn clair" id="es-x">Annuler</button>' +
        '<button class="btn menthe" id="es-ok">Ajouter au stock</button></div>');

      $('#es-x').onclick = () => { closeSheet(); resolve(false); };
      $('#es-ok').onclick = async () => {
        const p = $('#es-p').value, lot = $('#es-l').value.trim().toUpperCase();
        if (!p) return toast('Choisissez le parfum', 'erreur');
        if (!lot) return toast('Le numéro de lot est obligatoire', 'erreur');
        const t = num($('#es-t').value) || FOURNISSEUR.tailleParDefaut;
        const n = Math.max(1, num($('#es-n').value) || 1);
        const stock = await DB.get('stock:ferme', []);
        stock.push({ id:uid(), produit:p, qte:n, unite:'bac', taille:t,
                     lot:lot, dlc:$('#es-d').value, recuLe:today(),
                     poidsNet:r.poidsNet || null, production:r.production || null,
                     ouvert:false, par:STATE.user.prenom, source:'scan' });
        await DB.set('stock:ferme', stock);
        await feed('ok', STATE.user.prenom + ' a entré en stock ' + n + ' × ' + p +
                   ' ' + t + ' L (lot ' + lot + ')');
        closeSheet();
        resolve(true);
      };
    });
  }

     /* Renvoie true si le produit a bien été enregistré. En mode chaîne, le choix
     du produit est pré-rempli et validable d'un seul appui. */
     function choisirProduit(r, chaine) {
     return new Promise(resolve => {
     const cibles = PARFUMS.map(p => ({ v:'g_' + p, l:p }))
       .concat(Object.keys(DLC_RULES).filter(k => k !== 'defaut')
         .map(k => ({ v:'c_' + k, l:DLC_RULES[k].label })));
     showSheet(
       '<h2 id="sheet-titre">Confirmer le produit</h2>' +
       '<p class="sub">Lot lu : <b>' + esc(r.lot || '—') + '</b>' +
       (r.parfum ? ' · proposition : ' + esc(r.parfum) : '') +
         (chaine ? ' · <b>mode chaîne</b>' : '') + '</p>' +
       '<div class="champ"><label class="f">Produit ouvert</label><select id="tr-p">' +
       '<option value="">— choisir —</option>' +
       cibles.map(c => '<option value="' + c.v + '"' +
         (r.parfum && c.l === r.parfum ? ' selected' : '') + '>' + esc(c.l) + '</option>').join('') +
       '</select></div>' +
       '<div class="champ" style="margin-top:14px"><label class="f">N° de lot</label>' +
       '<input type="text" id="tr-l" value="' + esc(r.lot || '') + '" autocapitalize="characters"></div>' +
       '<div class="champ" style="margin-top:14px"><label class="f">Ouvert le</label>' +
       '<input type="date" id="tr-d" value="' + today() + '"></div>' +
         '<div class="actions"><button class="btn clair" id="tr-x">Annuler</button>' +
           '<button class="btn menthe" id="tr-ok">Enregistrer</button></div>');
      $('#tr-x').onclick = () => { closeSheet(); resolve(false); };
      $('#tr-ok').onclick = async () => {
        const cle = $('#tr-p').value, lot = $('#tr-l').value.trim().toUpperCase();
        if (!cle) return toast('Choisissez le produit', 'erreur');
        if (!lot) return toast('Le numéro de lot est obligatoire', 'erreur');
        const m = monthKey(today());
        const rec = await DB.get('lots:' + m, {});
        rec[cle] = { lot:lot, ouv:$('#tr-d').value, par:STATE.user.prenom, at:nowISO() };
        await DB.set('lots:' + m, rec);

        /* Si ce lot existe en stock fermé, on l'en sort : c'est ce qui évite
           d'avoir à tenir le stock à la main en plus de la traçabilité. */
        const nomProduit = cle.slice(2);
        const stock = await DB.get('stock:ferme', []);
        const candidat = stock.filter(x => !x.ouvert && !x.jete &&
          (x.lot === lot || x.produit === nomProduit))[0];

        if (!candidat) {
          /* Rien en stock : on trace quand même — la traçabilité HACCP prime —
             mais on le dit, car c'est le signe d'une réception non saisie ou
             d'un stock qui a décroché du réel. */
          const suite = await confirmerHorsStock(nomProduit, lot);
          if (!suite) return;
        } else {
          candidat.qte = Math.max(0, num(candidat.qte) - 1);
          if (candidat.qte === 0) {
            candidat.ouvert = true;
            candidat.ouvertLe = $('#tr-d').value || today();
            candidat.ouvertPar = STATE.user.prenom;
            candidat.lotOuverture = lot;
          } else {
            stock.push(Object.assign({}, candidat, { id:uid(), qte:1, ouvert:true,
              ouvertLe:$('#tr-d').value || today(), ouvertPar:STATE.user.prenom, lotOuverture:lot }));
          }
          await DB.set('stock:ferme', stock);
          toast(nomProduit + ' sorti du stock fermé');
        }

        await feed(candidat ? 'ok' : 'warn',
          STATE.user.prenom + ' a ouvert ' + nomProduit + ' (lot ' + lot + ')' +
          (candidat ? '' : ' — absent du stock fermé'));
        closeSheet();
        resolve(true);
      };
    });
  }
};
   
   /* Ouverture d'un produit absent du stock fermé : on avertit sans bloquer.
   Bloquer empêcherait de tracer un bac réellement ouvert, ce qui serait pire
   qu'un stock inexact lors d'un contrôle sanitaire. */
function confirmerHorsStock(produit, lot) {
  return new Promise(resolve => {
    showSheet(
      '<h2 id="sheet-titre">⚠️ Absent du stock fermé</h2>' +
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
    return Object.assign({}, t, p || {});
  }).filter(t => !t.retiree);
}
async function tachesHebdoDuJour(jour) {
  const j = jourISO(jour);
  return (await planHebdo()).filter(t => +t.jour === j)
    .sort((a, b) => (a.rang || 0) - (b.rang || 0));
}

V.hebdo = async function () {
  const j = STATE.jour;
  const taches = await tachesHebdoDuJour(j);
  const rec = await DB.get('hebdo:' + j, {});
  const preuves = await DB.get('preuves:' + j, []);
  const resp = await DB.get('hebdo:responsables', {});
  const faits = taches.filter(t => rec[t.id] && rec[t.id].ok).length;

  $('#vue-actions').innerHTML = '<input type="date" id="jj" value="' + j + '" style="width:auto;min-height:42px">';

  const photosDe = id => preuves.filter(p => p.tache === id);

  $('#page').innerHTML =
    carte(entete('🗓️', nomJour(j) + ' ' + fmtD(j),
      taches.length ? faits + ' sur ' + taches.length + ' tâches du jour'
                    : 'Aucune tâche hebdomadaire prévue ce jour') +
      (taches.length
        ? '<div class="jauge"><i style="width:' + Math.round(faits / taches.length * 100) + '%"></i></div>'
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
            (ph.length >= HEBDO.photosMax ? ' disabled' : '') + '>📷 ' +
            (ph.length ? 'Ajouter une photo' : 'Photographier') + '</button>' +
            '<button class="btn ' + (v.ok ? 'clair' : 'menthe') + '" data-v="' + t.id + '">' +
            (v.ok ? 'Annuler' : '✓ Valider') + '</button></div>',
            v.ok ? 'menthe' : '');
        }).join('') + '</div>'
      : vide('🗓️', 'Rien de prévu ce jour dans le plan hebdomadaire.')) +

    '<div class="entete"><h3>Responsables de la semaine</h3></div>' +
    '<div class="stack">' + RESPONSABLES.map(r => {
      const qui = resp[r.id] ? (EQUIPE.filter(e => e.id === resp[r.id])[0] || {}).prenom : null;
      return carte('<div class="rang"><span class="ci">' + r.icone + '</span>' +
        '<div style="flex:1;min-width:0"><b>' + esc(r.libelle) + '</b></div>' +
        (qui ? pastille('ok', esc(qui)) : pastille('n', 'non attribué')) + '</div>',
        qui ? 'menthe' : 'sable');
    }).join('') + '</div>';

  $('#jj').onchange = e => { STATE.jour = e.target.value; rendre('hebdo'); };

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
  const moments = RELEVES.moments;

  /* Valeur courante : ce qui est déjà saisi, sinon la cible de l'enceinte */
  const val = (e, m) => {
    const v = rec[m.id + '_' + e.id];
    if (v === 'HS') return 'HS';
    return (v === undefined || v === '') ? defautEnceinte(e) : Number(v);
  };
  const saisi = (e, m) => {
    const v = rec[m.id + '_' + e.id];
    return v !== undefined && v !== '';
  };

  $('#vue-actions').innerHTML = '<input type="date" id="jj" value="' + j + '" style="width:auto;min-height:42px">';

  const ligneMoment = (e, m) => {
    const v = val(e, m), hs = v === 'HS', ok = saisi(e, m);
    const etat = hs ? '' : etatTemp(e, v);
    return '<div class="tmoment' + (ok ? ' ok' : '') + '">' +
      '<span class="tm-lbl">' + m.label + '</span>' +
      (hs
        ? '<span class="tm-hs">Hors service</span>'
        : '<button class="tm-pas" data-pas="-1" data-e="' + e.id + '" data-m="' + m.id + '">−</button>' +
          '<button class="tm-val ' + etat + '" data-libre="' + e.id + '.' + m.id + '">' +
          v + '<small>°C</small></button>' +
          '<button class="tm-pas" data-pas="1" data-e="' + e.id + '" data-m="' + m.id + '">+</button>') +
      '<button class="tm-off' + (hs ? ' on' : '') + '" data-hs="' + e.id + '.' + m.id + '">HS</button>' +
      '</div>';
  };

  const manquants = () => ENCEINTES.filter(e => moments.some(m => !saisi(e, m)));

  const dessiner = () => {
    const reste = manquants();
    $('#page').innerHTML =
      carte(entete('🌡️', 'Relévé du ' + fmtD(j),
        reste.length ? reste.length + ' enceinte(s) à relever'
                     : 'Toutes les enceintes sont relevées') +
        '<div class="jauge"><i class="' + (reste.length ? 'warn' : '') + '" style="width:' +
        Math.round((ENCEINTES.length - reste.length) / ENCEINTES.length * 100) + '%"></i></div>', 'solide') +

      '<div class="stack" style="margin-top:12px">' + ENCEINTES.map(e =>
        carte('<div class="rang"><b style="flex:1">' + esc(e.nom) + '</b>' +
          '<span class="mini">cible ' + e.cible + '</span>' +
          '<span data-st="' + e.id + '">' + pastilleTemp(e, rec) + '</span></div>' +
          moments.map(m => ligneMoment(e, m)).join(''),
          moments.every(m => saisi(e, m)) ? 'menthe' : '')
      ).join('') + '</div>' +

      carte(entete('📝', 'Action corrective',
        'Obligatoire dès qu’une enceinte dépasse sa limite critique.') +
        '<textarea id="obs" placeholder="Ex. vitrine gelato à −9 °C : bacs transférés en chambre froide, technicien appelé.">' +
        esc(rec.obs || '') + '</textarea>') +

      '<button class="btn menthe bloc xl" id="tvalider" style="margin-top:16px">' +
      (reste.length ? '✓ Valider (' + reste.length + ' enceinte(s) non relevée(s))' : '✓ Valider le relevé') +
      '</button>' +
      '<p class="mini" style="text-align:center;margin-top:10px">' +
      (rec.par ? 'Signé par ' + esc(rec.par) + ' · ' + heure(rec.at) : 'Pas encore signé') + '</p>';

    brancher();
  };

  const sauver = async () => {
    rec.obs = $('#obs') ? $('#obs').value : (rec.obs || '');
    rec.par = STATE.user.prenom; rec.id = STATE.user.id; rec.at = nowISO();
    await DB.set('temp:' + j, rec);
  };

  function brancher() {
    $('#jj').onchange = ev => { V.temp._d = ev.target.value; rendre('temp'); };

    $$('[data-pas]').forEach(b => b.onclick = async () => {
      const e = ENCEINTES.filter(x => x.id === b.dataset.e)[0];
      const m = moments.filter(x => x.id === b.dataset.m)[0];
      const actuel = val(e, m);
      const nouveau = (actuel === 'HS' ? defautEnceinte(e) : actuel) + (+b.dataset.pas);
      if (nouveau < e.lo - 5 || nouveau > e.hi + 5) return;
      rec[m.id + '_' + e.id] = nouveau;
      vibrer(UI.vibration.ok);
      await sauver();
      dessiner();
      if (etatTemp(e, nouveau) === 'crit') alerteCritique(e, nouveau);
    });

    $$('[data-hs]').forEach(b => b.onclick = async () => {
      const [eid, mid] = b.dataset.hs.split('.');
      const cle = mid + '_' + eid;
      rec[cle] = (rec[cle] === 'HS') ? '' : 'HS';
      await sauver();
      dessiner();
    });

    $$('[data-libre]').forEach(b => b.onclick = () => {
      const [eid, mid] = b.dataset.libre.split('.');
      const e = ENCEINTES.filter(x => x.id === eid)[0];
      const m = moments.filter(x => x.id === mid)[0];
      showSheet(
        '<h2 id="sheet-titre">' + esc(e.nom) + ' · ' + m.label + '</h2>' +
        '<p class="sub">Cible ' + e.cible + '</p>' +
        '<div class="champ"><label class="f">Température relevée (°C)</label>' +
        '<input type="number" step="0.1" id="tl" data-autofocus value="' +
        (val(e, m) === 'HS' ? '' : val(e, m)) + '" style="font-size:28px;text-align:center"></div>' +
        '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
        '<button class="btn menthe" id="tlok">Enregistrer</button></div>');
      $('#tlok').onclick = async () => {
        const v = $('#tl').value;
        if (v === '') return toast('Saisissez une température', 'erreur');
        rec[m.id + '_' + e.id] = num(v);
        await sauver();
        closeSheet();
        dessiner();
        if (etatTemp(e, num(v)) === 'crit') alerteCritique(e, num(v));
      };
    });

    if ($('#obs')) $('#obs').oninput = debounce(sauver, 600);

    $('#tvalider').onclick = async () => {
      const reste = manquants();
      const crit = ENCEINTES.filter(e => moments.some(m => etatTemp(e, rec[m.id + '_' + e.id]) === 'crit'));
      if (crit.length && !(rec.obs || '').trim()) {
        toast('Renseignez l’action corrective', 'erreur');
        if ($('#obs')) $('#obs').focus();
        return;
      }
      if (reste.length) {
        confirmer('Valider malgré ' + reste.length + ' enceinte(s) non relevée(s) ?',
          'Non relevées : ' + reste.map(e => e.nom).join(', ') + '. Un registre incomplet ' +
          'est un registre contestable lors d’un contrôle.',
          'Valider quand même', async () => { await finir(); });
        return;
      }
      await finir();
    };

    async function finir() {
      await sauver();
      await feed('ok', STATE.user.prenom + ' a relevé les températures');
      toast('Relévé enregistré');
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
  const perso = await DB.get('hebdo:plan', {}) || {};
  const plan = await planHebdo();

  const rendreEditeur = () => {
    const parJour = {};
    for (let j = 1; j <= 7; j++) parJour[j] = [];
    plan.forEach(t => { const j = +t.jour; if (parJour[j]) parJour[j].push(t); });
    Object.keys(parJour).forEach(j => parJour[j].sort((a, b) => (a.rang || 0) - (b.rang || 0)));

    $('#sheet-corps').innerHTML =
      '<h2 id="sheet-titre">Organiser la semaine</h2>' +
      '<p class="sub">' + plan.length + ' tâches réparties sur sept jours</p>' +
      '<div style="max-height:56vh;overflow:auto">' +
      [1,2,3,4,5,6,7].map(j =>
        '<div class="entete"><h3>' + JOURS_SEMAINE[j] + '</h3>' +
        '<span class="pousse mini num">' + parJour[j].length + '</span></div>' +
        (parJour[j].length
          ? parJour[j].map(t =>
              '<div class="card plat" style="margin-bottom:8px">' +
              '<b style="font-size:14px;line-height:1.3;display:block">' + esc(t.libelle) + '</b>' +
              '<div class="grid g2" style="margin-top:10px;gap:8px">' +
              '<div class="champ"><label class="f">Jour</label>' +
              '<select data-j="' + t.id + '">' + [1,2,3,4,5,6,7].map(k =>
                '<option value="' + k + '"' + (+t.jour === k ? ' selected' : '') + '>' +
                JOURS_SEMAINE[k] + '</option>').join('') + '</select></div>' +
              '<div class="champ"><label class="f">Attribuée à</label>' +
              '<select data-a="' + t.id + '"><option value="">— toute l’équipe —</option>' +
              EQUIPE.map(e => '<option value="' + e.id + '"' +
                (t.assignee === e.id ? ' selected' : '') + '>' + esc(e.prenom) + '</option>').join('') +
              '</select></div></div></div>').join('')
          : '<p class="mini" style="margin-bottom:10px">Aucune tâche ce jour</p>')
      ).join('') + '</div>' +
      '<div class="actions"><button class="btn clair" id="os-x">Annuler</button>' +
      '<button class="btn menthe" id="os-ok">Enregistrer</button></div>' +
      '<button class="btn fantome bloc" id="os-raz" style="margin-top:8px">' +
      'Rétablir le tableau d’origine</button>';

    $('#os-x').onclick = closeSheet;

    /* Changer le jour redessine immédiatement, pour voir la répartition. */
    $$('[data-j]').forEach(s => s.onchange = () => {
      const t = plan.filter(x => x.id === s.dataset.j)[0];
      if (t) t.jour = +s.value;
      rendreEditeur();
    });
    $$('[data-a]').forEach(s => s.onchange = () => {
      const t = plan.filter(x => x.id === s.dataset.a)[0];
      if (t) t.assignee = s.value || null;
    });

    $('#os-ok').onclick = async () => {
      const out = {};
      plan.forEach(t => { out[t.id] = { jour:+t.jour, assignee:t.assignee || null }; });
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
   J. RESTAURATION DES RÉGLAGES AU DÉMARRAGE
   ========================================================================== */
   (async function appliquerReglages() {
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
    /* Plan hebdomadaire décidé par le manager */
    const plan = await DB.get('hebdo:plan', null);
    if (plan) TACHES_HEBDO.forEach(t => { if (plan[t.id]) Object.assign(t, plan[t.id]); });
     } catch (err) { /* réglages d'usine */ }
   })();
   
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
           ? '<div class="alerte ok"><span class="ai">✓</span><div><b>Validé</b><p>' + esc(rec.par) + ' · ' +
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
   const V_reglages_origine = V.reglages;
   V.reglages = async function () {
     await V_reglages_origine.call(this);
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
         (ok ? '<div class="alerte ok" style="margin-top:12px"><span class="ai">✓</span><div>' +
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