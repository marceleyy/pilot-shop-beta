/* =============================================================================
   PILOT-SHOP — rgpd.js
   « Vos données » : la note d'information des salariés (article 13 du RGPD),
   lisible par tous dans l'application.

   Le texte reprend le modèle du dossier RGPD. Les mentions propres à la
   boutique (raison sociale, adresse, contact du gérant, durées) sont saisies
   par un manager sur cet écran et rangées sous « rgpd:notice ». Tant qu'elles
   manquent, l'écran le dit au lieu d'inventer.

   Chargé après app.js (carte, entete, esc, showSheet, DB, rendre).
   ============================================================================= */

'use strict';

PAGES.donnees = { titre:'Vos données', sous:'Ce que l’application enregistre sur vous' };
if (MENU_PLUS.equipe.indexOf('donnees') < 0) MENU_PLUS.equipe.push('donnees');
if (MENU_PLUS.manager.indexOf('donnees') < 0) MENU_PLUS.manager.push('donnees');

const RGPD = {
  cle: 'rgpd:notice',
  /* Durées appliquées par la purge automatique (supabase-conservation.sql). */
  defaut: { responsable:'', adresse:'', contact:'',
            dureeHeures:'3 ans', dureeJournal:'1 an', dureeHaccp:'' },
  champs: [
    ['responsable',  'Raison sociale de la boutique', 'Ex. SAS Glaces du Mont-Blanc'],
    ['adresse',      'Adresse',                       'Ex. 12 rue Paccard, 74400 Chamonix'],
    ['contact',      'Contact pour exercer ses droits', 'Ex. Justin, 06 00 00 00 00'],
    ['dureeHeures',  'Conservation des heures de service', 'Ex. 3 ans'],
    ['dureeJournal', 'Conservation du journal, des photos et des messages', 'Ex. 1 an'],
    ['dureeHaccp',   'Conservation des registres d’hygiène', 'Ex. 3 ans, selon le plan HACCP']
  ]
};

async function lireNoticeRgpd() {
  const n = await DB.get(RGPD.cle, null).catch(() => null);
  return Object.assign({}, RGPD.defaut, (n && typeof n === 'object') ? n : {});
}

const rgpdManque = n => ['responsable', 'adresse', 'contact', 'dureeHaccp'].filter(k => !String(n[k] || '').trim());

V.donnees = async function () {
  const n = await lireNoticeRgpd();
  if (STATE.view !== 'donnees') return;
  const manager = STATE.user.role === 'manager';
  const manque = rgpdManque(n);
  const val = k => String(n[k] || '').trim()
    ? esc(n[k]) : '<i>[à compléter par le gérant]</i>';
  const bloc = (titre, html) => carte('<h3 style="margin:0 0 8px">' + esc(titre) + '</h3>' + html, 'plat');
  const liste = items => '<ul style="margin:0;padding-left:20px">' + items.map(x => '<li>' + x + '</li>').join('') + '</ul>';

  $('#vue-actions').innerHTML = manager
    ? '<button class="btn clair sm" id="rgpd-modif">Compléter</button>' : '';

  $('#page').innerHTML =
    (manager && manque.length
      ? '<div class="alerte warn"><span class="ai">!</span><div><b>Notice à compléter</b>' +
        '<p>Il manque ' + manque.length + ' ' + accord(manque.length, 'mention') + ' propres à la boutique. ' +
        'L’équipe voit « à compléter par le gérant » à leur place.</p></div></div>'
      : '') +
    '<div class="stack">' +
    bloc('Qui traite vos données ?',
      '<p>' + val('responsable') + ', ' + val('adresse') + ', est responsable du traitement. ' +
      'L’application Pilot-Shop est fournie et hébergée par Marcel Sanda Mompole, pour le compte de la boutique.</p>') +
    bloc('Quelles données ?', liste([
      'votre prénom, votre rôle et votre code d’accès à 4 chiffres' +
        (PIN_HACHAGE ? ' (enregistré sous une forme illisible)' : ''),
      'vos heures de début et de fin de service (pointeuse)',
      'votre prénom sur les relevés que vous validez (températures, nettoyage, réceptions, pertes, caisse)',
      'les messages et signalements que vous écrivez',
      'les photos de preuve de nettoyage',
      'pour les managers qui activent les alertes : le prénom et l’adresse technique d’envoi du téléphone'
    ])) +
    bloc('Pourquoi ?', liste([
      'tenir les registres d’hygiène exigés par la réglementation sanitaire (obligation légale)',
      'décompter le temps de travail (obligation légale, article L3171-2 du Code du travail)',
      'organiser le travail de la boutique (intérêt légitime de l’employeur)'
    ]) +
      '<p class="mini" style="margin-top:8px">L’écran « Équipe » affiche le nombre de relevés validés par personne. ' +
      'Ce compteur sert à répartir les tâches. Il ne mesure pas la qualité du travail et ne sert pas, seul, ' +
      'à une évaluation ou à une sanction.</p>') +
    bloc('Qui y a accès ?',
      '<p>Les managers de la boutique, et le prestataire pour la maintenance. Les données sont hébergées par ' +
      'Supabase (base de données) et Vercel (application). Si vous utilisez la dictée vocale, votre voix est ' +
      'transcrite par le service du fabricant de l’appareil (Apple ou Google).</p>') +
    bloc('Combien de temps ?', liste([
      'heures de service : ' + val('dureeHeures'),
      'journal d’activité, photos, messages : ' + val('dureeJournal'),
      'registres d’hygiène : ' + val('dureeHaccp')
    ])) +
    bloc('Vos droits',
      '<p>Vous pouvez demander l’accès à vos données, leur rectification, leur effacement quand rien n’oblige ' +
      'à les garder, ou vous opposer au traitement fondé sur l’intérêt légitime. Adressez-vous à ' + val('contact') +
      '. Vous pouvez aussi saisir la CNIL (cnil.fr).</p>') +
    bloc('Bons réflexes', liste([
      'pas d’information de santé ni d’avis sur un collègue dans les messages',
      'photographiez l’équipement, pas les personnes',
      'ne réutilisez pas le code de votre carte bancaire'
    ])) +
    '</div>';

  const b = $('#rgpd-modif');
  if (b) b.onclick = () => rgpdFormulaire(n);
};

function rgpdFormulaire(n) {
  showSheet(
    '<h2 id="sheet-titre">Compléter la notice</h2>' +
    '<p class="sub">Ces mentions s’affichent à toute l’équipe dans « Vos données ».</p>' +
    RGPD.champs.map(c =>
      '<div class="champ" style="margin-top:12px"><label class="f" for="rgpd-' + c[0] + '">' + esc(c[1]) + '</label>' +
      '<input type="text" id="rgpd-' + c[0] + '" maxlength="160" value="' + esc(n[c[0]] || '') +
      '" placeholder="' + esc(c[2]) + '"></div>').join('') +
    '<div class="actions"><button class="btn clair" data-fermer>Annuler</button>' +
    '<button class="btn menthe" id="rgpd-ok">Enregistrer</button></div>');
  $('#rgpd-ok').onclick = async () => {
    const out = {};
    RGPD.champs.forEach(c => { out[c[0]] = String($('#rgpd-' + c[0]).value || '').trim().slice(0, 160); });
    out.majPar = STATE.user.prenom; out.majAt = nowISO();
    await DB.set(RGPD.cle, out);
    closeSheet();
    toast('Notice enregistrée');
    rendre('donnees');
  };
}
