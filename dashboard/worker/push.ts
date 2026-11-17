// Phone reminders. A phone turns reminders on (src/app/Reminders.tsx) and saves its push subscription
// with the person it belongs to. Every minute the cron sends each task's reminder, at its local
// time on the days it's due and not done yet, only to phones whose person the task notifies: John's
// phone never gets Mary's reminders. "Done" on the notification ticks the task (public/sw.js).
import type { Device } from './auth';
import type { PushInfo, Task, TaskDone } from '../src/data/types';
import { doneByTask, dueItem } from '../src/data/tasks';
import { describeRepeat, shiftDay } from '../src/lib/repeat';
import { sendPush, vapid, type Subscription } from './webpush';
import { bad, done, json, notFound, readJson } from './http';
import { PERSON, validTz } from './validate';
import { loadReminders } from './tasks';

/** A reminder goes out if its time was within this many minutes (the cron runs every minute; this
 * covers a few missed runs) */
const WINDOW_MIN = 15;
const MAX_SUBS = 50;

interface SubRow extends Subscription {
  device_id: string;
  person: string;
  tz: string;
}

/**
 * Browsers' push services. The Worker POSTs to a saved endpoint every time a reminder is due, so only
 * these are accepted: otherwise any signed-in device could have it send requests anywhere.
 * Chrome, Edge on Android and Samsung Internet use FCM; Firefox, Mozilla's autopush; Safari, Apple's;
 * Edge on Windows, WNS.
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /\.notify\.windows\.com$/,
];

/** Whether a subscription's endpoint is one of the push services */
export function isPushService(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && !url.port && !url.username && PUSH_HOSTS.some((h) => h.test(url.hostname));
}

/** The app's address, for the VAPID "sub" claim (push services want a way to reach the sender) */
async function subject(env: Env): Promise<string> {
  const row = await env.DB.prepare("SELECT value FROM config WHERE key = 'origin'").first<{ value: string }>();
  return row?.value ?? 'https://example.com';
}

/** GET /api/push: the key to subscribe with, who has reminders on, and this device's subscriptions */
export async function getPush(env: Env, device: Device): Promise<Response> {
  const [v, rows] = await Promise.all([
    vapid(env),
    env.DB.prepare('SELECT endpoint, device_id, person FROM push_subs').all<
      Pick<SubRow, 'endpoint' | 'device_id' | 'person'>
    >(),
  ]);
  return json<PushInfo>({
    key: v.publicKey,
    people: [...new Set(rows.results.map((r) => r.person))],
    mine: rows.results
      .filter((r) => r.device_id === device.id)
      .map((r) => ({ endpoint: r.endpoint, person: r.person })),
  });
}

/** PUT /api/push ({ endpoint, keys: { p256dh, auth }, person, tz }): turn reminders on for this phone */
export async function savePush(req: Request, env: Env, device: Device): Promise<Response> {
  const b = await readJson<{
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
    person?: unknown;
    tz?: unknown;
  }>(req);
  const endpoint = b?.endpoint,
    p256dh = b?.keys?.p256dh,
    auth = b?.keys?.auth,
    person = b?.person;
  if (typeof endpoint !== 'string' || endpoint.length > 1000 || !isPushService(endpoint)) return bad('Bad endpoint');
  if (typeof p256dh !== 'string' || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh)) return bad('Bad key');
  if (typeof auth !== 'string' || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) return bad('Bad key');
  if (typeof person !== 'string' || !PERSON.test(person) || person === 'any') return bad('Bad person');
  if (!validTz(b?.tz)) return bad('Bad time zone');
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subs').first<number>('n');
  if ((count ?? 0) >= MAX_SUBS) return bad('Too many phones');
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO push_subs (endpoint, device_id, person, p256dh, auth, tz, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET device_id = excluded.device_id, person = excluded.person,
         p256dh = excluded.p256dh, auth = excluded.auth, tz = excluded.tz`,
    ).bind(endpoint, device.id, person, p256dh, auth, b!.tz, new Date().toISOString()),
    env.DB.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('origin', ?)").bind(new URL(req.url).origin),
  ]);
  return json({ ok: true });
}

/** DELETE /api/push ({ endpoint }): turn reminders off for this phone */
export async function deletePush(req: Request, env: Env, device: Device): Promise<Response> {
  const b = await readJson<{ endpoint?: unknown }>(req);
  if (typeof b?.endpoint !== 'string') return bad('Bad endpoint');
  await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ? AND device_id = ?').bind(b.endpoint, device.id).run();
  return done();
}

/** POST /api/push/test ({ endpoint }): a test notification to this phone */
export async function testPush(req: Request, env: Env, device: Device): Promise<Response> {
  const b = await readJson<{ endpoint?: unknown }>(req);
  const sub = await env.DB.prepare('SELECT * FROM push_subs WHERE endpoint = ? AND device_id = ?')
    .bind(b?.endpoint ?? '', device.id)
    .first<SubRow>();
  if (!sub) return notFound('Reminders are off on this phone');
  const status = await sendPush(
    env,
    sub,
    { title: 'Reminders are on 🎉', body: 'Task reminders for you will show up here.', tag: 'test' },
    await subject(env),
    600,
  );
  if (status === 404 || status === 410) await forget(env, sub.endpoint);
  return status < 300 ? json({ ok: true }) : bad('The push service said ' + status, 502);
}

const forget = (env: Env, endpoint: string) =>
  env.DB.batch([
    env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(endpoint),
    env.DB.prepare('DELETE FROM push_sent WHERE endpoint = ?').bind(endpoint),
  ]);

/** 'YYYY-MM-DD' and minutes since midnight, now, in a time zone */
export function localNow(tz: string, at = new Date()): { day: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Whether a reminder at `hhmm` is in its sending window now: 0 for today's, 1 for yesterday's, else -1 */
function windowDay(hhmm: string, minutes: number): number {
  return (
    [0, 1].find((back) => {
      const ago = minutes + back * 1440 - minutesOf(hhmm);
      return ago >= 0 && ago < WINDOW_MIN;
    }) ?? -1
  );
}

/**
 * Could any reminder be due now? `times`: every reminder time in use; `zones`: the phones' time
 * zones. Most minutes nothing is, and this answers that without loading any tasks.
 */
export function anyInWindow(times: string[], zones: string[], at = new Date()): boolean {
  return zones.some((tz) => {
    const { minutes } = localNow(tz, at);
    return times.some((t) => windowDay(t, minutes) >= 0);
  });
}

/**
 * Which reminders should go out now for a phone in `tz`: tasks with a reminder time in the last few
 * minutes, due that day (not overdue from before) and not done, that notify `person`. Just after
 * midnight, that includes yesterday's late-evening reminders (11:59 PM).
 */
export function dueReminders(
  tasks: Task[],
  done: TaskDone[],
  person: string,
  tz: string,
  at = new Date(),
): { task: Task; day: string }[] {
  const { day: today, minutes } = localNow(tz, at);
  const by = doneByTask(done);
  return tasks.flatMap((t) => {
    if (!t.remind || !t.notify.includes(person)) return [];
    // Its time today, or yesterday (when that's still within the window)
    const back = windowDay(t.remind, minutes);
    if (back < 0) return [];
    const day = shiftDay(today, -back);
    const item = dueItem(t, by.get(t.id) ?? [], day, day);
    return item && !item.done && !item.overdue ? [{ task: t, day: item.day }] : [];
  });
}

/** Cron: send the reminders that are due */
export async function sendReminders(env: Env, at = new Date()): Promise<void> {
  // This runs every minute, so first a cheap check (two small reads) for whether anything could be due
  const [subRows, timeRows] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM push_subs'),
    env.DB.prepare('SELECT DISTINCT remind FROM tasks WHERE remind IS NOT NULL'),
  ]);
  const subs = subRows.results as unknown as SubRow[];
  const times = (timeRows.results as { remind: string }[]).map((r) => r.remind);
  if (!anyInWindow(times, [...new Set(subs.map((s) => s.tz))], at)) return;
  const { tasks, done } = await loadReminders(env, at);
  const lists = new Map(
    (
      await env.DB.prepare('SELECT id, title, emoji FROM lists').all<{ id: string; title: string; emoji: string }>()
    ).results.map((l) => [l.id, l]),
  );
  const sub = await subject(env);
  for (const s of subs) {
    for (const { task: t, day } of dueReminders(tasks, done, s.person, s.tz, at)) {
      // Claim it first, so overlapping cron runs don't both send
      const { meta } = await env.DB.prepare(
        'INSERT OR IGNORE INTO push_sent (task_id, day, endpoint, sent_at) VALUES (?, ?, ?, ?)',
      )
        .bind(t.id, day, s.endpoint, new Date().toISOString())
        .run();
      if (!meta.changes) continue;
      const list = t.listId ? lists.get(t.listId) : undefined;
      const status = await sendPush(
        env,
        s,
        {
          title: [t.emoji, t.title].filter(Boolean).join(' '),
          body: list
            ? `From ${[list.emoji, list.title || 'Untitled list'].filter(Boolean).join(' ')}`
            : t.repeat
              ? describeRepeat(t.repeat)
              : 'Reminder',
          tag: `${t.id}:${day}`,
          task: t.id,
          day,
          by: t.who === 'any' ? null : t.who,
        },
        sub,
      );
      if (status === 404 || status === 410) {
        await forget(env, s.endpoint);
        break;
      }
    }
  }
}

/** Daily cron: forget reminders sent over a month ago (push_sent only has to cover today and yesterday) */
export async function prunePushSent(env: Env, at = new Date()): Promise<void> {
  await env.DB.prepare('DELETE FROM push_sent WHERE day < ?')
    .bind(shiftDay(localNow('UTC', at).day, -30))
    .run();
}
