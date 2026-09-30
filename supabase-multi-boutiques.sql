-- =============================================================================
-- PILOT-SHOP — une base, plusieurs boutiques
--
-- Aujourd'hui, la politique p_appli laisse TOUT compte authentifié lire et
-- écrire TOUTES les lignes. Avec une seule boutique, c'était acceptable. Dès
-- la deuxième, la boutique A lirait les relevés de la boutique B. Et si
-- l'inscription publique est ouverte dans Supabase, n'importe qui peut se
-- créer un compte et tout lire.
--
-- Après ce script, chaque compte ne voit que les lignes de SA boutique. La
-- boutique d'un compte est inscrite dans son app_metadata, que seul
-- l'administrateur peut modifier (le compte lui-même ne peut pas la changer).
--
-- Cinq blocs. Lancez-les UN PAR UN, dans l'ordre, dans le SQL Editor, en
-- lisant le résultat de chacun. De préférence après la fermeture : les iPads
-- doivent renouveler leur jeton pour voir la boutique (c'est automatique au
-- prochain démarrage de l'application, ou au plus tard sous une heure).
--
-- AVANT TOUT : faites une sauvegarde (Database → Backups), et dans
-- Authentication → Sign In / Providers, désactivez « Allow new users to
-- sign up ». Les comptes de boutique se créent à la main, jamais seuls.
-- =============================================================================


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ BLOC 1 — ÉTAT ACTUEL                                                     ║
-- ║ Ne modifie rien. Notez le résultat : c'est le point de comparaison.      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

select c.relname                                             as "table",
       c.relrowsecurity                                      as "rls_active",
       exists (select 1 from information_schema.columns col
               where col.table_schema = 'public' and col.table_name = c.relname
                 and col.column_name = 'site')               as "a_colonne_site",
       (select string_agg(a.attname, ', ' order by a.attnum)
          from pg_constraint k
          join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
         where k.conrelid = c.oid and k.contype = 'p')       as "cle_primaire",
       has_table_privilege('anon', c.oid, 'SELECT')          as "anon_peut_lire"
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

-- Les noms de boutique déjà présents dans les données. Attendu : « Paccard »
-- seul. Un autre nom (ancienne version de l'application) deviendrait
-- invisible après le bloc 5 : signalez-le avant d'aller plus loin.
select c.relname as "table",
       (xpath('/row/s/text()',
              query_to_xml(format('select string_agg(distinct site::text, '', '') as s from public.%I',
                                  c.relname), false, true, '')))[1]::text as "sites_presents"
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and exists (select 1 from information_schema.columns col
              where col.table_schema = 'public' and col.table_name = c.relname
                and col.column_name = 'site')
order by c.relname;

-- Et les comptes existants, avec la boutique qui leur est (ou non) attribuée :
select email, raw_app_meta_data ->> 'site' as site_app, raw_user_meta_data ->> 'site' as site_user
from auth.users order by email;



-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ BLOC 2 — ATTRIBUER SA BOUTIQUE À CHAQUE COMPTE                           ║
-- ║ À faire AVANT le bloc 5 : un compte sans boutique ne verra plus rien.    ║
-- ║ Remplacez l'adresse par celle du compte Paccard vue au bloc 1.           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                           || jsonb_build_object('site', 'Paccard')
 where email = 'paccard@pilot-shop.local';

-- Attendu : « UPDATE 1 ». Si c'est « UPDATE 0 », l'adresse est fausse :
-- corrigez-la avant de continuer.
-- Pour une nouvelle boutique : créez son compte (Authentication → Users →
-- Add user), puis relancez ce bloc avec son adresse et son nom de site.



-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ BLOC 3 — LA FONCTION QUI DIT « QUELLE BOUTIQUE ? »                       ║
-- ║ Lit la boutique dans le jeton de l'appareil connecté.                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public.site_courant()
returns text
language sql
stable
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'site', '')
$$;

revoke all on function public.site_courant() from public, anon;
grant execute on function public.site_courant() to authenticated;

-- Attendu : « Success. No rows returned ».



-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ BLOC 4 — UNE COLONNE « site » PARTOUT, ET UNE CLÉ PAR BOUTIQUE           ║
-- ║ Les lignes existantes sont rattachées à Paccard. La clé primaire passe   ║
-- ║ de (id) à (site, id) : deux boutiques peuvent alors avoir chacune leur   ║
-- ║ « temp:2026-10-01 » sans s'écraser l'une l'autre.                        ║
-- ║ L'application n'a rien à changer : elle envoie déjà site et id.          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

do $$
declare
  site_initial constant text := 'Paccard';
  t          record;
  v_nom_pk   name;
  v_cols_pk  name[];
begin
  for t in
    select c.oid, c.relname as nom
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = t.nom
                     and column_name = 'site') then
      execute format('alter table public.%I add column site text', t.nom);
    end if;

    execute format('update public.%I set site = %L where site is null', t.nom, site_initial);
    execute format('alter table public.%I alter column site set default public.site_courant()', t.nom);
    execute format('alter table public.%I alter column site set not null', t.nom);

    /* Clé primaire : on ne touche qu'aux tables dont la clé est exactement (id). */
    v_nom_pk := null; v_cols_pk := null;
    select k.conname, array_agg(a.attname order by a.attnum)
      into v_nom_pk, v_cols_pk
      from pg_constraint k
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
     where k.conrelid = t.oid and k.contype = 'p'
     group by k.conname;

    if v_nom_pk is not null and v_cols_pk = array['id']::name[] then
      execute format('alter table public.%I drop constraint %I', t.nom, v_nom_pk);
      execute format('alter table public.%I add primary key (site, id)', t.nom);
    end if;
  end loop;
end $$;

-- Attendu : « Success. No rows returned ».
-- Si une erreur apparaît (par exemple une clé étrangère qui dépend de « id »),
-- copiez-la et arrêtez-vous là : le bloc entier est annulé, rien n'est cassé.



-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ BLOC 5 — CHAQUE COMPTE NE VOIT QUE SA BOUTIQUE                           ║
-- ║ Remplace la politique p_appli (« tout compte voit tout »).               ║
-- ║ Ne le lancez que si les blocs 2 à 4 se sont terminés sans erreur.        ║
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
    execute format('drop policy if exists p_site on public.%I', t.nom);
    execute format(
      'create policy p_site on public.%I for all to authenticated '
      'using (site = public.site_courant()) with check (site = public.site_courant())',
      t.nom);
  end loop;
end $$;

/* Le rôle anonyme n'a rien, même si supabase-fermer-faille.sql n'a pas été
   lancé jusqu'au bout. Sans effet s'il l'a été. */
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

notify pgrst, 'reload schema';

-- Puis relancez le BLOC 1. Attendu : rls_active = true, a_colonne_site = true,
-- anon_peut_lire = false partout ; cle_primaire = « id, site » là où elle
-- était « id » ; site_app = Paccard pour le compte de la boutique.
--
-- Nouvelle table plus tard : relancez les blocs 4 et 5, ils sont rejouables.
