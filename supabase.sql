-- =============================================================================
-- PILOT-SHOP — schéma Supabase
-- À coller dans SQL Editor → Run.
-- Structure clé-valeur : l'application VanillaJS écrit des objets dynamiques,
-- chaque enregistrement est donc un id texte + un document JSONB.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TABLES
-- -----------------------------------------------------------------------------
create table if not exists public.releves_temperature (
  id          text primary key,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  site        text not null default 'Chamonix',
  data        jsonb not null default '{}'::jsonb
);

create table if not exists public.taches_nettoyage (
  id text primary key, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  site text not null default 'Chamonix', data jsonb not null default '{}'::jsonb
);

create table if not exists public.reassort (
  id text primary key, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  site text not null default 'Chamonix', data jsonb not null default '{}'::jsonb
);

create table if not exists public.ruptures (
  id text primary key, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  site text not null default 'Chamonix', data jsonb not null default '[]'::jsonb
);

create table if not exists public.pertes (
  id text primary key, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  site text not null default 'Chamonix', data jsonb not null default '[]'::jsonb
);

create table if not exists public.lots (
  id text primary key, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  site text not null default 'Chamonix', data jsonb not null default '{}'::jsonb
);

create table if not exists public.inventaires (
  id text primary key, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  site text not null default 'Chamonix', data jsonb not null default '{}'::jsonb
);

create table if not exists public.caisse (
  id text primary key, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  site text not null default 'Chamonix', data jsonb not null default '{}'::jsonb
);

create table if not exists public.ventes (
  id text primary key, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  site text not null default 'Chamonix', data jsonb not null default '{}'::jsonb
);

create table if not exists public.periodes (
  id text primary key, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  site text not null default 'Chamonix', data jsonb not null default '{}'::jsonb
);

create table if not exists public.sessions (
  id text primary key, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  site text not null default 'Chamonix', data jsonb not null default '[]'::jsonb
);

create table if not exists public.carnet_releve (
  id text primary key, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  site text not null default 'Chamonix', data jsonb not null default '[]'::jsonb
);

create table if not exists public.journal (
  id text primary key, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  site text not null default 'Chamonix', data jsonb not null default '[]'::jsonb
);

create table if not exists public.feedback (
  id text primary key, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  site text not null default 'Chamonix', data jsonb not null default '[]'::jsonb
);

-- Référentiels facultatifs, utiles dès qu'il y aura plusieurs boutiques
create table if not exists public.sites (
  id text primary key, created_at timestamptz not null default now(),
  nom text not null, fuseau text not null default 'Europe/Paris',
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.employes (
  id text primary key, created_at timestamptz not null default now(),
  site text not null default 'Chamonix',
  prenom text not null, role text not null default 'equipe',
  actif boolean not null default true, data jsonb not null default '{}'::jsonb
);

insert into public.sites (id, nom) values ('chamonix', 'Chamonix')
  on conflict (id) do nothing;

insert into public.employes (id, prenom, role) values
  ('e1','Marianna','equipe'), ('e2','Samara','equipe'),
  ('e3','Kenza','equipe'),    ('e4','Eve','manager')
  on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 2. HORODATAGE AUTOMATIQUE
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'releves_temperature','taches_nettoyage','reassort','ruptures','pertes','lots',
    'inventaires','caisse','ventes','periodes','sessions','carnet_releve','journal','feedback'
  ] loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$I', t);
    execute format(
      'create trigger trg_touch_%1$s before update on public.%1$I
       for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 3. INDEX
-- text_pattern_ops : indispensable pour les recherches par préfixe (id LIKE 'temp:%')
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'releves_temperature','taches_nettoyage','reassort','ruptures','pertes','lots',
    'inventaires','caisse','ventes','periodes','sessions','carnet_releve','journal','feedback'
  ] loop
    execute format('create index if not exists idx_%1$s_prefixe on public.%1$I (id text_pattern_ops)', t);
    execute format('create index if not exists idx_%1$s_site    on public.%1$I (site)', t);
    execute format('create index if not exists idx_%1$s_date    on public.%1$I (created_at desc)', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 4. RLS — DÉSACTIVÉE POUR LA BÊTA
-- Avec la clé anon publiée dans le navigateur, ces tables sont lisibles et
-- modifiables par quiconque connaît l'URL du projet. Voir le bloc 5.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'releves_temperature','taches_nettoyage','reassort','ruptures','pertes','lots',
    'inventaires','caisse','ventes','periodes','sessions','carnet_releve','journal',
    'feedback','sites','employes'
  ] loop
    execute format('alter table public.%1$I disable row level security', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 5. DURCISSEMENT — à exécuter avant toute mise en production
-- Réactive RLS et n'autorise que les utilisateurs authentifiés Supabase.
-- Décommenter le jour où l'authentification remplace les PIN locaux.
-- -----------------------------------------------------------------------------
-- do $$
-- declare t text;
-- begin
--   foreach t in array array[
--     'releves_temperature','taches_nettoyage','reassort','ruptures','pertes','lots',
--     'inventaires','caisse','ventes','periodes','sessions','carnet_releve','journal',
--     'feedback','sites','employes'
--   ] loop
--     execute format('alter table public.%1$I enable row level security', t);
--     execute format('drop policy if exists p_lecture_%1$s on public.%1$I', t);
--     execute format('drop policy if exists p_ecriture_%1$s on public.%1$I', t);
--     execute format(
--       'create policy p_lecture_%1$s on public.%1$I
--        for select to authenticated using (true)', t);
--     execute format(
--       'create policy p_ecriture_%1$s on public.%1$I
--        for all to authenticated using (true) with check (true)', t);
--   end loop;
-- end $$;

-- -----------------------------------------------------------------------------
-- 6. PURGE DU JOURNAL — le fil d'activité n'a pas vocation à être éternel
-- -----------------------------------------------------------------------------
create or replace function public.purger_journal(jours int default 180)
returns int language plpgsql as $$
declare n int;
begin
  delete from public.journal where created_at < now() - (jours || ' days')::interval;
  get diagnostics n = row_count;
  return n;
end $$;
