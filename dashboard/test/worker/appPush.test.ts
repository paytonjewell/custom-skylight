// Reminders to the phone app (worker/push.ts, worker/fcm.ts): the app saves its FCM token like a
// browser saves its push subscription
import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { client, signIn } from './helpers';

const TOKEN = 'eXaMpLeFcMtOkEn:APA91b' + 'Hk7_x-'.repeat(25);

describe('phone app reminders', () => {
  test('the app turns reminders on with its FCM token', async () => {
    const api = client(await signIn('203.0.113.80'));
    const res = await api('PUT', '/api/push', { kind: 'app', token: TOKEN, person: 'john', tz: 'America/Chicago' });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare('SELECT kind, person, p256dh FROM push_subs WHERE endpoint = ?')
      .bind(TOKEN)
      .first();
    expect(row).toEqual({ kind: 'app', person: 'john', p256dh: '' });

    const info = await (await api('GET', '/api/push')).json<{ mine: unknown[] }>();
    expect(info.mine).toEqual([{ endpoint: TOKEN, person: 'john' }]);
  });

  test('a token that isn’t one is refused', async () => {
    const api = client(await signIn('203.0.113.81'));
    for (const token of ['short', 'https://evil.example/' + 'x'.repeat(120), 42]) {
      const res = await api('PUT', '/api/push', { kind: 'app', token, person: 'john', tz: 'America/Chicago' });
      expect(res.status, String(token)).toBe(400);
    }
  });

  test('without the Firebase key on the server, a test says so instead of failing quietly', async () => {
    const api = client(await signIn('203.0.113.82'));
    const token = TOKEN.replace('eXaMpLe', 'AnOtHeR');
    await api('PUT', '/api/push', { kind: 'app', token, person: 'mary', tz: 'America/Chicago' });
    const res = await api('POST', '/api/push/test', { endpoint: token });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'App reminders aren’t set up on the server yet' });
  });
});
