/* =============================================================================
   env.example.js
   Copiez ce fichier en env.js, remplissez vos deux valeurs, et ajoutez la ligne
       <script src="env.js"></script>
   dans index.html AVANT config.js.

   Sur Vercel, générez env.js au build depuis les variables d'environnement
   plutôt que de le committer.

   La clé anon est publique par nature : elle finit toujours dans le navigateur.
   Ce n'est pas un secret, c'est un identifiant de projet. La sécurité réelle
   vient des policies RLS, aujourd'hui désactivées pour la bêta.
   ============================================================================= */

window.__ENV__ = {
  SUPABASE_URL: 'https://yphqsppysxhseqmmlfia.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_39wRfKoBFjmpYiU7R1ezMw_OAv4zCp2'
};
