-- =============================================================================
-- PILOT-SHOP — REMISE À ZÉRO TOTALE
--
--   ⚠  CE SCRIPT EFFACE TOUTES LES DONNÉES MÉTIER, SANS RETOUR POSSIBLE.
--
-- À n'exécuter que pour repartir sur une base vierge avant un test.
-- Les tables et leur structure sont conservées, seul le contenu disparaît.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- À FAIRE AVANT : sauvegarder ce qui existe déjà.
-- Un registre sanitaire peut être réclamé lors d'un contrôle, y compris pour
-- une période antérieure. Effacer sans copie, c'est perdre la preuve.
--   Depuis l'application : Réglages → Exporter toutes les données.
--   Depuis Supabase     : Database → Backups, ou un export CSV par table.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 1. ÉTAT DES LIEUX — à exécuter SEUL d'abord, pour voir ce qui va disparaître
-- -----------------------------------------------------------------------------
select 'caisse' as table_name, count(*) from public.caisse
union all select 'carnet_releve',        count(*) from public.carnet_releve
union all select 'checklists',           count(*) from public.checklists
union all select 'feedback',             count(*) from public.feedback
union all select 'inventaires',          count(*) from public.inventaires
union all select 'journal',              count(*) from public.journal
union all select 'lots',                 count(*) from public.lots
union all select 'periodes',             count(*) from public.periodes
union all select 'pertes',               count(*) from public.pertes
union all select 'preuves',              count(*) from public.preuves
union all select 'reassort',             count(*) from public.reassort
union all select 'receptions',           count(*) from public.receptions
union all select 'reglages',             count(*) from public.reglages
union all select 'releves_temperature',  count(*) from public.releves_temperature
union all select 'ruptures',             count(*) from public.ruptures
union all select 'sessions',             count(*) from public.sessions
union all select 'stock',                count(*) from public.stock
union all select 'taches_nettoyage',     count(*) from public.taches_nettoyage
union all select 'ventes',               count(*) from public.ventes
order by 1;

-- -----------------------------------------------------------------------------
-- 2. REMISE À ZÉRO
-- restart identity remet les compteurs à zéro, cascade suit les clés étrangères.
-- -----------------------------------------------------------------------------
truncate table
  public.caisse,
  public.carnet_releve,
  public.checklists,
  public.feedback,
  public.inventaires,
  public.journal,
  public.lots,
  public.periodes,
  public.pertes,
  public.preuves,
  public.reassort,
  public.receptions,
  public.reglages,
  public.releves_temperature,
  public.ruptures,
  public.sessions,
  public.stock,
  public.taches_nettoyage,
  public.ventes
restart identity cascade;

-- -----------------------------------------------------------------------------
-- 3. RÉFÉRENTIELS — boutique Paccard et équipe de test
-- -----------------------------------------------------------------------------
truncate table public.employes, public.sites restart identity cascade;

insert into public.sites (id, nom) values ('paccard', 'Paccard');

insert into public.employes (id, prenom, role) values
  ('e1', 'Marianna', 'equipe'),
  ('e2', 'Samara',   'equipe'),
  ('e3', 'Kenza',    'equipe'),
  ('e4', 'Lucas',    'equipe'),
  ('e5', 'Eve',      'manager');

-- -----------------------------------------------------------------------------
-- 4. RAFRAÎCHIR LE CACHE DE SCHÉMA
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- 5. VÉRIFICATION — tout à 0, sauf sites (1) et employes (5)
-- -----------------------------------------------------------------------------
select 'caisse' as table_name, count(*) from public.caisse
union all select 'checklists',           count(*) from public.checklists
union all select 'journal',              count(*) from public.journal
union all select 'lots',                 count(*) from public.lots
union all select 'periodes',             count(*) from public.periodes
union all select 'releves_temperature',  count(*) from public.releves_temperature
union all select 'taches_nettoyage',     count(*) from public.taches_nettoyage
union all select 'sites',                count(*) from public.sites
union all select 'employes',             count(*) from public.employes
order by 1;

-- -----------------------------------------------------------------------------
-- 6. CÔTÉ IPAD — à ne pas oublier
-- Chaque appareil garde une copie locale complète. Vider la base sans vider les
-- iPad ferait remonter les anciennes données à la première synchronisation :
-- la base ne serait vierge que quelques secondes.
--
-- Sur chaque appareil : Réglages → Réinitialiser cet appareil.
-- Ou dans la console du navigateur :
--   Object.keys(localStorage).filter(k => k.startsWith('pilotshop.v3:'))
--     .forEach(k => localStorage.removeItem(k));
--   (await navigator.serviceWorker.getRegistrations()).forEach(r => r.unregister());
--   (await caches.keys()).forEach(c => caches.delete(c));
--   location.reload();
-- -----------------------------------------------------------------------------
