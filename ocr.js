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
    try {
      await new Promise((ok, ko) => { img.onload = ok; img.onerror = () => ko(new Error('Image illisible')); img.src = url; });
    } finally { URL.revokeObjectURL(url); }
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
    langPath:   'vendor/',
    /* Pas de copie dans IndexedDB : le modèle est déjà précaché par le
       service worker. Le dupliquer coûtait plusieurs Mo et une écriture lente
       au premier scan. Option reconnue par la version embarquée (v5). */
    cacheMethod: 'none'
  };

  let w, v4 = false;
  try {
    w = await Tesseract.createWorker(OCR.langues, 1, chemins);   // API v5
  } catch (e) {
    /* Repli 1 : v5 sans chemins imposés, si un fichier local manque. */
    try {
      w = await Tesseract.createWorker(OCR.langues, 1);
    } catch (e2) {
      w = await Tesseract.createWorker(chemins);                 // API v4
      v4 = true;
    }
  }
  /* Chargement manuel pour la v4 SEULEMENT. La v5 embarquée garde ces
     fonctions pour compatibilité mais les déclare dépréciées : chaque premier
     scan affichait trois avertissements « is depreciated » en console. */
  if (v4 && typeof w.loadLanguage === 'function') {          // v4 : chargement manuel
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
  /* Le minuteur d'inactivité pourrait arrêter le worker en pleine lecture. */
  clearTimeout(OCR._minuteur);
  const w = await obtenirWorker();
  /* Profil « bl » : une page entière, tableau compris. Aucune liste de
     caractères (la liste vide efface celle de la passe précédente, le worker
     étant partagé) ; psm 6 lit chaque rangée du tableau comme une ligne, psm 4
     sert de seconde lecture quand la première a perdu le total. */
  const params = (profil === 'bl' || profil === 'bl4')
    ? { tessedit_char_whitelist: '',
        tessedit_pageseg_mode: profil === 'bl4' ? '4' : '6',
        preserve_interword_spaces: '1' }
    : profil === 'code'
    ? { tessedit_char_whitelist: '0123456789' + MAJUSCULES,
        tessedit_pageseg_mode: '11',        // texte épars : l'étiquette n'est pas un paragraphe
        tessedit_ocr_engine_mode: '1',      // LSTM seul
        classify_bln_numeric_mode: '0',
        preserve_interword_spaces: '1' }
    : { tessedit_char_whitelist: LETTRES,
        tessedit_pageseg_mode: '6',         // bloc de texte uniforme
        tessedit_ocr_engine_mode: '1',
        preserve_interword_spaces: '1' };

  const page = profil === 'bl' || profil === 'bl4';
  let r;
  try {
    await w.setParameters(params);
    /* Pour un bon, on garde aussi la position de chaque ligne et de chaque
       mot : elle sert à relire la colonne Quantité case par case. */
    r = page ? await w.recognize(canvas, {}, { text: true, blocks: true }) : await w.recognize(canvas);
  } finally { reporterArret(); }
  const lignes = [];
  if (page) (r.data.blocks || []).forEach(b => (b.paragraphs || []).forEach(p => (p.lines || []).forEach(l =>
    lignes.push({ texte: l.text || '', bbox: l.bbox, mots: (l.words || []).map(m => ({ t: m.text, bbox: m.bbox })) }))));
  return { texte: (r.data.text || '').trim(), confiance: (r.data.confidence || 0) / 100, lignes: lignes };
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

      /* Mots collés par l'OCR. Sur une étiquette réelle, « PISTACHIO MAWARDI »
         a été lu « PISTACHIOHAWARDI » : l'espace a disparu. La distance porte
         alors sur seize lettres contre neuf, le score tombe à 0,56 et passe
         sous le seuil — le parfum n'était pas reconnu du tout.
         On cherche donc aussi la cible À L'INTÉRIEUR du mot, sur une fenêtre
         de sa longueur. */
      if (mot.length > t.c.length + 2 && t.c.length >= 5) {
        let meilleurDedans = 99;
        for (let i = 0; i + t.c.length <= mot.length; i++) {
          const d2 = distance(mot.substr(i, t.c.length), t.c);
          if (d2 < meilleurDedans) meilleurDedans = d2;
          if (!d2) break;
        }
        if (meilleurDedans <= Math.max(1, Math.floor(t.c.length * 0.2))) {
          /* Légèrement moins sûr qu'une correspondance sur le mot entier :
             on retranche une marge pour qu'un mot exact reste prioritaire. */
          retenir(t.p, (1 - meilleurDedans / t.c.length) * t.poids * 0.97, mot);
        }
      }
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
      const flux = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' },
                 width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      /* Double appui : l'ancien flux resterait allumé (voyant, batterie). */
      if (fluxCamera && fluxCamera !== flux) fluxCamera.getTracks().forEach(t => t.stop());
      fluxCamera = flux;
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
     'bl'        → { fournisseur, numero, date, total, lignes, source:'ocr', confiance, texte }
                   (lignes : ref, parfum, lot, lotCorrige, bacs, taille, unite) — voir analyserBL
   ========================================================================== */
async function analyserCanvas(type, canvas, nom, resolve) {
  if (type === 'bl') return analyserBL(canvas, nom, resolve);
  let apercu = '', gris = null;
  const etape = (t, s) => showSheet(
    '<h2 id="sheet-titre">' + t + '</h2><p class="sub">' + esc(nom) + '</p>' +
    '<div class="vide"><span class="vi">🔍</span>' + s + '</div>');
  try {
    etape('Lecture de l’étiquette', 'Nettoyage des reflets…');
    await new Promise(r => setTimeout(r, 30));
    /* On garde une copie en niveaux de gris AVANT de binariser : elle servira
       de seconde lecture si le noir et blanc rend un résultat incertain. */
    gris = copierCanvas(canvas);
    pretraiter(canvas);
    try { apercu = canvas.toDataURL('image/jpeg', 0.6); } catch (e) {}

    etape('Lecture de l’étiquette', 'Reconnaissance du texte…');
    const code   = await lireMeilleur(canvas, gris, 'code');
    const parfum = await lireMeilleur(canvas, gris, 'parfum');
    libererCanvas(gris); gris = null;

    const batch = extraireBatch(code.texte + '\n' + parfum.texte);
    const trouve = extraireParfum(parfum.texte + '\n' + code.texte);
    const champs = extraireChamps(code.texte + '\n' + parfum.texte);
    const confiance = (code.confiance + parfum.confiance) / 2;
    libererCanvas(canvas);

    const r = { lot: batch ? batch.code : '', ouv: today(), parfum: trouve ? trouve.parfum : '',
          volume: champs.volume || null, poidsNet: champs.poidsNet || null,
          production: champs.production || null, dluo: champs.dluo || null,
          confiance: confiance, corrige: !!(batch && batch.corrige),
          texte: (code.texte + '\n' + parfum.texte).trim() };

    confirmerLecture(type, r, apercu, resolve);
  } catch (err) {
    libererCanvas(canvas);
    if (gris) libererCanvas(gris);
    saisieManuelle(type, err && err.message ? err.message : 'Lecture impossible', resolve);
  }
}

/* Bon de livraison : une page A4, pas une étiquette. Jusqu'ici on lui
   appliquait la lecture d'étiquette, qui rendait un « numero » mais ni lot ni
   parfum : confirmerLecture concluait « Aucun code lisible sur la photo » à
   CHAQUE bon, quelle que soit la photo. On lit maintenant la page entière en
   niveaux de gris (la binarisation mange les petits caractères du tableau) et
   on en tire le numéro du bon, la date, le total en litres et les lignes. */
async function analyserBL(canvas, nom, resolve) {
  const etape = s => showSheet(
    '<h2 id="sheet-titre">Lecture du bon</h2><p class="sub">' + esc(nom) + '</p>' +
    '<div class="vide"><span class="vi">🔍</span>' + s + '</div>');
  let nb = null;
  try {
    etape('Reconnaissance du texte…');
    await new Promise(r => setTimeout(r, 30));
    let apercu = '';
    try { apercu = canvas.toDataURL('image/jpeg', 0.6); } catch (e) {}
    /* Mesuré sur le bon BL221970 : en gris, 23 lignes sur 26 et tous les lots
       lisibles ; binarisé, moitié moins. Le noir et blanc ne sert qu'en repli. */
    let lu = await lire(canvas, 'bl');
    let res = extraireBLPositionne(lu);
    if (!res.lignes.length) {
      nb = copierCanvas(canvas); pretraiter(nb);
      const lu2 = await lire(nb, 'bl');
      const res2 = extraireBLPositionne(lu2);
      if (res2.lignes.length > res.lignes.length) { lu = lu2; res = res2; res._nb = true; }
    }
    /* Le total en litres manque souvent en psm 6 (ligne coupée) : une seconde
       lecture en colonnes le retrouve, et comble au passage les lots perdus. */
    if (res.lignes.length && res.total === null) {
      etape('Recherche du total…');
      const lu4 = await lire(canvas, 'bl4');
      completerBL(res, extraireLignesBL(lu4.texte));
    }
    /* Les quantités sont entourées au stylo : dans la page entière, le cercle
       les noie. On relit chaque case de la colonne Quantité à part, et la
       ligne du total si elle manque encore. */
    if (res.lignes.some(l => l._box)) {
      etape('Lecture des quantités…');
      /* Amélioration seulement : une erreur ici ne doit pas jeter les
         lignes, lots et numéro déjà lus. */
      try { await lireQuantitesBL(nb && res._nb ? nb : canvas, res, lu.lignes); } catch (e) {}
    }
    libererCanvas(canvas);
    if (nb) libererCanvas(nb);
    recouperTotal(res);

    const r = { fournisseur: FOURNISSEUR.nom, numero: res.bl || '', date: res.date || today(),
                total: res.total, litresLus: res.litresLus, source: 'ocr',
                /* Contrat des appelants : ref, parfum (libellé), bacs, taille. */
                lignes: res.lignes.map(l => ({
                  ref: l.reference, parfum: l.designation, designation: l.designation,
                  lot: l.lot, lotCorrige: l.lotCorrige, bacs: l.qte, qte: l.qte, qteDouteuse: !!l.qteDouteuse,
                  taille: l.taille, unite: l.unite, parColis: l.parColis })),
                confiance: lu.confiance, texte: lu.texte };
    if (!r.numero && !r.lignes.length) return saisieManuelle('bl', 'Aucun texte de bon lisible sur la photo', resolve);
    confirmerBL(r, apercu, resolve);
  } catch (err) {
    libererCanvas(canvas);
    if (nb) libererCanvas(nb);
    saisieManuelle('bl', err && err.message ? err.message : 'Lecture impossible', resolve);
  }
}

/* Même extraction, mais ligne par ligne de la lecture : chaque ligne du bon
   garde sa position sur la photo (_box), utile pour relire sa quantité. */
function extraireBLPositionne(lu) {
  const res = extraireLignesBL(lu.texte);
  if (!lu.lignes || !lu.lignes.length) return res;
  const lignes = [];
  lu.lignes.forEach(L => {
    const l = extraireLignesBL(L.texte).lignes[0];
    if (!l || (res.bl && l.lot === res.bl.slice(2))) return;
    l._box = L.bbox; l._mots = L.mots;
    lignes.push(l);
  });
  if (lignes.length >= res.lignes.length) res.lignes = lignes;
  return res;
}

/* -----------------------------------------------------------------------------
   QUANTITÉS ENTOURÉES
   L'équipe entoure les quantités au stylo en contrôlant la livraison. Le
   cercle traverse les chiffres : dans la page entière, « 12,00 » devient
   « 722 » ou disparaît. Recadrée sur la seule case, agrandie, la même
   quantité se lit (mesuré sur BL221970 : de 9 à 19 quantités sur 24).

   Où est la case ? Les quantités non entourées se lisent dans la page : leur
   position donne la colonne, et leur décalage vertical par rapport au début
   de la ligne donne l'inclinaison locale de la photo (un bon tenu à la main
   n'est jamais droit). Chaque case est lue trois fois (gris en ligne, gris
   en bloc, noir et blanc) ; la valeur qui revient le plus l'emporte.
   -------------------------------------------------------------------------- */
const QTE_CASE = /^\d{1,3}[.,]\d{2}$/;

function valeurQuantite(t) {
  const s = String(t || '').replace(/\s+/g, '');
  /* « 412,00 » : le 4 est le bord du cercle. On prend les deux chiffres
     collés à la virgule. « 1200 » : virgule perdue, les deux zéros restent. */
  const m = s.match(/(\d{1,2})[.,]0{1,2}(?!\d)/) || s.match(/^(\d{1,2})00$/);
  const v = m ? +m[1] : 0;
  if (!(v > 0 && v < 100)) return null;
  /* Chiffre en trop devant (« 412,00 », « 120,00 ») : valeur gardée mais
     signalée, elle ne doit jamais passer pour sûre. */
  const avant = s.slice(0, m.index + m[0].indexOf(m[1])).match(/\d+$/);
  return { v: v, rogne: !!avant };
}

async function lireQuantitesBL(canvas, res, lignesLues) {
  const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
  const cy = b => (b.y0 + b.y1) / 2;
  const avecBox = res.lignes.filter(l => l._box && l._mots && l._mots.length);
  /* Repères : lignes dont la quantité s'est lue dans la page. Le cadre d'une
     ligne entière est trop haut sur une photo inclinée : on s'ancre sur un
     mot précis, le lot (ou à défaut le dernier mot avant la colonne). */
  const reperes = [];
  avecBox.forEach(l => {
    const d = l._mots.filter(m => m.bbox && QTE_CASE.test(m.t) && m.bbox.x0 > (l._box.x0 + l._box.x1) / 2).pop();
    const a = ancreLigne(l, d ? d.bbox.x0 : Infinity);
    if (d && a) reperes.push({ y: cy(a), dy: (cy(d.bbox) - cy(a)) / Math.max(1, a.y1 - a.y0), x0: d.bbox.x0, x1: d.bbox.x1 });
  });
  if (!reperes.length) return;
  const colX0 = med(reperes.map(r => r.x0)), colX1 = med(reperes.map(r => r.x1));
  const marge = (colX1 - colX0) * 0.4;

  const cases = [];
  let caseTotal = null;
  try {
    avecBox.forEach(l => {
      const a = ancreLigne(l, colX0 - marge);
      if (!a) return;
      const h = Math.max(1, a.y1 - a.y0);
      const proche = reperes.slice().sort((p, q) => Math.abs(p.y - cy(a)) - Math.abs(q.y - cy(a)))[0];
      const yc = cy(a) + proche.dy * h;
      const x0 = Math.max(0, colX0 - marge), x1 = Math.min(canvas.width, colX1 + marge);
      const y0 = Math.max(0, yc - h * 0.9), y1 = Math.min(canvas.height, yc + h * 0.9);
      if (x1 - x0 < 4 || y1 - y0 < 4) return;
      cases.push({ l: l, gris: decouper(canvas, x0, y0, x1, y1, 60), votes: [] });
    });
    /* Ligne du total, si aucune lecture ne l'a donnée. */
    if (res.total === null) {
      const lt = (lignesLues || []).filter(L => L.bbox && /total|litr/i.test(L.texte)).pop();
      if (lt) {
        const h = Math.max(1, lt.bbox.y1 - lt.bbox.y0);
        caseTotal = decouper(canvas, lt.bbox.x0, Math.max(0, lt.bbox.y0 - h * 0.6),
          canvas.width, Math.min(canvas.height, lt.bbox.y1 + h * 0.6), 60);
      }
    }
    cases.forEach(c => { c.nb = copierCanvas(c.gris); binariserOtsu(c.nb); });

    clearTimeout(OCR._minuteur);
    const w = await obtenirWorker();
    for (const [source, psm] of [['gris', '7'], ['gris', '6'], ['nb', '7']]) {
      await w.setParameters({ tessedit_char_whitelist: '0123456789,.', tessedit_pageseg_mode: psm });
      for (let i = 0; i < cases.length; i++) {
        const r = await w.recognize(cases[i][source]);
        const v = valeurQuantite(r.data.text);
        if (v) { cases[i].votes.push(v.v); if (v.rogne) cases[i].rogne = true; }
      }
    }
    if (caseTotal) {
      await w.setParameters({ tessedit_char_whitelist: '0123456789,.=', tessedit_pageseg_mode: '7' });
      const r = await w.recognize(caseTotal);
      const m = String(r.data.text || '').replace(/\s+/g, '').match(/=?(\d{1,4})[.,](\d{2})$/);
      if (m && +m[1] > 0 && +m[1] <= 5000) res.total = +m[1];
    }
  } finally {
    reporterArret();
    cases.forEach(c => { libererCanvas(c.gris); if (c.nb) libererCanvas(c.nb); });
    if (caseTotal) libererCanvas(caseTotal);
  }

  cases.forEach((c, i) => {
    const v = c.votes.slice();
    if (c.l.qte) v.push(c.l.qte);          // la lecture de la page vote aussi
    if (!v.length) return;
    const compte = {};
    v.forEach(x => { compte[x] = (compte[x] || 0) + 1; });
    /* À égalité, l'ordre des lectures départage : gris en ligne d'abord. */
    const gagnant = v.reduce((a, b) => compte[b] > compte[a] ? b : a, v[0]);
    c.l.qte = gagnant;
    /* Sûre seulement si toutes les lectures concordent, à deux au moins :
       un bord de cercle lu « 1 » transforme un 2 en 12 sur les trois
       lectures de la même case, mais pas dans la page. */
    c.l.qteDouteuse = v.length < 2 || Object.keys(compte).length > 1 || !!c.rogne;
  });
}

/* Mot d'ancrage d'une ligne : le lot s'il est lu, sinon le dernier mot
   situé avant la colonne des quantités. */
function ancreLigne(l, avantX) {
  const mots = l._mots.filter(m => m.bbox && m.bbox.x1 < avantX && m.bbox.y1 > m.bbox.y0);
  const lot = l.lot ? mots.filter(m => lotDepuisJeton(m.t, !!l.taille)).pop() : null;
  const m = lot || mots.pop();
  return m ? m.bbox : null;
}

/* Découpe agrandie : une case de quelques pixels de haut est remise à
   environ `hauteur` px, la taille où le moteur lit le mieux les chiffres. */
function decouper(src, x0, y0, x1, y1, hauteur) {
  const k = Math.max(1, Math.min(6, hauteur / (y1 - y0)));
  const cv = document.createElement('canvas');
  cv.width = Math.round((x1 - x0) * k); cv.height = Math.round((y1 - y0) * k);
  const g = cv.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, x0, y0, x1 - x0, y1 - y0, 0, 0, cv.width, cv.height);
  return cv;
}

/* Noir et blanc à seuil unique (Otsu) : sur une case isolée l'éclairage est
   uniforme, le seuillage local de la page entière n'apporte rien. */
function binariserOtsu(cv) {
  const g = cv.getContext('2d', { willReadFrequently: true });
  const img = g.getImageData(0, 0, cv.width, cv.height), px = img.data;
  const N = cv.width * cv.height, gris = new Uint8Array(N), hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < N; i++, j += 4) { gris[i] = (px[j] * 0.299 + px[j + 1] * 0.587 + px[j + 2] * 0.114) | 0; hist[gris[i]]++; }
  let somme = 0; for (let t = 0; t < 256; t++) somme += t * hist[t];
  let sB = 0, wB = 0, meilleur = 0, seuil = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = N - wB; if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (somme - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if (v > meilleur) { meilleur = v; seuil = t; }
  }
  for (let i = 0, j = 0; i < N; i++, j += 4) { const o = gris[i] < seuil ? 0 : 255; px[j] = px[j + 1] = px[j + 2] = o; }
  g.putImageData(img, 0, 0);
}

/* Recoupement avec « Total Litres » : la somme des bacs × taille doit le
   donner. Si une seule quantité de glace manque, le total la propose. La
   somme lue (litresLus) est affichée quand elle diffère du total. */
function recouperTotal(res) {
  const glaces = res.lignes.filter(l => l.taille > 0);
  if (!res.total || !glaces.length) return;
  const sures = glaces.filter(l => l.qte && !l.qteDouteuse);
  const autres = glaces.filter(l => !l.qte || l.qteDouteuse);
  const somme = ls => ls.reduce((t, l) => t + l.qte * l.taille, 0);
  /* Proposée seulement, jamais confirmée : une ligne entière a pu échapper
     à la lecture, et le reste du total lui revient alors en partie. */
  if (autres.length === 1 && !autres[0].qte) {
    const q = (res.total - somme(sures)) / autres[0].taille;
    if (q > 0 && q < 100 && Number.isInteger(q)) { autres[0].qte = q; autres[0].qteDouteuse = true; }
  }
  if (glaces.every(l => l.qte)) res.litresLus = somme(glaces);
}

/* Complète une lecture par une autre : total, numéro, et lots manquants
   repris sur la ligne de même référence. */
function completerBL(res, autre) {
  if (res.total === null) res.total = autre.total;
  if (!res.bl) res.bl = autre.bl;
  const cle = r => String(r || '').toUpperCase().replace(/^[\$S]+/, '');
  res.lignes.forEach(l => {
    if (l.lot || !l.reference) return;
    const m = autre.lignes.filter(a => a.lot && cle(a.reference) === cle(l.reference))[0];
    if (m) { l.lot = m.lot; l.lotCorrige = m.lotCorrige; }
  });
}

/* Relecture du bon avant de poursuivre. Rien n'est enregistré ici : l'écran
   suivant (réception ou écart) reprend chaque ligne, modifiable. */
function confirmerBL(r, apercu, resolve) {
  const sansQte = r.lignes.filter(l => !l.qte || l.qteDouteuse).length;
  const sansLot = r.lignes.filter(l => !l.lot).length;
  showSheet(
    '<h2 id="sheet-titre">Bon de livraison lu</h2>' +
    '<p class="sub">' + r.lignes.length + ' ' + (r.lignes.length > 1 ? 'lignes lues' : 'ligne lue') +
    (r.total !== null && r.total !== undefined ? ' · total ' + r.total + ' L' : '') + '</p>' +
    '<div class="alerte warn"><span class="ai">●</span><div><b>Vérifiez avec le bon papier</b>' +
    '<p>' + (sansQte ? sansQte + ' quantité' + (sansQte > 1 ? 's' : '') + ' illisible' + (sansQte > 1 ? 's' : '') + ' ou douteuse' + (sansQte > 1 ? 's' : '') + ' (marquée' + (sansQte > 1 ? 's' : '') + ' « ? »). ' : '') +
    (sansLot ? sansLot + ' lot' + (sansLot > 1 ? 's' : '') + ' illisible' + (sansLot > 1 ? 's' : '') + '. ' : '') +
    (r.litresLus && r.total && r.litresLus !== r.total
      ? 'Les quantités de glace lues font ' + r.litresLus + ' L, le bon annonce ' + r.total + ' L : au moins une est fausse. ' : '') +
    'Chaque ligne reste modifiable à l’étape suivante.</p></div></div>' +
    '<div class="champ" style="margin-top:14px"><label class="f">N° de bon</label>' +
    '<input type="text" id="ob-num" value="' + esc(r.numero) + '" autocapitalize="characters" spellcheck="false"></div>' +
    (r.lignes.length
      ? '<div class="dense" style="margin-top:14px"><div class="dense-h"><span class="c1">Produit</span>' +
        '<span class="c ww">Lot</span><span class="c w">Qté</span></div><div class="dense-scroll">' +
        r.lignes.map(l => '<div class="dl"><span class="c1">' + esc(l.designation) + '</span>' +
          '<span class="c ww">' + (l.lot ? esc(l.lot) + (l.lotCorrige ? ' ?' : '') : '—') + '</span>' +
          '<span class="c w num">' + (l.qte ? l.qte + (l.qteDouteuse ? ' ?' : '') : '?') + '</span></div>').join('') + '</div></div>'
      : '') +
    (apercu ? '<details style="margin-top:16px"><summary class="mini">Voir ce qu’a vu la machine</summary>' +
      '<img src="' + apercu + '" alt="Photo du bon" ' +
      'style="width:100%;border-radius:12px;margin-top:10px;border:1px solid var(--line)">' +
      '<pre class="mini" style="white-space:pre-wrap;margin-top:10px">' + esc(r.texte.slice(0, 1500)) + '</pre>' +
      '</details>' : '') +
    '<div class="actions"><button class="btn clair" id="ob-x">Reprendre la photo</button>' +
    '<button class="btn menthe" id="ob-ok">Continuer</button></div>' +
    '<button class="btn clair bloc" id="ob-annuler" style="margin-top:10px">Annuler</button>');

  document.getElementById('ob-annuler').onclick = () => { closeSheet(); resolve(null); };
  document.getElementById('ob-x').onclick = () => {
    closeSheet();
    scannerPhoto('bl').then(resolve, () => resolve(null));
  };
  document.getElementById('ob-ok').onclick = () => {
    const numero = document.getElementById('ob-num').value.trim().toUpperCase();
    closeSheet();
    resolve(Object.assign({}, r, { numero: numero, valide: true, par: STATE.user ? STATE.user.prenom : null }));
  };
}

/* options.enchainer : propose « … et scanner le suivant ». Seul l'écran
   Traçabilité sait relancer la prise de vue ; ailleurs (bon de livraison,
   DLC à réception), le bouton faisait exactement la même chose que
   « Valider » et laissait croire à un mode chaîne inexistant. */
function scannerPhoto(type, options) {
  OCR._chaine = !!(options && options.enchainer);
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
    /* Sélecteur refermé sans photo : sans cet écouteur la promesse restait en
       suspens et l'écran appelant (réception en cours) ne revenait jamais. */
    cam.oncancel = () => resolve(null);
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
  if (!texte) return { lignes: [], bl: null, total: null, date: null };
  const brut = String(texte);

  /* Numéro du bon et total en litres, pour recouper la saisie. Le total
     s'écrit « Total Litres / Liters / Litro / Litri = 456,00 » : la lecture
     coupe parfois la ligne, on prend aussi le nombre qui suit « Litri = ». */
  const mBL = brut.match(/\bBL\s*(\d{5,8})\b/i);
  /* « 1.456,00 » ou « 1 456,00 » : séparateur de milliers retiré, sinon
     parseFloat rendait 1,456 L et l'écart accusait un manque de 1 454 L. */
  const NB = '(\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?|\\d{1,3}(?: \\d{3})+,\\d{2}|\\d+(?:[.,]\\d+)?)';
  const mTot = brut.match(new RegExp('Total\\s+Litres[^\\d\\n]*' + NB, 'i'))
            || brut.match(new RegExp('Lit(?:ri|ro)\\s*=\\s*' + NB, 'i'));
  const nombre = x => parseFloat(String(x).replace(/[ .](?=\d{3}\b)/g, '').replace(',', '.'));
  /* Date d'enlèvement : la date qui suit le numéro du bon, sinon la première
     date complète. Une date impossible (31/02) est écartée. */
  let date = null;
  const reD = /\b(\d{2})[\/.](\d{2})[\/.](20\d{2})\b/g;
  const apresBL = mBL ? brut.slice(mBL.index) : brut;
  const mD = reD.exec(apresBL) || (reD.lastIndex = 0, reD.exec(brut));
  if (mD) {
    const j = new Date(+mD[3], +mD[2] - 1, +mD[1]);
    if (j.getMonth() === +mD[2] - 1 && j.getDate() === +mD[1]) date = mD[3] + '-' + mD[2] + '-' + mD[1];
  }

  const lignes = [];
  brut.split(/[\r\n]+/).forEach(l => {
    /* « 3 tres », « 3 ltres », « 3 itres » : le « li » de litres se perd sur
       une photo floue. Sans contenance, la ligne n'était plus une glace : ni
       taille, ni correction du lot (« 140694 » pour 14069A), et un carton. */
    const t = l.replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/\b(\d{1,2}) ?(?:[lt][i1l]?tres?|[i1]?tres|lires?)\b/gi, '$1 litres');
    if (t.length < 8) return;
    const jetons = t.split(' ');

    /* Référence en tête : « $AMARENA25 », « MACGLAMP », « GAUFRE ». La lecture
       rend souvent le « $ » en « S » : on garde la référence telle que lue,
       elle sert de repère, pas de clé. */
    const mRef = jetons[0].match(/^[\$s]{0,2}[A-Z][A-Z0-9$]{3,15}$/);
    const ref = mRef ? jetons[0] : '';

    /* Lot : le dernier jeton qui a la forme d'un lot connu, après correction
       des confusions de lecture (s → 5, 4 final → A sur un lot de glace). */
    const glace = /\b\d\s*[lt]itres?\b|\blitres?\b/i.test(t);
    let iLot = -1, lot = '', corrige = false;
    for (let i = jetons.length - 1; i > 0; i--) {
      const c = lotDepuisJeton(jetons[i], glace);
      /* Le numéro du bon lui-même (« BL 221970 ») n'est pas un lot. */
      if (c && !(mBL && c.lot === mBL[1])) { iLot = i; lot = c.lot; corrige = c.corrige; break; }
    }

    /* Quantité : un nombre à deux décimales APRÈS le lot (« 12,00 »). Les
       quantités entourées au stylo se lisent mal : sans nombre propre, on la
       laisse vide plutôt que d'en inventer une. */
    let qte = null;
    for (let i = jetons.length - 1; i > iLot && i > 0; i--) {
      /* Le cercle au stylo se lit parfois en parenthèse : « (12,00) ». */
      const mQ = jetons[i].replace(/[()[\]{}]/g, '').match(/^\d{1,3}[.,]\d{2}$/);
      /* Arrondi à l'entier : « 12,06 » est un 12,00 dont le cercle a mordu un
         zéro, et le bon compte des bacs et des cartons entiers. */
      if (mQ) { qte = Math.round(parseFloat(mQ[0].replace(',', '.'))) || null; break; }
    }

    const debut = ref ? 1 : 0;
    let design = jetons.slice(debut, iLot > 0 ? iLot : jetons.length).join(' ')
      .replace(/\b\d{1,3}[.,]\d{2}\b.*$/, '').trim();
    /* On coupe après la contenance : ce qui suit est l'annotation manuscrite
       de l'équipe (« Glace Café 3 litres Cafe »). */
    const coupe = design.match(/^(.*?\b\d+\s*[lt]itres?\b)/i) || design.match(/^(.*?\(\s*\d+\s*(?:[x×]\s*\d+\s*)?p\s*[)}])/i);
    if (coupe) design = coupe[1];
    design = design.replace(/\b(\d+)\s*titres?\b/i, '$1 litres').replace(/[}]$/, ')')
      .replace(/[\s;:,.'"_—-]+$/, '').trim();
    if (design.length < 4) return;

    /* Lignes qui ne sont pas des produits : frais de port, total, sous-total.
       Sans ce filtre, le « Total Litres = 348,00 » devenait une ligne de 348
       unités, et les frais de port un article à réceptionner. */
    if (/total|frais\s+de\s+port|emballage|palette\s*n|^page\b|forwarder|adresse|t[ée]l[ée]phone|intracom|\bBL\b|commande|client|siret|siren|\brcs\b|\btva\b|iban|\bbic\b|capital|\bn[°o]\s/i.test(t)) return;
    const produit = /glace|sorbet|macaron|gaufre|cookie|cr[eêè]pe|gianduiotto|biscuit|cornet/i.test(design);
    /* Une ligne d'en-tête avec un nombre à six chiffres n'est pas un produit :
       il faut une référence en tête, un libellé de produit, ou lot ET quantité. */
    if (!(ref || produit || (lot && qte))) return;
    if (!lot && !(ref && produit)) return;

    /* Contenance : « 3 litres » pour un bac, « (14x6p) » pour un carton. */
    const mL = design.match(/(\d+)\s*litres?/i);
    const mC = design.match(/\((\d+)\s*[x×]\s*(\d+)\s*p\)/i);
    const mU = design.match(/\((\d+)\s*p\)/i);
    const taille = mL ? +mL[1] : null;

    lignes.push({
      designation: design,
      reference: ref.replace(/^s(?=\$)/, ''),
      lot: lot,
      lotCorrige: corrige,
      qte: qte,
      taille: taille,
      unite: (taille || /^(glace|sorbet)\b/i.test(design)) ? 'bac' : 'carton',
      /* Unités par colis, quand le conditionnement est indiqué. */
      parColis: mC ? (+mC[1] * +mC[2]) : (mU ? +mU[1] : null)
    });
  });

  return {
    lignes: lignes,
    bl: mBL ? 'BL' + mBL[1] : null,
    /* Au-delà de 5 000 L, c'est une lecture collée : champ laissé vide. */
    total: mTot && nombre(mTot[1]) > 0 && nombre(mTot[1]) <= 5000 ? nombre(mTot[1]) : null,
    date: date
  };
}

/* Un jeton lu est-il un lot ? Formats du bon Jetfreeze : 14159A (glace),
   L5245A (macaron), 260903 (gaufre, crêpe), 62455006 (cookie). La lecture
   confond s et 5, O et 0 ; sur une ligne de glace, le A final sort en 4
   (« 141594 »). La correction n'est gardée que si le résultat a une forme
   connue, et elle est signalée pour que la personne vérifie. */
function lotDepuisJeton(jeton, glace) {
  const j = String(jeton).replace(/[.,;:]+$/, '').toUpperCase();
  if (j.length < 6 || j.length > 10) return null;
  if (/^20[2-4]\d/.test(j) && j.length === 8) return null;   // une date collée
  if (/^1[34]\d{3}[A-Z]$/.test(j) || /^L\d{4}[A-Z]$/.test(j) || /^\d{8}$/.test(j)) return { lot: j, corrige: false };
  if (/^\d{6}$/.test(j) && !(glace && /^1[34]/.test(j))) return { lot: j, corrige: false };
  if (j.length !== 6) return null;
  const ch = c => VERS_CHIFFRE[c] !== undefined ? VERS_CHIFFRE[c] : c;
  const le = c => VERS_LETTRE[c] !== undefined ? VERS_LETTRE[c] : c;
  const c = j.split('');
  /* Macaron : L + quatre chiffres + lettre. */
  if (j[0] === 'L') {
    const m = 'L' + c.slice(1, 5).map(ch).join('') + le(c[5]);
    if (/^L\d{4}[A-Z]$/.test(m)) return { lot: m, corrige: m !== j };
  }
  /* Glace : cinq chiffres + lettre. */
  if (glace) {
    const g = c.slice(0, 5).map(ch).join('') + le(c[5]);
    if (/^1[34]\d{3}[A-Z]$/.test(g)) return { lot: g, corrige: g !== j };
  }
  return null;
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
  /* Format macarons : L + quatre chiffres + lettre. */
  if (/^L\d{4}[A-Z]$/.test(L)) return true;
  /* Format crêpes et gaufres : six chiffres sans lettre. */
  if (/^\d{6}$/.test(L)) return true;
  /* Crème fondente IRCA : huit chiffres. */
  if (/^\d{8}$/.test(L)) return true;
  /* Mocca beans : neuf chiffres, étiquette à « DLUO ». */
  if (/^\d{9}$/.test(L)) return true;
  /* Éclats de caramel : deux chiffres, une lettre, sept chiffres — 26F1511703. */
  if (/^\d{2}[A-Z]\d{7}$/.test(L)) return true;
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

  /* Un jour ou un mois peut s'écrire sur un seul chiffre : « 28-7-2028 » sur
     l'étiquette des mocca beans. On normalise sur deux chiffres. */
  const iso = d => {
    const p = d.split(/[\/.\-]/);
    const dd = ('0' + p[0]).slice(-2), mm = ('0' + p[1]).slice(-2);
    return p[2] + '-' + mm + '-' + dd;
  };

  /* Les dates. Deux difficultés cumulées, constatées en passant une vraie image
     dans le moteur de lecture :

     • l'étiquette Amorino est en COLONNES — les libellés « Production Date /
       BBD / LOT N° » sur une ligne, les valeurs sur la suivante. Chercher
       « BBD » suivi d'une date ne rendait jamais rien ;

     • le profil de lecture des codes filtre les séparateurs. La ligne revient
       collée : « 290620262706202813996AN25253L ». Une date au format jj/mm/aaaa
       n'y existe plus.

     On lit donc les deux formes, et on retient la date la PLUS LOINTAINE comme
     expiration : un produit ne périme jamais avant d'être fabriqué. */
  const valide = d => {
    if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d)) return false;
    const an = +d.slice(0, 4);
    return an >= 2020 && an <= 2040;
  };
  const brutes = [];
  (T.match(/\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4}\b/g) || []).forEach(d => brutes.push(iso(d)));
  /* Forme collée : huit chiffres, jjmmaaaa. On balaie sans exiger de frontière
     de mot, puisque tout est soudé. */
  const sansSep = T.replace(/[^0-9]/g, ' ');
  (sansSep.match(/\d{8,}/g) || []).forEach(bloc => {
    for (let i = 0; i + 8 <= bloc.length; i++) {
      const d = bloc.substr(i, 8);
      const c = d.slice(4) + '-' + d.slice(2, 4) + '-' + d.slice(0, 2);
      if (valide(c)) brutes.push(c);
    }
  });
  const dates = [...new Set(brutes.filter(valide))].sort();

  /* Contrôle de cohérence entre les deux dates. Sur une étiquette Amorino,
     l'écart production → expiration vaut toujours 24 mois à quelques jours
     près. Un écart aberrant trahit un chiffre mal lu : mesuré en conditions
     dégradées, le moteur a rendu « 27706 2028 » au lieu de « 27/06/2028 »,
     en insérant un 7 parasite. */
  let ecartMois = null;
  if (dates.length >= 2) {
    const a = new Date(dates[0]), b = new Date(dates[dates.length - 1]);
    ecartMois = Math.round((b - a) / (1000 * 60 * 60 * 24 * 30.44));
  }

  /* L'ancrage reste prioritaire quand il fonctionne : sur une étiquette où le
     libellé précède bien sa date, il lève toute ambiguïté. */
  const mB = T.match(/(?:BBD|BEST\s*(?:USED\s*)?BEFORE|DLUO|CONSOMMER\s+DE\s+PRÉFÉRENCE[^\d]{0,40}|CONSUMARSI[^\d]{0,40})[^\d]{0,20}(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})/);
  const mP = T.match(/(?:PRODUCTION\s*DATE|DATA\s*PRODUZIONE|DATE\s+DE\s+PRODUCTION|DATE\s+CONDITIONNEMENT)[^\d]{0,24}(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})/);

  const expiration = mB ? iso(mB[1])
    : (dates.length >= 2 ? dates[dates.length - 1]
    : (dates.length === 1 ? dates[0] : null));
  const production = mP ? iso(mP[1])
    : (dates.length >= 2 ? dates[0] : null);

  return {
    parBac:    mC ? +mC[1] : null,     // nombre de bacs dans le carton
    taille:    mC ? +mC[2] : null,     // contenance d'un bac, en litres
    expiration: expiration,
    production: production,
    poidsKg:   mW ? parseFloat(mW[1].replace(',', '.')) : null,
    reference: mR ? '$' + mR[1] : null,
    /* Écart entre production et expiration, en mois. Hors de la plage
       attendue, la lecture est douteuse et mérite une vérification humaine. */
    ecartMois: ecartMois,
    datesCoherentes: ecartMois === null ? null : (ecartMois >= 6 && ecartMois <= 36),
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
     mieux vaut demander de taper que d'inscrire un numéro faux.

     Mais la confiance de Tesseract s'effondre sur un texte sans espaces — une
     étiquette en colonnes revient collée, et il rend 0 % alors que la lecture
     est parfaite. Mesuré : « 13996A » correctement lu, confiance 0 %.
     La forme du numéro est donc le critère fiable, pas le score : un lot qui
     respecte un format connu est conservé quelle que soit la confiance. */
  if (r.lot && !lotVraisemblable(r.lot) && r.confiance < 0.40) {
    r.lotRejete = r.lot;
    r.lot = '';
  }
  /* Un lot de forme valide vaut mieux qu'un score : on relève la confiance
     affichée pour ne pas alarmer sur une lecture qui, elle, est bonne. */
  if (r.lot && lotVraisemblable(r.lot) && r.confiance < 0.55) {
    r.confiance = 0.55;
    r.formeValide = true;
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
        '<select id="oc-parfum"><option value="">Non identifié</option>' +
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
    (OCR._chaine ? '<button class="btn ciel bloc" id="oc-suite" style="margin-top:10px">' +
    '✅ Valider et scanner le suivant</button>' : ''));

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

  /* « Reprendre la photo » relance la prise de vue au lieu de tout fermer :
     il fallait retoucher « Scanner une étiquette ». La nouvelle lecture
     répond à l'appelant d'origine. */
  document.getElementById('oc-x').onclick  = () => {
    closeSheet();
    scannerPhoto(type, { enchainer: OCR._chaine }).then(resolve, () => resolve(null));
  };
  document.getElementById('oc-ok').onclick = () => {
    const v = recolter(); if (!v) return;
    closeSheet(); resolve(v);
  };
  /* Mode chaîne : on enregistre et l'appareil photo repart immédiatement.
     Une livraison, c'est cinquante étiquettes — refermer la fiche et rouvrir
     le menu à chaque fois n'est pas tenable un jour de rush. */
  const suite = document.getElementById('oc-suite');
  if (suite) suite.onclick = () => {
    const v = recolter(); if (!v) return;
    closeSheet(); resolve(Object.assign(v, { enchainer: true }));
  };
}

function saisieManuelle(type, raison, resolve) {
  showSheet(
    '<h2 id="sheet-titre">Lecture impossible</h2>' +
    '<p class="sub">' + esc(raison) + '</p>' +
    (type === 'bl'
      ? '<div class="alerte info"><span class="ai">✍️</span><div><b>Saisissez le n° du bon à la main</b>' +
        '<p>Photo floue, de travers ou trop sombre. Tapez le numéro, on avance quand même.</p></div></div>' +
        '<div class="champ" style="margin-top:14px"><label class="f">N° de bon</label>'
      : '<div class="alerte info"><span class="ai">✍️</span><div><b>Saisissez le lot à la main</b>' +
        '<p>Reflet trop fort, étiquette abîmée ou photo floue. Tapez le numéro, on avance quand même.</p></div></div>' +
        '<div class="champ" style="margin-top:14px"><label class="f">Numéro de lot</label>') +
    '<input type="text" id="sm-lot" data-autofocus autocapitalize="characters" spellcheck="false" ' +
    'placeholder="' + (type === 'bl' ? 'Ex. BL221970' : 'Ex. 13845A') + '" style="font-size:22px;letter-spacing:.14em;text-align:center"></div>' +
    (type === 'etiquette'
      ? '<div class="champ" style="margin-top:14px"><label class="f">Parfum</label>' +
        '<select id="sm-parfum"><option value="">Choisir…</option>' +
        PARFUMS.map(p => '<option value="' + esc(p) + '">' + esc(p) + '</option>').join('') + '</select></div>'
      : '') +
    '<div class="actions"><button class="btn clair" id="sm-x">Annuler</button>' +
    '<button class="btn menthe" id="sm-ok">Enregistrer</button></div>' +
    (OCR._chaine ? '<button class="btn ciel bloc" id="sm-suite" style="margin-top:10px">' +
    '✅ Enregistrer et scanner le suivant</button>' : ''));

  document.getElementById('sm-x').onclick  = () => { closeSheet(); resolve(null); };
  const valider = enchainer => {
    const lot = document.getElementById('sm-lot').value.trim().toUpperCase();
    if (!lot) return toast(type === 'bl' ? 'Saisissez le numéro du bon' : 'Saisissez le numéro de lot', 'erreur');
    const pf = document.getElementById('sm-parfum');
    closeSheet();
    resolve({ lot: lot, numero: lot, ouv: today(), date: today(),
              parfum: pf ? pf.value : '', fournisseur: FOURNISSEUR.nom,
              lignes: [], lignesNonLues: true,
              confiance: 1, saisieManuelle: true, texte: '', enchainer: !!enchainer });
  };
  document.getElementById('sm-ok').onclick    = () => valider(false);
  const suite = document.getElementById('sm-suite');
  if (suite) suite.onclick = () => valider(true);
}
