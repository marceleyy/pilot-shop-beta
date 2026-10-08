-- =============================================================================
-- PILOT-SHOP — durées de conservation (RGPD)
--
-- Aujourd'hui, rien n'est jamais effacé de la base : heures pointées, journal
-- d'activité, retours libres, photos de preuve restent indéfiniment. Le RGPD
-- demande une durée limitée et connue. Ce script efface automatiquement, chaque
-- nuit, ce qui dépasse la durée choisie, dans la BASE. Côté iPads (aucun bloc
-- à lancer pour cela, c'est l'application) : la copie locale d'une journée de
-- plus de 120 jours est effacée dès que la base confirme avoir la ligne ; en
-- mode local, sans base, l'application applique au journal et aux heures
-- pointées les durées ci-dessous.
--
-- DURÉES PROPOSÉES, À VALIDER AVEC LA BOUTIQUE (c'est elle qui décide) :
--   pointage (sessions)            3 ans  (salaires prescrits par 3 ans ; 1 an minimum pour l'inspection du travail)
--   journal d'activité (journal)   1 an
--   photos de preuve (preuves)     1 an   (couvre les tâches annuelles)
--   retours et anomalies résolues  1 an
--   messages de passation          1 an
-- Les registres sanitaires (températures, nettoyage, lots, réception…) ne
-- sont pas touchés : ils relèvent du plan HACCP de la boutique.
--
-- Rien n'est appliqué tant que vous ne lancez pas les blocs, UN PAR UN, dans
-- le SQL Editor. À lancer APRÈS supabase-multi-boutiques.sql (bloc 5 compris).
-- =============================================================================


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ BLOC 1 — LA FONCTION DE PURGE                                            ║
-- ║ Crée la fonction, n'efface rien. Changez les durées ici si la boutique   ║
-- ║ en a choisi d'autres.                                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

/* Date portée par la clé (« pointage:2026-10-05 »), ou null. */
create or replace function public._pilotshop_jour_cle(id text)
returns date
language plpgsql
immutable
as $$
begin
  return substring(id from '(\d{4}-\d{2}-\d{2})$')::date;
exception when others then
  return null;
end;
$$;
revoke all on function public._pilotshop_jour_cle(text) from public, anon, authenticated;

/* Un élément de liste est-il périmé ? Ne lève jamais d'erreur. */
create or replace function public._pilotshop_perime(e jsonb, cle text, limite date)
returns boolean
language sql
immutable
as $$
  select case
    when jsonb_typeof(e) <> 'object' then false
    when e->'epingle' = 'true'::jsonb then false
    when cle = 'anomalies' and e->'resolue' is distinct from 'true'::jsonb then false
    else coalesce((
      select public._pilotshop_jour_cle(left(v, 10)) < limite
        from (select case when cle = 'anomalies' and e->>'resolueAt' ~ '^\d{4}-\d{2}-\d{2}'
                          then e->>'resolueAt'
                          when e->>'jour' ~ '^\d{4}-\d{2}-\d{2}' then e->>'jour'
                          when e->>'at'   ~ '^\d{4}-\d{2}-\d{2}' then e->>'at'
                     end as v) d
       where v is not null), false)
  end
$$;
revoke all on function public._pilotshop_perime(jsonb, text, date) from public, anon, authenticated;

create or replace function public.purger_donnees_anciennes()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d_pointage constant date := current_date - interval '3 years';
  d_un_an    constant date := current_date - interval '1 year';
begin
  /* Lignes datées par leur clé : « pointage:2026-10-05 », « feed:… », « preuves:… ». */
  delete from public.sessions
   where public._pilotshop_jour_cle(id) < d_pointage;
  delete from public.journal
   where public._pilotshop_jour_cle(id) < d_un_an;
  delete from public.preuves
   where public._pilotshop_jour_cle(id) < d_un_an;

  /* Listes stockées dans une seule ligne : on retire les éléments anciens.
     Une anomalie non résolue et un message épinglé restent, quel que soit
     leur âge. Une anomalie résolue compte à partir de sa résolution. Une
     date absente ou d'un autre format : l'élément reste (jamais d'erreur,
     sinon toute la purge de la nuit serait annulée). Les lignes sans rien à
     retirer ne sont pas réécrites. Même règle dans l'application (rognerAncien). */
  update public.feedback f
     set data = coalesce((
           select jsonb_agg(x.e order by x.n)
             from jsonb_array_elements(f.data) with ordinality as x(e, n)
            where not public._pilotshop_perime(x.e, f.id, d_un_an)
         ), '[]'::jsonb)
   where f.id in ('feedback', 'anomalies')
     and jsonb_typeof(f.data) = 'array'
     and exists (select 1 from jsonb_array_elements(f.data) e
                  where public._pilotshop_perime(e, f.id, d_un_an));

  update public.carnet_releve r
     set data = coalesce((
           select jsonb_agg(x.e order by x.n)
             from jsonb_array_elements(r.data) with ordinality as x(e, n)
            where not public._pilotshop_perime(x.e, r.id, d_un_an)
         ), '[]'::jsonb)
   where jsonb_typeof(r.data) = 'array'
     and exists (select 1 from jsonb_array_elements(r.data) e
                  where public._pilotshop_perime(e, r.id, d_un_an));
end;
$$;

/* Personne d'autre que l'administrateur ne peut l'appeler. */
revoke all on function public.purger_donnees_anciennes() from public, anon, authenticated;

-- Attendu : trois lignes, le nombre de jours qui seraient effacés aujourd'hui
-- (cette requête ne modifie rien). Une table absente
-- fait échouer cette requête : corrigez avant le bloc 2.
select 'sessions' as table_, count(*) as lignes_effacees
  from public.sessions
 where public._pilotshop_jour_cle(id) < current_date - interval '3 years'
union all
select 'journal', count(*) from public.journal
 where public._pilotshop_jour_cle(id) < current_date - interval '1 year'
union all
select 'preuves', count(*) from public.preuves
 where public._pilotshop_jour_cle(id) < current_date - interval '1 year';
--
-- Test à la main (efface réellement) : select public.purger_donnees_anciennes();



-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ BLOC 2 — CHAQUE NUIT À 3 H                                               ║
-- ║ Avant : Database → Extensions → activer « pg_cron ».                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

select cron.schedule('pilotshop-conservation', '0 3 * * *',
                     'select public.purger_donnees_anciennes()');

-- Vérifier : select jobname, schedule, active from cron.job;
-- Arrêter   : select cron.unschedule('pilotshop-conservation');



-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ BLOC 3 — PLUS TARD : EFFACER LA SAUVEGARDE DE LA MIGRATION               ║
-- ║ Seulement quand le bloc 5 de supabase-multi-boutiques.sql tourne depuis  ║
-- ║ quelques jours sans problème. Cette copie contient toute la base et les  ║
-- ║ adresses des comptes : elle ne doit pas rester indéfiniment.             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- drop schema sauvegarde_20260930 cascade;
