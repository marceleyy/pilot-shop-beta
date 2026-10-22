/* =============================================================================
   PILOT-SHOP — vitrine.js
   Page d'accueil publique : ce que voit un visiteur qui ouvre l'adresse sur un
   appareil neuf. Deux portes : « Se connecter » (boutique cliente) et
   « Demander un essai » (prospect).

   Chargé dans <head>, SANS defer : la décision est prise avant le premier
   affichage, sans éclair de l'écran des prénoms. Un appareil déjà utilisé
   (rattaché, équipe gardée, ou vitrine déjà passée) ne la voit jamais : il
   arrive directement sur les prénoms, réseau ou pas.

   L'inscription Supabase est fermée : la demande d'essai ne crée aucun compte,
   elle prépare un e-mail que le visiteur envoie lui-même.
   ============================================================================= */

'use strict';

const VITRINE = {
  /* Adresse publique déjà affichée sur le site de l'entreprise. */
  contact: 'marcele.monpole@gmail.com',
  /* Clés qui prouvent que l'appareil sert déjà en boutique. */
  cles: ['pilotshop.v3:auth', 'pilotshop.v3:boutique-rattachee', 'pilotshop.v3:equipe',
         'pilotshop.v3:session', 'pilotshop.v3:pilotshop.queue']
};

/* Appareil neuf ? Stockage illisible (navigation privée stricte) : on montre
   la vitrine, « Se connecter » mène de toute façon au rattachement. */
function vitrineAMontrer() {
  if (/[?&]reset\b/.test(location.search)) return false;
  try {
    return !VITRINE.cles.some(k => localStorage.getItem(k));
  } catch (e) { return true; }
}

(function () {
  if (vitrineAMontrer()) document.documentElement.classList.add('vitrine');
})();

/* app.js attend cette promesse avant le rattachement : rien ne s'affiche
   par-dessus la vitrine tant que le visiteur n'a pas choisi « Se connecter ». */
function attendreVitrine() {
  if (!document.documentElement.classList.contains('vitrine')) return Promise.resolve();
  return new Promise(resolve => {
    const v = document.getElementById('vitrine');
    if (!v) { document.documentElement.classList.remove('vitrine'); return resolve(); }

    /* Rien n'est retenu ici : tant que l'appareil n'est pas rattaché, la
       vitrine revient au prochain chargement. Un prospect curieux qui tombe
       sur le rattachement sans identifiants peut toujours demander un essai. */
    const entrer = () => {
      /* Une entrée d'historique : le bouton retour du navigateur ramène à
         la présentation au lieu de quitter le site (voir plus bas). */
      try { history.pushState({ vitrine: 'connexion' }, '', location.pathname + location.search); } catch (e) {}
      document.documentElement.classList.remove('vitrine');
      resolve();
    };
    v.querySelectorAll('[data-vitrine="connexion"]').forEach(b => { b.onclick = entrer; });

    /* Liens internes sans changer l'adresse : un « #ancre » resterait dans
       l'historique de l'application après la connexion. */
    const aller = id => {
      const c = v.querySelector('#' + id);
      const doux = !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
      if (c) c.scrollIntoView({ behavior: doux ? 'smooth' : 'auto', block: 'start' });
      return c;
    };
    v.querySelectorAll('[data-aller]').forEach(b => { b.onclick = () => aller(b.dataset.aller); });
    v.querySelectorAll('[data-vitrine="essai"]').forEach(b => {
      b.onclick = () => {
        const essai = aller('vt-essai');
        const p = essai && essai.querySelector('input');
        if (p) setTimeout(() => p.focus({ preventScroll: true }), 500);
      };
    });

    const lien = v.querySelector('#vt-mail');
    if (lien) { lien.href = 'mailto:' + VITRINE.contact; lien.textContent = VITRINE.contact; }

    const form = v.querySelector('#vt-form');
    const etat = v.querySelector('#vt-etat');
    form.onsubmit = ev => {
      ev.preventDefault();
      const val = id => (form.querySelector(id).value || '').trim();
      const nom = val('#vt-nom'), boutique = val('#vt-boutique'), ville = val('#vt-ville');
      const mail = val('#vt-courriel'), tel = val('#vt-tel'), msg = val('#vt-msg');
      if (!nom || !boutique || (!mail && !tel)) {
        etat.textContent = 'Indiquez votre nom, votre boutique et un e-mail ou un téléphone.';
        return;
      }
      const corps = [
        'Bonjour,', '',
        'Je souhaite essayer Pilot-Shop gratuitement pendant 2 mois.', '',
        'Nom : ' + nom,
        'Boutique : ' + boutique + (ville ? ' (' + ville + ')' : ''),
        mail ? 'E-mail : ' + mail : null,
        tel ? 'Téléphone : ' + tel : null,
        msg ? '\n' + msg : null
      ].filter(l => l !== null).join('\n');
      const url = 'mailto:' + VITRINE.contact +
        '?subject=' + encodeURIComponent('Demande d’essai Pilot-Shop : ' + boutique) +
        '&body=' + encodeURIComponent(corps);
      etat.textContent = 'Votre messagerie s’ouvre avec la demande prête : il reste à l’envoyer. ' +
        'Rien ne s’ouvre ? Écrivez à ' + VITRINE.contact + '.';
      location.href = url;
    };
  });
}

/* Retour depuis la connexion. Tant que l'appareil n'est ni rattaché ni
   utilisé, on recharge : la vitrine revient, et l'écran de rattachement
   ouvert (et le démarrage qui l'attend) repart de zéro. Une fois l'appareil
   rattaché, ce retour ne concerne plus la vitrine : app.js gère l'historique. */
function revenirVitrine() {
  if (history.state && history.state.vitrine === 'connexion') { history.back(); return; }
  location.reload();
}
window.addEventListener('popstate', function () {
  if (typeof STATE !== 'undefined' && STATE && STATE.user) return;
  if (document.documentElement.classList.contains('vitrine')) return;
  if (!document.getElementById('vitrine') || !vitrineAMontrer()) return;
  location.reload();
});
