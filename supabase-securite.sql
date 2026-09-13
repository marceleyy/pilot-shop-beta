-- =============================================================================
-- PILOT-SHOP — supabase-securite.sql
--
-- Objectif : qu'une personne disposant de l'URL du site et de la clé publique
-- ne puisse RIEN lire ni écrire. Aujourd'hui elle peut tout faire.
--
-- Principe retenu : l'appareil s'authentifie une fois pour toutes (compte de
-- boutique), et toutes les écritures passent par ce compte. Le code PIN reste
-- ce qu'il est réellement — un sélecteur de personne — et non une barrière.
--
-- ORDRE D'EXÉCUTION
--   1. Créer le compte de boutique (section A, à faire dans l'interface).
--   2. Exécuter ce script entier dans le SQL Editor.
--   3. Déployer la nouvelle version de l'application.
--   4. Sur chaque iPad : saisir une fois l'adresse et le mot de passe boutique.
--
-- IMPORTANT : ne lancez l'étape 2 qu'une fois l'étape 4 prête, sinon les
-- appareils encore sur l'ancienne version cesseront d'écrire.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- A. LE COMPTE DE BOUTIQUE  (à créer dans l'interface, pas ici)
--
--   Authentication → Users → Add user → Create new user
--     Email          : paccard@pilot-shop.local
--     Password       : (générez-en un long, gardez-le dans votre gestionnaire)
--     Auto Confirm   : coché
--
--   Puis Authentication → Users → le compte → Edit → User Metadata :
--     { "site": "Paccard" }
--
-- Ce compte n'est pas celui d'une personne : c'est celui de la boutique.
-- Chaque iPad s'y connecte une fois, et la session se renouvelle seule.
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
-- B. LECTURE DU SITE DEPUIS LE JETON
-- Évite de répéter l'expression dans chaque politique, et rend le tout lisible.
-- -----------------------------------------------------------------------------
create or replace function public.site_courant()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::jsonb
             -> 'user_metadata' ->> 'site', ''),
    nullif(current_setting('request.jwt.claims', true)::jsonb
             -> 'app_metadata'  ->> 'site', '')
  );
$$;

comment on function public.site_courant() is
  'Site rattaché au compte connecté, lu dans les métadonnées du jeton.';


-- -----------------------------------------------------------------------------
-- C. ACTIVATION DE LA SÉCURITÉ SUR TOUTES LES TABLES
-- Une boucle plutôt qu'une liste : aucune table ne peut être oubliée, y compris
-- celles qui seront ajoutées plus tard si l'on relance ce script.
-- -----------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('alter table public.%I enable row level security', t.relname);

    -- On repart d'une base propre : les politiques d'un précédent passage
    -- sont supprimées avant d'être recréées.
    execute format('drop policy if exists p_lecture   on public.%I', t.relname);
    execute format('drop policy if exists p_insertion on public.%I', t.relname);
    execute format('drop policy if exists p_maj       on public.%I', t.relname);
    execute format('drop policy if exists p_suppr     on public.%I', t.relname);

    -- LECTURE : compte authentifié, et uniquement les lignes de son site.
    -- Les tables sans colonne « site » (référentiels) restent lisibles par
    -- tout compte authentifié.
    if exists (select 1 from information_schema.columns
               where table_schema='public' and table_name=t.relname and column_name='site') then
      execute format($p$
        create policy p_lecture on public.%I for select to authenticated
        using (site = public.site_courant())
      $p$, t.relname);

      execute format($p$
        create policy p_insertion on public.%I for insert to authenticated
        with check (site = public.site_courant())
      $p$, t.relname);

      execute format($p$
        create policy p_maj on public.%I for update to authenticated
        using (site = public.site_courant())
        with check (site = public.site_courant())
      $p$, t.relname);
    else
      execute format('create policy p_lecture   on public.%I for select to authenticated using (true)', t.relname);
      execute format('create policy p_insertion on public.%I for insert to authenticated with check (true)', t.relname);
      execute format('create policy p_maj       on public.%I for update to authenticated using (true) with check (true)', t.relname);
    end if;

    -- SUPPRESSION : personne. Un registre sanitaire ne s'efface pas depuis
    -- l'application. Les purges se font ici, à la main, en connaissance de cause.
  end loop;
end $$;


-- -----------------------------------------------------------------------------
-- D. RETRAIT DES DROITS DU RÔLE ANONYME
-- C'est le geste décisif : sans cela, la clé publique servie au navigateur
-- suffisait à tout lire et tout écrire.
-- -----------------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

grant select, insert, update on all tables    in schema public to authenticated;
grant usage,  select         on all sequences in schema public to authenticated;
grant execute on function public.site_courant() to authenticated;

-- Et pour les tables créées plus tard
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public grant select, insert, update on tables to authenticated;


-- -----------------------------------------------------------------------------
-- E. L'ÉQUIPE SORT DU CODE SOURCE
-- Les codes PIN étaient écrits en clair dans config.js, donc lisibles par
-- quiconque affiche la source de la page. Ils vivent désormais en base, et ne
-- sont servis qu'à un appareil authentifié.
-- -----------------------------------------------------------------------------
create table if not exists public.equipe (
  id          text primary key,
  site        text not null default 'Paccard',
  prenom      text not null,
  pin         text not null,
  role        text not null default 'equipe' check (role in ('equipe','manager')),
  couleur     text,
  initiales   text,
  actif       boolean not null default true,
  cree_le     timestamptz not null default now()
);

alter table public.equipe enable row level security;

drop policy if exists p_lecture   on public.equipe;
drop policy if exists p_insertion on public.equipe;
drop policy if exists p_maj       on public.equipe;

create policy p_lecture on public.equipe for select to authenticated
  using (site = public.site_courant());
create policy p_insertion on public.equipe for insert to authenticated
  with check (site = public.site_courant());
create policy p_maj on public.equipe for update to authenticated
  using (site = public.site_courant()) with check (site = public.site_courant());

revoke all on public.equipe from anon;
grant select, insert, update on public.equipe to authenticated;

insert into public.equipe (id, site, prenom, pin, role, couleur, initiales) values
  ('e1','Paccard','Marianna','1234','equipe',  '#C9A227','MA'),
  ('e2','Paccard','Samara',  '5678','equipe',  '#7FB8A4','SA'),
  ('e3','Paccard','Kenza',   '4321','equipe',  '#9AA87F','KE'),
  ('e4','Paccard','Lucas',   '2580','equipe',  '#5D89A6','LU'),
  ('e5','Paccard','Eve',     '9999','manager', '#0F2027','EV')
on conflict (id) do update
  set prenom = excluded.prenom, pin = excluded.pin, role = excluded.role,
      couleur = excluded.couleur, initiales = excluded.initiales;


-- -----------------------------------------------------------------------------
-- F. VÉRIFICATION
-- Les trois colonnes doivent afficher : rls_active = true, anon_lecture = false,
-- anon_ecriture = false. Si une seule ligne y échappe, ne déployez pas.
-- -----------------------------------------------------------------------------
select c.relname                                             as table_name,
       c.relrowsecurity                                      as rls_active,
       has_table_privilege('anon',          c.oid, 'SELECT') as anon_lecture,
       has_table_privilege('anon',          c.oid, 'INSERT') as anon_ecriture,
       has_table_privilege('authenticated', c.oid, 'INSERT') as appli_ecriture,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as politiques
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

notify pgrst, 'reload schema';
