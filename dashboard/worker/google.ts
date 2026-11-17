// Google Calendar, both ways. Someone connects their Google account once (OAuth; the refresh token
// stays here), picks which of its calendars to show and whose each is. Shown calendars' events, from
// a few months back to a year ahead, are copied here as JSON and kept fresh: when the app loads
// events and the copy is a few minutes old, and by the cron. Adding, changing or deleting an event on
// the dashboard writes to Google first, then updates the copy.
//
// Whose an event is comes from its calendar (src/data/calendar.ts), unless the dashboard chose people
// for it. Those, and an emoji chosen for it, are kept on the Google event as private extended
// properties (WHO, EMOJI), hidden in Google; the title stays as typed.
//
// Repeating events come as their single occurrences (singleEvents), so changing one changes just that
// occurrence, as in Google Calendar's "This event".
import type { Calendar, EventRecord, GoogleAccount } from '../src/data/types';
import { isDay } from '../src/lib/repeat';
import { json } from './photos';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];
const STATE_COOKIE = 'hq_gstate';
/** Events kept: this many days back and ahead */
const BACK_DAYS = 90;
const AHEAD_DAYS = 400;
/** Loading events refreshes calendars whose copy is older than this */
const STALE_MS = 3 * 60 * 1000;
/** Our ids for calendars (and Google accounts' ids are digits) */
const OUR_ID = /^[a-z0-9]{8,32}$/;
const ACCOUNT_ID = /^[0-9]{1,64}$/;
/** Google event ids: ours are base32hex (a–v, 0–9); an occurrence of a repeating event adds _<time> */
const GID = /^[A-Za-z0-9_]{5,1024}$/;
const NEW_GID = /^[a-v0-9]{5,1024}$/;
const PERSON = /^[a-z0-9_-]{1,32}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
/** The private extended property holding the people chosen on the dashboard ("jacob,john", "family") */
const WHO = 'hqWho';
const EMOJI = 'hqEmoji';

class GoogleError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface AccountRow {
  id: string; email: string; refresh_token: string; access_token: string | null; expires_at: number | null; error: string | null;
}
interface CalendarRow {
  id: string; account_id: string; google_id: string; name: string; color: string; own_color: string | null; person: string;
  by_name: number; is_default: number; emoji: string; shown: number; writable: number; position: number; events: string; synced_at: string | null;
}

const bad = (error: string, status = 400) => json({ error }, status);
const body = <T>(req: Request) => req.json<T>().catch(() => null);
const configured = (env: Env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
const redirectUri = (req: Request) => new URL('/api/google/callback', req.url).toString();
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => (b % 36).toString(36)).join('');

// ------------------------------------------------------------ signing in
/** GET /api/google/connect: off to Google to sign in and allow calendar access */
export function connect(req: Request, env: Env): Response {
  if (!configured(env)) return new Response('Google Calendar isn’t set up on the server yet (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET).', { status: 503 });
  const state = randomId();
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline', // a refresh token, to keep syncing
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
    state,
  }).toString();
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString(), 'Set-Cookie': `${STATE_COOKIE}=${state}; Path=/api/google; Max-Age=600; HttpOnly; SameSite=Lax${secure}` },
  });
}

/** GET /api/google/callback: Google sends the person back here; save the account and its calendars */
export async function callback(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const back = (result: string) => new Response(null, {
    status: 302,
    headers: { Location: `/?google=${result}#calendar`, 'Set-Cookie': `${STATE_COOKIE}=; Path=/api/google; Max-Age=0` },
  });
  if (url.searchParams.get('error')) return back('cancelled');
  const state = (req.headers.get('Cookie') ?? '').match(new RegExp(`(?:^|;\\s*)${STATE_COOKIE}=([a-z0-9]+)`))?.[1];
  const code = url.searchParams.get('code');
  if (!configured(env) || !code || !state || state !== url.searchParams.get('state')) return back('failed');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({
      code, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri(req), grant_type: 'authorization_code',
    }),
  });
  const t = await res.json<{ access_token?: string; expires_in?: number; refresh_token?: string; id_token?: string; scope?: string }>().catch(() => null);
  if (!res.ok || !t?.access_token || !t.refresh_token || !t.id_token) {
    console.warn('Google token exchange failed', res.status, t);
    return back('failed');
  }
  // Calendar access can be unticked on Google's consent screen
  if (!SCOPES.slice(2).every((s) => t.scope?.split(' ').includes(s))) return back('noaccess');
  // The id token came straight from Google over HTTPS, so its claims can be read without checking the signature
  const claims = JSON.parse(atob(t.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { sub: string; email?: string };
  const account: AccountRow = {
    id: claims.sub, email: claims.email ?? '', refresh_token: t.refresh_token, access_token: t.access_token,
    expires_at: Date.now() + (t.expires_in ?? 3600) * 1000, error: null,
  };
  await env.DB.prepare(
    `INSERT INTO google_accounts (id, email, refresh_token, access_token, expires_at, error, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT (id) DO UPDATE SET email = excluded.email, refresh_token = excluded.refresh_token,
       access_token = excluded.access_token, expires_at = excluded.expires_at, error = NULL`,
  ).bind(account.id, account.email, account.refresh_token, account.access_token, account.expires_at, new Date().toISOString()).run();
  await refreshCalendarList(env, account);
  return back('connected');
}

/** DELETE /api/google/accounts/:id: disconnect an account (its calendars go too) */
export async function disconnect(env: Env, id: string): Promise<Response> {
  if (!ACCOUNT_ID.test(id)) return bad('Bad account');
  const a = await env.DB.prepare('SELECT refresh_token FROM google_accounts WHERE id = ?').bind(id).first<{ refresh_token: string }>();
  if (!a) return bad('No such account', 404);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM calendars WHERE account_id = ?').bind(id),
    env.DB.prepare('DELETE FROM google_accounts WHERE id = ?').bind(id),
  ]);
  // Also tell Google, so the dashboard no longer shows under the account's connected apps
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(a.refresh_token)}`, { method: 'POST' }).catch(() => {});
  return new Response(null, { status: 204 });
}

// ------------------------------------------------------------ Google API
/** A current access token for the account, refreshed when it's (nearly) expired */
async function accessToken(env: Env, a: AccountRow): Promise<string> {
  if (a.access_token && (a.expires_at ?? 0) > Date.now() + 60_000) return a.access_token;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID ?? '', client_secret: env.GOOGLE_CLIENT_SECRET ?? '', refresh_token: a.refresh_token, grant_type: 'refresh_token' }),
  });
  const t = await res.json<{ access_token?: string; expires_in?: number; error?: string }>().catch(() => null);
  if (!res.ok || !t?.access_token) {
    // Access was removed (or the password changed): it has to be connected again
    if (t?.error === 'invalid_grant') {
      await env.DB.prepare('UPDATE google_accounts SET error = ?, access_token = NULL WHERE id = ?').bind('invalid_grant', a.id).run();
      a.error = 'invalid_grant';
    }
    throw new GoogleError(`Couldn’t sign in to Google as ${a.email}`, 401);
  }
  a.access_token = t.access_token;
  a.expires_at = Date.now() + (t.expires_in ?? 3600) * 1000;
  await env.DB.prepare('UPDATE google_accounts SET access_token = ?, expires_at = ? WHERE id = ?').bind(a.access_token, a.expires_at, a.id).run();
  return a.access_token;
}

async function gapi<T>(env: Env, a: AccountRow, path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: 'Bearer ' + (await accessToken(env, a)), 'Content-Type': 'application/json' },
  });
  // The access token stopped working early: get a new one and try once more
  if (res.status === 401 && retry) {
    a.access_token = null;
    return gapi<T>(env, a, path, init, false);
  }
  if (res.status === 204) return null as T;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn('Google API', init.method ?? 'GET', path.split('?')[0], res.status, text.slice(0, 500));
    throw new GoogleError(`Google Calendar said ${res.status}`, res.status);
  }
  return res.json<T>();
}
const enc = encodeURIComponent;

interface GCalendar { id: string; summary: string; summaryOverride?: string; backgroundColor?: string; accessRole: string; primary?: boolean }
interface GTime { date?: string; dateTime?: string }
interface GEvent {
  id: string; status?: string; summary?: string; location?: string; description?: string; start?: GTime; end?: GTime; recurringEventId?: string;
  extendedProperties?: { private?: Record<string, string> };
  /** self: this calendar is the event's organizer (not just a guest's copy) */
  organizer?: { self?: boolean };
  /** 'birthday': one of Google's own contact birthdays (kept on the main calendar) */
  eventType?: string;
}

/** Teams' game calendars Google offers (ids like nfl_…, ncaaf_…) → their sport's emoji */
const SPORTS: Record<string, string> = { nfl: '🏈', ncaaf: '🏈', nba: '🏀', ncaab: '🏀', wnba: '🏀', mlb: '⚾', nhl: '🏒', mls: '⚽' };
/** A starting emoji for a new calendar: 🎂 for birthdays, the sport for a team's games */
export function calendarEmoji(googleId: string, name: string): string {
  if (/birthday/i.test(name)) return '🎂';
  return SPORTS[googleId.match(/^([a-z]+)_/)?.[1] ?? ''] ?? '';
}

/** Re-read an account's calendars from Google: new ones are added (hidden), gone ones removed */
async function refreshCalendarList(env: Env, a: AccountRow): Promise<void> {
  const items: GCalendar[] = [];
  let page: string | undefined;
  do {
    const r = await gapi<{ items?: GCalendar[]; nextPageToken?: string }>(
      env, a, `/users/me/calendarList?minAccessRole=reader&maxResults=250${page ? '&pageToken=' + enc(page) : ''}`,
    );
    items.push(...(r.items ?? []));
    page = r.nextPageToken;
  } while (page);
  items.sort((x, y) => Number(!!y.primary) - Number(!!x.primary));
  const hasDefault = !!(await env.DB.prepare('SELECT 1 FROM calendars WHERE is_default = 1').first());

  const have = new Map(
    (await env.DB.prepare('SELECT id, google_id FROM calendars WHERE account_id = ?').bind(a.id).all<{ id: string; google_id: string }>())
      .results.map((r) => [r.google_id, r.id]),
  );
  const stmts = items.map((c, i) => {
    const name = c.summaryOverride || (c.primary ? a.email : c.summary) || 'Calendar';
    const color = COLOR.test(c.backgroundColor ?? '') ? c.backgroundColor! : '#888888';
    const writable = c.accessRole === 'owner' || c.accessRole === 'writer' ? 1 : 0;
    const id = have.get(c.id);
    return id
      ? env.DB.prepare('UPDATE calendars SET name = ?, color = ?, writable = ?, position = ? WHERE id = ?').bind(name, color, writable, i, id)
      // New: one you can write to goes by the names in titles; a view-only one (holidays, a team's
      // games) is no one's, in its own colour. The primary calendar is where new events go, at first.
      : env.DB.prepare(
          `INSERT INTO calendars (id, account_id, google_id, name, color, writable, position, person, by_name, is_default, emoji)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          randomId(), a.id, c.id, name, color, writable, i, writable ? 'family' : 'none', writable, c.primary && !hasDefault ? 1 : 0,
          calendarEmoji(c.id, name),
        );
  });
  const keep = new Set(items.map((c) => c.id));
  for (const [gid, id] of have) if (!keep.has(gid)) stmts.push(env.DB.prepare('DELETE FROM calendars WHERE id = ?').bind(id));
  if (stmts.length) await env.DB.batch(stmts);
}

/**
 * Google's event → ours: null for cancelled ones, anything without times, and Google's own contact
 * birthdays (birthdays come from a birthdays calendar instead, as the family keeps one by hand)
 */
export function toRecord(e: GEvent, calendar: string): EventRecord | null {
  if (e.status === 'cancelled' || !e.start || !e.end || e.eventType === 'birthday') return null;
  const allDay = !!e.start.date;
  const start = e.start.date ?? e.start.dateTime, end = e.end.date ?? e.end.dateTime;
  if (!start || !end) return null;
  const who = e.extendedProperties?.private?.[WHO]?.split(',').filter((p) => PERSON.test(p));
  return {
    id: e.id, calendar, title: e.summary ?? '(No title)', start, end, allDay,
    location: e.location ?? '', notes: e.description ?? '', recurring: !!e.recurringEventId,
    ...(who?.length ? { people: who } : {}),
    ...(e.extendedProperties?.private?.[EMOJI] ? { emoji: e.extendedProperties.private[EMOJI].slice(0, 32) } : {}),
    ...(e.organizer && !e.organizer.self ? { guest: true } : {}),
  };
}

/** Copy a calendar's events (the kept window) from Google */
async function syncCalendar(env: Env, c: CalendarRow, a: AccountRow): Promise<void> {
  const min = new Date(Date.now() - BACK_DAYS * 864e5).toISOString();
  const max = new Date(Date.now() + AHEAD_DAYS * 864e5).toISOString();
  const out: EventRecord[] = [];
  let page: string | undefined;
  for (let n = 0; n < 10; n++) {
    const q = new URLSearchParams({
      singleEvents: 'true', timeMin: min, timeMax: max, maxResults: '2500',
      fields: 'items(id,status,summary,location,description,start,end,recurringEventId,extendedProperties,organizer(self),eventType),nextPageToken',
    });
    if (page) q.set('pageToken', page);
    const r = await gapi<{ items?: GEvent[]; nextPageToken?: string }>(env, a, `/calendars/${enc(c.google_id)}/events?${q}`);
    for (const e of r.items ?? []) {
      const rec = toRecord(e, c.id);
      if (rec) out.push(rec);
    }
    page = r.nextPageToken;
    if (!page) break;
  }
  await env.DB.prepare('UPDATE calendars SET events = ?, synced_at = ? WHERE id = ?').bind(JSON.stringify(out), new Date().toISOString(), c.id).run();
}

/** Refresh shown calendars whose copy is older than `maxAge` ms (0: all of them) */
export async function syncCalendars(env: Env, maxAge = 0): Promise<void> {
  if (!configured(env)) return;
  const since = new Date(Date.now() - maxAge).toISOString();
  const cals = (await env.DB.prepare(
    `SELECT c.* FROM calendars c JOIN google_accounts a ON a.id = c.account_id
     WHERE c.shown = 1 AND a.error IS NULL AND (c.synced_at IS NULL OR c.synced_at < ?)`,
  ).bind(maxAge ? since : '9999').all<CalendarRow>()).results;
  const accounts = new Map<string, AccountRow>();
  for (const c of cals) {
    let a = accounts.get(c.account_id);
    if (!a) {
      a = (await env.DB.prepare('SELECT * FROM google_accounts WHERE id = ?').bind(c.account_id).first<AccountRow>())!;
      accounts.set(a.id, a);
    }
    if (a.error) continue;
    await syncCalendar(env, c, a).catch((e) => console.warn('Calendar sync failed', c.name, e));
  }
}

/** Cron (hourly): pick up calendars added or removed in Google */
export async function refreshCalendarLists(env: Env): Promise<void> {
  if (!configured(env)) return;
  const accounts = (await env.DB.prepare('SELECT * FROM google_accounts WHERE error IS NULL').all<AccountRow>()).results;
  for (const a of accounts) await refreshCalendarList(env, a).catch((e) => console.warn('Calendar list failed', a.email, e));
}

// ------------------------------------------------------------ the app's API
async function calendarsJson(env: Env): Promise<{ configured: boolean; accounts: GoogleAccount[]; calendars: Calendar[] }> {
  const [accounts, cals] = await env.DB.batch([
    env.DB.prepare('SELECT id, email, error FROM google_accounts ORDER BY created_at'),
    env.DB.prepare('SELECT id, account_id, google_id, name, color, own_color, person, by_name, is_default, emoji, shown, writable FROM calendars ORDER BY account_id, position'),
  ]);
  return {
    configured: configured(env),
    accounts: (accounts.results as { id: string; email: string; error: string | null }[]).map((a) => ({ id: a.id, email: a.email, error: !!a.error })),
    calendars: (cals.results as Omit<CalendarRow, 'events'>[]).map((c) => ({
      id: c.id, account: c.account_id, name: c.name, color: c.own_color ?? c.color, person: c.person, byName: !!c.by_name,
      isDefault: !!c.is_default, emoji: c.emoji, holidays: c.google_id.includes('#holiday@'), shown: !!c.shown, writable: !!c.writable,
    })),
  };
}

/** GET /api/calendars: connected accounts and their calendars */
export async function getCalendars(env: Env): Promise<Response> {
  return json(await calendarsJson(env));
}

/** POST /api/calendars/refresh: re-read calendar lists and all shown events now */
export async function refreshCalendars(env: Env): Promise<Response> {
  await refreshCalendarLists(env);
  await syncCalendars(env, 0);
  return json(await calendarsJson(env));
}

/**
 * PATCH /api/calendars/:id ({ person?, byName?, color?, isDefault?, emoji?, shown? }). `person`: a person
 * id, 'family' or 'none'; `color`: its own colour, or null for Google's; `isDefault`: new events go
 * here; `emoji`: shown on its events that have none of their own ('' for none).
 */
export async function editCalendar(req: Request, env: Env, id: string): Promise<Response> {
  if (!OUR_ID.test(id)) return bad('Bad calendar');
  const b = await body<{ person?: unknown; byName?: unknown; color?: unknown; isDefault?: unknown; emoji?: unknown; shown?: unknown }>(req);
  if (!b || typeof b !== 'object') return bad('Expected { person?, byName?, color?, isDefault?, emoji?, shown? }');
  if (b.emoji !== undefined && !(typeof b.emoji === 'string' && b.emoji.length <= 32)) return bad('Bad emoji');
  if (b.person !== undefined && !(typeof b.person === 'string' && PERSON.test(b.person))) return bad('Bad person');
  if (b.color !== undefined && b.color !== null && !(typeof b.color === 'string' && COLOR.test(b.color))) return bad('Bad colour');
  for (const k of ['byName', 'isDefault', 'shown'] as const) if (b[k] !== undefined && typeof b[k] !== 'boolean') return bad('Bad ' + k);
  const c = await env.DB.prepare('SELECT * FROM calendars WHERE id = ?').bind(id).first<CalendarRow>();
  if (!c) return bad('No such calendar', 404);
  const flag = (v: unknown, was: number) => (v === undefined ? was : v ? 1 : 0);
  const stmts = [
    env.DB.prepare('UPDATE calendars SET person = ?, by_name = ?, own_color = ?, is_default = ?, emoji = ?, shown = ? WHERE id = ?').bind(
      b.person ?? c.person, flag(b.byName, c.by_name), b.color === undefined ? c.own_color : b.color,
      flag(b.isDefault, c.is_default), typeof b.emoji === 'string' ? b.emoji.trim() : c.emoji, flag(b.shown, c.shown), id,
    ),
  ];
  // Only one calendar is where new events go
  if (b.isDefault === true) stmts.unshift(env.DB.prepare('UPDATE calendars SET is_default = 0 WHERE id != ?').bind(id));
  await env.DB.batch(stmts);
  // Shown just now: fetch its events, so they're there when the app asks
  if (b.shown === true && !c.shown) {
    const a = await env.DB.prepare('SELECT * FROM google_accounts WHERE id = ?').bind(c.account_id).first<AccountRow>();
    if (a && !a.error) await syncCalendar(env, c, a).catch((e) => console.warn('Calendar sync failed', c.name, e));
  }
  return new Response(null, { status: 204 });
}

/** GET /api/events: events from shown calendars; a copy that's a few minutes old is refreshed after */
export async function getEvents(env: Env, ctx: ExecutionContext): Promise<Response> {
  const rows = (await env.DB.prepare('SELECT events, synced_at FROM calendars WHERE shown = 1').all<{ events: string; synced_at: string | null }>()).results;
  const stale = rows.some((r) => !r.synced_at || Date.now() - Date.parse(r.synced_at) > STALE_MS);
  if (stale) ctx.waitUntil(syncCalendars(env, STALE_MS));
  return json({ events: rows.flatMap((r) => JSON.parse(r.events) as EventRecord[]) });
}

/** Event fields from the app, checked. `partial` allows any subset (for edits). */
export function eventFields(v: unknown, partial: boolean): Partial<EventRecord> | null {
  const b = v as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') return null;
  const out: Partial<EventRecord> = {};
  const str = (k: 'title' | 'location' | 'notes', max: number) => {
    if (b[k] === undefined) return true;
    if (typeof b[k] !== 'string' || (b[k] as string).length > max) return false;
    out[k] = (b[k] as string).trim();
    return true;
  };
  if (!str('title', 500) || !str('location', 1000) || !str('notes', 8000)) return null;
  // An emoji for it ('' for none)
  if (b.emoji !== undefined) {
    if (typeof b.emoji !== 'string' || b.emoji.length > 32) return null;
    out.emoji = b.emoji.trim();
  }
  // People chosen on the dashboard; null or [] clears the choice (whose it is comes from its calendar)
  if (b.people !== undefined) {
    if (b.people === null) out.people = [];
    else if (Array.isArray(b.people) && b.people.length <= 20 && b.people.every((p) => typeof p === 'string' && PERSON.test(p))) out.people = b.people as string[];
    else return null;
  }
  if (!partial && !out.title) return null;
  const times = ['start', 'end', 'allDay'].filter((k) => b[k] !== undefined);
  // Times change together, so they can be checked against each other
  if (times.length) {
    if (times.length !== 3 || typeof b.allDay !== 'boolean' || typeof b.start !== 'string' || typeof b.end !== 'string') return null;
    if (b.allDay ? !isDay(b.start) || !isDay(b.end) : isNaN(Date.parse(b.start)) || isNaN(Date.parse(b.end))) return null;
    if (b.allDay ? b.end <= b.start : Date.parse(b.end) < Date.parse(b.start)) return null;
    out.allDay = b.allDay;
    out.start = b.allDay ? b.start : new Date(b.start).toISOString();
    out.end = b.allDay ? b.end : new Date(b.end).toISOString();
  } else if (!partial) return null;
  return out;
}

/** Our fields → Google's. `clear`: switching between all-day and timed also blanks the other kind. */
function toGoogle(f: Partial<EventRecord>, clear: boolean): Record<string, unknown> {
  const g: Record<string, unknown> = {};
  if (f.title !== undefined) g.summary = f.title;
  if (f.location !== undefined) g.location = f.location;
  if (f.notes !== undefined) g.description = f.notes;
  if (f.people !== undefined || f.emoji !== undefined) {
    const own: Record<string, string> = {};
    if (f.people !== undefined) own[WHO] = f.people.join(',');
    if (f.emoji !== undefined) own[EMOJI] = f.emoji;
    g.extendedProperties = { private: own };
  }
  if (f.start !== undefined) {
    const t = (v: string) => (f.allDay ? { date: v, ...(clear ? { dateTime: null } : {}) } : { dateTime: v, ...(clear ? { date: null } : {}) });
    g.start = t(f.start);
    g.end = t(f.end!);
  }
  return g;
}

/** A calendar (shown, with its account) by our id */
async function calendarFor(env: Env, id: string): Promise<{ c: CalendarRow; a: AccountRow } | null> {
  if (!OUR_ID.test(id)) return null;
  const c = await env.DB.prepare('SELECT * FROM calendars WHERE id = ?').bind(id).first<CalendarRow>();
  const a = c && (await env.DB.prepare('SELECT * FROM google_accounts WHERE id = ?').bind(c.account_id).first<AccountRow>());
  return c && a ? { c, a } : null;
}

/** Change the stored copy of a calendar's events */
async function editCopy(env: Env, id: string, change: (events: EventRecord[]) => EventRecord[]): Promise<void> {
  const row = await env.DB.prepare('SELECT events FROM calendars WHERE id = ?').bind(id).first<{ events: string }>();
  if (!row) return;
  await env.DB.prepare('UPDATE calendars SET events = ? WHERE id = ?').bind(JSON.stringify(change(JSON.parse(row.events))), id).run();
}

/** A Google failure for the app. Never 401: to the app, that means this device was signed out. */
const failed = (e: unknown) =>
  e instanceof GoogleError ? bad(e.status === 401 ? e.message + '. Connect it again in Calendar settings.' : e.message, 502) : null;

/** POST /api/events ({ id, calendar, title, start, end, allDay, location?, notes? }) */
export async function addEvent(req: Request, env: Env): Promise<Response> {
  const b = await body<Record<string, unknown>>(req);
  const f = eventFields(b, false);
  if (!b || !f || typeof b.id !== 'string' || !NEW_GID.test(b.id) || typeof b.calendar !== 'string') return bad('Expected an event');
  const at = await calendarFor(env, b.calendar);
  if (!at || !at.c.writable) return bad('Can’t add to that calendar', 403);
  try {
    const e = await gapi<GEvent>(env, at.a, `/calendars/${enc(at.c.google_id)}/events`, {
      method: 'POST', body: JSON.stringify({ id: b.id, ...toGoogle(f, false) }),
    });
    const rec = toRecord(e, at.c.id)!;
    await editCopy(env, at.c.id, (list) => [...list.filter((x) => x.id !== rec.id), rec]);
    return json(rec, 201);
  } catch (e) {
    // Already there (a retry after a lost reply): fine
    if (e instanceof GoogleError && e.status === 409) return json({ ok: true });
    return failed(e) ?? Promise.reject(e);
  }
}

/** PATCH /api/events/:calendar/:id (any event fields, and `calendar` to move it to another) */
export async function editEvent(req: Request, env: Env, calId: string, gid: string): Promise<Response> {
  if (!GID.test(gid)) return bad('Bad event');
  const b = await body<Record<string, unknown>>(req);
  const f = eventFields(b, true);
  if (!b || !f) return bad('Expected event fields');
  let at = await calendarFor(env, calId);
  if (!at || !at.c.writable) return bad('Can’t change that calendar', 403);
  try {
    // Moving to another calendar (same Google account only; Google can't move between accounts)
    if (typeof b.calendar === 'string' && b.calendar !== calId) {
      const to = await calendarFor(env, b.calendar);
      if (!to || !to.c.writable || to.a.id !== at.a.id) return bad('Can’t move it to that calendar', 403);
      await gapi(env, at.a, `/calendars/${enc(at.c.google_id)}/events/${enc(gid)}/move?destination=${enc(to.c.google_id)}`, { method: 'POST' });
      await editCopy(env, at.c.id, (list) => list.filter((x) => x.id !== gid));
      at = to;
    }
    const e = await gapi<GEvent>(env, at.a, `/calendars/${enc(at.c.google_id)}/events/${enc(gid)}`, {
      method: 'PATCH', body: JSON.stringify(toGoogle(f, true)),
    });
    const rec = toRecord(e, at.c.id);
    await editCopy(env, at.c.id, (list) => [...list.filter((x) => x.id !== gid), ...(rec ? [rec] : [])]);
    return rec ? json(rec) : new Response(null, { status: 204 });
  } catch (e) {
    return failed(e) ?? Promise.reject(e);
  }
}

/** DELETE /api/events/:calendar/:id */
export async function deleteEvent(env: Env, calId: string, gid: string): Promise<Response> {
  if (!GID.test(gid)) return bad('Bad event');
  const at = await calendarFor(env, calId);
  if (!at || !at.c.writable) return bad('Can’t change that calendar', 403);
  try {
    await gapi(env, at.a, `/calendars/${enc(at.c.google_id)}/events/${enc(gid)}`, { method: 'DELETE' });
  } catch (e) {
    // Already gone from Google: just drop it here
    if (!(e instanceof GoogleError && (e.status === 404 || e.status === 410))) return failed(e) ?? Promise.reject(e);
  }
  await editCopy(env, at.c.id, (list) => list.filter((x) => x.id !== gid));
  return new Response(null, { status: 204 });
}

/**
 * POST /api/events/:calendar/:id/restore ({ ...fields, newId }): Undo a delete. Google keeps deleted
 * events as cancelled, so it's marked confirmed again (which also brings back one occurrence of a
 * repeating event); if Google won't, a one-off copy is added as `newId`.
 */
export async function restoreEvent(req: Request, env: Env, calId: string, gid: string): Promise<Response> {
  if (!GID.test(gid)) return bad('Bad event');
  const b = await body<Record<string, unknown>>(req);
  const f = eventFields(b, false);
  if (!b || !f) return bad('Expected an event');
  const at = await calendarFor(env, calId);
  if (!at || !at.c.writable) return bad('Can’t change that calendar', 403);
  let e: GEvent;
  try {
    e = await gapi<GEvent>(env, at.a, `/calendars/${enc(at.c.google_id)}/events/${enc(gid)}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'confirmed', ...toGoogle(f, true) }),
    });
  } catch (err) {
    if (typeof b.newId !== 'string' || !NEW_GID.test(b.newId)) return failed(err) ?? Promise.reject(err);
    try {
      e = await gapi<GEvent>(env, at.a, `/calendars/${enc(at.c.google_id)}/events`, {
        method: 'POST', body: JSON.stringify({ id: b.newId, ...toGoogle(f, false) }),
      });
    } catch (err2) {
      return failed(err2) ?? Promise.reject(err2);
    }
  }
  const rec = toRecord(e, at.c.id);
  await editCopy(env, at.c.id, (list) => [...list.filter((x) => x.id !== gid && x.id !== rec?.id), ...(rec ? [rec] : [])]);
  return rec ? json(rec) : new Response(null, { status: 204 });
}
