// Lists API: the lists made on the Lists screen and their items (D1: lists, list_items). Ids are made
// by the app, so changes show at once there and are saved here in the background, one at a time.
import type { Checklist, ListItem } from '../src/data/types';
import { json } from './photos';

/** Ids the app makes (src/data/store.ts newId) */
export const LIST_ID = /^[a-z0-9]{8,32}$/;
const MAX_TITLE = 200;
const MAX_TEXT = 500;
const MAX_EMOJI = 16;
const MAX_ITEMS = 2000;

const bad = (error: string, status = 400) => json({ error }, status);
const done = () => new Response(null, { status: 204 });
const body = <T>(req: Request) => req.json<T>().catch(() => null);
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const now = () => new Date().toISOString();

interface ItemRow {
  id: string;
  list_id: string;
  text: string;
  done: number;
  heading: number;
}

/** GET /api/lists: every list with its items, in order */
export async function getLists(env: Env): Promise<Response> {
  const [lists, items] = await env.DB.batch([
    env.DB.prepare('SELECT id, title, emoji FROM lists ORDER BY position, created_at'),
    env.DB.prepare('SELECT id, list_id, text, done, heading FROM list_items ORDER BY position'),
  ]);
  const byList = new Map<string, ListItem[]>();
  for (const r of items.results as unknown as ItemRow[]) {
    const item: ListItem = { id: r.id, text: r.text, done: !!r.done, ...(r.heading ? { heading: true } : {}) };
    byList.set(r.list_id, [...(byList.get(r.list_id) ?? []), item]);
  }
  const out: Checklist[] = (lists.results as unknown as { id: string; title: string; emoji: string }[]).map((l) => ({
    ...l,
    items: byList.get(l.id) ?? [],
  }));
  return json(out);
}

/** An item from the app, checked */
function item(v: unknown): ListItem | null {
  const i = v as Partial<ListItem> | null;
  if (!i || typeof i.id !== 'string' || !LIST_ID.test(i.id) || !str(i.text, MAX_TEXT) || !i.text.trim()) return null;
  return { id: i.id, text: i.text.trim(), done: i.done === true, ...(i.heading === true ? { heading: true } : {}) };
}

/**
 * POST /api/lists ({ id, title, emoji, items? }): a new list, last on the Lists screen. Items come
 * with it when a deleted list is brought back with Undo.
 */
export async function addList(req: Request, env: Env): Promise<Response> {
  const b = await body<{ id?: unknown; title?: unknown; emoji?: unknown; items?: unknown }>(req);
  if (!b || typeof b.id !== 'string' || !LIST_ID.test(b.id) || !str(b.title, MAX_TITLE) || !str(b.emoji, MAX_EMOJI))
    return bad('Expected { id, title, emoji }');
  const raw = b.items ?? [];
  if (!Array.isArray(raw) || raw.length > MAX_ITEMS) return bad('Bad items');
  const items = raw.map(item);
  if (items.some((i) => !i)) return bad('Bad items');
  const at = now();
  try {
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO lists (id, title, emoji, position, created_at, updated_at) VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM lists), ?, ?)',
      ).bind(b.id, b.title, b.emoji, at, at),
      ...items.map((i, n) =>
        env.DB.prepare(
          'INSERT INTO list_items (id, list_id, text, done, heading, position) VALUES (?, ?, ?, ?, ?, ?)',
        ).bind(i!.id, b.id, i!.text, i!.done ? 1 : 0, i!.heading ? 1 : 0, n),
      ),
    ]);
  } catch (e) {
    if (String(e).includes('UNIQUE')) return bad('Already exists', 409);
    throw e;
  }
  return json({ ok: true }, 201);
}

/** PATCH /api/lists/:id ({ title?, emoji? }) */
export async function editList(req: Request, env: Env, id: string): Promise<Response> {
  const b = await body<{ title?: unknown; emoji?: unknown }>(req);
  if (!b || (b.title !== undefined && !str(b.title, MAX_TITLE)) || (b.emoji !== undefined && !str(b.emoji, MAX_EMOJI)))
    return bad('Expected { title?, emoji? }');
  const { meta } = await env.DB.prepare(
    'UPDATE lists SET title = COALESCE(?, title), emoji = COALESCE(?, emoji), updated_at = ? WHERE id = ?',
  )
    .bind(b.title ?? null, b.emoji ?? null, now(), id)
    .run();
  return meta.changes ? done() : bad('No such list', 404);
}

/** DELETE /api/lists/:id (and its items) */
export async function deleteList(env: Env, id: string): Promise<Response> {
  const [, gone] = await env.DB.batch([
    env.DB.prepare('DELETE FROM list_items WHERE list_id = ?').bind(id),
    env.DB.prepare('DELETE FROM lists WHERE id = ?').bind(id),
  ]);
  return gone.meta.changes ? done() : bad('No such list', 404);
}

/** Parse { ids: [...] } (display order) */
async function idsFrom(req: Request): Promise<string[] | null> {
  const ids = (await body<{ ids?: unknown }>(req))?.ids;
  return Array.isArray(ids) && ids.length <= MAX_ITEMS && ids.every((x) => typeof x === 'string' && LIST_ID.test(x))
    ? ids
    : null;
}

/** PUT /api/lists/order ({ ids }) */
export async function orderLists(req: Request, env: Env): Promise<Response> {
  const ids = await idsFrom(req);
  if (!ids) return bad('Expected { ids: [...] }');
  if (ids.length) {
    const stmt = env.DB.prepare('UPDATE lists SET position = ? WHERE id = ?');
    await env.DB.batch(ids.map((id, n) => stmt.bind(n, id)));
  }
  return done();
}

/** POST /api/lists/:id/items ({ id, text, heading?, done? }): added at the end */
export async function addItem(req: Request, env: Env, listId: string): Promise<Response> {
  const i = item(await body(req));
  if (!i) return bad('Expected { id, text }');
  if (!(await env.DB.prepare('SELECT 1 FROM lists WHERE id = ?').bind(listId).first())) return bad('No such list', 404);
  try {
    await env.DB.prepare(
      'INSERT INTO list_items (id, list_id, text, done, heading, position) VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM list_items WHERE list_id = ?))',
    )
      .bind(i.id, listId, i.text, i.done ? 1 : 0, i.heading ? 1 : 0, listId)
      .run();
  } catch (e) {
    if (String(e).includes('UNIQUE')) return bad('Already exists', 409);
    throw e;
  }
  return json({ ok: true }, 201);
}

/** PATCH /api/lists/:id/items/:item ({ text?, done? }) */
export async function editItem(req: Request, env: Env, listId: string, id: string): Promise<Response> {
  const b = await body<{ text?: unknown; done?: unknown }>(req);
  const text = b?.text;
  if (
    !b ||
    (text !== undefined && (!str(text, MAX_TEXT) || !text.trim())) ||
    (b.done !== undefined && typeof b.done !== 'boolean')
  )
    return bad('Expected { text?, done? }');
  const { meta } = await env.DB.prepare(
    'UPDATE list_items SET text = COALESCE(?, text), done = COALESCE(?, done) WHERE id = ? AND list_id = ?',
  )
    .bind(
      typeof text === 'string' ? text.trim() : null,
      typeof b.done === 'boolean' ? (b.done ? 1 : 0) : null,
      id,
      listId,
    )
    .run();
  return meta.changes ? done() : bad('No such item', 404);
}

/** DELETE /api/lists/:id/items/:item */
export async function deleteItem(env: Env, listId: string, id: string): Promise<Response> {
  const { meta } = await env.DB.prepare('DELETE FROM list_items WHERE id = ? AND list_id = ?').bind(id, listId).run();
  return meta.changes ? done() : bad('No such item', 404);
}

/** PUT /api/lists/:id/items/order ({ ids }) */
export async function orderItems(req: Request, env: Env, listId: string): Promise<Response> {
  const ids = await idsFrom(req);
  if (!ids) return bad('Expected { ids: [...] }');
  if (ids.length) {
    const stmt = env.DB.prepare('UPDATE list_items SET position = ? WHERE id = ? AND list_id = ?');
    await env.DB.batch(ids.map((id, n) => stmt.bind(n, id, listId)));
  }
  return done();
}
