// Tests for worker/webpush.ts (encryption, checked by decrypting with Node's own crypto as a phone
// would) and worker/push.ts (which reminders go out when, and to whom)
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';
import { b64url, encrypt } from '../worker/webpush.ts';
import { anyInWindow, dueReminders, isPushService, localNow } from '../worker/push.ts';
import type { Task, TaskDone } from '../src/data/types.ts';

test('encrypted payload decrypts on the phone side (RFC 8291)', async () => {
  // The "phone": its key pair and auth secret
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const authSecret = randomBytes(16);
  const message = JSON.stringify({ title: '♻️ Recycling', body: 'Day before the 1st Thursday' });
  const sealed = Buffer.from(
    await encrypt(new TextEncoder().encode(message), b64url(ua.getPublicKey()), b64url(authSecret)),
  );

  // Header: salt (16) | record size (4) | key length (1) | server public key | ciphertext
  const salt = sealed.subarray(0, 16);
  assert.equal(sealed.readUInt32BE(16), 4096);
  const idlen = sealed[20];
  const asPublic = sealed.subarray(21, 21 + idlen);
  const ciphertext = sealed.subarray(21 + idlen);

  const shared = ua.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, info, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ciphertext.subarray(-16));
  const plain = Buffer.concat([d.update(ciphertext.subarray(0, -16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2); // last-record delimiter
  assert.equal(plain.subarray(0, -1).toString(), message);
});

const task = (p: Partial<Task>): Task => ({
  id: 't',
  title: 'Task',
  emoji: '',
  who: 'john',
  repeat: null,
  due: null,
  slot: 'anytime',
  time: null,
  habit: false,
  onCalendar: false,
  remind: '08:00',
  notify: ['john'],
  listId: null,
  listItemId: null,
  created: '2026-01-01T00:00:00Z',
  ...p,
});
const TZ = 'America/Chicago'; // UTC-6 in November
const at = (local: string) => new Date(local + '-06:00');

test('local day and time in a time zone', () => {
  assert.deepEqual(localNow(TZ, at('2026-11-15T23:30:00')), { day: '2026-11-15', minutes: 23 * 60 + 30 });
});

test('a reminder goes out in the minutes after its time, only to the people it notifies', () => {
  const t = task({ repeat: { kind: 'daily', start: '2026-11-01' } });
  assert.equal(dueReminders([t], [], 'john', TZ, at('2026-11-15T07:59:00')).length, 0);
  assert.deepEqual(
    dueReminders([t], [], 'john', TZ, at('2026-11-15T08:05:00')).map((x) => x.day),
    ['2026-11-15'],
  );
  assert.equal(dueReminders([t], [], 'john', TZ, at('2026-11-15T08:20:00')).length, 0); // too late: missed window
  assert.equal(dueReminders([t], [], 'mary', TZ, at('2026-11-15T08:05:00')).length, 0); // not Mary's
  const both = task({ notify: ['john', 'mary'] });
  assert.equal(dueReminders([both], [], 'mary', TZ, at('2026-11-15T08:05:00')).length, 1);
});

test('no reminder when it is done, not due today, or overdue from before', () => {
  const t = task({ repeat: { kind: 'daily', start: '2026-11-01' } });
  const done: TaskDone[] = [{ task: 't', day: '2026-11-15', at: '2026-11-15T13:00:00Z', by: 'john' }];
  assert.equal(dueReminders([t], done, 'john', TZ, at('2026-11-15T08:05:00')).length, 0);
  // Recycling is due Wed Dec 2, 2026 (the day before Thu Dec 3)
  const recycling = task({ repeat: { kind: 'monthlyNth', nth: 1, weekday: 4, offset: -1, start: '2026-01-01' } });
  assert.equal(dueReminders([recycling], [], 'john', TZ, at('2026-12-01T08:05:00')).length, 0);
  assert.equal(dueReminders([recycling], [], 'john', TZ, at('2026-12-02T08:05:00')).length, 1);
  assert.equal(dueReminders([recycling], [], 'john', TZ, at('2026-12-03T08:05:00')).length, 0); // overdue: no nag
  // A one-off: on its day; an undated one: every day until done
  assert.equal(dueReminders([task({ due: '2026-11-16' })], [], 'john', TZ, at('2026-11-15T08:05:00')).length, 0);
  assert.equal(dueReminders([task({ due: '2026-11-16' })], [], 'john', TZ, at('2026-11-16T08:05:00')).length, 1);
  assert.equal(dueReminders([task({})], [], 'john', TZ, at('2026-11-15T08:05:00')).length, 1);
});

test('a reminder just before midnight still goes out, just after', () => {
  const t = task({ remind: '23:59', due: '2026-11-15' });
  assert.equal(dueReminders([t], [], 'john', TZ, at('2026-11-15T23:58:00')).length, 0);
  assert.deepEqual(
    dueReminders([t], [], 'john', TZ, at('2026-11-15T23:59:00')).map((x) => x.day),
    ['2026-11-15'],
  );
  assert.deepEqual(
    dueReminders([t], [], 'john', TZ, at('2026-11-16T00:03:00')).map((x) => x.day),
    ['2026-11-15'],
  );
  assert.equal(dueReminders([t], [], 'john', TZ, at('2026-11-16T00:20:00')).length, 0);
  // A daily one at 23:59 is sent for the day it was due, not the new day
  const daily = task({ remind: '23:59', repeat: { kind: 'daily', start: '2026-11-01' } });
  assert.deepEqual(
    dueReminders([daily], [], 'john', TZ, at('2026-11-16T00:03:00')).map((x) => x.day),
    ['2026-11-15'],
  );
});

test('the every-minute check: nothing loads unless some reminder time is in its window somewhere', () => {
  const now = at('2026-11-15T08:05:00'); // 14:05 UTC
  assert.equal(anyInWindow(['08:00'], [TZ], now), true);
  assert.equal(anyInWindow(['08:00', '17:30'], [TZ], at('2026-11-15T08:20:00')), false); // window passed
  assert.equal(anyInWindow(['08:00'], ['Europe/London'], now), false); // 14:05 there
  assert.equal(anyInWindow(['14:00'], ['Europe/London', TZ], now), true); // a phone in London
  assert.equal(anyInWindow(['23:59'], [TZ], at('2026-11-16T00:03:00')), true); // yesterday's, just after midnight
  assert.equal(anyInWindow([], [TZ], now), false); // no reminders
  assert.equal(anyInWindow(['08:00'], [], now), false); // no phones
});

test('phones can only subscribe with a browser push service', () => {
  for (const ok of [
    'https://fcm.googleapis.com/fcm/send/abc:def',
    'https://fcm.googleapis.com/wp/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QGxx',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ])
    assert.equal(isPushService(ok), true, ok);
  for (const no of [
    'https://example.com/push',
    'http://fcm.googleapis.com/fcm/send/abc', // not https
    'https://fcm.googleapis.com:8443/fcm/send/abc',
    'https://storage.googleapis.com/bucket/x', // another Google API
    'https://fcm.googleapis.com.evil.example/x',
    'https://evilpush.services.mozilla.com.example/x',
    'https://user@fcm.googleapis.com/x',
    'https://web.push.apple.com.evil.example/',
    'not a url',
  ])
    assert.equal(isPushService(no), false, no);
});
