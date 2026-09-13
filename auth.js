/* =============================================================================
   PILOT-SHOP — auth.js
   Authentification de l'APPAREIL, pas de la personne.

   Le raisonnement, en une phrase : un code à quatre chiffres vérifié dans le
   navigateur ne peut pas être un secret — 10 000 combinaisons, et le code qui
   le vérifie est lisible. Vouloir en faire une barrière est une illusion.

   On déplace donc la barrière là où elle tient : l'iPad se connecte UNE FOIS
   au compte de la boutique, et garde sa session. Sans cette session, la base
   ne répond rien — ni lecture, ni écriture. Le code PIN redevient ce qu'il a
   toujours été en pratique : « qui saisit », pas « qui a le droit ».

   Chargé AVANT app.js.
   ============================================================================= */

'use strict';

const AUTH = {
  cle: 'pilotshop.v3:auth',
  /* On renouvelle le jeton bien avant son expiration : un équipier ne doit
     jamais tomber sur un refus au milieu d'un relevé. */
  margeRenouvellementSec: 300
};

let _session = null;      // { access_token, refresh_token, expires_at, site }

/* --- Mémoire locale ------------------------------------------------------- */
function chargerSession() {
  try {
    const brut = localStorage.getItem(AUTH.cle);
    _session = brut ? JSON.parse(brut) : null;
  } catch (e) { _session = null; }
  return _session;
}
function enregistrerSession(s) {
  _session = s;
  try {
    if (s) localStorage.setItem(AUTH.cle, JSON.stringify(s));
    else localStorage.removeItem(AUTH.cle);
  } catch (e) { /* mode privé : on garde en mémoire seulement */ }
}

/* --- Appels d'authentification -------------------------------------------- */
async function appelAuth(chemin, corps) {
  const r = await fetch(SUPABASE.url + '/auth/v1' + chemin, {
    method: 'POST',
    headers: { 'apikey': SUPABASE.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(corps)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(d.error_description || d.msg || d.message || ('HTTP ' + r.status));
    e.statut = r.status;
    throw e;
  }
  return d;
}

function memoriser(d) {
  const meta = (d.user && (d.user.user_metadata || d.user.app_metadata)) || {};
  enregistrerSession({
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: Date.now() + ((d.expires_in || 3600) * 1000),
    site: meta.site || APP.site,
    compte: d.user ? d.user.email : null
  });
  return _session;
}

/* Rattachement initial de l'appareil : une seule fois, à l'installation. */
async function rattacherAppareil(email, motDePasse) {
  const d = await appelAuth('/token?grant_type=password',
                            { email: email, password: motDePasse });
  return memoriser(d);
}

async function renouveler() {
  if (!_session || !_session.refresh_token) return null;
  try {
    const d = await appelAuth('/token?grant_type=refresh_token',
                              { refresh_token: _session.refresh_token });
    return memoriser(d);
  } catch (e) {
    /* Jeton révoqué ou compte supprimé : l'appareil doit être rattaché à
       nouveau. On ne détruit rien d'autre — les saisies locales restent. */
    if (e.statut === 400 || e.statut === 401) enregistrerSession(null);
    return null;
  }
}

/* Jeton valide, renouvelé si besoin. Renvoie null si l'appareil n'est pas
   rattaché : les appels réseau sont alors simplement mis en file d'attente. */
let _renouvellementEnCours = null;
async function jetonValide() {
  if (!_session) chargerSession();
  if (!_session) return null;
  const reste = _session.expires_at - Date.now();
  if (reste > AUTH.margeRenouvellementSec * 1000) return _session.access_token;
  /* Un seul renouvellement à la fois, même si dix appels partent ensemble. */
  if (!_renouvellementEnCours) {
    _renouvellementEnCours = renouveler().finally(() => { _renouvellementEnCours = null; });
  }
  const s = await _renouvellementEnCours;
  return s ? s.access_token : null;
}

function appareilRattache() { return !!(_session || chargerSession()); }
function siteRattache() { return _session ? _session.site : null; }

/* -----------------------------------------------------------------------------
   ÉCRAN DE RATTACHEMENT
   S'affiche avant l'écran des prénoms, une seule fois dans la vie de l'appareil.
   -------------------------------------------------------------------------- */
function ecranRattachement() {
  return new Promise(resolve => {
    const d = document.createElement('div');
    d.id = 'rattach';
    d.innerHTML =
      '<div class="in">' +
      '<div class="lg"><h1>Pilot-Shop</h1><p>Premier démarrage</p></div>' +
      '<div class="card solide">' +
      '<h2>Rattacher cet appareil</h2>' +
      '<div class="cs">À faire une seule fois. Ensuite, l’équipe se connecte ' +
      'simplement avec son prénom et son code.</div>' +
      '<div class="champ" style="margin-top:16px"><label class="f">Compte de la boutique</label>' +
      '<input type="email" id="rt-mail" autocapitalize="none" autocomplete="username" ' +
      'spellcheck="false" placeholder="paccard@pilot-shop.local"></div>' +
      '<div class="champ" style="margin-top:14px"><label class="f">Mot de passe</label>' +
      '<input type="password" id="rt-mdp" autocomplete="current-password"></div>' +
      '<button class="btn menthe bloc xl" id="rt-ok" style="margin-top:18px">Rattacher</button>' +
      '<p class="mini" id="rt-etat" style="text-align:center;margin-top:14px"></p>' +
      '</div>' +
      '<p class="mini" style="text-align:center;margin-top:18px">Ces identifiants ' +
      'sont ceux de la boutique, pas les vôtres. Demandez-les à votre manager.</p>' +
      '</div>';
    document.body.appendChild(d);

    const etat = m => { const e = d.querySelector('#rt-etat'); if (e) e.textContent = m; };
    const bouton = d.querySelector('#rt-ok');

    bouton.onclick = async () => {
      const mail = d.querySelector('#rt-mail').value.trim();
      const mdp = d.querySelector('#rt-mdp').value;
      if (!mail || !mdp) return etat('Renseignez les deux champs.');
      bouton.disabled = true;
      etat('Connexion…');
      try {
        await rattacherAppareil(mail, mdp);
        etat('Rattaché. Chargement de l’équipe…');
        /* On charge l'équipe AVANT de retirer l'écran : sinon la liste des
           prénoms apparaît vide le temps de l'aller-retour. */
        if (typeof chargerEquipe === 'function') await chargerEquipe();
        if (typeof initLogin === 'function') initLogin();
        d.remove();
        resolve(true);
      } catch (e) {
        bouton.disabled = false;
        etat(e.statut === 400 ? 'Identifiants refusés.'
           : 'Échec : ' + e.message + '. Vérifiez la connexion.');
      }
    };
  });
}
