// Reminders to the phone app (dashboard/android) through Firebase Cloud Messaging (HTTP v1). Browsers
// get Web Push instead (worker/webpush.ts); worker/push.ts picks one by the subscription's kind.
//
// Messages are data only, so the app's own ReminderMessagingService draws the notification (on its
// high-importance channel, with a Done button) whether the app is open, in the background or closed.
//
// Google authorises the sender with a service account: FCM_SERVICE_ACCOUNT holds its JSON key, from
// Firebase → Project settings → Service accounts → Generate new private key. Its key signs a short JWT
// (WebCrypto, RS256) that Google swaps for an hour-long access token.
import { b64url } from './webpush';

const enc = new TextEncoder();

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

function serviceAccount(env: Env): ServiceAccount | null {
  try {
    const a = JSON.parse(env.FCM_SERVICE_ACCOUNT ?? '') as Partial<ServiceAccount>;
    return a.project_id && a.client_email && a.private_key ? (a as ServiceAccount) : null;
  } catch {
    return null;
  }
}

/** The access token, kept per Worker instance until a minute before it expires */
let cached: { token: string; until: number } | null = null;

async function accessToken(a: ServiceAccount): Promise<string> {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const part = (o: object) => b64url(enc.encode(JSON.stringify(o)));
  const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({
    iss: a.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const der = Uint8Array.from(atob(a.private_key.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, '')), (c) =>
    c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${b64url(sig)}`,
    }),
  });
  if (!res.ok) throw new Error(`Google sign-in for FCM failed: ${res.status} ${await res.text().catch(() => '')}`);
  const t = await res.json<{ access_token: string; expires_in: number }>();
  cached = { token: t.access_token, until: Date.now() + t.expires_in * 1000 };
  return t.access_token;
}

/**
 * Send one reminder to an app's FCM token. Returns FCM's status, in Web Push's terms where it matters:
 * 404 means the token is gone (the app was uninstalled or reset), so it should be forgotten.
 */
export async function sendFcm(
  env: Env,
  token: string,
  message: Record<string, string | null | undefined>,
  ttl = 6 * 3600,
): Promise<number> {
  const a = serviceAccount(env);
  if (!a) {
    console.warn('FCM_SERVICE_ACCOUNT is not set: app reminders can’t be sent');
    return 503;
  }
  // FCM data values must all be strings
  const data = Object.fromEntries(
    Object.entries(message).flatMap(([k, v]) => (v == null ? [] : [[k, String(v)]])),
  ) as Record<string, string>;
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${a.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken(a)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { token, data, android: { priority: 'HIGH', ttl: `${ttl}s` } } }),
  });
  if (!res.ok) console.warn('FCM send failed', res.status, await res.text().catch(() => ''));
  return res.status;
}
