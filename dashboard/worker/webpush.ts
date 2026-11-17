// Web Push with nothing but WebCrypto: VAPID signing (RFC 8292) and payload encryption (RFC 8291,
// aes128gcm). The key pair is made on first use and kept in D1 (config table), so there's no setup.
const enc = new TextEncoder();

export const b64url = (b: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
function unb64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};

export interface Vapid {
  /** Uncompressed P-256 public key, base64url (what the browser subscribes with) */
  publicKey: string;
  privateJwk: JsonWebKey;
}

/** The server's VAPID keys, made and saved the first time they're needed */
export async function vapid(env: Env): Promise<Vapid> {
  const row = await env.DB.prepare("SELECT value FROM config WHERE key = 'vapid'").first<{ value: string }>();
  if (row) return JSON.parse(row.value);
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const v: Vapid = {
    publicKey: b64url((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer),
    privateJwk: (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey,
  };
  // Two first requests at once: keep whichever was saved first
  await env.DB.prepare("INSERT OR IGNORE INTO config (key, value) VALUES ('vapid', ?)").bind(JSON.stringify(v)).run();
  const saved = await env.DB.prepare("SELECT value FROM config WHERE key = 'vapid'").first<{ value: string }>();
  return JSON.parse(saved!.value);
}

/** "vapid t=<JWT>, k=<key>" for a push service */
async function authorization(v: Vapid, endpoint: string, subject: string): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(
    enc.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: subject,
      }),
    ),
  );
  const key = await crypto.subtle.importKey('jwk', v.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ]);
  // WebCrypto's ECDSA signature is already JWS's raw r || s
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(header + '.' + claims));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${v.publicKey}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/**
 * The encrypted body for one subscription (RFC 8291). `salt` and `local` can be given for tests;
 * normally they're fresh for every message.
 */
export async function encrypt(
  payload: Uint8Array,
  p256dh: string,
  auth: string,
  salt = crypto.getRandomValues(new Uint8Array(16)),
  local?: CryptoKeyPair,
): Promise<Uint8Array> {
  const uaPublic = unb64url(p256dh);
  const pair =
    local ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      // `public` at runtime (Workers' types spell it `$public`)
      { name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      pair.privateKey,
      256,
    ),
  );

  const ikm = await hkdf(unb64url(auth), shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // One record: the payload, then 0x02 (last record, no padding)
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, Uint8Array.of(2))),
  );

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, Uint8Array.of(asPublic.length), asPublic, sealed);
}

export interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Send one message. Returns the push service's status: 201 sent; 404/410 the subscription is gone
 * (the phone turned reminders off or reinstalled), so it should be forgotten.
 */
export async function sendPush(
  env: Env,
  sub: Subscription,
  message: unknown,
  subject: string,
  ttl = 6 * 3600,
): Promise<number> {
  const v = await vapid(env);
  const body = await encrypt(enc.encode(JSON.stringify(message)), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await authorization(v, sub.endpoint, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: 'high',
    },
    body,
  });
  if (!res.ok) console.warn('Push failed', res.status, await res.text().catch(() => ''));
  return res.status;
}
