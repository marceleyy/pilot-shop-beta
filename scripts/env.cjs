/* =============================================================================
   scripts/env.cjs
   Génère env.js au moment du build, à partir des variables d'environnement.

   Pourquoi ce script : env.js contient l'URL du projet Supabase et la clé
   publishable. Il n'est pas versionné (il figure dans .gitignore), mais
   l'application en a besoin dans le navigateur. Vercel l'écrit donc au build.

   Vercel → Settings → Environment Variables :
       SUPABASE_URL       = https://votreprojet.supabase.co
       SUPABASE_ANON_KEY  = sb_publishable_...
   Vercel → Settings → Build & Development → Build Command :
       node scripts/env.cjs

   En local, le script ne touche à rien s'il ne trouve pas les variables :
   votre env.js de développement est préservé.
   ============================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_ANON_KEY || '';
const cible = path.join(__dirname, '..', 'env.js');
const enLigne = !!process.env.VERCEL;

/* --- Garde-fou : ne jamais écraser un env.js local par du vide --- */
if (!url || !key) {
  if (enLigne) {
    console.error('\n  ERREUR — variables d\u2019environnement manquantes.');
    console.error('  SUPABASE_URL      : ' + (url ? 'présente' : 'ABSENTE'));
    console.error('  SUPABASE_ANON_KEY : ' + (key ? 'présente' : 'ABSENTE'));
    console.error('  Renseignez-les dans Vercel \u2192 Settings \u2192 Environment Variables,');
    console.error('  puis relancez le déploiement.\n');
    process.exit(1);          // build échoué : mieux vaut ça qu'un site muet
  }
  console.log('env.cjs : variables absentes, env.js local laissé intact.');
  process.exit(0);
}

/* --- Contrôles de forme, pour attraper les fautes de frappe --- */
if (/^sb_secret_/.test(key)) {
  console.error('\n  ARRÊT — vous utilisez une clé SECRÈTE.');
  console.error('  Elle donne un accès privilégié et finirait publiée dans le navigateur.');
  console.error('  Utilisez la clé publishable.\n');
  process.exit(1);
}
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) {
  console.warn('env.cjs : SUPABASE_URL ne ressemble pas à une URL Supabase — ' + url);
}
if (!/^(sb_publishable_|eyJ)/.test(key)) {
  console.warn('env.cjs : SUPABASE_ANON_KEY n\u2019a pas un format attendu (sb_publishable_… ou eyJ…)');
}

/* --- Écriture --- */
const contenu =
  '/* Généré automatiquement par scripts/env.cjs — ne pas modifier à la main. */\n' +
  '/* Build ' + new Date().toISOString() + ' */\n' +
  'window.__ENV__ = ' + JSON.stringify({
    SUPABASE_URL: url.replace(/\/$/, ''),
    SUPABASE_ANON_KEY: key
  }, null, 2) + ';\n';

fs.writeFileSync(cible, contenu, 'utf8');

console.log('env.cjs : env.js généré');
console.log('  projet : ' + url.replace('https://', '').split('.')[0]);
console.log('  clé    : ' + key.slice(0, 20) + '…');
