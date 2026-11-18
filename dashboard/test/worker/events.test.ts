// Calendar events in their own table (migrations/0016_events.sql, worker/google.ts)
import { env } from 'cloudflare:test';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { syncCalendars } from '../../worker/google';
import { client, signIn } from './helpers';

let api: ReturnType<typeof client>;
beforeAll(async () => {
  api = client(await signIn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const ev = (id: string, calendar: string, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  calendar,
  title,
  start: '2026-11-20T15:00:00.000Z',
  end: '2026-11-20T16:00:00.000Z',
  allDay: false,
  location: '',
  notes: '',
  recurring: false,
  ...extra,
});

/** A connected account (with a token that's still good, so no sign-in to Google is needed) */
async function account() {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO google_accounts (id, email, refresh_token, access_token, expires_at, created_at) VALUES ('1', 'a@example.com', 'r', 'token', ?, 't')",
  )
    .bind(Date.now() + 3600_000)
    .run();
}
const calendar = (id: string, position: number) =>
  env.DB.prepare(
    "INSERT INTO calendars (id, account_id, google_id, name, color, writable, position, shown, synced_at) VALUES (?, '1', ?, 'Cal', '#000000', 1, ?, 1, ?)",
  )
    .bind(id, `g-${id}`, position, new Date().toISOString())
    .run();

test('the migration moves each calendar’s stored list into rows, and the app gets exactly the same JSON', async () => {
  await account();
  // Back to the old layout: the events column, and no events table
  await env.DB.exec('DROP TABLE events');
  await env.DB.exec("ALTER TABLE calendars ADD COLUMN events TEXT NOT NULL DEFAULT '[]'");
  const first = [
    ev('a1', 'calmigr1', 'Jacob "dentist" 🦷 é \\ / <b>', {
      allDay: true,
      start: '2026-11-20',
      end: '2026-11-21',
      notes: 'line 1\nline 2\ttab  ',
      people: ['jacob'],
      emoji: '🦷',
    }),
    ev('b2_20261120T150000Z', 'calmigr1', 'Practice', { recurring: true, guest: true }),
  ];
  const second = [ev('c3', 'calmigr2', 'Other calendar')];
  for (const [id, list, position] of [
    ['calmigr1', first, 0],
    ['calmigr2', second, 1],
  ] as const) {
    await calendar(id, position);
    await env.DB.prepare('UPDATE calendars SET events = ? WHERE id = ?').bind(JSON.stringify(list), id).run();
  }
  // A hidden calendar's events are copied too, but not shown
  await calendar('calhidn1', 2);
  await env.DB.prepare("UPDATE calendars SET shown = 0, events = ? WHERE id = 'calhidn1'")
    .bind(JSON.stringify([ev('h1', 'calhidn1', 'Hidden')]))
    .run();

  const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0016'))!;
  for (const q of migration.queries) await env.DB.prepare(q).run();

  const columns = await env.DB.prepare('PRAGMA table_info(calendars)').all<{ name: string }>();
  expect(columns.results.map((c) => c.name)).not.toContain('events');
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM events').first('n')).toBe(4);

  const res = await api('GET', '/api/events');
  expect(res.headers.get('Content-Type')).toBe('application/json');
  // Byte for byte what the old code sent: each calendar's list, joined in calendar order
  expect(await res.text()).toBe(JSON.stringify({ events: [...first, ...second] }));
});

test('adding, changing and deleting an event touches only its own row', async () => {
  await account();
  await calendar('caledit1', 5);
  const google: { method: string; url: string; body?: unknown }[] = [];
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    google.push({ method: init.method ?? 'GET', url: input, body });
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    const id = (body?.id as string) ?? input.split('/events/')[1];
    return Response.json({
      id,
      status: 'confirmed',
      summary: body?.summary ?? 'Changed',
      start: { dateTime: '2026-11-21T15:00:00Z' },
      end: { dateTime: '2026-11-21T16:00:00Z' },
      organizer: { self: true },
    });
  });
  const shown = async () =>
    (
      (await (await api('GET', '/api/events')).json()) as { events: { id: string; calendar: string; title: string }[] }
    ).events
      .filter((e) => e.calendar === 'caledit1')
      .map((e) => `${e.id}:${e.title}`);

  const add = (id: string, title: string) =>
    api('POST', '/api/events', {
      id,
      calendar: 'caledit1',
      title,
      start: '2026-11-21T15:00:00Z',
      end: '2026-11-21T16:00:00Z',
      allDay: false,
    });
  expect((await add('evaaa001', 'One')).status).toBe(201);
  expect((await add('evbbb002', 'Two')).status).toBe(201);
  expect(google[0]).toMatchObject({ method: 'POST', url: expect.stringContaining('/calendars/g-caledit1/events') });
  expect(await shown()).toEqual(['evaaa001:One', 'evbbb002:Two']);

  // A changed event moves to the end, as Google lists recently changed ones
  expect((await api('PATCH', '/api/events/caledit1/evaaa001', { title: 'Changed' })).status).toBe(200);
  expect(await shown()).toEqual(['evbbb002:Two', 'evaaa001:Changed']);

  expect((await api('DELETE', '/api/events/caledit1/evbbb002')).status).toBe(204);
  expect(await shown()).toEqual(['evaaa001:Changed']);
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE calendar_id = 'caledit1'").first('n')).toBe(1);
});

test('a sync replaces the calendar’s rows, in Google’s order, even when they come to megabytes', async () => {
  await account();
  await calendar('calsync1', 6);
  await env.DB.prepare("UPDATE calendars SET synced_at = NULL WHERE id = 'calsync1'").run();
  // Something left from an earlier sync, which must go
  await env.DB.prepare(
    "INSERT INTO events (calendar_id, id, position, data) VALUES ('calsync1', 'old', 0, '{}')",
  ).run();
  const items: Record<string, unknown>[] = Array.from({ length: 2500 }, (_, n) => ({
    id: `sync${n}`,
    summary: `Event ${n}`,
    description: 'x'.repeat(600), // about 1.6 MB in all: more than one insert
    start: { dateTime: '2026-11-21T15:00:00Z' },
    end: { dateTime: '2026-11-21T16:00:00Z' },
  }));
  items.splice(10, 0, { ...items[0], id: 'gone', status: 'cancelled' });
  vi.stubGlobal('fetch', async () => Response.json({ items }));
  await syncCalendars({ ...env, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' });

  const rows = await env.DB.prepare(
    "SELECT id, position FROM events WHERE calendar_id = 'calsync1' ORDER BY position",
  ).all<{ id: string; position: number }>();
  expect(rows.results.map((r) => r.id)).toEqual(items.filter((i) => i.id !== 'gone').map((i) => i.id));
  expect(new Set(rows.results.map((r) => r.position)).size).toBe(2500);
  expect(await env.DB.prepare("SELECT synced_at FROM calendars WHERE id = 'calsync1'").first('synced_at')).toBeTruthy();
});

test('a sync writes only the events that changed', async () => {
  await account();
  await calendar('caldiff1', 7);
  const item = (id: string, summary = `Event ${id}`) => ({
    id,
    summary,
    start: { dateTime: '2026-11-21T15:00:00Z' },
    end: { dateTime: '2026-11-21T16:00:00Z' },
  });
  const sync = async (items: Record<string, unknown>[]) => {
    await env.DB.prepare("UPDATE calendars SET synced_at = NULL WHERE id = 'caldiff1'").run();
    vi.stubGlobal('fetch', async () => Response.json({ items }));
    await syncCalendars({ ...env, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' });
    const rows = await env.DB.prepare(
      "SELECT rowid, id, position, json_extract(data, '$.title') AS title FROM events WHERE calendar_id = 'caldiff1' ORDER BY position",
    ).all<{ rowid: number; id: string; position: number; title: string }>();
    return rows.results;
  };

  const first = await sync([item('a'), item('b'), item('c'), item('d')]);
  expect(first.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);

  // Nothing changed at Google: every row is left as it was (a rewritten row would get a new rowid)
  expect(await sync([item('a'), item('b'), item('c'), item('d')])).toEqual(first);

  // "a" ages out of the window, "c" is renamed, "e" is new: "b" and "d" aren't touched or renumbered
  const third = await sync([item('b'), item('c', 'Renamed'), item('d'), item('e')]);
  const by = Object.fromEntries(third.map((r) => [r.id, r]));
  expect(Object.keys(by).sort()).toEqual(['b', 'c', 'd', 'e']);
  expect(by.b).toEqual(first[1]);
  expect(by.d).toEqual(first[3]);
  expect(by.c).toMatchObject({ position: first[2].position, title: 'Renamed' });
  expect(by.e.position).toBeGreaterThan(first[3].position);
});
