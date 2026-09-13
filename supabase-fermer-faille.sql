-- =============================================================================
-- PILOT-SHOP — fermer la faille
--
-- Trois blocs. Lancez-les UN PAR UN, dans l'ordre, en vérifiant le résultat de
-- chacun avant de passer au suivant.
--
-- Dans le SQL Editor de Supabase : collez un bloc, cliquez Run, lisez le
-- résultat, puis effacez et passez au suivant. NE COLLEZ PAS TOUT D'UN COUP :
-- une seule erreur annulerait l'ensemble, et c'est ce qui s'est produit.
--
-- La table « equipe » n'est plus nécessaire : l'équipe vit déjà dans reglages.
-- =============================================================================


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ BLOC 1 — ÉTAT ACTUEL                                                     ║
-- ║ Ne modifie rien. Sert de point de comparaison.                           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

select c.relname                                             as "table",
       c.relrowsecurity                                      as "rls_active",
       has_table_privilege('anon', c.oid, 'SELECT')          as "anon_peut_lire",
       has_table_privilege('anon', c.oid, 'INSERT')          as "anon_peut_ecrire"
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

-- Attendu AVANT correction : anon_peut_lire et anon_peut_ecrire = true partout.



-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ BLOC 2 — ACTIVER LA SÉCURITÉ ET POSER LES POLITIQUES                    ║
-- ║ Une politique unique et simple : tout compte authentifié a accès, le     ║
-- ║ rôle anonyme n'a rien. Pas de filtrage par site : il n'y a qu'une        ║
-- ║ boutique, et chaque condition supplémentaire est une occasion d'échouer. ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

do $$
declare t record;
begin
  for t in
    select c.relname as nom
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('alter table public.%I enable row level security', t.nom);

    execute format('drop policy if exists p_appli on public.%I', t.nom);
    execute format(
      'create policy p_appli on public.%I for all to authenticated using (true) with check (true)',
      t.nom);
  end loop;
end $$;

-- Attendu : « Success. No rows returned ».
-- Si une erreur apparaît, copiez-la et arrêtez-vous là : le bloc 3 n'a pas
-- encore été lancé, donc rien n'est cassé.



-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ BLOC 3 — RETIRER LES DROITS AU RÔLE ANONYME                             ║
-- ║ C'est le geste décisif, et le seul irréversible dans les faits : à       ║
-- ║ partir d'ici, un appareil non rattaché ne peut plus rien écrire.        ║
-- ║ Ne le lancez que si le bloc 2 s'est terminé sans erreur.                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

notify pgrst, 'reload schema';

-- Puis relancez le BLOC 1 pour vérifier.
-- Attendu APRÈS correction : anon_peut_lire et anon_peut_ecrire = FALSE partout,
-- rls_active = true partout.
