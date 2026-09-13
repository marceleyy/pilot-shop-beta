/* =============================================================================
   scripts/embarquer-tesseract.cjs

   Le moteur de reconnaissance de texte est chargé depuis un CDN. Sans réseau,
   il est absent et le scan ne fonctionne pas — alors que le mode hors ligne est
   justement la promesse de l'application, et que la réserve d'une boutique de
   montagne est précisément l'endroit où le réseau manque.

   Ce script télécharge les fichiers une fois, les place dans vendor/, et les
   ajoute au précache du service worker. Ensuite, plus rien ne dépend du réseau.

   Usage, depuis la racine du projet :
       node scripts/embarquer-tesseract.cjs

   Poids total : environ 14 Mo, dont 11 pour le modèle de langue française.
   C'est la contrepartie — mais il n'est téléchargé qu'une fois par appareil.
   ============================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const RACINE = path.join(__dirname, '..');
const DOSSIER = path.join(RACINE, 'vendor');

const FICHIERS = [
  { url: 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js',
    nom: 'tesseract.min.js' },
  { url: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
    nom: 'tesseract-worker.min.js' },
  { url: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-simd.wasm.js',
    nom: 'tesseract-core-simd.wasm.js' },
  { url: 'https://tessdata.projectnaptha.com/4.0.0_best/fra.traineddata.gz',
    nom: 'fra.traineddata.gz' }
];

function telecharger(url, destination, redirections) {
  return new Promise((resolve, reject) => {
    if ((redirections || 0) > 5) return reject(new Error('trop de redirections'));
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(telecharger(res.headers.location, destination, (redirections || 0) + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const flux = fs.createWriteStream(destination);
      res.pipe(flux);
      flux.on('finish', () => flux.close(() => resolve(fs.statSync(destination).size)));
      flux.on('error', reject);
    }).on('error', reject);
  });
}

(async function () {
  if (!fs.existsSync(DOSSIER)) fs.mkdirSync(DOSSIER, { recursive: true });

  console.log('Téléchargement des fichiers de reconnaissance de texte…\n');
  let total = 0;
  for (const f of FICHIERS) {
    const dest = path.join(DOSSIER, f.nom);
    if (fs.existsSync(dest)) {
      const t = fs.statSync(dest).size;
      console.log('  ' + f.nom.padEnd(34) + 'déjà présent (' + Math.round(t / 1024) + ' Ko)');
      total += t;
      continue;
    }
    try {
      process.stdout.write('  ' + f.nom.padEnd(34));
      const t = await telecharger(f.url, dest);
      console.log(Math.round(t / 1024) + ' Ko');
      total += t;
    } catch (e) {
      console.log('ÉCHEC : ' + e.message);
      console.log('    Téléchargez-le à la main depuis ' + f.url);
    }
  }

  console.log('\nTotal : ' + (total / 1024 / 1024).toFixed(1) + ' Mo dans vendor/');

  /* --- index.html : pointer sur la copie locale --------------------------- */
  const html = path.join(RACINE, 'index.html');
  let h = fs.readFileSync(html, 'utf8');
  const avant = h;
  h = h.replace(
    /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/tesseract\.js\/[^"]+"([^>]*)><\/script>/,
    '<script src="vendor/tesseract.min.js"$1></script>');
  if (h !== avant) {
    fs.writeFileSync(html, h, 'utf8');
    console.log('index.html  : script basculé sur la copie locale');
  } else {
    console.log('index.html  : déjà local, ou balise non reconnue');
  }

  /* --- sw.js : ajouter au précache ---------------------------------------- */
  const swf = path.join(RACINE, 'sw.js');
  let sw = fs.readFileSync(swf, 'utf8');
  if (!sw.includes('vendor/tesseract.min.js')) {
    sw = sw.replace("  '/stock.js',",
      "  '/stock.js',\n" +
      "  /* Reconnaissance de texte embarquée : sans elle, le scan ne marche pas\n" +
      "     hors ligne, alors que c'est là qu'on en a le plus besoin. */\n" +
      "  '/vendor/tesseract.min.js',\n" +
      "  '/vendor/tesseract-worker.min.js',\n" +
      "  '/vendor/tesseract-core-simd.wasm.js',\n" +
      "  '/vendor/fra.traineddata.gz',");
    fs.writeFileSync(swf, sw, 'utf8');
    console.log('sw.js       : fichiers ajoutés au précache');
  } else {
    console.log('sw.js       : déjà à jour');
  }

  console.log('\nIl reste à indiquer les chemins locaux au moteur, dans ocr.js :');
  console.log("    Tesseract.createWorker('fra', 1, {");
  console.log("      workerPath: 'vendor/tesseract-worker.min.js',");
  console.log("      corePath:   'vendor/tesseract-core-simd.wasm.js',");
  console.log("      langPath:   'vendor/'");
  console.log('    })');
})();
