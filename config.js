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
  site:       'Chamonix',
  version:    '3.0.0-beta',
  build:      '2026-08-27',
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
  /* Les lectures servies depuis le cache si le réseau ne répond pas à temps */
  timeoutReseauMs: 3500,
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

const EQUIPE = [
  { id: 'e1', prenom: 'Marianna', role: 'equipe',  pin: '1111', couleur: '#7FA6A0', initiales: 'MA' },
  { id: 'e2', prenom: 'Samara',   role: 'equipe',  pin: '2222', couleur: '#C4907A', initiales: 'SA' },
  { id: 'e3', prenom: 'Kenza',    role: 'equipe',  pin: '3333', couleur: '#9AA87F', initiales: 'KE' },
  { id: 'e4', prenom: 'Eve',      role: 'manager', pin: '9999', couleur: '#0F2027', initiales: 'EV' }
];

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
const DLC_RULES = {
  chantilly:            { h: 48,       label: 'Crème chantilly',            zone: 'positif' },
  gaufre:               { h: 10 * 24,  label: 'Gaufres',                    zone: 'ambiant' },
  gelato:               { h: 10 * 24,  label: 'Gelati / sorbets −13 °C',    zone: 'negatif' },
  macaron_traditionnel: { h: 3 * 24,   label: 'Macarons traditionnels',     zone: 'ambiant' },
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
  rouge:  { min: -1,   label: 'Périmé',        couleur: 'rouge'  }
};

/* Association produit → règle DLC. Le premier motif qui matche gagne. */
const DLC_MATCH = [
  { re: /chantilly|antilly/i,               regle: 'chantilly' },
  { re: /gaufre/i,                          regle: 'gaufre' },
  { re: /macaron.*(tradi|ambiant)|tradi.*macaron/i, regle: 'macaron_traditionnel' },
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
const ENCEINTES = [
  { id: 'cf',  nom: 'Chambre froide',         cible: '−20 °C',  lo: -24, hi: -14, pas: 1, vert: [-20, -17], crit: -15, zone: 'reserve' },
  { id: 'ar1', nom: 'Armoire froide 1',       cible: '−20 °C',  lo: -24, hi: -14, pas: 1, vert: [-20, -17], crit: -15, zone: 'reserve' },
  { id: 'ar2', nom: 'Armoire froide 2',       cible: '−20 °C',  lo: -24, hi: -14, pas: 1, vert: [-20, -17], crit: -15, zone: 'reserve' },
  { id: 'ar3', nom: 'Armoire froide 3',       cible: '−20 °C',  lo: -24, hi: -14, pas: 1, vert: [-20, -17], crit: -15, zone: 'reserve' },
  { id: 'vg',  nom: 'Vitrine gelato',         cible: '−13 °C',  lo: -18, hi: -8,  pas: 1, vert: [-16, -11], crit: -10, zone: 'boutique' },
  { id: 'vs',  nom: 'Vitrine sorbet',         cible: '−13 °C',  lo: -18, hi: -8,  pas: 1, vert: [-16, -11], crit: -10, zone: 'boutique' },
  { id: 'fn',  nom: 'Frigo négatif comptoir', cible: '−13 °C',  lo: -18, hi: -8,  pas: 1, vert: [-16, -11], crit: -10, zone: 'boutique' },
  { id: 'fp1', nom: 'Frigo positif comptoir', cible: '0 / +3 °C', lo: -2, hi: 8,  pas: 1, vert: [0, 3],     crit: 5,   zone: 'boutique' },
  { id: 'fp2', nom: 'Frigo sous comptoir',    cible: '0 / +3 °C', lo: -2, hi: 8,  pas: 1, vert: [0, 3],     crit: 5,   zone: 'boutique' },
  { id: 'ch',  nom: 'Machine à chantilly',    cible: '0 / +4 °C', lo: -2, hi: 8,  pas: 1, vert: [0, 4],     crit: 6,   zone: 'boutique' }
];

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
   8. RÉASSORT — 34 points, groupés par catégorie
   -------------------------------------------------------------------------- */
const REASSORT = [
  /* --- Emballages : 12 --- */
  { id: 'r01', cat: 'Emballages', nom: 'Cornets classiques',        unite: 'sachet' },
  { id: 'r02', cat: 'Emballages', nom: 'Cornets sans gluten',       unite: 'sachet' },
  { id: 'r03', cat: 'Emballages', nom: 'Cônes chocolat',            unite: 'sachet' },
  { id: 'r04', cat: 'Emballages', nom: 'Pots 550 ml',               unite: 'pile' },
  { id: 'r05', cat: 'Emballages', nom: 'Pots 1100 ml',              unite: 'pile' },
  { id: 'r06', cat: 'Emballages', nom: 'Couvercles pots',           unite: 'pile' },
  { id: 'r07', cat: 'Emballages', nom: 'Cuillères dégustation',     unite: 'boîte' },
  { id: 'r08', cat: 'Emballages', nom: 'Cuillères longues',         unite: 'boîte' },
  { id: 'r09', cat: 'Emballages', nom: 'Serviettes',                unite: 'paquet' },
  { id: 'r10', cat: 'Emballages', nom: 'Sacs papier',               unite: 'paquet' },
  { id: 'r11', cat: 'Emballages', nom: 'Gobelets boissons',         unite: 'pile' },
  { id: 'r12', cat: 'Emballages', nom: 'Boîtes macarons',           unite: 'unité' },

  /* --- Alimentaire : 14 --- */
  { id: 'r13', cat: 'Alimentaire', nom: 'Bacs gelato vitrine',      unite: 'bac' },
  { id: 'r14', cat: 'Alimentaire', nom: 'Bacs sorbet vitrine',      unite: 'bac' },
  { id: 'r15', cat: 'Alimentaire', nom: 'Crème chantilly',          unite: 'litre' },
  { id: 'r16', cat: 'Alimentaire', nom: 'Coulis caramel',           unite: 'biberon' },
  { id: 'r17', cat: 'Alimentaire', nom: 'Coulis chocolat',          unite: 'biberon' },
  { id: 'r18', cat: 'Alimentaire', nom: 'Coulis gianduja',          unite: 'biberon' },
  { id: 'r19', cat: 'Alimentaire', nom: 'Coulis pistache',          unite: 'biberon' },
  { id: 'r20', cat: 'Alimentaire', nom: 'Topping amarena',          unite: 'pot' },
  { id: 'r21', cat: 'Alimentaire', nom: 'Topping noisette',         unite: 'pot' },
  { id: 'r22', cat: 'Alimentaire', nom: 'Pâte à gaufre',            unite: 'litre' },
  { id: 'r23', cat: 'Alimentaire', nom: 'Pâte à crêpe',             unite: 'litre' },
  { id: 'r24', cat: 'Alimentaire', nom: 'Macarons',                 unite: 'plaque' },
  { id: 'r25', cat: 'Alimentaire', nom: 'Café en grains',           unite: 'kg' },
  { id: 'r26', cat: 'Alimentaire', nom: 'Lait',                     unite: 'litre' },

  /* --- Entretien : 8 --- */
  { id: 'r27', cat: 'Entretien', nom: 'Bactalim',                   unite: 'bidon' },
  { id: 'r28', cat: 'Entretien', nom: 'Dégraissant surfaces',       unite: 'flacon' },
  { id: 'r29', cat: 'Entretien', nom: 'Liquide vaisselle',          unite: 'flacon' },
  { id: 'r30', cat: 'Entretien', nom: 'Lavettes microfibre',        unite: 'paquet' },
  { id: 'r31', cat: 'Entretien', nom: 'Papier essuie-tout',         unite: 'rouleau' },
  { id: 'r32', cat: 'Entretien', nom: 'Sacs poubelle',              unite: 'rouleau' },
  { id: 'r33', cat: 'Entretien', nom: 'Gants jetables',             unite: 'boîte' },
  { id: 'r34', cat: 'Entretien', nom: 'Produit vitres',             unite: 'flacon' }
];

const REASSORT_CATS = [
  { id: 'Emballages',  icone: '📦', couleur: 'sable'  },
  { id: 'Alimentaire', icone: '🍦', couleur: 'menthe' },
  { id: 'Entretien',   icone: '🧴', couleur: 'ciel'   }
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
      'Expliquer tout écart supérieur à 10 € dans le commentaire.'
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
  'Chocolat bio (sorbet)','Citron bio','Citron vert basilic','Fraise','Framboise',
  'Fruit de la passion','Inimitable','Mangue','Noisette','Noix de coco','Orange sanguine',
  'Pistache','Stracciatella','Tiramisu','Vanille','Yogurt'
];

/* Références fournisseur, format du bon de livraison Jetfreeze */
const FOURNISSEUR = {
  nom: 'Jetfreeze',
  prefixeReference: '$',
  formatReference: /^\$([A-Z]+)(\d{2})$/,     // $AMARENA25
  bacsParPalette: 176,
  taillesBac: [3, 4, 5, 7],
  tailleParDefaut: 5,
  poidsMoyenLitre: 0.8465840740740742,        // kg par litre
  prixMoyenKg: 6.7
};

const TAILLES_BAC = FOURNISSEUR.taillesBac;

const INVENTAIRE_SEC = [
  'Cornets classiques','Cornets sans gluten','Cônes chocolat','Pots 550 ml','Pots 1100 ml',
  'Couvercles','Cuillères dégustation','Cuillères longues','Serviettes','Sacs papier',
  'Gobelets','Boîtes macarons','Café en grains','Lait','Chantilly','Coulis caramel',
  'Coulis chocolat','Coulis gianduja','Coulis pistache','Toppings','Pâte à gaufre',
  'Pâte à crêpe','Macarons','Boissons','Bactalim','Dégraissant','Lavettes','Gants jetables'
];

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
const TABS = {
  equipe: [
    { id: 'accueil', label: 'Ma journée', icone: '🏠' },
    { id: 'temp',    label: 'Frigos',     icone: '🌡️' },
    { id: 'clean',   label: 'Nettoyage',  icone: '🧽' },
    { id: 'reas',    label: 'Réassort',   icone: '📦' },
    { id: 'plus',    label: 'Plus',       icone: '⋯'  }
  ],
  manager: [
    { id: 'controle', label: 'Contrôle',  icone: '🗼' },
    { id: 'ecarts',   label: 'Écarts',    icone: '📊' },
    { id: 'frigo',    label: 'Frigo',     icone: '🧊' },
    { id: 'periodes', label: 'Périodes',  icone: '📅' },
    { id: 'plus',     label: 'Plus',      icone: '⋯'  }
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
  reas:     { titre: 'Réassort',          sous: '34 points à vérifier' },
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
const CONFIG = {
  APP, SUPABASE, OFFLINE, PWA, ROLES, EQUIPE, POINTEUSE,
  DLC_RULES, DLC_SEUILS, DLC_MATCH, ENCEINTES, RELEVES,
  JOURS_SEMAINE, NETTOYAGE, REASSORT, REASSORT_CATS, RUPTURE,
  PHASES, RELEVE, FICHES, PARFUMS, FOURNISSEUR, TAILLES_BAC,
  INVENTAIRE_SEC, MOTIFS_PERTE, VOIX, SCANNER, PERIODES,
  SEUILS, FRAUDE, METEO, TABS, MENU_PLUS, PAGES, UI
};

if (typeof module !== 'undefined' && module.exports) module.exports = CONFIG;
