// The reminder cron against D1 (worker/push.ts, worker/tasks.ts loadReminders)
import { env } from 'cloudflare:test';
import { expect, test } from 'vitest';
import { prunePushSent, sendReminders } from '../../worker/push';
import { loadReminders } from '../../worker/tasks';

const at = new Date('2026-11-17T14:05:00Z'); // 08:05 in Chicago

const addTask = (id: string, remind: string | null, repeat: unknown = null) =>
  env.DB.prepare(
    `INSERT INTO tasks (id, title, who, repeat, slot, remind, notify, created_at, updated_at)
     VALUES (?, 'Task', 'john', ?, 'anytime', ?, '["john"]', '2026-01-01', '2026-01-01')`,
  )
    .bind(id, repeat ? JSON.stringify(repeat) : null, remind)
    .run();
const addDone = (task: string, day: string, doneAt = `${day}T12:00:00Z`) =>
  env.DB.prepare('INSERT INTO task_done (task_id, day, done_at) VALUES (?, ?, ?)').bind(task, day, doneAt).run();

test('only the completions that decide a reminder are loaded', async () => {
  await addTask('remind01', '08:00', { kind: 'daily', start: '2026-01-01' });
  await addTask('remind02', '08:00', { kind: 'afterDone', every: 2, unit: 'week', start: '2026-01-01' });
  await addTask('noremind', null);
  for (const day of ['2026-06-01', '2026-10-01', '2026-11-15', '2026-11-16']) await addDone('remind01', day);
  await addDone('remind02', '2026-03-01');
  await addDone('remind02', '2026-09-01'); // its latest, however old
  await addDone('remind02', '2026-01-01', '2026-11-16T20:00:00Z'); // ticked off just now, for an old day
  await addDone('noremind', '2026-11-16');

  const { tasks, done } = await loadReminders(env, at);
  expect(tasks.map((t) => t.id).sort()).toEqual(['remind01', 'remind02']);
  expect(done.map((d) => `${d.task} ${d.day}`).sort()).toEqual([
    'remind01 2026-11-15',
    'remind01 2026-11-16',
    'remind02 2026-01-01',
    'remind02 2026-09-01',
  ]);
});

test('with a phone but nothing in its window, the cron sends nothing', async () => {
  await env.DB.prepare(
    "INSERT INTO push_subs (endpoint, device_id, person, p256dh, auth, tz, created_at) VALUES ('https://fcm.googleapis.com/fcm/send/x', 'd', 'john', 'k', 'a', 'America/Chicago', 't')",
  ).run();
  // 09:30 in Chicago: no reminder time in the last 15 minutes, so nothing is loaded or sent
  await sendReminders(env, new Date('2026-11-17T15:30:00Z'));
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM push_sent').first('n')).toBe(0);
});

test('the daily prune drops reminders sent over a month ago', async () => {
  for (const day of ['2026-09-01', '2026-11-16'])
    await env.DB.prepare("INSERT INTO push_sent (task_id, day, endpoint, sent_at) VALUES ('t', ?, 'e', 's')")
      .bind(day)
      .run();
  await prunePushSent(env, at);
  const left = await env.DB.prepare('SELECT day FROM push_sent').all<{ day: string }>();
  expect(left.results.map((r) => r.day)).toEqual(['2026-11-16']);
});
