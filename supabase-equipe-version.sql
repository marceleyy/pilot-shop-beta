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
-- documente et les recrée sur une base neuve. Le relancer est sans danger :
-- la fonction, partagée avec les déclencheurs des autres tables, n'est créée
-- que si elle manque (« create or replace » effacerait un réglage ajouté
-- depuis, comme search_path), et l'ALTER TABLE renonce au bout de 2 s au lieu
-- de bloquer les lectures de reglages derrière une transaction en cours.
-- =============================================================================

begin;
set local lock_timeout = '2s';

do $$
begin
  if to_regprocedure('public.touch_updated_at()') is null then
    create function public.touch_updated_at()
    returns trigger language plpgsql as $f$
begin new.updated_at = now(); return new; end $f$;
  end if;
end $$;

alter table public.reglages
  add column if not exists updated_at timestamptz not null default now();

create or replace trigger trg_touch_reglages
  before update on public.reglages
  for each row execute function public.touch_updated_at();

commit;

-- Vérification : une ligne, tgenabled = O, « BEFORE UPDATE … FOR EACH ROW ».
select tgname, tgenabled, pg_get_triggerdef(oid) as definition from pg_trigger
where tgrelid = 'public.reglages'::regclass and not tgisinternal;
