-- =============================================================================
-- PILOT-SHOP — correctif à exécuter après supabase.sql
-- Deux problèmes constatés dans les logs :
--   1. GET 200 mais POST 401  → le rôle anon n'a pas le droit d'écrire
--   2. GET /rest/v1/undefined → cinq tables manquaient
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TABLES MANQUANTES
-- Introduites par les modules « réunion d'équipe » : check-listes officielles,
-- photos de preuve, stock fermé, réceptions et réglages du back-office.
-- -----------------------------------------------------------------------------
create table if not exists public.checklists (
  id text primary key, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  site text not null default 'Chamonix', data jsonb not null default '{}'::jsonb
);

create table if not exists public.preuves (
  id text primary key, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  site text not null default 'Chamonix', data jsonb not null default '[]'::jsonb
);

create table if not exists public.stock (
  id text primary key, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  site text not null default 'Chamonix', data jsonb not null default '[]'::jsonb
);

create table if not exists public.receptions (
  id text primary key, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  site text not null default 'Chamonix', data jsonb not null default '[]'::jsonb
);

create table if not exists public.reglages (
  id text primary key, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  site text not null default 'Chamonix', data jsonb not null default '{}'::jsonb
);

-- Triggers et index, comme les autres tables
do $$
declare t text;
begin
  foreach t in array array['checklists','preuves','stock','receptions','reglages'] loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$I', t);
    execute format(
      'create trigger trg_touch_%1$s before update on public.%1$I
       for each row execute function public.touch_updated_at()', t);
    execute format('create index if not exists idx_%1$s_prefixe on public.%1$I (id text_pattern_ops)', t);
    execute format('create index if not exists idx_%1$s_date on public.%1$I (created_at desc)', t);
    execute format('alter table public.%1$I disable row level security', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 2. DROITS D'ÉCRITURE
-- Désactiver RLS ne suffit pas : PostgREST exige en plus des GRANT sur la table.
-- Les tables créées depuis l'éditeur SQL n'héritent pas toujours des privilèges
-- par défaut, d'où des lectures qui passent et des écritures refusées en 401.
-- -----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete
  on all tables in schema public
  to anon, authenticated;

grant usage, select on all sequences in schema public to anon, authenticated;

-- Pour les tables qui seront créées plus tard
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. RAFRAÎCHIR LE CACHE DE SCHÉMA
-- Sans cela, l'API continue d'ignorer les tables fraîchement créées.
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- 4. VÉRIFICATION
-- Doit renvoyer 21 lignes, toutes avec insert = true.
-- -----------------------------------------------------------------------------
select
  c.relname as table_name,
  has_table_privilege('anon', c.oid, 'SELECT') as lecture,
  has_table_privilege('anon', c.oid, 'INSERT') as insertion,
  has_table_privilege('anon', c.oid, 'UPDATE') as modification,
  c.relrowsecurity as rls_active
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;
