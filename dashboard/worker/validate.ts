// Checks for what the app sends, shared by the API handlers.
import { readJson } from './http';

/** Ids the app makes (src/data/store.ts newId), and the Worker's own calendar ids */
export const ID = /^[a-z0-9]{8,32}$/;
/** Photo ids (crypto.randomUUID) */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Person ids (FAMILY in worker/home.ts), plus 'any', 'family' and 'none' where those are allowed */
export const PERSON = /^[a-z0-9_-]{1,32}$/;

export const isId = (v: unknown): v is string => typeof v === 'string' && ID.test(v);

/** A string of at most `max` characters */
export const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/** An IANA time zone this runtime knows, e.g. America/Chicago */
export function validTz(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** { ids: [...] } from the app (display order), or null when it isn't that */
export async function readIds(req: Request, max: number, re = ID): Promise<string[] | null> {
  const ids = (await readJson<{ ids?: unknown }>(req))?.ids;
  return Array.isArray(ids) && ids.length <= max && ids.every((x) => typeof x === 'string' && re.test(x)) ? ids : null;
}

/**
 * Save a new order: each id's position becomes its place in `ids`. `scope` limits it to one list's
 * rows (list items), so ids from another list are left alone.
 */
export async function reorder(
  env: Env,
  table: 'lists' | 'list_items' | 'groceries' | 'photos',
  ids: string[],
  scope?: { column: 'list_id'; value: string },
): Promise<void> {
  if (!ids.length) return;
  const stmt = env.DB.prepare(
    `UPDATE ${table} SET position = ? WHERE id = ?${scope ? ` AND ${scope.column} = ?` : ''}`,
  );
  await env.DB.batch(ids.map((id, n) => (scope ? stmt.bind(n, id, scope.value) : stmt.bind(n, id))));
}
