// Shared by the Worker tests: sign in like the app does, then call the API with that device's cookie
import { SELF } from 'cloudflare:test';
import { expect } from 'vitest';

export const ORIGIN = 'https://hq.example';
/** DASHBOARD_PIN in test/worker/vitest.config.ts */
export const PIN = '135790';

/** POST /signin as a form, from an IP of the test's choosing (the wrong-PIN limits count per IP) */
export function postPin(pin: string, ip = '203.0.113.1'): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/signin`, {
    method: 'POST',
    body: new URLSearchParams({ pin, name: 'Test phone' }),
    headers: { 'CF-Connecting-IP': ip, Origin: ORIGIN },
    redirect: 'manual',
  });
}

/** A signed-in device's cookie */
export async function signIn(ip?: string): Promise<string> {
  const res = await postPin(PIN, ip);
  expect(res.status).toBe(303);
  const cookie = res.headers.get('Set-Cookie')?.match(/hq_device=[^;]+/)?.[0];
  expect(cookie).toBeTruthy();
  return cookie!;
}

/** Calls the API as the app does: same origin, JSON in and out */
export function client(cookie: string) {
  return (method: string, path: string, body?: unknown) =>
    SELF.fetch(ORIGIN + path, {
      method,
      headers: {
        Cookie: cookie,
        ...(method === 'GET' ? {} : { Origin: ORIGIN }),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
}
