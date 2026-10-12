-- =============================================================================
-- PILOT-SHOP — comparer ses boutiques (écran « Mes boutiques », franchise.js)
--
-- Chaque boutique range son résumé sous reglages.id = 'franchise:indicateurs'.
-- Cette fonction rend CE SEUL résumé pour les boutiques listées dans
-- app_metadata.franchise du compte connecté. app_metadata ne s'écrit que par
-- l'administrateur : un compte ne peut pas s'ajouter une boutique.
-- Fonction SECURITY DEFINER volontaire : le bloc 1 de
-- supabase-multi-boutiques.sql la listera, c'est attendu.
-- Déjà appliqué sur la base le 2026-10-12. Rejouable.
-- =============================================================================

create or replace function public.resumes_franchise()
returns table (site text, data jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select r.site, r.data
    from public.reglages r
   where r.id = 'franchise:indicateurs'
     and r.site in (select jsonb_array_elements_text(case when jsonb_typeof(auth.jwt() -> 'app_metadata' -> 'franchise') = 'array'
                                                    then auth.jwt() -> 'app_metadata' -> 'franchise' else '[]'::jsonb end))
$$;
revoke all on function public.resumes_franchise() from public, anon;
grant execute on function public.resumes_franchise() to authenticated;
notify pgrst, 'reload schema';

-- Activer la comparaison pour un compte de boutique (exemple : Justin) :
-- update auth.users
--    set raw_app_meta_data = raw_app_meta_data || '{"franchise":["Justin","Paccard"]}'::jsonb
--  where email = 'boutique-justin@pilot-shop.local';
-- Le changement arrive sur l'appareil au renouvellement du jeton (moins d'une heure).
