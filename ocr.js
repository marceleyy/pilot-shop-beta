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

   Dépend de : Tesseract.js (embarqué dans vendor/), et de PARFUMS / toast / showSheet / esc de
   l'application. Se charge APRÈS app.js : la fonction y remplace la simulation.
   ============================================================================= */

'use strict';

const OCR = {
  langues:       'fra',        // 'eng+fra' double la mémoire pour peu de gain
  /* Côté long envoyé à Tesseract. Mesuré sur une étiquette Amorino réelle :
     à 1400 px, les chiffres du numéro de lot ne font que 16 à 29 px de haut,
     selon le cadrage. Or la reconnaissance en demande 30 à 40 pour distinguer
     un 9 d'un 8 — en dessous de 20, elle devine. D'où « 13996A » lu « 13896A »,
     et le fait qu'une deuxième tentative finisse par marcher : le cadrage est
     meilleur, donc les caractères passent le seuil.
     À 2200 px on atteint 25 à 46 px. Le coût est d'environ une seconde de plus
     par lecture, largement préférable à un numéro de lot faux sur un registre. */
  cotePx:        2200,
  cotePreviewPx: 900,
  tailleMaxMo:   25,
/* Prétraitement. J'avais d'abord accusé la binarisation de refermer la boucle
   du 9. Vérification faite en reproduisant le seuillage à l'identique, avec
   flou et basse résolution : le creux reste ouvert dans tous les cas. Ce
   n'était pas la cause. Le réglage plus prudent est conservé, il ne nuit pas. */
  sauvola:       { k: 0.42, R: 128, divFenetre: 12 },
  inactiviteMs:  90000,        // arrêt du worker après ce délai sans usage
  batch:         /(\d{5})\s*([A-Z])/g,
  /* Viseur intégré : cadre de visée et recadrage sur la zone utile. */
  viseur:        true,         // false = retour à l'appareil photo natif
  /* Deux cadres, parce que ce sont deux objets différents. Une étiquette de bac
     est large et basse ; un bon de livraison est une feuille A4 en portrait.
     Avec un seul cadre en paysage, le bon débordait en haut et en bas et seule
     sa moitié centrale était photographiée — la moitié des lignes manquait. */
  cadre:         { largeur: 0.86, ratio: 1.55 },  // part de l'écran, largeur/hauteur
  cadreBL:       { largeur: 0.92, ratio: 0.707 }, // A4 portrait : 210/297
  margeCadre:    0.05,         // tolérance ajoutée autour du cadre au recadrage
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
  if (typeof Tesseract === 'undefined') throw new Error('Moteur de lecture absent');

  /* Chemins locaux : sans eux, le moteur va chercher son ouvrier, son cœur
     WebAssembly et le modèle français sur un CDN — et le scan ne marche pas
     hors ligne, alors que la réserve d'une boutique est justement l'endroit où
     le réseau manque. Les quatre fichiers sont dans vendor/ et précachés. */
  const chemins = {
    workerPath: 'vendor/tesseract-worker.min.js',
    corePath:   'vendor/tesseract-core-simd.wasm.js',
    langPath:   'vendor/'
  };

  let w;
  try {
    w = await Tesseract.createWorker(OCR.langues, 1, chemins);   // API v5
  } catch (e) {
    /* Repli 1 : v5 sans chemins imposés, si un fichier local manque. */
    try {
      w = await Tesseract.createWorker(OCR.langues, 1);
    } catch (e2) {
      w = await Tesseract.createWorker(chemins);                 // API v4
    }
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

/* Lecture double : on soumet à Tesseract l'image binarisée ET l'image en
   niveaux de gris, puis on garde la plus sûre des deux.

   Le noir et blanc aide quand l'éclairage est inégal — c'est pour ça qu'on l'a
   mis. Mais il abîme les caractères fins : un 9 épaissi devient un 8. Sur une
   étiquette bien éclairée, le gris donne un meilleur résultat. Plutôt que de
   choisir à l'avance, on essaie les deux : l'OCR rend un indice de confiance,
   autant s'en servir. Le coût est d'environ une seconde de plus par scan. */
async function lireMeilleur(canvasNB, canvasGris, profil) {
  const a = await lire(canvasNB, profil);
  /* Si le noir et blanc est déjà très sûr, inutile de payer la seconde passe. */
  if (a.confiance >= 0.75 || !canvasGris) return a;
  let b;
  try { b = await lire(canvasGris, profil); } catch (e) { return a; }
  return (b.confiance > a.confiance) ? b : a;
}

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
  /* Entrée non textuelle : l'appelant peut passer null si une passe OCR a
     échoué. Sans cette garde, la lecture plantait au lieu de rendre « rien ». */
  if (texte === null || texte === undefined) return null;
  const T = String(texte).toUpperCase();

  /* 1. On s'ancre sur le mot BATCH. L'étiquette Amorino écrit
        « Batch N° : 14001A », et c'est la seule occurrence fiable.
        Sans cet ancrage, le premier motif « cinq chiffres + lettre » du texte
        gagnait la course — et c'était souvent la DLUO ou le volume :
        « 2026 Litres » donnait 52026L, « 28 06 2026 » donnait 46700S. */
  const ancre = T.match(/BAT[CGO]H[^0-9A-Z]{0,12}(?:N[^0-9A-Z]{0,4})?([\s\S]{0,24})/);

  const chercher = src => {
    /* On travaille LIGNE PAR LIGNE. En aplatissant tout le texte, un nombre
       de fin de ligne se recollait à la lettre isolée de la ligne suivante :
       « M3345M45700 » puis « A » donnaient un lot « 45700A » qui n'existe pas,
       et il gagnait contre le vrai « 14001A » situé plus bas. */
    const lignes = String(src).split(/[\r\n]+/);
    const candidats = [];
    for (const ligne of lignes) {
      const brut = ligne.replace(/[^0-9A-Z]/g, ' ');
      /* Le lot est un jeton AUTONOME : cinq chiffres et une lettre, rien
         d'autre collé autour. « M3345M45700 » est donc écarté. */
      for (const jeton of brut.split(/\s+/)) {
        const m = jeton.match(/^(\d{5})([A-Z])$/);
        if (!m) continue;
        if (/^20[2-4]\d/.test(m[1])) continue;
        candidats.push({ code: m[1] + m[2], autonome: true });
      }
    }
    if (candidats.length) return { code: candidats[0].code, corrige: false };

    /* Repli : motif non autonome, mais toujours à l'intérieur d'une seule ligne. */
    for (const ligne of lignes) {
      const brut = ligne.replace(/[^0-9A-Z]/g, ' ');
      const re = /(\d{5})\s*([A-Z])/g;
      let m;
      while ((m = re.exec(brut)) !== null) {
        if (/^20[2-4]\d/.test(m[1])) continue;
        return { code: m[1] + m[2], corrige: true };
      }
    }
    return null;
  };

  if (ancre) { const r = chercher(ancre[1]); if (r) return r; }

  /* 2. Repli sur tout le texte, dates et unités retirées au préalable. */
  const sansDates = T
    .replace(/\d{2}[\/.\-]\d{2}[\/.\-]\d{2,4}/g, ' ')
    .replace(/\b20[2-4]\d\b/g, ' ')
    .replace(/\bLITRES?\b|\bVOLUME\b|\bKG\b|\bNET\b|\bWT\b/g, ' ');
  const r2 = chercher(sansDates);
  if (r2) return r2;

  /* 3. Dernier recours : correction des confusions de caractères. */
  const jetons = sansDates.replace(/[^0-9A-Z]/g, ' ').split(/\s+/)
    .filter(t => t.length >= 5 && t.length <= 8);
  for (const t of jetons) {
    const c = t.split('');
    let chiffres = '', reste = '';
    for (let i = 0; i < c.length && chiffres.length < 5; i++) {
      const ch = VERS_CHIFFRE[c[i]] !== undefined ? VERS_CHIFFRE[c[i]] : c[i];
      if (/[0-9]/.test(ch)) chiffres += ch;
      else if (chiffres.length) { reste = c.slice(i).join(''); break; }
    }
    if (chiffres.length !== 5) continue;
    if (/^20[2-4]\d/.test(chiffres)) continue;
    /* Sans lettre à la suite, on ne fabrique PAS de lot : la version précédente
       reprenait le dernier caractère du jeton, si bien que « 12345 » donnait
       « 12345S » — un numéro inventé, invérifiable lors d'un contrôle. Mieux
       vaut ne rien proposer et laisser la personne saisir. */
    if (!reste) continue;
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
  if (texte === null || texte === undefined) return null;
  const nettoye = sansAccents(texte)
    .replace(/[0-9]/g, c => CHIFFRE_EN_LETTRE[c] !== undefined ? CHIFFRE_EN_LETTRE[c] : ' ')
    .replace(/[^a-z\s-]/g, ' ');
  const phrase = ' ' + nettoye.replace(/\s+/g, ' ').trim() + ' ';
  /* Borné : un texte OCR très bruité pouvait atteindre des milliers de mots,
     et la comparaison est en O(mots × cibles). Mesuré à 615 ms sur 18 Ko,
     soit une demi-seconde de gel après chaque scan. Une étiquette tient en
     quelques dizaines de mots : au-delà, c'est du bruit. */
  const mots = nettoye.split(/\s+/).filter(m => m.length >= 3).slice(0, 120);
  if (!mots.length) return null;

  /* Cibles : le nom français plus tous ses alias anglais et italiens.
     Les étiquettes Amorino n'écrivent jamais le français. */
  const cibles = [];
  PARFUMS.forEach(p => {
    const vus = {};
    const ajouter = (s, poids) => {
      const c = sansAccents(s);
      if (c && !vus[c]) { vus[c] = 1; cibles.push({ p:p, c:c, poids:poids }); }
    };
    ajouter(p, 1);
    /* Le premier mot seul ne vaut qu'à défaut de mieux : « chocolat » est
       commun à trois parfums, et il gagnait contre « équateur » qui, lui,
       désigne un seul produit. « Chocolat équateur » devenait « Chocolat noir ». */
    const tete = p.split(' ')[0];
    if (tete !== p) ajouter(tete, 0.7);
    ((typeof PARFUMS_ALIAS !== 'undefined' && PARFUMS_ALIAS[p]) || []).forEach(a => ajouter(a, 1));
  });

  let meilleur = null;
  const retenir = (p, score, lu) => {
    if (score > 0.62 && (!meilleur || score > meilleur.score)) meilleur = { parfum:p, score:score, lu:lu };
  };
  /* Prime de spécificité : à correspondance égale, la cible la plus longue
     l'emporte. Sans elle, « chocolate » battait « organic chocolate » et
     « coconut » battait « pistachio » — c'est l'ordre du catalogue qui
     tranchait, ce qui n'est pas un critère. */
  const prime = c => Math.min(c.length, 20) / 1000;

  for (const t of cibles) {
    /* Expression composée (« passion fruit ») : on la cherche telle quelle */
    if (t.c.indexOf(' ') >= 0) {
      if (phrase.indexOf(' ' + t.c + ' ') >= 0) retenir(t.p, 1 * t.poids + prime(t.c), t.c);
      continue;
    }
    for (const mot of mots) {
      const d = distance(mot, t.c);
      const ref = Math.max(mot.length, t.c.length);
      retenir(t.p, (1 - d / Math.max(ref, 1)) * t.poids + (d === 0 ? prime(t.c) : 0), mot);
    }
  }
  return meilleur;
}

/* =============================================================================
   EXTRACTION DES AUTRES CHAMPS DE L'ÉTIQUETTE
   L'étiquette Amorino porte bien plus que le lot : volume, poids net, date de
   production et DLUO. Les lire évite de ressaisir la taille du bac à la main.

   Attention : le « Best before » est la limite du produit FERMÉ, à deux ans.
   La règle des 10 jours court à partir de l'ouverture, elle est calculée
   séparément par DLC_RULES. Ne jamais confondre les deux.
   ========================================================================== */
function extraireChamps(texte) {
  const t = texte.replace(/\s+/g, ' ');
  const out = {};

  /* Volume : « 3 Litres », « 5 L ». On ne retient que les tailles au catalogue. */
  const vol = t.match(/(\d{1,2})[.,]?\d*\s*(?:litres?|lt?r?s?\b)/i);
  if (vol) {
    const v = parseInt(vol[1], 10);
    if (TAILLES_BAC.indexOf(v) >= 0) out.volume = v;
  }

  /* Poids net : « 2,525 » près de « kg ». Bornes larges mais plausibles. */
  const poids = t.match(/(?:kg\s*net\s*wt\s*:?|net\s*wt\s*:?|poids\s*net\s*:?)\s*(\d{1,2}[.,]\d{1,3})/i)
             || t.match(/(\d{1,2}[.,]\d{3})\s*(?:kg)?/);
  if (poids) {
    const p = parseFloat(poids[1].replace(',', '.'));
    if (p > 0.5 && p < 20) out.poidsNet = p;
  }

  /* Dates au format jj/mm/aaaa. La plus ancienne est la production,
     la plus lointaine la DLUO du produit fermé. */
  const dates = [];
  const re = /(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const j = +m[1], mo = +m[2], a = +m[3];
    if (j >= 1 && j <= 31 && mo >= 1 && mo <= 12 && a >= 2020 && a <= 2040) {
      dates.push(a + '-' + m[2] + '-' + m[1]);
    }
  }
  if (dates.length) {
    dates.sort();
    out.production = dates[0];
    if (dates.length > 1) out.dluo = dates[dates.length - 1];
  }

  /* Cohérence : si volume et poids sont lus, on vérifie le kg/L. */
  if (out.volume && out.poidsNet) {
    const kgL = out.poidsNet / out.volume;
    out.kgParLitre = Math.round(kgL * 10000) / 10000;
    out.coherent = kgL > 0.6 && kgL < 1.1;
  }
  return out;
}

/* =============================================================================
   6. VISEUR INTÉGRÉ
   capture="environment" ouvre l'appareil photo natif d'iOS : aucun HTML ne peut
   s'y superposer. Pour obtenir un vrai cadre de visée, la caméra est donc
   affichée dans la page. Avantage décisif : le recadrage porte exactement sur
   ce que la personne voyait, au lieu de deviner une zone après coup.
   ========================================================================== */
let fluxCamera = null;

function geometrieCadre(type) {
  /* Le bon de livraison a son propre cadre, en portrait. */
  const cfg = (type === 'bl' && OCR.cadreBL) ? OCR.cadreBL : OCR.cadre;
  const L = window.innerWidth, H = window.innerHeight;
  let w = Math.round(L * cfg.largeur);
  let h = Math.round(w / cfg.ratio);

  /* En paysage sur téléphone, la largeur commande une hauteur supérieure à
     l'écran : sur un iPhone 13 tenu à l'horizontale, le cadre débordait de
     55 pixels vers le haut et son bord était invisible. On le borne à la
     hauteur disponible, marges comprises, en conservant le rapport.
     Pour un A4 en portrait c'est la hauteur qui commande presque toujours. */
  const hMax = Math.round(H * (type === 'bl' ? 0.74 : 0.70));
  if (h > hMax) { h = hMax; w = Math.round(h * cfg.ratio); }
  if (w > L - 24) { w = L - 24; h = Math.round(w / cfg.ratio); }

  const x = Math.round((L - w) / 2);
  /* Décalage vers le haut pour laisser la place aux boutons, mais jamais
     au point de sortir de l'écran. */
  const y = Math.max(12, Math.round((H - h) / 2 - H * 0.04));
  return { x: x, y: y, w: w, h: h };
}
function placerCadre(type) {
  const g = geometrieCadre(type), c = document.getElementById('vs-cadre');
  if (!c) return g;
  c.style.left = g.x + 'px'; c.style.top = g.y + 'px';
  c.style.width = g.w + 'px'; c.style.height = g.h + 'px';
  return g;
}
function fermerViseur() {
  const v = document.getElementById('viseur');
  if (v) v.classList.remove('on');
  if (fluxCamera) { fluxCamera.getTracks().forEach(t => t.stop()); fluxCamera = null; }
  const vid = document.getElementById('vs-video');
  if (vid) vid.srcObject = null;
}

/* Résout avec un canvas recadré, la chaîne 'fichier' si la personne préfère la
   galerie, ou null si elle annule. Rejette si la caméra est indisponible. */
function ouvrirViseur(aide, type) {
  return new Promise(async (resolve, reject) => {
    const v = document.getElementById('viseur');
    if (!OCR.viseur || !v || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return reject(new Error('viseur indisponible'));
    }
    const video = document.getElementById('vs-video');
    try {
      fluxCamera = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' },
                 width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
    } catch (e) { return reject(e); }

    video.srcObject = fluxCamera;
    try { await video.play(); } catch (e) {}
    const t = document.getElementById('vs-titre');
    if (t && aide) t.textContent = aide;
    v.classList.add('on');
    placerCadre(type);
    const surRedim = () => placerCadre(type);
    window.addEventListener('resize', surRedim);
    window.addEventListener('orientationchange', surRedim);

    const finir = valeur => {
      window.removeEventListener('resize', surRedim);
      window.removeEventListener('orientationchange', surRedim);
      fermerViseur();
      resolve(valeur);
    };

    document.getElementById('vs-annuler').onclick = () => finir(null);
    document.getElementById('vs-fichier').onclick = () => finir('fichier');

    document.getElementById('vs-prendre').onclick = () => {
      const fl = document.getElementById('vs-flash');
      fl.classList.add('on'); setTimeout(() => fl.classList.remove('on'), 60);
      vibrer(UI.vibration.ok);

      const g = geometrieCadre(type);
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return finir(null);

      /* object-fit: cover rogne la vidéo pour remplir l'écran. On refait ce
         calcul à l'envers pour retrouver le rectangle réel à découper. */
      const L = window.innerWidth, H = window.innerHeight;
      const ech = Math.max(L / vw, H / vh);
      const decX = (vw * ech - L) / 2, decY = (vh * ech - H) / 2;

      const m = OCR.margeCadre;
      let sx = (g.x - g.w * m + decX) / ech;
      let sy = (g.y - g.h * m + decY) / ech;
      let sw = (g.w * (1 + 2 * m)) / ech;
      let sh = (g.h * (1 + 2 * m)) / ech;

      /* Bornage : sans lui, un cadre débordant donne un canvas vide. */
      sx = Math.max(0, Math.min(sx, vw - 1));
      sy = Math.max(0, Math.min(sy, vh - 1));
      sw = Math.max(1, Math.min(sw, vw - sx));
      sh = Math.max(1, Math.min(sh, vh - sy));

      /* Mise à l'échelle vers la taille attendue par Tesseract */
      const r = Math.min(1, OCR.cotePx / Math.max(sw, sh));
      const cv = document.createElement('canvas');
      cv.width = Math.round(sw * r); cv.height = Math.round(sh * r);
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cv.width, cv.height);

      finir({ canvas: cv, nom: 'Cadre de visée' });
    };
  });
}

/* Repli : rappel de cadrage avant d'ouvrir l'appareil photo natif, puisqu'on
   ne pourra rien afficher par-dessus. */
function rappelCadrage(type) {
  return new Promise(resolve => {
    showSheet(
      '<h2 id="sheet-titre">Avant de photographier</h2>' +
      '<p class="sub">La caméra intégrée n’est pas disponible sur cet appareil.</p>' +
      '<div class="guide-apercu"><span></span><b>Étiquette ici</b></div>' +
      '<div class="alerte info" style="margin-top:14px"><span class="ai">💡</span><div>' +
      '<b>Trois règles</b><p>Remplissez l’écran avec l’étiquette seule. Tenez l’appareil ' +
      'bien à plat au-dessus. Placez-vous de biais par rapport à la lumière pour ' +
      'éviter le reflet de l’inox.</p></div></div>' +
      '<div class="actions"><button class="btn clair" id="rc-x">Annuler</button>' +
      '<button class="btn ciel" id="rc-ok">Ouvrir l’appareil photo</button></div>');
    document.getElementById('rc-x').onclick = () => { closeSheet(); resolve(false); };
    document.getElementById('rc-ok').onclick = () => { closeSheet(); resolve(true); };
  });
}

/* =============================================================================
   7. FONCTION PRINCIPALE
   Contrat de retour inchangé :
     'etiquette' → { lot, ouv, parfum, confiance, texte }
     'bl'        → { fournisseur, numero, date, lignes, confiance, texte }
   ========================================================================== */
async function analyserCanvas(type, canvas, nom, resolve) {
  let apercu = '';
  const etape = (t, s) => showSheet(
    '<h2 id="sheet-titre">' + t + '</h2><p class="sub">' + esc(nom) + '</p>' +
    '<div class="vide"><span class="vi">🔍</span>' + s + '</div>');
  try {
    etape('Lecture de l’étiquette', 'Nettoyage des reflets…');
    await new Promise(r => setTimeout(r, 30));
    /* On garde une copie en niveaux de gris AVANT de binariser : elle servira
       de seconde lecture si le noir et blanc rend un résultat incertain. */
    const gris = copierCanvas(canvas);
    pretraiter(canvas);
    try { apercu = canvas.toDataURL('image/jpeg', 0.6); } catch (e) {}

    etape('Lecture de l’étiquette', 'Reconnaissance du texte…');
    const code   = await lireMeilleur(canvas, gris, 'code');
    const parfum = await lireMeilleur(canvas, gris, 'parfum');
    libererCanvas(gris);

    const batch = extraireBatch(code.texte + '\n' + parfum.texte);
    const trouve = extraireParfum(parfum.texte + '\n' + code.texte);
    const champs = extraireChamps(code.texte + '\n' + parfum.texte);
    const confiance = (code.confiance + parfum.confiance) / 2;
    libererCanvas(canvas);

    const r = type === 'etiquette'
      ? { lot: batch ? batch.code : '', ouv: today(), parfum: trouve ? trouve.parfum : '',
          volume: champs.volume || null, poidsNet: champs.poidsNet || null,
          production: champs.production || null, dluo: champs.dluo || null,
          confiance: confiance, corrige: !!(batch && batch.corrige),
          texte: (code.texte + '\n' + parfum.texte).trim() }
      : { fournisseur: FOURNISSEUR.nom, numero: batch ? batch.code : '', date: today(),
          /* La lecture des lignes d'un bon de livraison n'est pas implémentée :
             l'OCR ne sait extraire qu'un code lot, pas un tableau de références. */
          lignes: [], lignesNonLues: true,
          confiance: confiance, texte: (code.texte + '\n' + parfum.texte).trim() };

    confirmerLecture(type, r, apercu, resolve);
  } catch (err) {
    libererCanvas(canvas);
    saisieManuelle(type, err && err.message ? err.message : 'Lecture impossible', resolve);
  }
}

function scannerPhoto(type) {
  return new Promise(async resolve => {
    const aide = type === 'bl'
      ? 'Alignez le bon de livraison dans le cadre'
      : 'Alignez l’étiquette du lot dans le cadre';

    /* 1. Viseur intégré, avec recadrage exact sur la zone visée */
    try {
      const vu = await ouvrirViseur(aide, type);
      if (vu === null) return resolve(null);
      if (vu && vu.canvas) return analyserCanvas(type, vu.canvas, vu.nom, resolve);
      /* vu === 'fichier' : la personne préfère la galerie, on enchaîne */
    } catch (e) {
      /* Caméra refusée ou indisponible : on prévient avant d'ouvrir le natif */
      const suite = await rappelCadrage(type);
      if (!suite) return resolve(null);
    }

    /* 2. Repli : appareil photo natif ou galerie */
    const cam = document.getElementById('cam');
    cam.value = '';
    cam.onchange = async () => {
      const file = cam.files && cam.files[0];
      if (!file) return resolve(null);
      showSheet('<h2 id="sheet-titre">Lecture de l’étiquette</h2>' +
        '<p class="sub">' + esc(file.name) + '</p>' +
        '<div class="vide"><span class="vi">🔍</span>Mise à l’endroit de la photo…</div>');
      try {
        const chargee = await chargerImage(file, OCR.cotePx);
        analyserCanvas(type, chargee.canvas, file.name, resolve);
      } catch (err) {
        saisieManuelle(type, err && err.message ? err.message : 'Image illisible', resolve);
      }
    };
    cam.click();
  });
}

/* Ancienne version, conservée le temps de la bêta puis à supprimer. */
function scannerPhotoNatif(type) {
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
        const gris2 = copierCanvas(canvas);
        pretraiter(canvas);
        try { apercu = canvas.toDataURL('image/jpeg', 0.6); } catch (e) {}

        etape('Lecture de l’étiquette', 'Reconnaissance du texte…');
        const code   = await lireMeilleur(canvas, gris2, 'code');
        const parfum = await lireMeilleur(canvas, gris2, 'parfum');
        libererCanvas(gris2);

        const batch = extraireBatch(code.texte + '\n' + parfum.texte);
        const trouve = extraireParfum(parfum.texte);
        const confiance = (code.confiance + parfum.confiance) / 2;

        libererCanvas(canvas); canvas = null;

        const r = type === 'etiquette'
          ? { lot: batch ? batch.code : '', ouv: today(), parfum: trouve ? trouve.parfum : '',
              confiance: confiance, corrige: !!(batch && batch.corrige),
              texte: (code.texte + '\n' + parfum.texte).trim() }
          : { fournisseur: FOURNISSEUR.nom, numero: batch ? batch.code : '', date: today(),
              /* La lecture des lignes d'un bon de livraison n'est pas implémentée :
                 l'OCR ne sait extraire qu'un code lot, pas un tableau de références.
                 On le déclare, au lieu de renvoyer un tableau vide qui s'ajouterait
                 aux achats comme zéro litre, en silence. */
              lignes: [], lignesNonLues: true,
              confiance: confiance, texte: (code.texte + '\n' + parfum.texte).trim() };

        confirmerLecture(type, r, apercu, resolve);
      } catch (err) {
        if (canvas) libererCanvas(canvas);
        saisieManuelle(type, err && err.message ? err.message : 'Lecture impossible', resolve);
      }
    };

    cam.click();
  });
}

/* Copie d'un canvas avant binarisation : Tesseract lira les deux versions. */
function copierCanvas(src) {
  const cv = document.createElement('canvas');
  cv.width = src.width; cv.height = src.height;
  cv.getContext('2d').drawImage(src, 0, 0);
  return cv;
}

function libererCanvas(cv) {
  try { cv.width = 0; cv.height = 0; } catch (e) {}
}

/* =============================================================================
   7. CONFIRMATION — rien n'entre dans un registre sans relecture humaine
   ========================================================================== */
/* -----------------------------------------------------------------------------
   LECTURE D'UN BON DE LIVRAISON
   Un bon n'est pas une étiquette : c'est un tableau de vingt lignes, chacune
   avec sa référence, sa désignation, son lot et sa quantité. Jusqu'ici on lui
   appliquait l'extraction d'étiquette, qui cherche UN lot — d'où l'échec
   systématique constaté en boutique.

   Relévé sur un bon Jetfreeze réel du 16/09 :
     $AMARENA25  Glace Cerise Griotte 3 litres      14002A   12,00
     CREPE       Crêpes de Froment 31cm (14x6p)     210261    4,00
     MACCIOC     Macaron à la glace Cioccolato      L5260A    2,00

   Trois formats de lot coexistent : 14002A pour les glaces, L5260A pour les
   macarons, 210261 pour les crêpes. La taille du bac est dans la désignation,
   la quantité dans sa colonne : on n'a donc PAS besoin de deviner combien de
   bacs contient un carton, le bon le dit.
   -------------------------------------------------------------------------- */
function extraireLignesBL(texte) {
  if (!texte) return { lignes: [], bl: null, total: null };
  const brut = String(texte);

  /* Numéro du bon et total en litres, pour recouper la saisie. */
  const mBL = brut.match(/\bBL\s*(\d{5,8})\b/i);
  const mTot = brut.match(/Total\s+Litres[^\d]*(\d+[.,]?\d*)/i);

  const lignes = [];
  brut.split(/[\r\n]+/).forEach(l => {
    const t = l.replace(/\s+/g, ' ').trim();
    if (t.length < 12) return;

    /* La quantité est le dernier nombre décimal de la ligne. */
    const mQ = t.match(/(\d+[.,]\d{2})\s*$/);
    if (!mQ) return;
    const qte = parseFloat(mQ[1].replace(',', '.'));
    if (!isFinite(qte) || qte <= 0) return;

    /* Le lot précède la quantité. Trois formats acceptés. */
    const avant = t.slice(0, t.length - mQ[0].length).trim();
    const mLot = avant.match(/([A-Z]?\d{4,6}[A-Z]?)\s*$/);
    const lot = mLot ? mLot[1] : '';

    const design = (mLot ? avant.slice(0, avant.length - mLot[0].length) : avant).trim();
    if (design.length < 4) return;

    /* Lignes qui ne sont pas des produits : frais de port, total, sous-total.
       Sans ce filtre, le « Total Litres = 348,00 » devenait une ligne de 348
       unités, et les frais de port un article à réceptionner. */
    if (/^total|total\s+litres|frais\s+de\s+port|emballage|palette\s*n|^page\b/i.test(design)) return;

    /* Contenance : « 3 litres » pour un bac, « (14x6p) » pour un carton. */
    const mL = design.match(/(\d+)\s*litres?/i);
    const mC = design.match(/\((\d+)\s*[x×]\s*(\d+)\s*p\)/i);
    const mU = design.match(/\((\d+)\s*p\)/i);

    lignes.push({
      designation: design.replace(/^[\$A-Z0-9]+\s+/, '').trim() || design,
      reference: (design.match(/^([\$A-Z0-9]+)\s/) || [])[1] || '',
      lot: lot,
      qte: qte,
      taille: mL ? +mL[1] : null,
      /* Unités par colis, quand le conditionnement est indiqué. */
      parColis: mC ? (+mC[1] * +mC[2]) : (mU ? +mU[1] : null)
    });
  });

  return {
    lignes: lignes,
    bl: mBL ? 'BL' + mBL[1] : null,
    total: mTot ? parseFloat(mTot[1].replace(',', '.')) : null
  };
}

/* -----------------------------------------------------------------------------
   VRAISEMBLANCE D'UN NUMÉRO DE LOT
   Tous les lots Amorino observés commencent par 135, 136, 139, 140 ou 141 :
   13539A, 13906A, 13996A, 14002A, 14109A… Un « 84111F » lu à 21 % de confiance
   n'en est pas un, et l'afficher dans le champ invite à le valider — ce qui
   inscrit un numéro inventé dans un registre sanitaire.

   On ne REFUSE pas le lot : deux fournisseurs, deux formats, et la règle peut
   changer. On refuse seulement de le PROPOSER quand tout concorde pour dire
   qu'il est faux : confiance basse ET préfixe inconnu.
   -------------------------------------------------------------------------- */
function lotVraisemblable(lot) {
  if (!lot) return false;
  const L = String(lot).toUpperCase();
  /* Format Amorino : cinq chiffres + une lettre, série 135xx à 141xx. */
  if (/^1[34]\d{3}[A-Z]$/.test(L)) return true;
  /* Format macarons : L + cinq chiffres + lettre. */
  if (/^L\d{4}[A-Z]$/.test(L)) return true;
  /* Format crêpes et gaufres : six chiffres sans lettre. */
  if (/^\d{6}$/.test(L)) return true;
  /* Crème fondente IRCA : huit chiffres. */
  if (/^\d{8}$/.test(L)) return true;
  return false;
}

/* -----------------------------------------------------------------------------
   ÉTIQUETTE DE CARTON
   Différente de celle d'un bac : elle porte le conditionnement et la date
   d'expiration du produit fermé.

   Relévé sur un carton Amorino réel :
     Production Date 29/06/2026 · BBD 27/06/2028 · LOT N° 13996A
     NET WEIGHT 10,1 KG · 4 x 3 Litre · $CARAMB25 · SALTED BUTTER CARAMEL

   Le « 4 x 3 Litre » dit quatre bacs de trois litres : on n'a plus à deviner
   combien de bacs contient un carton, ni à scanner les quatre un par un.
   Et le BBD est l'horloge du produit FERMÉ, celle qui court depuis la
   livraison — distincte de la DLC après ouverture que l'application suit déjà.
   C'est elle qui manquait quand un carton de macarons vanille a périmé sans
   que rien ne prévienne.
   -------------------------------------------------------------------------- */
function extraireCarton(texte) {
  if (!texte) return null;
  const T = String(texte).toUpperCase();

  /* Conditionnement : « 4 x 3 Litre », « 4x3 L », « 2 × 5 litres ». */
  const mC = T.match(/(\d{1,2})\s*[X×]\s*(\d{1,2})\s*L(?:ITRES?)?\b/);
  const mW = T.match(/(\d{1,3}[.,]\d)\s*KG/);
  const mR = T.match(/\$([A-Z0-9]{3,14})/);

  const iso = d => { const p = d.split(/[\/.\-]/); return p[2] + '-' + p[1] + '-' + p[0]; };

  /* Les dates. L'ancrage sur le libellé ne suffit pas : l'étiquette Amorino est
     en COLONNES — les libellés « Production Date / BBD / LOT N° » sur une ligne,
     les valeurs « 29/06/2026  27/06/2028  13996A » sur la suivante. Chercher
     « BBD » suivi d'une date rendait donc toujours rien.

     La règle qui tient : parmi les dates de l'étiquette, la PLUS LOINTAINE est
     l'expiration et la plus proche la production. Un produit ne périme jamais
     avant d'être fabriqué. */
  const brutes = (T.match(/\b(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})\b/g) || [])
    .map(iso)
    .filter(d => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d))
    .sort();

  /* L'ancrage reste prioritaire quand il fonctionne : sur une étiquette où le
     libellé précède bien sa date, il lève toute ambiguïté. */
  const mB = T.match(/(?:BBD|BEST\s*BEFORE|CONSOMMER\s+DE\s+PRÉFÉRENCE[^\d]{0,40}|CONSUMARSI[^\d]{0,40})[^\d]{0,20}(\d{2}[\/.\-]\d{2}[\/.\-]\d{4})/);
  const mP = T.match(/(?:PRODUCTION\s*DATE|DATA\s*PRODUZIONE|DATE\s+DE\s+PRODUCTION)[^\d]{0,20}(\d{2}[\/.\-]\d{2}[\/.\-]\d{4})/);

  const expiration = mB ? iso(mB[1])
    : (brutes.length >= 2 ? brutes[brutes.length - 1]
    : (brutes.length === 1 ? brutes[0] : null));
  const production = mP ? iso(mP[1])
    : (brutes.length >= 2 ? brutes[0] : null);

  return {
    parBac:    mC ? +mC[1] : null,     // nombre de bacs dans le carton
    taille:    mC ? +mC[2] : null,     // contenance d'un bac, en litres
    expiration: expiration,
    production: production,
    poidsKg:   mW ? parseFloat(mW[1].replace(',', '.')) : null,
    reference: mR ? '$' + mR[1] : null,
    /* Contrôle : le poids doit correspondre au volume annoncé, à 5 % près.
       10,1 kg pour 4×3 L fait 0,842 kg/L, la densité mesurée du gelato. */
    coherent: (mC && mW)
      ? Math.abs(parseFloat(mW[1].replace(',', '.')) /
                 (+mC[1] * +mC[2]) - FOURNISSEUR.poidsMoyenLitre) < 0.05
      : null
  };
}

function confirmerLecture(type, r, apercu, resolve) {
  /* Un lot improbable lu avec peu de confiance est écarté plutôt que proposé :
     mieux vaut demander de taper que d'inscrire un numéro faux. */
  if (r.lot && r.confiance < 0.40 && !lotVraisemblable(r.lot)) {
    r.lotRejete = r.lot;
    r.lot = '';
  }
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
