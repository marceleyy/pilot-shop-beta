-- =============================================================================
-- PILOT-SHOP — table du stock réel
-- À exécuter dans le SQL Editor de Supabase, après supabase-patch.sql.
--
-- Le stock repose sur trois clés seulement :
--   stock:mouvements  — journal en ajout seul (réceptions, ouvertures, pertes)
--   stock:inventaire  — le dernier comptage, qui fixe la référence
--   stock:inventaires — l'historique des comptages, pour comparer d'un mois
--                       sur l'autre
-- Les deux premières sont routées vers la table « stock » qui existe déjà ;
-- la troisième a besoin de sa propre table.
-- =============================================================================

create table if not exists public.inventaires_stock (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  site text not null default 'Paccard',
  data jsonb not null default '{}'::jsonb
);

drop trigger if exists trg_touch_inventaires_stock on public.inventaires_stock;
create trigger trg_touch_inventaires_stock
  before update on public.inventaires_stock
  for each row execute function public.touch_updated_at();

create index if not exists idx_inventaires_stock_prefixe
  on public.inventaires_stock (id text_pattern_ops);
create index if not exists idx_inventaires_stock_date
  on public.inventaires_stock (created_at desc);

alter table public.inventaires_stock disable row level security;

grant select, insert, update, delete
  on public.inventaires_stock to anon, authenticated;

notify pgrst, 'reload schema';

-- Vérification : la table doit apparaître avec insertion = true
select c.relname,
       has_table_privilege('anon', c.oid, 'INSERT') as insertion,
       c.relrowsecurity as rls_active
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'inventaires_stock';
