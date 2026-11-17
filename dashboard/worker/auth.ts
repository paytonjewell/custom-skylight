// PIN sign-in. A correct PIN registers the device and gives it a long-lived cookie holding a random
// token; only the token's SHA-256 is stored (devices table). Delete a device's row to sign it out.
import { signInPage } from './signin-page';

const COOKIE = 'hq_device';
const MAX_AGE = 400 * 24 * 3600; // Chrome's cap on cookie lifetime; renewed while the device is in use
const RENEW_AFTER = 24 * 3600 * 1000; // refresh last_seen and the cookie at most daily
const MIN_PIN = 6;

// Wrong-PIN limits: per IP, and across everyone (so many IPs can't share the guessing)
const PER_IP = { max: 5, ms: 15 * 60 * 1000 };
const OVERALL = { max: 30, ms: 60 * 60 * 1000 };

export interface Device {
  id: string;
  name: string;
}

// Signed-in devices, remembered briefly per Worker instance so every asset request doesn't hit D1.
// A deleted device keeps working for at most this long.
const CACHE_MS = 60 * 1000;
const cache = new Map<string, { device: Device; lastSeen: number; until: number }>();

const enc = new TextEncoder();
async function sha256(s: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', enc.encode(s));
}
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

function readCookie(req: Request): string | null {
  const m = (req.headers.get('Cookie') ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,})`));
  return m ? m[1] : null;
}

function cookieHeader(req: Request, token: string, maxAge = MAX_AGE): string {
  // Secure only over HTTPS, so signing in also works on the dev server from another device on the LAN
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

/** The signed-in device for this request, plus a refreshed cookie when it's due */
export async function authenticate(req: Request, env: Env): Promise<{ device: Device; setCookie?: string } | null> {
  const token = readCookie(req);
  if (!token) return null;
  const hash = hex(await sha256(token));
  const now = Date.now();

  let hit = cache.get(hash);
  if (!hit || hit.until < now) {
    const row = await env.DB.prepare('SELECT id, name, last_seen FROM devices WHERE token_hash = ?')
      .bind(hash)
      .first<{ id: string; name: string; last_seen: string }>();
    if (!row) {
      cache.delete(hash);
      return null;
    }
    hit = { device: { id: row.id, name: row.name }, lastSeen: Date.parse(row.last_seen), until: now + CACHE_MS };
    cache.set(hash, hit);
  }

  if (now - hit.lastSeen < RENEW_AFTER) return { device: hit.device };
  hit.lastSeen = now;
  await env.DB.prepare('UPDATE devices SET last_seen = ? WHERE id = ?')
    .bind(new Date(now).toISOString(), hit.device.id)
    .run();
  return { device: hit.device, setCookie: cookieHeader(req, token) };
}

/** POST /signin (a plain form post, so it works without the app's JS) */
export async function signIn(req: Request, env: Env): Promise<Response> {
  const form = await req.formData();
  const pin = String(form.get('pin') ?? '');
  const name =
    String(form.get('name') ?? '')
      .trim()
      .slice(0, 40) || 'Unnamed device';
  const page = (error: string, status: number) => signInPage(req, { error, name, status });

  const secret = env.DASHBOARD_PIN ?? '';
  // Not 5xx: the kiosk app swaps a 5xx page for its offline screen, which would hide this message
  if (secret.length < MIN_PIN)
    return page(`The dashboard's PIN isn't set up yet (it needs at least ${MIN_PIN} digits).`, 200);

  const ip = req.headers.get('CF-Connecting-IP') ?? 'local';
  const now = Date.now();
  await env.DB.prepare('DELETE FROM signin_failures WHERE at < ?')
    .bind(now - OVERALL.ms)
    .run();
  const counts = await env.DB.prepare(
    'SELECT (SELECT count(*) FROM signin_failures WHERE ip = ? AND at > ?) AS ip, (SELECT count(*) FROM signin_failures WHERE at > ?) AS overall',
  )
    .bind(ip, now - PER_IP.ms, now - OVERALL.ms)
    .first<{ ip: number; overall: number }>();
  if (counts && (counts.ip >= PER_IP.max || counts.overall >= OVERALL.max)) {
    return page('Too many wrong PINs. Wait a few minutes and try again.', 429);
  }

  // Compare digests in constant time, so the response time doesn't leak how much of the PIN matched
  const ok = crypto.subtle.timingSafeEqual(await sha256(pin), await sha256(secret));
  if (!ok) {
    await env.DB.prepare('INSERT INTO signin_failures (ip, at) VALUES (?, ?)').bind(ip, now).run();
    return page('That PIN isn’t right.', 401);
  }

  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const at = new Date(now).toISOString();
  await env.DB.prepare('INSERT INTO devices (id, name, token_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), name, hex(await sha256(token)), at, at)
    .run();
  return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': cookieHeader(req, token) } });
}

/** POST /api/signout: forget this device */
export async function signOut(req: Request, env: Env, device: Device): Promise<Response> {
  await env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(device.id).run();
  for (const [k, v] of cache) if (v.device.id === device.id) cache.delete(k);
  return new Response(null, { status: 204, headers: { 'Set-Cookie': cookieHeader(req, '', 0) } });
}
