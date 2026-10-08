-- =============================================================================
-- PILOT-SHOP — l'équipe ne se perd plus entre deux iPads (version 3.2.1)
--
-- Depuis la 3.2.1, l'application n'écrit la ligne « equipe » de la table
-- reglages que si sa colonne updated_at n'a pas changé depuis la lecture :
-- deux managers qui modifient l'équipe en même temps ne s'écrasent plus.
-- Il faut donc que updated_at change à CHAQUE modification de la ligne, et
-- c'est le déclencheur ci-dessous qui s'en charge. Sans lui, la protection ne
-- joue plus, et aucune erreur ne le signale.
--
-- RIEN À LANCER SUR LA BASE ACTUELLE : la colonne et le déclencheur y sont
-- déjà, comme sur les autres tables (vérifié le 08/10/2026). Ce fichier les
-- documente et les recrée sur une base neuve. Le relancer est sans danger.
-- =============================================================================

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

alter table public.reglages
  add column if not exists updated_at timestamptz not null default now();

create or replace trigger trg_touch_reglages
  before update on public.reglages
  for each row execute function public.touch_updated_at();

-- Vérification : une ligne, tgenabled = O.
select tgname, tgenabled from pg_trigger
where tgrelid = 'public.reglages'::regclass and not tgisinternal;
