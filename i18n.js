/* =============================================================================
   PILOT-SHOP — i18n.js
   Interface en anglais pour l'équipe (saisonniers qui ne lisent pas le
   français).

   Le code écrit ses textes en français, en dur. Plutôt que de les reprendre
   un par un dans 20 000 lignes, on traduit ce qui s'affiche : un observateur
   remplace chaque texte connu par sa traduction (TRAD_EN, mot pour mot, puis
   TRAD_EN_MOTIFS pour les textes qui contiennent un nombre ou un prénom).
   Un texte absent du dictionnaire reste en français : rien ne casse.

   Portée : écran de connexion, écrans et fenêtres de l'équipe. Les écrans
   réservés au manager restent en français. Les noms de parfums et de
   produits Amorino ne se traduisent pas.

   Choix de la langue : par personne (menu « Tout le reste »), et pour
   l'écran de connexion de l'appareil. Revenir au français recharge la page.

   Chargé en dernier.
   ============================================================================= */

'use strict';

const LANGUE = {
  appareil: OFFLINE.storeLocal + ':langue',
  personne: id => OFFLINE.storeLocal + ':langue:' + id
};

function langueActive() {
  const lire = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  /* Sans choix personnel, la personne garde la langue choisie à la connexion. */
  const perso = STATE.user && STATE.user.id ? lire(LANGUE.personne(STATE.user.id)) : null;
  return perso || lire(LANGUE.appareil) || 'fr';
}

/* -----------------------------------------------------------------------------
   TRADUCTION D'UN TEXTE
   -------------------------------------------------------------------------- */
const _trCache = new Map();
function traduireEn(s) {
  const brut = String(s);
  const t = brut.replace(/\s+/g, ' ').trim();
  if (!t || !/[A-Za-zÀ-ÿ]/.test(t)) return null;
  if (_trCache.has(t)) {
    const c = _trCache.get(t);
    return c === null ? null : remettreBlancs(brut, c);
  }
  let r = Object.prototype.hasOwnProperty.call(TRAD_EN, t) ? TRAD_EN[t] : null;
  if (r === null) {
    for (const m of TRAD_EN_MOTIFS) {
      const x = t.match(m[0]);
      if (x) { r = typeof m[1] === 'function' ? m[1].apply(null, x) : t.replace(m[0], m[1]); break; }
    }
  }
  if (_trCache.size > 5000) _trCache.clear();
  _trCache.set(t, r);
  return r === null ? null : remettreBlancs(brut, r);
}
/* Garde les espaces de début et de fin du texte d'origine (« Adressez-vous à »). */
function remettreBlancs(brut, r) {
  const av = (brut.match(/^\s*/) || [''])[0], ap = (brut.match(/\s*$/) || [''])[0];
  return av + r + ap;
}

/* Dates et jours : « Jeudi 22 octobre 2026 », « 22 octobre 2026 ». */
const _JOURS_EN = { lundi:'Monday', mardi:'Tuesday', mercredi:'Wednesday', jeudi:'Thursday',
  vendredi:'Friday', samedi:'Saturday', dimanche:'Sunday' };
const _MOIS_EN = { janvier:'January', 'février':'February', mars:'March', avril:'April', mai:'May',
  juin:'June', juillet:'July', 'août':'August', septembre:'September', octobre:'October',
  novembre:'November', 'décembre':'December' };
function dateEn(s) {
  return String(s)
    .replace(/\b(\d{1,2}) (janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre) (\d{4})/gi,
      (_, j, m, a) => _MOIS_EN[m.toLowerCase()] + ' ' + j + ', ' + a)
    .replace(/\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/gi, j => _JOURS_EN[j.toLowerCase()]);
}

/* -----------------------------------------------------------------------------
   APPLICATION AU DOCUMENT
   -------------------------------------------------------------------------- */
const I18N_ATTRS = ['placeholder', 'aria-label', 'title'];
let _i18nObs = null, _i18nActif = false;

function i18nIgnore(el) {
  /* Une option sans « value » rend son texte : le traduire changerait la valeur lue. */
  if (el && el.tagName === 'OPTION' && !el.hasAttribute('value')) return true;
  return !el || el.closest('script,style,textarea,[contenteditable],[data-i18n-non]') ||
    (el.closest('#page, #vue-actions, #vue-titre, #vue-sous, #sheet') && document.body.dataset.vueFr === '1');
}
function traduireNoeud(racine) {
  if (!racine) return;
  if (racine.nodeType === 3) {
    if (i18nIgnore(racine.parentElement)) return;
    const r = traduireEn(racine.nodeValue);
    if (r !== null && r !== racine.nodeValue) racine.nodeValue = r;
    return;
  }
  if (racine.nodeType !== 1) return;
  const w = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) {
    if (i18nIgnore(n.parentElement)) continue;
    const r = traduireEn(n.nodeValue);
    if (r !== null && r !== n.nodeValue) n.nodeValue = r;
  }
  const els = [racine].concat(Array.prototype.slice.call(racine.querySelectorAll('[placeholder],[aria-label],[title]')));
  els.forEach(el => {
    /* Le texte saisi d'un champ ne se traduit pas, mais son exemple (placeholder) oui. */
    if (!el.getAttribute || (!/^(TEXTAREA|INPUT)$/.test(el.tagName) && i18nIgnore(el))) return;
    if (/^(TEXTAREA|INPUT)$/.test(el.tagName) && el.parentElement && i18nIgnore(el.parentElement)) return;
    I18N_ATTRS.forEach(a => {
      const v = el.getAttribute(a);
      if (!v) return;
      const r = traduireEn(v);
      if (r !== null && r !== v) el.setAttribute(a, r);
    });
  });
}

/* Les écrans du manager restent en français (voir en-tête). */
function vueEnFrancais() {
  const v = STATE.view;
  if (!v || !STATE.user || STATE.user.role !== 'manager') return false;
  const equipe = (TABS.equipe || []).map(t => t.id).concat(MENU_PLUS.equipe || [], ['stock', 'reception', 'inventaire']);
  return equipe.indexOf(v) < 0;
}

function i18nAppliquer() {
  const en = langueActive() === 'en';
  if (en === _i18nActif) { if (en) majVueFr(); return; }
  if (!en) { location.reload(); return; }   // revenir au français : on recharge
  _i18nActif = true;
  document.documentElement.lang = 'en';
  /* Le bouton de connexion annonçait « English » : il propose maintenant le français. */
  const bc = document.getElementById('langue-connexion');
  if (bc) { bc.textContent = 'Français'; bc.setAttribute('lang', 'fr'); }
  majVueFr();
  traduireNoeud(document.body);
  _i18nObs = new MutationObserver(muts => {
    majVueFr();
    for (const m of muts) {
      if (m.type === 'characterData') traduireNoeud(m.target);
      else if (m.type === 'attributes') traduireNoeud(m.target);
      else m.addedNodes.forEach(traduireNoeud);
    }
    /* Nos propres remplacements ne doivent pas relancer un tour. */
    _i18nObs.takeRecords();
  });
  _i18nObs.observe(document.body, { childList:true, subtree:true, characterData:true,
                                    attributes:true, attributeFilter:I18N_ATTRS });
}
function majVueFr() { document.body.dataset.vueFr = vueEnFrancais() ? '1' : '0'; }

function changerLangue(l) {
  try {
    if (STATE.user && STATE.user.id) localStorage.setItem(LANGUE.personne(STATE.user.id), l);
    else localStorage.setItem(LANGUE.appareil, l);
  } catch (e) {}
  i18nAppliquer();
}

/* Bouton de langue : écran de connexion et menu « Tout le reste ». */
function boutonLangue(id, cls) {
  const en = langueActive() === 'en';
  return '<button type="button" class="' + (cls || 'menu-item') + '" id="' + id + '" data-i18n-non lang="' + (en ? 'fr' : 'en') + '">' +
    (cls ? (en ? 'Français' : 'English') :
      '<span class="mi-tx"><span class="mi-t">' + (en ? 'Français' : 'English') + '</span>' +
      '<span class="mi-s">' + (en ? 'Passer l’application en français' : 'Switch the app to English') + '</span></span>' +
      '<span class="mi-fl">›</span>') + '</button>';
}
function brancherBoutonLangue(id) {
  const b = document.getElementById(id);
  if (b && !b._branche) {
    b._branche = true;
    b.onclick = () => {
      if (typeof closeSheet === 'function' && !$('#sheet').hidden) closeSheet();
      changerLangue(langueActive() === 'en' ? 'fr' : 'en');
    };
  }
}

/* Menu « Tout le reste » : la langue s'ajoute juste avant « Déconnexion ». */
const _ouvrirPlusFr = ouvrirPlus;
ouvrirPlus = function () {
  _ouvrirPlusFr();
  const stack = $('#sheet-corps .stack');
  if (stack && !document.getElementById('langue-menu')) {
    stack.insertAdjacentHTML('beforeend', boutonLangue('langue-menu'));
    brancherBoutonLangue('langue-menu');
  }
};

/* Écran de connexion : un petit bouton à côté de « Réinitialiser cet appareil ». */
function langueSurConnexion() {
  const reset = document.getElementById('lg-reset');
  if (!reset || document.getElementById('langue-connexion')) return;
  reset.insertAdjacentHTML('afterend', boutonLangue('langue-connexion', 'lien'));
  brancherBoutonLangue('langue-connexion');
}

/* La personne change (connexion, déconnexion) : on vérifie la langue. */
let _i18nUser = null;
setInterval(() => {
  const u = STATE.user ? STATE.user.id : null;
  if (u !== _i18nUser) { _i18nUser = u; i18nAppliquer(); }
  langueSurConnexion();
}, 400);
document.addEventListener('DOMContentLoaded', () => { langueSurConnexion(); i18nAppliquer(); });
