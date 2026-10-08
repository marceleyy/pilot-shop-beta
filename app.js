/* =============================================================================
   PILOT-SHOP — app.js  ·  PARTIE 1 / 2
   Noyau, base de données, connexion tactile, navigation, espace équipier.
   Dépend de config.js. Aucune dépendance externe hors XLSX (export manager).
   ============================================================================= */

   'use strict';

   /* =============================================================================
      0. RACCOURCIS ET FORMATAGE
      ========================================================================== */
   const $  = (s, r = document) => r.querySelector(s);
   const $$ = (s, r = document) => Array.prototype.slice.call(r.querySelectorAll(s));
   
   const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
     ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
   
   /* Conversion tolérante aux saisies réelles : virgule française, signe euro
      collé, espace insécable venu d'un copier-coller. isFinite écarte déjà
      Infinity, qui contaminerait tout total où il entrerait. */
   const num = v => {
     if (v === null || v === undefined) return 0;
     let s = String(v).replace(/[\s\u00a0\u202f€]/g, '');
     if (/^\(.*\)$/.test(s)) s = '-' + s.slice(1, -1);          // (12,50) : avoir comptable
     /* Avec une virgule, on lit à la française : « 1.234,50 » = 1234,50. */
     if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
     const x = parseFloat(s);
     return isFinite(x) ? x : 0;
   };
   /* Une décimale, à la française. La version précédente rendait « 1234.6 » :
      point décimal anglais et aucun séparateur de milliers, alors que eur()
      juste à côté affiche « 1 234,56 € ». Les deux se côtoient dans l'écran
      Stock, où les litres voisinent avec les kilos. */
   const n1  = v => (Number(v) || 0).toLocaleString('fr-FR',
     { minimumFractionDigits: 1, maximumFractionDigits: 1 });
   const n2  = v => (Number(v) || 0).toFixed(2);
   /* Signal qui coupe une requête au bout du délai réseau. Sans lui, un Wi-Fi
      connecté mais sans Internet laisse la requête pendue sans fin. */
   const signalDelai = () => { const c = new AbortController();
     setTimeout(() => c.abort(), OFFLINE.timeoutReseauMs); return c.signal; };
   /* Moins d'un demi-centime : 0, sans signe (« -0,00 € » sur un stock juste). */
   const eur = v => { const n = Number(v) || 0;
     return (Math.abs(n) < 0.005 ? 0 : n).toLocaleString(APP.locale, { style:'currency', currency:APP.devise }); };
   
   const MOIS  = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
   const isoOf = d => {
     const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
     return z.toISOString().slice(0, 10);
   };
   const today  = () => isoOf(new Date());
   const nowISO = () => new Date().toISOString();
   const addD   = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return isoOf(d); };
   const fmtD   = s => { const a = String(s).split('-'); return a[2] + ' ' + MOIS[+a[1] - 1] + ' ' + a[0]; };
   const fmtDC  = s => { const a = String(s).split('-'); return a[2] + '/' + a[1]; };
   const fmtM   = s => { const a = String(s).split('-'); return MOIS[+a[1] - 1] + ' ' + a[0]; };
   const heure  = t => new Date(t).toLocaleTimeString(APP.locale, { hour:'2-digit', minute:'2-digit' });
   const monthKey = s => String(s).slice(0, 7);
   
   /* Jour ISO : 1 = lundi … 7 = dimanche */
   const jourISO = s => { const j = new Date(s + 'T12:00:00').getDay(); return j === 0 ? 7 : j; };
   const nomJour = s => JOURS_SEMAINE[jourISO(s)];
   
   const debounce = (f, ms) => { let t; return function () { const a = arguments; clearTimeout(t); t = setTimeout(() => f.apply(null, a), ms); }; };
   const vibrer = p => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} };
   const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
   
   /* =============================================================================
      1. ÉTAT GLOBAL
      ========================================================================== */
   const STATE = {
     user: null,          // { id, prenom, role, couleur, initiales }
     view: '',
     jour: today(),
     phase: null,         // 'ouverture' | 'service' | 'fermeture'
     service: null,       // session de pointeuse en cours ({…, jour} : jour de début)
     moisFrigo: null,     // mois affiché par le Frigo virtuel (« AAAA-MM »), indépendant de jour
     enLigne: navigator.onLine,
     erreurBase: null,
     dernierEchec: null,
     delaisDepasses: 0,   // délais dépassés de suite, sans réponse entre-temps (voir appel)
     fileAttente: 0,
     _pin: '',
     _candidat: null
   };
   
   /* =============================================================================
      2. BASE DE DONNÉES — Supabase REST + cache local + file d'attente
      Interface inchangée : get / set / push / patch / list / del, tout async.
      Aucune vue n'a été modifiée.
   
      En ligne  : lecture réseau, écriture réseau, miroir systématique en local.
      Hors ligne: lecture depuis le miroir, écriture empilée dans la file, rejouée
                  dès le retour du réseau. La chambre froide ne bloque rien.
      ========================================================================== */
   
   /* Chaque clé de l'application pointe vers une table. Le préfixe décide. */
   const ROUTES = [
     ['temp:',        SUPABASE.tables.temperatures],
     ['clean:',       SUPABASE.tables.nettoyage],
     ['reassort:',    SUPABASE.tables.reassort],
     ['ruptures',     SUPABASE.tables.ruptures],
     ['pertes:',      SUPABASE.tables.pertes],
     ['lots:',        SUPABASE.tables.lots],
     ['invglace:',    SUPABASE.tables.inventaires],
     ['invsec:',      SUPABASE.tables.inventaires],
     ['caisse:',      SUPABASE.tables.caisse],
     ['ecart:',       SUPABASE.tables.ventes],
     /* Calcul d'écart guidé (calcul.js) : même table que les écarts de période. */
     ['calcul:',      SUPABASE.tables.ventes],
     ['periode:',     SUPABASE.tables.periodes],
     ['periodes',     SUPABASE.tables.periodes],
     ['pointage:',    SUPABASE.tables.sessions],
     ['releve',       SUPABASE.tables.releve],
     ['feed:',        SUPABASE.tables.feed],
     ['feedback',     SUPABASE.tables.feedback],
     /* Ajouts du lot « réunion d'équipe » : sans ces lignes, les clés
        n'avaient aucune table et l'URL contenait littéralement « undefined ». */
     ['checklist:',   'checklists'],
     ['preuves:',     'preuves'],
     ['stock:',       'stock'],
     ['reception:',   'receptions'],
     ['anomalies',    'feedback'],
     ['horaires',     'reglages'],
     ['equipe',       'reglages'],
     ['enceintes',    'reglages'],
     ['hebdo:plan',   'reglages'],
     ['hebdo:responsables', 'reglages'],
     ['hebdo:',       'checklists'],
     ['hebdo',        'reglages'],
     ['catalogue:',   'reglages'],
     ['async:',       'reglages']
   ].filter(function (r) {
     /* Une route dont la table est introuvable est retirée dès le chargement :
        mieux vaut garder la clé en local que d'interroger « undefined ». */
     if (r[1] && r[1] !== 'undefined') return true;
     console.warn('Route sans table, ignorée :', r[0]);
     return false;
   });
   
   /* Clés propres à l'appareil : elles ne partent jamais sur le réseau. */
   /* « pinEchecs » : compteur d'échecs du code PIN, propre à cette tablette. */
   const LOCALES = ['session', 'seuils', 'meteo', 'pinEchecs', OFFLINE.fileAttente];
   
   /* Clés partagées entre plusieurs personnes, modifiées par petits bouts :
      une check-liste où chacune coche sa tâche, un relevé rempli à deux, un
      réassort de 34 points. Sans fusion, la dernière écriture écrase tout ce
      que l'autre venait de saisir — vérifié : deux tâches cochées en même
      temps, une seule survit.
      Pour ces clés, on relit la base juste avant d'écrire et on fusionne. */
   /* « ecart: » : ventes importées, bons de livraison, jeté cumulé et
      inventaire de fin d'une même période s'y écrivent depuis des écrans et
      des iPads différents. Sans fusion, un iPad revenu en ligne rejouait sa
      copie entière, périmée : les ventes importées entre-temps sur l'autre
      iPad disparaissaient (vérifié : ventes et imports effacés). */
   const FUSIONNER = ['checklist:', 'hebdo:', 'temp:', 'caisse:', 'reassort:',
                      'preuves:', 'ruptures', 'releve', 'lots:', 'clean:',
                      'anomalies', 'reception:', 'stock:mv:', 'stock:m13:', 'pointage:', 'ecart:'];
   const aFusionner = cle => FUSIONNER.some(p => cle.indexOf(p) === 0);

   /* Fusion superficielle, champ par champ. Suffisante : chaque personne
      touche des champs distincts — sa tâche, son enceinte, son point de
      réassort. Les tableaux sont remplacés, jamais mélangés. */
   /* Listes où l'on ne fait qu'ajouter (ou cocher) des lignes : deux iPads qui
      ajoutent chacun la leur ne doivent pas s'écraser. Les autres listes
      (pertes) suppriment des lignes : une union les ferait revenir. */
   /* « preuves: » : la copie locale est purgée au bout de 7 jours ; une photo
      ajoutée ensuite sur ce jour, sans union, envoyait [nouvelle] et écrasait
      la liste du serveur. Chaque preuve a un id ; une suppression ne retire
      plus la ligne mais la marque « supprime » (filtrée à l'affichage), sinon
      l'union la ferait revenir. */
   /* « pointage: » : deux équipiers qui pointent sur deux iPads le même jour
      ajoutent chacun leur session ; sans union, la seconde effaçait la première. */
   /* « stock:m13: » : entrées et sorties de l'armoire −13, en ajout seul. Deux
      iPads qui y posent chacun un bac ne doivent pas s'effacer. */
   const UNIR = ['ruptures', 'releve', 'anomalies', 'reception:', 'stock:mv:', 'stock:m13:', 'pointage:', 'preuves:'];
   const ts = x => (x && (x.a || x.at)) || '';
   const idLigne = x => x && (x.id || [ts(x), x.c || x.cle, x.t || x.type, x.e || x.employe || '',
                                       x.q !== undefined ? x.q : x.qte, x.l || x.lot || ''].join('|'));
   /* Éléments trop anciens des listes soumises à une durée de conservation
      (CONSERVATION.listes). Même règle que la purge nocturne de la base :
      un message épinglé ou une anomalie non résolue reste. */
   function rognerAncien(cle, l) {
     if (!Array.isArray(l) || typeof CONSERVATION === 'undefined' ||
         CONSERVATION.listes.indexOf(cle) < 0) return l;
     const limite = addD(today(), -CONSERVATION.listesJours);
     const date = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) ? v.slice(0, 10) : null;
     const jourDe = x => (cle === 'anomalies' && date(x.resolueAt)) || date(x.jour) || date(x.at);
     return l.filter(x => {
       if (!x || typeof x !== 'object') return true;
       if (x.epingle === true) return true;
       if (cle === 'anomalies' && x.resolue !== true) return true;
       const j = jourDe(x);
       return !j || j >= limite;
     });
   }

   function unirListes(distant, local, cle) {
     /* Journal du stock : les lignes antérieures au dernier inventaire ne
        comptent plus et sont rognées exprès (purgerJournal) — on ne les fait
        pas revenir. Aucune autre liste n'est rognée. */
     let borne = '';
     if (cle.indexOf('stock:mv:') === 0) {
       try { const inv = JSON.parse(DB._lire('stock:inventaire') || 'null'); borne = (inv && inv.at) || ''; } catch (e) {}
     }
     const parId = {};
     distant.forEach(x => { if (x && x.id) parId[x.id] = x; });
     /* Même ligne des deux côtés : la locale fait foi (une photo retirée ne
        revient pas), mais une case cochée sur un autre iPad reste cochée. */
     const fusion = local.map(l => {
       const d = l && l.id && parId[l.id];
       if (!d) return l;
       const m = Object.assign({}, l);
       ['traite', 'resolue'].forEach(f => {
         if (d[f] && !m[f]) { m[f] = d[f]; m[f + 'Par'] = d[f + 'Par']; m[f + 'At'] = d[f + 'At']; }
       });
       if (d.lu) m.lu = true;   // luPar, lui, est réuni juste après
       /* Preuve supprimée sur un autre iPad : elle le reste ici aussi. */
       if (d.supprime && !m.supprime) { m.supprime = d.supprime; m.img = ''; }
       /* Pointage : une fin de service saisie sur un autre iPad n'est pas perdue. */
       if (d.fin && !m.fin) { m.fin = d.fin; if (d.minutes !== undefined) m.minutes = d.minutes; }
       if (Array.isArray(d.luPar)) {
         m.luPar = (m.luPar || []).concat(d.luPar.filter(p => (m.luPar || []).indexOf(p) < 0));
       }
       return m;
     });
     const vus = new Set(local.map(idLigne));
     const ajout = distant.filter(x => x && !vus.has(idLigne(x)) && !(borne && ts(x) && ts(x) <= borne));
     if (!ajout.length) return rognerAncien(cle, fusion);
     const out = fusion.concat(ajout);
     return rognerAncien(cle, out.every(x => ts(x)) ? out.sort((p, q) => ts(p) < ts(q) ? -1 : ts(p) > ts(q) ? 1 : 0) : out);
   }

   /* Listes d'un écart de période qui ne font que grandir : chaque import de
      caisse, chaque bon de livraison y ajoute sa ligne. On les réunit par id
      (les lignes anciennes, sans id, par leur contenu). */
   const LISTES_ECART = ['imports', 'bl'];
   const identite = x => (x && x.id) || JSON.stringify(x);
   function unirParId(a, b) {
     const vus = new Set(a.map(identite));
     const out = a.concat(b.filter(x => !vus.has(identite(x))));
     return out.every(x => x && x.at) ? out.sort((p, q) => p.at < q.at ? -1 : p.at > q.at ? 1 : 0) : out;
   }

   function fusionner(distant, local, cle) {
     if (Array.isArray(distant) && Array.isArray(local) && cle &&
         UNIR.some(p => cle.indexOf(p) === 0)) return unirListes(distant, local, cle);
     if (!distant || typeof distant !== 'object' || Array.isArray(distant)) return local;
     if (!local   || typeof local   !== 'object' || Array.isArray(local))   return local;
     /* Écart de période : un objet imbriqué y forme un tout (ventes = { total },
        fin = { bacs, kg }) et se remplace d'un bloc — mélangés, une saisie
        manuelle des ventes s'ajouterait à l'import au lieu de le corriger. */
     if (cle && cle.indexOf('ecart:') === 0) {
       const e = Object.assign({}, distant, local);
       LISTES_ECART.forEach(k => {
         if (Array.isArray(distant[k]) && Array.isArray(local[k])) e[k] = unirParId(distant[k], local[k]);
       });
       return e;
     }
     const out = Object.assign({}, distant);
     Object.keys(local).forEach(k => {
       const a = distant[k], b = local[k];
       out[k] = (a && b && typeof a === 'object' && typeof b === 'object' &&
                 !Array.isArray(a) && !Array.isArray(b))
         ? Object.assign({}, a, b)
         : b;
     });
     if (cle && cle.indexOf('caisse:') === 0) garderComptagesValides(out, distant, local);
     return out;
   }

   /* Caisse : un comptage validé sur la base ne se réécrit pas avec une
      saisie faite sans connaître cette validation (iPad hors ligne, écran
      ouvert avant la signature). Le local gagnait champ par champ : le
      brouillon d'un équipier, rejoué au retour du réseau, vidait les montants
      de Marie sous sa signature (s_cb '', s_esp '480'… « validé par Marie »).
      Le moment validé garde donc les champs du serveur. Une correction du
      manager, elle, connaît la validation : sa copie porte <moment>_valide
      (null pendant la correction, puis la nouvelle signature) et passe comme
      avant. Un moment non validé sur la base reste au local.
      Une signature à null ne prouve rien à elle seule : une copie lue pendant
      une correction la porte aussi. Elle ne passe que si son <moment>_avant
      date de la signature encore en base ; sinon la base a été revalidée
      depuis, et la copie est périmée.
      Une signature non nulle non plus : une copie lue avant une correction
      porte l'ancienne, que la correction a rangée dans <moment>_corrections.
      Elle ne passe pas : sinon la saisie du soir d'un équipier, écran ouvert
      depuis le matin, remettait 150 € à la place des 200 € corrigés.
      Même chose pendant la correction elle-même (signature en base à null,
      <moment>_avant gardé) : seules passent la copie du manager qui corrige
      (même <moment>_avant, numéro de saisie n à jour : une copie lue en cours
      de correction ne remet plus 180 € sur les 200 €) et sa revalidation
      (signature nouvelle, correction connue dans <moment>_corrections). La copie
      lue avant la correction porte encore la signature corrigée : écrite
      pendant la correction, elle remettait 150 € et l'ancienne signature
      jusqu'à ce que le manager revalide. */
   const CHAMPS_CAISSE_SOIR = ['ecart', 'ecartCB', 'ecartEsp', 'par'];
   function garderComptagesValides(out, distant, local) {
     const a = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
     const dejaCorrigee = (mom, sig) => Array.isArray(distant[mom + '_corrections']) &&
       distant[mom + '_corrections'].some(c => c && c.at && c.at === sig.at);
     const auCourant = mom => {
       if (!a(local, mom + '_valide')) return false;
       const sl = local[mom + '_valide'];
       /* (Re)validation : elle passe, sauf si cette signature a déjà été corrigée. */
       if (sl) return !dejaCorrigee(mom, sl);
       const av = local[mom + '_avant'], sig = distant[mom + '_valide'];
       return !!(av && sig && av.at && av.at === sig.at);   // correction de la signature en base
     };
     const auCourantCorrection = mom => {
       const av = distant[mom + '_avant'], la = local[mom + '_avant'], sl = local[mom + '_valide'];
       if (la && la.at === av.at) return (+la.n || 0) >= (+av.n || 0); // le manager qui corrige, copie à jour
       const connue = Array.isArray(local[mom + '_corrections']) &&
         local[mom + '_corrections'].some(c => c && c.at && c.at === av.at);
       return !!(sl && sl.at !== av.at && connue && !dejaCorrigee(mom, sl));   // sa revalidation
     };
     ['m', 's'].forEach(mom => {
       const enCorrection = !distant[mom + '_valide'] &&
         !!(distant[mom + '_avant'] && distant[mom + '_avant'].at);
       if (!distant[mom + '_valide'] && !enCorrection) return;
       if (enCorrection ? auCourantCorrection(mom) : auCourant(mom)) return;
       Object.keys(local).forEach(k => {
         if (k.indexOf(mom + '_') !== 0 && !(mom === 's' && CHAMPS_CAISSE_SOIR.indexOf(k) >= 0)) return;
         if (a(distant, k)) out[k] = distant[k]; else delete out[k];
       });
     });
   }

   /* Écriture partielle (DB.patch) appliquée à une copie de la clé, locale ou
      serveur : « champs » remplace des champs entiers, « ajouts » ajoute des
      lignes à des listes sans doublon (par id), « plus » incrémente des
      nombres — une seule fois, et seulement si une ligne nouvelle est entrée :
      un envoi rejoué après une réponse perdue ne compte pas deux fois le même
      bon de livraison. */
   function appliquerPatch(doc, op) {
     const o = (doc && typeof doc === 'object' && !Array.isArray(doc)) ? Object.assign({}, doc) : {};
     Object.assign(o, op.champs || {});
     let nouveau = false;
     Object.keys(op.ajouts || {}).forEach(k => {
       const avant = Array.isArray(o[k]) ? o[k] : [];
       const vus = new Set(avant.map(identite));
       const neufs = (op.ajouts[k] || []).filter(x => !vus.has(identite(x)));
       if (neufs.length) nouveau = true;
       o[k] = avant.concat(neufs);
     });
     if (nouveau) Object.keys(op.plus || {}).forEach(k => { o[k] = +(num(o[k]) + num(op.plus[k])).toFixed(3); });
     return o;
   }

   /* Une clé partagée ne s'écrit qu'UNE à LA FOIS. Sans cette file par clé,
      trois écritures lancées au même instant relisaient toutes le même état
      d'origine avant qu'aucune n'ait fini : la fusion ne servait à rien et une
      saisie disparaissait quand même. Vérifié : deux tâches sur trois. */
   const _verrous = {};
   function enFile(cle, travail) {
     const precedent = _verrous[cle] || Promise.resolve();
     const suite = precedent.then(travail, travail);
     /* On libère le verrou quoi qu'il arrive, sinon un échec bloque la clé. */
     _verrous[cle] = suite.then(() => {}, () => {});
     return suite;
   }

   const DB = (function () {
     const P = OFFLINE.storeLocal + ':';
     let dispo = true;
     try { localStorage.setItem(P + '_t', '1'); localStorage.removeItem(P + '_t'); }
     catch (e) { dispo = false; }
     const mem = {};
   
     const lire   = k => dispo ? localStorage.getItem(P + k) : (mem[k] === undefined ? null : mem[k]);
     const ecrire = (k, v) => { dispo ? localStorage.setItem(P + k, v) : (mem[k] = v); };
     const oter   = k => { dispo ? localStorage.removeItem(P + k) : delete mem[k]; };
     const clesLocales = () => (dispo
       ? Object.keys(localStorage).filter(k => k.indexOf(P) === 0).map(k => k.slice(P.length))
       : Object.keys(mem));
   
     const table = cle => {
       const r = ROUTES.filter(x => cle.indexOf(x[0]) === 0)[0];
       /* Garde-fou : une clé sans route ne doit JAMAIS partir sur le réseau.
          Sans lui, l'URL contenait littéralement « /rest/v1/undefined », le
          serveur répondait 404, et le bandeau « Table introuvable » restait
          allumé en bloquant la synchronisation d'un iPad entier. */
       const t = r ? r[1] : null;
       if (!t || t === 'undefined') {
         if (LOCALES.indexOf(cle) < 0) {
           console.warn('Clé sans table, gardée en local :', cle);
         }
         return null;
       }
       return t;
     };
     const estLocale = cle => LOCALES.some(l => cle === l || cle.indexOf(l) === 0);
     const configuré = () => !!(SUPABASE.url && SUPABASE.anonKey);
     const distant = cle => configuré() && !estLocale(cle) && !!table(cle);
   
     async function appel(chemin, options, secondeChance) {
       /* Base qui refuse un appareil non rattaché : inutile d'insister. Chaque
          lecture retentait le réseau — une rafale de 401 (52 en 25 s) sans
          aucune chance d'aboutir. On se tait 30 s, ou jusqu'au rattachement ;
          les saisies restent locales et en file d'attente, comme hors ligne. */
       if (STATE.refusJusqua && Date.now() < STATE.refusJusqua &&
           typeof appareilRattache === 'function' && !appareilRattache()) {
         const e = new Error('HTTP 401'); e.http = 401; e.motif = 'Appareil non rattaché';
         throw e;
       }
       const ctrl = new AbortController();
       let to = setTimeout(() => ctrl.abort(), OFFLINE.timeoutReseauMs);
       try {
         /* Jeton de l'appareil plutôt que clé publique : depuis l'activation de
            la sécurité au niveau des lignes, la clé seule ne donne accès à rien.
            Sans rattachement, l'appel échoue et la saisie part en file d'attente,
            exactement comme hors ligne. */
         const jeton = (typeof jetonValide === 'function') ? await jetonValide() : null;
         /* Jeton obtenu avant l'échéance (renouvellement abouti sur un réseau lent) : la requête
            garde ses 8 s à elle. Renouvellement raté (réseau muet) : pas de jeton, rien ne change. */
         if (jeton && !ctrl.signal.aborted) { clearTimeout(to); to = setTimeout(() => ctrl.abort(), OFFLINE.timeoutReseauMs); }
         /* Les en-têtes sont fusionnés D'ABORD, puis posés APRèS options.
            L'ordre inverse laissait options écraser l'objet headers entier :
            toute écriture qui passe ses propres en-têtes — « Prefer: merge-
            duplicates », c'est-à-dire TOUTES les écritures — partait sans
            apikey ni Authorization. Le serveur répondait « No API key found »
            en 401, l'application croyait sa session expirée, et empilait.
            Les lectures, elles, n'ont pas d'en-tête propre : elles marchaient.
            D'où une base qui se lit mais ne s'écrit jamais. */
         const entetes = Object.assign({
           'apikey': SUPABASE.anonKey,
           'Authorization': 'Bearer ' + (jeton || SUPABASE.anonKey),
           'Content-Type': 'application/json',
           'Accept-Profile': SUPABASE.schema,
           'Content-Profile': SUPABASE.schema
         }, (options && options.headers) || {});

         const r = await fetch(SUPABASE.url + '/rest/v1/' + chemin,
           Object.assign({ signal: ctrl.signal }, options || {}, { headers: entetes }));
         clearTimeout(to);
         /* Le réseau a répondu : on est en ligne, même si le serveur refuse. */
         STATE.delaisDepasses = 0;
         if (!STATE.enLigne) { STATE.enLigne = true; STATE.erreurBase = null; majBandeau(); }
         if (!r.ok) {
           const err = new Error('HTTP ' + r.status);
           err.http = r.status;
           /* Le corps de la réponse contient le vrai motif : contrainte violée,
              colonne inconnue, charge trop lourde. Sans lui, on en est réduit
              à deviner — ce qui a coûté une soirée entière. */
           let motif = '';
           try { motif = (await r.text()).slice(0, 300); } catch (x) {}
           err.motif = motif;
           if (r.status === 401 || r.status === 403) {
             /* Session expirée : on renouvelle et on REJOUE l'appel une fois.
                La version précédente levait une erreur marquée « pas HTTP »,
                que le bloc de secours prenait pour une panne réseau : chaque
                renouvellement réussi faisait passer l'application « hors ligne »
                et empilait la saisie. La file grossissait à chaque écriture. */
             if (!secondeChance && typeof renouveler === 'function' &&
                 typeof appareilRattache === 'function' && appareilRattache()) {
               let repare = false;
               try { repare = !!(await renouveler()); } catch (x) {}
               if (repare) {
                 STATE.erreurBase = null;
                 return await appel(chemin, options, true);
               }
             }
             const rattache = (typeof appareilRattache === 'function') ? appareilRattache() : true;
             STATE.erreurBase = rattache
               ? 'Session expirée — rattachez cet appareil'
               : 'Appareil non rattaché';
             if (!rattache) STATE.refusJusqua = Date.now() + 30000;
           }
           else if (r.status === 404) {
             /* Une table manquante ne réapparaîtra pas d'elle-même : inutile de
                réessayer cinq fois. On nomme la clé fautive dans le bandeau,
                sinon il faut fouiller la console d'un iPad pour la trouver. */
             err.definitif = true;
             STATE.erreurBase = 'Table introuvable pour « ' + chemin.split('?')[0] + ' »';
           }
           else if (r.status === 413) STATE.erreurBase = 'Donnée trop lourde';
           else STATE.erreurBase = 'Base en erreur (' + r.status + ')';
           STATE.dernierEchec = { chemin:chemin.split('?')[0], status:r.status,
                                  methode:(options && options.method) || 'GET',
                                  motif:motif, at:nowISO() };
           majBandeau();
           throw err;
         }
         /* Requête réussie : on efface l'erreur ET on rafraîchit l'affichage.
            Sans ce majBandeau(), le bandeau restait à l'écran indéfiniment. */
         if (STATE.erreurBase) { STATE.erreurBase = null; majBandeau(); }
         const txt = await r.text();
         return txt ? JSON.parse(txt) : null;
       } catch (e) {
         clearTimeout(to);
         /* Seule une vraie panne réseau bascule l'application hors ligne.
            Un dépassement de délai sur UNE requête n'en est pas une : le Wi-Fi
            d'une boutique peut traîner sans être coupé. Deux de suite, sans
            aucune réponse entre les deux, en sont une : la sonde ne tourne que
            hors ligne, elle ne tranchait donc jamais, et un Wi-Fi devenu muet
            en pleine journée faisait attendre 8 s chaque lecture (plus d'une
            minute pour Ma journée). Hors ligne, l'iPad lit sa copie aussitôt,
            et la sonde rétablit l'état en ligne dès que la base répond. */
         const estAbandon = e && (e.name === 'AbortError' ||
                                  /abort/i.test(String(e.message || '')));
         const dejaCompte = !!(e && e._delaiCompte);
         if (estAbandon && e && typeof e === 'object') e._delaiCompte = true;
         const muet = estAbandon && !dejaCompte && STATE.enLigne && ++STATE.delaisDepasses >= 2;
         if (STATE.enLigne && ((!e.http && !estAbandon) || muet)) {
           STATE.enLigne = false; STATE.delaisDepasses = 0; majBandeau();
         }
         throw e;
       }
     }
   
     return {
       mode: 'supabase',
       get local() { return dispo ? 'local' : 'memoire'; },
       get configure() { return configuré(); },
   
       async get(cle, defaut) {
         if (defaut === undefined) defaut = null;
         const cache = () => { try { const v = lire(cle); return v === null ? defaut : JSON.parse(v); } catch (e) { return defaut; } };
         if (!distant(cle) || !STATE.enLigne) return cache();
         /* Une saisie encore en file d'attente est plus récente que la copie du
            serveur : on garde la locale, sinon elle disparaît de l'écran. */
         if (fileLire().some(x => x.cle === cle)) return cache();
         try {
           const l = await appel(table(cle) + '?id=eq.' + encodeURIComponent(cle) + '&select=data&limit=1');
           if (!l || !l.length) return cache();
           ecrire(cle, JSON.stringify(l[0].data));
           return l[0].data === null ? defaut : l[0].data;
         } catch (e) { return cache(); }
       },
   
       async set(cle, valeur) {
         /* Mémoire locale pleine : on n'abandonne plus la saisie pour autant.
            En ligne, elle part quand même au serveur ; l'alerte « Mémoire
            pleine » ne s'affiche que si cet envoi échoue aussi (ou s'il est
            impossible) — c'est alors seulement que la saisie est perdue. */
         let horsMemoire = false;
         try { ecrire(cle, JSON.stringify(valeur)); }
         catch (e) { horsMemoire = true; }
         const memoirePleine = () => { toast('Mémoire pleine — libérez de l’espace sur l’iPad', 'erreur'); return false; };

         if (!distant(cle)) return horsMemoire ? memoirePleine() : true;

         /* Garde-fou : une journée de photos en base64 pèse plusieurs centaines
            de kilo-octets. Au-delà du seuil, on garde en local sans tenter
            l'envoi — sinon l'échec se répète et rallume le bandeau en boucle. */
         let poids = 0;
         try { poids = JSON.stringify(valeur).length; } catch (e) {}
         if (poids > OFFLINE.tailleMaxOctets) {
           if (!DB._gros[cle]) {
             DB._gros[cle] = poids;
             console.warn('Trop lourd pour la base (' + Math.round(poids / 1024) + ' Ko) :', cle);
           }
           return horsMemoire ? memoirePleine() : true;
         }

         /* Hors ligne et mémoire pleine : la file d'attente vit elle aussi en
            mémoire locale, elle ne peut rien garder. */
         if (!STATE.enLigne) {
           if (horsMemoire) return memoirePleine();
           await empiler('set', cle, valeur); return true;
         }
   
         /* Les clés partagées passent par une file : relire puis écrire doit
            être insensible aux écritures concurrentes. */
         const envoyer = async () => {
           const t0 = nowISO();
           try {
             let aEcrire = valeur;
             if (aFusionner(cle)) {
               /* Pas d'envoi sans relecture : la copie de l'iPad, envoyée telle
                  quelle, effaçait ce que les autres appareils avaient écrit
                  entre-temps (une correction de caisse du manager, par exemple).
                  Relecture impossible : l'écriture est traitée comme hors ligne
                  (catch ci-dessous) : mise en file et fusionnée au rejeu, ou
                  alerte « Mémoire pleine » si la file ne peut pas la garder. */
               const l = await appel(table(cle) + '?id=eq.' + encodeURIComponent(cle) +
                                     '&select=data&limit=1');
               if (l && l.length && l[0].data) {
                 aEcrire = fusionner(l[0].data, valeur, cle);
                 try { ecrire(cle, JSON.stringify(aEcrire)); } catch (x) {}
               }
             }
             await appel(table(cle), {
               method: 'POST',
               headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
               body: JSON.stringify({ id:cle, site:APP.site, data:aEcrire })
             });
             /* La valeur envoyée remplace toute écriture plus ancienne encore en
                file : la rejouer ensuite écraserait cette saisie plus récente. */
             const f = fileLire();
             const perimee = x => x.cle === cle && x.at <= t0;   // pas une saisie empilée depuis
             if (f.some(perimee)) fileEcrire(f.filter(x => !perimee(x)));
             return true;
           } catch (e) {
             if (horsMemoire) return memoirePleine();
             await empiler('set', cle, valeur); return true;
           }
         };
         return aFusionner(cle) ? enFile(cle, envoyer) : envoyer();
       },
   
       async push(cle, element) {
         const l = rognerAncien(cle, await this.get(cle, []));
         l.push(element);
         await this.set(cle, l);
         return l;
       },
   
       /* N'envoie QUE les champs modifiés, appliqués sur la copie du serveur
          relue juste avant (sous le verrou de la clé). Avant, l'objet entier
          partait — copie locale comprise : un iPad resté hors ligne rejouait à
          son retour des ventes et des imports périmés par-dessus ceux saisis
          entre-temps sur l'autre iPad. Hors ligne, l'écriture partielle entre
          en file telle quelle et sera rejouée de la même façon, dans l'ordre. */
       async patch(cle, champs, ajouts, plus) {
         const op = { champs:champs || {}, ajouts:ajouts || {}, plus:plus || {} };
         const o = appliquerPatch(await this.get(cle, {}), op);
         let horsMemoire = false;
         try { ecrire(cle, JSON.stringify(o)); }
         catch (e) { horsMemoire = true; }
         const memoirePleine = () => { toast('Mémoire pleine — libérez de l’espace sur l’iPad', 'erreur'); return o; };
         if (!distant(cle)) return horsMemoire ? memoirePleine() : o;
         if (!STATE.enLigne) {
           if (horsMemoire) return memoirePleine();
           await empiler('patch', cle, op); return o;
         }
         return enFile(cle, async () => {
           /* Des écritures plus anciennes de cette clé attendent encore : la
              nouvelle passe derrière elles, sinon leur rejeu l'écraserait. */
           if (fileLire().some(x => x.cle === cle)) {
             await empiler('patch', cle, op);
             setTimeout(journaliserSync, 0);
             return o;
           }
           try {
             /* Pas d'envoi sans relecture : la ligne entière serait remplacée
                par les seuls champs modifiés. */
             const l = await appel(table(cle) + '?id=eq.' + encodeURIComponent(cle) + '&select=data&limit=1');
             const data = appliquerPatch(l && l.length ? l[0].data : null, op);
             await appel(table(cle), {
               method: 'POST',
               headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
               body: JSON.stringify({ id:cle, site:APP.site, data:data })
             });
             try { ecrire(cle, JSON.stringify(data)); } catch (x) {}
             return data;
           } catch (e) {
             if (horsMemoire) return memoirePleine();
             await empiler('patch', cle, op); return o;
           }
         });
       },
   
       async list(prefixe) {
         const locales = clesLocales().filter(k => k.indexOf(prefixe) === 0);
         if (!configuré() || !STATE.enLigne) return locales.sort();
   
         /* Les tables absentes sont écartées ICI. Sans ce filtre, une route dont
            la table n'existe pas produisait l'URL « /rest/v1/undefined » : le
            serveur répondait 404, le bandeau « Table introuvable » s'allumait,
            et toute la synchronisation d'un iPad restait bloquée derrière.
            C'est par ce chemin que l'inventaire de Chamonix n'est jamais remonté. */
         const tables = (prefixe
           ? ROUTES.filter(r => r[0].indexOf(prefixe) === 0 || prefixe.indexOf(r[0]) === 0)
           : ROUTES)
           .map(r => r[1])
           .filter(t => t && t !== 'undefined');
         const vues = {}, out = locales.slice();
         for (const t of tables.filter(t => { if (vues[t]) return false; vues[t] = 1; return true; })) {
           try {
             const l = await appel(t + '?id=like.' + encodeURIComponent(prefixe + '%') + '&select=id&limit=2000');
             (l || []).forEach(r => { if (out.indexOf(r.id) < 0) out.push(r.id); });
           } catch (e) { /* le cache local a déjà été pris */ }
         }
         return out.sort();
       },
   
       async del(cle) {
         try { oter(cle); } catch (e) {}
         if (!distant(cle)) return;
         if (!STATE.enLigne) return empiler('del', cle, null);
         try { await appel(table(cle) + '?id=eq.' + encodeURIComponent(cle), { method:'DELETE' }); }
         catch (e) { await empiler('del', cle, null); }
       },
   
       /* Exposés pour la file d'attente et l'écran de réglages */
       _appel: appel, _table: table, _distant: distant, _clesLocales: clesLocales,
       _lire: lire, _ecrire: ecrire, _oter: oter, _gros: {}
     };
   })();
   
   /* -----------------------------------------------------------------------------
      FILE D'ATTENTE HORS-LIGNE
      Une écriture ratée n'est jamais perdue : elle est empilée avec son horodatage
      et rejouée dans l'ordre au retour du réseau. La dernière écriture d'une même
      clé écrase les précédentes, inutile de rejouer dix fois la même saisie.
      -------------------------------------------------------------------------- */
   /* « Transmis » seulement si c'est vrai : hors ligne, l'envoi attend dans la
      file de l'iPad (bandeau « saisies en attente ») et le manager ne le voit
      pas encore. */
   function messageEnvoi(cle, envoye) {
     try {
       if (fileLire().some(x => x.cle === cle)) return 'Enregistré sur l’iPad — envoi dès le retour du réseau';
     } catch (e) {}
     return envoye;
   }

   function fileLire() {
     try {
       const v = DB._lire(OFFLINE.fileAttente);
       const f = v ? JSON.parse(v) : [];
       /* On écarte à la lecture les entrées dont la clé n'a plus de table :
          elles dateraient d'une version antérieure et bloqueraient la file. */
       const propres = f.filter(x => x && x.cle && DB._table(x.cle));
       if (propres.length !== f.length) {
         try { DB._ecrire(OFFLINE.fileAttente, JSON.stringify(propres)); } catch (e) {}
       }
       /* Le compteur suit TOUJOURS la file. Sans cette ligne, une purge
          silencieuse laissait « 2 en attente » affiché alors que la file était
          vide — un reproche permanent pour un travail déjà fait. */
       if (STATE.fileAttente !== propres.length) {
         STATE.fileAttente = propres.length;
         majBandeau();
       }
       return propres;
     } catch (e) { return []; }
   }
   function fileEcrire(f) {
     /* L'échec n'est plus avalé : une saisie qui n'entre pas dans la file est
        une saisie perdue, la personne doit le savoir. Le compteur reste alors
        sur la file réellement enregistrée. */
     try { DB._ecrire(OFFLINE.fileAttente, JSON.stringify(f)); }
     catch (e) {
       toast('Saisie non mise en file — mémoire pleine', 'erreur');
       return false;
     }
     STATE.fileAttente = f.length;
     majBandeau();
     return true;
   }
   
   async function empiler(op, cle, valeur) {
     /* Une écriture partielle ne remplace pas la précédente : chacune ne porte
        que ses propres champs, toutes sont rejouées dans l'ordre. */
     const f = op === 'patch' ? fileLire() : fileLire().filter(x => !(x.cle === cle && x.op === op));
     f.push({ op:op, cle:cle, valeur:valeur, at:nowISO(), n:uid(), essais:0 });
     fileEcrire(f);
   }
   
   let syncEnCours = false;
   let derniereSync = null;
   async function journaliserSync() {
     if (syncEnCours || !DB.configure) return;
     /* On se fie au navigateur, pas à notre propre drapeau : c'est ce qui permet
        à la file de se débloquer toute seule après une erreur passagère. */
     if (!navigator.onLine) return;
     let f = fileLire();
     if (!f.length) return;
   
     syncEnCours = true;
     /* « n » distingue deux écritures partielles de la même milliseconde. */
     const id = x => x.op + '|' + x.cle + '|' + x.at + '|' + (x.n || '');
     const restants = [];
     /* Clés dont une écriture vient d'échouer : les suivantes de la même clé
        attendent leur tour. Rejouées avant elle, des écritures partielles
        plus récentes seraient écrasées par la plus ancienne. */
     const bloquees = new Set();
     let envoyes = 0;
     for (const item of f) {
       /* Remplacée ou déjà envoyée pendant la synchro : on ne rejoue pas une
          valeur périmée par-dessus une plus récente. */
       if (!fileLire().some(x => id(x) === id(item))) continue;
       if (bloquees.has(item.cle)) { restants.push(item); continue; }
       /* Une clé sans table ne peut pas partir : on l'abandonne au lieu
          d'appeler /rest/v1/undefined en boucle. La donnée reste en local. */
       if (!DB._table(item.cle)) {
         console.warn('Clé non routée, abandonnée de la file :', item.cle);
         continue;
       }
       try {
         if (item.op === 'del') {
           await DB._appel(DB._table(item.cle) + '?id=eq.' + encodeURIComponent(item.cle), { method:'DELETE' });
         } else if (item.op === 'patch') {
           /* Écriture partielle : appliquée sur la copie du serveur relue sous
              le verrou de la clé. Relecture impossible : on n'envoie rien (les
              seuls champs modifiés remplaceraient la ligne entière) et l'on
              réessaiera. Retirée de la file dès qu'elle est passée, pour qu'une
              écriture lancée juste après ne la rejoue pas une seconde fois. */
           const parti = await enFile(item.cle, async () => {
             if (!fileLire().some(x => id(x) === id(item))) return false;
             const t = DB._table(item.cle);
             const l = await DB._appel(t + '?id=eq.' + encodeURIComponent(item.cle) + '&select=data&limit=1');
             await DB._appel(t, {
               method: 'POST',
               headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
               body: JSON.stringify({ id:item.cle, site:APP.site,
                                      data:appliquerPatch(l && l.length ? l[0].data : null, item.valeur || {}) })
             });
             fileEcrire(fileLire().filter(x => id(x) !== id(item)));
             return true;
           });
           if (!parti) continue;
         } else if (!aFusionner(item.cle)) {
           await DB._appel(DB._table(item.cle), {
             method: 'POST',
             headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
             body: JSON.stringify({ id:item.cle, site:APP.site, data:item.valeur })
           });
         } else {
           /* Comme DB.set, et sous le même verrou : une clé partagée est
              fusionnée avec la copie du serveur, sinon la saisie hors ligne
              écrase celles des autres iPads — ou une saisie faite pendant la
              synchro sur ce même appareil. */
           const parti = await enFile(item.cle, async () => {
             if (!fileLire().some(x => id(x) === id(item))) return false;
             let data = item.valeur;
             /* Relecture impossible : on n'envoie rien, comme pour une écriture
                partielle. La copie rejouée sans fusion effaçait les saisies des
                autres iPads. L'erreur suit le sort d'un envoi raté (ci-dessous) :
                gardée en file, sauf table absente ou refus répétés. */
             const l = await DB._appel(DB._table(item.cle) + '?id=eq.' + encodeURIComponent(item.cle) +
                                       '&select=data&limit=1');
             if (l && l.length && l[0].data) data = fusionner(l[0].data, item.valeur, item.cle);
             await DB._appel(DB._table(item.cle), {
               method: 'POST',
               headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
               body: JSON.stringify({ id:item.cle, site:APP.site, data:data })
             });
             return true;
           });
           if (!parti) continue;
         }
         envoyes++;
       } catch (e) {
         /* Échec définitif — table absente : on n'insiste pas, la donnée reste
            en local et le bandeau nomme la clé. Cinq tentatives inutiles ne
            faisaient que rallumer l'alerte pendant deux minutes. */
         if (e && e.definitif) {
           console.warn('Écriture abandonnée (table absente) :', item.cle);
           continue;
         }
         /* Seul un refus du serveur sur la donnée elle-même (400, 409, 413…)
            compte comme un essai. Réseau coupé, délai, 5xx ou session expirée
            sont passagers : abandonner après cinq essais, soit deux minutes de
            Wi-Fi muet, perdait la saisie pour de bon. */
         const refus = e && e.http >= 400 && e.http < 500 &&
                       [401, 403, 408, 429].indexOf(e.http) < 0;
         if (refus) item.essais = (item.essais || 0) + 1;
         if (!refus || item.essais < OFFLINE.tentatives) { restants.push(item); bloquees.add(item.cle); }
         else console.warn('Écriture abandonnée après ' + item.essais + ' refus :', item.cle);
       }
     }
     /* Relecture de la file : une saisie empilée PENDANT la synchro ne doit pas
        être effacée par la réécriture, et une entrée remplacée entre-temps ne
        doit pas revenir. */
     const actuelle = fileLire();
     const presents = new Set(actuelle.map(id));
     const vus = new Set(f.map(id));
     fileEcrire(restants.filter(r => presents.has(id(r)))
                .concat(actuelle.filter(x => !vus.has(id(x)))));
     syncEnCours = false;
   
     const partis = envoyes;
     if (partis > 0) {
       derniereSync = nowISO();
       if (STATE.user) toast(partis + ' saisie(s) synchronisée(s)');
     }
   }
   
   /* Le réseau revient, ou l'onglet reprend le focus : on vide la file. */
   window.addEventListener('online', () => setTimeout(journaliserSync, 800));
   document.addEventListener('visibilitychange', () => { if (!document.hidden) journaliserSync(); });
   setInterval(journaliserSync, OFFLINE.intervalleSyncMs);
   
   /* =============================================================================
      3. UI DE BASE
      ========================================================================== */
   function toast(msg, type) {
     const t = $('#toast');
     /* Une erreur reste plus longtemps, se distingue visuellement et est
        annoncée tout de suite par VoiceOver (role="alert"). */
     const erreur = (type === 'erreur');
     t.textContent = msg;
     t.classList.toggle('erreur', erreur);
     t.setAttribute('role', erreur ? 'alert' : 'status');
     t.classList.add('on');
     vibrer(erreur ? UI.vibration.erreur : UI.vibration.ok);
     clearTimeout(t._t);
     t._t = setTimeout(() => t.classList.remove('on'), erreur ? 5000 : UI.dureeToastMs);
   }

   /* -----------------------------------------------------------------------------
      HISTORIQUE DE LA FEUILLE
      showSheet ajoute UNE entrée d'historique ; closeSheet la retire par
      history.back(). Ce retour est différé d'un tour : si une autre feuille
      s'ouvre aussitôt (confirmer après fermeture) elle reprend l'entrée au lieu
      d'en empiler une nouvelle, et si une vue se dessine, elle la remplace.
      Le popstate provoqué par notre propre retour est ignoré : pas de boucle.
      -------------------------------------------------------------------------- */
   let _feuilleHisto = false;     // la feuille ouverte a son entrée d'historique
   let _retourPrevu = null;       // history.back() différé, encore annulable
   let _ignorerPop = false;       // le prochain popstate vient de closeSheet
   let _feuilleModifiee = false;  // un champ de la feuille a été touché

   /* Pousse une entrée d'historique, ou remplace celle d'une feuille qu'on
      vient de fermer : la consommer puis en pousser une autre ferait un aller-
      retour inutile — et le retour différé effacerait l'entrée de la vue. */
   function pousserHistorique(etat) {
     try {
       if (_retourPrevu) {
         clearTimeout(_retourPrevu); _retourPrevu = null;
         history.replaceState(etat, '', location.pathname);
       } else {
         history.pushState(etat, '', location.pathname);
       }
     } catch (e) {}
   }

   function showSheet(html) {
     const sheet = $('#sheet');
     const dejaOuverte = !sheet.hidden;
     $('#sheet-corps').innerHTML = html;
     sheet.hidden = false;
     /* Contenu neuf : ni modifié, ni obligatoire tant que l'appelant ne le dit pas. */
     delete sheet.dataset.obligatoire;
     /* Toute nouvelle feuille retire le marqueur d'un minuteur en cours. */
     delete sheet.dataset.minuteur;
     _feuilleModifiee = false;
     document.body.style.overflow = 'hidden';
     /* Une entrée d'historique pour la feuille : le bouton retour du téléphone
        la referme au lieu de quitter l'écran, voire l'application. Une seule
        par feuille, même si son contenu est remplacé. */
     if (_retourPrevu) {
       clearTimeout(_retourPrevu); _retourPrevu = null;
       _feuilleHisto = true;
     } else if (!dejaOuverte || !_feuilleHisto) {
       try {
         history.pushState({ vue:STATE.view, feuille:true }, '', location.pathname);
         _feuilleHisto = true;
       } catch (e) { _feuilleHisto = false; }
     }
     $$('[data-fermer]').forEach(b => b.onclick = b.classList.contains('voile') ? toucherVoile : closeSheet);
     const p = $('#sheet-corps input, #sheet-corps textarea');
     if (p && p.dataset.autofocus !== undefined) setTimeout(() => p.focus(), 120);
   }
   function closeSheet() {
     $('#sheet').hidden = true;
     delete $('#sheet').dataset.obligatoire;
     delete $('#sheet').dataset.minuteur;
     document.body.style.overflow = '';
     if (_feuilleHisto) {
       _feuilleHisto = false;
       clearTimeout(_retourPrevu);
       _retourPrevu = setTimeout(() => {
         _retourPrevu = null;
         _ignorerPop = true;
         try { history.back(); } catch (e) { _ignorerPop = false; }
       }, 0);
     }
     /* Rôle changé pendant que cette feuille était ouverte (revaliderSession) :
        on redessinait seulement à la relecture suivante de l'équipe, cinq
        minutes plus tard, et l'ancien manager gardait ses onglets d'ici là. */
     if (_roleARedessiner) setTimeout(appliquerNouveauRole, 0);
   }

   /* Tout champ touché par l'utilisateur marque la feuille comme modifiée.
      Une valeur posée par le code ne déclenche pas « input » : seul un vrai
      geste compte. */
   (function () {
     const corps = document.getElementById('sheet-corps');
     if (!corps) return;
     const marquer = e => {
       if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) _feuilleModifiee = true;
     };
     corps.addEventListener('input', marquer);
     corps.addEventListener('change', marquer);
   })();

   /* Étiquettes reliées aux champs. Les gabarits posent <label class="f">
      sans « for » à côté du champ : un lecteur d'écran annonçait près de
      150 champs sans nom, et toucher l'étiquette ne plaçait pas le curseur.
      Plutôt que reprendre chaque gabarit, chaque étiquette est reliée au
      champ de son bloc .champ, à chaque changement de la page ou de la
      feuille. Seuls les nœuds ajoutés sont observés : poser « for » ou un
      id ne relance pas l'observateur. */
   (function () {
     let n = 0;
     const relier = racine => $$('.champ > label.f:not([for])', racine).forEach(l => {
       const c = l.parentNode.querySelector('input:not([type=hidden]), select, textarea');
       if (!c) return;
       if (!c.id) c.id = 'champ-' + (++n);
       l.htmlFor = c.id;
     });
     if (typeof MutationObserver === 'undefined') return;
     ['page', 'sheet-corps'].forEach(id => {
       const r = document.getElementById(id);
       if (r) new MutationObserver(() => relier(r)).observe(r, { childList:true, subtree:true });
     });
   })();

   /* Toucher le voile : une feuille obligatoire reste ouverte, et une saisie
      commencée n'est pas jetée sans confirmation. « Continuer la saisie »
      remet la feuille telle quelle — mêmes nœuds, mêmes valeurs, mêmes
      gestionnaires. */
   function toucherVoile() {
     const sheet = $('#sheet');
     if (sheet.dataset.obligatoire) return toast('Faites un choix pour continuer', 'erreur');
     if (!_feuilleModifiee) return closeSheet();
     const corps = $('#sheet-corps');
     const garde = document.createDocumentFragment();
     while (corps.firstChild) garde.appendChild(corps.firstChild);
     confirmer('Abandonner la saisie ?',
       'Ce que vous avez saisi dans cette fenêtre sera perdu.',
       'Abandonner', () => {},
       () => {
         corps.innerHTML = '';
         corps.appendChild(garde);
         _feuilleModifiee = true;
       }, 'Continuer la saisie');
   }

   document.addEventListener('keydown', e => {
     if (e.key === 'Escape' && !$('#sheet').hidden && !$('#sheet').dataset.obligatoire) closeSheet();
   });

   /* Confirmation destructive — jamais de suppression sur simple appui.
      onNon (facultatif) remplace la fermeture simple sur « Annuler ». */
   function confirmer(titre, texte, libelle, onOui, onNon, libelleNon) {
     showSheet(
       '<h2 id="sheet-titre">' + esc(titre) + '</h2>' +
       '<p class="sub">' + esc(texte) + '</p>' +
       '<div class="actions"><button class="btn clair" data-fermer>' + esc(libelleNon || 'Annuler') + '</button>' +
       '<button class="btn corail" id="cf-oui">' + esc(libelle) + '</button></div>'
     );
     $('#cf-oui').onclick = () => { closeSheet(); onOui(); };
     if (typeof onNon === 'function') {
       const non = $('#sheet-corps [data-fermer]');
       if (non) non.onclick = onNon;
     }
   }
   
   function majBandeau() {
     const b = $('#offline');
     if (!b) return;
     const msg = b.querySelector('.msg');
   
     /* Sans clés Supabase, tout est local par choix : pas de bandeau alarmiste. */
     const configure = (typeof DB !== 'undefined' && DB.configure);
     if (!configure) { b.classList.remove('on'); return; }

     /* Un bandeau qui annonce un problème sans offrir de solution est un
        cul-de-sac : on le rend cliquable quand l'action existe. */
     const besoinRattachement = STATE.erreurBase &&
       /rattach|expir/i.test(STATE.erreurBase);
     b.classList.toggle('agir', !!besoinRattachement);
     b.onclick = besoinRattachement ? reparerSession : null;

     if (STATE.erreurBase) {
       b.classList.add('on');
       if (msg) msg.textContent = besoinRattachement
         ? STATE.erreurBase + ' — touchez ici'
         : STATE.erreurBase + ' — vos saisies restent sur l’iPad';
     } else if (!STATE.enLigne) {
       b.classList.add('on');
       /* Le message ne parle de saisies en attente que s'il y en a vraiment. */
       if (msg) msg.textContent = STATE.fileAttente
         ? 'Hors ligne — vos saisies partiront toutes seules'
         : 'Hors ligne — vous pouvez continuer normalement';
     } else {
       b.classList.remove('on');
     }
     $('#offline-n').textContent = STATE.fileAttente
       ? '· ' + STATE.fileAttente + (STATE.fileAttente > 1 ? ' saisies' : ' saisie') + ' en attente'
       : '';
   }

   /* Réparation en un geste : on tente d'abord un renouvellement silencieux,
      et on ne dérange la personne que si celui-ci échoue vraiment. */
   let reparationEnCours = false;
   async function reparerSession() {
     if (reparationEnCours) return;
     reparationEnCours = true;
     try {
       if (typeof renouveler === 'function') {
         const s = await renouveler();
         if (s) {
           STATE.erreurBase = null;
           majBandeau();
           if (typeof journaliserSync === 'function') await journaliserSync();
           majBandeau();
           toast('Connexion rétablie');
           return;
         }
       }
       if (typeof ecranRattachement === 'function') {
         await ecranRattachement();
         STATE.erreurBase = null;
         majBandeau();
         if (typeof journaliserSync === 'function') await journaliserSync();
         majBandeau();
         toast('Appareil rattaché');
       }
     } catch (e) {
       toast('Échec du rattachement', 'erreur');
     } finally {
       reparationEnCours = false;
     }
   }
   
   /* Sonde légère : rétablit l'état en ligne dès que la base répond de nouveau. */
   let sondeEnCours = false;
   /* Table de sondage résolue UNE FOIS, avec repli. SUPABASE.tables.journal
      n'existe pas — la clé correcte est « feed ». La sonde appelait donc
      « /rest/v1/undefined » toutes les quinze secondes, ce qui rallumait le
      bandeau à l'infini. Pire : la sonde ne tourne QUE s'il y a une erreur,
      et elle en créait une — l'alerte ne pouvait plus jamais s'éteindre. */
   const TABLE_SONDE = SUPABASE.tables.feed || SUPABASE.tables.journal || 'journal';

   async function sonderReseau() {
     if (sondeEnCours || !navigator.onLine || !DB.configure) return;
     if (STATE.enLigne && !STATE.erreurBase) return;
     sondeEnCours = true;
     try {
       await DB._appel(TABLE_SONDE + '?select=id&limit=1');
       STATE.enLigne = true; STATE.erreurBase = null;
       majBandeau();
       journaliserSync();
     } catch (e) { /* toujours indisponible */ }
     sondeEnCours = false;
   }
   
   window.addEventListener('online',  () => { STATE.enLigne = true; STATE.delaisDepasses = 0; STATE.erreurBase = null; majBandeau(); sonderReseau(); });
   window.addEventListener('offline', () => { STATE.enLigne = false; STATE.delaisDepasses = 0; majBandeau(); });
   setInterval(sonderReseau, 15000);
   
   /* Fragments réutilisables */
   const carte = (contenu, cls) => '<div class="card ' + (cls || '') + '">' + contenu + '</div>';
   /* L'icône passée en premier argument est ignorée : un emoji devant chaque
      titre de carte est la marque la plus visible d'une interface improvisée.
      Le paramètre reste dans la signature pour ne pas toucher aux 80 appels. */
   const entete = (icone, titre, sous) =>
     '<div class="ch"><h2>' + esc(titre) + '</h2></div>' +
     (sous ? '<div class="cs">' + esc(sous) + '</div>' : '');
   const vide = (icone, texte) => '<div class="vide">' + esc(texte) + '</div>';
   const pastille = (cls, txt) => '<span class="pill ' + cls + '">' + esc(txt) + '</span>';
   const avatar = (e, cls) =>
     '<span class="' + (cls || 'av') + '" style="background:' + esc(e.couleur) + '">' + esc(e.initiales) + '</span>';

   /* Prénom du premier manager de l'équipe, « le manager » à défaut. Le prénom
      était écrit en dur : une autre boutique, ou un changement de manager,
      faisait appeler quelqu'un qui n'y travaille pas. Texte brut : à passer
      par esc() avant tout innerHTML. */
   function nomManager() {
     const m = (typeof EQUIPE !== 'undefined' ? EQUIPE : []).filter(e => e && e.role === 'manager')[0];
     return (m && m.prenom) || 'le manager';
   }
   /* Même chose en début de phrase. */
   const NomManager = () => { const n = nomManager(); return n.charAt(0).toUpperCase() + n.slice(1); };
   
   /* =============================================================================
      4. CONNEXION TACTILE
      ========================================================================== */
   function initLogin() {
     $('#login-site').textContent = APP.site;
   
     $('#qui-liste').innerHTML = EQUIPE.map(e =>
       '<button type="button" data-qui="' + esc(e.id) + '">' +
         avatar(e) +
         '<span class="nm">' + esc(e.prenom) + '</span>' +
         '<span class="rl">' + ROLES[e.role].label + '</span>' +
       '</button>'
     ).join('');
   
     $$('#qui-liste [data-qui]').forEach(b => b.onclick = () => ouvrirPin(b.dataset.qui));
     $$('#pin-pave [data-k]').forEach(b => b.onclick = () => toucheP(b.dataset.k));
     $('#pin-retour').onclick = retourQui;

     /* Accès à la remise à zéro avant toute connexion : indispensable sur une
        tablette où l'on ne peut pas ouvrir la console du navigateur. */
     const rz = $('#lg-reset');
     if (rz) rz.onclick = function () { ecranRemiseAZero(false); };
   
     /* Une seule fois : initLogin est rappelée à chaque démarrage et après le
        rattachement, et chaque écouteur en plus doublait la touche tapée. */
     if (!initLogin._clavier) {
       initLogin._clavier = true;
       document.addEventListener('keydown', e => {
         if ($('#login').hidden || $('#login-pin').hidden) return;
         /* Une feuille est ouverte par-dessus (remise à zéro) : la frappe est à
            elle, pas au pavé caché dessous. */
         if (!$('#sheet').hidden || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) return;
         if (/^[0-9]$/.test(e.key)) toucheP(e.key);
         else if (e.key === 'Backspace') toucheP('effacer');
         else if (e.key === 'Escape') retourQui();
       });
     }
   }
   
   function ouvrirPin(id) {
     const e = EQUIPE.filter(x => x.id === id)[0];
     if (!e) return;
     STATE._candidat = e;
     STATE._pin = '';
     $('#pin-nom').textContent = e.prenom;
     $('#pin-av').textContent = e.initiales;
     $('#pin-av').style.background = e.couleur;
     $('#pin-aide').textContent = 'Composez votre code à 4 chiffres';
     $('#login-qui').hidden = true;
     $('#login-pin').hidden = false;
     majPoints();
     if (pinBloqueMs()) afficherBlocagePin();
   }
   
   function retourQui() {
     STATE._candidat = null;
     STATE._pin = '';
     $('#login-pin').hidden = true;
     $('#login-qui').hidden = false;
   }
   
   function majPoints(erreur) {
     const c = $('#pin-points');
     c.classList.toggle('err', !!erreur);
     $$('#pin-points i').forEach((p, i) => p.classList.toggle('on', i < STATE._pin.length));
   }
   
   function toucheP(k) {
     if (k === 'annuler') return retourQui();
     if (k === 'effacer') { STATE._pin = STATE._pin.slice(0, -1); return majPoints(); }
     /* Saisie bloquée après trop d'échecs : on n'accepte aucun chiffre. */
     if (pinBloqueMs()) { STATE._pin = ''; majPoints(); afficherBlocagePin(); return; }
     if (STATE._pin.length >= 4) return;
     STATE._pin += k;
     vibrer(UI.vibration.ok);
     majPoints();
     if (STATE._pin.length === 4) setTimeout(verifierPin, 140);
   }
   
   /* -----------------------------------------------------------------------------
      ANTI-ESSAIS DU CODE PIN
      Quatre chiffres, c'est 10 000 combinaisons : sans frein, un après-midi
      suffit. Après 5 échecs de suite, la saisie est bloquée 30 s, puis 60 s,
      120 s… à chaque nouvelle série, sans dépasser 15 min. Le compteur survit au rechargement
      (clé locale « pinEchecs », jamais envoyée au serveur).
      -------------------------------------------------------------------------- */
   const PIN_ESSAIS = 5, PIN_BLOCAGE_MS = 30000;
   /* Plafond du blocage : 15 min. Sans lui, le doublement à chaque série
      finissait par bloquer la tablette des heures, voire des jours, pour
      toute l'équipe (le compteur est commun). */
   const PIN_BLOCAGE_MAX_MS = 900000;
   const PIN_CLE = 'pinEchecs';      // stockée sous « pilotshop.v3:pinEchecs »
   let pinEchecs = (function () {
     try {
       const v = JSON.parse(DB._lire(PIN_CLE) || 'null');
       if (v && typeof v === 'object') {
         const o = { n:+v.n || 0, series:+v.series || 0, jusqua:+v.jusqua || 0 };
         /* Horloge reculée (ou ancien blocage non plafonné) : la fin du blocage
            ne peut pas être plus loin que maintenant + plafond. */
         const borne = Date.now() + PIN_BLOCAGE_MAX_MS;
         if (o.jusqua > borne) o.jusqua = borne;
         return o;
       }
     } catch (e) {}
     return { n:0, series:0, jusqua:0 };
   })();
   function sauverPinEchecs() {
     try { DB._ecrire(PIN_CLE, JSON.stringify(pinEchecs)); } catch (e) {}
   }
   /* Millisecondes de blocage restantes, 0 si la saisie est libre. */
   const pinBloqueMs = () => Math.max(0, pinEchecs.jusqua - Date.now());

   function afficherBlocagePin() {
     clearTimeout(afficherBlocagePin._t);
     const reste = pinBloqueMs();
     const aide = $('#pin-aide');
     if (!reste) { if (aide) aide.textContent = 'Composez votre code à 4 chiffres'; return; }
     if (aide) aide.textContent = 'Trop d’essais — réessayez dans ' + Math.ceil(reste / 1000) + ' s';
     afficherBlocagePin._t = setTimeout(afficherBlocagePin, 1000);
   }

   async function verifierPin() {
     const e = STATE._candidat;
     if (!e) return retourQui();
     /* Vérification lancée 140 ms après le 4e chiffre : si la personne a
        effacé entre-temps, on ne juge pas trois chiffres (« Code incorrect »
        et un essai compté pour le blocage alors qu'elle corrigeait). */
     if (STATE._pin.length !== 4) return;

     if (pinBloqueMs()) {
       STATE._pin = '';
       majPoints(false);
       afficherBlocagePin();
       return;
     }

     if (!(await pinCorrect(e, STATE._pin))) {
       majPoints(true);
       vibrer(UI.vibration.erreur);
       STATE._pin = '';
       pinEchecs.n++;
       if (pinEchecs.n >= PIN_ESSAIS) {
         /* 30 s, puis le double à chaque nouvelle série de 5 échecs, plafonné à 15 min. */
         pinEchecs.jusqua = Date.now() + Math.min(PIN_BLOCAGE_MAX_MS,
           PIN_BLOCAGE_MS * Math.pow(2, Math.min(pinEchecs.series, 10)));
         pinEchecs.series++;
         pinEchecs.n = 0;
       }
       sauverPinEchecs();
       if (pinBloqueMs()) afficherBlocagePin();
       else $('#pin-aide').textContent = 'Code incorrect, réessayez';
       setTimeout(() => majPoints(false), 420);
       return;
     }

     /* Code juste : on repart de zéro. */
     pinEchecs = { n:0, series:0, jusqua:0 };
     sauverPinEchecs();

     STATE.user = { id:e.id, prenom:e.prenom, role:e.role, couleur:e.couleur, initiales:e.initiales };
     STATE._pin = '';
     await DB.set('session', Object.assign({}, STATE.user, { vu:Date.now() }));
     _sessionTouchee = Date.now();
     await chargerService();
     /* Comme pour la reprise de session : les prénoms s'affichent dès
        qu'app.js s'exécute, avant modules.js et stock.js, et demarrer() sans
        eux ouvrait des vues indisponibles. */
     await documentPret;
     /* Un échec de démarrage ne doit plus laisser l'équipière devant un écran
        de connexion muet alors que sa session est ouverte. */
     try {
       demarrer();
     } catch (err) {
       console.error('Démarrage :', err);
       $('#login').hidden = true;
       $('#app').hidden = false;
       $('#page').innerHTML = carte(
         entete('⚠️', 'L’application n’a pas pu s’ouvrir',
           String(err && err.message || err)) +
         '<button class="btn clair bloc" id="demarrage-recharger">Recharger</button>');
       /* Pas d'onclick en ligne : la politique de sécurité le bloquerait. */
       $('#demarrage-recharger').onclick = () => location.reload();
     }
   }
   
   async function chargerService() {
     const l = await DB.get('pointage:' + today(), []);
     let ouverte = l.filter(s => s.employe === STATE.user.id && !s.fin)[0];
     /* Le jour de début est gardé avec la session : c'est sous lui qu'elle
        sera clôturée, même si la fin tombe après minuit. */
     if (ouverte && !ouverte.jour) ouverte.jour = today();
     /* Service de nuit : commencé hier soir, pas encore clos après minuit.
        Il est rangé sous la veille ; on l'y retrouve avec son jour de début. */
     if (!ouverte) {
       const veille = addD(today(), -1);
       const lv = await DB.get('pointage:' + veille, []);
       /* Au-delà de 14 h, c'est un oubli de pointage de sortie, pas un service en cours. */
       ouverte = (Array.isArray(lv) ? lv : []).filter(s => s.employe === STATE.user.id && !s.fin &&
         Date.now() - new Date(s.debut).getTime() < 14 * 3600000)[0];
       if (ouverte && !ouverte.jour) ouverte.jour = veille;
     }
     STATE.service = ouverte || null;
   }
   
   async function pointer(entree) {
     /* La clôture se range sous le jour de DÉBUT du service. Avec today(), un
        service commencé à 22 h et terminé à 0 h 30 cherchait sa session dans
        le mauvais jour : la fin n'était jamais enregistrée. */
     const jour = (!entree && STATE.service && STATE.service.jour) || today();
     const cle = 'pointage:' + jour;
     const l = await DB.get(cle, []);
     if (entree) {
       const s = { id:uid(), employe:STATE.user.id, prenom:STATE.user.prenom, debut:nowISO(), fin:null, jour:jour };
       l.push(s);
       STATE.service = s;
       await DB.set(cle, l);
       await feed('ok', STATE.user.prenom + ' a pris son service');
       toast('Bon service, ' + STATE.user.prenom);
     } else {
       const s = l.filter(x => x.id === (STATE.service && STATE.service.id))[0];
       if (s) { s.fin = nowISO(); s.minutes = Math.round((new Date(s.fin) - new Date(s.debut)) / 60000); }
       STATE.service = null;
       await DB.set(cle, l);
       await feed('ok', STATE.user.prenom + ' a terminé son service');
       toast('Service terminé');
     }
     rendre(STATE.view);
   }
   
   function deconnexion() {
     confirmer('Se déconnecter ?', 'Votre pointage reste enregistré. L’appareil reviendra à l’écran des prénoms.',
       'Se déconnecter', async () => {
         await DB.del('session');
         location.reload();
       });
   }
   
   /* =============================================================================
      5. JOURNAL D'ACTIVITÉ
      ========================================================================== */
   async function feed(niveau, texte) {
     try {
       const cle = 'feed:' + today();
       const l = await DB.get(cle, []);
       /* Un double appui sur iPad ne doit pas produire deux lignes identiques. */
       const dernier = l[l.length - 1];
       if (dernier && dernier.x === texte &&
           (Date.now() - new Date(dernier.at)) < 60000) return;
       l.push({ n:niveau, x:texte, par:STATE.user ? STATE.user.prenom : '—',
                id:STATE.user ? STATE.user.id : null, at:nowISO() });
       await DB.set(cle, l.slice(-400));
     } catch (e) {}
   }
   
   /* =============================================================================
      6. NAVIGATION
      ========================================================================== */
   const V = {};   // vues, remplies ici et en partie 2
   
/* -----------------------------------------------------------------------------
   ICONÔGRAPHIE
   Tracés SVG au filet, 24 px, héritant de la couleur du texte. Les emojis ont
   été retirés parce qu'ils datent l'interface ; les remplacer par rien n'était
   pas mieux. Une information ne doit jamais reposer sur la seule couleur :
   forme, poids et libellé la portent aussi.
   -------------------------------------------------------------------------- */
const TRACES = {
  journee:  'M4 11l8-7 8 7M6 10v9h12v-9M10 19v-5h4v5',
  nettoyage:'M10 3h3v3h-3zM8 6h7v14H8zM11 10v3M17 4h2M17 7h2M18 10h1',
  tracabilite:'M4 7h16M4 12h16M4 17h10M17 15l3 3-3 3',
  reassort: 'M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v10',
  temperature:'M12 3a2 2 0 012 2v8a4 4 0 11-4 0V5a2 2 0 012-2zM12 9v5M17 6h3M17 10h3',
  anomalie: 'M12 3l9 16H3zM12 9v5M12 16.5v.5',
  controle: 'M3 17a9 9 0 1118 0M12 17l5-6',
  ecarts:   'M4 20V9M10 20V4M16 20v-7M22 20H2',
  frigo:    'M12 3v18M3 12h18M6 6l12 12M18 6L6 18',
  periodes: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M9 15h2M14 15h2',
  plus:     'M6 12h.01M12 12h.01M18 12h.01',
  photo:    'M4 8h3l2-2h6l2 2h3v12H4zM12 17a4 4 0 110-8 4 4 0 010 8z',
  gauche:   'M15 5l-7 7 7 7',
  droite:   'M9 5l7 7-7 7',
  valide:   'M4 12l5 5L20 7',
  service:  'M13 2L4 14h7l-1 8 9-12h-7z',
  matin:    'M12 6a6 6 0 100 12 6 6 0 000-12zM12 2v2M12 20v2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4',
  soir:     'M20 14a8.5 8.5 0 01-10.5-10.5A8.5 8.5 0 1020 14z'
};
function ic(nom, taille) {
  const d = TRACES[nom];
  if (!d) return '';
  const t = taille || 24;
  return '<svg class="ic" width="' + t + '" height="' + t + '" viewBox="0 0 24 24" ' +
    'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
}

function renderNav() {
     const onglets = TABS[STATE.user.role] || TABS.equipe;
     $('#tabbar').innerHTML = onglets.map(t =>
       '<button type="button" class="tab' + (STATE.view === t.id ? ' on' : '') + '" data-tab="' + t.id + '">' +
         ic(t.id === 'accueil' ? 'journee' : t.id === 'clean' ? 'nettoyage' :
            t.id === 'lots' ? 'tracabilite' : t.id === 'reas' ? 'reassort' :
            t.id === 'temp' ? 'temperature' : t.id === 'anomalie' ? 'anomalie' :
            t.id === 'controle' ? 'controle' : t.id === 'ecarts' ? 'ecarts' :
            t.id === 'frigo' ? 'frigo' : t.id === 'periodes' ? 'periodes' : 'plus', 22) +
         '<span class="tl">' + esc(t.label) + '</span>' +
         '<span class="badge" data-badge="' + t.id + '" hidden></span>' +
       '</button>'
     ).join('');
     $$('#tabbar [data-tab]').forEach(b => b.onclick = () => {
       b.dataset.tab === 'plus' ? ouvrirPlus() : rendre(b.dataset.tab);
     });
   }
   
   function badge(tab, n, pulse) {
     const b = $('[data-badge="' + tab + '"]');
     if (!b) return;
     b.hidden = !n;
     b.textContent = n > 99 ? '99+' : n;
     b.classList.toggle('pulse', !!pulse);
   }
   
   function ouvrirPlus() {
     const liste = MENU_PLUS[STATE.user.role] || MENU_PLUS.equipe;
     showSheet(
       '<h2 id="sheet-titre">Tout le reste</h2>' +
       '<p class="sub">' + esc(STATE.user.prenom) + ' · ' + ROLES[STATE.user.role].label + '</p>' +
       '<div class="stack">' + liste.map(id =>
       '<button type="button" class="menu-item" data-plus="' + id + '">' +
       '<span class="mi-tx"><span class="mi-t">' + esc(PAGES[id].titre) + '</span>' +
       '<span class="mi-s">' + esc(PAGES[id].sous) + '</span></span>' +
       '<span class="mi-fl">›</span>' +
       '</button>').join('') +
       /* Le retour bêta vit ici et non plus en bouton flottant : posé sur
          le contenu, il couvrait « HS » et « + » des frigos sur téléphone. */
       (APP.beta ? '<button type="button" class="menu-item" id="mp-retour">' +
         '<span class="mi-tx"><span class="mi-t">Signaler un souci</span>' +
         '<span class="mi-s">Un bug, un chiffre faux, une idée : c’est transmis à ' + esc(nomManager()) + '</span></span>' +
         '<span class="mi-fl">›</span></button>' : '') +
       '</div>' +
       '<div class="actions"><button class="btn clair" data-fermer>Fermer</button>' +
       '<button class="btn fantome" id="mp-out">Déconnexion</button></div>' +
       /* La version, utile au dépannage, quitte l'écran de connexion. */
       '<p class="mini" style="text-align:center;margin-top:14px">' + esc(APP.nom + ' ' + APP.version + ' · ' + APP.site) + '</p>'
     );
     $$('[data-plus]').forEach(b => b.onclick = () => { closeSheet(); rendre(b.dataset.plus); });
     const rb = $('#mp-retour');
     if (rb) rb.onclick = ouvrirRetour;
     $('#mp-out').onclick = () => { closeSheet(); deconnexion(); };
   }
   
/* Vues dont le contenu n'a aucun sens sans période définie */
   const VUES_PERIODE = ['ecarts', 'periodes', 'inv'];

   /* Jour calendaire du dernier rendu : un iPad laissé ouvert passe minuit. */
   let _jourDernierRendu = today();

   /* Écrans à barre de dates : un lien peut les ouvrir sur un jour donné. */
   const VUES_DATEES = ['temp', 'clean', 'caisse', 'hebdo'];

   async function rendre(id, viaHistorique, jour, moment) {
   if (!V[id]) { toast('Vue indisponible'); return; }
   if (!vueAutorisee(id)) id = vueAccueil();
   /* Rôle changé pendant qu'une feuille était ouverte, et la feuille se ferme
      sur un lien (« Équipe » du menu, « Ouvrir »…) : on ne dessine pas la vue
      de l'ancien rôle, qui pouvait finir après l'accueil et le recouvrir. Le
      nouveau rôle s'applique tout de suite (voir revaliderSession). */
   if (_roleARedessiner && $('#sheet').hidden) { appliquerNouveauRole(); return; }
   /* Minuit est passé depuis le dernier rendu : on réaligne la date de
      travail sur aujourd'hui. Sans ça, l'équipe du matin saisissait ses
      relevés sous la date de la veille — et en « consultation seule ». */
   if (today() !== _jourDernierRendu) {
     _jourDernierRendu = today();
     STATE.jour = today();
     if (V.temp && V.temp._d !== undefined) V.temp._d = STATE.jour;
   }
   /* On quitte les réglages : on arrête le rafraîchissement de l'indicateur */
   if (V.reglages && V.reglages._t) { clearInterval(V.reglages._t); V.reglages._t = null; }
   /* Redessiner la vue courante ne doit pas renvoyer l'équipe en haut de page :
     cocher la 18e tâche de la check-liste faisait perdre la position à chaque fois. */
  const memeVue = (STATE.view === id);
  const scrollAvant = window.scrollY || document.documentElement.scrollTop || 0;
  /* Changer d'écran ramène au jour en cours. La date restait sinon sur la
     veille consultée dans Nettoyage ou Caisse, et Ma journée, Réassort,
     Pertes — sans barre de dates ni verrou — écrivaient sous la veille
     (« checklist:<hier> » cochée par un équipier). Le redessin d'un même
     écran, lui, garde la date : c'est ainsi que la navigation jour par jour
     fonctionne (le clic change la date, puis redessine la même vue). */
  if (!memeVue && STATE.jour !== today()) {
    STATE.jour = today();
    if (V.temp && V.temp._d !== undefined) V.temp._d = STATE.jour;
  }
  /* Lien vers un jour précis (« Aucun nettoyage validé le 17/09 » des
     Périodes) : l'écran s'ouvre sur ce jour, comme avec la barre des dates.
     « Ouvrir » menait sinon au jour en cours, et il fallait remonter les
     jours un par un. Jamais un jour futur, et seulement un écran daté. */
  if (jour && VUES_DATEES.indexOf(id) >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(jour) && jour <= today()) {
    STATE.jour = jour;
    if (V.temp) { V.temp._d = jour; V.temp._auj = today(); }
  }
  /* Moment demandé par le lien (« Frigos du matin non relevés ») : Températures
     et Caisse le choisissaient seules d'après l'heure, et passé 15 h ce lien
     ouvrait le relevé du soir. */
  if (moment === 'm' || moment === 's') {
    if (id === 'temp' && V.temp) V.temp._voulu = moment;
    if (id === 'caisse' && V.caisse) V.caisse._m = moment;
  }
  STATE.view = id;
     const p = PAGES[id] || { titre:id, sous:'' };
     $('#vue-titre').textContent = p.titre;
     $('#vue-sous').textContent  = p.sous;
     $('#vue-actions').innerHTML = '';
     $('#page').innerHTML = '<div class="vide"><span class="vi">⏳</span>Un instant…</div>';
     renderNav();

     /* Aucune période ouverte : un équipier ne doit pas voir des chiffres calculés
        sur une fenêtre de temps inventée. On l'arrête ici, avec l'explication. */
     if (VUES_PERIODE.indexOf(id) >= 0 && STATE.user.role !== 'manager') {
       const dejaOuverte = await DB.get('periode:courante', null);
       if (STATE.view !== id) return;          // un autre écran a été demandé entre-temps
       if (!dejaOuverte) {
         $('#page').innerHTML = carte(
           entete('⏸️', 'En attente du manager',
             'Aucune période de calcul n’est ouverte pour la boutique.') +
           '<p class="mini">' + esc(NomManager()) + ' doit d’abord fixer la date de départ et le type de période. ' +
           'D’ici là, cet écran serait faux : les écarts se calculeraient sur une fenêtre de temps ' +
           'arbitraire. Les autres pages restent utilisables normalement.</p>' +
           '<button class="btn clair bloc" data-go="accueil" style="margin-top:14px">Revenir à ma journée</button>',
           'ambre');
         $$('#page [data-go]').forEach(b => b.onclick = () => rendre(b.dataset.go));
         /* Une entrée d'historique, comme pour toute vue (voir plus bas) : sans
            elle, « retour » sautait l'écran précédent. */
         if (!viaHistorique && !memeVue) pousserHistorique({ vue:id });
         window.scrollTo(0, 0);
         return;
       }
     }
     /* Côté manager, une période illisible (hors ligne sans copie, base
        injoignable) revient sous la forme de l'objet « attente ». Affiché comme
        une vraie période, il faisait saisir les écarts sous « ecart:attente »,
        ou « corriger » des dates qui remplaçaient, au retour du réseau, la
        période de toute la boutique. */
     if (VUES_PERIODE.indexOf(id) >= 0 && STATE.user.role === 'manager') {
       const per = await periodeCourante();
       if (STATE.view !== id) return;          // un autre écran a été demandé entre-temps
       if (per && per.id === 'attente') {
         $('#page').innerHTML = carte(
           entete('⏸️', 'Période indisponible', 'La période de la boutique n’a pas pu être lue.') +
           '<p class="mini">L’iPad est hors ligne, ou la base ne répond pas. Une saisie ici serait rangée ' +
           'hors de la période : reconnectez l’iPad, puis réessayez.</p>' +
           '<button class="btn clair bloc" id="per-rt" style="margin-top:14px">Réessayer</button>', 'ambre');
         /* Hors ligne, DB.get ne lit que la copie : sans sonde, « Réessayer » ne changeait rien avant 15 s.
            La sonde peut attendre 8 s : le bouton le dit, et on ne ramène pas ici qui est parti ailleurs. */
         $('#per-rt').onclick = async () => {
           const b = $('#per-rt'); if (b) { b.disabled = true; b.textContent = 'Connexion…'; }
           await sonderReseau();
           if (STATE.view === id) rendre(id);
         };
         if (!viaHistorique && !memeVue) pousserHistorique({ vue:id });
         window.scrollTo(0, 0);
         return;
       }
     }
     try { await V[id](); }
     catch (err) {
       $('#page').innerHTML = carte(
         entete('⚠️', 'Cette page ne s’est pas ouverte', String(err && err.message || err)) +
         '<button class="btn clair bloc" id="rt">Réessayer</button>');
       $('#rt').onclick = () => rendre(id);
     }
     /* data-partie suit le lien : cette liaison générique passait APRÈS celle
        de la vue et l'écrasait — la tâche de recomptage ouvrait l'inventaire
        sur le mauvais onglet. */
     $$('#page [data-go]').forEach(b => b.onclick = () => {
       if (b.dataset.partie) STATE.inventairePartie = b.dataset.partie;
       rendre(b.dataset.go, false, b.dataset.jour, b.dataset.moment);
     });

     /* Chaque vue laisse une trace dans l'historique du navigateur : sans cela,
        le bouton « retour » du téléphone quittait purement et simplement
        l'application au lieu de revenir à l'écran précédent. */
     /* Pas pour un simple redessin de la même vue : chaque case cochée
        empilait une entrée, et « retour » restait sur place autant de fois. */
     if (!viaHistorique && !memeVue) pousserHistorique({ vue:id });

     if (memeVue) {
    /* Deux passages : après peinture, puis après les images éventuelles. */
    window.scrollTo(0, scrollAvant);
    requestAnimationFrame(() => window.scrollTo(0, scrollAvant));
  } else {
    window.scrollTo(0, 0);
  }
}
   
   /* Phase courante d'après l'heure */
   function phaseCourante() {
     const m = new Date().getHours() * 60 + new Date().getMinutes();
     const mn = h => +h.slice(0, 2) * 60 + +h.slice(3, 5);
     const p = PHASES.filter(x => m >= mn(x.de) && m < mn(x.a))[0];
     return (p || PHASES[PHASES.length - 1]).id;
   }
   
   /* =============================================================================
      7. NETTOYAGE — sélection des tâches du jour
      ========================================================================== */
   function tachesDuJour(jour) {
     const j = jourISO(jour);
     const out = [];
   
     NETTOYAGE.zones.forEach(z => z.taches.forEach(t => {
       if (t.annuel || t.mensuel) return;              // gérées à part, hors quotidien
       /* Les tâches hebdomadaires viennent désormais du tableau affiché en
          boutique (TACHES_HEBDO), pas de cette liste. On ne garde ici que le
          registre quotidien, sinon les deux se doublonnent. */
       if (t.jours) return;
       out.push({ id:t.id, nom:t.nom, zone:z.nom, zoneId:z.id, icone:z.icone,
                  phase:t.phase, recurrence:'quotidien' });
     }));
   
     NETTOYAGE.zones.forEach(z => z.taches.forEach(t => {
       if (!t.mensuel && !t.annuel) return;
       if (j !== 1) return;                            // planifiées le lundi
       out.push({ id:t.id, nom:t.nom, zone:z.nom, zoneId:z.id, icone:z.icone,
                  phase:t.phase, recurrence: t.mensuel ? 'mensuel' : 'annuel' });
     }));
   
     return out;
   }
   
   async function asyncDuJour(jour) {
     const j = jourISO(jour), out = [];
     for (const a of NETTOYAGE.asynchrones) {
       let du = false, retard = 0, jamais = false;
       if (a.type === 'jours-fixes') {
         du = a.jours.indexOf(j) >= 0;
       } else {
         const dernier = await DB.get('async:' + a.id, null);
         if (!dernier) { du = true; jamais = true; }
         else {
           const ecart = Math.round((new Date(jour + 'T12:00:00') - new Date(dernier.jour + 'T12:00:00')) / 864e5);
           du = ecart >= a.intervalleJours;
           retard = Math.max(0, ecart - a.intervalleJours);
         }
       }
       if (du) out.push(Object.assign({}, a, { retard:retard, jamais:jamais }));
     }
     return out;
   }
   
   async function etatNettoyage(jour) {
     /* L'écran Nettoyage écrit dans « hebdo: » depuis qu'il n'affiche plus que
        les tâches hebdomadaires du jour. Cette fonction lisait encore « clean: »,
        la clé de l'ancien registre quotidien : elle annonçait donc « 0 sur 17 »
        alors que l'équipe avait tout fait, et la clôture de période était
        bloquée par un reproche infondé.
        On lit les deux — l'ancienne clé porte encore l'historique. */
     const hebdo   = await DB.get('hebdo:' + jour, {});
     const ancien  = await DB.get('clean:' + jour, {});
     const rec = Object.assign({}, ancien, hebdo);

     /* La liste de référence suit la même logique : ce sont les tâches
        hebdomadaires programmées ce jour-là qu'il faut compter.
        tachesHebdoDuJour est ASYNCHRONE — elle lit le plan du manager en base.
        Sans await, elle rendait une promesse et filter() n'existait pas. */
     const liste = (typeof tachesHebdoDuJour === 'function')
       ? await tachesHebdoDuJour(jour)
       : tachesDuJour(jour);
     const faits = (liste || []).filter(t => rec[t.id] && rec[t.id].ok).length;
     return { rec:rec, liste:liste || [], faits:faits, total:(liste || []).length };
   }
   
   /* =============================================================================
      8. ÉTAT D'UNE JOURNÉE
      ========================================================================== */
   /* Résumé d'une feuille de caisse : { ca, cb, esp, ecart, par }.
      La caisse a changé de nommage (modules.js) : m_fond, s_cb, s_esp, s_tpe,
      s_retrait, s_fond, signatures m_valide / s_valide. Les écrans de synthèse
      lisaient encore k.ecart, k.cb, k.esp : 0 € d'écart partout, toujours.
      L'écart reproduit EXACTEMENT les deux contrôles affichés à la fermeture :
        carte   = TPE − CB saisi en caisse            (si les deux sont saisis)
        espèces = fond final − (fond initial + espèces − retrait)
      où le fond initial est m_fond, sinon le fond laissé la veille au soir
      (veille, facultatif). Leur somme est l'équilibre global de l'ancienne
      feuille : TPE + retrait + fond final − fond initial − CB − espèces.
      Feuilles antérieures : repli sur ecart, cb, esp, par. */
   function caisseResume(k, veille) {
     if (!k || typeof k !== 'object') return { ca:0, cb:0, esp:0, ecart:0, par:'' };
     const rempli = x => x !== undefined && x !== null && x !== '';
     const nouveau = ['m_fond', 's_cb', 's_esp', 's_tpe', 's_retrait', 's_fond'].some(c => rempli(k[c]));
     if (!nouveau) {
       const cb = num(k.cb), esp = num(k.esp);
       /* Anciennes feuilles sans « ecart » enregistré : on le recalcule avec
          l'équilibre de modules.js plutôt que d'afficher 0 €. */
       let ecart = num(k.ecart);
       /* Seulement sur une soirée complète : une feuille partielle (matin seul,
          TPE absent) donnerait un faux écart. */
       if (!rempli(k.ecart) && typeof equilibreCaisse === 'function' &&
           ['fi', 'ff', 'cb', 'esp', 'tpe'].every(c => rempli(k[c]))) {
         ecart = equilibreCaisse(k).ecart;
       }
       return { ca:cb + esp, cb:cb, esp:esp, ecart:ecart, par:k.par || '' };
     }
     const cb = num(k.s_cb), esp = num(k.s_esp);
     let ecart = 0;
     if (rempli(k.s_cb) && rempli(k.s_tpe)) ecart += +(num(k.s_tpe) - num(k.s_cb)).toFixed(2);
     const fondVeille = veille
       ? (rempli(veille.s_fond) ? num(veille.s_fond) : (rempli(veille.ff) ? num(veille.ff) : null))
       : null;
     const fondOuv = rempli(k.m_fond) ? num(k.m_fond) : fondVeille;
     if (fondOuv !== null && rempli(k.s_esp) && rempli(k.s_fond) && rempli(k.s_retrait)) {
       const attendu = +(fondOuv + num(k.s_esp) - num(k.s_retrait)).toFixed(2);
       ecart += +(num(k.s_fond) - attendu).toFixed(2);
     }
     const par = (k.s_valide && k.s_valide.par) || (k.m_valide && k.m_valide.par) || k.par || '';
     return { ca:cb + esp, cb:cb, esp:esp, ecart:+ecart.toFixed(2), par:par };
   }

   async function etatJour(jour) {
     const t   = await DB.get('temp:' + jour, {});
     const net = await etatNettoyage(jour);
     const k   = await DB.get('caisse:' + jour, null);
     const r   = await DB.get('reassort:' + jour, {});
   
     /* Une enceinte marquée hors service compte comme relevée. Et c'est la
        validation explicite qui fait foi, pas le simple remplissage : une
        valeur saisie puis modifiée sans revalider ne compte pas. */
     const complet = mom => !!(t.valide && t.valide[mom]) && releveMesure(t, mom);
     const crit = ENCEINTES.filter(e => ['m','s'].some(m => etatTemp(e, t[m + '_' + e.id]) === 'crit')).length;
     const rupt = Object.keys(r).filter(k2 => r[k2] && r[k2].rupture).length;
   
     return {
       jour:jour,
       tempM:complet('m'), tempS:complet('s'), tempCrit:crit,
       net:net.faits, netTotal:net.total,
       /* Une fiche ouverte n'est pas une caisse faite : il faut la fermeture validée. */
       caisse:!!(k && (k.s_valide || (k.s_valide === undefined && (k.ecart !== undefined ||
         /* Ancienne feuille complète sans écart enregistré : caisseResume le recalcule. */
         ['fi', 'ff', 'cb', 'esp', 'tpe'].every(c => k[c] !== undefined && k[c] !== null && k[c] !== ''))))),
       /* La veille fournit le fond initial quand le matin n'a pas été saisi. */
       caisseEcart: k ? caisseResume(k, await DB.get('caisse:' + addD(jour, -1), null)).ecart : 0,
       reassort:REASSORT.filter(x => reassortFait(x, r)).length,
       reassortTotal:REASSORT.length, ruptures:rupt
     };
   }
   
   function etatTemp(e, v) {
     if (v === 'HS') return '';          // enceinte hors service : ni conforme ni critique
     /* Une chaîne faite d'espaces n'est PAS une mesure. Sans le trim,
        Number(' ') vaut 0 : un espace tapé par erreur dans le champ d'une
        vitrine donnait « critique » — alerte rouge et action corrective exigée
        pour un champ que personne n'avait rempli. Une fausse alerte use la
        vigilance plus sûrement qu'une alerte absente. */
     if (v === null || v === undefined) return '';
     if (typeof v === 'string' && v.trim() === '') return '';
     if (isNaN(v)) return '';
     v = Number(v);
     if (!isFinite(v)) return '';
     /* Comparaison large et non stricte : une enceinte pile à sa limite critique
        doit alerter. Avec un > strict, une vitrine à −10 °C tout juste était
        classée « hors cible » et n'exigeait aucune action corrective. */
     if (v >= e.crit) return 'crit';
     if (v >= e.vert[0] && v <= e.vert[1]) return 'vert';
     return 'rouge';
   }

   /* Une signature sans aucune mesure ne fait pas un relevé : il faut au moins
      une valeur (ou « HS ») pour ce moment. Un registre validé vide comptait
      comme fait dans Ma journée et la Tour de contrôle. On lit les clés du
      document et non ENCEINTES, pour ne pas renier un relevé ancien dont les
      unités ont été renommées depuis. */
   function releveMesure(t, mom) {
     return !!t && Object.keys(t).some(k => k.indexOf(mom + '_') === 0 &&
       t[k] !== '' && t[k] !== null && t[k] !== undefined);
   }
   
   /* =============================================================================
      9. VUE — MA JOURNÉE
      ========================================================================== */
/* V.accueil : version retirée — elle était remplacée au chargement. */
   
   /* =============================================================================
      10. VUE — FRIGOS
      ========================================================================== */
/* V.temp : version retirée — elle était remplacée au chargement. */
   
   function boutonsDegres(e, mom, val) {
     let h = '';
     for (let v = e.lo; v <= e.hi; v += (e.pas || 1)) {
       h += '<button type="button" class="deg ' + etatTemp(e, v) + (String(val) === String(v) ? ' on' : '') +
            '" data-t="' + mom + '_' + e.id + '" data-v="' + v + '">' + v + '</button>';
     }
     return h;
   }
   function pastilleTemp(e, rec) {
     const s = RELEVES.moments.map(m => etatTemp(e, rec[m.id + '_' + e.id]));
     if (s.indexOf('crit') >= 0)  return pastille('bad', 'Critique');
     if (s.indexOf('rouge') >= 0) return pastille('warn', 'Hors cible');
     if (s.every(x => x === 'vert')) return pastille('ok', 'Conforme');
     return pastille('n', 'À relever');
   }
   /* Limite critique franchie : message court et une seule consigne.
      L'ancienne version déroulait la procédure en cinq étapes, qui s'affichait
      mal et que personne ne lit quand un frigo lâche en plein service. */
   function alerteCritique(e, v) {
     showSheet(
       '<h2 id="sheet-titre">' + esc(e.nom) + ' à ' + v + ' °C</h2>' +
       '<p class="sub">Limite critique dépassée — cible ' + esc(e.cible) + '.</p>' +
       '<div class="alerte bad" style="margin-top:14px"><span class="ai">•</span>' +
       '<div><b>Appelez ' + esc(nomManager()) + '</b><p>En attendant, transférez les produits dans une ' +
       'enceinte conforme et notez l’action corrective en bas de l’écran.</p></div></div>' +
       '<div class="actions"><button class="btn corail bloc" data-fermer>J’ai compris</button></div>'
     );
   }
   
   /* Quelles tâches exigent une photo avant validation.
   Toute tâche non quotidienne : hebdomadaire, mensuelle, annuelle, asynchrone.
   Une tâche faite chaque jour se contrôle de visu ; une tâche mensuelle, non. */
function exigePhoto(tache) {
  if (!PREUVE.actif || !tache) return false;
  if (PREUVE.tachesObligatoires.indexOf(tache.id) >= 0) return true;
  if (!PREUVE.hebdoObligatoire) return false;
  return ['hebdo', 'mensuel', 'annuel', 'async'].indexOf(tache.recurrence) >= 0;
}

/* Purge LOCALE des photos de preuve de plus de PREUVE_LOCAL_JOURS jours.
   Sans elle, le quota du navigateur tombe en pleine saison : 12 photos par
   jour à 40 Ko saturent les 5 Mo de l'iPad en trois semaines.
   Seule la copie de l'iPad est effacée : le serveur garde tout (registre
   sanitaire). L'ancienne version passait par DB.del, qui envoyait un DELETE
   au serveur et détruisait la preuve pour tous les appareils. */
const PREUVE_LOCAL_JOURS = 7;
async function purgerPreuves() {
  if (!PREUVE.actif) return 0;
  const limite = addD(today(), -PREUVE_LOCAL_JOURS);
  let effaces = 0;
  try {
    const enFileAttente = new Set(fileLire().map(x => x.cle));
    for (const cle of DB._clesLocales().filter(k => k.indexOf('preuves:') === 0)) {
      const jour = cle.replace('preuves:', '');
      if (jour >= limite) continue;
      /* Encore en file d'attente : pas encore sur le serveur, on garde. */
      if (enFileAttente.has(cle)) continue;
      const brut = DB._lire(cle);
      /* Trop lourde pour la base : elle n'a jamais été envoyée, la copie
         locale est la seule qui existe. */
      if (brut && brut.length > OFFLINE.tailleMaxOctets) continue;
      let l = [];
      try { l = JSON.parse(brut || '[]'); } catch (e) {}
      effaces += Array.isArray(l) ? l.length : 0;
      DB._oter(cle);
    }
  } catch (e) { /* purge sans conséquence si elle échoue */ }
  if (effaces) console.info('Purge locale : ' + effaces + ' photo(s) de plus de ' + PREUVE_LOCAL_JOURS + ' jours (copie serveur conservée)');
  return effaces;
}

/* Rétention locale : OFFLINE.purgeLocaleJours était annoncé mais rien ne le
   lisait. Les copies locales datées des données nominatives — journal
   d'activité, heures pointées, caisses et leurs brouillons — s'accumulaient
   sans limite sur l'iPad. Au-delà de purgeLocaleJours, la copie LOCALE est
   effacée ; la base garde la sienne (durées de supabase-conservation.sql).
   Jamais une clé encore en file d'attente ou trop lourde pour la base.
   DON-05 : les registres datés — températures, check-listes, nettoyage,
   pertes, réceptions, réassort — manquaient ; leur copie, nominative elle
   aussi (« validé par », « déclaré par »), restait sans limite. La base les
   garde (registres HACCP) : seule la copie de l'iPad part, et seulement si
   la base a bien la ligne. Une saisie abandonnée par la file (refus
   répétés, file vidée à la main) n'existe qu'ici : un registre sanitaire ne
   doit pas disparaître pour autant. Base injoignable : rien n'est effacé.
   En mode local, la copie de l'iPad est la seule : rien n'était purgé. On y
   applique les durées de la base elle-même — journal 1 an, heures pointées
   3 ans — et rien d'autre : registres et caisses n'y sont pas purgés, pas
   plus que dans la base. */
const PREFIXES_PURGE_LOCALE = ['feed:', 'pointage:', 'caisse:', 'brouillon:caisse:',
                               'temp:', 'checklist:', 'clean:', 'hebdo:', 'pertes:', 'reception:', 'reassort:'];
const CONSERVATION_MODE_LOCAL_ANS = { 'feed:': 1, 'pointage:': 3 };   // = supabase-conservation.sql
async function purgerLocalAncien() {
  const jours = OFFLINE.purgeLocaleJours;
  const base = DB.configure;
  if (base && !(jours > 0)) return 0;
  const t = today();
  /* « Il y a N ans », comme interval 'N years' de PostgreSQL (29/02 → 28/02). */
  const ilYA = ans => (Number(t.slice(0, 4)) - ans) + (t.slice(4) === '-02-29' ? '-02-28' : t.slice(4));
  const limite = p => base ? addD(t, -jours)
                           : (CONSERVATION_MODE_LOCAL_ANS[p] ? ilYA(CONSERVATION_MODE_LOCAL_ANS[p]) : null);
  let n = 0;
  try {
    const enFile = new Set(fileLire().map(x => x.cle));
    const vieilles = DB._clesLocales().filter(cle => {
      const p = PREFIXES_PURGE_LOCALE.filter(x => cle.indexOf(x) === 0)[0];
      const l = p ? limite(p) : null;
      if (!l) return false;
      const jour = cle.slice(p.length);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(jour) || jour >= l || enFile.has(cle)) return false;
      /* Trop lourde pour la base : jamais envoyée, la copie locale est la seule. */
      const brut = DB._lire(cle);
      return !(brut && brut.length > OFFLINE.tailleMaxOctets);
    });
    /* Sans table (brouillons de caisse) : jamais envoyées, par nature. Les
       autres : seulement celles que la base confirme, par lots de 40. */
    const aEffacer = base ? vieilles.filter(c => !DB._table(c)) : vieilles;
    const parTable = {};
    if (base) vieilles.filter(c => DB._table(c)).forEach(c => (parTable[DB._table(c)] = parTable[DB._table(c)] || []).push(c));
    for (const tb of Object.keys(parTable)) {
      for (let i = 0; i < parTable[tb].length; i += 40) {
        const lot = parTable[tb].slice(i, i + 40);
        try {
          const l = await DB._appel(tb + '?select=id&id=in.(' +
                                    lot.map(c => encodeURIComponent('"' + c + '"')).join(',') + ')');
          const enBase = new Set((l || []).map(r => r.id));
          lot.filter(c => enBase.has(c)).forEach(c => aEffacer.push(c));
        } catch (e) { /* base injoignable : on garde, la prochaine connexion réessaiera */ }
      }
    }
    /* Remise en file entre-temps (saisie pendant la vérification) : on garde. */
    const enFileMaintenant = new Set(fileLire().map(x => x.cle));
    aEffacer.filter(c => !enFileMaintenant.has(c)).forEach(c => { DB._oter(c); n++; });
  } catch (e) { /* purge sans conséquence si elle échoue */ }
  if (n) console.info('Purge locale : ' + n + ' clé(s) ancienne(s) ' +
                      (base ? 'de plus de ' + jours + ' jours (copie serveur conservée)' : '(durées de conservation)'));
  return n;
}

/* =============================================================================
   11. VUE — NETTOYAGE
   ========================================================================== */
/* V.clean : version retirée — modules.js la redéfinit (tableau hebdomadaire). */
   
   /* =============================================================================
      12. VUE — PERTES (dictée vocale)
      ========================================================================== */
   const SPEECH = window.SpeechRecognition || window.webkitSpeechRecognition || null;
   
   V.pertes = async function () {
     const j = STATE.jour;
     const liste = await DB.get('pertes:' + j, []);
   
     $('#page').innerHTML =
       carte(entete('🎙️', 'Dicter la perte', SPEECH
           /* RGPD : la voix quitte l'iPad, il faut le dire avant le premier mot. */
           ? 'Appuyez, parlez normalement : « J’ai jeté 2 bacs de vanille ». La voix est transcrite par le service de dictée de l’appareil (Apple ou Google).'
           : 'La dictée n’est pas disponible sur ce navigateur. Utilisez la saisie ci-dessous.') +
         '<button class="btn corail bloc xl mic" id="mic"' + (SPEECH ? '' : ' disabled') + '>' +
         'Dicter la perte</button>' +
         '<p class="mini" id="mtx" style="margin-top:12px">' +
         (SPEECH ? esc(VOIX.exemples.join(' · ')) : 'Dictée indisponible') + '</p>', 'corail') +
   
       carte(entete('✍️', 'Saisie manuelle', 'Ou remplissez directement.') +
         '<div class="champ"><label class="f">Produit</label>' +
         '<input type="text" id="pp" placeholder="Ex. Bac pistache 5 L"></div>' +
         '<div class="grid g2" style="margin-top:14px">' +
         '<div class="champ"><label class="f">Nombre</label><input type="number" id="pn" min="0" step="1" value="1"></div>' +
         '<div class="champ"><label class="f">Litrage par unité (L)</label><input type="number" id="pl" min="0" step="0.5" placeholder="0"></div></div>' +
         '<div style="margin-top:14px"><label class="f">Motif</label><div class="chips" id="pm">' +
         MOTIFS_PERTE.map((m, i) => '<button type="button" class="chip corail' + (i === 0 ? ' on' : '') +
           '" data-m="' + m.id + '">' + esc(m.label) + '</button>').join('') + '</div></div>' +
         '<button class="btn menthe bloc" id="pa" style="margin-top:18px">Enregistrer la perte</button>') +
   
       '<div class="entete"><h3>Jetés aujourd’hui</h3>' +
       '<span class="pousse mini num">' + n1(liste.reduce((s, w) => s + litresPerte(w), 0)) + ' L</span></div>' +
   
       (liste.length ? '<div class="stack">' + liste.map((w, i) => {
         const m = MOTIFS_PERTE.filter(x => x.id === w.motif)[0] || MOTIFS_PERTE[0];
         return carte('<div class="rang">' +
           '<div style="flex:1"><b>' + esc(w.produit) + '</b>' +
           '<div class="mini">' + w.nombre + ' × · ' + (w.litrage ? n1(w.litrage) + ' L · ' : '') +
           esc(w.par) + ' · ' + heure(w.at) + '</div></div>' +
           pastille('bad', m.label) +
           '<button class="btn fantome sm" data-del="' + i + '">Retirer</button></div>');
       }).join('') + '</div>' : vide('🗑️', 'Aucune perte déclarée aujourd’hui.'));
   
     let motif = MOTIFS_PERTE[0].id;
     $$('#pm [data-m]').forEach(b => b.onclick = () => {
       $$('#pm .chip').forEach(x => x.classList.remove('on'));
       b.classList.add('on'); motif = b.dataset.m;
     });
   
     const mb = $('#mic');
     mb.onclick = () => {
       if (!SPEECH) return toast('Dictée indisponible sur cet appareil', 'erreur');
       const r = new SPEECH();
       r.lang = VOIX.langue;
       r.interimResults = VOIX.resultatsIntermediaires;
       r.maxAlternatives = 1;
       mb.classList.add('rec');
       mb.innerHTML = '<span class="ic">●</span>J’écoute…';
       const stop = setTimeout(() => { try { r.stop(); } catch (e) {} }, VOIX.dureeMaxMs);
       r.onresult = ev => {
         clearTimeout(stop);
         const txt = ev.results[0][0].transcript;
         const d = analyserDictee(txt);
         $('#pp').value = d.produit;
         if (d.nombre)  $('#pn').value = d.nombre;
         if (d.litrage) $('#pl').value = d.litrage;
         if (d.motif) {
           motif = d.motif;
           $$('#pm .chip').forEach(x => x.classList.toggle('on', x.dataset.m === d.motif));
         }
         $('#mtx').innerHTML = 'Entendu : « ' + esc(txt) + ' » — vérifiez avant d’enregistrer.';
         vibrer(UI.vibration.ok);
       };
       r.onerror = ev => {
         clearTimeout(stop);
         toast(ev.error === 'not-allowed' ? 'Micro refusé par le navigateur' : 'Dictée interrompue', 'erreur');
       };
       r.onend = () => { mb.classList.remove('rec'); mb.innerHTML = 'Dicter la perte'; };
       try { r.start(); } catch (e) { r.onend(); }
     };
   
     $('#pa').onclick = async () => {
       const p = $('#pp').value.trim();
       if (!p) { toast('Indiquez le produit', 'erreur'); return $('#pp').focus(); }
       /* Nombre vide, nul ou négatif : « num(0) || 1 » enregistrait 1 sans
          prévenir. On le dit au lieu de deviner. */
       const nombre = num($('#pn').value);
       if (!(nombre > 0)) { toast('Indiquez un nombre supérieur à 0', 'erreur'); return $('#pn').focus(); }
       if (num($('#pl').value) < 0) { toast('Le litrage ne peut pas être négatif', 'erreur'); return $('#pl').focus(); }
       /* parUnite : le litrage est saisi par unité (saisie manuelle comme
          dictée, qui remplit ce même formulaire). Les anciennes lignes, sans
          ce marqueur, gardent leur calcul d'origine. */
       liste.push({ id:uid(), produit:p, nombre:nombre, litrage:num($('#pl').value),
                    parUnite:true,
                    motif:motif, par:STATE.user.prenom, employe:STATE.user.id, at:nowISO() });
       await DB.set('pertes:' + j, liste);
       await cumulerPertesMois(j);
       await feed('warn', STATE.user.prenom + ' a jeté ' + p);
       toast('Perte enregistrée');
       rendre('pertes');
     };
   
     $$('[data-del]').forEach(b => b.onclick = () => {
       confirmer('Retirer cette ligne ?', 'La perte sera supprimée du registre du jour. Le retrait est noté au journal.', 'Retirer', async () => {
         const w = liste.splice(+b.dataset.del, 1)[0];
         await DB.set('pertes:' + j, liste);
         await cumulerPertesMois(j);
         /* La création d'une perte est journalisée ; son retrait ne l'était pas :
            une trace pouvait disparaître sans laisser de ligne (DON-06). */
         if (w) await feed('warn', STATE.user.prenom + ' a retiré une perte : ' + w.produit + ' (' +
           w.nombre + ' ×' + (w.litrage ? ', ' + n1(litresPerte(w)) + ' L' : '') + ', déclarée par ' +
           (w.par || '?') + (w.at ? ' à ' + heure(w.at) : '') + ')');
         rendre('pertes');
       });
     });
   };
   
   /* Litres réellement jetés sur une ligne de perte : le litrage est saisi PAR
      UNITÉ (« 2 bacs de 5 L » → nombre 2, litrage 5, comme la dictée). Les
      totaux ignoraient le nombre : deux bacs jetés comptaient pour un. */
   /* Seules les lignes marquées « parUnite » sont multipliées : les anciennes
      saisies étaient peut-être en litres totaux, on ne les recalcule pas
      rétroactivement. */
   const litresPerte = w => (w && w.parUnite)
     ? num(w.nombre || 1) * num(w.litrage)
     : num(w && w.litrage);

   /* Reporte le litrage détruit dans la période d'écart en cours. L'écart est
      rangé sous l'identifiant de la période (ecart:<id>), pas sous le mois :
      écrit sous « ecart:2026-09 », le jeté n'était jamais lu par calculEcart. */
   async function cumulerPertesMois(jour) {
     /* Lecture directe : periodeCourante() ouvrirait la fenêtre de première
        période en plein enregistrement d'une perte. */
     const per = await DB.get('periode:courante', null);
     if (!per || !per.id || !per.debut) return;
     let total = 0;
     const cles = await DB.list('pertes:');
     for (const c of cles) {
       const d = c.replace('pertes:', '');
       /* Pas de borne de fin : une période échue reste la période en cours
          jusqu'à sa clôture, et la suivante part de son propre début. */
       if (d < per.debut) continue;
       (await DB.get(c, [])).forEach(w => total += litresPerte(w));
     }
     await DB.patch('ecart:' + per.id, { jeteL:total, jeteKg:+(total * FOURNISSEUR.poidsMoyenLitre).toFixed(2) });
   }
   
   function analyserDictee(txt) {
     const t = ' ' + String(txt).toLowerCase().replace(/,/g, '.') + ' ';
     const mots = t.split(/\s+/).filter(Boolean);
     const res = { produit:'', nombre:'', litrage:'', motif:'' };
     const chiffre = m => (VOIX.chiffres[m] !== undefined ? VOIX.chiffres[m] : (isNaN(+m) ? null : +m));
   
     const mm = MOTIFS_PERTE.filter(x => x.mots.some(w => t.indexOf(w) >= 0))[0];
     if (mm) res.motif = mm.id;
   
     const lit = t.match(/([\d.]+|[a-zéèêà]+)\s*(?:litres?|\bl\b)/);
     if (lit) { const v = chiffre(lit[1]); if (v !== null) res.litrage = v; }
   
     for (let i = 0; i < mots.length; i++) {
       const v = chiffre(mots[i]);
       if (v === null) continue;
       const suite = (mots[i + 1] || '') + ' ' + (mots[i + 2] || '');
       if (/litres?|\bl\b/.test(suite)) continue;
       res.nombre = v;
       break;
     }
   
     const unite = VOIX.unites.filter(u => u.re.test(t))[0];
     const parfum = PARFUMS.filter(p => t.indexOf(p.toLowerCase().split(' ')[0]) >= 0)[0];
     if (parfum) res.produit = (unite ? unite.id.charAt(0).toUpperCase() + unite.id.slice(1) + ' ' : '') + parfum;
     else {
       const m2 = t.match(/(?:de|du|d’|d')\s+([a-zàâçéèêëîïôûùüÿñæœ\- ]{3,32})/);
       res.produit = m2 ? m2[1].trim().replace(/\s+(p[eé]rim|cass|erreur|formation).*$/, '') : String(txt).trim();
     }
     return res;
   }
   
   /* =============================================================================
      13. VUE — NUMÉROS DE LOT (scanner simulé)
      ========================================================================== */
/* V.lots : version retirée — elle était remplacée au chargement. */
   
   function regleDLC(nom, type) {
     if (type === 'g') return 'gelato';
     const m = DLC_MATCH.filter(x => x.re.test(nom))[0];
     return m ? m.regle : 'defaut';
   }
   
   /* Le scan réel est fourni par ocr.js, chargé après ce fichier. */
   
   /* =============================================================================
      14. VUE — RÉASSORT
      ========================================================================== */
   /* Déclinaisons d'un point de réassort. Elles viennent d'INVENTAIRE_SEC,
      par correspondance de nom : une seule source de vérité, et le vocabulaire
      reste le même entre le réassort et l'inventaire. */
   const deplies = {};
   function declinaisonsReassort(r) {
     if (typeof INVENTAIRE_SEC === 'undefined') return [];
     const cat = (typeof catalogueSec === 'function') ? catalogueSec() : INVENTAIRE_SEC;
     /* Par IDENTIFIANT, jamais par ressemblance de nom : c'est la ressemblance
        qui faisait hériter à « Gobelets à eau » les quatre tailles de
        « Gobelets », et à « Cornets sans gluten » celles des cornets. */
     if (!r.ref) return [];
     const ref = cat.filter(x => typeof x === 'object' && x.id === r.ref)[0];
     return ref && ref.variantes && ref.variantes.length ? ref.variantes : [];
   }
   /* Une référence est faite quand elle est cochée, ou quand toutes ses
      déclinaisons le sont. Une seule règle pour l'en-tête, les catégories et
      l'état du jour : l'en-tête ne comptait que les cases simples et restait
      à « 17 sur 41 » une fois tout vérifié. */
   function reassortFait(r, rec) {
     const dc = declinaisonsReassort(r);
     if (!dc.length) return !!(rec[r.id] && rec[r.id].ok);
     return dc.every(x => (rec[r.id + '|' + x] || {}).ok);
   }

   V.reas = async function () {
     const j = STATE.jour;
     const rec = await DB.get('reassort:' + j, {});
     const faits = REASSORT.filter(r => reassortFait(r, rec)).length;
     const rupt  = REASSORT.filter(r => rec[r.id] && rec[r.id].rupture);
   
     $('#page').innerHTML =
       carte(entete('📦', 'Réassort du ' + fmtD(j), REASSORT.length + ' points à vérifier. Signalez ce qui manque.') +
         '<div class="rang"><b class="num" style="font-size:26px">' + faits + '</b>' +
         '<span class="mini">sur ' + REASSORT.length + '</span>' +
         (rupt.length ? '<span class="pousse">' + pastille('bad', rupt.length + ' rupture(s)') + '</span>' : '') + '</div>' +
         '<div class="jauge" style="margin-top:10px"><i style="width:' +
         Math.round(faits / REASSORT.length * 100) + '%"></i></div>', 'solide') +
   
       REASSORT_CATS.map(c => {
         const items = REASSORT.filter(r => r.cat === c.id);
         /* Une référence est faite quand elle est cochée, ou quand toutes ses
            déclinaisons le sont. */
         const estFaite = r => reassortFait(r, rec);
         const ok = items.filter(estFaite).length;

         return '<div class="entete"><h3>' + esc(c.id) + '</h3>' +
           '<span class="pousse mini num">' + ok + '/' + items.length + '</span></div>' +
           '<div class="stack">' + items.map(r => {
             const v = rec[r.id] || {};
             const dc = declinaisonsReassort(r);
             const ouvert = deplies[r.id];
             const rupt = dc.filter(x => (rec[r.id + '|' + x] || {}).rupture);
             const faites = dc.filter(x => (rec[r.id + '|' + x] || {}).ok).length;
             const fait = estFaite(r);
             const enRupture = rupt.length || v.rupture;

             /* Toutes les lignes ont la MÊME structure : libellé à gauche,
                deux boutons compacts à droite, chevron en plus si la référence
                a des déclinaisons. Avant, dix-sept lignes portaient de gros
                boutons pleine largeur et douze des boutons compacts — le même
                écran avait deux apparences. */
             return carte(
               '<div class="rang">' +
               '<div style="flex:1;min-width:0">' +
               '<b>' + esc(r.nom) + '</b>' +
               '<div class="mini">' + (
                 rupt.length ? esc(rupt.join(', ')) + ' — en rupture'
                 : v.rupture ? 'Reste ' + v.reste + ' ' + esc(r.unite) + ' — signalé'
                 : fait && !dc.length ? 'Vérifié par ' + esc(v.par || '') + ' · ' + heure(v.at)
                 : dc.length ? faites + '/' + dc.length + ' · ' + esc(r.detail || ('en ' + r.unite))
                 : esc(r.detail || ('en ' + r.unite))) + '</div></div>' +

               (dc.length
                 ? '<button type="button" class="chev" data-deplier="' + esc(r.id) + '" ' +
                   'aria-label="Voir les déclinaisons">' + (ouvert ? '−' : '+') + '</button>'
                 : '<div class="duo compact">' +
                   '<button type="button" class="btn ok' + (v.ok ? ' on' : '') +
                   '" data-ok="' + esc(r.id) + '" aria-label="Fait">' + ic('valide', 17) + '</button>' +
                   '<button type="button" class="btn ko' + (v.rupture ? ' on' : '') +
                   '" data-ko="' + esc(r.id) + '" aria-label="Rupture">!</button></div>') +
               '</div>' +

               (dc.length && ouvert
                 ? '<div class="stack" style="margin-top:10px">' + dc.map(x => {
                     const k = r.id + '|' + x;
                     const vd = rec[k] || {};
                     return '<div class="rang decl">' +
                       '<span class="invn">' + esc(x) +
                       (vd.ok ? '<small>✓ ' + esc(vd.par || '') + '</small>'
                        : vd.rupture ? '<small>en rupture</small>' : '') + '</span>' +
                       '<div class="duo compact">' +
                       '<button type="button" class="btn ok' + (vd.ok ? ' on' : '') +
                       '" data-ok="' + esc(k) + '" aria-label="Fait">' + ic('valide', 16) + '</button>' +
                       '<button type="button" class="btn ko' + (vd.rupture ? ' on' : '') +
                       '" data-ko="' + esc(k) + '" aria-label="Rupture">!</button></div></div>';
                   }).join('') + '</div>'
                 : ''),
               enRupture ? 'corail' : fait ? 'menthe' : c.couleur);
           }).join('') + '</div>';
       }).join('');
   
     $$('[data-deplier]').forEach(b => b.onclick = () => {
       deplies[b.dataset.deplier] = !deplies[b.dataset.deplier];
       rendre('reas');
     });

     $$('[data-ok]').forEach(b => b.onclick = async () => {
       const id = b.dataset.ok, actif = !b.classList.contains('on');
       rec[id] = { ok:actif ? 1 : 0, rupture:0, par:STATE.user.prenom, at:nowISO() };
       vibrer(UI.vibration.ok);
       await DB.set('reassort:' + j, rec);
       rendre('reas');
     });
   
     $$('[data-ko]').forEach(b => b.onclick = () => {
       /* Une déclinaison porte « r01|Petit » : l'article se retrouve par la
          partie avant « | », la rupture s'enregistre sous la clé complète —
          celle que lit l'affichage des déclinaisons. Chercher la clé complète
          dans REASSORT ne trouvait rien et le bouton plantait. */
       const cle = b.dataset.ko;
       const decl = cle.indexOf('|') >= 0 ? cle.slice(cle.indexOf('|') + 1) : '';
       const art = REASSORT.filter(r => r.id === cle.split('|')[0])[0];
       if (!art) return toast('Article introuvable', 'erreur');
       if (rec[cle] && rec[cle].rupture) {
         rec[cle] = { ok:0, rupture:0 };
         DB.set('reassort:' + j, rec).then(() => rendre('reas'));
         return;
       }
       demanderQuantite(art, cle, decl);
     });
   
     function demanderQuantite(art, cle, decl) {
       cle = cle || art.id;
       const nomComplet = art.nom + (decl ? ' — ' + decl : '');
       showSheet(
         '<h2 id="sheet-titre">' + esc(nomComplet) + '</h2>' +
         '<p class="sub">Combien en reste-t-il ? ' + esc(NomManager()) + ' reçoit l’alerte immédiatement.</p>' +
         '<div class="chips" id="qt">' + RUPTURE.unitesRapides.map(q =>
           '<button type="button" class="chip corail" data-q="' + q + '">' +
           (q === 0 ? 'Plus rien' : q + ' ' + art.unite) + '</button>').join('') + '</div>' +
         '<div class="champ" style="margin-top:16px"><label class="f">Autre quantité</label>' +
         '<input type="number" id="qa" min="0" step="1" placeholder="Nombre de ' + esc(art.unite) + '"></div>' +
         '<div class="champ" style="margin-top:14px"><label class="f">Précision (facultatif)</label>' +
         '<input type="text" id="qn" placeholder="Ex. commande passée mardi"></div>' +
         '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
         '<button class="btn corail" id="qv">Signaler à ' + esc(nomManager()) + '</button></div>');
   
       let reste = null;
       $$('#qt [data-q]').forEach(b => b.onclick = () => {
         $$('#qt .chip').forEach(x => x.classList.remove('on'));
         b.classList.add('on'); reste = +b.dataset.q; $('#qa').value = '';
       });
       $('#qa').oninput = () => { $$('#qt .chip').forEach(x => x.classList.remove('on')); reste = num($('#qa').value); };
   
       $('#qv').onclick = async () => {
         if (reste === null) return toast('Indiquez ce qu’il reste', 'erreur');
         /* « −3 » était accepté et transmis comme rupture. */
         if (!(reste >= 0)) return toast('La quantité restante ne peut pas être négative', 'erreur');
         const niveau = RUPTURE.niveaux.filter(n => reste <= n.max)[0];
         rec[cle] = { ok:0, rupture:1, reste:reste, niveau:niveau.id, note:$('#qn').value.trim(),
                      par:STATE.user.prenom, employe:STATE.user.id, at:nowISO() };
         await DB.set('reassort:' + j, rec);
         await DB.push('ruptures', { id:uid(), jour:j, article:nomComplet, cat:art.cat, unite:art.unite,
                                     reste:reste, niveau:niveau.id, note:rec[cle].note,
                                     par:STATE.user.prenom, at:nowISO(), traite:false });
         await feed('bad', STATE.user.prenom + ' signale une rupture : ' + nomComplet +
                    (reste === 0 ? ' (plus rien)' : ' (reste ' + reste + ' ' + art.unite + ')'));
         closeSheet();
         toast(messageEnvoi('ruptures', 'Alerte transmise à ' + nomManager()));
         rendre('reas');
       };
     }
   };
   
   /* =============================================================================
      15. VUE — CARNET DE RELÈVE
      ========================================================================== */
   V.releve = async function () {
     const liste = await DB.get('releve', []);
     const visibles = liste.slice().reverse().slice(0, 40);
   
     $('#page').innerHTML =
       carte(entete('💬', 'Laisser un mot', 'Ce que la prochaine équipe doit savoir en arrivant.') +
         '<div class="chips" id="rc">' + RELEVE.categories.map((c, i) =>
           '<button type="button" class="chip' + (i === 3 ? ' on' : '') + '" data-rc="' + c.id + '">' +
           esc(c.label) + '</button>').join('') + '</div>' +
         '<div class="champ" style="margin-top:14px">' +
         '<textarea id="rt" aria-label="Message pour la prochaine équipe" placeholder="' + esc(RELEVE.exemples[0]) + '"></textarea>' +
         '<p class="mini" style="margin-top:6px">' + esc(CONSIGNE_TEXTE_LIBRE) + '</p></div>' +
         '<div class="btn-row" style="margin-top:14px">' +
         '<button class="btn menthe" id="rv">Publier</button>' +
         '<button class="btn clair" id="rp">Épingler</button></div>', 'solide') +
   
       '<div class="entete"><h3>Derniers messages</h3></div>' +
       (visibles.length ? '<div class="stack">' + visibles.map(m => {
         const c = RELEVE.categories.filter(x => x.id === m.cat)[0] || RELEVE.categories[3];
         return carte('<div class="rang">' +
           '<div style="flex:1;min-width:0"><b>' + esc(m.texte) + '</b>' +
           '<div class="mini">' + esc(m.par) + ' · ' + fmtDC(m.jour) + ' ' + heure(m.at) +
           (m.luPar && m.luPar.length ? ' · lu par ' + esc(m.luPar.join(', ')) : '') + '</div></div>' +
           (m.epingle ? '<span class="pill ambre">Épinglé</span>' : '') +
           (m.luPar && m.luPar.indexOf(STATE.user.prenom) >= 0 ? ''
             : '<button class="btn clair sm" data-lu="' + esc(m.id) + '">J’ai lu</button>') + '</div>',
           m.epingle ? 'ambre' : c.couleur);
       }).join('') + '</div>' : vide('💬', 'Aucun message pour l’instant.'));
   
     let cat = 'info', epingle = false;
     $$('#rc [data-rc]').forEach(b => b.onclick = () => {
       $$('#rc .chip').forEach(x => x.classList.remove('on'));
       b.classList.add('on'); cat = b.dataset.rc;
     });
     /* « Épingler » est une option du message à publier, pas une action : le
        toast « Message épinglé » laissait croire que c'était fait. */
     $('#rp').onclick = () => {
       epingle = !epingle;
       $('#rp').classList.toggle('ambre', epingle);
       $('#rp').textContent = epingle ? 'Épinglé ✓' : 'Épingler';
       $('#rp').setAttribute('aria-pressed', epingle ? 'true' : 'false');
       toast(epingle ? 'Le message sera épinglé à sa publication' : 'Le message ne sera pas épinglé');
     };
   
     $('#rv').onclick = async () => {
       const txt = $('#rt').value.trim();
       if (!txt) return toast('Écrivez votre message', 'erreur');
       await DB.push('releve', { id:uid(), texte:txt, cat:cat, epingle:epingle, jour:today(),
                                 par:STATE.user.prenom, employe:STATE.user.id, at:nowISO(), luPar:[] });
       await feed('ok', STATE.user.prenom + ' a laissé un mot dans le carnet de relève');
       toast(epingle ? 'Message publié et épinglé' : 'Message publié');
       rendre('releve');
     };
   
     $$('[data-lu]').forEach(b => b.onclick = async () => {
       const m = liste.filter(x => x.id === b.dataset.lu)[0];
       if (!m) return;
       m.luPar = m.luPar || [];
       if (m.luPar.indexOf(STATE.user.prenom) < 0) m.luPar.push(STATE.user.prenom);
       m.lu = true;
       await DB.set('releve', liste);
       rendre('releve');
     });
   };
   
   /* =============================================================================
      16. VUE — BIBLIOTHÈQUE
      ========================================================================== */
   V.fiches = async function () {
     const cats = FICHES.map(f => f.cat).filter((c, i, a) => a.indexOf(c) === i);
   
     $('#page').innerHTML = cats.map(c =>
       '<div class="entete"><h3>' + esc(c) + '</h3></div><div class="stack">' +
       FICHES.filter(f => f.cat === c).map(f =>
         carte('<div class="rang">' +
           '<div style="flex:1;min-width:0"><b>' + esc(f.titre) + '</b>' +
           '<div class="mini">' + esc(f.resume) + '</div></div>' +
           pastille('n', f.duree) + '</div>', 'tap').replace('<div class="card', '<div data-f="' + f.id + '" class="card')
       ).join('') + '</div>').join('');
   
     $$('[data-f]').forEach(b => b.onclick = () => {
       const f = FICHES.filter(x => x.id === b.dataset.f)[0];
       showSheet(
         '<h2 id="sheet-titre">' + esc(f.titre) + '</h2>' +
         '<p class="sub">' + esc(f.resume) + '</p>' +
         '<div class="stack">' + f.etapes.map((s, i) =>
           '<div class="tache"><span class="box" style="border:0;background:var(--ciel-l);color:var(--ciel-d)">' +
           (i + 1) + '</span><span class="tx"><span class="tn">' + esc(s) + '</span></span></div>').join('') + '</div>' +
         '<div class="alerte warn" style="margin-top:16px"><span class="ai">•</span>' +
         '<div><b>Sécurité</b><p>' + esc(f.securite) + '</p></div></div>' +
         '<div class="alerte info" style="margin-top:10px"><span class="ai">⏱️</span>' +
         '<div><b>Validité</b><p>' + esc(f.validite) + '</p></div></div>' +
         '<div class="actions"><button class="btn clair" data-fermer>Fermer</button></div>');
     });
   };
   
   /* =============================================================================
      17. VUE — POINTEUSE
      ========================================================================== */
   V.pointage = async function () {
     const cles = (await DB.list('pointage:')).reverse().slice(0, 14);
     const jours = [];
     for (const c of cles) jours.push({ jour:c.replace('pointage:', ''), l:await DB.get(c, []) });
   
     const mien = jours.map(d => ({ jour:d.jour, s:d.l.filter(x => x.employe === STATE.user.id) }))
                       .filter(d => d.s.length);
     const totalMin = mien.reduce((s, d) => s + d.s.reduce((a, x) => a + (x.minutes || 0), 0), 0);
   
     $('#page').innerHTML =
       carte(entete('⏱️', STATE.service ? 'En service' : 'Hors service',
         STATE.service ? 'Depuis ' + heure(STATE.service.debut) : 'Pointez en arrivant.') +
         '<button class="btn ' + (STATE.service ? 'corail' : 'menthe') + ' bloc xl" id="pt">' +
         (STATE.service ? 'Terminer mon service' : 'Prendre mon service') + '</button>', 'solide') +
   
       carte(entete('📅', 'Mes heures', 'Sur les 14 derniers jours enregistrés.') +
         '<div class="rang"><b class="num" style="font-size:26px">' +
         Math.floor(totalMin / 60) + ' h ' + String(totalMin % 60).padStart(2, '0') + '</b>' +
         '<span class="mini">cumulées</span></div>') +
   
       (mien.length ? '<div class="stack">' + mien.map(d =>
         carte('<div class="rang"><div style="flex:1"><b>' + nomJour(d.jour) + ' ' + fmtDC(d.jour) + '</b>' +
           '<div class="mini">' + d.s.map(x => heure(x.debut) + ' → ' + (x.fin ? heure(x.fin) : 'en cours')).join(' · ') + '</div></div>' +
           '<span class="num"><b>' + (() => {
             const t = d.s.reduce((a, x) => a + (x.minutes || 0), 0);
             return Math.floor(t / 60) + ' h ' + String(t % 60).padStart(2, '0');
           })() + '</b></span></div>')).join('') + '</div>'
         : vide('⏱️', 'Aucun pointage enregistré.'));
   
     $('#pt').onclick = () => pointer(!STATE.service);
   };
   
   /* =============================================================================
      18. RETOUR BÊTA
      ========================================================================== */
   /* Ouvert depuis le menu « Tout le reste » (ouvrirPlus). */
   function ouvrirRetour() {
     showSheet(
       '<h2 id="sheet-titre">Signaler un souci</h2>' +
       '<p class="sub">L’application est en bêta. La page et l’heure sont ajoutées automatiquement.</p>' +
       '<div class="chips" id="fbt">' +
       ['Ça ne marche pas', 'Un chiffre est faux', 'Une idée', 'Autre'].map((t, i) =>
         '<button type="button" class="chip' + (i === 0 ? ' on' : '') + '" data-t="' + esc(t) + '">' + esc(t) + '</button>').join('') +
       '</div><div class="champ" style="margin-top:14px">' +
       '<textarea id="fbx" data-autofocus aria-label="Décrivez le souci" placeholder="Ex. quand je valide le nettoyage, la ligne ne se coche pas."></textarea>' +
       '<p class="mini" style="margin-top:6px">' + esc(CONSIGNE_TEXTE_LIBRE) + '</p></div>' +
       '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
       '<button class="btn menthe" id="fbv">Envoyer</button></div>');
   
     let type = 'Ça ne marche pas';
     $$('#fbt [data-t]').forEach(x => x.onclick = () => {
       $$('#fbt .chip').forEach(y => y.classList.remove('on'));
       x.classList.add('on'); type = x.dataset.t;
     });
     $('#fbv').onclick = async () => {
       const t = $('#fbx').value.trim();
       if (!t) return toast('Décrivez le souci en une phrase', 'erreur');
       await DB.push('feedback', { id:uid(), type:type, texte:t, vue:STATE.view,
                                   par:STATE.user.prenom, at:nowISO(), version:APP.version });
       await feed('warn', STATE.user.prenom + ' a signalé un souci sur « ' + (PAGES[STATE.view] || {}).titre + ' »');
       closeSheet();
       toast(messageEnvoi('feedback', 'Merci, c’est transmis à ' + nomManager()));
     };
   }
   
   /* =============================================================================
   REMISE À ZÉRO DE L'APPAREIL
   Sur iPad la console n'est pas accessible : la remise à zéro doit donc vivre
   dans l'application. Deux accès, tous deux avant connexion :
     • le lien discret en bas de l'écran des prénoms
     • l'adresse https://…/?reset tapée directement dans le navigateur
   ========================================================================== */
/* garderRattachement : « vider les saisies » ne détache plus l'appareil. Le
   jeton du compte de la boutique (AUTH.cle) partait avec le reste : il
   fallait ressortir les identifiants de la boutique pour repartir.
   La file d'attente reste avec lui : ces saisies n'existent nulle part
   ailleurs, et l'appareil, toujours rattaché, les enverra au retour de la
   base. Elle partait aussi, base injoignable ou non (DON-07). Seul le
   détachement l'efface, après l'avertissement de la feuille.
   La copie locale des clés encore en file reste aussi : sans elle, une
   nouvelle saisie hors ligne sur la même fiche repartait de zéro et
   remplaçait, dans la file, celle qu'on venait de garder. */
async function viderAppareil(garderRattachement) {
  let cles = 0, cachesEff = 0, sw = 0;
  try {
    const p = OFFLINE.storeLocal + ':';
    const jeton = (typeof AUTH !== 'undefined') ? AUTH.cle : null;
    const gardees = garderRattachement
      ? [jeton, p + OFFLINE.fileAttente].concat(fileLire().map(x => p + x.cle))
      : [];
    Object.keys(localStorage).filter(k => k.indexOf(p) === 0)
      .filter(k => gardees.indexOf(k) < 0)
      .forEach(k => { localStorage.removeItem(k); cles++; });
    /* Le compteur d'échecs du PIN survit à la remise à zéro : sinon elle
       servirait à lever le blocage anti-essais. */
    if (typeof sauverPinEchecs === 'function') sauverPinEchecs();
  } catch (e) {}
  try {
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) { await r.unregister(); sw++; }
    }
  } catch (e) {}
  try {
    if (window.caches) {
      const noms = await caches.keys();
      for (const n of noms) { await caches.delete(n); cachesEff++; }
    }
  } catch (e) {}
  return { cles: cles, caches: cachesEff, sw: sw };
}

function ecranRemiseAZero(auto) {
  const p = OFFLINE.storeLocal + ':';
  let n = 0;
  try { n = Object.keys(localStorage).filter(k => k.indexOf(p) === 0).length; } catch (e) {}
  const rattache = (typeof appareilRattache === 'function') && appareilRattache();

  /* Confirmation forte : le bouton reste inactif tant que le mot n'est pas
     tapé. Un appui (ou un lien …/?reset reçu par message) ne suffit plus à
     tout effacer sans code. */
  showSheet(
    '<h2 id="sheet-titre">Réinitialiser cet appareil</h2>' +
    '<p class="sub">' + n + ' élément(s) enregistré(s) sur cet appareil</p>' +

    '<div class="alerte warn"><span class="ai">●</span><div><b>Ce qui va être effacé</b>' +
    '<p>Les saisies gardées en local, la session ouverte, et la version en cache de ' +
    'l’application. Ce qui est déjà remonté dans la base n’est pas touché et reviendra ' +
    'tout seul à la reconnexion.</p></div></div>' +

    (DB.configure ? '' : '<div class="alerte bad" style="margin-top:10px"><span class="ai">▲</span><div>' +
      '<b>Aucune base configurée</b><p>Rien de ce qui a été saisi ici n’existe ailleurs : ' +
      'tout sera définitivement perdu.</p></div></div>') +
    '<div id="rz-file"></div>' +

    (rattache ? '<label class="rang" style="margin-top:14px;gap:12px;align-items:flex-start;flex-wrap:nowrap">' +
      '<input type="checkbox" id="rz-detacher" style="width:22px;height:22px;flex:0 0 auto;margin-top:1px">' +
      '<span style="flex:1;min-width:0"><b>Détacher aussi l’appareil</b><span class="mini" style="display:block">Il faudra ' +
      'le rattacher avec les identifiants de la boutique. Sans cette case, il reste rattaché.</span></span></label>' : '') +

    '<div class="champ" style="margin-top:14px"><label class="f" for="rz-mot">Pour confirmer, tapez EFFACER</label>' +
    '<input type="text" id="rz-mot" autocomplete="off" autocapitalize="characters" spellcheck="false"></div>' +

    '<div class="actions"><button class="btn clair" id="rz-x">Annuler</button>' +
    '<button class="btn corail" id="rz-ok" disabled>Tout effacer</button></div>');

  /* Arrivée par …/?reset : le démarrage s'est arrêté avant de charger l'équipe.
     Fermer la feuille (Échap, voile, Retour) laissait un écran des prénoms vide
     et la session ouverte jamais reprise : seule « Annuler » sort, par un
     redémarrage complet sur l'adresse déjà nettoyée. */
  if (auto) $('#sheet').dataset.obligatoire = '1';

  /* Saisies encore en file d'attente : leur nombre exact, et une dernière
     tentative d'envoi avant le nettoyage.
     Sans détachement, la file est gardée (viderAppareil) : on le dit, au
     lieu d'annoncer une perte qui n'aura pas lieu. Cocher « Détacher »
     change l'annonce : là, elles seraient vraiment perdues. */
  const majFile = () => {
    const zone = $('#rz-file');
    if (!zone) return;
    const nb = fileLire().length;
    const perdues = !!($('#rz-detacher') && $('#rz-detacher').checked);
    zone.innerHTML = nb
      ? (perdues
        ? '<div class="alerte bad" style="margin-top:10px"><span class="ai">▲</span><div>' +
          '<b>' + nb + ' saisie(s) jamais envoyée(s) à la base</b><p>Détacher l’appareil les efface : elles n’existent que sur cet ' +
          'appareil et seront perdues.' + (DB.configure ? ' Reconnectez-le au réseau puis touchez « Envoyer d’abord ».' : '') +
          '</p></div></div>'
        : '<div class="alerte warn" style="margin-top:10px"><span class="ai">●</span><div>' +
          '<b>' + nb + ' saisie(s) pas encore envoyée(s) à la base</b><p>Elles restent sur l’appareil : ' +
          'il les enverra de lui-même dès que la base répondra.</p></div></div>') +
        (DB.configure ? '<button class="btn clair bloc" id="rz-sync" style="margin-top:10px">Envoyer d’abord</button>' : '')
      : '';
    const b = $('#rz-sync');
    if (b) b.onclick = async () => {
      b.disabled = true; b.textContent = 'Envoi…';
      try { await journaliserSync(); } catch (e) {}
      majFile();
      if (fileLire().length) toast('Envoi impossible pour l’instant — réseau ou base injoignable', 'erreur');
    };
  };
  majFile();
  if (fileLire().length && DB.configure) journaliserSync().then(majFile, majFile);
  if ($('#rz-detacher')) $('#rz-detacher').onchange = majFile;

  const ok = $('#rz-ok');
  $('#rz-mot').oninput = () => { ok.disabled = $('#rz-mot').value.trim().toUpperCase() !== 'EFFACER'; };

  $('#rz-x').onclick = function () {
    if (auto) { location.replace(location.pathname); return; }
    closeSheet();
  };
  ok.onclick = async function () {
    if ($('#rz-mot').value.trim().toUpperCase() !== 'EFFACER') return;
    const detacher = !!($('#rz-detacher') && $('#rz-detacher').checked);
    $('#sheet').dataset.obligatoire = '1';      // plus de fermeture pendant le nettoyage
    $('#sheet-corps').innerHTML =
      '<h2>Nettoyage en cours…</h2><div class="vide">Un instant</div>';
    const r = await viderAppareil(!detacher);
    const gardees = detacher ? 0 : fileLire().length;
    $('#sheet-corps').innerHTML =
      '<h2>Appareil remis à zéro</h2>' +
      '<p class="sub">' + r.cles + ' saisie(s), ' + r.sw + ' service worker, ' +
      r.caches + ' cache(s) effacés' + (rattache && !detacher ? ' · appareil toujours rattaché' : '') +
      (gardees ? ' · ' + gardees + ' envoi(s) en attente gardé(s)' : '') + '.</p>' +
      '<div class="alerte ok" style="margin-top:12px"><span class="ai">•</span><div>' +
      '<b>Redémarrage…</b><p>L’application va se recharger sur sa dernière version.</p></div></div>';
    setTimeout(function () { location.replace(location.pathname); }, 1500);
  };
}

/* Session mémorisée → utilisateur. Le rôle et le nom viennent d'EQUIPE, la
   source de vérité, jamais de la session : celle-ci vit dans le localStorage
   et un « role:'manager' » écrit à la main ouvrait l'espace manager. Un rôle
   retiré depuis la dernière connexion est aussi pris en compte. */
/* La session reprise sans code (rechargement, relance de la PWA) ne vaut que
   tant que l'appareil sert : après 8 h sans activité — une nuit, un jour de
   fermeture — le code PIN est redemandé. Un iPad laissé ouvert sur le compte
   du manager ne donne plus tout, à n'importe qui, le lendemain. Une session
   sans date d'activité (ancienne, ou fabriquée à la main) n'est pas reprise.
   Ce n'est qu'un frein local : la vraie barrière est côté base (ACC-03/08). */
const SESSION_INACTIVITE_MS = 8 * 3600 * 1000;
let _sessionTouchee = 0;
function toucherSession() {
  if (!STATE.user || Date.now() - _sessionTouchee < 60000) return;
  _sessionTouchee = Date.now();
  try { DB.set('session', Object.assign({}, STATE.user, { vu:Date.now() })); } catch (e) {}
}
document.addEventListener('pointerdown', toucherSession, { passive:true });
document.addEventListener('keydown', toucherSession, { passive:true });

function utilisateurDeSession(s) {
  if (!s || !s.id) return null;
  if (!(s.vu > 0) || Date.now() - s.vu > SESSION_INACTIVITE_MS || s.vu > Date.now() + 60000) return null;
  const e = EQUIPE.filter(x => x.id === s.id)[0];
  if (!e) return null;
  return { id:e.id, prenom:e.prenom, role:e.role, couleur:e.couleur, initiales:e.initiales };
}

/* -----------------------------------------------------------------------------
   BOUTON RETOUR DU TÉLÉPHONE
   Une application d'une seule page n'a pas d'historique : un appui sur « retour »
   quittait donc l'application, parfois au milieu d'une saisie. On lui donne un
   comportement attendu : fermer la feuille ouverte, sinon revenir à l'accueil,
   et ne laisser sortir que depuis l'accueil.
   -------------------------------------------------------------------------- */
function vueAccueil() {
  return (STATE.user && STATE.user.role === 'manager') ? 'controle' : 'accueil';
}

/* Vue réservée au manager demandée sans le rôle : bouton retour (historique
   d'un manager rétrogradé, ou d'une autre personne sur un iPad partagé), action
   lancée avant une rétrogradation (« Tout traiter »). rendre() sert l'accueil.
   Les menus sont lus à l'appel : les vues ajoutées par modules.js comptent. */
function vueAutorisee(id) {
  const role = STATE.user && STATE.user.role;
  if (!role || role === 'manager') return true;
  const de = r => (TABS[r] || []).map(t => t.id).concat(MENU_PLUS[r] || []);
  return de('manager').indexOf(id) < 0 || de(role).indexOf(id) >= 0;
}

window.addEventListener('popstate', function (ev) {
  /* 0. Retour provoqué par closeSheet lui-même : l'entrée de la feuille est
     retirée, il n'y a rien d'autre à faire (sinon : boucle, ou vue changée). */
  if (_ignorerPop) { _ignorerPop = false; return; }

  /* 1. Une feuille est ouverte : le retour la ferme, comme on l'attend.
     L'entrée d'historique de la feuille vient d'être consommée : closeSheet
     ne doit pas en retirer une seconde. Une feuille obligatoire, elle, ne se
     ferme pas : on remet l'entrée consommée. */
  const sheet = document.getElementById('sheet');
  if (sheet && !sheet.hidden) {
    if (sheet.dataset.obligatoire) {
      try { history.pushState({ vue:STATE.view, feuille:true }, '', location.pathname); } catch (e) {}
      _feuilleHisto = true;
      return;
    }
    _feuilleHisto = false;
    closeSheet();
    return;
  }

  /* 2. Pas connecté : on laisse le navigateur faire son travail. */
  if (!STATE.user) return;

  /* 3. Une vue précédente existe : on y retourne. */
  const cible = ev.state && ev.state.vue;
  if (cible && V[cible]) { rendre(cible, true); return; }

  /* 4. Rien derrière : on ramène à l'accueil plutôt que de quitter. Depuis
     l'accueil lui-même, un second appui sortira vraiment. */
  const accueil = vueAccueil();
  if (STATE.view !== accueil) {
    rendre(accueil, true);
    pousserHistorique({ vue:accueil });
  }
});

/* -----------------------------------------------------------------------------
   NAVIGATION ENTRE LES JOURS
   Tout le monde peut consulter n'importe quel jour. La modification, elle, est
   réservée au jour en cours pour l'équipe : un registre sanitaire ne se
   réécrit pas après coup. Le manager, lui, peut corriger le passé — c'est sa
   responsabilité et ça laisse une trace à son nom.
   -------------------------------------------------------------------------- */
function peutModifier(jour) {
  if (jour === today()) return true;
  /* Un jour futur n'a rien à valider : le manager pouvait signer d'avance
     les tâches ou la caisse de demain. Le passé reste corrigible par lui. */
  if (jour > today()) return false;
  return !!(STATE.user && STATE.user.role === 'manager');
}

/* Barre de navigation : jour précédent, date, jour suivant. */
function navJour(jour) {
  const hier = addD(jour, -1), demain = addD(jour, 1);
  return '<div class="navjour">' +
    '<button type="button" data-nj="' + hier + '" aria-label="Jour précédent">' + ic('gauche', 22) + '</button>' +
    '<div class="nj-c"><b>' + nomJour(jour) + '</b><span>' + fmtD(jour) + '</span></div>' +
    '<button type="button" data-nj="' + demain + '" aria-label="Jour suivant">' + ic('droite', 22) + '</button>' +
    '</div>' +
    (jour === today() ? '' :
      '<button type="button" class="btn clair bloc sm" data-nj="' + today() + '" ' +
      'style="margin:-4px 0 12px">Revenir à aujourd’hui</button>') +
    (peutModifier(jour) ? '' :
      '<div class="lecture">Consultation seule — ' + (jour > today()
        ? 'un jour à venir ne se remplit pas d’avance.' : 'seul le jour en cours est modifiable.') + '</div>');
}

/* À appeler après avoir injecté navJour dans la page. */
function brancherNavJour(vue) {
  $$('[data-nj]').forEach(b => b.onclick = () => {
    STATE.jour = b.dataset.nj;
    if (V.temp && V.temp._d !== undefined) V.temp._d = STATE.jour;
    rendre(vue);
  });
  /* En consultation, on neutralise tout ce qui modifie. */
  if (!peutModifier(STATE.jour)) {
    $$('#page button').forEach(b => {
      /* Les vignettes restent ouvrables : en consultation, on regarde une
         photo sans pouvoir la supprimer (voirPreuve en lecture seule). */
      if (b.dataset.nj !== undefined || b.dataset.vign !== undefined) return;
      b.disabled = true;
      b.classList.add('fige');
    });
    $$('#page input, #page select, #page textarea').forEach(i => { i.disabled = true; });
  }
}

/* -----------------------------------------------------------------------------
   L'ÉQUIPE VIENT DE LA BASE, PLUS DU CODE SOURCE
   Les codes PIN étaient écrits en clair dans config.js : n'importe qui affichant
   la source de la page les lisait. Ils vivent maintenant dans la table
   « equipe », servie au seul appareil rattaché. La liste est gardée localement
   pour que la connexion fonctionne hors ligne.
   -------------------------------------------------------------------------- */
/* -----------------------------------------------------------------------------
   CODES PIN HACHÉS
   Le code n'est plus gardé en clair, ni en base ni dans l'iPad : seulement
   SHA-256(sel + code), avec un sel tiré au hasard par personne. Quatre chiffres
   se retrouvent en 10 000 essais, donc ce n'est pas un coffre-fort ; mais un
   équipier réutilise souvent le code de sa carte bancaire, et celui-là ne doit
   plus se lire en ouvrant la ligne « equipe ».
   Les anciennes fiches (champ « pin ») restent acceptées, puis sont converties
   dès que la base répond (migrerPins).
   -------------------------------------------------------------------------- */
const pinHachable = () => !!(window.crypto && crypto.subtle && crypto.getRandomValues);

async function hacherPin(sel, pin) {
  const brut = new TextEncoder().encode(sel + ':' + pin);
  const h = await crypto.subtle.digest('SHA-256', brut);
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function nouveauSel() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Fiche { pin } → { pinH, sel }. Fiche déjà hachée : rendue telle quelle. */
async function fichePinHachee(e) {
  if (e.pinH || e.pin === undefined || e.pin === null || e.pin === '') return e;
  const sel = nouveauSel();
  const f = Object.assign({}, e, { sel: sel, pinH: await hacherPin(sel, String(e.pin)) });
  delete f.pin;
  return f;
}

/* Fiche avec un code exploitable. « undefined » est ce qu'écrit un iPad
   resté sur l'ancien code face à une fiche hachée : elle est écartée. */
function ficheValide(e) {
  return !!e && (e.pinH ? !!e.sel
    : (e.pin !== undefined && e.pin !== null && /^\d{4}$/.test(String(e.pin))));
}

async function pinCorrect(e, saisi) {
  if (!e || !saisi) return false;
  if (e.pinH) {
    if (!pinHachable() || !e.sel) return false;
    return (await hacherPin(e.sel, saisi)) === e.pinH;
  }
  return e.pin !== undefined && String(e.pin) === saisi;
}

async function chargerEquipe() {
  /* 1. Ce qu'on a déjà en local : la connexion doit marcher hors ligne.
     Étape synchrone, avant tout await : le démarrage lit EQUIPE dès le retour
     de l'appel, pour afficher les prénoms sans attendre la base. */
  const local = (() => {
    try { return JSON.parse(localStorage.getItem('pilotshop.v3:equipe') || 'null'); }
    catch (e) { return null; }
  })();
  const localValide = Array.isArray(local) ? local.filter(ficheValide) : [];
  if (localValide.length) EQUIPE.splice(0, EQUIPE.length, ...localValide);

  const garder = l => {
    if (!Array.isArray(l) || !l.length) return false;
    const valides = l.filter(ficheValide);
    if (!valides.length) return false;
    EQUIPE.splice(0, EQUIPE.length, ...valides.map(e => {
      const f = { id: e.id, prenom: e.prenom, role: e.role,
                  couleur: e.couleur, initiales: e.initiales };
      if (e.pinH) { f.pinH = e.pinH; f.sel = e.sel; }
      else f.pin = String(e.pin);
      return f;
    }));
    try { localStorage.setItem('pilotshop.v3:equipe', JSON.stringify(EQUIPE)); } catch (x) {}
    return true;
  };

  /* 2. Table dédiée « equipe », si elle existe. Elle n'a PAS été créée : le
     script SQL simplifié l'a abandonnée au profit d'une ligne dans reglages.
     L'interroger renvoyait 404 et allumait le bandeau « Table introuvable » à
     chaque démarrage. On ne la sollicite que si on l'a déjà vue répondre. */
  const tableDediee = (() => {
    try { return localStorage.getItem('pilotshop.v3:table-equipe') === 'oui'; }
    catch (e) { return false; }
  })();
  if (tableDediee) {
    try {
      const jeton = (typeof jetonValide === 'function') ? await jetonValide() : null;
      if (jeton) {
        const r = await fetch(SUPABASE.url + '/rest/v1/equipe?select=*&actif=eq.true&order=prenom', {
          headers: { 'apikey': SUPABASE.anonKey, 'Authorization': 'Bearer ' + jeton },
          signal: signalDelai()
        });
        if (r.status === 404) {
          try { localStorage.removeItem('pilotshop.v3:table-equipe'); } catch (e) {}
        } else if (r.ok && garder(await r.json())) return 'base';
      }
    } catch (e) { /* hors ligne : on continue */ }
  }

  /* 3. Repli : une ligne dans la table des réglages. Ne demande aucune
     migration de schéma, donc fonctionne dès maintenant.
     Lecture dédiée plutôt que DB.get : DB.get rend null aussi bien quand la
     base n'a pas de ligne que quand le réseau a échoué, et ce null-là
     faisait proposer de « créer l'équipe » à un iPad simplement hors ligne. */
  const lu = await lireEquipeBase();
  if (lu.etat === 'base' && garder(lu.data)) {
    const hachee = await migrerPins(lu.data);
    if (hachee) garder(hachee);
    return 'base';
  }

  /* 4. Toujours rien : « vide » si la base a vraiment répondu sans équipe
     (l'écran d'amorçage prendra le relais), « reseau » si on n'a pas pu la
     joindre (il faudra réessayer, surtout pas recréer une équipe). */
  return EQUIPE.length ? 'local' : (lu.etat === 'reseau' ? 'reseau' : 'vide');
}

/* La base a répondu avec des codes encore en clair : on les hache et on
   réécrit la ligne. Seulement depuis une lecture fraîche de la base, jamais
   depuis la copie locale, pour ne pas écraser une équipe modifiée ailleurs.
   Rend la liste hachée, ou null s'il n'y avait rien à faire. */
async function migrerPins(liste) {
  if (!PIN_HACHAGE || !pinHachable() || !Array.isArray(liste)) return null;
  if (!liste.some(e => !e.pinH && e.pin !== undefined && e.pin !== null && e.pin !== '')) return null;
  try {
    const hachee = [];
    for (const e of liste) hachee.push(await fichePinHachee(e));
    await DB.set('equipe', hachee);
    return hachee;
  } catch (e) { return null; /* on réessaiera au prochain chargement */ }
}

/* Lecture de la ligne « equipe » en distinguant l'échec réseau d'une réponse
   vide. Rend { etat:'base', data } quand la base a répondu (data null si
   aucune ligne), { etat:'reseau' } quand elle n'a pas pu être jointe.
   Sans base configurée, tout est local par choix : réponse « base » vide. */
async function lireEquipeBase() {
  if (!DB.configure || !DB._distant('equipe')) return { etat:'base', data:null };
  /* Une équipe saisie hors ligne attend encore dans la file : la copie locale
     est la plus récente, la base ne fait pas foi. */
  if (fileLire().some(x => x.cle === 'equipe')) {
    try { return { etat:'base', data:JSON.parse(DB._lire('equipe') || 'null') }; }
    catch (e) { return { etat:'base', data:null }; }
  }
  if (!navigator.onLine) return { etat:'reseau' };
  try {
    const l = await DB._appel(DB._table('equipe') + '?id=eq.' + encodeURIComponent('equipe') +
                              '&select=data&limit=1');
    lireEquipeBase.refus = false;
    return { etat:'base', data:(l && l.length) ? l[0].data : null };
  } catch (e) {
    /* 401/403 : la base répond mais refuse cet appareil. Ce n'est pas le
       Wi-Fi ; l'écran d'attente le dira (e.http est posé par DB._appel). */
    lireEquipeBase.refus = !!(e && (e.http === 401 || e.http === 403));
    return { etat:'reseau', http:e && e.http };
  }
}

/* -----------------------------------------------------------------------------
   ÉQUIPE INJOIGNABLE
   Pas d'équipe en local et la base ne répond pas : on ne propose PAS de créer
   une équipe — elle existe sans doute déjà, et l'écraser couperait l'accès de
   tous les autres appareils. On attend le réseau.
   -------------------------------------------------------------------------- */
function ecranEquipeInjoignable() {
  if (document.getElementById('amorcage')) return;
  const d = document.createElement('div');
  d.id = 'amorcage';
  document.body.appendChild(d);
  /* Refus du serveur (401/403) : le Wi-Fi n'y est pour rien. */
  const motifRefus = 'L’appareil doit être rattaché à nouveau.';
  const refus = !!lireEquipeBase.refus;
  d.innerHTML =
    '<div class="in">' +
    '<div class="lg"><h1>Pilot-Shop</h1><p>' + esc(APP.site) + '</p></div>' +
    '<div class="card solide">' +
    '<h2>Connexion nécessaire pour charger l’équipe</h2>' +
    '<div class="cs" id="eq-motif">La liste de l’équipe n’est pas encore sur cet appareil et la base ' +
    (refus ? 'refuse l’accès. ' + motifRefus : 'ne répond pas. Vérifiez le Wi-Fi, puis réessayez.') + '</div>' +
    '<button class="btn menthe bloc xl" id="eq-retry" style="margin-top:14px">Réessayer</button>' +
    '<p class="mini" id="eq-etat" style="text-align:center;margin-top:12px"></p>' +
    '</div></div>';
  const essayer = async () => {
    if (!d.isConnected) return;
    const bouton = d.querySelector('#eq-retry');
    if (bouton.disabled) return;
    bouton.disabled = true;
    d.querySelector('#eq-etat').textContent = 'Connexion…';
    const etat = await chargerEquipe();
    bouton.disabled = false;
    if (etat === 'reseau') {
      d.querySelector('#eq-etat').textContent = lireEquipeBase.refus
        ? motifRefus
        : 'Toujours pas de connexion. Réessayez dans un instant.';
      return;
    }
    window.removeEventListener('online', auRetourReseau);
    d.remove();
    if (typeof initLogin === 'function') initLogin();
    if (etat === 'vide') ecranAmorcage();
  };
  /* Nouvel essai automatique au retour du réseau ; l'écouteur est retiré
     après usage (un seul essai par retour, le bouton reste disponible). */
  function auRetourReseau() {
    window.removeEventListener('online', auRetourReseau);
    essayer().then(() => { if (d.isConnected) window.addEventListener('online', auRetourReseau); });
  }
  window.addEventListener('online', auRetourReseau);
  d.querySelector('#eq-retry').onclick = essayer;
}

/* L'équipe change rarement, mais quand elle change il faut que ça suive :
   un code modifié ou une personne ajoutée sur un autre appareil ne remontait
   jamais, la liste locale étant relue indéfiniment. */
setInterval(function () {
  if (typeof chargerEquipe === 'function' && STATE.enLigne) chargerEquipe().then(revaliderSession, function () {});
}, 300000);

/* Bouton de compte : initiales et couleur de la personne connectée. Le nom
   lu par un lecteur d'écran commence par les initiales affichées : « Mon
   compte » seul ne correspondait pas à ce qu'on voit (WCAG 2.5.3). */
function majBoutonCompte() {
  const bc = $('#compte');
  if (!bc || !STATE.user) return bc;
  const ini = STATE.user.initiales || '';
  bc.textContent = ini;
  bc.style.background = STATE.user.couleur || 'var(--encre)';
  bc.setAttribute('aria-label', (ini ? ini + ', ' : '') + 'compte de ' + STATE.user.prenom);
  return bc;
}

/* L'équipe relue, la session ouverte suit. Une personne retirée sur un autre
   iPad gardait sa session jusqu'au prochain rechargement, et un rôle changé
   restait l'ancien. Retirée : retour immédiat à l'écran des prénoms. Rôle
   changé : la session prend le nouveau rôle tout de suite (les contrôles
   lisent STATE.user.role), puis onglets et accueil sont redessinés dès
   qu'aucune feuille n'est ouverte, pour ne pas couper une saisie.
   Redessiner et non recharger : un rechargement interrompait l'envoi en
   cours, et une saisie partie mais pas encore arrivée n'était ni en base
   ni dans la file d'attente. */
let _roleARedessiner = false;
function appliquerNouveauRole() {
  if (!_roleARedessiner || !STATE.user || !$('#sheet').hidden) return;
  _roleARedessiner = false;
  renderNav();
  rendre(vueAccueil());
}
function revaliderSession() {
  if (!STATE.user) return;
  const e = EQUIPE.filter(x => x.id === STATE.user.id)[0];
  if (!e) {
    DB.del('session').then(() => location.reload(), () => location.reload());
    return;
  }
  if (e.role !== STATE.user.role) _roleARedessiner = true;
  Object.assign(STATE.user, { prenom:e.prenom, role:e.role, couleur:e.couleur, initiales:e.initiales });
  majBoutonCompte();
  if (!_roleARedessiner) return;
  if ($('#sheet').hidden) appliquerNouveauRole();
  else toast('Votre rôle a changé : l’écran s’adapte dès la fermeture de cette fenêtre');
}

/* -----------------------------------------------------------------------------
   LA SÉCURITÉ EST-ELLE ACTIVE ?
   Plutôt que de supposer, on demande à la base. Tant que le rôle anonyme peut
   encore lire, l'application reste utilisable sans rattachement ; dès que les
   droits sont retirés, le rattachement devient obligatoire. L'application
   traverse donc la migration sans qu'on ait à synchroniser code et SQL à la
   seconde près — ce qui nous a déjà coûté une boutique bloquée.
   -------------------------------------------------------------------------- */
async function securiteActive() {
  /* Sans base configurée (mode local), la sonde partait en relatif vers
     « /rest/v1/reglages » sur l'hôte de l'application : un 404 en console à
     chaque démarrage, pour une question qui ne se pose pas. */
  if (!SUPABASE.url || !SUPABASE.anonKey) return false;
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 5000);
    /* Nom de table en clair : SUPABASE.tables.reglages n'existe pas dans la
       configuration, et l'URL devenait « /rest/v1/undefined » — 404 au lieu de
       401, donc la sonde concluait toujours que la sécurité était inactive. */
    const r = await fetch(SUPABASE.url + '/rest/v1/reglages?select=id&limit=1', {
      headers: { 'apikey': SUPABASE.anonKey, 'Authorization': 'Bearer ' + SUPABASE.anonKey },
      signal: ctrl.signal
    });
    /* 200 = le rôle anonyme a encore le droit de lire : sécurité non activée.
       401 ou 403 = droits retirés : le rattachement est requis. */
    if (r.status === 401 || r.status === 403) return true;
    return false;
  } catch (e) {
    /* Hors ligne : on ne bloque pas l'équipe sur une incertitude réseau. */
    return false;
  }
}

/* -----------------------------------------------------------------------------
   ÉCRAN D'AMORÇAGE
   Aucune équipe nulle part : ni en local, ni en base. Ça arrive au tout premier
   lancement d'un site, ou après une remise à zéro. Plutôt qu'un écran vide sans
   explication, on permet de créer l'équipe sur place.
   -------------------------------------------------------------------------- */
/* Couleurs d'avatar, partagées avec l'ajout d'une personne (V.equipe). */
const COULEURS_EQUIPE = ['#7FA6A0','#C4907A','#9AA87F','#8FB4CE','#0F2027','#C9A227'];

function ecranAmorcage() {
  if (document.getElementById('amorcage')) return;
  const COULEURS = COULEURS_EQUIPE;
  let lignes = [{ prenom:'', pin:'', role:'manager' }];

  const d = document.createElement('div');
  d.id = 'amorcage';
  document.body.appendChild(d);

  const dessiner = () => {
    d.innerHTML =
      '<div class="in">' +
      '<div class="lg"><h1>Pilot-Shop</h1><p>Première mise en service</p></div>' +
      '<div class="card solide">' +
      '<h2>Créer l’équipe</h2>' +
      '<div class="cs">Aucune équipe n’est encore enregistrée pour ' + esc(APP.site) + '. ' +
      'Commencez par la personne qui gère la boutique.</div>' +
      lignes.map((l, i) =>
        '<div class="card plat" style="margin-top:14px">' +
        '<div class="grid g2">' +
        '<div class="champ"><label class="f" for="am-p' + i + '">Prénom</label>' +
        '<input type="text" id="am-p' + i + '" data-p="' + i + '" value="' + esc(l.prenom) + '" autocapitalize="words"></div>' +
        '<div class="champ"><label class="f" for="am-c' + i + '">Code à 4 chiffres</label>' +
        '<input type="text" id="am-c' + i + '" inputmode="numeric" maxlength="4" data-c="' + i + '" value="' + esc(l.pin) + '"></div>' +
        '</div>' +
        '<div class="champ" style="margin-top:10px"><label class="f" for="am-r' + i + '">Rôle</label>' +
        '<select id="am-r' + i + '" data-r="' + i + '">' +
        '<option value="equipe"' + (l.role === 'equipe' ? ' selected' : '') + '>Équipier</option>' +
        '<option value="manager"' + (l.role === 'manager' ? ' selected' : '') + '>Manager</option>' +
        '</select></div></div>').join('') +
      '<button class="btn clair bloc" id="am-plus" style="margin-top:12px">+ Ajouter une personne</button>' +
      '<button class="btn menthe bloc xl" id="am-ok" style="margin-top:14px">Enregistrer</button>' +
      '<p class="mini" id="am-etat" style="text-align:center;margin-top:12px"></p>' +
      '</div></div>';

    const lire = () => {
      d.querySelectorAll('[data-p]').forEach(i => lignes[+i.dataset.p].prenom = i.value.trim());
      d.querySelectorAll('[data-c]').forEach(i => lignes[+i.dataset.c].pin = i.value.replace(/\D/g, ''));
      d.querySelectorAll('[data-r]').forEach(i => lignes[+i.dataset.r].role = i.value);
    };

    d.querySelector('#am-plus').onclick = () => {
      lire();
      lignes.push({ prenom:'', pin:'', role:'equipe' });
      dessiner();
    };

    d.querySelector('#am-ok').onclick = async () => {
      lire();
      const etat = m => { d.querySelector('#am-etat').textContent = m; };
      /* Une ligne commencée mais incomplète n'est plus écartée en silence :
         « Nina » sans code disparaissait et le message annonçait les autres
         comme si de rien n'était. Seules les lignes vides sont ignorées. */
      const valides = lignes.filter(l => l.prenom || l.pin);
      const incomplete = valides.filter(l => !l.prenom || l.pin.length !== 4)[0];
      if (incomplete) return etat(incomplete.prenom
        ? incomplete.prenom + ' : le code doit faire 4 chiffres.'
        : 'Un code est saisi sans prénom : complétez la ligne ou videz-la.');
      if (!valides.length) return etat('Renseignez au moins un prénom et un code à 4 chiffres.');
      if (!valides.some(l => l.role === 'manager')) return etat('Il faut au moins un manager.');
      /* Deux prénoms identiques donnaient deux tuiles indiscernables. */
      const noms = valides.map(l => l.prenom.toLowerCase());
      const double = valides.filter((l, i) => noms.indexOf(noms[i]) !== i)[0];
      if (double) return etat('Deux personnes s’appellent « ' + double.prenom + ' » : ajoutez une initiale (ex. ' + double.prenom + ' B.).');
      const codes = valides.map(l => l.pin);
      if (new Set(codes).size !== codes.length) return etat('Deux personnes ont le même code.');

      /* Dernière vérification avant d'écrire : si une équipe est apparue en
         base entre-temps (autre iPad, réseau revenu), on la reprend au lieu
         de l'écraser. Base injoignable : on n'écrit rien. */
      const lu = await lireEquipeBase();
      if (lu.etat === 'reseau') return etat('Connexion nécessaire pour enregistrer l’équipe. Réessayez.');
      if (Array.isArray(lu.data) && lu.data.length) {
        await chargerEquipe();
        d.remove();
        if (typeof initLogin === 'function') initLogin();
        toast('Une équipe existait déjà pour cette boutique : elle a été chargée');
        return;
      }

      /* Identifiants uniques, comme pour un ajout (V.equipe) : une équipe
         recréée ne doit pas redonner « e1 » à une autre personne, sinon une
         session restée ouverte sur un autre iPad passe à cette personne. Le
         suffixe garde distincts deux uid() tirés dans la même milliseconde. */
      let equipe = valides.map((l, i) => ({
        id: 'e' + uid() + i, prenom: l.prenom, pin: l.pin, role: l.role,
        couleur: COULEURS[i % COULEURS.length],
        initiales: l.prenom.slice(0, 2).toUpperCase()
      }));
      /* Les codes ne quittent jamais cet écran en clair. */
      if (PIN_HACHAGE && pinHachable()) equipe = await Promise.all(equipe.map(fichePinHachee));

      EQUIPE.splice(0, EQUIPE.length, ...equipe);
      try { localStorage.setItem('pilotshop.v3:equipe', JSON.stringify(equipe)); } catch (e) {}
      try { await DB.set('equipe', equipe); } catch (e) { /* partira avec la file */ }

      d.remove();
      if (typeof initLogin === 'function') initLogin();
      toast(equipe.length + ' personne(s) enregistrée(s)');
    };
  };

  dessiner();
}

/* -----------------------------------------------------------------------------
   ÉCHECS SILENCIEUX
   Les vues sont protégées par rendre(), et DB.set attrape ses propres erreurs.
   Mais un gestionnaire de clic écrit « onclick = async () => … » n'est surveillé
   par personne : si quelque chose casse à l'intérieur, le navigateur signale un
   rejet non traité dans la console — invisible sur un iPad — et l'équipier croit
   simplement que son appui n'a pas porté.

   On rend ces échecs visibles : un message court à l'écran, et le détail gardé
   pour le diagnostic.
   -------------------------------------------------------------------------- */
STATE.incidents = [];

window.addEventListener('unhandledrejection', function (ev) {
  const e = ev.reason || {};
  const msg = (e && (e.message || e.motif)) ? String(e.message || e.motif) : String(e);

  /* Une requête interrompue n'est pas un incident : c'est le délai d'attente
     qui a fait son travail, et la saisie part en file. */
  if (/AbortError|aborted|NetworkError|Failed to fetch/i.test(msg)) return;

  STATE.incidents.push({ at: nowISO(), vue: STATE.view, msg: msg.slice(0, 240) });
  if (STATE.incidents.length > 30) STATE.incidents.shift();

  console.error('Incident non traité :', STATE.view, e);
  if (typeof toast === 'function') {
    toast('L’action n’a pas abouti — réessayez', 'erreur');
  }
  ev.preventDefault();
});

window.addEventListener('error', function (ev) {
  if (!ev || !ev.message) return;
  STATE.incidents.push({ at: nowISO(), vue: STATE.view,
                         msg: String(ev.message).slice(0, 240),
                         ligne: ev.lineno });
  if (STATE.incidents.length > 30) STATE.incidents.shift();
  /* Une exception dans un gestionnaire de clic est aussi muette qu'un rejet :
     on prévient, sinon l'appui semble simplement n'avoir rien fait. */
  if (typeof toast === 'function') toast('L’action n’a pas abouti', 'erreur');
});

/* =============================================================================
   19. DÉMARRAGE
   ========================================================================== */
   /* Service worker : sans cette inscription, la PWA ne s'installe pas et
      l'application ne s'ouvre pas hors ligne. Silencieux si non supporté
      ou si la page est servie depuis file://. */
   function enregistrerSW() {
     if (!('serviceWorker' in navigator)) return;
     if (location.protocol === 'file:') return;
     window.addEventListener('load', async () => {
       try {
         const reg = await navigator.serviceWorker.register(PWA.serviceWorker, { scope:PWA.scope });
         reg.addEventListener('updatefound', () => {
           const sw = reg.installing;
           if (!sw) return;
           sw.addEventListener('statechange', () => {
             if (sw.state === 'installed' && navigator.serviceWorker.controller) {
               toast('Nouvelle version prête — rouvrez l’application');
             }
           });
         });
         navigator.serviceWorker.addEventListener('message', e => {
           if (e.data && e.data.type === 'SYNC_NOW') majBandeau();
         });
       } catch (e) { /* pas de PWA, l'application fonctionne quand même */ }
     });
   }
   
   function demarrer() {
  /* #bt et #who n'existent pas dans cette version de l'interface : y écrire
     jetait une exception avant même de masquer l'écran de connexion, et la
     session s'ouvrait sans que rien ne s'affiche. */
  const bt = $('#bt');
  if (bt) bt.textContent = 'Boutique ' + APP.site;

  /* Une feuille ouverte sur l'écran de connexion (remise à zéro) ne doit pas
     reparaître par-dessus l'application, avec son bouton « Tout effacer ». */
  if (!$('#sheet').hidden) closeSheet();
  $('#login').hidden = true;
  $('#app').hidden = false;
  document.title = APP.nom + ' — ' + APP.site;
  STATE.jour = today();       // chaque connexion repart du jour en cours
  STATE.phase = phaseCourante();
  /* Le compteur de file part de la réalité, pas de zéro : sans ça il restait
     à sa dernière valeur connue, même après que la file se soit vidée. */
  fileLire();
  /* Une erreur héritée d'une session précédente ne doit pas s'afficher avant
     qu'on ait vérifié qu'elle existe encore. */
  STATE.erreurBase = null;
  majBandeau();
  purgerPreuves();          // copie locale des photos de plus de 7 jours (le serveur garde tout)
  purgerLocalAncien();      // copies locales anciennes : journal, heures, caisses, registres (voir sa note)
  /* Bouton de compte : le seul accès à « tout le reste » et à la déconnexion
     pour l'équipe, dont la barre du bas n'a plus d'onglet « Plus ». */
  const bc = majBoutonCompte();
  if (bc) bc.onclick = ouvrirPlus;
  renderNav();
  /* Une première entrée d'historique, pour que le tout premier « retour »
     ramène à l'accueil au lieu de sortir de l'application. */
  try { history.replaceState({ vue:vueAccueil() }, '', location.pathname); } catch (e) {}
  rendre(STATE.user.role === 'manager' ? 'controle' : 'accueil');
}
   
   /* Résolue quand modules.js, stock.js et ocr.js ont été exécutés : les
      scripts différés passent tous avant DOMContentLoaded. */
   const documentPret = new Promise(r => {
     if (document.readyState === 'complete') return r();
     document.addEventListener('DOMContentLoaded', () => r(), { once:true });
     window.addEventListener('load', () => r(), { once:true });
   });

   /* Le service worker vient-il de servir une page depuis son cache (réseau
      muet ou trop lent, serveur en panne) ? C'est son état des 20 dernières
      secondes, pas celui de cette seule page. Réponse en quelques
      millisecondes ; sans service worker, ou sans réponse sous 300 ms : non. */
   function reseauMuetSelonSW() {
     return new Promise(fin => {
       const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
       if (!sw || typeof MessageChannel === 'undefined') return fin(false);
       const canal = new MessageChannel();
       const t = setTimeout(() => fin(false), 300);
       canal.port1.onmessage = ev => { clearTimeout(t); fin(!!(ev.data && ev.data.muet)); };
       try { sw.postMessage({ type:'RESEAU' }, [canal.port2]); }
       catch (e) { clearTimeout(t); fin(false); }
     });
   }

   /* La reprise de session attend que TOUS les scripts soient chargés. Le
      démarrage n'enchaîne que des lectures locales, résolues aussitôt : il
      appelait demarrer() avant l'exécution de modules.js et stock.js — page
      vide et « Vue indisponible » pour l'équipe, Tour de contrôle sans son
      complément de stock pour le manager, après tout rechargement hors ligne. */
   async function reprendreSession() {
     await documentPret;
     if (STATE.user) return;
     const u = utilisateurDeSession(await DB.get('session', null));
     if (!u || STATE.user) return;
     STATE.user = u;
     await chargerService();
     demarrer();
   }

   (async function () {
     initLogin();
     majBandeau();
     enregistrerSW();

     /* L'adresse …/?reset ouvre directement la remise à zéro, sans code PIN :
        c'est le seul moyen depuis une tablette où la console est inaccessible.
        On nettoie l'adresse immédiatement : sans ça, un retour arrière, un
        rechargement ou un raccourci enregistré rouvrait l'écran sans fin. */
     if (/[?&]reset\b/.test(location.search)) {
       try { history.replaceState(null, '', location.pathname); } catch (e) {}
       setTimeout(function () { ecranRemiseAZero(true); }, 250);
       return;
     }

     /* Wi-Fi connecté mais sans Internet, ou trop lent : le service worker
        vient de servir la page depuis son cache. L'application démarre donc
        hors ligne, au lieu de découvrir la panne lecture après lecture (8 s
        chacune : session rouverte au bout de 32 s). La première lecture qui
        aboutit, ou la sonde des 15 s, la remet en ligne. Sans base configurée,
        il n'y a rien à joindre ni à sonder. */
     if (DB.configure && await reseauMuetSelonSW() && STATE.enLigne) { STATE.enLigne = false; majBandeau(); }

     /* Rattachement de l'appareil, mais SEULEMENT si la base l'exige. Tant que
        la sécurité n'est pas activée côté base, on n'impose rien : l'application
        doit rester utilisable pendant la migration, pas après. */
     if (typeof securiteActive === 'function' && typeof appareilRattache === 'function') {
       if (!appareilRattache() && await securiteActive()) {
         await ecranRattachement();
       }
     }
     /* chargerEquipe pose d'abord l'équipe gardée sur l'iPad, avant toute
        lecture réseau : les prénoms s'affichent et la session reprend sans
        attendre la base (16 s et 32 s avec un Wi-Fi muet). */
     const lecture = (typeof chargerEquipe === 'function') ? chargerEquipe() : Promise.resolve('vide');
     const equipeLocale = EQUIPE.length > 0;
     let reprise = null;
     if (equipeLocale) { initLogin(); reprise = reprendreSession(); }
     const etatEquipe = await lecture;
     /* L'équipe relue en base : prénoms redessinés, et la session ouverte suit
        (personne retirée, rôle changé) une fois l'application affichée. */
     if (typeof initLogin === 'function') initLogin();
     if (reprise) reprise.then(() => { if (STATE.user) revaliderSession(); });
     /* Toujours aucune équipe : soit l'appareil n'est pas rattaché — et c'est
        le rattachement qu'il faut proposer, pas la création d'une équipe qui
        existe déjà — soit la boutique démarre vraiment de zéro. */
     if (!EQUIPE.length) {
       /* Sans base configurée (aperçu Vercel, poste local), rattacher n'a pas
          de sens : l'écran bloquait l'application sur « HTTP 404 ». */
       if (SUPABASE.url && SUPABASE.anonKey && typeof appareilRattache === 'function' && !appareilRattache() &&
           typeof ecranRattachement === 'function') {
         await ecranRattachement();
         /* Rattachée, la boutique peut n'avoir encore aucune équipe : l'écran
            des prénoms restait vide jusqu'au rechargement. Nouvelle lecture
            pour distinguer la base vide (on crée l'équipe) de la base
            injoignable (on réessaie, surtout pas de nouvelle équipe). */
         if (!EQUIPE.length) {
           const apres = await chargerEquipe();
           if (EQUIPE.length) initLogin();
           else if (apres === 'reseau') ecranEquipeInjoignable();
           else if (typeof ecranAmorcage === 'function') ecranAmorcage();
         }
       } else if (etatEquipe === 'reseau') {
         /* La base n'a pas répondu : ce n'est pas une boutique vide. */
         ecranEquipeInjoignable();
       } else if (typeof ecranAmorcage === 'function') {
         ecranAmorcage();
       }
     }

     /* Sans équipe sur l'iPad, la session ne peut reprendre qu'après la
        lecture de la base. */
     if (!equipeLocale) await reprendreSession();
   })();
   /* =============================================================================
      PILOT-SHOP — app.js  ·  PARTIE 2 / 2
      Espace manager : tour de contrôle, frigo virtuel, écarts, périodes,
      inventaires, caisse, historique, équipe, réglages.
      Se colle telle quelle à la suite de la partie 1.
      ============================================================================= */
   
   /* =============================================================================
      20. PÉRIODES — fenêtre de calcul courante
      ========================================================================== */
   /* Mémoire de session : sept vues appellent periodeCourante(), chacune
      relisait la base de son côté. Il suffisait qu'UNE lecture échoue — jeton
      pas encore prêt, réseau lent, délai dépassé — pour que la modale « première
      période » se rouvre alors qu'une période existait.
      Bornée dans le temps : sans ça, un manager qui clôture la période sur un
      autre appareil laissait celui-ci travailler sur l'ancienne jusqu'à la
      fermeture de l'application. */
   const PERIODE_CACHE_MS = 20000;
   let _periode = null, _periodeAt = 0;

   async function periodeCourante() {
     if (_periode && (Date.now() - _periodeAt) < PERIODE_CACHE_MS) return _periode;

     let p = await DB.get('periode:courante', null);

     /* Une lecture ratée ne prouve RIEN. Avant de conclure à l'absence de
        période, on vérifie qu'on a bien pu joindre la base : sinon on attend
        plutôt que de faire recréer une période qui existe déjà — ce qui
        créerait deux lignes de départ concurrentes. */
     /* Hors ligne, cette vérification est impossible : on attend aussi. En
        Wi-Fi sans Internet, l'application démarre hors ligne ; un manager sur
        un iPad sans copie de la période devait en définir une nouvelle, qui
        remplaçait au retour du réseau celle de toute la boutique (les écarts
        déjà saisis n'étaient plus lus). */
     if (!p && !STATE.enLigne && DB.configure) {
       return { id:'attente', type:PERIODES.parDefaut, debut:today(), fin:today(),
                ouverte:false, nonInitialisee:true, indisponible:true };
     }
     if (!p && STATE.enLigne && DB.configure) {
       try {
         const jeton = (typeof jetonValide === 'function') ? await jetonValide() : null;
         if (jeton) {
           const r = await fetch(SUPABASE.url + '/rest/v1/' +
             SUPABASE.tables.periodes + '?id=eq.' + encodeURIComponent('periode:courante') +
             '&select=data&limit=1',
             { headers: { apikey: SUPABASE.anonKey, Authorization: 'Bearer ' + jeton }, signal: signalDelai() });
           if (r.ok) {
             const l = await r.json();
             if (l && l.length && l[0].data) {
               p = l[0].data;
               try { DB._ecrire('periode:courante', JSON.stringify(p)); } catch (e) {}
             }
           } else {
             /* La base n'a pas répondu : on ne conclut pas. */
             return { id:'attente', type:PERIODES.parDefaut, debut:today(), fin:today(),
                      ouverte:false, nonInitialisee:true, indisponible:true };
           }
         } else {
           return { id:'attente', type:PERIODES.parDefaut, debut:today(), fin:today(),
                    ouverte:false, nonInitialisee:true, indisponible:true };
         }
       } catch (e) {
         return { id:'attente', type:PERIODES.parDefaut, debut:today(), fin:today(),
                  ouverte:false, nonInitialisee:true, indisponible:true };
       }
     }

     if (!p) {
       /* Plus de création silencieuse : sans période définie, aucun écart n'a de
          sens. Le manager choisit lui-même la ligne de départ, l'équipier est
          informé qu'il doit attendre. */
       if (STATE.user && STATE.user.role === 'manager') {
         p = await ouvrirPremierePeriode();
       } else {
         return { id:'attente', type:PERIODES.parDefaut, debut:today(), fin:today(),
                  ouverte:false, nonInitialisee:true };
       }
     }

     /* Une période échue reste « courante » tant que personne ne la clôture :
        c'est voulu, la clôture est un acte du manager. Mais elle doit le
        DIRE. Le 23 septembre, la semaine du 14 au 20 était encore la période
        courante, et trois jours de saisies s'y rattachaient sans que personne
        ne le sache. On marque l'échéance pour que la tour de contrôle et
        l'accueil du manager la signalent. */
     if (p && p.fin && today() > p.fin) {
       p.echue = true;
       p.joursDepuisFin = Math.round((new Date(today()) - new Date(p.fin)) / 86400000);
     }

     _periode = p;
     _periodeAt = Date.now();
     return p;
   }

   /* À appeler dès qu'une période est créée, clôturée ou modifiée. */
   function oublierPeriode() { _periode = null; _periodeAt = 0; }

/* Modale bloquante : rendue à l'écran tant que le manager n'a pas tranché. */
function ouvrirPremierePeriode() {
  return new Promise(resolve => {
    const aujourdhui = today();
    showSheet(
      '<h2 id="sheet-titre">Définir la première période</h2>' +
      '<p class="sub">Aucune période n’est ouverte. Tous les écarts, inventaires et ' +
      'statistiques se calculeront sur la fenêtre que vous fixez ici.</p>' +

      '<div class="alerte info"><span class="ai">ℹ️</span><div><b>Ce choix est structurant</b>' +
      '<p>La date de début détermine le stock de départ. Prenez le jour où vous avez ' +
      'compté la glace, pas la date du jour si elle est différente.</p></div></div>' +

      '<div class="entete"><h3>Type de période</h3></div>' +
      '<div class="chips" id="pp-type">' + PERIODES.types.map(t =>
        '<button type="button" class="chip' + (t.id === PERIODES.parDefaut ? ' on' : '') +
        '" data-t="' + t.id + '">' + esc(t.label) + '</button>').join('') + '</div>' +

      '<div class="grid g2" style="margin-top:16px">' +
      '<div class="champ"><label class="f">Début de période</label>' +
      '<input type="date" id="pp-d" value="' + aujourdhui + '"></div>' +
      '<div class="champ"><label class="f">Fin de période</label>' +
      '<input type="date" id="pp-f" value="' + finNaturelle(PERIODES.parDefaut, aujourdhui) + '"></div></div>' +
      '<p class="mini" style="margin-top:8px">Les deux dates sont modifiables. Toucher la date ' +
      'de fin bascule en période personnalisée.</p>' +
      '<p class="mini" id="pp-info" style="margin-top:6px"></p>' +

      '<div class="actions"><button class="btn menthe bloc" id="pp-ok">Ouvrir la période</button></div>');

    /* Ni croix, ni voile cliquable, ni Échap, ni bouton retour : la décision
       est obligatoire. L'indicateur est lu par le voile, Échap et popstate. */
    $('#sheet').dataset.obligatoire = '1';
    /* Les boutons de la feuille seulement : masquer aussi le voile (qui porte
       data-fermer) le laissait invisible pour toutes les feuilles suivantes. */
    $$('#sheet-corps [data-fermer]').forEach(b => b.style.display = 'none');
    const voile = $('#sheet .voile');
    if (voile) voile.onclick = () => toast('Choisissez une période pour commencer', 'erreur');

    let type = PERIODES.parDefaut;
    let libre = false;          // vrai dès que la date de fin est saisie à la main

    const maj = () => {
      const d = $('#pp-d').value || aujourdhui;
      /* En mode libre, on ne touche plus à la date de fin : c'est précisément
         ce recalcul qui écrasait la saisie et empêchait de choisir une date. */
      if (!libre) $('#pp-f').value = finNaturelle(type, d);
      const n = joursEntre($('#pp-d').value, $('#pp-f').value).length;
      const ok = n > 0;
      $('#pp-info').textContent = ok
        ? 'Fenêtre de ' + n + ' jour(s), du ' + fmtD($('#pp-d').value) + ' au ' + fmtD($('#pp-f').value) + '.'
        : 'La date de fin doit être égale ou postérieure à la date de début.';
      $('#pp-info').style.color = ok ? '' : 'var(--corail-d)';
      $('#pp-ok').disabled = !ok;
    };

    $$('#pp-type [data-t]').forEach(b => b.onclick = () => {
      $$('#pp-type .chip').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      type = b.dataset.t;
      libre = (type === 'personnalise');
      /* On ne déplace jamais la date de début choisie : le type ne fait que
         proposer une date de fin cohérente. Recaler le début en douce serait
         exactement le contraire du contrôle demandé. */
      maj();
    });

    /* Modifier la date de fin à la main bascule d'office en « personnalisé ». */
    const passerEnLibre = () => {
      libre = true;
      type = 'personnalise';
      $$('#pp-type .chip').forEach(x => x.classList.toggle('on', x.dataset.t === 'personnalise'));
      maj();
    };
    $('#pp-f').onchange = passerEnLibre;
    $('#pp-f').oninput  = passerEnLibre;
    $('#pp-d').onchange = maj;
    $('#pp-d').oninput  = maj;
    maj();

    $('#pp-ok').onclick = async () => {
      const d1 = $('#pp-d').value, d2 = $('#pp-f').value;
      if (!d1 || !d2 || d2 < d1) return toast('Dates incohérentes', 'erreur');
      const p = { id:uid(), type:type, debut:d1, fin:d2, ouverte:true,
                  creee:nowISO(), creeePar:STATE.user ? STATE.user.prenom : '—', premiere:true };
      await DB.set('periode:courante', p);
      oublierPeriode();
      await feed('ok', (STATE.user ? STATE.user.prenom : '—') +
                 ' a ouvert la première période : ' + libellePeriode(p));
      delete $('#sheet').dataset.obligatoire;
      closeSheet();
      toast('Période ouverte · ' + libellePeriode(p));
      resolve(p);
    };
  });
}
   function finNaturelle(type, ref) {
   if (type === 'mois')      { const d = new Date(+ref.slice(0, 4), +ref.slice(5, 7), 0); return isoOf(d); }
   if (type === 'trimestre') { const t = Math.floor((+ref.slice(5, 7) - 1) / 3) * 3 + 3; const d = new Date(+ref.slice(0, 4), t, 0); return isoOf(d); }
   if (type === 'semaine')   return addD(ref, 6);
   if (type === 'quinzaine') return addD(ref, 13);
   return ref;
}
   const joursEntre = (a, b) => { const o = []; let d = a; let g = 0; while (d <= b && g++ < 400) { o.push(d); d = addD(d, 1); } return o; };
   const libellePeriode = p => PERIODES.types.filter(t => t.id === p.type)[0].label + ' · ' + fmtDC(p.debut) + ' → ' + fmtDC(p.fin);
   
   /* =============================================================================
      21. MÉTÉO
      ========================================================================== */
   let _meteoEchec = 0;   // dernier échec d'open-meteo (voir meteo)
   async function meteo() {
     if (!METEO.actif) return null;
     const cache = await DB.get('meteo', null);
     const frais = cache && (Date.now() - new Date(cache.at)) < METEO.cacheHeures * 3600e3;
     if (frais || !STATE.enLigne) return cache;
     /* Échec récent : pas de nouvel essai avant 10 minutes. Sans ce frein,
        chaque redessin de Ma journée (phase, onglet, retour après une photo
        ou une validation) attendait de nouveau 8 s qu'open-meteo réponde. */
     const repli = () => cache || { t:'—', code:3, max:'—', pluie:'—', at:nowISO(), source:'indisponible' };
     if (Date.now() - _meteoEchec < 10 * 60e3) return repli();
     try {
       const u = METEO.endpoint + '?latitude=' + METEO.lat + '&longitude=' + METEO.lon +
         '&current=' + METEO.parametres.current + '&daily=' + METEO.parametres.daily +
         '&timezone=' + encodeURIComponent(METEO.parametres.timezone);
       const ctrl = new AbortController();
       const to = setTimeout(() => ctrl.abort(), OFFLINE.timeoutReseauMs);
       const r = await fetch(u, { signal:ctrl.signal });
       clearTimeout(to);
       const d = await r.json();
       const o = { t:Math.round(d.current.temperature_2m), code:d.current.weather_code,
                   max:Math.round(d.daily.temperature_2m_max[0]),
                   pluie:d.daily.precipitation_probability_max[0], at:nowISO(), source:'api' };
       await DB.set('meteo', o);
       return o;
     } catch (e) {
       _meteoEchec = Date.now();
       return repli();
     }
   }
   /* La météo ne retient plus le premier écran (#49). Même avec l'échec
      retenu 10 minutes, Ma journée et la Tour de contrôle attendaient
      jusqu'à 8 s qu'open-meteo réponde au premier rendu, puis de nouveau
      toutes les 10 minutes. On dessine avec ce qui est là : la réponse si
      elle arrive en moins de 300 ms, sinon la dernière météo gardée sur
      l'iPad (ou rien) ; `suite` livre la réponse quand elle arrive, et la
      vue complète son bloc météo sans se redessiner. */
   let _meteoEnCours = null;
   async function meteoRapide() {
     if (typeof meteo !== 'function') return { m:null, suite:null };
     /* Une requête encore en route est partagée, sans nouvelle attente :
        chaque redessin relançait sinon sa propre requête et attendait de
        nouveau 300 ms tant qu'open-meteo traînait. */
     if (_meteoEnCours) return { m:await DB.get('meteo', null), suite:_meteoEnCours };
     const p = _meteoEnCours = meteo().catch(() => null);
     p.then(() => { if (_meteoEnCours === p) _meteoEnCours = null; });
     const vite = await Promise.race([p, new Promise(r => setTimeout(() => r(undefined), 300))]);
     if (vite !== undefined) return { m:vite, suite:null };
     return { m:await DB.get('meteo', null), suite:p };
   }
   function widgetMeteo(m) {
     if (!m) return '';
     const c = METEO.codes[m.code] || METEO.codes[3];
     return carte(
       '<div class="meteo"><span class="mi">' + c.i + '</span>' +
       '<div style="flex:1"><div class="mt">' + m.t + '°</div>' +
       '<div class="md">' + esc(c.l) + ' · ' + METEO.ville + '</div></div>' +
       '<div style="text-align:right"><div class="mini">max ' + m.max + '°</div>' +
       '<div class="mini">pluie ' + m.pluie + ' %</div>' +
       (m.source === 'api' ? '' : '<div class="mini">hors ligne</div>') + '</div></div>', 'ciel');
   }
   
   /* =============================================================================
      22. TOUR DE CONTRÔLE
      ========================================================================== */
   V.controle = async function () {
     const j = today();
     const per = await periodeCourante();
     const mt = await meteoRapide();
     const m = mt.m;
     const e = await etatJour(j);
   
     const ruptures = (await DB.get('ruptures', [])).filter(r => !r.traite);
     const feedJ = [];
     for (let i = 0; i < 3; i++) {
       const d = addD(j, -i);
       (await DB.get('feed:' + d, [])).forEach(x => feedJ.push(Object.assign({ jour:d }, x)));
     }
     feedJ.sort((a, b) => String(b.at).localeCompare(String(a.at)));
   
     const fifo = await calculFIFO(monthKey(j));
     const perimes = fifo.filter(f => f.c === 'rouge').length;
     const bientot = fifo.filter(f => f.c === 'orange').length;
   
     const jours = joursEntre(per.debut, j > per.fin ? per.fin : j);
     let cumulCaisse = 0, sansNet = 0, tempCrit = 0;
     /* On retient QUELLES enceintes ont dépassé, pas seulement combien :
        une vitrine et une chambre froide n'appellent pas la même réaction. */
     const enceintesCrit = [];
     /* Et le dernier dépassement, jour et moment : « Ouvrir » y mène, au lieu
        du relevé du jour choisi d'après l'heure. */
     let dernierCrit = null;
     /* La veille sert au fond initial quand le matin n'a pas été saisi. */
     let caisseVeille = jours.length ? await DB.get('caisse:' + addD(jours[0], -1), null) : null;
     for (const d of jours) {
       const k = await DB.get('caisse:' + d, null);
       if (k) cumulCaisse += caisseResume(k, caisseVeille).ecart;
       caisseVeille = k;
       const n = await etatNettoyage(d);
       if (n.total && n.faits === 0) sansNet++;
       const t = await DB.get('temp:' + d, {});
       ENCEINTES.forEach(en => {
         ['m','s'].forEach(mo => {
           if (etatTemp(en, t[mo + '_' + en.id]) === 'crit') {
             tempCrit++;
             if (enceintesCrit.indexOf(en.nom) < 0) enceintesCrit.push(en.nom);
             if (!dernierCrit || dernierCrit.jour !== d || mo === 's') dernierCrit = { jour:d, moment:mo };
           }
         });
       });
     }
   
     const equipeJour = await DB.get('pointage:' + j, []);
     const enService = equipeJour.filter(s => !s.fin);
   
     const A = [];
     /* Une période échue passe en tête : tant qu'elle n'est pas clôturée, les
        saisies s'y rattachent et l'écart de la semaine suivante ne peut pas
        se calculer. Trois jours sans que personne ne le voie, c'est arrivé. */
     if (per && per.echue) {
       A.push(['bad', 'Période terminée depuis ' + per.joursDepuisFin + ' jour(s)',
         'La semaine du ' + fmtD(per.debut) + ' au ' + fmtD(per.fin) + ' attend sa clôture. ' +
         'Les saisies d’aujourd’hui s’y rattachent encore.', 'periodes']);
     }
     /* Un calcul d'écart clôturé au moins une fois par mois (calcul.js). */
     if (typeof alerteCalculMensuel === 'function') {
       const ac = await alerteCalculMensuel();
       if (ac) A.push(ac);
     }
     /* Une alerte doit nommer le produit. « 2 ruptures non traitées » oblige le
        manager à ouvrir un autre écran pour savoir s'il s'agit de cornets ou
        de lait — et donc s'il doit appeler le fournisseur maintenant. */
     if (ruptures.length) {
       const noms = [...new Set(ruptures.map(r => r.article).filter(Boolean))];
       A.push(['bad', ruptures.length + ' rupture(s) non traitée(s)',
         noms.length
           ? noms.slice(0, 4).join(', ') + (noms.length > 4 ? ' et ' + (noms.length - 4) + ' autre(s)' : '') + '.'
           : 'Signalées par l’équipe lors du réassort.',
         '#urgences']);   // « Ouvrir » renvoyait vers cette même vue : on descend à la liste
     }
     if (perimes) {
       const quoi = [...new Set((fifo || []).filter(x => x.c === 'rouge')
         .map(x => x.nom).filter(Boolean))];
       A.push(['bad', perimes + ' produit(s) dépassé(s)',
         (quoi.length ? quoi.slice(0, 4).join(', ') + '. ' : '') +
         'À retirer de la vitrine immédiatement.', 'frigo']);
     }
     /* Relevés du jour manquants : la carte verte « Rien à signaler » s'affichait
        sous la pastille rouge « Frigos matin manquants ». Passé l'heure
        d'ouverture, un relevé du matin absent est une alerte HACCP ; passé
        l'heure de fermeture, celui du soir aussi. Horaires du back-office,
        sinon ceux d'usine (HORAIRES est aussi recalé par appliquerReglages). */
     const horaires = Object.assign({}, HORAIRES, (await DB.get('horaires', null)) || {});
     const minutesDe = h => (/^\d{2}:\d{2}$/.test(h || '') ? +h.slice(0, 2) * 60 + +h.slice(3, 5) : null);
     const maintenant = new Date().getHours() * 60 + new Date().getMinutes();
     const passe = h => { const x = minutesDe(h); return x !== null && maintenant >= x; };
     const matinDu = passe(horaires.ouverture), soirDu = passe(horaires.fermeture);
     if (matinDu && !e.tempM) A.push(['bad', 'Frigos du matin non relevés',
       'Relevé à faire dès l’ouverture (' + horaires.ouverture + '), avant la mise en vitrine.', 'temp', 'm']);
     if (soirDu && !e.tempS) A.push(['warn', 'Frigos du soir non relevés',
       'Relevé à faire avant la fermeture (' + horaires.fermeture + ').', 'temp', 's']);
     if (tempCrit) A.push(['bad', tempCrit + ' relevé(s) en limite critique',
       (enceintesCrit.length ? enceintesCrit.slice(0, 3).join(', ') + '. ' : '') +
       'Chaque dépassement doit avoir une action corrective écrite.', 'temp',
       dernierCrit && dernierCrit.moment, dernierCrit && dernierCrit.jour]);
     if (Math.abs(cumulCaisse) > SEUILS.caisseCumulEur) A.push(['warn', 'Écart de caisse cumulé : ' + eur(cumulCaisse), 'Au-delà de ' + eur(SEUILS.caisseCumulEur) + ' sur la période.', 'caisse']);
     if (sansNet >= SEUILS.joursSansNettoyage) A.push(['warn', sansNet + ' jour(s) sans nettoyage validé', 'À reprendre avec l’équipe.', 'clean']);
     if (bientot) {
       const quoi = [...new Set((fifo || []).filter(x => x.c === 'orange')
         .map(x => x.nom).filter(Boolean))];
       A.push(['warn', bientot + ' produit(s) à écouler vite',
         (quoi.length ? quoi.slice(0, 4).join(', ') + '. ' : '') +
         'Moins de 48 h de vie restante.', 'frigo']);
     }
   
     badge('controle', A.filter(a => a[0] === 'bad').length, true);
     $('#vue-actions').innerHTML =
       '<button class="btn clair sm" id="scanbl">Scanner BL</button>' +
       '<button class="btn sm" id="pdf">Registre</button>';
   
     $('#page').innerHTML =
       '<div class="grid g2" id="ctl-meteo">' + widgetMeteo(m) +
       carte(entete('👥', enService.length ? enService.map(s => s.prenom).join(', ') : 'Personne en service',
         enService.length ? 'En poste depuis ' + enService.map(s => heure(s.debut)).join(', ') : 'Aucun pointage ouvert') +
         '<div class="rang">' + pastille(e.tempM ? 'ok' : (matinDu ? 'bad' : 'n'),
           e.tempM ? 'Frigos matin faits' : (matinDu ? 'Frigos matin manquants' : 'Frigos matin à faire')) +
         pastille(e.net ? 'ok' : 'warn', e.net + '/' + e.netTotal + ' nettoyage') +
         pastille(e.caisse ? 'ok' : 'n', e.caisse ? 'Caisse faite' : 'Caisse ouverte') + '</div>', 'solide') + '</div>' +
   
       carte(entete('📅', libellePeriode(per), 'Fenêtre de calcul en cours.') +
         '<div class="grid g4">' +
         kpi('Écart caisse', eur(cumulCaisse), Math.abs(cumulCaisse) > SEUILS.caisseCumulEur ? 'bad' : 'ok', 'Cumulé sur la période') +
         kpi('Jours couverts', jours.length, '', 'Depuis le ' + fmtDC(per.debut)) +
         kpi('Ruptures', ruptures.length, ruptures.length ? 'bad' : 'ok', 'Non traitées') +
         kpi('Périmés', perimes, perimes ? 'bad' : 'ok', 'En vitrine ou réserve') + '</div>', 'plat') +
   
       (A.length ? '<div class="entete"><h3>Alertes</h3></div><div class="stack">' + A.map(a =>
         '<div class="alerte ' + a[0] + '"><span class="ai">' + (a[0] === 'bad' ? '▲' : '●') + '</span>' +
         '<div><b>' + esc(a[1]) + '</b><p>' + esc(a[2]) + '</p></div>' +
         '<span class="go"><button class="btn clair sm" ' + (a[3].charAt(0) === '#'
           ? 'data-ancre="' + a[3].slice(1) + '"' : 'data-go="' + a[3] + '"') +
           (a[4] ? ' data-moment="' + a[4] + '"' : '') + (a[5] ? ' data-jour="' + a[5] + '"' : '') +
           '>Ouvrir</button></span></div>').join('') + '</div>'
         : carte('<div class="alerte ok"><span class="ai">•</span><div><b>Rien à signaler</b>' +
           '<p>Aucune alerte sur la caisse, les frigos, le nettoyage et les stocks.</p></div></div>', 'plat')) +
   
       (ruptures.length ? '<div class="entete" id="urgences" style="scroll-margin-top:90px"><h3>Urgences</h3>' +
         '<button class="btn fantome sm pousse" id="tout-traite">Tout marquer traité</button></div>' +
         '<div class="stack">' + ruptures.slice().reverse().map(r => {
           const niv = RUPTURE.niveaux.filter(n => n.id === r.niveau)[0] || RUPTURE.niveaux[0];
           return carte('<div class="rang">' +
             '<div style="flex:1;min-width:0"><b>' + esc(r.article) + '</b>' +
             '<div class="mini">' + (r.reste === 0 ? 'Plus rien en stock' : 'Reste ' + r.reste + ' ' + esc(r.unite)) +
             (r.note ? ' · ' + esc(r.note) : '') + ' · ' + esc(r.par) + ' le ' + fmtDC(r.jour) + ' ' + heure(r.at) + '</div></div>' +
             pastille(niv.couleur === 'rouge' ? 'bad' : 'warn', niv.label) +
             '<button class="btn menthe sm" data-traite="' + esc(r.id) + '">Traité</button></div>', 'urgence corail');
         }).join('') + '</div>' : '') +
   
       '<div class="entete"><h3>En direct</h3><span class="pousse mini">3 derniers jours</span></div>' +
       carte(feedJ.length ? '<div class="feed">' + feedJ.slice(0, 60).map(x => {
         const p = EQUIPE.filter(y => y.id === x.id)[0];
         return '<div class="fi ' + (x.n === 'ok' ? '' : x.n) + '">' +
           '<span class="fh">' + heure(x.at) + '</span>' +
           (p ? avatar(p, 'fp') : '<span class="fp" style="background:var(--brume)">?</span>') +
           '<span class="fc"><span class="fx">' + esc(x.x) + '</span>' +
           '<span class="fm">' + fmtDC(x.jour) + '</span></span></div>';
       }).join('') + '</div>' : vide('🗼', 'Aucune activité enregistrée.'));
   
     $$('[data-traite]').forEach(b => b.onclick = async () => {
       const l = await DB.get('ruptures', []);
       const r = l.filter(x => x.id === b.dataset.traite)[0];
       if (r) { r.traite = true; r.traitePar = STATE.user.prenom; r.traiteAt = nowISO(); }
       await DB.set('ruptures', l);
       await feed('ok', STATE.user.prenom + ' a traité la rupture : ' + (r ? r.article : ''));
       toast('Rupture traitée');
       rendre('controle');
     });
   
     $$('#page [data-ancre]').forEach(b => b.onclick = () => {
       const c = document.getElementById(b.dataset.ancre);
       if (c) c.scrollIntoView({ behavior:'smooth', block:'start' });
     });

     const tt = $('#tout-traite');
     if (tt) tt.onclick = () => confirmer('Tout marquer traité ?',
       ruptures.length + ' rupture(s) seront classées. L’historique est conservé.', 'Tout traiter', async () => {
         const l = await DB.get('ruptures', []);
         const classees = l.filter(r => !r.traite);
         classees.forEach(r => { r.traite = true; r.traitePar = STATE.user.prenom; r.traiteAt = nowISO(); });
         await DB.set('ruptures', l);
         /* Comme « Traité » d'une seule rupture : une ligne au fil « En direct »,
            sinon le classement en masse ne laissait aucune trace. */
         if (classees.length) {
           const noms = [...new Set(classees.map(r => r.article).filter(Boolean))];
           await feed('ok', STATE.user.prenom + ' a traité ' + classees.length + ' rupture(s)' +
             (noms.length ? ' : ' + noms.slice(0, 6).join(', ') + (noms.length > 6 ? '…' : '') : ''));
         }
         toast('Urgences classées');
         rendre('controle');
       });
   
     $('#pdf').onclick = ouvrirBouclier;
     $('#scanbl').onclick = scannerBL;

     /* Météo arrivée après le dessin (meteoRapide) : la carte est remplacée
        ou ajoutée en tête de sa grille, sans redessiner la page. */
     if (mt.suite) mt.suite.then(mm => {
       const grille = document.getElementById('ctl-meteo');
       if (!mm || !grille || STATE.view !== 'controle') return;
       const w = grille.querySelector('.meteo');
       const ancienne = w && w.closest('.card');
       if (ancienne) ancienne.outerHTML = widgetMeteo(mm);
       else grille.insertAdjacentHTML('afterbegin', widgetMeteo(mm));
     });
   };
   
   const kpi = (k, v, cls, d) =>
     '<div class="kpi ' + (cls || '') + '"><div class="k">' + esc(k) + '</div>' +
     '<div class="v">' + v + '</div><div class="d">' + esc(d || '') + '</div></div>';
   
   /* =============================================================================
      23. FRIGO VIRTUEL (FIFO)
      ========================================================================== */
   /* Seuil de passage en orange : la plus tardive des deux règles — le tiers de
      vie restante, ou le plancher de préavis. Borné à la moitié de la durée de
      vie, sinon un produit de douze heures serait orange dès sa fabrication. */
   function seuilOrangeHeures(heures) {
     const parTiers = heures * DLC_SEUILS.vert.min;
     const plancher = Math.min(DLC_SEUILS.preavisMiniHeures || 0, heures / 2);
     return Math.max(parTiers, plancher);
   }

   /* Mois précédent d'une clé « AAAA-MM ». */
   const moisPrecedent = m => isoOf(new Date(+String(m).slice(0, 4), +String(m).slice(5, 7) - 2, 15)).slice(0, 7);

   async function calculFIFO(mois) {
     /* Le mois précédent est lu aussi : un produit ouvert le 30 périme le mois
        suivant, et il disparaissait du frigo virtuel — et des alertes — dès le
        1er. Pour une même clé, l'ouverture du mois le plus récent l'emporte,
        comme à l'intérieur d'un mois. On garde le mois d'origine de chaque
        lot : c'est sous lui qu'on le marque jeté. */
     const prec = moisPrecedent(mois);
     const recPrec = await DB.get('lots:' + prec, {});
     const recMois = await DB.get('lots:' + mois, {});
     const rec = {}, source = {};
     [[prec, recPrec], [mois, recMois]].forEach(([m, r]) => Object.keys(r || {}).forEach(cle => {
       if (!r[cle]) return;
       rec[cle] = r[cle]; source[cle] = m;
     }));
     const out = [];
     Object.keys(rec).forEach(cle => {
       const v = rec[cle];
       if (!v || !v.lot || !v.ouv) return;
       /* Lot jeté : marqué, pas supprimé — une suppression était annulée par
          la fusion avec la copie du serveur, et le lot revenait.
          La fusion champ par champ garde aussi la marque quand un NOUVEAU bac
          est ouvert sous la même clé : la marque ne vaut donc que pour le lot
          jeté — même numéro, ouvert avant le jet. */
       if (v.jete && (!v.jeteLot || v.jeteLot === v.lot) && (!v.at || v.at <= v.jete)) return;
       const type = cle.slice(0, 1);
       const nom = type === 'g' ? cle.slice(2) : (DLC_RULES[cle.slice(2)] || DLC_RULES.defaut).label;
       const regle = regleDLC(nom, type);
       const heures = DLC_RULES[regle].h;
       const limite = new Date(new Date(v.ouv + 'T08:00:00').getTime() + heures * 3600e3);
       const resteH = Math.round((limite - Date.now()) / 3600e3);
       const part = resteH / heures;
       const c = resteH < 0 ? 'rouge'
               : resteH <= seuilOrangeHeures(heures) ? 'orange' : 'vert';
       out.push({ cle:cle, nom:nom, type:type, lot:v.lot, ouv:v.ouv, par:v.par,
                  regle:regle, heures:heures, limite:isoOf(limite), limiteH:limite,
                  resteH:resteH, c:c, zone:DLC_RULES[regle].zone,
                  mois:source[cle], famille:v.famille || null, taille:v.taille || null });
     });
     return out.sort((a, b) => a.resteH - b.resteH);
   }
   const resteLisible = h => h < 0
     ? 'Dépassé de ' + (Math.abs(h) < 48 ? Math.abs(h) + ' h' : Math.round(Math.abs(h) / 24) + ' j')
     : h < 48 ? 'Encore ' + h + ' h' : 'Encore ' + Math.round(h / 24) + ' j';
   
   V.frigo = async function () {
     /* Mois propre au Frigo : le sélecteur ne déplace plus la date de travail
        de toute l'application (STATE.jour), qui faisait ensuite saisir les
        relevés au 15 du mois choisi. */
     const mois = STATE.moisFrigo || monthKey(today());
     const fifo = await calculFIFO(mois);
     const r = fifo.filter(f => f.c === 'rouge'), o = fifo.filter(f => f.c === 'orange'), v = fifo.filter(f => f.c === 'vert');
   
     $('#vue-actions').innerHTML = '<input type="month" id="mm" value="' + mois + '" style="width:auto;min-height:42px">';
   
     $('#page').innerHTML =
       '<div class="grid g3">' +
       kpi('Périmés', r.length, r.length ? 'bad' : 'ok', 'À retirer maintenant') +
       kpi('À écouler', o.length, o.length ? 'warn' : 'ok', 'Moins de 48 h') +
       kpi('Conformes', v.length, 'ok', 'Rien à signaler') + '</div>' +
   
       (fifo.length ? [['rouge', 'Périmés — à retirer', r], ['orange', 'À vendre vite', o], ['vert', 'Conformes', v]]
         .filter(g => g[2].length).map(g =>
           '<div class="entete"><h3>' + g[1] + '</h3><span class="pousse mini num">' + g[2].length + '</span></div>' +
           '<div class="stack">' + g[2].map(f =>
             '<div class="fifo ' + f.c + '"><div class="fn"><b>' + esc(f.nom) + '</b>' +
             '<div class="fd">Lot ' + esc(f.lot) + ' · ouvert le ' + fmtDC(f.ouv) +
             ' par ' + esc(f.par || '—') + ' · ' + Math.round(f.heures / 24 * 10) / 10 + ' j de vie</div></div>' +
             '<div class="fr"><b>' + resteLisible(f.resteH) + '</b>' +
             '<span>limite ' + fmtDC(f.limite) + '</span></div>' +
             (f.c === 'rouge' ? '<button class="btn corail sm" data-jeter="' + esc(f.cle) + '">Jeter</button>' : '') +
             '</div>').join('') + '</div>').join('')
         : vide('🧊', 'Aucun lot ouvert ce mois. Les saisies de l’équipe apparaissent ici.'));
   
     $('#mm').onchange = e => { STATE.moisFrigo = e.target.value || null; rendre('frigo'); };
   
     $$('[data-jeter]').forEach(b => b.onclick = () => {
       const f = fifo.filter(x => x.cle === b.dataset.jeter)[0];
       confirmer('Jeter ' + f.nom + ' ?',
         'Le lot ' + f.lot + ' sera enregistré en perte et retiré du frigo virtuel.', 'Jeter et déclarer', async () => {
           /* Litrage réel du lot : sa taille de bac pour une glace (5 L par
              défaut si elle n'a pas été saisie), 0 pour le reste — une
              chantilly ou un coulis n'a pas de litrage de glace, et lui
              compter 5 L faussait l'écart de stock. */
           const glace = f.type === 'g' || f.famille === 'glace';
           const litrage = glace ? (num(f.taille) || FOURNISSEUR.tailleParDefaut) : 0;
           await DB.push('pertes:' + today(), { id:uid(), produit:f.nom + ' (lot ' + f.lot + ')', nombre:1,
             litrage:litrage, parUnite:true, motif:'perime', par:STATE.user.prenom, employe:STATE.user.id, at:nowISO() });
           await cumulerPertesMois(today());
           /* Marqué jeté plutôt que supprimé : « lots: » est fusionné avec la
              copie du serveur, qui faisait revenir une clé supprimée. */
           const moisLot = f.mois || mois;
           const rec = await DB.get('lots:' + moisLot, {});
           if (rec[f.cle]) {
             rec[f.cle] = Object.assign({}, rec[f.cle], { jete:nowISO(), jeteLot:f.lot, jetePar:STATE.user.prenom });
             await DB.set('lots:' + moisLot, rec);
           }
           await feed('warn', STATE.user.prenom + ' a jeté ' + f.nom + ' (DLC dépassée)');
           toast('Perte enregistrée');
           rendre('frigo');
         });
     });
   };
   
   /* =============================================================================
      24. SCANNER BON DE LIVRAISON — Jetfreeze
      ========================================================================== */
   /* Bon déjà compté dans les achats de la période : même numéro, casse
      ignorée. Rend la ligne existante, sinon null. Un même bon saisi deux
      fois doublait les achats, et l'écart lisait ensuite un manque de glace
      qui n'existe pas. */
   async function blDejaSaisi(per, numero) {
     const e = await DB.get('ecart:' + per.id, {});
     return ((e && Array.isArray(e.bl)) ? e.bl : [])
       .filter(b => b && String(b.numero || '').trim().toUpperCase() === numero)[0] || null;
   }
   /* Le doublon est signalé dans la feuille, sans rien enregistrer ; un second
      appui (« Ajouter quand même ») l'enregistre : deux bons distincts peuvent
      porter le même numéro. */
   function signalerDoublonBL(deja, numero, bouton) {
     const quand = deja.date || String(deja.at || '').slice(0, 10);
     $('#bl-doublon').innerHTML =
       '<div class="alerte warn" style="margin-top:14px"><span class="ai">●</span><div>' +
       '<b>Bon « ' + esc(numero) + ' » déjà compté</b><p>' + n1(num(deja.litres)) + ' L' +
       (deja.par ? ', saisi par ' + esc(deja.par) : '') +
       (/^\d{4}-\d{2}-\d{2}$/.test(quand) ? ' le ' + fmtD(quand) : '') +
       '. S’il s’agit d’un autre bon, touchez « Ajouter quand même ».</p></div></div>';
     $(bouton).textContent = 'Ajouter quand même';
   }

   async function scannerBL() {
     /* « Scanner BL » s'ouvre aussi depuis la Tour de contrôle, hors des vues
        gardées par rendre() : période illisible, les litres partiraient sous
        « ecart:attente », hors de la période de la boutique. */
     const perLue = await periodeCourante();
     if (perLue && perLue.id === 'attente') {
       toast('Période indisponible : reconnectez l’iPad, puis réessayez', 'erreur');
       return;
     }
     const r = await scannerPhoto('bl');
     if (!r) return;

     /* L'OCR ne sait pas lire les lignes d'un bon de livraison. Enregistrer ici
        ajouterait 0 litre aux achats : le stock théorique serait amputé de toute
        la livraison et l'écart accuserait l'équipe d'un manque qui n'existe pas. */
     if (!r.lignes || !r.lignes.length) {
       /* Le scan lit le numéro du bon, pas son tableau : on demande le total
          livré au lieu de s'arrêter. Avant, l'écran aboutissait toujours ici et
          le bouton « Scanner BL » ne pouvait ajouter aucun achat. */
       showSheet(
         '<h2 id="sheet-titre">Bon de livraison</h2>' +
         '<p class="sub">Les lignes du bon ne se lisent pas automatiquement : indiquez le total livré.</p>' +
         '<div class="grid g2">' +
         '<div class="champ"><label class="f">N° de bon</label>' +
         '<input type="text" id="bl-num" value="' + esc(r.numero || '') + '" autocapitalize="characters" spellcheck="false"></div>' +
         '<div class="champ"><label class="f">Litres livrés (total du bon)</label>' +
         '<input type="number" id="bl-litres" min="0" step="0.5" inputmode="decimal" placeholder="Ex. 120"></div></div>' +
         '<div class="alerte info" style="margin-top:14px"><span class="ai">•</span><div><b>Ce que fait la validation</b>' +
         '<p>Les litres s’ajoutent aux achats de la période en cours, base du calcul d’écart. ' +
         'Un oubli ici se lit ensuite comme un manque de glace.</p></div></div>' +
         '<div id="bl-doublon"></div>' +
         '<div class="actions"><button class="btn clair" data-fermer>Fermer</button>' +
         '<button class="btn menthe" id="bl-ajout">Ajouter aux achats</button></div>' +
         '<button class="btn clair bloc" id="bl-manuel" style="margin-top:10px">Contrôle à réception</button>');
       $('#bl-manuel').onclick = () => { closeSheet(); rendre('reception'); };
       let enCours = false, doublonVu = '';
       /* Numéro modifié après l'alerte : le contrôle de doublon repart. */
       $('#bl-num').oninput = () => {
         doublonVu = '';
         $('#bl-doublon').innerHTML = '';
         $('#bl-ajout').textContent = 'Ajouter aux achats';
       };
       $('#bl-ajout').onclick = async () => {
         const litres = num($('#bl-litres').value);
         if (!(litres > 0)) { toast('Indiquez le nombre de litres livrés', 'erreur'); return $('#bl-litres').focus(); }
         if (enCours) return;
         enCours = true;
         /* try / finally : une erreur (période, base) laissait enCours à true,
            et « Ajouter aux achats » ne répondait plus jusqu'à la fermeture. */
         try {
           const numero = $('#bl-num').value.trim().toUpperCase() || 'sans numéro';
           const per = await periodeCourante();
           if (numero !== 'sans numéro' && doublonVu !== numero) {
             const deja = await blDejaSaisi(per, numero);
             if (deja) { doublonVu = numero; return signalerDoublonBL(deja, numero, '#bl-ajout'); }
           }
           await DB.patch('ecart:' + per.id, {},
             { bl:[{ id:uid(), numero:numero, date:r.date || today(), bacs:null, litres:litres, lignes:[],
                     saisie:'manuelle', par:STATE.user.prenom, at:nowISO() }] },
             { litrageBL:litres });
           await feed('ok', STATE.user.prenom + ' a saisi le BL ' + numero + ' (' + n1(litres) + ' L)');
           closeSheet();
           toast(n1(litres) + ' L ajoutés aux achats');
           if (STATE.view === 'ecarts') rendre('ecarts');
         } finally { enCours = false; }
       };
       return;
     }
     const total = r.lignes.reduce((s, l) => s + l.bacs, 0);
     const litres = r.lignes.reduce((s, l) => s + l.bacs * l.taille, 0);
   
     showSheet(
       '<div class="rang"><h2 id="sheet-titre">' + esc(r.fournisseur) + ' · ' + esc(r.numero) + '</h2>' +
       '<span class="pousse demo">DÉMO</span></div>' +
       '<p class="sub">' + r.lignes.length + ' références · ' + total + ' bacs · ' + n1(litres) + ' L</p>' +
       '<div class="dense"><div class="dense-h"><span class="c1">Référence</span>' +
       '<span class="c w">Bacs</span><span class="c w">Litres</span></div>' +
       '<div class="dense-scroll">' + r.lignes.map(l =>
         '<div class="dl"><span class="c1">' + esc(l.ref) + ' · ' + esc(l.parfum) + '</span>' +
         '<span class="c w num">' + l.bacs + '</span>' +
         '<span class="c w num">' + (l.bacs * l.taille) + '</span></div>').join('') + '</div></div>' +
       '<div class="alerte info" style="margin-top:14px"><span class="ai">•</span><div><b>Ce que fait la validation</b>' +
       '<p>Les ' + n1(litres) + ' L s’ajoutent aux achats de la période en cours, base du calcul d’écart.</p></div></div>' +
       '<div id="bl-doublon"></div>' +
       '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
       '<button class="btn menthe" id="bl-ok">Ajouter aux achats</button></div>');
   
     let enCours = false, doublonVu = false;
     $('#bl-ok').onclick = async () => {
       /* Double appui, doublon et erreur : mêmes gardes que la saisie manuelle. */
       if (enCours) return;
       enCours = true;
       try {
         const per = await periodeCourante();
         const numero = String(r.numero || '').trim().toUpperCase();
         if (numero && !doublonVu) {
           const deja = await blDejaSaisi(per, numero);
           if (deja) { doublonVu = true; return signalerDoublonBL(deja, numero, '#bl-ok'); }
         }
         /* Écriture partielle : le bon s'ajoute à la liste (id unique) et son
            litrage aux achats, sur la copie du serveur — pas d'objet entier qui
            écraserait les ventes saisies entre-temps sur un autre iPad. */
         await DB.patch('ecart:' + per.id, {},
           { bl:[{ id:uid(), numero:r.numero, date:r.date, bacs:total, litres:litres, lignes:r.lignes,
                   par:STATE.user.prenom, at:nowISO() }] },
           { litrageBL:litres });
         await feed('ok', STATE.user.prenom + ' a saisi le BL ' + r.numero + ' (' + total + ' bacs)');
         closeSheet();
         toast(n1(litres) + ' L ajoutés aux achats');
       } finally { enCours = false; }
     };
   }
   
   /* =============================================================================
      25. INVENTAIRES
      ========================================================================== */
   V.inv = async function () {
     const per = await periodeCourante();
     const onglet = V.inv._t || 'glace';
     $('#vue-actions').innerHTML =
       '<button class="btn ' + (onglet === 'glace' ? '' : 'clair') + ' sm" data-iv="glace">Glace</button>' +
       '<button class="btn ' + (onglet === 'sec' ? '' : 'clair') + ' sm" data-iv="sec">Sec</button>';
     $$('[data-iv]').forEach(b => b.onclick = () => { V.inv._t = b.dataset.iv; rendre('inv'); });
     onglet === 'glace' ? await invGlace(per) : await invSec(per);
   };
   
   /* invGlace : version retirée — modules.js la redéfinit (plusieurs tailles
      de bac par parfum). V.inv ci-dessus appelle donc toujours celle-là. */
   
   async function invSec(per) {
     const cle = 'invsec:' + per.id;
     const rec = await DB.get(cle, { l:{}, valide:false });
     if (!rec.l) rec.l = {};
   
     $('#page').innerHTML =
       carte(entete('📦', 'Inventaire sec · ' + libellePeriode(per), 'Consommables et produits non congelés.') +
         (rec.valide ? '<div class="alerte ok"><span class="ai">•</span><div><b>Validé</b><p>' + esc(rec.par) +
           ' · ' + fmtD(rec.jour) + '</p></div><span class="go"><button class="btn clair sm" id="ro">Rouvrir</button></span></div>' : ''), 'solide') +
   
       '<div class="stack">' + INVENTAIRE_SEC.map((s, i) => {
         const v = rec.l['s' + i] || {};
         return carte('<div class="rang"><b style="flex:1">' + esc(s) + '</b>' +
           (v.q ? pastille('ok', v.q + ' ' + esc(v.u || '')) : pastille('n', 'à compter')) + '</div>' +
           '<div class="grid g3" style="margin-top:12px">' +
           '<div class="champ"><label class="f">Quantité</label>' +
           '<input type="number" min="0" step="0.5" data-s="s' + i + '.q" value="' + (v.q === undefined ? '' : v.q) + '"' + (rec.valide ? ' disabled' : '') + '></div>' +
           '<div class="champ"><label class="f">Unité</label>' +
           '<input type="text" data-s="s' + i + '.u" value="' + esc(v.u || '') + '" placeholder="unité, kg…"' + (rec.valide ? ' disabled' : '') + '></div>' +
           '<div class="champ"><label class="f">Note</label>' +
           '<input type="text" data-s="s' + i + '.c" value="' + esc(v.c || '') + '" placeholder="—"' + (rec.valide ? ' disabled' : '') + '></div></div>',
           v.q ? 'menthe' : '');
       }).join('') + '</div>' +
   
       (rec.valide ? '' : '<button class="btn menthe bloc xl" id="vs" style="margin-top:16px">Valider l’inventaire sec</button>');
   
     const collecte = () => $$('[data-s]').forEach(i => {
       const a = i.dataset.s.split('.');
       if (!rec.l[a[0]]) rec.l[a[0]] = {};
       rec.l[a[0]][a[1]] = i.value;
     });
     const save = debounce(() => { collecte(); DB.set(cle, rec); }, 400);
     $$('[data-s]').forEach(i => i.oninput = save);
   
     const ro = $('#ro');
     /* Même confirmation que « Rouvrir » de l'onglet Glace : rouvrir rend les
        chiffres modifiables et défait la validation signée. */
     if (ro) ro.onclick = () => confirmer('Rouvrir l’inventaire sec ?',
       'Les chiffres redeviennent modifiables jusqu’à une nouvelle validation.',
       'Rouvrir', async () => { rec.valide = false; await DB.set(cle, rec); rendre('inv'); });
   
     const vs = $('#vs');
     if (vs) vs.onclick = async () => {
       collecte();
       Object.assign(rec, { valide:true, par:STATE.user.prenom, jour:today(), at:nowISO() });
       await DB.set(cle, rec);
       await feed('ok', STATE.user.prenom + ' a validé l’inventaire sec');
       toast('Inventaire sec validé');
       rendre('inv');
     };
   }
   
   /* =============================================================================
      26. CAISSE
      ========================================================================== */
/* V.caisse : version retirée — elle était remplacée au chargement. */
   
   /* =============================================================================
      27. ÉCARTS GLACE + DÉTECTEUR DE TENDANCES
      ========================================================================== */
   /* Poids d'un comptage fait dans « Faire l'inventaire » (stock.js,
      enregistrerInventaire), recopié sous invglace:<période>.debut / .fin :
        { parfums: { 'Vanille': { '5': 3, '3': 1 } }, par, at }
      soit des bacs entiers par taille en litres. Même conversion que
      totauxStock et que l'ancien écran : litres × poids moyen au litre.
      Rend null s'il n'y a pas de comptage. */
   function kgInventaireParfums(x) {
     if (!x || !x.parfums || typeof x.parfums !== 'object') return null;
     let litres = 0;
     Object.keys(x.parfums).forEach(p => {
       const t = x.parfums[p] || {};
       Object.keys(t).forEach(taille => { litres += num(t[taille]) * num(taille); });
     });
     return litres * FOURNISSEUR.poidsMoyenLitre;
   }

   async function calculEcart(per) {
     const e = await DB.get('ecart:' + per.id, {});
     /* Les deux écrans d'inventaire écrivent sous invglace:<période> : l'ancien
        (rec.valide, rec.kg, recopié dans ecart:<période>.fin.kg) et le nouveau
        (debut / fin par parfum). Seul l'ancien était lu : avec le nouveau, le
        stock de fin restait à 0 et la clôture enregistrait stockFin = 0 —
        qui devenait le stock de départ de la période suivante. */
     const inv  = await DB.get('invglace:' + per.id, null);
     const invD = per.precedente ? await DB.get('invglace:' + per.precedente, null) : null;
     const kgDebutInv = kgInventaireParfums(inv && inv.debut);
     /* Stock de fin de la période précédente : ancien écran, sinon nouveau. */
     const kgPrec = (invD && invD.valide) ? num(invD.kg) : kgInventaireParfums(invD && invD.fin);
     let debutKg;
     if (kgDebutInv !== null) debutKg = kgDebutInv;          // compté le jour du départ
     /* debut.kg vient de la clôture précédente ; un 0 y a été écrit tant que
        le nouvel inventaire n'était pas lu — on lui préfère alors le comptage. */
     else if (e.debut && e.debut.kg !== undefined && (num(e.debut.kg) > 0 || kgPrec === null)) debutKg = num(e.debut.kg);
     else if (kgPrec !== null) debutKg = kgPrec;
     else debutKg = num(e.debutKg);
     const kgFinInv = kgInventaireParfums(inv && inv.fin);
     const finAncien = !!(e.fin && e.fin.kg !== undefined);
     const finKg = finAncien ? num(e.fin.kg) : (kgFinInv !== null ? kgFinInv : 0);
     const achats = num(e.litrageBL) * FOURNISSEUR.poidsMoyenLitre;
     const jete = num(e.jeteKg);
   
     let vendu = 0;
     const ventes = e.ventes || {};
     Object.keys(ventes).forEach(sku => vendu += num(ventes[sku]));
   
     const theo = debutKg + achats - jete - vendu;
     const ecart = finKg - theo;
     const pct = theo ? ((theo - finKg) / theo) * 100 : 0;
     return { debutKg, finKg, achats, jete, vendu, theo, reel:finKg, ecart:ecart,
              pct:pct, valeur:ecart * FOURNISSEUR.prixMoyenKg, invValide:finAncien || kgFinInv !== null };
   }
   const etatEcart = p => {
     const a = Math.abs(p);
     return a <= SEUILS.ecartGlacePct ? { c:'ok', t:'Dans la fourchette' }
          : a <= SEUILS.ecartGlaceAlertePct ? { c:'warn', t:'À surveiller' }
          : { c:'bad', t:'Hors fourchette' };
   };
   
   V.ecarts = async function () {
     const per = await periodeCourante();
     const c = await calculEcart(per);
     const inv = await DB.get('invglace:' + per.id, null);
     const e = await DB.get('ecart:' + per.id, {});
     const tendances = await analyserTendances(per);
   
     /* Synthèse et jauge en fonctions : la saisie d'un champ les met à jour
        en place, sans redessiner la vue (voir plus bas). */
     const kpis = c => {
       const st = etatEcart(c.pct);
       return kpi('Stock réel', n1(c.reel) + '<span class="u">kg</span>', '', c.invValide ? 'Inventaire validé' : 'Inventaire manquant') +
         kpi('Stock théorique', n1(c.theo) + '<span class="u">kg</span>', '', 'Calculé') +
         /* Écart arrondi à zéro : ni + ni −. « −0,0 kg » laissait croire à un manque. */
         kpi('Écart', (Math.abs(c.ecart) < 0.05 ? '' : c.ecart > 0 ? '+' : '−') + n1(Math.abs(c.ecart)) + '<span class="u">kg</span>', st.c, st.t) +
         kpi('Coût', eur(Math.abs(c.ecart) < 0.05 ? 0 : c.valeur), st.c, 'à ' + eur(FOURNISSEUR.prixMoyenKg) + '/kg');
     };
     const aiguille = c => 50 + (Math.max(-25, Math.min(25, -c.pct)) / 25) * 50;
     const achatsTxt = (c, e) => n1(c.achats) + ' kg · ' + ((e.bl || []).length) + ' bon(s) scanné(s)';
     const venduKpi = (c, e) => kpi('Poids vendu', n1(c.vendu) + '<span class="u">kg</span>',
                                    c.vendu ? 'ok' : 'warn', e.venteSource || 'Aucun import');
   
     $('#vue-actions').innerHTML = '<button class="btn clair sm" id="sbl">Scanner BL</button>';
   
     $('#page').innerHTML =
       carte(entete('📊', libellePeriode(per), 'Stock théorique = début + achats − jeté − vendu.') +
         '<div class="grid g4" id="ec-kpi">' + kpis(c) + '</div>' +
         '<div class="ecart" style="margin-top:18px"><div class="piste">' +
         '<div class="cible" style="left:' + (50 - (SEUILS.ecartGlacePct / 25) * 50) + '%;width:' + ((SEUILS.ecartGlacePct * 2 / 25) * 50) + '%"></div>' +
         '<div class="aig" id="ec-aig" style="left:' + aiguille(c) + '%"></div></div>' +
         '<div class="lg"><span>−25 % manquant</span><span>objectif ±' + SEUILS.ecartGlacePct + ' %</span><span>+25 % surplus</span></div></div>', 'solide') +
   
       (c.invValide ? '' : '<div class="alerte bad" style="margin-top:12px"><span class="ai">▲</span>' +
         '<div><b>Inventaire glace non validé</b><p>Sans comptage réel, le stock de fin est inconnu et l’écart n’a aucune valeur. ' +
         'La période ne pourra pas être clôturée.</p></div>' +
         /* « Compter » ouvrait l'ancien écran « Glace et sec », retiré du menu : il
            alimentait l'écart mais pas les blocages de clôture, qui lisent
            « Faire l'inventaire ». On envoie vers ce dernier, partie chambre
            froide : son comptage sert aux deux. */
         '<span class="go"><button class="btn clair sm" data-go="inventaire" data-partie="froid">Compter</button></span></div>') +
   
       '<div class="grid g2" style="margin-top:12px">' +
       carte(entete('📥', 'Achats de la période', 'Litrage cumulé des bons de livraison.') +
         '<div class="champ"><label class="f">Litrage total (L)</label>' +
         '<input type="number" step="0.1" id="bl" value="' + (e.litrageBL || '') + '"></div>' +
         '<p class="mini" id="ec-achats" style="margin-top:10px">' + achatsTxt(c, e) + '</p>') +
       carte(entete('🗑️', 'Pertes de la période', 'Reprises automatiquement du registre.') +
         '<div class="champ"><label class="f">Poids jeté (kg)</label>' +
         '<input type="number" step="0.01" id="jk" value="' + (e.jeteKg || '') + '"></div>' +
         '<p class="mini" style="margin-top:10px">' + n1(num(e.jeteL)) + ' L déclarés</p>') + '</div>' +
   
       carte(entete('🍦', 'Glace vendue', 'Poids sorti par la caisse sur la période. C’est la donnée qui pèse le plus dans l’écart.') +
         '<button class="btn ciel bloc xl" id="imp-btn">Importer l’export de caisse (Excel ou CSV)</button>' +
         /* .txt : l'export « Texte Unicode » (UTF-16) porte souvent cette extension. */
         '<input type="file" id="import-caisse" accept=".xlsx,.xls,.csv,.txt,text/csv" hidden>' +
         '<div class="grid g2" id="ec-vente" style="margin-top:16px">' + venduKpi(c, e) +
         '<div class="champ"><label class="f">Corriger à la main (kg)</label>' +
         '<input type="number" step="0.01" id="vd" value="' + (num(c.vendu) || '') + '" placeholder="0"></div></div>' +
         ((e.imports || []).length
           ? '<div class="dense" style="margin-top:14px"><div class="dense-h"><span class="c1">Import</span>' +
             '<span class="c w">Lignes</span><span class="c w">Poids</span></div>' +
             e.imports.slice().reverse().slice(0, 5).map(i =>
               '<div class="dl"><span class="c1">' + esc(i.fichier) + '</span>' +
               '<span class="c w num">' + i.lignes + '</span>' +
               '<span class="c w num">' + n1(i.kg) + ' kg</span></div>').join('') + '</div>'
           : '<p class="mini" style="margin-top:12px">Le fichier doit contenir une colonne de quantités et, ' +
             'soit une colonne de poids, soit des SKU rattachés à un grammage.</p>')) +
   
       (inv && inv.valide ? carte(entete('✅', 'Inventaire de clôture',
         inv.bacs + ' bacs · ' + n1(inv.kg) + ' kg · validé par ' + inv.par + ' le ' + fmtD(inv.jour)), 'menthe') : '') +
   
       (tendances.length ? '<div class="entete"><h3>Tendances détectées</h3><span class="pousse demo">ANALYSE LOCALE</span></div>' +
         '<div class="stack">' + tendances.map(t =>
           carte('<div class="rang"><span class="ci">' + t.icone + '</span>' +
             '<div style="flex:1"><b>' + esc(t.titre) + '</b><div class="mini">' + esc(t.detail) + '</div></div>' +
             pastille(t.niveau, t.compte + '×') + '</div>', 'ambre')).join('') +
         '</div><p class="mini" style="margin-top:10px">' + esc(FRAUDE.avertissement) + '</p>' : '');
   
     /* Chaque champ n'enregistre que SA valeur, et la vue n'est plus
        redessinée pendant la frappe. Avant, une pause de 700 ms enregistrait
        les trois champs puis redessinait tout l'écran : le champ perdait le
        focus et la suite partait dans le vide (« 120 » tapé lentement était
        enregistré « 1 ») ; et toucher au seul litrage réécrivait les ventes en
        remplaçant la source « import de caisse » par « Saisie manuelle ». */
     const majSynthese = async () => {
       if (!$('#ec-kpi')) return;                       // vue quittée entre-temps
       const c2 = await calculEcart(per);
       const e2 = await DB.get('ecart:' + per.id, {});
       if (!$('#ec-kpi')) return;
       $('#ec-kpi').innerHTML = kpis(c2);
       $('#ec-aig').style.left = aiguille(c2) + '%';
       $('#ec-achats').textContent = achatsTxt(c2, e2);
       const k = $('#ec-vente .kpi');
       if (k) k.outerHTML = venduKpi(c2, e2);
     };
     const champs = {
       '#bl': v => ({ litrageBL:v }),
       '#jk': v => ({ jeteKg:v }),
       '#vd': v => ({ ventes:{ total:v }, venteSource:'Saisie manuelle · ' + STATE.user.prenom })
     };
     Object.keys(champs).forEach(x => {
       const el = $(x);
       if (el) el.oninput = debounce(async () => {
         await DB.patch('ecart:' + per.id, champs[x](el.value));
         await majSynthese();
       }, 700);
     });
     $('#sbl').onclick = scannerBL;
   
     $('#imp-btn').onclick = () => $('#import-caisse').click();
     $('#import-caisse').onchange = async ev => {
       const f = ev.target.files && ev.target.files[0];
       ev.target.value = '';
       if (!f) return;
       showSheet('<h2 id="sheet-titre">Lecture de l’export</h2>' +
         '<p class="sub">' + esc(f.name) + '</p>' +
         '<div class="vide" id="imp-analyse">Analyse du fichier…</div>');
       /* XLSX peut mettre plusieurs secondes à arriver au premier import : la
          personne a pu fermer cette fenêtre et en ouvrir une autre. On ne la
          ferme pas, on ne la recouvre pas. On garde l'élément de CETTE
          lecture : un second import lancé entre-temps pose le sien, du même id. */
       const analyse = $('#imp-analyse');
       const encoreLa = () => !$('#sheet').hidden && !!analyse && analyse.isConnected;
       if (!(await chargerXLSX())) {
         if (encoreLa()) closeSheet();
         return toast('Lecture des fichiers de caisse indisponible : réessayez avec le réseau', 'erreur');
       }
   
       let r;
       try { r = await lireExportCaisse(f); }
       catch (err) {
         if (encoreLa()) closeSheet();
         toast(err && err.message ? err.message : 'Fichier illisible', 'erreur');
         return;
       }
       if (!encoreLa()) return;   // lecture abandonnée entre-temps
       if (!(r.kg > 0)) {
         closeSheet();
         return toast('Aucune glace chiffrée dans ce fichier : saisissez les grammages depuis le calcul d’écart', 'erreur');
       }
       confirmerImport(per, f.name, r);
     };
   };
   
   async function analyserTendances(per) {
     if (!FRAUDE.actif) return [];
     const out = [];
     const fin = today(), debut = addD(fin, -FRAUDE.fenetreJours);
     const parJour = {}, parPersonne = {};
     let annulations = 0, pertesTotal = 0;
   
     let caisseVeille = null;
     for (const d of joursEntre(debut, fin)) {
       const k = await DB.get('caisse:' + d, null);
       const veille = caisseVeille;
       caisseVeille = k;
       if (k) {
         const rk = caisseResume(k, veille);
         const ec = rk.ecart;
         if (Math.abs(ec) > SEUILS.caisseJourEur) {
           const jn = JOURS_SEMAINE[jourISO(d)];
           parJour[jn] = (parJour[jn] || 0) + 1;
           if (rk.par) parPersonne[rk.par] = (parPersonne[rk.par] || 0) + 1;
         }
         if (k.ann && String(k.ann).trim()) annulations++;
       }
       (await DB.get('pertes:' + d, [])).forEach(p => pertesTotal += litresPerte(p));
     }
   
     Object.keys(parJour).forEach(j => {
       if (parJour[j] >= FRAUDE.minOccurrences)
         out.push({ icone:'', niveau:'warn', compte:parJour[j],
                    titre:'Manques en caisse le ' + j.toLowerCase(),
                    detail:parJour[j] + ' écarts au-delà du seuil sur ' + FRAUDE.fenetreJours + ' jours, tous un ' + j.toLowerCase() + '.' });
     });
     Object.keys(parPersonne).forEach(p => {
       if (parPersonne[p] >= FRAUDE.minOccurrences)
         out.push({ icone:'', niveau:'warn', compte:parPersonne[p],
                    titre:'Écarts concentrés sur une session',
                    detail:parPersonne[p] + ' clôtures avec écart signées ' + p + '. À vérifier avant toute conclusion.' });
     });
     if (annulations >= FRAUDE.minOccurrences)
       out.push({ icone:'↩️', niveau:'warn', compte:annulations,
                  titre:'Commandes annulées répétées',
                  detail:annulations + ' journées avec des annulations notées sur la fenêtre analysée.' });
     if (pertesTotal > 0)
       out.push({ icone:'', niveau:'n', compte:Math.round(pertesTotal),
                  titre:'Volume de pertes déclarées',
                  detail:n1(pertesTotal) + ' L jetés sur ' + FRAUDE.fenetreJours + ' jours, soit ' +
                         eur(pertesTotal * FOURNISSEUR.poidsMoyenLitre * FOURNISSEUR.prixMoyenKg) + ' de marchandise.' });
     return out;
   }
   
   /* =============================================================================
      28. PÉRIODES — clôture, y compris anticipée
      ========================================================================== */
   async function blocagesCloture(per) {
     const B = [];
     const e = await DB.get('ecart:' + per.id, {});

     /* L'inventaire est la condition première : sans comptage réel de fin, le
        stock est une invention et l'écart calculé ne veut rien dire.
        On lit le NOUVEL inventaire — l'ancien écran « Glace et sec » a été
        retiré, et ce blocage pointait encore vers lui : il exigeait donc un
        comptage sur un écran devenu inaccessible. */
     const invStock = await DB.get('stock:inventaire', null);
     const invSec   = await DB.get('stock:sec', null);

     /* Un inventaire antérieur au début de la période ne clôture rien :
        il faut un comptage fait PENDANT la période qu'on ferme. */
     const dansLaPeriode = inv => inv && inv.jour >= per.debut;

     if (!dansLaPeriode(invStock)) {
       B.push({ id:'inv_glace', go:'inventaire',
         txt: invStock
           ? 'Chambre froide comptée le ' + fmtD(invStock.jour) + ', avant la période'
           : 'Chambre froide jamais comptée' });
     }
     if (!dansLaPeriode(invSec)) {
       B.push({ id:'inv_sec', go:'inventaire',
         txt: invSec
           ? 'Sec compté le ' + fmtD(invSec.jour) + ', avant la période'
           : 'Sec jamais compté' });
     }
     if (!num(e.litrageBL))     B.push({ id:'achats', txt:'Achats de la période non saisis', go:'ecarts' });
   
     for (const d of joursEntre(per.debut, today() < per.fin ? today() : per.fin)) {
       const st = await etatJour(d);
       if (!st.tempM || !st.tempS) B.push({ id:'temp', txt:'Températures incomplètes le ' + fmtDC(d), go:'temp', jour:d,
                                            moment:st.tempM ? 's' : 'm' });
       if (st.netTotal && st.net === 0) B.push({ id:'nettoyage', txt:'Aucun nettoyage validé le ' + fmtDC(d), go:'clean', jour:d });
       if (!st.caisse) B.push({ id:'caisse', txt:'Fermeture de caisse non validée le ' + fmtDC(d), go:'caisse', jour:d, moment:'s' });
     }
     return B.map(b => Object.assign(b, {
       forcable: (PERIODES.blocages.filter(x => x.id === b.id)[0] || { forcable:false }).forcable
     }));
   }
   
   V.periodes = async function () {
     const per = await periodeCourante();
     const B = await blocagesCloture(per);
     const dur = joursEntre(per.debut, per.fin).length;
     const ecoules = joursEntre(per.debut, today() < per.fin ? today() : per.fin).length;
     const anticipee = today() < per.fin;
     const bloquants = B.filter(b => !b.forcable);
     const historique = (await DB.get('periodes', [])).slice().reverse().slice(0, 12);
   
     $('#page').innerHTML =
       carte(entete('📅', libellePeriode(per),
         anticipee ? 'Il reste ' + (dur - ecoules) + ' jour(s) avant la fin naturelle.' : 'La période est arrivée à son terme.') +
         '<div class="jauge"><i style="width:' + Math.round(ecoules / dur * 100) + '%"></i></div>' +
         '<div class="rang" style="margin-top:10px"><span class="mini">' + ecoules + ' jour(s) sur ' + dur + '</span>' +
         '<span class="pousse">' + pastille(B.length ? (bloquants.length ? 'bad' : 'warn') : 'ok',
           B.length ? B.length + ' point(s) ouverts' : 'Prête à clôturer') + '</span></div>', 'solide') +
   
       (B.length ? '<div class="entete"><h3>Ce qui reste à faire</h3></div><div class="stack">' + B.map(b =>
         '<div class="alerte ' + (b.forcable ? 'warn' : 'bad') + '"><span class="ai">' + (b.forcable ? '●' : '▲') + '</span>' +
         '<div><b>' + esc(b.txt) + '</b><p>' + (b.forcable ? 'Peut être forcé avec un motif écrit.' : 'Bloquant : la clôture est impossible sans cela.') + '</p></div>' +
         '<span class="go"><button class="btn clair sm" data-go="' + b.go + '"' + (b.jour ? ' data-jour="' + b.jour + '"' : '') +
         (b.moment ? ' data-moment="' + b.moment + '"' : '') + '>Ouvrir</button></span></div>').join('') + '</div>'
         : carte('<div class="alerte ok"><span class="ai">•</span><div><b>Tout est en ordre</b>' +
           '<p>Inventaires validés, achats saisis, registres complets.</p></div></div>', 'plat')) +
   
       '<button class="btn ' + (bloquants.length ? 'clair' : 'menthe') + ' bloc xl" id="clo" style="margin-top:16px">' +
       (anticipee ? '⏭️ Clôture anticipée' : 'Terminer la période') + '</button>' +
    '<button class="btn clair bloc" id="modif" style="margin-top:8px">Modifier les dates de la période</button>' +
   
       (historique.length ? '<div class="entete"><h3>Périodes clôturées</h3></div>' +
         '<div class="dense"><div class="dense-h"><span class="c1">Période</span>' +
         '<span class="c w">Écart</span><span class="c ww">Clôturée par</span></div>' +
         historique.map(p =>
           '<div class="dl"><span class="c1">' + esc(libellePeriode(p)) +
           (p.anticipee ? ' · anticipée' : '') + '</span>' +
           '<span class="c w num">' + (p.ecartPct === undefined ? '—' : n1(p.ecartPct) + ' %') + '</span>' +
           '<span class="c ww">' + esc(p.par) + ' ' + fmtDC(p.jour) + '</span></div>').join('') + '</div>' : '');
   
     $('#clo').onclick = () => ouvrirCloture(per, B, anticipee);
  $('#modif').onclick = () => modifierPeriode(per);
};

/* Ajuster une période en cours sans la clôturer : la date de fin n'était
   modifiable qu'au moment de la clôture, ce qui obligeait à fermer pour
   corriger une simple erreur de saisie. */
function modifierPeriode(per) {
  showSheet(
    '<h2 id="sheet-titre">Modifier la période en cours</h2>' +
    '<p class="sub">' + esc(libellePeriode(per)) + '</p>' +

    '<div class="entete"><h3>Type</h3></div>' +
    '<div class="chips" id="mp-type">' + PERIODES.types.map(t =>
      '<button type="button" class="chip' + (t.id === per.type ? ' on' : '') +
      '" data-t="' + t.id + '">' + esc(t.label) + '</button>').join('') + '</div>' +

    '<div class="grid g2" style="margin-top:16px">' +
    '<div class="champ"><label class="f">Début</label>' +
    '<input type="date" id="mp-d" value="' + per.debut + '"></div>' +
    '<div class="champ"><label class="f">Fin</label>' +
    '<input type="date" id="mp-f" value="' + per.fin + '"></div></div>' +
    '<p class="mini" id="mp-info" style="margin-top:10px"></p>' +
    '<div id="mp-avert"></div>' +

    '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
    '<button class="btn menthe" id="mp-ok">Enregistrer</button></div>');

  let type = per.type, libre = (per.type === 'personnalise');
  const maj = () => {
    const d = $('#mp-d').value || per.debut;
    /* En mode libre, la fin reste telle que saisie — c'est tout l'intérêt. */
    if (!libre) $('#mp-f').value = finNaturelle(type, d);
    const n = joursEntre($('#mp-d').value, $('#mp-f').value).length;
    $('#mp-info').textContent = n > 0
      ? 'Fenêtre de ' + n + ' jour(s), du ' + fmtD($('#mp-d').value) + ' au ' + fmtD($('#mp-f').value) + '.'
      : 'La date de fin doit suivre la date de début.';

    /* Raccourcir une période peut exclure des journées déjà saisies. */
    const raccourcit = $('#mp-f').value < per.fin || $('#mp-d').value > per.debut;
    $('#mp-avert').innerHTML = raccourcit
      ? '<div class="alerte warn" style="margin-top:12px"><span class="ai">●</span><div>' +
        '<b>La fenêtre se rétrécit</b><p>Les journées qui en sortent ne seront plus comptées ' +
        'dans les écarts ni dans les cumuls de caisse. Les saisies elles-mêmes sont conservées ' +
        'et reviendront si vous réélargissez la période.</p></div></div>'
      : '';
  };
  $$('#mp-type [data-t]').forEach(b => b.onclick = () => {
    $$('#mp-type .chip').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); type = b.dataset.t; libre = (type === 'personnalise'); maj();
  });
  /* Toucher la date de fin passe d'office en mode libre : sinon le recalcul
     automatique écrasait la saisie, ce qui donnait l'impression d'un blocage. */
  $('#mp-f').onchange = () => {
    libre = true;
    type = 'personnalise';
    $$('#mp-type .chip').forEach(x => x.classList.toggle('on', x.dataset.t === 'personnalise'));
    maj();
  };
  $('#mp-d').onchange = maj;
  maj();

  $('#mp-ok').onclick = async () => {
    const d1 = $('#mp-d').value, d2 = $('#mp-f').value;
    if (!d1 || !d2 || d2 < d1) return toast('Dates incohérentes', 'erreur');
    const avant = libellePeriode(per);
    Object.assign(per, { type:type, debut:d1, fin:d2,
                         modifiee:nowISO(), modifieePar:STATE.user.prenom });
    await DB.set('periode:courante', per);
    oublierPeriode();
    await feed('ok', STATE.user.prenom + ' a modifié la période : ' + avant + ' → ' + libellePeriode(per));
    closeSheet();
    toast('Période mise à jour');
    rendre('periodes');
  };
}
   
   function ouvrirCloture(per, B, anticipee) {
     const bloquants = B.filter(b => !b.forcable);
     const forcables = B.filter(b => b.forcable);
   
     if (bloquants.length) {
       showSheet(
         '<h2 id="sheet-titre">Clôture impossible</h2>' +
         '<p class="sub">' + bloquants.length + ' point(s) ne peuvent pas être contournés.</p>' +
         '<div class="stack">' + bloquants.map(b =>
           '<div class="alerte bad"><span class="ai">▲</span><div><b>' + esc(b.txt) + '</b></div>' +
           '<span class="go"><button class="btn clair sm" data-saut="' + b.go + '"' + (b.jour ? ' data-jour="' + b.jour + '"' : '') +
           (b.moment ? ' data-moment="' + b.moment + '"' : '') + '>Ouvrir</button></span></div>').join('') + '</div>' +
         '<div class="alerte info" style="margin-top:14px"><span class="ai">ℹ️</span><div><b>Pourquoi c’est bloquant</b>' +
         '<p>Sans inventaire de glace réel et sans achats saisis, le stock de fin est une invention : ' +
         'l’écart calculé serait faux et toute la période suivante partirait de travers.</p></div></div>' +
         '<div class="actions"><button class="btn clair" data-fermer>Fermer</button></div>');
       $$('[data-saut]').forEach(b => b.onclick = () => { closeSheet(); rendre(b.dataset.saut, false, b.dataset.jour, b.dataset.moment); });
       return;
     }
   
     const demain = addD(today(), 1);
     showSheet(
       '<h2 id="sheet-titre">' + (anticipee ? 'Clôture anticipée' : 'Terminer la période') + '</h2>' +
       '<p class="sub">' + esc(libellePeriode(per)) + (anticipee
         ? ' — vous fermez avant le terme prévu du ' + fmtD(per.fin) + '.' : '') + '</p>' +
   
       (forcables.length ? '<div class="alerte warn"><span class="ai">●</span><div><b>' + forcables.length +
         ' point(s) incomplets</b><p>' + esc(forcables.slice(0, 3).map(b => b.txt).join(' · ')) +
         (forcables.length > 3 ? '…' : '') + '</p></div></div>' : '') +
   
       (forcables.length && PERIODES.forcageMotifObligatoire
         ? '<div class="champ" style="margin-top:14px"><label class="f">Motif du forçage (obligatoire)</label>' +
           '<input type="text" id="cl-motif" data-autofocus placeholder="Ex. boutique fermée le 14, relevés sans objet"></div>' : '') +
   
       '<div class="entete"><h3>Nouvelle période</h3></div>' +
       '<div class="chips" id="cl-type">' + PERIODES.types.map((t, i) =>
         '<button type="button" class="chip' + (t.id === per.type ? ' on' : '') + '" data-t="' + t.id + '">' +
         esc(t.label) + '</button>').join('') + '</div>' +
   
       '<div class="grid g2" id="cl-dates" style="margin-top:14px">' +
       '<div class="champ"><label class="f">Début</label><input type="date" id="cl-d" value="' + demain + '"></div>' +
       '<div class="champ"><label class="f">Fin</label><input type="date" id="cl-f" value="' +
       finNaturelle(per.type, demain) + '"></div></div>' +
       '<p class="mini" id="cl-info" style="margin-top:10px"></p>' +
       '<div id="cl-trou"></div>' +
   
       '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
       '<button class="btn menthe" id="cl-ok">Clôturer et ouvrir</button></div>');
   
     let type = per.type;
     const maj = () => {
       const d = $('#cl-d').value || demain;
       if (type !== 'personnalise') {
         $('#cl-d').value = d;
         $('#cl-f').value = finNaturelle(type, d);
       }
       const n = joursEntre($('#cl-d').value, $('#cl-f').value).length;
       $('#cl-info').textContent = 'La nouvelle fenêtre couvrira ' + n + ' jour(s). ' +
         'Tous les écarts et statistiques se recalculeront dessus.';
       $('#cl-dates').style.opacity = type === 'personnalise' ? '1' : '.85';
       /* Un début choisi après demain laissait des jours hors de toute période,
          sans rien dire : ni écart, ni statistiques pour eux, et l'écran
          Périodes affichait ensuite « 0 jour(s) sur 7 ». On le signale et le
          bouton le dit, sans l'interdire (fermeture saisonnière, congés). */
       const debut = $('#cl-d').value;
       const trou = debut > demain ? joursEntre(demain, addD(debut, -1)) : [];
       $('#cl-trou').innerHTML = trou.length
         ? '<div class="alerte warn" style="margin-top:10px"><span class="ai">●</span><div><b>' + trou.length +
           ' jour(s) hors de toute période</b><p>Du ' + fmtD(trou[0]) + ' au ' + fmtD(trou[trou.length - 1]) +
           ' : ces jours ne compteront dans aucun écart ni aucune statistique. ' +
           'Pour enchaîner sans interruption, commencez le ' + fmtD(demain) + '.</p></div></div>'
         : '';
       $('#cl-ok').textContent = trou.length ? 'Clôturer malgré l’interruption' : 'Clôturer et ouvrir';
     };
     $$('#cl-type [data-t]').forEach(b => b.onclick = () => {
       $$('#cl-type .chip').forEach(x => x.classList.remove('on'));
       b.classList.add('on'); type = b.dataset.t; maj();
     });
     $('#cl-d').onchange = maj;
     $('#cl-f').onchange = maj;
     maj();
   
     $('#cl-ok').onclick = async () => {
       const motif = $('#cl-motif') ? $('#cl-motif').value.trim() : '';
       if (forcables.length && PERIODES.forcageMotifObligatoire && !motif) {
         toast('Indiquez le motif du forçage', 'erreur');
         return $('#cl-motif').focus();
       }
       const d1 = $('#cl-d').value, d2 = $('#cl-f').value;
       if (!d1 || !d2 || d2 < d1) return toast('Dates de période incohérentes', 'erreur');
   
       const c = await calculEcart(per);
       const close = Object.assign({}, per, {
         ouverte:false, anticipee:anticipee, par:STATE.user.prenom, jour:today(), at:nowISO(),
         motif:motif, forces:forcables.map(f => f.txt),
         ecartKg:+n2(c.ecart), ecartPct:+n2(c.pct), stockFin:+n2(c.reel), valeur:+n2(c.valeur)
       });
       await DB.push('periodes', close);
   
       const suivante = { id:uid(), type:type, debut:d1, fin:d2, ouverte:true,
                          precedente:per.id, creee:nowISO(), creeePar:STATE.user.prenom };
       await DB.set('periode:courante', suivante);
       oublierPeriode();
       await DB.patch('ecart:' + suivante.id, { debut:{ kg:c.reel }, litrageBL:0, jeteL:0, jeteKg:0, ventes:{} });
   
       await feed('ok', STATE.user.prenom + ' a clôturé ' + libellePeriode(per) +
         (anticipee ? ' (anticipée)' : '') + ' — écart ' + n1(c.pct) + ' %');
       closeSheet();
       toast('Période clôturée · nouvelle fenêtre ouverte');
       rendre('periodes');
     };
   }
   
   /* =============================================================================
      29. HISTORIQUE + REGISTRE SANITAIRE
      ========================================================================== */
   V.histo = async function () {
     const onglet = V.histo._t || 'caisse';
     const defs = {
       caisse:{ l:'Caisse', p:'caisse:' }, temp:{ l:'Frigos', p:'temp:' }, clean:{ l:'Nettoyage', p:'clean:' },
       reassort:{ l:'Réassort', p:'reassort:' }, pertes:{ l:'Pertes', p:'pertes:' },
       pointage:{ l:'Heures', p:'pointage:' }, feedback:{ l:'Retours', p:'feedback' },
       inventaires:{ l:'Inventaires', p:null }
     };
     /* Les inventaires ne sont pas rangés par jour mais dans deux listes
        (chambre froide, sec) : on les lit à part. Chaque ligne s'ouvre sur le
        comptage complet (voirInventaire, stock.js). */
     const cles = defs[onglet].p ? (await DB.list(defs[onglet].p)).reverse() : [];
     const lignes = [];
     const invs = [];
     if (onglet === 'inventaires') {
       /* Catalogue du sec à jour (références ajoutées, renommées, masquées)
          avant d'ouvrir un comptage du sec. */
       if (typeof chargerCatalogueSec === 'function') await chargerCatalogueSec().catch(() => {});
       const [hf, hs] = await Promise.all([DB.get('stock:inventaires', []), DB.get('stock:secs', [])]);
       (hf || []).forEach(h => invs.push({ h: h, p: 'froid' }));
       (hs || []).forEach(h => invs.push({ h: h, p: 'sec' }));
       invs.sort((a, b) => String(b.h.at || b.h.jour).localeCompare(String(a.h.at || a.h.jour)));
       invs.forEach((x, i) => {
         const n = Object.keys(x.h.lignes || {}).length;
         lignes.push([fmtD(x.h.jour) + ' · ' + (x.p === 'froid' ? 'chambre froide' : 'sec'),
                      n + ' produit(s)',
                      x.h.manquants ? x.h.manquants + ' manquant(s)' : (x.p === 'froid' ? 'Sans manquant' : 'Compté'),
                      x.h.par || '—', x.h.manquants ? 'warn' : 'ok', i]);
       });
     }
   
     for (const c of cles) {
       const j = c.replace(defs[onglet].p, ''), v = await DB.get(c);
       if (!v) continue;
       if (onglet === 'caisse') {
         /* Même calcul qu'ailleurs : la veille donne le fond initial manquant. */
         const rk = caisseResume(v, await DB.get('caisse:' + addD(j, -1), null));
         lignes.push([fmtD(j), eur(rk.ca), eur(rk.ecart), rk.par || '—',
                      Math.abs(rk.ecart) > SEUILS.caisseJourEur ? 'bad' : 'ok']);
       }
       else if (onglet === 'temp') {
         const n = ENCEINTES.reduce((s, e) => s + (v['m_' + e.id] ? 1 : 0) + (v['s_' + e.id] ? 1 : 0), 0);
         const cr = ENCEINTES.filter(e => ['m','s'].some(m => etatTemp(e, v[m + '_' + e.id]) === 'crit')).length;
         lignes.push([fmtD(j), n + ' / ' + (ENCEINTES.length * 2), cr ? cr + ' critique(s)' : 'Conforme', v.par || '—', cr ? 'bad' : 'ok']);
       }
       else if (onglet === 'clean') {
         const f = Object.keys(v).filter(k => v[k] && v[k].ok).length;
         lignes.push([fmtD(j), f + ' tâche(s)', f ? 'Fait' : 'Rien', '—', f ? 'ok' : 'bad']);
       }
       else if (onglet === 'reassort') {
         const f = Object.keys(v).filter(k => v[k] && v[k].ok).length;
         const r = Object.keys(v).filter(k => v[k] && v[k].rupture).length;
         lignes.push([fmtD(j), f + ' / ' + REASSORT.length, r ? r + ' rupture(s)' : 'Aucune', '—', r ? 'bad' : 'ok']);
       }
       else if (onglet === 'pertes') {
         if (!v.length) continue;
         lignes.push([fmtD(j), v.length + ' ligne(s)', n1(v.reduce((s, w) => s + litresPerte(w), 0)) + ' L', v[0].par || '—', 'warn']);
       }
       else if (onglet === 'pointage') {
         if (!v.length) continue;
         const t = v.reduce((s, x) => s + (x.minutes || 0), 0);
         lignes.push([fmtD(j), v.length + ' session(s)', Math.floor(t / 60) + ' h ' + String(t % 60).padStart(2, '0'),
                      v.map(x => x.prenom).filter((x, i, a) => a.indexOf(x) === i).join(', '), 'ok']);
       }
       else if (onglet === 'feedback') {
         (Array.isArray(v) ? v : []).slice().reverse().forEach(f =>
           lignes.push([fmtD(f.at ? isoOf(new Date(f.at)) : today()), f.type, f.texte, f.par, 'warn']));
       }
     }
   
     $('#vue-actions').innerHTML = '<button class="btn sm" id="pdf">Registre sanitaire</button>' +
       '<button class="btn clair sm" id="csv">CSV</button>';
   
     $('#page').innerHTML =
       '<div class="chips" style="margin-bottom:14px">' + Object.keys(defs).map(k =>
         '<button type="button" class="chip' + (onglet === k ? ' on' : '') + '" data-h="' + k + '">' +
         esc(defs[k].l) + '</button>').join('') + '</div>' +
   
       carte(entete('🛡️', 'Registre sanitaire',
         'Compile températures, nettoyage et lots ouverts en un document présentable à un contrôle.') +
         '<button class="btn ciel bloc xl" id="pdf2">Export PDF contrôle sanitaire</button>', 'ciel') +
   
       (onglet === 'inventaires' && lignes.length
         ? '<p class="mini" style="margin-top:14px">Touchez un inventaire pour voir tous ses produits.</p>' : '') +
       (lignes.length
         ? '<div class="dense" style="margin-top:14px"><div class="dense-h">' +
           '<span class="c1">Date</span><span class="c w">Volume</span><span class="c w">Résultat</span><span class="c ww">Par</span></div>' +
           '<div class="dense-scroll">' + lignes.map(l =>
             '<div class="dl"' + (l[5] !== undefined
               ? ' data-inv="' + l[5] + '" role="button" tabindex="0" style="cursor:pointer"' : '') +
             '><span class="c1">' + esc(l[0]) + '</span>' +
             '<span class="c w">' + esc(l[1]) + '</span>' +
             '<span class="c w">' + pastille(l[4], String(l[2]).slice(0, 22)) + '</span>' +
             '<span class="c ww">' + esc(l[3]) + '</span></div>').join('') + '</div></div>'
         : vide('📚', 'Aucun enregistrement pour ce registre.'));
   
     $$('[data-h]').forEach(b => b.onclick = () => { V.histo._t = b.dataset.h; rendre('histo'); });
     $$('[data-inv]').forEach(r => {
       const ouvrir = () => {
         const x = invs[+r.dataset.inv];
         if (x && typeof voirInventaire === 'function') voirInventaire(x.h, x.p);
       };
       r.onclick = ouvrir;
       r.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvrir(); } };
     });
     $('#pdf').onclick = ouvrirBouclier;
     $('#pdf2').onclick = ouvrirBouclier;
     $('#csv').onclick = () => {
       /* Guillemets : un « ; » ou un retour à la ligne dans un texte décalait les
          colonnes. Apostrophe devant = + - @ : Excel l'exécuterait en formule. */
       const q = x => { x = String(x == null ? '' : x);
                        if (/^[=+\-@\t\r]/.test(x) && !/^-[\d\s\u00a0\u202f.,]+\s*€?$/.test(x)) x = "'" + x;
                        return '"' + x.replace(/"/g, '""') + '"'; };
       const csv = ['Date;Volume;Resultat;Par'].concat(lignes.map(l => l.slice(0, 4).map(q).join(';'))).join('\n');
       const a = document.createElement('a');
       a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type:'text/csv;charset=utf-8' }));
       a.download = 'pilot-shop-' + onglet + '-' + today() + '.csv';
       a.click();
       toast('Export CSV téléchargé');
     };
   };
   
   function ouvrirBouclier() {
     showSheet(
       '<h2 id="sheet-titre">Registre pour un contrôle sanitaire</h2>' +
       '<p class="sub">Le document compile les relevés de température, le nettoyage et les lots ouverts, ' +
       'avec les noms et les heures de saisie.</p>' +
       '<div class="chips" id="bp">' +
       [[7, '7 jours'], [30, '30 jours'], [90, '3 mois']].map((x, i) =>
         '<button type="button" class="chip' + (i === 1 ? ' on' : '') + '" data-p="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>' +
       '<div class="alerte info" style="margin-top:16px"><span class="ai">•</span><div><b>Enregistrer en PDF</b>' +
       '<p>Dans la fenêtre d’impression, choisissez « Enregistrer au format PDF » comme destination.</p></div></div>' +
       '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
       '<button class="btn ciel" id="bg">Générer</button></div>');
   
     let jours = 30;
     $$('#bp [data-p]').forEach(b => b.onclick = () => {
       $$('#bp .chip').forEach(x => x.classList.remove('on'));
       b.classList.add('on'); jours = +b.dataset.p;
     });
     $('#bg').onclick = async () => { closeSheet(); toast('Préparation du registre…'); await genererRegistre(jours); };
   }
   
   async function genererRegistre(jours) {
     const fin = today(), debut = addD(fin, -(jours - 1));
     const temps = [], nets = [];
     for (const d of joursEntre(debut, fin)) {
       const t = await DB.get('temp:' + d, null);
       if (t) temps.push({ d:d, t:t });

       /* Le registre lisait la clé « clean: », l'ancien registre quotidien.
          L'écran Nettoyage écrit dans « hebdo: » depuis qu'il n'affiche plus que
          les tâches hebdomadaires du jour. Le registre imprimé annonçait donc
          « aucun enregistrement de nettoyage » alors que l'équipe validait tous
          les jours — sur un document destiné à un contrôleur, c'est le pire
          endroit où perdre une preuve.
          On lit les DEUX clés : l'ancienne porte encore l'historique. */
       const hebdo  = await DB.get('hebdo:' + d, null);
       const ancien = await DB.get('clean:' + d, null);
       const c = Object.assign({}, ancien || {}, hebdo || {});
       const ok = Object.keys(c).filter(k => c[k] && c[k].ok);
       if (ok.length) {
         const liste = (typeof tachesHebdoDuJour === 'function')
           ? await tachesHebdoDuJour(d) : tachesDuJour(d);
         /* On garde le LIBELLÉ de chaque tâche, pas seulement le compte.
            « 4 postes validés » ne prouve rien devant un contrôleur : il veut
            savoir que l'évier a été nettoyé, pas qu'on a coché quatre cases. */
         const nom = k => {
           const t = (liste || []).filter(x => x.id === k)[0] ||
                     (typeof TACHES_HEBDO_DEF !== 'undefined'
                       ? TACHES_HEBDO_DEF.filter(x => x.id === k)[0] : null) ||
                     (typeof tachesDuJour === 'function'
                       ? (tachesDuJour(d) || []).filter(x => x.id === k)[0] : null);
           return t ? (t.libelle || t.nom || k) : k;
         };
         nets.push({ d:d, n:ok.length, total:(liste || []).length,
           par:ok.map(k => c[k].par).filter((v, i, a) => v && a.indexOf(v) === i).join(', '),
           taches: ok.map(k => ({ nom: nom(k), par: c[k].par || '',
                                  at: c[k].at || '' })) });
       }
     }
     /* Tous les mois couverts : un registre imprimé le 2 oubliait les lots
        ouverts fin du mois précédent, encore en vitrine. */
     const moisReg = joursEntre(debut, fin).map(monthKey).filter((m, i, a) => a.indexOf(m) === i);
     const fifo = [].concat(...(await Promise.all(moisReg.map(calculFIFO))))
       .filter(f => f.ouv >= debut || f.limite >= debut)   // encore en vitrine sur la période
       .sort((a, b) => a.resteH - b.resteH);
     const per = await periodeCourante();
   
     $('#printview').innerHTML =
       '<div class="pv-h"><h1>Registre sanitaire — ' + esc(APP.nom) + '</h1>' +
       '<div>' + esc(APP.site) + ' · du ' + fmtD(debut) + ' au ' + fmtD(fin) +
       ' · période de gestion : ' + esc(libellePeriode(per)) +
       '<br>Édité le ' + new Date().toLocaleString(APP.locale) + ' par ' + esc(STATE.user.prenom) + '</div></div>' +
   
       '<div class="pv-s">1. Relevés de température des enceintes froides</div>' +
       (temps.length
         ? '<table><thead><tr><th>Date</th>' + ENCEINTES.map(e => '<th>' + esc(e.nom) + '</th>').join('') +
           '<th>Action corrective</th></tr></thead><tbody>' +
           temps.map(L => '<tr><td>' + L.d.split('-').reverse().join('/') + '</td>' +
             ENCEINTES.map(e => {
               const m = L.t['m_' + e.id], s = L.t['s_' + e.id];
               const bad = etatTemp(e, m) === 'crit' || etatTemp(e, s) === 'crit';
               return '<td' + (bad ? ' style="font-weight:700"' : '') + '>' +
                 (m === undefined || m === '' ? '—' : esc(m)) + ' / ' + (s === undefined || s === '' ? '—' : esc(s)) + '</td>';
             }).join('') + '<td>' + esc(L.t.obs || '') + '</td></tr>').join('') + '</tbody></table>' +
           '<div style="font-size:9.5px">Valeurs en °C, matin / soir. Les dépassements de limite critique sont en gras. ' +
           'Cibles : ' + ENCEINTES.map(e => esc(e.nom) + ' ' + esc(e.cible)).join(' · ') + '.</div>'
         : '<div>Aucun relevé enregistré sur la période.</div>') +
   
       '<div class="pv-s">2. Nettoyage et désinfection</div>' +
       (nets.length
         ? '<table><thead><tr><th>Date</th><th>Jour</th><th>Tâche validée</th>' +
           '<th>Par</th><th>Heure</th></tr></thead><tbody>' +
           /* Une ligne par TÂCHE, pas par jour : c'est le libellé qui atteste,
              pas le compte. La date n'est répétée que sur la première ligne du
              jour, pour que le tableau reste lisible. */
           nets.map(x => (x.taches || []).map((t, i) =>
             '<tr><td>' + (i ? '' : x.d.split('-').reverse().join('/')) + '</td>' +
             '<td>' + (i ? '' : nomJour(x.d)) + '</td>' +
             '<td>' + esc(t.nom) + '</td>' +
             '<td>' + esc(t.par) + '</td>' +
             '<td>' + (t.at ? heure(t.at) : '') + '</td></tr>').join('')
           ).join('') +
           '</tbody></table>' +
           '<div style="font-size:9.5px">' +
           nets.map(x => x.d.split('-').reverse().join('/') + ' : ' + x.n + '/' + x.total).join(' · ') +
           '. Plan de nettoyage : ' +
           NETTOYAGE.asynchrones.map(a => a.nom + ' (' + (a.type === 'jours-fixes'
             ? a.jours.map(j => JOURS_SEMAINE[j].toLowerCase()).join(', ')
             : 'tous les ' + a.intervalleJours + ' jours') + ')').join(' · ') + '.</div>'
         : '<div>Aucun enregistrement de nettoyage sur la période.</div>') +
   
       '<div class="pv-s">3. Traçabilité des lots ouverts</div>' +
       (fifo.length
         ? '<table><thead><tr><th>Produit</th><th>Lot</th><th>Ouvert le</th><th>Durée de vie</th><th>Limite</th><th>État</th><th>Par</th></tr></thead><tbody>' +
           fifo.map(f => '<tr><td>' + esc(f.nom) + '</td><td>' + esc(f.lot) + '</td>' +
             '<td>' + f.ouv.split('-').reverse().join('/') + '</td>' +
             '<td>' + (f.heures < 72 ? f.heures + ' h' : Math.round(f.heures / 24) + ' j') + '</td>' +
             '<td>' + f.limite.split('-').reverse().join('/') + '</td>' +
             '<td>' + (f.c === 'rouge' ? 'DÉPASSÉE' : f.c === 'orange' ? 'À consommer' : 'Conforme') + '</td>' +
             '<td>' + esc(f.par || '—') + '</td></tr>').join('') + '</tbody></table>'
         : '<div>Aucun lot ouvert enregistré sur la période.</div>') +
   
       '<div class="sign">Document généré à partir de saisies horodatées et nominatives du système ' + esc(APP.nom) +
       '. Chaque validation est associée au compte de la personne connectée.<br><br>' +
       'Nom du responsable : ____________________  Signature : ____________________  Date : ____ / ____ / ________</div>';
   
     await feed('ok', STATE.user.prenom + ' a édité le registre sanitaire sur ' + jours + ' jours');
     setTimeout(() => window.print(), 200);
   }
   
   /* =============================================================================
      30. ÉQUIPE
      ========================================================================== */
   V.equipe = async function () {
     const cles = (await DB.list('pointage:')).reverse().slice(0, 30);
     const parPersonne = {};
     EQUIPE.forEach(e => parPersonne[e.id] = { e:e, min:0, jours:0, sessions:[] });
   
     for (const c of cles) {
       const j = c.replace('pointage:', '');
       (await DB.get(c, [])).forEach(s => {
         const p = parPersonne[s.employe];
         if (!p) return;
         p.min += s.minutes || 0;
         p.jours++;
         p.sessions.push(Object.assign({ jour:j }, s));
       });
     }
   
     const feedTot = {};
     for (let i = 0; i < 14; i++) {
       (await DB.get('feed:' + addD(today(), -i), [])).forEach(x => {
         if (x.id) feedTot[x.id] = (feedTot[x.id] || 0) + 1;
       });
     }
   
     /* Le manager gère l'équipe ici : ajouter, corriger, changer un code,
        retirer. L'écran n'affichait que des statistiques. */
     const gere = !!(STATE.user && STATE.user.role === 'manager');
     if (gere) $('#vue-actions').innerHTML = '<button class="btn menthe sm" id="eq-ajout">+ Ajouter</button>';

     $('#page').innerHTML =
       '<div class="stack">' + EQUIPE.map(e => {
         const p = parPersonne[e.id];
         const h = Math.floor(p.min / 60) + ' h ' + String(p.min % 60).padStart(2, '0');
         const enCours = p.sessions.filter(s => !s.fin && s.jour === today())[0];
         return carte('<div class="rang">' + avatar(e, 'av') +
           '<div style="flex:1;min-width:0"><b>' + esc(e.prenom) + '</b>' +
           '<div class="mini">' + ROLES[e.role].label + ' · ' + p.jours + ' journée(s) sur 30' +
           (enCours ? ' · en service depuis ' + heure(enCours.debut) : '') + '</div></div>' +
           '<div style="text-align:right"><b class="num">' + h + '</b>' +
           '<div class="mini">' + (feedTot[e.id] || 0) + ' action(s) / 14 j</div></div></div>' +
           (gere ? '<button class="btn clair bloc sm" data-eq="' + esc(e.id) + '" style="margin-top:12px">' +
             'Modifier ' + esc(e.prenom) + '</button>' : ''),
           enCours ? 'menthe' : '');
       }).join('') + '</div>' +
   
       carte(entete('ℹ️', 'Ce que mesure cette page',
         'Le nombre d’actions compte les validations tracées, pas la qualité du travail. ' +
         'Une personne qui saisit peu peut travailler autant : à croiser avec le terrain avant d’en tirer une conclusion.'), 'plat');

     if (gere) {
       $('#eq-ajout').onclick = () => editerPersonne(null);
       $$('[data-eq]').forEach(b => b.onclick = () => editerPersonne(EQUIPE.filter(e => e.id === b.dataset.eq)[0]));
     }
   };

   /* Écrit l'équipe après transformation. La liste est relue en base juste
      avant, pour ne pas écraser une modification faite sur un autre iPad ;
      sans base joignable, on n'écrit rien (comme à l'amorçage).
      La relecture ne suffisait pas : deux managers qui modifiaient l'équipe
      en même temps sur deux iPads perdaient l'une des deux modifications, et
      une écriture ratée, gardée en file, remettait plus tard une équipe
      périmée (une personne retirée revenait, avec son code). La ligne n'est
      donc remplacée que si sa date d'écriture (updated_at, posée par la base)
      n'a pas bougé depuis la lecture ; sinon la modification est refaite sur
      la liste fraîche. Rien ne part en file d'attente. */
   const CONNEXION_EQUIPE = 'Connexion nécessaire pour modifier l’équipe. Réessayez.';
   async function modifierEquipe(transformer) {
     const copie = l => l.map(e => Object.assign({}, e));
     const avecManager = liste => {
       if (!liste.some(e => e.role === 'manager')) throw new Error('Il faut au moins un manager.');
       return liste;
     };
     const garder = liste => {
       try { DB._ecrire('equipe', JSON.stringify(liste)); } catch (e) {}
       EQUIPE.splice(0, EQUIPE.length, ...liste.filter(ficheValide));
       return liste;
     };
     /* Écriture d'avant, sans contrôle de version : pas de base, équipe encore
        en file (amorçage), pas encore de ligne, ou base sans updated_at. */
     const sansVersion = async () => {
       const lu = await lireEquipeBase();
       if (lu.etat === 'reseau') throw new Error(CONNEXION_EQUIPE);
       const source = (Array.isArray(lu.data) && lu.data.length) ? lu.data : EQUIPE;
       const liste = avecManager(await transformer(copie(source)));
       await DB.set('equipe', liste);
       EQUIPE.splice(0, EQUIPE.length, ...liste.filter(ficheValide));
       return liste;
     };
     if (!DB.configure || !DB._distant('equipe') || fileLire().some(x => x.cle === 'equipe')) return sansVersion();
     const chemin = DB._table('equipe') + '?id=eq.' + encodeURIComponent('equipe');
     const lire = async () => {
       const l = await DB._appel(chemin + '&select=data,updated_at&limit=1');
       return (l && l.length) ? l[0] : null;
     };
     /* La base range les clés à sa façon : on compare clés triées. */
     const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x))
       ? Object.keys(x).sort().reduce((o, c) => { o[c] = x[c]; return o; }, {}) : x);
     let versionVue = null;
     for (let essai = 0; essai < 3; essai++) {
       let lu;
       try { lu = await lire(); }
       catch (e) {
         if (e && e.http === 400) return sansVersion();
         throw new Error(CONNEXION_EQUIPE);
       }
       if (!lu || !lu.updated_at || !Array.isArray(lu.data) || !lu.data.length) return sansVersion();
       /* [] alors que la ligne n'a pas bougé : ce n'est pas un autre iPad, la base refuse. */
       if (versionVue === lu.updated_at) throw new Error('La base refuse la modification de l’équipe. Réessayez plus tard.');
       versionVue = lu.updated_at;
       const liste = avecManager(await transformer(copie(lu.data)));
       let r;
       try {
         r = await DB._appel(chemin + '&updated_at=eq.' + encodeURIComponent(lu.updated_at) + '&select=updated_at', {
           method: 'PATCH',
           headers: { 'Prefer': 'return=representation' },
           body: JSON.stringify({ data:liste })
         });
       } catch (e) {
         /* Réponse perdue : l'écriture a pu passer. On le vérifie. */
         let relu = null;
         try { relu = await lire(); } catch (x) {}
         const refus = e && e.http >= 400 && e.http < 500 && [408, 429].indexOf(e.http) < 0;
         if (!refus && relu && canon(relu.data) === canon(liste)) return garder(liste);
         if (relu && Array.isArray(relu.data) && relu.data.length) garder(relu.data);
         if (refus) throw new Error('La base a refusé la modification (erreur ' + e.http + ').');
         /* Aucune réponse HTTP et relecture impossible : la modification a pu passer. */
         if (!relu && !(e && e.http)) throw new Error('Réseau coupé pendant l’enregistrement : la modification ' +
                                                      'est peut-être passée. Vérifiez la liste avant de réessayer.');
         if (!relu || relu.updated_at === lu.updated_at) throw new Error(CONNEXION_EQUIPE);   // rien n'est passé
         throw new Error('L’équipe vient d’être modifiée sur un autre iPad : vérifiez la liste, puis réessayez.');
       }
       if (Array.isArray(r) && r.length) return garder(liste);
       /* Ligne modifiée entre-temps sur un autre iPad : on recommence sur la liste fraîche. */
     }
     throw new Error('L’équipe vient d’être modifiée sur un autre iPad. Réessayez.');
   }

   /* Pose un nouveau code sur une fiche, haché ou non selon PIN_HACHAGE —
      la même règle qu'à l'amorçage ; l'ancien code (clair ou haché) disparaît. */
   async function ficheAvecCode(fiche, pin) {
     const f = Object.assign({}, fiche, { pin:pin });
     delete f.pinH; delete f.sel;
     return (PIN_HACHAGE && pinHachable()) ? fichePinHachee(f) : f;
   }

   function editerPersonne(e) {
     if (!STATE.user || STATE.user.role !== 'manager') return;
     const neuf = !e;
     const moi = !neuf && e.id === STATE.user.id;
     /* Identifiant tiré une fois par feuille : un second « Enregistrer » après une réponse perdue
        retrouve la fiche déjà ajoutée au lieu d'en créer une seconde (« existe déjà »). */
     const idNouveau = neuf ? 'e' + uid() : null;
     const champCode = (id, libelle) =>
       '<div class="champ"><label class="f">' + libelle + '</label>' +
       '<input type="password" id="' + id + '" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="new-password"></div>';
     showSheet(
       '<h2 id="sheet-titre">' + (neuf ? 'Ajouter une personne' : 'Modifier ' + esc(e.prenom)) + '</h2>' +
       '<p class="sub">' + (neuf ? 'Elle apparaîtra sur l’écran des prénoms de chaque iPad.'
                                 : 'Laissez le code vide pour garder le code actuel.') + '</p>' +
       '<div class="champ" style="margin-top:14px"><label class="f">Prénom</label>' +
       '<input type="text" id="eq-prenom" maxlength="20" autocapitalize="words" value="' + esc(neuf ? '' : e.prenom) + '"></div>' +
       '<div class="champ" style="margin-top:12px"><label class="f">Rôle</label>' +
       '<select id="eq-role"' + (moi ? ' disabled' : '') + '>' +
       '<option value="equipe"' + (!neuf && e.role === 'equipe' ? ' selected' : '') + '>Équipier</option>' +
       '<option value="manager"' + (!neuf && e.role === 'manager' ? ' selected' : '') + '>Manager</option></select>' +
       (moi ? '<p class="mini" style="margin-top:6px">Votre propre rôle se change depuis la session d’un autre manager.</p>' : '') +
       '</div>' +
       '<div class="grid g2" style="margin-top:12px">' +
       champCode('eq-pin', neuf ? 'Code à 4 chiffres' : 'Nouveau code') + champCode('eq-pin2', 'Retaper le code') + '</div>' +
       '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
       '<button class="btn menthe" id="eq-ok">Enregistrer</button></div>' +
       (neuf || moi ? '' : '<button class="btn fantome bloc" id="eq-retirer" style="margin-top:8px">Retirer de l’équipe</button>'));

     $('#eq-ok').onclick = async () => {
       const prenom = $('#eq-prenom').value.trim().replace(/\s+/g, ' ');
       const role = moi ? e.role : $('#eq-role').value;
       const pin = $('#eq-pin').value.trim(), pin2 = $('#eq-pin2').value.trim();
       if (!prenom) return toast('Le prénom est obligatoire', 'erreur');
       if (neuf || pin || pin2) {
         if (!/^\d{4}$/.test(pin)) return toast('Le code doit faire 4 chiffres', 'erreur');
         if (pin !== pin2) return toast('Les deux codes ne correspondent pas', 'erreur');
       }
       const changements = [];
       if (!neuf) {
         if (prenom !== e.prenom) changements.push('prénom ' + e.prenom + ' → ' + prenom);
         if (role !== e.role) changements.push('rôle ' + ROLES[role].label);
         if (pin) changements.push('nouveau code');
         if (!changements.length) { closeSheet(); return toast('Aucun changement'); }
       }
       $('#eq-ok').disabled = true;
       try {
         await modifierEquipe(async liste => {
           const cible = neuf ? idNouveau : e.id;
           const dejaLa = neuf && liste.some(x => x.id === idNouveau);
           const autres = liste.filter(x => x.id !== cible);
           if (autres.some(x => String(x.prenom || '').trim().toLowerCase() === prenom.toLowerCase()))
             throw new Error('« ' + prenom + ' » existe déjà : ajoutez une initiale (ex. ' + prenom + ' B.)');
           /* Même règle qu'à l'amorçage : deux personnes, deux codes. */
           if (pin) for (const x of autres) if (await pinCorrect(x, pin)) throw new Error('Ce code est déjà utilisé : choisissez-en un autre');
           let fiche;
           if (neuf && !dejaLa) {
             /* Identifiant jamais réutilisé. Le numéro suivait le plus grand id
                restant : après le retrait de Nina (e3), Paul recevait e3, et
                l'iPad où Nina était connectée se rouvrait sous le nom de Paul,
                manager, sans code ; Paul héritait aussi de ses actions. */
             const id = idNouveau;
             fiche = { id:id, prenom:prenom, role:role, couleur:COULEURS_EQUIPE[liste.length % COULEURS_EQUIPE.length],
                       initiales:prenom.slice(0, 2).toUpperCase() };
           } else {
             const ancienne = liste.filter(x => x.id === cible)[0];
             if (!ancienne) throw new Error(e.prenom + ' a été retiré(e) de l’équipe sur un autre appareil');
             fiche = Object.assign({}, ancienne, { prenom:prenom, role:role,
               initiales:prenom === ancienne.prenom ? ancienne.initiales : prenom.slice(0, 2).toUpperCase() });
           }
           if (pin) fiche = await ficheAvecCode(fiche, pin);
           return (neuf && !dejaLa) ? liste.concat([fiche]) : liste.map(x => x.id === fiche.id ? fiche : x);
         });
       } catch (err) {
         if ($('#eq-ok')) $('#eq-ok').disabled = false;
         return toast(err && err.message ? err.message : 'Enregistrement impossible', 'erreur');
       }
       /* Jamais le code dans le journal : seulement le fait qu'il a changé. */
       if (neuf) await feed('ok', STATE.user.prenom + ' a ajouté ' + prenom + ' à l’équipe (' + ROLES[role].label + ')');
       else await feed(pin || role !== e.role ? 'warn' : 'ok',
         STATE.user.prenom + ' a modifié la fiche de ' + prenom + ' : ' + changements.join(', '));
       if (moi) {
         STATE.user.prenom = prenom;
         STATE.user.initiales = (EQUIPE.filter(x => x.id === e.id)[0] || {}).initiales || STATE.user.initiales;
         majBoutonCompte();
       }
       closeSheet();
       toast(neuf ? prenom + ' ajouté(e) à l’équipe' : 'Fiche de ' + prenom + ' enregistrée');
       rendre('equipe');
     };

     const rt = $('#eq-retirer');
     if (rt) rt.onclick = () => confirmer('Retirer ' + e.prenom + ' de l’équipe ?',
       'Son prénom disparaît de l’écran de connexion et son code ne fonctionne plus. ' +
       'Ce qu’elle ou il a déjà saisi reste dans les registres.',
       'Retirer', async () => {
         try {
           await modifierEquipe(async liste => liste.filter(x => x.id !== e.id));
         } catch (err) { return toast(err && err.message ? err.message : 'Retrait impossible', 'erreur'); }
         await feed('warn', STATE.user.prenom + ' a retiré ' + e.prenom + ' de l’équipe');
         toast(e.prenom + ' retiré(e) de l’équipe');
         rendre('equipe');
       },
       /* « Annuler » revient à la fiche au lieu de tout fermer. */
       () => editerPersonne(e));
   }
   
   /* =============================================================================
      31. RÉGLAGES
      ========================================================================== */
/* V.reglages : version retirée — elle était remplacée au chargement. */
   
   /* =============================================================================
      32. IMPORT DE L'EXPORT DE CAISSE
      Trois lectures possibles, de la plus fiable à la moins fiable :
        1. une colonne de poids en kg  → somme directe
        2. SKU + quantité             → grammage du catalogue
        3. libellé produit + quantité → rapprochement par nom
      Rien n'est enregistré sans que le manager ait vu le détail à l'écran.
      ========================================================================== */
   
   /* À déplacer dans config.js quand le catalogue de Chamonix sera figé.
      Grammes de glace par unité vendue, par SKU. */
   const GRAMMAGES = (typeof CATALOGUE_SKU !== 'undefined') ? CATALOGUE_SKU : {
     '11111':81,  '11112':133, '11113':163, '11114':221, '11115':275,
     '11121':69,  '11122':114, '11123':153, '11124':224, '11127':153,
     '11131':112, '11132':149, '11133':208,
     '15111':470, '15112':930,
     '12115':160, '12121':160, '12122':160, '12123':160, '12126':160,
     '14111':160, '14121':160, '14127':160, '14131':160, '14132':200, '14133':160,
     /* Macarons et gianduiotto : hors du calcul d'écart. */
     '13111':0,   '13112':0,   '13113':0,   '13114':0,   '13116':0,   '13141':0,  '17010':0,
     '41171':80,  '41173':80,  '41175':80,  '41116':100,
     '41121':50,  '41122':50,  '41123':50,  '41126':50,  '41133':50, '41134':50, '41137':50, '41313':50,
     '31132':50,  '31134':50,  '31312':50,  '31313':50,  '31314':50,
     '71111':50
   };

   /* Export Innovorder sans SKU (« ventes tous produits » v2) : le libellé de
      caisse donne le produit. Grammages du classeur Amorino ; null = glace dont
      le grammage reste à saisir. */
   /* Macarons et gianduiotto : hors du classeur des écarts (manager), jamais
      comptés, même avec un SKU ou un grammage retenu. */
   const HORS_ECART = /^(\d+ )?MAC\b|^MACARON|^COFFRET .*\bMAC\b|^GIANDUIOTTO/;
   const GRAMMAGES_NOMS = [
     [/CONE VIDE/, 0], [/MAC TRADITIONNEL/, 0],
     [HORS_ECART, 0],
     [/^POT ENFANT/, 81], [/^POT PETIT/, 133], [/^POT CLASSI/, 163], [/^POT GRAND/, 221],
     [/^POT GEANT/, 275], [/^POT (A )?PARTAG/, 529],
     [/^CHOCO ?CONE ENFANT/, 67], [/^CHOCO ?CONE PETIT/, 112], [/^CHOCO ?CONE CLASSI/, 149], [/^CHOCO ?CONE GRAND/, 208],
     [/^CORNET ENFANT/, 69], [/^CORNET PETIT/, 114], [/^CORNET CLASSI/, 153], [/^CORNET GRAND/, 224],
     [/^(BAC|COFFRET) .*\b550 ?ML\b/, 470], [/^(BAC|COFFRET) .*\b(1100 ?ML|1 1 ?L)\b/, 930],
     [/SHAKE|SORBET DRINK/, 160], [/^AFFOGATO/, 160], [/^ESPRESSO FRAPPE/, 200], [/^INCONTOURNABLE/, 80],
     [/^COUPE/, 160], [/^BRIOCHE .*X ?2\b/, 160], [/^BRIOCHE GLACE/, 100],
     /* « x2 glace », « 2 glaces » : 50 g par boule, comme le classeur. */
     [/\b(X ?1 GLACE|1 GLACE)\b/, 50], [/\bX? ?2 GLACES?\b/, 100], [/\bX? ?3 GLACES?\b/, 150],
     [/^EXTRA GLACE X ?2/, 100], [/^EXTRA GLACE/, 50],
     /* Gaufres et crêpes garnies : 1 boule (50 g) au catalogue. */
     [/^(GAUFRE|CREPE) (PARFAITE|DELICIEUSE|TRADITIONNELLE)/, 50],
     /* Crêpe gianduja : vendue avec une boule (liste du manager). */
     [/^CREPE GIANDUJA\b/, 50],
     /* Autres crêpes ou gaufres nature (sucre, chocolat…) : sans glace. */
     [/^(GAUFRE|CREPE)\b/, 0],
     [/GELATO|^BRIOCHE/, null]
   ];
   const nomCaisse = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
     .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
   /* undefined : pas de glace ; null : glace, grammage à saisir. Le grammage
      déjà saisi pour ce libellé (catalogue du calcul d'écart) passe devant. */
   function grammageNom(nom, retenus) {
     const n = nomCaisse(nom);
     if (retenus && num(retenus[n]) > 0) return num(retenus[n]);
     const r = GRAMMAGES_NOMS.filter(x => x[0].test(n))[0];
     return r ? r[1] : undefined;
   }
   
   /* XLSX n'est chargé qu'au premier import de caisse : exécuté à chaque
      démarrage, il retardait la liste des prénoms d'environ 600 ms sur iPad.
      Le service worker le garde en cache : le chargement marche hors ligne.
      Un seul chargement à la fois ; un échec permet un nouvel essai. */
   let _xlsx = null;
   function chargerXLSX() {
     if (typeof XLSX !== 'undefined') return Promise.resolve(true);
     if (!_xlsx) _xlsx = new Promise(resolve => {
       const s = document.createElement('script');
       s.src = 'vendor/xlsx.full.min.js';
       const echec = () => { _xlsx = null; s.remove(); resolve(false); };
       s.onload = () => (typeof XLSX !== 'undefined' ? resolve(true) : echec());
       s.onerror = echec;
       document.head.appendChild(s);
     });
     return _xlsx;
   }

   /* Ouvre l'export quel que soit son format. Avant, tout passait par XLSX.read
      en binaire : un CSV enregistré en UTF-8 y était lu en Latin-1 (« QtÃ© »,
      d'où « Aucune colonne de quantité »), ses décimales à virgule devenaient
      des centaines (« 1,25 » → 125), et une photo ou un PDF choisi par erreur
      finissait en « Aucune ligne de vente » au lieu de « fichier illisible ». */
   const IMPORT_ILLISIBLE = 'Fichier illisible : choisissez l’export des ventes de la caisse (.xlsx, .xls ou .csv).';
   function lireClasseur(o) {
     const illisible = () => Object.assign(new Error(IMPORT_ILLISIBLE), { illisible:true });
     const commencePar = (...sig) => sig.every((x, i) => o[i] === x);
     /* Vrais classeurs : .xlsx (zip) et .xls (OLE), lecture binaire comme avant. */
     if (commencePar(0x50, 0x4B, 0x03, 0x04) || commencePar(0xD0, 0xCF, 0x11, 0xE0))
       return XLSX.read(o, { type:'array' });
     if (!o.length || commencePar(0x25, 0x50, 0x44, 0x46)) throw illisible();          // vide, PDF
     /* Sinon du texte : CSV, ou tableau HTML que certaines caisses nomment .xls.
        UTF-8 d'abord, Windows-1252 (CSV d'Excel en français) à défaut.
        « Texte Unicode » d'Excel et de certaines caisses : UTF-16 annoncé par
        son BOM (FF FE, ou FE FF). Lu en Windows-1252, chaque caractère sortait
        suivi d'un caractère nul et le contrôle ci-dessous refusait le fichier,
        alors que l'ancienne lecture (XLSX.read) l'acceptait. */
     let texte;
     if (commencePar(0xFF, 0xFE) || commencePar(0xFE, 0xFF)) {
       try { texte = new TextDecoder(o[0] === 0xFF ? 'utf-16le' : 'utf-16be').decode(o); }
       catch (e) { throw illisible(); }
     } else {
       try { texte = new TextDecoder('utf-8', { fatal:true }).decode(o); }
       catch (e) {
         try { texte = new TextDecoder('windows-1252').decode(o); }
         catch (e2) { texte = Array.from(o, c => String.fromCharCode(c)).join(''); }
       }
     }
     texte = texte.replace(/^\ufeff/, '');
     const echantillon = texte.slice(0, 4000);
     const binaires = (echantillon.match(/[\u0000-\u0008\u000e-\u001f]/g) || []).length;
     if (binaires > echantillon.length / 100) throw illisible();                        // photo, archive…
     if (/^\s*</.test(texte)) return XLSX.read(texte, { type:'string', raw:true });
     /* Séparateur : la ligne « sep=; » d'Excel, sinon celui qui domine la
        première ligne ; point-virgule par défaut, pour ne pas couper « 12,5 ». */
     let sep = null;
     const m = /^sep=(.)\r?\n/i.exec(texte);
     if (m) { sep = m[1]; texte = texte.slice(m[0].length); }
     if (!sep) {
       const ligne = texte.split(/\r?\n/).filter(l => l.trim())[0] || '';
       const compte = c => ligne.split(c).length - 1;
       sep = [';', '\t', ','].reduce((a, c) => compte(c) > compte(a) ? c : a, ';');
     }
     /* raw : les cellules restent du texte, que num() lit à la française. */
     return XLSX.read(texte, { type:'string', raw:true, FS:sep });
   }

   /* retenus : grammages déjà saisis, par libellé de caisse (facultatif). */
   function lireExportCaisse(file, retenus) {
     return new Promise((resolve, reject) => {
       const fr = new FileReader();
   
       fr.onerror = () => reject(new Error(IMPORT_ILLISIBLE));
   
       fr.onload = ev => {
         let wb;
         try { wb = lireClasseur(new Uint8Array(ev.target.result)); }
         catch (e) { return reject(new Error(IMPORT_ILLISIBLE)); }
   
         const feuille = wb.Sheets[wb.SheetNames[0]];
         if (!feuille) return reject(new Error('Classeur vide'));
   
         /* --- Lecture 1 : une cellule « Total Kg » quelque part dans la feuille --- */
         const brut = XLSX.utils.sheet_to_json(feuille, { header:1, defval:'' });
         for (let i = 0; i < brut.length; i++) {
           for (let j = 0; j < brut[i].length; j++) {
             const cel = String(brut[i][j]).toLowerCase();
             if (!/total\s*(kg|poids)|poids\s*total/.test(cel)) continue;
             const voisins = [brut[i][j + 1], brut[i][j + 2], (brut[i + 1] || [])[j]];
             const v = voisins.map(num).filter(x => x > 0)[0];
             if (v) return resolve({ kg:v, lignes:1, methode:'Cellule « Total Kg » du fichier',
                                     fiable:true, detail:[['Total lu dans le fichier', n1(v) + ' kg']], inconnus:[] });
           }
         }
   
         /* --- Lecture 2 et 3 : par colonnes --- */
         const rows = XLSX.utils.sheet_to_json(feuille, { defval:'' });
         if (!rows.length) return reject(new Error('Aucune ligne de vente dans le fichier'));
   
         const cols = Object.keys(rows[0]);
         const trouve = re => cols.filter(c => re.test(c))[0];
         const cPoids = trouve(/poids|\bkg\b|masse/i);
         const cQte   = trouve(/qte|qté|quantit|nombre|nb\.?$/i);
         const cSku   = trouve(/\bsku\b|code|référence|reference|\bref\b/i);
         const cNom   = trouve(/produit|libell|désignation|designation|article|nom/i);
         /* Export Innovorder : « QteOption » compte les unités vendues en
            option d'un autre produit (macaron glacé d'une formule…). Pour un
            SKU de glace, elles sortent aussi de la vitrine. */
         const cOpt   = cols.filter(c => c !== cQte && /qt[eé]\s*option/i.test(c))[0];
   
         /* Colonne de poids : la plus sûre */
         if (cPoids) {
           let kg = 0, n = 0;
           rows.forEach(r => { const v = num(r[cPoids]); if (v > 0) { kg += v; n++; } });
           if (kg > 0) return resolve({ kg:kg, lignes:n, methode:'Colonne « ' + cPoids + ' »',
                                        fiable:true, detail:[[n + ' lignes additionnées', n1(kg) + ' kg']], inconnus:[] });
         }
   
         if (!cQte) {
           return reject(new Error('Aucune colonne de quantité trouvée. Colonnes lues : ' + cols.slice(0, 6).join(', ')));
         }
   
         /* Libellé de caisse (avec ou sans SKU) → chaque produit glacé, avec
            son grammage : celui déjà saisi, sinon celui du SKU, sinon celui du
            classeur. Une glace sans grammage connu (libellé ou catégorie
            glace) arrive vide, à compléter. */
         const cCat = trouve(/cat[eé]gorie|famille|rayon/i);
         if (cNom) {
           let g = 0, n = 0;
           const lignes = [], aSaisir = [];
           rows.forEach(r => {
             const nom = String(r[cNom]).trim();
             const q = num(r[cQte]) + (cOpt ? num(r[cOpt]) : 0);
             if (!nom || q <= 0) return;
             const sku = cSku ? String(r[cSku]).trim() : '';
             const n0 = nomCaisse(nom);
             if (HORS_ECART.test(n0)) return;
             let gr = (retenus && num(retenus[n0]) > 0) ? num(retenus[n0])
               : (sku && GRAMMAGES[sku] !== undefined) ? GRAMMAGES[sku] : grammageNom(nom);
             if (gr === undefined && cCat && /GELATO|GLAC|COUPE/.test(nomCaisse(r[cCat]))) gr = null;
             if (gr === undefined || gr === 0) return;
             lignes.push({ nom:nom, g:gr || '', q:q });
             if (gr === null) { aSaisir.push(nom + ' (' + q + ')'); return; }
             g += gr * q; n++;
           });
           if (lignes.length) {
             const top = lignes.filter(l => l.g).sort((a, b) => b.g * b.q - a.g * a.q).slice(0, 8)
               .map(l => [l.nom, n1(l.g * l.q / 1000) + ' kg']);
             return resolve({
               kg:g / 1000, lignes:n, fiable:true, detail:top, inconnus:aSaisir, produits:lignes,
               methode:cSku ? 'SKU et libellés × grammage du catalogue' : 'Libellés de caisse × grammage du classeur'
             });
           }
         }

         /* SKU + quantité × grammage (fichier sans libellés) */
         if (cSku) {
           let g = 0, n = 0;
           const inconnus = {}, parProduit = {};
           rows.forEach(r => {
             const sku = String(r[cSku]).trim();
             const q = num(r[cQte]) + (cOpt ? num(r[cOpt]) : 0);
             if (!sku || q <= 0) return;
             const gr = GRAMMAGES[sku];
             if (gr === undefined) { inconnus[sku] = (inconnus[sku] || 0) + q; return; }
             if (gr === 0) return;                       /* produit sans glace */
             g += gr * q; n++;
             const lib = cNom ? String(r[cNom]).trim() : sku;
             parProduit[lib] = (parProduit[lib] || 0) + gr * q / 1000;
           });
           if (g > 0) {
             const top = Object.keys(parProduit).sort((a, b) => parProduit[b] - parProduit[a]).slice(0, 8)
               .map(k => [k, n1(parProduit[k]) + ' kg']);
             return resolve({
               kg:g / 1000, lignes:n, methode:'SKU × grammage du catalogue', fiable:true,
               detail:top, inconnus:Object.keys(inconnus).map(s => s + ' (' + inconnus[s] + ')')
             });
           }
           if (Object.keys(inconnus).length) {
             return reject(new Error('Aucun SKU du fichier n’est rattaché à un grammage. Complétez le catalogue avant d’importer.'));
           }
         }
   
         /* Libellé + quantité, rapprochement par nom de parfum */
         if (cNom) {
           let g = 0, n = 0;
           const parProduit = {};
           rows.forEach(r => {
             const nom = String(r[cNom]).toLowerCase();
             const q = num(r[cQte]);
             if (!nom || q <= 0) return;
             const p = PARFUMS.filter(x => nom.indexOf(x.toLowerCase().split(' ')[0]) >= 0)[0];
             if (!p) return;
             const gr = 150;                             /* boule moyenne, à confirmer */
             g += gr * q; n++;
             parProduit[p] = (parProduit[p] || 0) + gr * q / 1000;
           });
           if (g > 0) {
             return resolve({
               kg:g / 1000, lignes:n, methode:'Rapprochement par nom de parfum, 150 g par unité',
               fiable:false,
               detail:Object.keys(parProduit).slice(0, 8).map(k => [k, n1(parProduit[k]) + ' kg']),
               inconnus:[]
             });
           }
         }
   
         reject(new Error('Format non reconnu. Il faut une colonne de poids, ou des SKU, ou des noms de parfums avec les quantités.'));
       };
   
       fr.readAsArrayBuffer(file);
     });
   }
   
   function confirmerImport(per, fichier, r) {
     showSheet(
       '<h2 id="sheet-titre">Ventes lues dans le fichier</h2>' +
       '<p class="sub">' + esc(fichier) + ' · ' + esc(r.methode) + '</p>' +
   
       (r.fiable ? '' :
         '<div class="alerte warn"><span class="ai">●</span><div><b>Lecture approximative</b>' +
         '<p>Le fichier n’a ni colonne de poids ni SKU reconnus. Le calcul repose sur une moyenne de 150 g par unité : ' +
         'l’écart qui en découlera sera indicatif, pas exploitable pour trancher.</p></div></div>') +
   
       '<div class="grid g2" style="margin:14px 0">' +
       kpi('Poids vendu', n1(r.kg) + '<span class="u">kg</span>', r.fiable ? 'ok' : 'warn', r.lignes + ' ligne(s)') +
       kpi('Valeur', eur(r.kg * FOURNISSEUR.prixMoyenKg), '', 'à ' + eur(FOURNISSEUR.prixMoyenKg) + '/kg') + '</div>' +
   
       (r.detail.length
         ? '<div class="dense"><div class="dense-h"><span class="c1">Détail</span><span class="c w">Poids</span></div>' +
           '<div class="dense-scroll">' + r.detail.map(d =>
             '<div class="dl"><span class="c1">' + esc(d[0]) + '</span>' +
             '<span class="c w num">' + esc(d[1]) + '</span></div>').join('') + '</div></div>'
         : '') +
   
       (r.inconnus.length
         ? '<div class="alerte warn" style="margin-top:14px"><span class="ai">•</span>' +
           '<div><b>' + r.inconnus.length + ' produit(s) sans grammage</b><p>' +
           esc(r.inconnus.slice(0, 8).join(', ')) + (r.inconnus.length > 8 ? '…' : '') +
           '. Leur glace n’est pas comptée dans les ventes, donc elle apparaîtra comme un manque.</p></div></div>'
         : '') +
   
       '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
       '<button class="btn menthe" id="imp-ok">Enregistrer ' + n1(r.kg) + ' kg</button></div>');
   
     $('#imp-ok').onclick = async () => {
       /* Écriture partielle : seules les ventes et la ligne d'import partent,
          appliquées sur la copie du serveur (voir DB.patch). */
       await DB.patch('ecart:' + per.id,
         { ventes:{ total:+n2(r.kg) }, venteSource:r.methode + (r.fiable ? '' : ' · approximatif') },
         { imports:[{
           id:uid(), fichier:fichier, kg:+n2(r.kg), lignes:r.lignes, methode:r.methode,
           fiable:r.fiable, inconnus:r.inconnus.length, par:STATE.user.prenom, at:nowISO()
         }] });
       await feed('ok', STATE.user.prenom + ' a importé les ventes : ' + n1(r.kg) + ' kg (' + r.lignes + ' lignes)');
       closeSheet();
       toast(n1(r.kg) + ' kg enregistrés');
       rendre('ecarts');
     };
   }