
function libererCanvas(cv) {
  try { cv.width = 0; cv.height = 0; } catch (e) {}
}

/* =============================================================================
   7. CONFIRMATION — rien n'entre dans un registre sans relecture humaine
   ========================================================================== */
function confirmerLecture(type, r, apercu, resolve) {
  const sur  = r.confiance >= 0.72 && r.lot && !r.corrige;
  const rien = !r.lot && !r.parfum;

  if (rien) return saisieManuelle(type, 'Aucun code lisible sur la photo', resolve);

  showSheet(
    '<h2 id="sheet-titre">Étiquette lue</h2>' +
    '<p class="sub">Confiance ' + Math.round(r.confiance * 100) + ' %' +
    (r.corrige ? ' · caractères corrigés automatiquement' : '') + '</p>' +

    (sur ? '' :
      '<div class="alerte warn"><span class="ai">●</span><div><b>Lecture incertaine</b>' +
      '<p>Vérifiez chaque caractère sur l’étiquette avant de valider. Un numéro de lot faux ' +
      'rend la traçabilité inutilisable en cas de contrôle.</p></div></div>') +

    '<div class="champ" style="margin-top:14px"><label class="f">Numéro de lot</label>' +
    '<input type="text" id="oc-lot" value="' + esc(r.lot) + '" ' +
    'inputmode="text" autocapitalize="characters" spellcheck="false" ' +
    'style="font-size:22px;letter-spacing:.14em;text-align:center"></div>' +

    (type === 'etiquette'
      ? '<div class="champ" style="margin-top:14px"><label class="f">Parfum</label>' +
        '<select id="oc-parfum"><option value="">— non identifié —</option>' +
        PARFUMS.map(p => '<option value="' + esc(p) + '"' + (p === r.parfum ? ' selected' : '') + '>' +
          esc(p) + '</option>').join('') + '</select></div>' +
        '<div class="champ" style="margin-top:14px"><label class="f">Ouvert le</label>' +
        '<input type="date" id="oc-date" value="' + r.ouv + '"></div>'
      : '') +

    (apercu ? '<details style="margin-top:16px"><summary class="mini">Voir ce qu’a vu la machine</summary>' +
      '<img src="' + apercu + '" alt="Image traitée" ' +
      'style="width:100%;border-radius:12px;margin-top:10px;border:1px solid var(--line)">' +
      '<pre class="mini" style="white-space:pre-wrap;margin-top:10px">' + esc(r.texte.slice(0, 400)) + '</pre>' +
      '</details>' : '') +

    '<div class="actions"><button class="btn clair" id="oc-x">Reprendre la photo</button>' +
    '<button class="btn menthe" id="oc-ok">Valider</button></div>' +
    '<button class="btn ciel bloc" id="oc-suite" style="margin-top:10px">' +
    '✅ Valider et scanner le suivant</button>');

  const recolter = () => {
    const lot = document.getElementById('oc-lot').value.trim().toUpperCase();
    if (!lot) { toast('Le numéro de lot est obligatoire', 'erreur'); return null; }
    const pf = document.getElementById('oc-parfum');
    const dt = document.getElementById('oc-date');
    return Object.assign({}, r, {
      lot: lot, numero: lot,
      parfum: pf ? pf.value : r.parfum,
      ouv: dt ? dt.value : r.ouv,
      valide: true, par: STATE.user ? STATE.user.prenom : null
    });
  };

  document.getElementById('oc-x').onclick  = () => { closeSheet(); resolve(null); };
  document.getElementById('oc-ok').onclick = () => {
    const v = recolter(); if (!v) return;
    closeSheet(); resolve(v);
  };
  /* Mode chaîne : on enregistre et l'appareil photo repart immédiatement.
     Une livraison, c'est cinquante étiquettes — refermer la fiche et rouvrir
     le menu à chaque fois n'est pas tenable un jour de rush. */
  document.getElementById('oc-suite').onclick = () => {
    const v = recolter(); if (!v) return;
    closeSheet(); resolve(Object.assign(v, { enchainer: true }));
  };
}

function saisieManuelle(type, raison, resolve) {
  showSheet(
    '<h2 id="sheet-titre">Lecture impossible</h2>' +
    '<p class="sub">' + esc(raison) + '</p>' +
    '<div class="alerte info"><span class="ai">✍️</span><div><b>Saisissez le lot à la main</b>' +
    '<p>Reflet trop fort, étiquette abîmée ou photo floue. Tapez le numéro, on avance quand même.</p></div></div>' +
    '<div class="champ" style="margin-top:14px"><label class="f">Numéro de lot</label>' +
    '<input type="text" id="sm-lot" data-autofocus autocapitalize="characters" spellcheck="false" ' +
    'placeholder="Ex. 13845A" style="font-size:22px;letter-spacing:.14em;text-align:center"></div>' +
    (type === 'etiquette'
      ? '<div class="champ" style="margin-top:14px"><label class="f">Parfum</label>' +
        '<select id="sm-parfum"><option value="">— choisir —</option>' +
        PARFUMS.map(p => '<option value="' + esc(p) + '">' + esc(p) + '</option>').join('') + '</select></div>'
      : '') +
    '<div class="actions"><button class="btn clair" id="sm-x">Annuler</button>' +
    '<button class="btn menthe" id="sm-ok">Enregistrer</button></div>' +
    '<button class="btn ciel bloc" id="sm-suite" style="margin-top:10px">' +
    '✅ Enregistrer et scanner le suivant</button>');

  document.getElementById('sm-x').onclick  = () => { closeSheet(); resolve(null); };
  const valider = enchainer => {
    const lot = document.getElementById('sm-lot').value.trim().toUpperCase();
    if (!lot) return toast('Saisissez le numéro de lot', 'erreur');
    const pf = document.getElementById('sm-parfum');
    closeSheet();
    resolve({ lot: lot, numero: lot, ouv: today(), date: today(),
              parfum: pf ? pf.value : '', fournisseur: FOURNISSEUR.nom,
              lignes: [], lignesNonLues: true,
              confiance: 1, saisieManuelle: true, texte: '', enchainer: !!enchainer });
  };
  document.getElementById('sm-ok').onclick    = () => valider(false);
  document.getElementById('sm-suite').onclick = () => valider(true);
}
