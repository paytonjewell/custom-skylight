// The PIN gate (worker/auth.ts, worker/index.ts): what a signed-out device can reach, signing in, and
// the cross-origin check
import { SELF, env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { ORIGIN, client, postPin, signIn } from './helpers';

describe('signed out', () => {
  test('API calls get 401, so the app reloads into the sign-in page', async () => {
    for (const path of ['/api/tasks', '/api/lists', '/media/00000000-0000-0000-0000-000000000000/full']) {
      const res = await SELF.fetch(ORIGIN + path);
      expect(res.status, path).toBe(401);
      expect(await res.json()).toEqual({ error: 'Signed out' });
    }
  });

  test('pages get the sign-in page instead of the app', async () => {
    for (const path of ['/', '/index.html', '/assets/index.js']) {
      const res = await SELF.fetch(ORIGIN + path);
      expect(res.status, path).toBe(200);
      expect(await res.text()).toContain('name="pin"');
    }
  });

  test('the public paths load without a cookie', async () => {
    const privacy = await SELF.fetch(`${ORIGIN}/privacy`);
    expect(privacy.status).toBe(200);
    expect(await privacy.text()).toContain('Google');
    // The manifest, icons and service worker go straight to the static files
    for (const path of ['/manifest.webmanifest', '/sw.js', '/icon.svg', '/icon-192.png']) {
      const res = await SELF.fetch(ORIGIN + path);
      expect(await res.text(), path).toBe(`static file ${path}`);
    }
  });
});

describe('signing in', () => {
  test('a wrong PIN is refused with 401', async () => {
    const res = await postPin('000000', '203.0.113.50');
    expect(res.status).toBe(401);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(await res.text()).toContain('isn’t right');
  });

  test('a post that isn’t a form gets 400, not an error page', async () => {
    const res = await SELF.fetch(`${ORIGIN}/signin`, {
      method: 'POST',
      body: '{"pin":"135790"}',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  test('the right PIN gives a cookie that opens the API, until signing out', async () => {
    const api = client(await signIn());
    const family = await api('GET', '/api/family');
    expect(family.status).toBe(200);
    expect((await family.json()) as unknown[]).toHaveLength(2);
    // Signed in, the app's own files are served
    expect(await (await api('GET', '/')).text()).toBe('static file /');
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices').first<number>('n');
    const out = await api('POST', '/api/signout');
    expect(out.status).toBe(204);
    expect(out.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM devices').first<number>('n')).toBe(before! - 1);
    expect((await api('GET', '/api/family')).status).toBe(401);
  });

  test('unknown API paths are 404 once signed in', async () => {
    const api = client(await signIn());
    expect((await api('GET', '/api/nothing-here')).status).toBe(404);
  });
});

describe('cross-origin requests', () => {
  test('changes from another site are refused; the app’s own and Origin-less ones go through', async () => {
    const cookie = await signIn();
    const post = (id: string, origin?: string) =>
      SELF.fetch(`${ORIGIN}/api/lists`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
        body: JSON.stringify({ id, title: 'List', emoji: '' }),
      });
    expect((await post('crossorigin1', 'https://evil.example')).status).toBe(403);
    expect((await post('crossorigin2', 'null')).status).toBe(403);
    expect((await post('crossorigin3', ORIGIN)).status).toBe(201);
    expect((await post('crossorigin4')).status).toBe(201);
    // Reading isn't a change
    const get = await SELF.fetch(`${ORIGIN}/api/lists`, {
      headers: { Cookie: cookie, Origin: 'https://evil.example' },
    });
    expect(get.status).toBe(200);
  });
});
