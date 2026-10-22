/* =============================================================================
   Envoi Web Push sans dépendance (RFC 8291 aes128gcm + RFC 8292 VAPID).
   Uniquement fetch et crypto.subtle : tourne dans Deno (Supabase) comme
   dans Node 20+, où il est vérifié contre la bibliothèque web-push.
   ============================================================================= */

const enc = new TextEncoder();

export function b64urlVersOctets(s) {
  const b = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '==='.slice((b.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function octetsVersB64url(o) {
  let s = '';
  const u = new Uint8Array(o);
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const concat = (...l) => {
  const n = l.reduce((s, x) => s + x.length, 0), out = new Uint8Array(n);
  let i = 0; l.forEach(x => { out.set(x, i); i += x.length; });
  return out;
};
async function hkdf(sel, ikm, info, octets) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name:'HKDF', hash:'SHA-256', salt:sel, info:info }, k, octets * 8));
}

/* Chiffre le message pour un abonnement { endpoint, keys:{ p256dh, auth } }. */
export async function chiffrer(abonnement, message, sel) {
  const uaPublic = b64urlVersOctets(abonnement.keys.p256dh);
  const auth = b64urlVersOctets(abonnement.keys.auth);
  const ephem = await crypto.subtle.generateKey({ name:'ECDH', namedCurve:'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephem.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name:'ECDH', namedCurve:'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name:'ECDH', public:uaKey }, ephem.privateKey, 256));

  const ikm = await hkdf(auth, secret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  sel = sel || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(sel, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(sel, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const clair = concat(enc.encode(message), new Uint8Array([2]));   // 2 : dernier enregistrement
  const cle = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const chiffre = new Uint8Array(await crypto.subtle.encrypt({ name:'AES-GCM', iv:nonce }, cle, clair));

  const entete = new Uint8Array(21);
  entete.set(sel, 0);
  new DataView(entete.buffer).setUint32(16, 4096);
  entete[20] = asPublic.length;
  return concat(entete, asPublic, chiffre);
}

/* Jeton VAPID (JWT ES256) pour l'origine du point d'envoi. */
export async function jetonVapid(endpoint, clePublique, clePrivee, sujet) {
  const pub = b64urlVersOctets(clePublique);
  const jwk = { kty:'EC', crv:'P-256', d:clePrivee,
                x:octetsVersB64url(pub.slice(1, 33)), y:octetsVersB64url(pub.slice(33, 65)), ext:true };
  const k = await crypto.subtle.importKey('jwk', jwk, { name:'ECDSA', namedCurve:'P-256' }, false, ['sign']);
  const morceau = o => octetsVersB64url(enc.encode(JSON.stringify(o)));
  const corps = morceau({ typ:'JWT', alg:'ES256' }) + '.' + morceau({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: sujet
  });
  const sig = await crypto.subtle.sign({ name:'ECDSA', hash:'SHA-256' }, k, enc.encode(corps));
  return corps + '.' + octetsVersB64url(sig);
}

/* Envoie une notification. Rend le statut HTTP du service de push
   (201 attendu ; 404 ou 410 : abonnement à oublier). */
export async function envoyer(abonnement, message, vapid, options) {
  const o = options || {};
  const corps = await chiffrer(abonnement, message);
  const jwt = await jetonVapid(abonnement.endpoint, vapid.publique, vapid.privee, vapid.sujet);
  const r = await fetch(abonnement.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': 'vapid t=' + jwt + ', k=' + vapid.publique,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': String(o.ttl || 3600),
      'Urgency': o.urgence || 'high'
    },
    body: corps
  });
  return r.status;
}
