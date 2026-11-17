// Wrong-PIN limits (worker/auth.ts). In a file of its own: the limits count across the whole database.
import { expect, test } from 'vitest';
import { PIN, postPin } from './helpers';

test('after 5 wrong PINs from one address, even the right one waits (429)', async () => {
  for (let i = 0; i < 5; i++) expect((await postPin('111111', '198.51.100.7')).status).toBe(401);
  expect((await postPin('111111', '198.51.100.7')).status).toBe(429);
  expect((await postPin(PIN, '198.51.100.7')).status).toBe(429);
  // Another address isn't held up by that one
  expect((await postPin(PIN, '198.51.100.8')).status).toBe(303);
});

test('after 30 wrong PINs from anywhere in an hour, new sign-ins wait', async () => {
  // 5 already from the test above; 25 more, from addresses that each stay under their own limit
  for (let i = 0; i < 25; i++) expect((await postPin('222222', `192.0.2.${i}`)).status).toBe(401);
  expect((await postPin(PIN, '192.0.2.200')).status).toBe(429);
});
