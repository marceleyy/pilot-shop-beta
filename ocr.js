/* =============================================================================
   PILOT-SHOP — ocr.js
   Lecture réelle des étiquettes de bacs inox.

   Les quatre problèmes traités :
     1. EXIF     — l'orientation est retirée du fichier avant décodage, puis
                   appliquée nous-mêmes. Aucun navigateur ne peut plus la
                   corriger dans notre dos ni la corriger deux fois.
     2. Charabia — deux passes Tesseract distinctes, chacune avec sa liste de
                   caractères autorisés, plus un correcteur de confusions.
     3. Reflets  — seuillage local de Sauvola au lieu d'un seuil global : le
                   seuil suit la luminosité de chaque zone, une tache de
                   lumière ne mange plus le texte autour.
     4. Mémoire  — redimensionnement pendant le décodage, jamais 12 Mpx en RAM,
                   libération explicite, worker arrêté après inactivité.

   Dépend de : Tesseract.js (CDN), et de PARFUMS / toast / showSheet / esc de
   l'application. Se charge APRÈS app.js : la fonction y remplace la simulation.
   ============================================================================= */

'use strict';

const OCR = {
  langues:       'fra',        // 'eng+fra' double la mémoire pour peu de gain
  cotePx:        1400,         // côté long envoyé à Tesseract
  cotePreviewPx: 900,
  tailleMaxMo:   25,
  sauvola:       { k: 0.34, R: 128, divFenetre: 18 },
  inactiviteMs:  90000,        // arrêt du worker après ce délai sans usage
  batch:         /(\d{5})\s*([A-Z])/g,
  _worker: null,
  _minuteur: null
};

/* =============================================================================
   1. EXIF — lecture puis neutralisation de l'orientation
   ========================================================================== */
function exifOrientation(buffer) {
  const v = new DataView(buffer);
  if (v.byteLength < 4 || v.getUint16(0, false) !== 0xFFD8) return { orientation: 1, offset: -1 };

  let i = 2;
  while (i + 4 <= v.byteLength) {
    const marqueur = v.getUint16(i, false);
    if ((marqueur & 0xFF00) !== 0xFF00) break;
    const taille = v.getUint16(i + 2, false);

    if (marqueur === 0xFFE1) {                       // APP1
      const tiff = i + 10;
      if (tiff + 8 > v.byteLength) break;
      if (v.getUint32(i + 4, false) !== 0x45786966) { i += 2 + taille; continue; } // "Exif"

      const ordre = v.getUint16(tiff, false);
      const li = ordre === 0x4949;                   // 'II' petit-boutiste
      if (!li && ordre !== 0x4D4D) break;

      const ifd0 = tiff + v.getUint32(tiff + 4, li);
      if (ifd0 + 2 > v.byteLength) break;
      const n = v.getUint16(ifd0, li);

      for (let e = 0; e < n; e++) {
        const entree = ifd0 + 2 + e * 12;
        if (entree + 12 > v.byteLength) break;
        if (v.getUint16(entree, li) === 0x0112) {    // tag Orientation
          const o = v.getUint16(entree + 8, li);
          return { orientation: (o >= 1 && o <= 8) ? o : 1,
                   offset: entree + 8, petitBoutiste: li };
        }
      }
      break;
    }
    if (marqueur === 0xFFDA) break;                  // début des données image
    i += 2 + taille;
  }
  return { orientation: 1, offset: -1 };
}

/* Remet l'orientation à 1 dans une copie du fichier : le navigateur décodera
   les pixels bruts, quelle que soit sa politique EXIF. */
function neutraliserExif(buffer, info) {
  if (info.offset < 0 || info.orientation === 1) return buffer;
  const copie = buffer.slice(0);
  new DataView(copie).setUint16(info.offset, 1, info.petitBoutiste);
  return copie;
}

/* Matrice de remise à l'endroit, appliquée au contexte du canvas */
function transformerSelonExif(ctx, o, l, h) {
  switch (o) {
    case 2: ctx.transform(-1, 0, 0, 1, l, 0); break;                 // miroir
    case 3: ctx.transform(-1, 0, 0, -1, l, h); break;                // 180°
    case 4: ctx.transform(1, 0, 0, -1, 0, h); break;                 // miroir vertical
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;                  // transposée
    case 6: ctx.transform(0, 1, -1, 0, h, 0); break;                 // 90° horaire
    case 7: ctx.transform(0, -1, -1, 0, h, l); break;                // transverse
    case 8: ctx.transform(0, -1, 1, 0, 0, l); break;                 // 90° antihoraire
    default: break;                                                  // 1 : rien
  }
}
const orientationPivote = o => o >= 5 && o <= 8;

/* =============================================================================
   2. DÉCODAGE ÉCONOME
   Le redimensionnement se fait pendant le décodage quand le navigateur le
   permet : les 12 Mpx bruts ne sont jamais tous en mémoire d'un coup.
   ========================================================================== */
async function chargerImage(file, cote) {
  if (file.size > OCR.tailleMaxMo * 1024 * 1024) {
    throw new Error('Photo trop lourde (' + Math.round(file.size / 1048576) + ' Mo)');
  }

  const buffer = await file.arrayBuffer();
  const info   = exifOrientation(buffer);
  const propre = new Blob([neutraliserExif(buffer, info)], { type: file.type || 'image/jpeg' });

  let source, lSrc, hSrc;

  if (typeof createImageBitmap === 'function') {
    let bmp = await createImageBitmap(propre);
    const grand = Math.max(bmp.width, bmp.height);
    if (grand > cote) {
      const r = cote / grand;
      const l = Math.round(bmp.width * r), h = Math.round(bmp.height * r);
      let reduit;
      try {
        reduit = await createImageBitmap(propre, { resizeWidth: l, resizeHeight: h, resizeQuality: 'high' });
      } catch (e) { reduit = null; }
      if (reduit) { bmp.close(); bmp = reduit; }
    }
    source = bmp; lSrc = bmp.width; hSrc = bmp.height;
  } else {
    const url = URL.createObjectURL(propre);
    const img = new Image();
    await new Promise((ok, ko) => { img.onload = ok; img.onerror = () => ko(new Error('Image illisible')); img.src = url; });
    URL.revokeObjectURL(url);
    source = img; lSrc = img.naturalWidth; hSrc = img.naturalHeight;
  }

  const grand = Math.max(lSrc, hSrc);
  const r = grand > cote ? cote / grand : 1;
  const l = Math.round(lSrc * r), h = Math.round(hSrc * r);

  const pivote = orientationPivote(info.orientation);
  const cv = document.createElement('canvas');
  cv.width  = pivote ? h : l;
  cv.height = pivote ? l : h;

  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  transformerSelonExif(ctx, info.orientation, l, h);
  ctx.drawImage(source, 0, 0, l, h);

  if (source.close) source.close();
  return { canvas: cv, orientation: info.orientation };
}

/* =============================================================================
   3. PRÉTRAITEMENT — Sauvola
   Un seuil global échoue sur l'inox : la tache de lumière est au-dessus du
   seuil, le texte à côté passe en dessous et disparaît. Sauvola calcule un
   seuil par pixel à partir de la moyenne et de l'écart-type locaux :
       t = m · (1 + k · (σ/R − 1))
   Là où la zone est uniforme (reflet pur), σ est faible et le seuil descend :
   le reflet est classé fond, sans manger l'encre voisine.
   ========================================================================== */
function pretraiter(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const L = canvas.width, H = canvas.height, N = L * H;
  const img = ctx.getImageData(0, 0, L, H);
  const px = img.data;

  /* Niveaux de gris, pondération perceptuelle */
  const gris = new Uint8ClampedArray(N);
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    gris[i] = (px[j] * 0.299 + px[j + 1] * 0.587 + px[j + 2] * 0.114) | 0;
  }

  /* Étirement de contraste sur les centiles 2 et 98 : insensible aux quelques
     pixels blancs saturés du reflet, contrairement à un min/max brut. */
  const hist = new Uint32Array(256);
  for (let i = 0; i < N; i++) hist[gris[i]]++;
  let bas = 0, haut = 255, cumul = 0;
  const seuilBas = N * 0.02, seuilHaut = N * 0.98;
  for (let v = 0; v < 256; v++) { cumul += hist[v]; if (cumul >= seuilBas) { bas = v; break; } }
  cumul = 0;
  for (let v = 0; v < 256; v++) { cumul += hist[v]; if (cumul >= seuilHaut) { haut = v; break; } }
  if (haut - bas > 20) {
    const e = 255 / (haut - bas);
    for (let i = 0; i < N; i++) {
      const v = (gris[i] - bas) * e;
      gris[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }

  /* Images intégrales : somme en Int32 (max 255·2 Mpx tient), somme des carrés
     en Float64 (dépasse largement l'Int32). Coût mémoire mesuré, pas subi. */
  const W = L + 1;
  const somme  = new Int32Array(W * (H + 1));
  const carres = new Float64Array(W * (H + 1));
  for (let y = 0; y < H; y++) {
    let ligne = 0, ligneC = 0;
    for (let x = 0; x < L; x++) {
      const v = gris[y * L + x];
      ligne += v; ligneC += v * v;
      const k = (y + 1) * W + (x + 1);
      somme[k]  = somme[k - W] + ligne;
      carres[k] = carres[k - W] + ligneC;
    }
  }

  /* Fenêtre proportionnelle à l'image, impaire, jamais sous 15 px */
  let f = Math.round(Math.min(L, H) / OCR.sauvola.divFenetre);
  if (f < 15) f = 15;
  if (f % 2 === 0) f++;
  const d = f >> 1, k = OCR.sauvola.k, R = OCR.sauvola.R;

  for (let y = 0; y < H; y++) {
    const y0 = y - d < 0 ? 0 : y - d;
    const y1 = y + d >= H ? H - 1 : y + d;
    for (let x = 0; x < L; x++) {
      const x0 = x - d < 0 ? 0 : x - d;
      const x1 = x + d >= L ? L - 1 : x + d;
      const aire = (y1 - y0 + 1) * (x1 - x0 + 1);

      const A = y0 * W + x0, B = y0 * W + (x1 + 1);
      const C = (y1 + 1) * W + x0, D = (y1 + 1) * W + (x1 + 1);

      const s  = somme[D]  - somme[B]  - somme[C]  + somme[A];
      const sc = carres[D] - carres[B] - carres[C] + carres[A];

      const m = s / aire;
      let variance = sc / aire - m * m;
      if (variance < 0) variance = 0;
      const seuil = m * (1 + k * (Math.sqrt(variance) / R - 1));

      const i = y * L + x, j = i * 4;
      const noir = gris[i] < seuil;
      px[j] = px[j + 1] = px[j + 2] = noir ? 0 : 255;
      px[j + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

/* =============================================================================
   4. TESSERACT
   Un seul worker, réutilisé, arrêté après inactivité. Deux passes : une pour
   le code, chiffres et majuscules seulement ; une pour le parfum, lettres
   seulement. Mélanger les deux jeux de caractères est la première cause de
   charabia sur ce type d'étiquette.
   ========================================================================== */
async function obtenirWorker() {
  if (OCR._worker) return OCR._worker;
  if (typeof Tesseract === 'undefined') throw new Error('Tesseract absent — vérifiez le réseau');

  let w;
  try {
    w = await Tesseract.createWorker(OCR.langues, 1);        // API v5
  } catch (e) {
    w = await Tesseract.createWorker();                      // API v4
  }
  if (typeof w.loadLanguage === 'function') {                // v4 : chargement manuel
    await w.load();
    await w.loadLanguage(OCR.langues);
    await w.initialize(OCR.langues);
  }
  OCR._worker = w;
  return w;
}
function reporterArret() {
  clearTimeout(OCR._minuteur);
  OCR._minuteur = setTimeout(async () => {
    if (!OCR._worker) return;
    try { await OCR._worker.terminate(); } catch (e) {}
    OCR._worker = null;
  }, OCR.inactiviteMs);
}

const MAJUSCULES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LETTRES    = MAJUSCULES + 'abcdefghijklmnopqrstuvwxyzÀÂÇÉÈÊËÎÏÔÛÙÜàâçéèêëîïôûùüœ -';

async function lire(canvas, profil) {
  const w = await obtenirWorker();
  const params = profil === 'code'
    ? { tessedit_char_whitelist: '0123456789' + MAJUSCULES,
        tessedit_pageseg_mode: '11',        // texte épars : l'étiquette n'est pas un paragraphe
        tessedit_ocr_engine_mode: '1',      // LSTM seul
        classify_bln_numeric_mode: '0',
        preserve_interword_spaces: '1' }
    : { tessedit_char_whitelist: LETTRES,
        tessedit_pageseg_mode: '6',         // bloc de texte uniforme
        tessedit_ocr_engine_mode: '1',
        preserve_interword_spaces: '1' };

  await w.setParameters(params);
  const r = await w.recognize(canvas);
  reporterArret();
  return { texte: (r.data.text || '').trim(), confiance: (r.data.confidence || 0) / 100 };
}

/* =============================================================================
   5. EXTRACTION
   ========================================================================== */
const VERS_CHIFFRE = { O:'0', o:'0', Q:'0', D:'0', I:'1', l:'1', L:'1', '|':'1',
                       Z:'2', S:'5', s:'5', B:'8', G:'6', T:'7', A:'4', g:'9' };
const VERS_LETTRE  = { '0':'O', '1':'I', '5':'S', '8':'B', '6':'G', '2':'Z', '4':'A' };

function extraireBatch(texte) {
  const brut = texte.toUpperCase().replace(/[^0-9A-Z|\s]/g, ' ');

  /* Passe 1 : le motif est déjà propre */
  OCR.batch.lastIndex = 0;
  let m = OCR.batch.exec(brut);
  if (m) return { code: m[1] + m[2], corrige: false };

  /* Passe 2 : six caractères plausibles collés, on corrige les confusions
     classiques selon la position — un 0 en dernière place est un O. */
  const jetons = brut.split(/\s+/).filter(t => t.length >= 5 && t.length <= 8);
  for (const t of jetons) {
    const c = t.split('');
    let chiffres = '', reste = '';
    for (let i = 0; i < c.length && chiffres.length < 5; i++) {
      const ch = VERS_CHIFFRE[c[i]] !== undefined ? VERS_CHIFFRE[c[i]] : c[i];
      if (/[0-9]/.test(ch)) chiffres += ch; else if (chiffres.length) { reste = c.slice(i).join(''); break; }
    }
    if (chiffres.length !== 5) continue;
    if (!reste) reste = t.slice(-1);
    const l0 = reste[0];
    const lettre = VERS_LETTRE[l0] !== undefined ? VERS_LETTRE[l0] : l0;
    if (/[A-Z]/.test(lettre)) return { code: chiffres + lettre, corrige: true };
  }
  return null;
}

/* Distance de Levenshtein, bornée : deux lignes de travail seulement */
function distance(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prec = new Array(n + 1), cour = new Array(n + 1);
  for (let j = 0; j <= n; j++) prec[j] = j;
  for (let i = 1; i <= m; i++) {
    cour[0] = i;
    for (let j = 1; j <= n; j++) {
      cour[j] = Math.min(prec[j] + 1, cour[j - 1] + 1, prec[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    const t = prec; prec = cour; cour = t;
  }
  return prec[n];
}
const sansAccents = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/* Les chiffres qui traînent dans un mot sont des lettres mal lues */
const CHIFFRE_EN_LETTRE = { '0':'o', '1':'i', '3':'e', '4':'a', '5':'s', '6':'g', '8':'b' };

function extraireParfum(texte) {
  const nettoye = sansAccents(texte)
    .replace(/[0-9]/g, c => CHIFFRE_EN_LETTRE[c] !== undefined ? CHIFFRE_EN_LETTRE[c] : ' ')
    .replace(/[^a-z\s-]/g, ' ');
  const mots = nettoye.split(/\s+/).filter(m => m.length >= 3);
  if (!mots.length) return null;

  let meilleur = null;
  for (const p of PARFUMS) {
    const cible = sansAccents(p);
    const partiel = cible.split(' ')[0];
    for (const mot of mots) {
      const d = Math.min(distance(mot, cible), distance(mot, partiel));
      const ref = Math.min(mot.length, partiel.length);
      const score = 1 - d / Math.max(ref, 1);
      if (score > 0.62 && (!meilleur || score > meilleur.score)) {
        meilleur = { parfum: p, score: score, lu: mot };
      }
    }
  }
  return meilleur;
}

/* =============================================================================
   6. FONCTION PRINCIPALE
   Remplace la version simulée. Contrat de retour inchangé :
     'etiquette' → { lot, ouv, parfum, confiance, texte }
     'bl'        → { fournisseur, numero, date, lignes, confiance, texte }
   ========================================================================== */
function scannerPhoto(type) {
  return new Promise(resolve => {
    const cam = document.getElementById('cam');
    cam.value = '';

    cam.onchange = async () => {
      const file = cam.files && cam.files[0];
      if (!file) return resolve(null);

      let canvas = null, apercu = '';
      const etape = (t, s) => showSheet(
        '<h2 id="sheet-titre">' + t + '</h2><p class="sub">' + esc(file.name) + '</p>' +
        '<div class="vide"><span class="vi">🔍</span>' + s + '</div>');

      try {
        etape('Lecture de l’étiquette', 'Mise à l’endroit de la photo…');
        const chargee = await chargerImage(file, OCR.cotePx);
        canvas = chargee.canvas;

        etape('Lecture de l’étiquette', 'Nettoyage des reflets…');
        await new Promise(r => setTimeout(r, 30));          // laisse l'écran se rafraîchir
        pretraiter(canvas);
        try { apercu = canvas.toDataURL('image/jpeg', 0.6); } catch (e) {}

        etape('Lecture de l’étiquette', 'Reconnaissance du texte…');
        const code   = await lire(canvas, 'code');
        const parfum = await lire(canvas, 'parfum');

        const batch = extraireBatch(code.texte + '\n' + parfum.texte);
        const trouve = extraireParfum(parfum.texte);
        const confiance = (code.confiance + parfum.confiance) / 2;

        libererCanvas(canvas); canvas = null;

        const r = type === 'etiquette'
          ? { lot: batch ? batch.code : '', ouv: today(), parfum: trouve ? trouve.parfum : '',
              confiance: confiance, corrige: !!(batch && batch.corrige),
              texte: (code.texte + '\n' + parfum.texte).trim() }
          : { fournisseur: FOURNISSEUR.nom, numero: batch ? batch.code : '', date: today(),
              lignes: [], confiance: confiance, texte: (code.texte + '\n' + parfum.texte).trim() };

        confirmerLecture(type, r, apercu, resolve);
      } catch (err) {
        if (canvas) libererCanvas(canvas);
        saisieManuelle(type, err && err.message ? err.message : 'Lecture impossible', resolve);
      }
    };

    cam.click();
  });
}

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
    '<button class="btn menthe" id="oc-ok">Valider</button></div>');

  document.getElementById('oc-x').onclick  = () => { closeSheet(); resolve(null); };
  document.getElementById('oc-ok').onclick = () => {
    const lot = document.getElementById('oc-lot').value.trim().toUpperCase();
    if (!lot) return toast('Le numéro de lot est obligatoire', 'erreur');
    const pf = document.getElementById('oc-parfum');
    const dt = document.getElementById('oc-date');
    closeSheet();
    resolve(Object.assign({}, r, {
      lot: lot, numero: lot,
      parfum: pf ? pf.value : r.parfum,
      ouv: dt ? dt.value : r.ouv,
      valide: true, par: STATE.user ? STATE.user.prenom : null
    }));
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
    '<button class="btn menthe" id="sm-ok">Enregistrer</button></div>');

  document.getElementById('sm-x').onclick  = () => { closeSheet(); resolve(null); };
  document.getElementById('sm-ok').onclick = () => {
    const lot = document.getElementById('sm-lot').value.trim().toUpperCase();
    if (!lot) return toast('Saisissez le numéro de lot', 'erreur');
    const pf = document.getElementById('sm-parfum');
    closeSheet();
    resolve({ lot: lot, numero: lot, ouv: today(), date: today(),
              parfum: pf ? pf.value : '', fournisseur: FOURNISSEUR.nom, lignes: [],
              confiance: 1, saisieManuelle: true, texte: '' });
  };
}
