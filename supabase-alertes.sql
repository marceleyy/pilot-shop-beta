-- =============================================================================
-- PILOT-SHOP — alertes sur le téléphone du manager (alertes.js)
--
-- BLOC 1 : les deux tables. À lancer avant la mise en ligne de l'application.
-- BLOC 2 : la tournée des frigos toutes les 10 minutes (pg_cron + pg_net),
--          après le déploiement de la fonction « alertes ».
-- Rejouable.
-- =============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ BLOC 1 — TABLES                                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

/* Un téléphone de manager abonné : même forme que les autres tables
   (site, id, data), donc même règle « chaque compte ne voit que sa boutique ». */
create table if not exists public.abonnements_push (
  site       text not null default public.site_courant(),
  id         text not null,
  data       jsonb,
  created_at timestamptz not null default now(),
  primary key (site, id)
);
alter table public.abonnements_push enable row level security;
drop policy if exists p_site on public.abonnements_push;
create policy p_site on public.abonnements_push for all to authenticated
  using (site = public.site_courant()) with check (site = public.site_courant());
revoke all on public.abonnements_push from anon;

/* Alertes déjà parties : la même ne part qu'une fois. Lue et écrite par la
   fonction seulement (clé de service) : aucune politique, donc aucun accès
   pour les appareils. */
create table if not exists public.alertes_envoyees (
  site       text not null,
  id         text not null,
  created_at timestamptz not null default now(),
  primary key (site, id)
);
alter table public.alertes_envoyees enable row level security;
revoke all on public.alertes_envoyees from anon, authenticated;

notify pgrst, 'reload schema';

-- Attendu : « Success. No rows returned ».



-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ BLOC 2 — TOURNÉE DES FRIGOS TOUTES LES 10 MINUTES                        ║
-- ║ Remplacez PROJET par l'identifiant du projet et SECRET par la valeur     ║
-- ║ d'ALERTES_CRON_SECRET (la même que dans les secrets de la fonction).     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create extension if not exists pg_cron;
create extension if not exists pg_net;

/* Le secret reste dans le coffre (Vault), pas en clair dans la tâche. */
select vault.create_secret('SECRET', 'alertes_cron_secret')
 where not exists (select 1 from vault.secrets where name = 'alertes_cron_secret');

select cron.unschedule('pilotshop-alertes-frigos')
 where exists (select 1 from cron.job where jobname = 'pilotshop-alertes-frigos');

select cron.schedule('pilotshop-alertes-frigos', '*/10 * * * *', $$
  select net.http_post(
    url     := 'https://PROJET.supabase.co/functions/v1/alertes',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cle-cron', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alertes_cron_secret')),
    body    := '{}'::jsonb)
$$);

-- Attendu : un numéro de tâche. Pour vérifier :
--   select * from cron.job_run_details order by start_time desc limit 5;
--   select * from net._http_response order by created desc limit 5;
