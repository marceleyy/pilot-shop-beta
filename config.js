/* =============================================================================
   PILOT-SHOP — config.js
   Toute la donnée de paramétrage. Aucun appel réseau, aucune logique d'UI.
   Un autre point de vente ne modifie que ce fichier.
   ============================================================================= */

'use strict';

/* -----------------------------------------------------------------------------
   1. APPLICATION
   -------------------------------------------------------------------------- */
const APP = {
  nom:        'Pilot-Shop',
  site:       'Paccard',
  version:    '3.1.0-beta',
  build:      '2026-09-12',
  locale:     'fr-FR',
  fuseau:     'Europe/Paris',
  devise:     'EUR',
  beta:       true          // affiche le bouton de retour flottant
};

/* -----------------------------------------------------------------------------
   2. BACKEND — Supabase
   Les clés sont injectées au build par Vercel (variables d'environnement).
   La clé anon est publique par nature : toute la sécurité repose sur les
   policies RLS côté Supabase, jamais sur ce fichier.
   -------------------------------------------------------------------------- */
const SUPABASE = {
  url:     (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__.SUPABASE_URL)      || '',
  anonKey: (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__.SUPABASE_ANON_KEY) || '',
  schema:  'public',
  tables: {
    sites:        'sites',
    employes:     'employes',
    sessions:     'sessions',        // pointeuse : début / fin de service
    temperatures: 'releves_temperature',
    nettoyage:    'taches_nettoyage',
    reassort:     'reassort',
    ruptures:     'ruptures',
    pertes:       'pertes',
    lots:         'lots',
    inventaires:  'inventaires',
    caisse:       'caisse',
    ventes:       'ventes',
    periodes:     'periodes',
    releve:       'carnet_releve',   // messages de passation
    feed:         'journal',
    /* Alias : du code référençait SUPABASE.tables.journal et .reglages, qui
       n'existaient pas. Résultat, des appels vers « /rest/v1/undefined » qui
       rallumaient le bandeau « Table introuvable » en boucle. Plutôt que de
       traquer chaque usage, on nomme les deux entrées manquantes. */
    journal:      'journal',
    reglages:     'reglages',
    feedback:     'feedback'
  },
  realtime: ['journal', 'ruptures', 'carnet_releve'],
  /* Colonnes de scoping multi-boutique — présentes sur chaque table */
  scope: { site: 'site_id', horodatage: 'created_at', auteur: 'employe_id' }
};

/* -----------------------------------------------------------------------------
   3. MODE HORS-LIGNE
   Le réseau tombe systématiquement dans la chambre froide et la réserve.
   Toute écriture part d'abord dans la file locale, puis se synchronise.
   -------------------------------------------------------------------------- */
const OFFLINE = {
  actif: true,
  storeLocal: 'pilotshop.v3',         // préfixe IndexedDB / fallback localStorage
  fileAttente: 'pilotshop.queue',
  tentatives: 5,                      // essais avant abandon d'une écriture
  backoffMs: [1000, 4000, 15000, 60000, 300000],
  intervalleSyncMs: 20000,
  purgeLocaleJours: 120,              // conservation du cache local
  /* Au-delà, l'écriture reste locale : c'est le cas des journées de photos en
     base64, dont l'envoi échouait en boucle et rallumait le bandeau d'erreur. */
  tailleMaxOctets: 900000,
  /* Les lectures servies depuis le cache si le réseau ne répond pas à temps.
     3,5 s était trop court : sur le Wi-Fi d'une boutique de montagne, une
     écriture dépassait régulièrement ce délai, partait en file d'attente, et
     l'application se déclarait hors ligne alors qu'elle ne l'était pas. */
  timeoutReseauMs: 8000,
  /* Écritures autorisées hors-ligne (les autres sont bloquées avec message) */
  ecrituresOffline: ['temperatures','nettoyage','reassort','ruptures','pertes','lots','caisse','releve','feed'],
  /* Résolution de conflit : la saisie terrain gagne, l'historique est conservé */
  strategieConflit: 'dernier-ecrivain-gagne-avec-trace'
};

const PWA = {
  nomCourt:      'Pilot-Shop',
  nomComplet:    'Pilot-Shop — Chamonix',
  description:   'Registres et pilotage du point de vente',
  display:       'standalone',
  orientation:   'any',              // l'iPad tourne pendant le rush
  themeColor:    '#0F2027',
  backgroundColor: '#F2F6F7',
  startUrl:      '/',
  scope:         '/',
  serviceWorker: '/sw.js',
  precache:      ['/', '/index.html', '/style.css', '/config.js', '/app.js'],
  /* Réveil visuel quand l'app repart après une coupure */
  bannerOffline: 'Hors ligne — vos saisies sont gardées et partiront toutes seules'
};

/* -----------------------------------------------------------------------------
   4. ÉQUIPE ET ACCÈS
   Les PIN ci-dessous ne sont qu'un fallback de démonstration hors-ligne.
   En production, l'authentification est faite par Supabase : ce tableau ne
   contient alors que id / prénom / rôle, et le champ pin reste vide.
   -------------------------------------------------------------------------- */
const ROLES = {
  equipe:  { label: 'Équipier', pages: ['accueil','temp','clean','reas','pertes','lots','inv','caisse','fiches','releve'] },
  manager: { label: 'Manager',  pages: ['controle','temp','clean','reas','pertes','lots','inv','caisse','fiches','releve','ecarts','periodes','histo','reglages'] }
};

/* L'équipe est chargée depuis la table « equipe » au démarrage, pour un appareil
   rattaché. Le tableau part vide : les codes PIN ne sont plus écrits dans le
   code source, où n'importe quel visiteur pouvait les lire. Sans rattachement,
   l'écran des prénoms reste vide et la base ne répond rien. */
let EQUIPE = [];
const POINTEUSE = {
  actif: true,
  etats: ['hors-service', 'en-service', 'pause'],
  /* Rappel si quelqu'un oublie de pointer la sortie */
  alerteOubliHeures: 12,
  /* Une session ouverte trop longtemps est clôturée d'office à cette heure */
  fermetureAutomatique: '23:59',
  arrondiMinutes: 5
};

/* -----------------------------------------------------------------------------
   5. DLC — durée de vie après ouverture
   Exprimée en HEURES pour gérer la chantilly au plus juste.
   -------------------------------------------------------------------------- */
/* Source : Fiche de traçabilité Amorino 2025, onglet CONSERVATION.
   Deux régimes selon la zone de stockage : négatif −13 °C ou positif 0/+4 °C. */
const DLC_RULES = {
  chantilly:            { h: 48,        label: 'Crème chantilly maison',     zone: 'positif' },
  gaufre:               { h: 10 * 24,   label: 'Gaufres −13 °C',             zone: 'negatif' },
  gelato:               { h: 10 * 24,   label: 'Gelati / sorbets −13 °C',    zone: 'negatif' },
  macaron_gelato:       { h: 10 * 24,   label: 'Macarons al gelato −13 °C',  zone: 'negatif' },
  gianduiotto:          { h: 10 * 24,   label: 'Gianduiotto al gelato',      zone: 'negatif' },
  macaron_traditionnel: { h: 90 * 24,   label: 'Macarons traditionnels −13 °C', zone: 'negatif' },
  macaron_trad_positif: { h: 3 * 24,    label: 'Macarons traditionnels 0/+4 °C', zone: 'positif' },
  crepe_negatif:        { h: 4 * 24,    label: 'Crêpes −13 °C',              zone: 'negatif' },
  lait:                 { h: 2 * 24,    label: 'Lait',                       zone: 'positif' },
  vegetal:              { h: 5 * 24,    label: 'Alternative végétale',       zone: 'positif' },
  /* Compléments repris des registres papier */
  brioche:              { h: 4 * 24,   label: 'Brioche',                    zone: 'ambiant' },
  crepe:                { h: 4 * 24,   label: 'Crêpes',                     zone: 'ambiant' },
  coulis:               { h: 5 * 24,   label: 'Coulis',                     zone: 'positif' },
  cake:                 { h: 8 * 24,   label: 'Cakes',                      zone: 'ambiant' },
  cookie:               { h: 7 * 24,   label: 'Cookies',                    zone: 'ambiant' },
  tarte:                { h: 5 * 24,   label: 'Tartes',                     zone: 'positif' },
  topping:              { h: 60 * 24,  label: 'Toppings',                   zone: 'ambiant' },
  defaut:               { h: 5 * 24,   label: 'Autre produit ouvert',       zone: 'ambiant' }
};

/* Seuils du frigo virtuel, en pourcentage de vie restante */
const DLC_SEUILS = {
  vert:   { min: 0.34, label: 'Conforme',      couleur: 'vert'   },
  orange: { min: 0.00, label: 'À vendre vite', couleur: 'orange' },
  rouge:  { min: -1,   label: 'Périmé',        couleur: 'rouge'  },
  /* La règle des 1/3 convient à un gelato de dix jours — 3,4 jours de préavis.
     Sur la chantilly, qui vit 48 h, elle ne prévient que 16 h à l'avance ; et
     comme la boutique ferme à 23 h pour rouvrir à 9 h 30, le préavis réel peut
     tomber à cinq heures. D'où un plancher, borné à la moitié de la durée de
     vie pour ne pas rendre orange un produit dès sa fabrication. */
  preavisMiniHeures: 24
};

/* Association produit → règle DLC. Le premier motif qui matche gagne. */
const DLC_MATCH = [
  { re: /chantilly|antilly/i,               regle: 'chantilly' },
  { re: /gaufre/i,                          regle: 'gaufre' },
  { re: /macaron.*(gelato|glac)/i,          regle: 'macaron_gelato' },
  { re: /macaron.*tradi|tradi.*macaron/i,   regle: 'macaron_traditionnel' },
  { re: /gianduiotto/i,                     regle: 'gianduiotto' },
  { re: /\blait\b/i,                        regle: 'lait' },
  { re: /avoine|amande|soja|v[eé]g[eé]tal/i, regle: 'vegetal' },
  { re: /brioche/i,                         regle: 'brioche' },
  { re: /cr(ê|e)pe/i,                       regle: 'crepe' },
  { re: /coulis/i,                          regle: 'coulis' },
  { re: /cake/i,                            regle: 'cake' },
  { re: /cookie/i,                          regle: 'cookie' },
  { re: /tarte|crostata|limone|nerina/i,    regle: 'tarte' },
  { re: /topping/i,                         regle: 'topping' }
];

/* -----------------------------------------------------------------------------
   6. ENCEINTES FROIDES
   vert = plage cible. crit = au-delà, dépassement de limite critique.
   pas = incrément des boutons tactiles (pas de clavier en plein rush).
   -------------------------------------------------------------------------- */
/* Modifiable depuis Réglages → Back-office. ENCEINTES_DEF sert de valeur d'usine.
   Configuration réelle de la boutique Paccard : six unités, pas dix. */
const ENCEINTES_DEF = [
  { id: 'cf',  nom: 'Chambre froide',              cible: '−18 °C', lo: -24, hi: -12, pas: 1, vert: [-20, -17], crit: -15, zone: 'reserve' },
  { id: 'ar1', nom: 'Armoire froide',              cible: '−13 °C', lo: -18, hi: -8,  pas: 1, vert: [-15, -11], crit: -10, zone: 'reserve' },
  { id: 'vg',  nom: 'Vitrine',                     cible: '−13 °C', lo: -18, hi: -8,  pas: 1, vert: [-15, -11], crit: -10, zone: 'boutique' },
  { id: 'pc',  nom: 'Congélateur crêpes / gaufres', cible: '−18 °C', lo: -24, hi: -12, pas: 1, vert: [-20, -17], crit: -15, zone: 'boutique' },
  { id: 'fp1', nom: 'Frigo positif',               cible: '+3 °C',  lo: -2,  hi: 8,   pas: 1, vert: [0, 3],     crit: 5,   zone: 'boutique' },
  { id: 'ch',  nom: 'Machine à chantilly',         cible: '+4 °C',  lo: -2,  hi: 8,   pas: 1, vert: [0, 4],     crit: 6,   zone: 'boutique' }
];
let ENCEINTES = ENCEINTES_DEF.map(e => Object.assign({}, e));

const RELEVES = {
  moments: [
    { id: 'm', label: 'Matin', phase: 'ouverture', avant: '11:00' },
    { id: 's', label: 'Soir',  phase: 'fermeture', apres: '18:00' }
  ],
  actionCorrectiveObligatoire: true   // bloque la validation si un relevé est critique
};

/* -----------------------------------------------------------------------------
   7. NETTOYAGE — structuré par jour de semaine
   jours : 1 = lundi … 7 = dimanche.
   Une tâche sans clé "jours" est quotidienne.
   -------------------------------------------------------------------------- */
const JOURS_SEMAINE = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

const NETTOYAGE = {
  zones: [
    {
      id: 'boutique', nom: 'Boutique', icone: '🏪',
      taches: [
        { id: 'b01', nom: 'Machine à chantilly',              phase: 'fermeture' },
        { id: 'b02', nom: 'Machine à frappé',                 phase: 'fermeture' },
        { id: 'b03', nom: 'Machine à café',                   phase: 'fermeture' },
        { id: 'b04', nom: 'Évier boutique',                   phase: 'fermeture' },
        { id: 'b05', nom: 'Plan de travail et comptoir',      phase: 'service' },
        { id: 'b06', nom: 'Vitrine gelato',                   phase: 'fermeture', jours: [1] },
        { id: 'b07', nom: 'Vitrine sorbet',                   phase: 'fermeture', jours: [1] },
        { id: 'b08', nom: 'Frigo sous comptoir 1',            phase: 'fermeture', jours: [2] },
        { id: 'b09', nom: 'Frigo sous comptoir 2',            phase: 'fermeture', jours: [3] },
        { id: 'b10', nom: 'Frigo sous comptoir 3',            phase: 'fermeture', jours: [4] },
        { id: 'b11', nom: 'Machine à chantilly — démontage complet', phase: 'fermeture', jours: [3] },
        { id: 'b12', nom: 'Machine à gaufres',                phase: 'fermeture', jours: [5] },
        { id: 'b13', nom: 'Crêpière',                         phase: 'fermeture', jours: [5] },
        { id: 'b14', nom: 'Bain-marie',                       phase: 'fermeture', jours: [2] },
        { id: 'b15', nom: 'Distributeurs cuillères et cornets', phase: 'ouverture', jours: [4] },
        { id: 'b16', nom: 'Affichage et ardoises',            phase: 'ouverture', jours: [6] },
        { id: 'b17', nom: 'Placards haut et bas',             phase: 'fermeture', jours: [7] },
        { id: 'b18', nom: 'Étagères et surfaces bois',        phase: 'fermeture', jours: [7] },
        { id: 'b19', nom: 'Meuble caisse',                    phase: 'fermeture', jours: [6] },
        { id: 'b20', nom: 'Vitrine exposition',               phase: 'ouverture', jours: [1] },
        { id: 'b21', nom: 'Tables et assises',                phase: 'service' },
        { id: 'b22', nom: 'Poubelles boutique',               phase: 'fermeture' },
        { id: 'b23', nom: 'Sol boutique',                     phase: 'fermeture' }
      ]
    },
    {
      id: 'arriere', nom: 'Arrière-boutique et réserve', icone: '📦',
      taches: [
        { id: 'a01', nom: 'Évier arrière',                    phase: 'fermeture' },
        { id: 'a02', nom: 'Plonge et égouttoir',              phase: 'fermeture' },
        { id: 'a03', nom: 'Murs et crédences',                phase: 'fermeture', jours: [3] },
        { id: 'a04', nom: 'Toilettes personnel',              phase: 'fermeture' },
        { id: 'a05', nom: 'Vestiaires',                       phase: 'fermeture', jours: [5] },
        { id: 'a06', nom: 'Poubelles et local déchets',       phase: 'fermeture' },
        { id: 'a07', nom: 'Étagères réserve',                 phase: 'fermeture', jours: [2] },
        { id: 'a08', nom: 'Armoire froide 1',                 phase: 'fermeture', mensuel: true },
        { id: 'a09', nom: 'Armoire froide 2',                 phase: 'fermeture', mensuel: true },
        { id: 'a10', nom: 'Armoire froide 3',                 phase: 'fermeture', mensuel: true },
        { id: 'a11', nom: 'Filtre clim et extracteur',        phase: 'fermeture', mensuel: true },
        { id: 'a12', nom: 'Chambre froide — décontamination', phase: 'fermeture', annuel: true },
        { id: 'a13', nom: 'Sol réserve',                      phase: 'fermeture' }
      ]
    },
    {
      id: 'exterieur', nom: 'Extérieur', icone: '🌤️',
      taches: [
        { id: 'x01', nom: 'Façade et porte vitrée',           phase: 'ouverture' },
        { id: 'x02', nom: 'Enseigne et lambrequin',           phase: 'ouverture', jours: [1] },
        { id: 'x03', nom: 'Stoppeur et affichage extérieur',  phase: 'ouverture' },
        { id: 'x04', nom: 'Terrasse — tables et chaises',     phase: 'ouverture' },
        { id: 'x05', nom: 'Poubelles extérieures',            phase: 'fermeture' }
      ]
    }
  ],

  /* Tâches asynchrones : leur récurrence ne suit pas le calendrier des zones */
  asynchrones: [
    {
      id: 'lavettes',
      nom: 'Lavettes — lavage et rotation',
      icone: '🧽',
      type: 'jours-fixes',
      jours: [2, 5, 7],                    // mardi, vendredi, dimanche
      phase: 'fermeture',
      consigne: 'Machine à 60 °C, séchage complet avant remise en service. Lavettes rouges pour les sanitaires uniquement.',
      alerteSiRate: true
    },
    {
      id: 'biberons_topping',
      nom: 'Biberons topping — vidage et désinfection',
      icone: '🍯',
      type: 'intervalle',
      intervalleJours: 5,                  // tous les 5 jours, glissant
      phase: 'fermeture',
      consigne: 'Vider, laver à l’eau chaude savonneuse, désinfecter au Bactalim 1 %, rincer, sécher tête en bas.',
      alerteSiRate: true
    }
  ],

  /* Validation en un clic : pas de saisie de prénom, la session fait foi */
  validationRapide: true,
  tracerAuteur: true
};

/* -----------------------------------------------------------------------------
   8. RÉASSORT — sec et surgelé, groupés par section
   -------------------------------------------------------------------------- */
const REASSORT = [
  /* --- SEC : ce qui se recharge depuis la réserve ---
     Les intitulés reprennent ceux de l'inventaire : même vocabulaire des deux
     côtés, sinon on ne retrouve pas le produit qu'on vient de signaler. */
  { id: 'r01', cat: 'Sec', nom: 'Cornets',                detail: 'bambino, piccolo, classico, grande', unite: 'sachet' },
  { id: 'r02', cat: 'Sec', nom: 'Choco-cônes',            detail: 'toutes tailles', unite: 'sachet' },
  { id: 'r03', cat: 'Sec', nom: 'Cornets sans gluten',    unite: 'sachet' },
  { id: 'r04', cat: 'Sec', nom: 'Papier protège-cornet',  detail: 'moyen et grand', unite: 'paquet' },
  { id: 'r05', cat: 'Sec', nom: 'Pots',                   detail: 'piccolo à grandissimo', unite: 'pile' },
  { id: 'r06', cat: 'Sec', nom: 'Couvercles',             detail: 'couteau, cuillère, fourchette', unite: 'pile' },
  { id: 'r07', cat: 'Sec', nom: 'Cuillères à glace',      detail: '2 sachets', unite: 'sachet' },
  { id: 'r08', cat: 'Sec', nom: 'Serviettes',             detail: '4 paquets', unite: 'paquet' },
  { id: 'r09', cat: 'Sec', nom: 'Barquettes à crêpe',     unite: 'paquet' },
  { id: 'r10', cat: 'Sec', nom: 'Gobelets',               detail: '4 tailles', unite: 'pile' },
  { id: 'r11', cat: 'Sec', nom: 'Capsules à café',        detail: 'simple, double, décaféiné', unite: 'boîte' },
  { id: 'r12', cat: 'Sec', nom: 'Chocolat chaud',         detail: '10 parfums', unite: 'boîte' },
  { id: 'r13', cat: 'Sec', nom: 'Toppings',               detail: 'pistache, noisette, caramel, café', unite: 'pot' },
  { id: 'r14', cat: 'Sec', nom: 'Coulis',                 detail: 'gianduja, chocolat noir, caramel, pistache', unite: 'flacon' },
  { id: 'r15', cat: 'Sec', nom: 'Éclats de caramel',      unite: 'pot' },
  { id: 'r16', cat: 'Sec', nom: 'Mocca beans',            unite: 'boîte' },
  { id: 'r17', cat: 'Sec', nom: 'Lait',                   unite: 'brique' },
  { id: 'r18', cat: 'Sec', nom: 'Crème pour chantilly',   unite: 'brique' },
  { id: 'r19', cat: 'Sec', nom: 'Boissons',               detail: 'coca, Evian 50 cl et 1 L…', unite: 'pack' },
  { id: 'r20', cat: 'Sec', nom: 'Pailles',                unite: 'paquet' },
  { id: 'r21', cat: 'Sec', nom: 'Papier TPE',             unite: 'rouleau' },
  { id: 'r22', cat: 'Sec', nom: 'Sopalin',                detail: '1 rouleau', unite: 'rouleau' },
  { id: 'r23', cat: 'Sec', nom: 'Lavettes',               detail: 'rose, jaune, bleue, verte', unite: 'paquet' },

  /* --- SURGELÉ : ce qui remonte de la chambre froide ---
     Macarons et gianduiotti relevés sur amorino.com. Le bon de livraison
     Jetfreeze distingue deux gammes de macarons : Classico (8×10 pièces) et
     Grandioso (4×6), avec des parfums différents pour chacune. */
  { id: 'r30', cat: 'Surgelé', nom: 'Glaces pour la journée', unite: 'bac' },
  { id: 'r31', cat: 'Surgelé', nom: 'Macarons Classico',      detail: '10 parfums', unite: 'boîte' },
  { id: 'r32', cat: 'Surgelé', nom: 'Macarons Grandioso',     detail: '4 parfums', unite: 'boîte' },
  { id: 'r33', cat: 'Surgelé', nom: 'Gianduiotto',            detail: '3 enrobages', unite: 'boîte' },
  { id: 'r34', cat: 'Surgelé', nom: 'Crêpes',                 unite: 'paquet' },
  { id: 'r35', cat: 'Surgelé', nom: 'Gaufres',                unite: 'paquet' },
  { id: 'r36', cat: 'Surgelé', nom: 'Cookies',                unite: 'paquet' }
];

const REASSORT_CATS = [
  { id: 'Sec',     icone: '', couleur: 'sable'  },
  { id: 'Surgelé', icone: '', couleur: 'menthe' }
];

/* Comportement du signalement de rupture */
const RUPTURE = {
  demanderQuantiteRestante: true,
  unitesRapides: [0, 1, 2, 3, 5, 10],       // gros boutons, pas de clavier
  niveaux: [
    { max: 0,        id: 'rupture', label: 'Rupture totale', couleur: 'rouge'  },
    { max: 2,        id: 'critique', label: 'Critique',      couleur: 'rouge'  },
    { max: Infinity, id: 'bas',      label: 'Stock bas',     couleur: 'orange' }
  ],
  alerterManager: true,
  destinataire: 'e4'                        // Eve
};

/* -----------------------------------------------------------------------------
   9. PHASES DE LA JOURNÉE
   -------------------------------------------------------------------------- */
const PHASES = [
  { id: 'ouverture', label: 'Ouverture', icone: '☀️', de: '08:00', a: '11:30', couleur: 'sable',
    blocs: ['pointage', 'temp_matin', 'nettoyage_ouverture', 'reassort', 'releve_lecture'] },
  { id: 'service',   label: 'Service',   icone: '⚡', de: '11:30', a: '18:00', couleur: 'menthe',
    blocs: ['nettoyage_service', 'pertes', 'lots', 'rupture'] },
  { id: 'fermeture', label: 'Fermeture', icone: '🌙', de: '18:00', a: '23:30', couleur: 'nuit',
    blocs: ['temp_soir', 'nettoyage_fermeture', 'caisse', 'releve_ecriture', 'pointage_sortie'] }
];

/* Carnet de relève : passation entre les services */
const RELEVE = {
  actif: true,
  categories: [
    { id: 'stock',    label: 'Stock et produits',   icone: '📦', couleur: 'sable'  },
    { id: 'materiel', label: 'Matériel et panne',   icone: '🔧', couleur: 'rouge'  },
    { id: 'client',   label: 'Client et commande',  icone: '🙋', couleur: 'ciel'   },
    { id: 'info',     label: 'Information générale', icone: '💬', couleur: 'menthe' }
  ],
  exemples: ['Plus de Bactalim', 'Crêpière capricieuse depuis midi', 'Commande de 3 coffrets à retirer samedi'],
  epinglageMax: 5,
  archiveApresJours: 14,
  accuseLecture: true
};

/* -----------------------------------------------------------------------------
   10. FICHES TECHNIQUES / BIBLIOTHÈQUE
   -------------------------------------------------------------------------- */
const FICHES = [
  {
    id: 'f01', cat: 'Hygiène', titre: 'Bactalim — dilution 1 %', icone: '🧴', duree: '2 min',
    resume: 'Désinfectant surfaces et matériel en contact alimentaire.',
    etapes: [
      'Remplir le seau ou le pulvérisateur avec 1 L d’eau froide.',
      'Ajouter 10 ml de Bactalim, soit un bouchon doseur rempli au premier trait.',
      'Mélanger sans faire mousser.',
      'Appliquer sur surface déjà dégraissée, laisser agir 5 minutes.',
      'Rincer à l’eau potable si contact alimentaire direct, puis sécher.'
    ],
    securite: 'Gants obligatoires. Ne jamais mélanger avec un produit acide ou javellisé.',
    validite: 'Solution à renouveler chaque jour.'
  },
  {
    id: 'f02', cat: 'Hygiène', titre: 'Biberons topping — désinfection', icone: '🍯', duree: '10 min',
    resume: 'À faire tous les 5 jours ou à chaque changement de parfum.',
    etapes: [
      'Vider le reste de topping, ne jamais recompléter un biberon entamé.',
      'Démonter le bouchon et le bec.',
      'Laver à l’eau chaude savonneuse avec le goupillon.',
      'Désinfecter au Bactalim 1 %, laisser agir 5 minutes.',
      'Rincer abondamment, sécher tête en bas sur grille.',
      'Réétiqueter avec le parfum et la date d’ouverture.'
    ],
    securite: 'Aucun résidu de savon ne doit rester dans le bec.',
    validite: 'Traçabilité dans le registre nettoyage.'
  },
  {
    id: 'f03', cat: 'Produit', titre: 'Chantilly — montage et conservation', icone: '🥛', duree: '5 min',
    resume: 'Durée de vie 48 h après ouverture, sans exception.',
    etapes: [
      'Vérifier la température de la machine, entre 0 et +4 °C.',
      'Verser la crème froide, ne jamais mélanger un reste avec une brique neuve.',
      'Noter la date et l’heure d’ouverture sur l’étiquette.',
      'Saisir le lot dans l’application au moment du remplissage.'
    ],
    securite: 'Au-delà de 48 h, jeter et enregistrer la perte.',
    validite: '48 heures'
  },
  {
    id: 'f04', cat: 'Produit', titre: 'Mise en vitrine d’un bac', icone: '🍦', duree: '3 min',
    resume: 'Le numéro de lot se saisit à l’ouverture, pas à la livraison.',
    etapes: [
      /* −20 °C est bien le bas de la cible de la chambre froide, qui vise
         −20 à −17. J'avais « corrigé » en −18 sur un souvenir : vérification
         faite dans ENCEINTES, la fiche avait raison. */
      'Sortir le bac de la chambre froide −20 °C.',
      'Contrôler l’aspect, l’absence de cristaux et l’intégrité du film.',
      'Scanner ou saisir le numéro de lot dans l’application.',
      'Placer en vitrine −13 °C, rosace montée, spatule dédiée.',
      'Placer le bac le plus ancien devant : premier entré, premier sorti.'
    ],
    securite: 'Ne jamais recongeler un bac remonté en température.',
    validite: '10 jours après ouverture'
  },
  {
    id: 'f05', cat: 'Sécurité', titre: 'Rupture de la chaîne du froid', icone: '🚨', duree: 'immédiat',
    resume: 'Que faire si une enceinte dépasse sa limite critique.',
    etapes: [
      'Relever la température et l’heure exacte.',
      'Transférer les produits dans une enceinte conforme.',
      'Prévenir le manager immédiatement.',
      'Noter l’action corrective dans le registre température.',
      'Ne pas remettre en vente un produit dont on ignore la durée d’exposition.'
    ],
    securite: 'En cas de doute sur un produit, il se jette et se déclare en perte.',
    validite: 'Procédure permanente'
  },
  {
    id: 'f06', cat: 'Caisse', titre: 'Clôture de caisse', icone: '💶', duree: '10 min',
    resume: 'Ordre imposé pour que l’écart soit exploitable.',
    etapes: [
      'Éditer le ticket Z de la caisse.',
      'Éditer le totalisateur du TPE.',
      'Compter les espèces, fonds de caisse déduit.',
      'Saisir CB, espèces et TPE dans l’application.',
      /* Le seuil annoncé ici était de 10 € alors que l'application alerte à
         partir de 5 € : la fiche autorisait donc à ne pas expliquer un écart
         que l'écran signale en rouge. Deux consignes contradictoires sur le
         même geste, et c'est celle du papier qu'on retient. */
      'Expliquer tout écart supérieur à 5 € dans le commentaire.'
    ],
    securite: 'Aucun retrait d’espèces sans le noter.',
    validite: 'Chaque soir'
  }
];

/* -----------------------------------------------------------------------------
   11. PRODUITS, PARFUMS, FOURNISSEUR
   -------------------------------------------------------------------------- */
const PARFUMS = [
  'Amarena','Banane','Café','Caramel au beurre salé','Chocolat noir','Chocolat équateur',
  'Chocolat bio (sorbet)','Citron bio','Citron vert basilic','Dulce de leche',
  'Fraise','Framboise',
  'Fruit de la passion','Inimitable','Mangue','Noisette','Noix de coco','Orange sanguine',
  'Pistache','Stracciatella','Tiramisu','Vanille','Yogurt'
];

/* Les étiquettes Amorino sont imprimées en anglais et en italien, jamais en
   français : « PASSION FRUIT / PASSIONE », « PISTACHIO MAWARDI ». Sans ces
   alias, la reconnaissance du parfum échouait sur la moitié des bacs. */
const PARFUMS_ALIAS = {
  'Amarena':                ['amarena', 'sour cherry', 'griotte', 'amarene'],
  'Banane':                 ['banana', 'banane'],
  'Café':                   ['coffee', 'caffe', 'espresso'],
  'Caramel au beurre salé': ['salted butter caramel', 'salted caramel', 'caramello salato', 'caramel'],
  'Chocolat noir':          ['dark chocolate', 'chocolate', 'cioccolato fondente', 'cioccolato'],
  'Chocolat équateur':      ['ecuador chocolate', 'chocolate ecuador', 'cioccolato ecuador', 'equateur'],
  /* « Chocolat bio » en alias : le nom au catalogue porte une parenthèse, et la
     cible devient « chocolat bio sorbet » après nettoyage — une expression de
     trois mots qui ne figure sur aucune étiquette. Sans cet alias, l'étiquette
     « CHOCOLAT BIO » était tracée en « Chocolat noir ». */
  'Chocolat bio (sorbet)':  ['organic chocolate', 'chocolate sorbet', 'cioccolato bio',
                             'chocolat bio', 'choco bio'],
  'Citron bio':             ['lemon', 'organic lemon', 'limone'],
  'Citron vert basilic':    ['lime basil', 'lime and basil', 'lime basilico'],
  /* Dulce de leche : lait concentré caramélisé, distinct du caramel au beurre
     salé. Les confondre reviendrait à tracer un produit sous un autre nom. */
  'Dulce de leche':         ['dulce de leche', 'dulce', 'doce de leite', 'caramel au lait'],
  'Fraise':                 ['strawberry', 'fragola'],
  'Framboise':              ['raspberry', 'lampone'],
  'Fruit de la passion':    ['passion fruit', 'passionfruit', 'passione', 'frutto della passione'],
  'Inimitable':             ['inimitable', 'inimitabile'],
  'Mangue':                 ['mango'],
  'Noisette':               ['hazelnut', 'nocciola'],
  'Noix de coco':           ['coconut', 'cocco'],
  'Orange sanguine':        ['blood orange', 'arancia rossa'],
  'Pistache':               ['pistachio', 'pistacchio', 'mawardi'],
  'Stracciatella':          ['stracciatella'],
  'Tiramisu':               ['tiramisu', 'tirami su'],
  'Vanille':                ['vanilla', 'vaniglia', 'bourbon vanilla'],
  'Yogurt':                 ['yogurt', 'yoghurt', 'yaourt', 'greek yogurt']
};

/* Références fournisseur, format du bon de livraison Jetfreeze */
const FOURNISSEUR = {
  nom: 'Jetfreeze',
  prefixeReference: '$',
  formatReference: /^\$([A-Z]+)(\d{2})$/,     // $AMARENA25
  bacsParPalette: 176,
  /* Le 4 litres ne circule pas à Paccard : il encombrait l'inventaire d'une
     colonne toujours vide. Le 7 litres existe mais reste rare — il n'apparaît
     qu'à la demande, pour garder l'écran de comptage lisible. */
  taillesBac: [3, 5, 7],
  taillesCourantes: [3, 5],
  taillesRares: [7],
  tailleParDefaut: 5,
  /* Mesuré sur étiquette Amorino : 2,525 kg pour 3 L, soit 0,84167 kg/L.
     L'ancienne valeur du classeur surestimait le stock de 0,58 %, soit environ
     1,8 kg d'écart fantôme sur un inventaire de 120 bacs. */
  poidsMoyenLitre: 0.8416666666666667,
  poidsMoyenLitreClasseur: 0.8465840740740742,  // valeur historique, pour comparaison
  prixMoyenKg: 6.7
};

const TAILLES_BAC = FOURNISSEUR.taillesBac;

/* Le sec, avec ses déclinaisons. Chaque entrée porte un identifiant stable :
   c'est lui qui sert de clé de comptage, pas le libellé, pour qu'un
   changement de nom ne perde pas l'historique.

   « variantes » vide ou absent = une seule ligne à compter.
   Sinon, la référence se déplie et chaque variante se compte à part. */
const INVENTAIRE_SEC = [
  { id:'cornet',    nom:'Cornets',                  unite:'sachet',
    variantes:['Bambino','Piccolo','Classico','Grande'] },
  { id:'chococone', nom:'Choco-cônes',              unite:'sachet',
    variantes:['Bambino','Piccolo','Classico','Grande'] },
  { id:'cornetsg',  nom:'Cornets sans gluten',      unite:'sachet' },
  { id:'protege',   nom:'Papier protège-cornet',    unite:'paquet',
    variantes:['Moyen','Grand'] },
  { id:'pot',       nom:'Pots',                     unite:'pile',
    variantes:['Piccolo','Classico','Grande','Grandissimo'] },
  { id:'couvercle', nom:'Couvercles',               unite:'pile',
    variantes:['Couteau','Cuillère','Fourchette'] },
  { id:'cuillere',  nom:'Cuillères à glace',        unite:'sachet' },
  { id:'serviette', nom:'Serviettes',               unite:'paquet' },
  { id:'barquette', nom:'Barquettes à crêpe',       unite:'paquet' },
  { id:'gobelet',   nom:'Gobelets',                 unite:'pile',
    variantes:['Taille 1','Taille 2','Taille 3','Taille 4'] },
  { id:'capsule',   nom:'Capsules à café',          unite:'boîte',
    variantes:['Simple','Double','Décaféiné'] },
  { id:'chocochaud',nom:'Chocolat chaud',           unite:'boîte',
    variantes:['Noir','Lait','Blanc','Gianduja','Noisette',
               'Aztèque','Orange cannelle','Caramel','Amande','Coco'] },
  { id:'cafegrain', nom:'Café en grains',           unite:'paquet' },
  { id:'lait',      nom:'Lait',                     unite:'brique' },
  { id:'creme',     nom:'Crème pour chantilly',     unite:'brique' },
  /* La carte de la boutique liste quatre coulis : gianduja, chocolat noir,
     caramel, pistache. Le dulce de leche n'y figure pas. */
  { id:'coulis',    nom:'Coulis',                   unite:'flacon',
    variantes:['Gianduja','Chocolat noir','Caramel','Pistache'] },
  { id:'topping',   nom:'Toppings',                 unite:'pot',
    variantes:['Pistache','Noisette','Caramel','Café'] },
  /* Relévés sur étiquette : éclats de caramel 500 g, mocca beans 1,1 kg. */
  { id:'eclats',    nom:'Éclats de caramel',         unite:'pot' },
  { id:'mocca',     nom:'Mocca beans',              unite:'boîte' },
  { id:'gaufre',    nom:'Gaufres',                  unite:'paquet' },
  { id:'crepe',     nom:'Crêpes',                   unite:'paquet' },
  /* Macarons et gianduiotti : parfums relévés sur amorino.com en septembre 2026.
     Les deux gammes de macarons sont distinctes — le bon Jetfreeze livre les
     Classico en 8×10 pièces et les Grandioso en 4×6, avec des parfums propres. */
  { id:'macclassico', nom:'Macarons Classico',      unite:'boîte',
    variantes:['Cioccolato Amorino','Pistacchio','Vaniglia','Caramello',
               'Lampone','Tiramisù','Fior di latte & coulis exotique',
               'Litchi framboise rose','Cacahuète','Mangue'] },
  { id:'macgrandioso',nom:'Macarons Grandioso',     unite:'boîte',
    variantes:['Cioccolato','Pistacchio','Vaniglia','Lampone'] },
  { id:'gianduiotto', nom:'Gianduiotto',            unite:'boîte',
    variantes:['Chocolat noir & gelato chocolat',
               'Chocolat au lait & gelato noisette',
               'Chocolat blanc & gelato pistache'] },
  { id:'cookie',    nom:'Cookies',                  unite:'paquet' },
  { id:'boisson',   nom:'Boissons',                 unite:'pack',
    variantes:['Coca','Coca zéro','Evian 50 cl','Evian 1 L','San Pellegrino','Ice tea'] },
  { id:'paille',    nom:'Pailles',                  unite:'paquet' },
  { id:'papiertpe', nom:'Papier TPE',               unite:'rouleau' },
  { id:'sopalin',   nom:'Sopalin',                  unite:'rouleau' },
  { id:'bactalim',  nom:'Bactalim',                 unite:'flacon' },
  { id:'degraissant',nom:'Dégraissant',             unite:'flacon' },
  { id:'vitres',    nom:'Produit à vitres',         unite:'flacon' },
  { id:'savon',     nom:'Savon',                    unite:'flacon' },
  { id:'lavette',   nom:'Lavettes',                 unite:'paquet',
    variantes:['Rose','Jaune','Bleue','Verte'] },
  { id:'gants',     nom:'Gants jetables',           unite:'boîte' }
];

/* Nombre de lignes réellement à compter, déclinaisons comprises. */
const SEC_LIGNES = INVENTAIRE_SEC.reduce(
  (n, r) => n + (r.variantes ? r.variantes.length : 1), 0);

const MOTIFS_PERTE = [
  { id: 'perime',    label: 'Périmé',    icone: '📅', mots: ['périm','perim','dlc','date','dépassé'] },
  { id: 'casse',     label: 'Cassé',     icone: '💥', mots: ['cass','tomb','renvers','brisé'] },
  { id: 'erreur',    label: 'Erreur',    icone: '↩️', mots: ['erreur','trompé','trompe','mauvais'] },
  { id: 'formation', label: 'Formation', icone: '🎓', mots: ['formation','apprenti','essai','test'] }
];

/* -----------------------------------------------------------------------------
   12. DICTÉE VOCALE
   -------------------------------------------------------------------------- */
const VOIX = {
  langue: 'fr-FR',
  resultatsIntermediaires: false,
  dureeMaxMs: 8000,
  exemples: [
    'J’ai jeté 2 bacs de vanille',
    'Trois bacs de pistache cinq litres périmés',
    'Un bidon de chantilly cassé'
  ],
  chiffres: {
    un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9,
    dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
    vingt: 20, trente: 30, quarante: 40, cinquante: 50
  },
  unites: [
    { re: /bacs?/i,        id: 'bac' },
    { re: /litres?|\bl\b/i, id: 'litre' },
    { re: /bidons?/i,      id: 'bidon' },
    { re: /pots?/i,        id: 'pot' },
    { re: /biberons?/i,    id: 'biberon' }
  ],
  confirmationObligatoire: true       // rien n'est enregistré sans relecture
};

/* -----------------------------------------------------------------------------
   13. SCANNER — simulation, en attendant l'OCR réel
   Tout résultat est marqué comme fictif et doit être confirmé à l'écran.
   -------------------------------------------------------------------------- */
const SCANNER = {
  simulation: true,
  banniere: 'MODE DÉMONSTRATION — valeurs fictives, vérifiez sur l’étiquette',
  delaiSimuleMs: 900,
  types: {
    etiquette: {
      titre: 'Scanner l’étiquette',
      champs: ['lot', 'date_ouverture'],
      confianceSimulee: 0.82
    },
    bl: {
      titre: 'Scanner le bon de livraison',
      champs: ['fournisseur', 'numero', 'date', 'lignes'],
      confianceSimulee: 0.76,
      exempleLignes: [
        { ref: '$AMARENA25',   parfum: 'Amarena',              bacs: 12, taille: 5 },
        { ref: '$PISTACHE25',  parfum: 'Pistache',             bacs: 18, taille: 5 },
        { ref: '$VANILLE25',   parfum: 'Vanille',              bacs: 24, taille: 5 },
        { ref: '$CHOCONOIR25', parfum: 'Chocolat noir',        bacs: 16, taille: 5 },
        { ref: '$FRAISE25',    parfum: 'Fraise',               bacs: 14, taille: 4 },
        { ref: '$CITRON25',    parfum: 'Citron bio',           bacs: 12, taille: 4 },
        { ref: '$STRACCIA25',  parfum: 'Stracciatella',        bacs: 20, taille: 5 },
        { ref: '$CARAMEL25',   parfum: 'Caramel au beurre salé', bacs: 15, taille: 5 },
        { ref: '$NOISETTE25',  parfum: 'Noisette',             bacs: 13, taille: 5 },
        { ref: '$MANGUE25',    parfum: 'Mangue',               bacs: 11, taille: 4 },
        { ref: '$TIRAMISU25',  parfum: 'Tiramisu',             bacs: 10, taille: 5 },
        { ref: '$YOGURT25',    parfum: 'Yogurt',               bacs: 11, taille: 5 }
      ],
      totalBacsAttendu: 176
    }
  }
};

/* -----------------------------------------------------------------------------
   14. PÉRIODES — clôture dynamique
   Le manager peut fermer une période avant son terme naturel et définir
   lui-même la fenêtre suivante. Tout le calcul d'écart suit cette fenêtre.
   -------------------------------------------------------------------------- */
const PERIODES = {
  types: [
    { id: 'semaine',      label: 'Semaine',      jours: 7 },
    { id: 'quinzaine',    label: 'Quinzaine',    jours: 14 },
    { id: 'mois',         label: 'Mois',         jours: null },
    { id: 'trimestre',    label: 'Trimestre',    jours: null },
    { id: 'personnalise', label: 'Dates personnalisées', jours: null }
  ],
  parDefaut: 'semaine',
  cloturAnticipeeAutorisee: true,
  /* Conditions bloquantes avant clôture. Le manager peut forcer, avec motif. */
  blocages: [
    { id: 'temp',      label: 'Relevés de température incomplets', forcable: true },
    { id: 'nettoyage', label: 'Journée sans aucun nettoyage validé', forcable: true },
    { id: 'caisse',    label: 'Feuille de caisse manquante',        forcable: true },
    { id: 'inv_glace', label: 'Inventaire glace non validé',        forcable: false },
    { id: 'inv_sec',   label: 'Inventaire sec non validé',          forcable: true },
    { id: 'achats',    label: 'Achats de la période non saisis',    forcable: false }
  ],
  forcageMotifObligatoire: true,
  /* La nouvelle période démarre le lendemain de la clôture, sans trou */
  enchainementSansTrou: true,
  inventaireObligatoireALaCloture: true
};

/* -----------------------------------------------------------------------------
   15. SEUILS ET ALERTES
   -------------------------------------------------------------------------- */
const SEUILS = {
  ecartGlacePct:       3,        // fourchette visée, en pourcentage
  ecartGlaceAlertePct: 6,
  caisseJourEur:       10,
  caisseCumulEur:      50,
  /* Écart entre le fond compté le matin et celui laissé la veille. En deçà,
     c'est une monnaie mal rendue ; à partir de là, ça se signale. */
  ecartFondEur:        5,
  joursSansNettoyage:  2,
  tempCritiquesTolerees: 0,
  stockBasUnites:      2
};

/* Détecteur de tendances — analyse locale, sans appel externe */
const FRAUDE = {
  actif: true,
  simulation: true,
  fenetreJours: 60,
  minOccurrences: 3,
  regles: [
    { id: 'jour_semaine',   label: 'Manques de caisse récurrents un même jour de semaine' },
    { id: 'meme_personne',  label: 'Écarts concentrés sur une même session' },
    { id: 'annulations',    label: 'Commandes annulées répétées sur un créneau' },
    { id: 'ecart_glace',    label: 'Écart de glace supérieur à la fourchette plusieurs périodes de suite' },
    { id: 'pertes_pics',    label: 'Pertes déclarées anormalement élevées en fin de période' }
  ],
  avertissement: 'Ces tendances sont des signaux statistiques, jamais une accusation. Elles se vérifient sur le terrain.'
};

/* -----------------------------------------------------------------------------
   16. MÉTÉO — widget préparé pour une API
   -------------------------------------------------------------------------- */
const METEO = {
  actif: true,
  ville: 'Chamonix-Mont-Blanc',
  lat: 45.9237,
  lon: 6.8694,
  fournisseur: 'open-meteo',
  endpoint: 'https://api.open-meteo.com/v1/forecast',
  parametres: { current: 'temperature_2m,weather_code', daily: 'temperature_2m_max,precipitation_probability_max', timezone: 'Europe/Paris' },
  rafraichissementMin: 30,
  /* Sans réseau, on affiche la dernière valeur connue */
  cacheHeures: 6,
  /* Corrélation utile : température extérieure et volume de vente */
  correlationVentes: true,
  codes: {
    0: { l: 'Ciel dégagé', i: '☀️' },  1: { l: 'Peu nuageux', i: '🌤️' },
    2: { l: 'Nuageux', i: '⛅' },       3: { l: 'Couvert', i: '☁️' },
    45:{ l: 'Brouillard', i: '🌫️' },   61:{ l: 'Pluie', i: '🌧️' },
    71:{ l: 'Neige', i: '🌨️' },        95:{ l: 'Orage', i: '⛈️' }
  }
};

/* -----------------------------------------------------------------------------
   17. NAVIGATION — barre du bas, pouce accessible
   Cinq entrées maximum par rôle : au-delà, la barre devient illisible en rush.
   -------------------------------------------------------------------------- */
/* Familles de produits pour la traçabilité : la liste des 22 parfums était
   trop longue à l'écran. On classe d'abord par famille, le parfum ne sert
   qu'aux glaces. */
/* L'unité compte autant que le libellé : sans elle, l'écran annonçait
   « Gaufre · 6 bacs ». Une gaufre n'est pas un bac, et mélanger les deux dans un
   total fausse la moyenne — on obtenait 2,9 litres par bac, soit moins que le
   plus petit format existant. */
const FAMILLES_PRODUIT = [
  { id:'glace',        libelle:'Glace',              parfums:true,  dlc:'gelato',
    unite:'bac',    unites:'bacs' },
  { id:'mac_classico', libelle:'Macarons Classico',  parfums:false, dlc:'macaron_gelato',
    unite:'boîte',  unites:'boîtes' },
  { id:'mac_grandioso',libelle:'Macarons Grandioso', parfums:false, dlc:'macaron_gelato',
    unite:'boîte',  unites:'boîtes' },
  { id:'gianduiotto',  libelle:'Gianduiotto',        parfums:false, dlc:'gianduiotto',
    unite:'boîte',  unites:'boîtes' },
  { id:'gaufre',       libelle:'Gaufre',             parfums:false, dlc:'gaufre',
    unite:'paquet', unites:'paquets' },
  { id:'crepe',        libelle:'Crêpe',              parfums:false, dlc:'crepe_negatif',
    unite:'paquet', unites:'paquets' },
  { id:'chantilly',    libelle:'Chantilly',          parfums:false, dlc:'chantilly',
    unite:'brique', unites:'briques' },
  /* Coulis et toppings ont des saveurs, comme les glaces ont des parfums.
     Le gianduja est ce que l'équipe appelle la crème fondue. */
  { id:'coulis',       libelle:'Coulis',             parfums:true,  dlc:'coulis',
    unite:'flacon', unites:'flacons',
    saveurs:['Gianduja','Chocolat','Caramel','Pistache','Dulce de leche'] },
  { id:'topping',      libelle:'Topping',            parfums:true,  dlc:'topping',
    unite:'pot',    unites:'pots',
    saveurs:['Pistache','Noisette','Caramel','Café'] }
];

/* Anomalies constatées en boutique — nouveau module demandé par l'équipe */
const ANOMALIES = {
  categories: [
    { id:'materiel',  libelle:'Panne ou matériel cassé',     icone:'🔧' },
    { id:'froid',     libelle:'Problème de froid',           icone:'❄️' },
    { id:'produit',   libelle:'Produit non conforme',        icone:'📦' },
    { id:'proprete',  libelle:'Propreté ou hygiène',         icone:'🧽' },
    { id:'securite',  libelle:'Sécurité des personnes',       icone:'⚠️' },
    { id:'client',    libelle:'Incident client',             icone:'🙋' },
    { id:'autre',     libelle:'Autre',                       icone:'💬' }
  ],
  gravites: [
    { id:'bloquant', libelle:'Bloquant — la boutique ne peut pas fonctionner', couleur:'bad' },
    { id:'gene',     libelle:'Gênant — on travaille mais mal',                couleur:'warn' },
    { id:'signale',  libelle:'À signaler — sans urgence',                     couleur:'ok' }
  ],
  photoConseillee: true
};

/* La barre du bas n'affiche plus d'emoji : un pictogramme coloré par onglet
   fait « bricolage ». Le libellé seul, avec l'onglet actif en encre, suffit —
   c'est ce que font les applications professionnelles de ce secteur. */
const TABS = {
  equipe: [
    { id: 'accueil',  label: 'Ma journée' },
    { id: 'clean',    label: 'Nettoyage' },
    { id: 'lots',     label: 'Traçabilité' },
    { id: 'reas',     label: 'Réassort' },
    { id: 'temp',     label: 'Température' },
    { id: 'anomalie', label: 'Anomalie' }
  ],
  manager: [
    { id: 'controle', label: 'Contrôle' },
    { id: 'ecarts',   label: 'Écarts' },
    { id: 'frigo',    label: 'Frigo' },
    { id: 'periodes', label: 'Périodes' },
    { id: 'plus',     label: 'Plus' }
  ]
};

const MENU_PLUS = {
  equipe:  ['pertes', 'lots', 'inv', 'caisse', 'fiches', 'releve', 'pointage'],
  manager: ['pertes', 'lots', 'inv', 'caisse', 'fiches', 'releve', 'histo', 'equipe', 'reglages']
};

const PAGES = {
  accueil:  { titre: 'Ma journée',        sous: 'Ouverture, service et fermeture' },
  controle: { titre: 'Tour de contrôle',  sous: 'Ce qui se passe en boutique, en direct' },
  temp:     { titre: 'Frigos',            sous: 'Relevé matin et soir' },
  clean:    { titre: 'Nettoyage',         sous: 'Tâches du jour par zone' },
  reas:     { titre: 'Réassort',          sous: 'À vérifier avant le service' },
  pertes:   { titre: 'Pertes',            sous: 'Ce qui a été jeté et pourquoi' },
  lots:     { titre: 'Numéros de lot',    sous: 'Saisie à l’ouverture du produit' },
  inv:      { titre: 'Inventaires',       sous: 'Glace et sec' },
  caisse:   { titre: 'Caisse',            sous: 'Fonds, recettes et écarts' },
  fiches:   { titre: 'Bibliothèque',      sous: 'Protocoles et fiches techniques' },
  releve:   { titre: 'Carnet de relève',  sous: 'Messages entre les services' },
  ecarts:   { titre: 'Écarts glace',      sous: 'Rendement de la période' },
  frigo:    { titre: 'Frigo virtuel',     sous: 'Produits ouverts, du plus urgent' },
  periodes: { titre: 'Périodes',          sous: 'Clôture et fenêtre de calcul' },
  histo:    { titre: 'Historique',        sous: 'Tout est conservé' },
  equipe:   { titre: 'Équipe',            sous: 'Heures et activité' },
  pointage: { titre: 'Pointeuse',         sous: 'Début et fin de service' },
  reglages: { titre: 'Réglages',          sous: 'Paramètres et catalogue' }
};

/* -----------------------------------------------------------------------------
   18. DESIGN — jetons consommés par style.css et app.js
   -------------------------------------------------------------------------- */
const UI = {
  rayonCarte: 16,
  rayonBouton: 14,
  cibleTactileMin: 56,        // px — utilisable avec des doigts gras et froids
  espacementBoutons: 12,      // px — évite les fausses manipulations
  dureeToastMs: 2600,
  vibration: { ok: 15, erreur: [40, 60, 40] },
  confirmationDestructive: true,
  palette: {
    encre:   '#0F2027',
    ardoise: '#41585F',
    brume:   '#8AA0A8',
    voile:   'rgba(255,255,255,0.72)',
    fond:    '#EEF3F5',
    menthe:  '#7FB8A4',
    mentheClair: '#E4F1EC',
    corail:  '#E8837C',
    corailClair: '#FBEAE9',
    ambre:   '#E0A85C',
    ambreClair: '#FBF1E1',
    ciel:    '#8FB4CE',
    cielClair: '#E9F1F7',
    sable:   '#D9C3A5',
    nuit:    '#2A3F4D'
  },
  flou: { carte: '18px', barre: '24px' }
};

/* -----------------------------------------------------------------------------
   19. EXPORT
   -------------------------------------------------------------------------- */


/* =============================================================================
   21. TÂCHES HEBDOMADAIRES
   Transcription du tableau affiché en boutique : « Tâches du nettoyage
   hebdomadaires ». À ne pas confondre avec le registre HACCP quotidien
   (NETTOYAGE ci-dessus), qui liste les postes 7/7 et 1/7.

   Ici chaque ligne est une ACTION précise, pas un poste : « Nettoyer le mobilier
   en bois (portes, bas de la vitrine) » et non « mobilier ». C'est ce niveau de
   détail qui permet à quelqu'un qui débute de savoir quoi faire.

   jour  : 1 = lundi … 7 = dimanche. Modifiable par le manager (Back-office).
   rang  : ordre d'affichage dans la journée.
   perso : true = tâche à attribuer nommément, marquée ainsi sur le tableau.
   ========================================================================== */
const TACHES_HEBDO_DEF = [
  /* --- Tableau affiché en boutique : « Tâches du nettoyage hebdomadaires » --- */
  { id:'h101', jours:[1], rang:1, libelle:'Nettoyer le mobilier en bois (portes, bas de la vitrine)' },
  { id:'h102', jours:[1], rang:2, libelle:'Nettoyer les placards bas et hauts en arrière-boutique' },
  { id:'h103', jours:[1], rang:3, libelle:'Nettoyer l’évier' },
  { id:'h104', jours:[1], rang:4, libelle:'Nettoyer la terrasse extérieure' },

  { id:'h201', jours:[2], rang:1, libelle:'Nettoyer les appareils à crêpes et gaufres', perso:true },
  { id:'h202', jours:[2], rang:2, libelle:'Nettoyer le stoppeur, les poteaux de file d’attente et l’affichage extérieur' },
  { id:'h203', jours:[2], rang:3, libelle:'Mettre en décongélation le frigo −20 °C (crêpes / gaufres)' },

  { id:'h301', jours:[3], rang:1, libelle:'Nettoyer les frigos positifs (lait, boissons, crème, frigo crêpe/gaufre)' },
  { id:'h302', jours:[3], rang:2, libelle:'Nettoyer les tables et chaises, à l’intérieur et à l’extérieur' },
  { id:'h303', jours:[3], rang:3, libelle:'Nettoyer les pieds des tables' },
  { id:'h304', jours:[3], rang:4, libelle:'Nettoyer la vitrine', perso:true },

  { id:'h401', jours:[4], rang:1, libelle:'Nettoyer les distributeurs à cornets et à cuillères' },
  { id:'h402', jours:[4], rang:2, libelle:'Nettoyer les murs de la boutique' },
  { id:'h403', jours:[4], rang:3, libelle:'Nettoyer le sous-sol et organiser le stockage des produits' },
  { id:'h404', jours:[4], rang:4, libelle:'Nettoyer les toilettes et le vestiaire au sous-sol' },

  { id:'h501', jours:[5], rang:1, libelle:'Nettoyer les machines à chantilly, à café et à milkshake' },
  { id:'h502', jours:[5], rang:2, libelle:'Nettoyer le comptoir, le meuble de caisse et le présentoir' },

  { id:'h601', jours:[6], rang:1, libelle:'Nettoyer les surfaces vitrées (baies, portes, fenêtres)' },

  { id:'h701', jours:[7], rang:1, libelle:'Nettoyer les poubelles intérieures et extérieures' },
  { id:'h702', jours:[7], rang:2, libelle:'Nettoyer la poussière sur les étagères hautes et dans les coins' },

  /* --- Registre HACCP Amorino : postes non placés au tableau -------------
     Le manager leur attribue des jours depuis le back-office. Ceux marqués
     « procedure » sont déjà faits chaque jour par la procédure d'ouverture ou
     de fermeture : ils restent au catalogue mais ne sont pas programmés, pour
     ne pas demander deux fois la même chose à l'équipe. */
  { id:'r01', jours:[], rang:1, libelle:'Nettoyer la machine à chantilly', procedure:'fermeture' },
  { id:'r02', jours:[], rang:2, libelle:'Nettoyer la machine à frappé', procedure:'fermeture' },
  { id:'r03', jours:[], rang:3, libelle:'Nettoyer la machine à café', procedure:'fermeture' },
  { id:'r04', jours:[], rang:4, libelle:'Nettoyer l’évier de la boutique', procedure:'fermeture' },
  { id:'r05', jours:[], rang:5, libelle:'Nettoyer les vitrines −13 °C', procedure:'ouverture' },
  { id:'r06', jours:[], rang:6, libelle:'Nettoyer les ustensiles dans le bac en inox', procedure:'ouverture' },
  { id:'r07', jours:[], rang:7, libelle:'Passer le balai et la serpillière', procedure:'ouverture' },
  { id:'r08', jours:[], rang:8, libelle:'Nettoyer les poubelles de la boutique', procedure:'fermeture' },

  { id:'r10', jours:[], rang:10, libelle:'Nettoyer la machine à chantilly — démontage complet' },
  { id:'r11', jours:[], rang:11, libelle:'Nettoyer la crêpière' },
  { id:'r12', jours:[], rang:12, libelle:'Nettoyer le bain-marie' },
  { id:'r13', jours:[], rang:13, libelle:'Nettoyer la vitrine d’exposition' },
  { id:'r14', jours:[], rang:14, libelle:'Nettoyer l’affichage intérieur' },
  { id:'r15', jours:[], rang:15, libelle:'Nettoyer l’évier de l’arrière-boutique' },
  { id:'r16', jours:[], rang:16, libelle:'Nettoyer les murs de l’arrière-boutique' },
  { id:'r17', jours:[], rang:17, libelle:'Nettoyer les vestiaires' },
  { id:'r18', jours:[], rang:18, libelle:'Nettoyer les étagères de la réserve' },
  { id:'r19', jours:[], rang:19, libelle:'Nettoyer l’enseigne et le lambrequin' },
  { id:'r20', jours:[], rang:20, libelle:'Nettoyer les poubelles extérieures' },
  { id:'r21', jours:[], rang:21, libelle:'Nettoyer les armoires froides' },
  { id:'r22', jours:[], rang:22, libelle:'Nettoyer le filtre de la climatisation' },
  { id:'r23', jours:[], rang:23, libelle:'Nettoyer la chambre froide' }
];
/* Le plan effectif est chargé depuis la base au démarrage : le manager peut
   déplacer une tâche d'un jour à l'autre sans toucher au code. */
let TACHES_HEBDO = TACHES_HEBDO_DEF.map(t => Object.assign({}, t));

/* Responsabilités de la semaine, en bas du tableau affiché en boutique */
const RESPONSABLES = [
  { id:'r_linge',  libelle:'Responsable du linge, deux fois par semaine', icone:'🧺' },
  { id:'r_trace',  libelle:'Responsable du contrôle de la traçabilité',   icone:'📋' },
  { id:'r_fifo',   libelle:'Responsable du contrôle FIFO — alerter si un produit approche de sa DLC', icone:'🧊' }
];

const HEBDO = {
  photosObligatoires: true,
  photosMax: 4,          // plusieurs vues d'une même tâche : avant, après, détail
  photosMin: 1
};

/* =============================================================================
   20. CHECK-LISTES OFFICIELLES
   Transcription des MOP Amorino : « CHECK-LIST D'OUVERTURE » et
   « MOP 04 112 CHECK-LISTE DE FERMETURE ». L'ordre et les durées sont ceux
   des documents. jours : restriction au jour de semaine (1 = lundi).
   ========================================================================== */
const CHECKLISTS = {
  ouverture: [
    { bloc: 'Ouverture de la boutique', taches: [
      { id:'o01', t:'Se mettre en tenue et retirer tous les bijoux' },
      { id:'o03', t:'Relever les températures des unités froides', lien:'temp', obligatoire:true },
      { id:'o04', t:'Nettoyer les vitrines, puis les allumer', fiche:'f01' },
      { id:'o05', t:'Installer la terrasse' },
      { id:'o06', t:'Passer le balai et la serpillière dans la boutique' },
      { id:'o07', t:'Nettoyer les ustensiles dans le bac en inox' },
      { id:'o08', t:'Allumer la crêpière et le gaufrier' },
      { id:'o09', t:'Préparer la chantilly', fiche:'f03' },
      { id:'o10', t:'Mettre les glaces dans la vitrine' },
      { id:'o11', t:'Compter le fond de caisse', lien:'caisse', obligatoire:true }
    ]}
  ],
  /* Le service n'avait aucune check-liste : l'écran restait vide entre
     l'ouverture et la fermeture, alors que c'est le moment où se prépare tout
     ce qui tiendra la journée. Relévé en boutique. */
  service: [
    { bloc: 'Pendant le service', taches: [
      { id:'s01', t:'Faire le réassort complet, sec et surgelé', lien:'reas' },
      { id:'s02', t:'Remonter les glaces pour la journée' },
      { id:'s03', t:'Remplir les biberons de coulis' },
      { id:'s04', t:'Remplir le sucre glace, le sucre cristal et le cacao' },
      { id:'s05', t:'Remplir les produits de nettoyage : vitres, Bactalim, savon' },
      { id:'s06', t:'Faire les tâches hebdomadaires du jour', lien:'clean' },
      { id:'s07', t:'Pré-assembler les sets de couverts : cuillère, fourchette et couteau' }
    ]}
  ],

  /* Un seul bloc : la distinction « avant » et « après la fermeture aux clients »
     ne correspondait pas au déroulé réel. Ordre relevé en boutique. */
  fermeture: [
    { bloc: 'Fermeture', taches: [
      { id:'f01', t:'Ajouter les quarts de glace' },
      { id:'f02', t:'Nettoyer les bacs de glace' },
      { id:'f03', t:'Ranger les glaces et macarons dans l’armoire froide −13 °C' },
      { id:'f04', t:'Éteindre la vitrine et nettoyer les surfaces en inox' },
      { id:'f05', t:'Nettoyer la machine à chantilly' },
      { id:'f06', t:'Éteindre les appareils à crêpes et gaufres' },
      { id:'f07', t:'Mettre les ustensiles dans le grand bac en inox avec du Bactalim' },
      { id:'f08', t:'Nettoyer la machine à café' },
      { id:'f09', t:'Nettoyer la machine à milk-shake' },
      { id:'f10', t:'Ranger la terrasse et fermer le store' },
      { id:'f11', t:'Vider les poubelles intérieures et extérieures' },
      { id:'f12', t:'Nettoyer les surfaces en marbre noir et l’inox des frigos : portes, joints, poignées' },
      /* Ces deux-là ne se cochent pas à la main : elles se constatent quand
         l'action a réellement eu lieu dans son écran. */
      { id:'f13', t:'Compter le fond de caisse et clôturer la journée', lien:'caisse', obligatoire:true },
      { id:'f14', t:'Relever les températures des frigos', lien:'temp', obligatoire:true },
      { id:'f15', t:'Éteindre la lumière' },
      /* Saison froide seulement : la machine ne tourne pas l'été. */
      { id:'f16', t:'Nettoyer la machine à chocolat chaud', mois:[10,11,12,1,2,3] }
    ]}
  ]
};

/* Horaires — modifiables depuis le back-office */
const HORAIRES_DEF = {
  ouverture: '09:30', fermeture: '23:00',
  debutOuverture: '08:30', finOuverture: '11:30',
  debutFermeture: '21:30', finFermeture: '23:59',
  joursOuverture: [1,2,3,4,5,6,7]
};
let HORAIRES = Object.assign({}, HORAIRES_DEF);

/* Preuve photo d'une tâche */
const PREUVE = {
  actif: true,
  cotePx: 640,           // suffisant pour constater, assez léger pour tenir en base
  qualite: 0.45,
  maxParJour: 12,        // au-delà, le quota du navigateur explose
  purgeJours: 90,        // trois mois, puis les photos sont effacées
  /* Toute tâche non quotidienne exige une photo : c'est justement celle qu'on
     ne peut pas vérifier de mémoire le lendemain. */
  hebdoObligatoire: true,
  tachesObligatoires: ['f04', 'f14', 'a12']   // Bactalim, chantilly, chambre froide
};

/* Réception de livraison — champs du contrôle réception de la fiche 2025 */
const RECEPTION = {
  conformites: [
    { id:'camion',    label:'Conformité du camion' },
    { id:'emballage', label:'Conformité de l’emballage' },
    { id:'estampille',label:'Estampille sanitaire présente' }
  ],
  tempMax: -15,          // au-delà, la livraison doit être refusée
  tempLo: -25, tempHi: -8,
  motifsRefus: ['Température non conforme', 'Emballage endommagé', 'DLC trop courte', 'Produit manquant', 'Erreur de référence']
};

/* Stock fermé / ouvert */
const STOCK = {
  alerteDlcJours: 7,     // « la DLC approche dans une semaine »
  alerteCritiqueJours: 2,
  unites: ['bac', 'carton', 'sachet', 'boîte', 'bouteille', 'unité']
};


const CONFIG = {
  CHECKLISTS, HORAIRES, HORAIRES_DEF, PREUVE, RECEPTION, STOCK, ENCEINTES_DEF,
  TACHES_HEBDO, TACHES_HEBDO_DEF, RESPONSABLES, HEBDO,
  APP, SUPABASE, OFFLINE, PWA, ROLES, EQUIPE, POINTEUSE,
  DLC_RULES, DLC_SEUILS, DLC_MATCH, ENCEINTES, RELEVES,
  JOURS_SEMAINE, NETTOYAGE, REASSORT, REASSORT_CATS, RUPTURE,
  PHASES, RELEVE, FICHES, PARFUMS, PARFUMS_ALIAS, FAMILLES_PRODUIT, ANOMALIES,
  FOURNISSEUR, TAILLES_BAC,
  INVENTAIRE_SEC, MOTIFS_PERTE, VOIX, SCANNER, PERIODES,
  SEUILS, FRAUDE, METEO, TABS, MENU_PLUS, PAGES, UI
};

if (typeof module !== 'undefined' && module.exports) module.exports = CONFIG;
