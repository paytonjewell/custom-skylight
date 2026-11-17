// Phone reminders. A phone turns reminders on (src/app/Reminders.tsx) and saves its push subscription
// with the person it belongs to. Every 5 minutes the cron sends each task's reminder, at its local
// time on the days it's due and not done yet, only to phones whose person the task notifies: John's
// phone never gets Mary's reminders. "Done" on the notification ticks the task (public/sw.js).
import type { Device } from './auth';
import type { Task, TaskDone } from '../src/data/types';
import { doneByTask, dueItem } from '../src/data/tasks';
import { describeRepeat, shiftDay } from '../src/lib/repeat';
import { sendPush, vapid, type Subscription } from './webpush';
import { json } from './photos';
import { loadTasks } from './tasks';

const PERSON = /^[a-z0-9_-]{1,32}$/;
/** A reminder goes out if its time was within this many minutes (the cron runs every minute; this
 * covers a few missed runs) */
const WINDOW_MIN = 15;
const MAX_SUBS = 50;

interface SubRow extends Subscription { device_id: string; person: string; tz: string }

const bad = (error: string, status = 400) => json({ error }, status);
const body = <T>(req: Request) => req.json<T>().catch(() => null);

function validTz(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
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
    env.DB.prepare('SELECT endpoint, device_id, person FROM push_subs').all<Pick<SubRow, 'endpoint' | 'device_id' | 'person'>>(),
  ]);
  return json({
    key: v.publicKey,
    people: [...new Set(rows.results.map((r) => r.person))],
    mine: rows.results.filter((r) => r.device_id === device.id).map((r) => ({ endpoint: r.endpoint, person: r.person })),
  });
}

/** PUT /api/push ({ endpoint, keys: { p256dh, auth }, person, tz }): turn reminders on for this phone */
export async function savePush(req: Request, env: Env, device: Device): Promise<Response> {
  const b = await body<{ endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; person?: unknown; tz?: unknown }>(req);
  const endpoint = b?.endpoint, p256dh = b?.keys?.p256dh, auth = b?.keys?.auth, person = b?.person;
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || endpoint.length > 1000) return bad('Bad endpoint');
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
  const b = await body<{ endpoint?: unknown }>(req);
  if (typeof b?.endpoint !== 'string') return bad('Bad endpoint');
  await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ? AND device_id = ?').bind(b.endpoint, device.id).run();
  return new Response(null, { status: 204 });
}

/** POST /api/push/test ({ endpoint }): a test notification to this phone */
export async function testPush(req: Request, env: Env, device: Device): Promise<Response> {
  const b = await body<{ endpoint?: unknown }>(req);
  const sub = await env.DB.prepare('SELECT * FROM push_subs WHERE endpoint = ? AND device_id = ?').bind(b?.endpoint ?? '', device.id).first<SubRow>();
  if (!sub) return bad('Reminders are off on this phone', 404);
  const status = await sendPush(env, sub, { title: 'Reminders are on 🎉', body: 'Task reminders for you will show up here.', tag: 'test' }, await subject(env), 600);
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
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(at).map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * Which reminders should go out now for a phone in `tz`: tasks with a reminder time in the last few
 * minutes, due that day (not overdue from before) and not done, that notify `person`. Just after
 * midnight, that includes yesterday's late-evening reminders (11:59 PM).
 */
export function dueReminders(tasks: Task[], done: TaskDone[], person: string, tz: string, at = new Date()): { task: Task; day: string }[] {
  const { day: today, minutes } = localNow(tz, at);
  const by = doneByTask(done);
  return tasks.flatMap((t) => {
    if (!t.remind || !t.notify.includes(person)) return [];
    // Its time today, or yesterday (when that's still within the window)
    const day = [today, shiftDay(today, -1)].find((_, back) => {
      const ago = minutes + back * 1440 - minutesOf(t.remind!);
      return ago >= 0 && ago < WINDOW_MIN;
    });
    if (!day) return [];
    const item = dueItem(t, by.get(t.id) ?? [], day, day);
    return item && !item.done && !item.overdue ? [{ task: t, day: item.day }] : [];
  });
}

/** Cron: send the reminders that are due */
export async function sendReminders(env: Env): Promise<void> {
  const subs = (await env.DB.prepare('SELECT * FROM push_subs').all<SubRow>()).results;
  if (!subs.length) return;
  const { tasks, done } = await loadTasks(env, true);
  if (!tasks.length) return;
  const lists = new Map(
    (await env.DB.prepare('SELECT id, title, emoji FROM lists').all<{ id: string; title: string; emoji: string }>()).results.map((l) => [l.id, l]),
  );
  const sub = await subject(env);
  for (const s of subs) {
    for (const { task: t, day } of dueReminders(tasks, done, s.person, s.tz)) {
      // Claim it first, so overlapping cron runs don't both send
      const { meta } = await env.DB.prepare('INSERT OR IGNORE INTO push_sent (task_id, day, endpoint, sent_at) VALUES (?, ?, ?, ?)')
        .bind(t.id, day, s.endpoint, new Date().toISOString()).run();
      if (!meta.changes) continue;
      const list = t.listId ? lists.get(t.listId) : undefined;
      const status = await sendPush(env, s, {
        title: [t.emoji, t.title].filter(Boolean).join(' '),
        body: list ? `From ${[list.emoji, list.title || 'Untitled list'].filter(Boolean).join(' ')}` : t.repeat ? describeRepeat(t.repeat) : 'Reminder',
        tag: `${t.id}:${day}`,
        task: t.id,
        day,
        by: t.who === 'any' ? null : t.who,
      }, sub);
      if (status === 404 || status === 410) {
        await forget(env, s.endpoint);
        break;
      }
    }
  }
  await env.DB.prepare('DELETE FROM push_sent WHERE day < ?').bind(shiftDay(localNow('UTC').day, -30)).run();
}
