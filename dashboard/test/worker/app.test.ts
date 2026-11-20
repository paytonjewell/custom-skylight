// The phone app's updates (worker/app.ts): CI uploads a build with its token, signed-in devices see the
// newest version and download it
import { SELF } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { ORIGIN, client, signIn } from './helpers';

/** APP_UPLOAD_TOKEN in test/worker/vitest.config.ts */
const TOKEN = 'test-upload-token-0123456789abcdef0123456789';
/** Enough of a zip file to pass for an APK */
const apk = (extra = '') => new TextEncoder().encode('PK\u0003\u0004fake apk' + extra);

function upload(versionCode: number | string, body: Uint8Array, token = TOKEN) {
  return SELF.fetch(`${ORIGIN}/api/app/upload?versionCode=${versionCode}&versionName=1.0.${versionCode}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Length': String(body.byteLength) },
    body,
  });
}

describe('phone app updates', () => {
  test('uploading needs the token, not a device cookie', async () => {
    expect((await upload(5, apk(), 'wrong-token-wrong-token-wrong-token')).status).toBe(403);
    const res = await SELF.fetch(`${ORIGIN}/api/app/upload?versionCode=5`, {
      method: 'PUT',
      headers: { Cookie: await signIn('203.0.113.70') },
      body: apk(),
    });
    expect(res.status).toBe(403);
  });

  test('only APKs, with a version number', async () => {
    expect((await upload(6, new TextEncoder().encode('<html>not an apk'))).status).toBe(400);
    expect((await upload('abc', apk())).status).toBe(400);
  });

  test('signed-in devices see the newest build and download it', async () => {
    const api = client(await signIn('203.0.113.71'));
    expect((await upload(10, apk('v10'))).status).toBe(204);

    const info = await (await api('GET', '/api/app')).json();
    expect(info).toMatchObject({ versionCode: 10, versionName: '1.0.10', size: apk('v10').byteLength });

    const file = await api('GET', '/api/app/apk');
    expect(file.headers.get('Content-Type')).toBe('application/vnd.android.package-archive');
    expect(new TextDecoder().decode(await file.arrayBuffer())).toContain('v10');

    // An older build can't replace it; a newer one does
    expect((await upload(9, apk('v9'))).status).toBe(409);
    expect((await upload(11, apk('v11'))).status).toBe(204);
    expect(await (await api('GET', '/api/app')).json()).toMatchObject({ versionCode: 11 });
  });

  test('signed out devices get neither', async () => {
    for (const path of ['/api/app', '/api/app/apk']) expect((await SELF.fetch(ORIGIN + path)).status, path).toBe(401);
  });
});
