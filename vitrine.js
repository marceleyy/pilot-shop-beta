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
  cles: ['pilotshop.v3:auth', 'pilotshop.v3:boutique-rattachee', 'pilotshop.v3:equipe'],
  passee: 'pilotshop.v3:vitrine-passee'
};

/* Appareil neuf ? Stockage illisible (navigation privée stricte) : on montre
   la vitrine, « Se connecter » mène de toute façon au rattachement. */
function vitrineAMontrer() {
  if (/[?&]reset\b/.test(location.search)) return false;
  try {
    if (localStorage.getItem(VITRINE.passee)) return false;
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

    const entrer = () => {
      try { localStorage.setItem(VITRINE.passee, '1'); } catch (e) {}
      document.documentElement.classList.remove('vitrine');
      resolve();
    };
    v.querySelectorAll('[data-vitrine="connexion"]').forEach(b => { b.onclick = entrer; });

    const essai = v.querySelector('#vt-essai');
    v.querySelectorAll('[data-vitrine="essai"]').forEach(b => {
      b.onclick = () => {
        essai.hidden = false;
        essai.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const p = essai.querySelector('input');
        if (p) setTimeout(() => p.focus({ preventScroll: true }), 350);
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
        mail ? 'E-mail : ' + mail : '',
        tel ? 'Téléphone : ' + tel : '',
        msg ? '\n' + msg : ''
      ].filter(l => l !== '').join('\n');
      const url = 'mailto:' + VITRINE.contact +
        '?subject=' + encodeURIComponent('Demande d’essai Pilot-Shop : ' + boutique) +
        '&body=' + encodeURIComponent(corps);
      etat.textContent = 'Votre messagerie s’ouvre avec la demande prête : il reste à l’envoyer. ' +
        'Rien ne s’ouvre ? Écrivez à ' + VITRINE.contact + '.';
      location.href = url;
    };
  });
}
