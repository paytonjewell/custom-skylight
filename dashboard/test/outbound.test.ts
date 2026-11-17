// Tests for worker/outbound.ts: links typed or shared into the app reach only the public web
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPublic, isPublicUrl, NotPublic } from '../worker/outbound.ts';

const ok = (u: string) => isPublicUrl(new URL(u));

test('public sites are allowed', () => {
  assert.equal(ok('https://www.allrecipes.com/recipe/1/'), true);
  assert.equal(ok('http://example.com/x'), true);
  assert.equal(ok('https://8.8.8.8/'), true);
  assert.equal(ok('https://172.32.0.1/'), true); // just past 172.16/12
});

test('private, local and odd addresses are not, however they are written', () => {
  for (const u of [
    'http://localhost/',
    'http://app.localhost/',
    'http://intranet/',
    'http://127.0.0.1/',
    'http://2130706433/', // 127.0.0.1 as one number
    'http://0x7f.1/', // hex
    'http://0177.0.0.1/', // octal
    'http://0.0.0.0/',
    'http://10.1.2.3/',
    'http://100.64.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://192.168.1.1/',
    'http://224.0.0.1/',
    'http://255.255.255.255/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[fe80::1]/',
    'http://[fd00::1]/',
    'http://[2606:4700::1111]/', // even public IPv6 literals
    'http://user:pass@example.com/',
    'file:///etc/passwd',
    'ftp://example.com/',
  ])
    assert.equal(ok(u), false, u);
});

/** Swap fetch for a fake web: url → response */
function fakeWeb(pages: Record<string, () => Response>) {
  const seen: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    assert.equal(init?.redirect, 'manual');
    seen.push(input);
    const page = pages[input];
    if (!page) throw new Error('unexpected fetch ' + input);
    return page();
  }) as typeof fetch;
  return { seen, restore: () => (globalThis.fetch = real) };
}
const redirect = (to: string) => () => new Response(null, { status: 302, headers: { Location: to } });

test('redirects are followed by hand, checking each address', async () => {
  const web = fakeWeb({
    'https://short.example/r': redirect('/next'),
    'https://short.example/next': redirect('https://recipes.example/pie'),
    'https://recipes.example/pie': () => new Response('<html>pie</html>'),
  });
  try {
    const { res, url } = await fetchPublic(new URL('https://short.example/r'));
    assert.equal(await res.text(), '<html>pie</html>');
    assert.equal(url.toString(), 'https://recipes.example/pie');
  } finally {
    web.restore();
  }
});

test('a redirect to a private address is never fetched', async () => {
  const web = fakeWeb({ 'https://evil.example/': redirect('http://169.254.169.254/latest/meta-data/') });
  try {
    await assert.rejects(fetchPublic(new URL('https://evil.example/')), NotPublic);
    assert.deepEqual(web.seen, ['https://evil.example/']);
  } finally {
    web.restore();
  }
});

test('at most 5 redirects', async () => {
  const pages: Record<string, () => Response> = {};
  for (let i = 0; i < 10; i++) pages[`https://loop.example/${i}`] = redirect(`/${i + 1}`);
  const web = fakeWeb(pages);
  try {
    await assert.rejects(fetchPublic(new URL('https://loop.example/0')), /Too many redirects/);
    assert.equal(web.seen.length, 6);
  } finally {
    web.restore();
  }
});
