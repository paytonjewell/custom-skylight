// Grocery list API (D1: groceries, grocery_names). Ids are made by the app, so changes show at once
// there and are saved here in the background, one at a time. Every name added is remembered with its
// aisle (grocery_names), so adding it again later puts it back in the same aisle. Purchased (checked
// off) items are cleared automatically after a few days: hidden from then on, and deleted by the daily cron.
import type { Grocery } from '../src/data/types';
import { AISLES, OTHER, STORES } from '../src/data/grocery';
import { bad, done, json, notFound, now, readJson } from './http';
import { ID, readIds, reorder } from './validate';

const MAX_NAME = 100;
const MAX_NOTE = 200;
const MAX_QTY = 99;
const MAX_ITEMS = 2000;
const PURCHASED_DAYS = 3; // purchased items are cleared after this long
const CATS = new Set([...AISLES, OTHER]);
const STORE_IDS = new Set(STORES.map((s) => s.id));

const isQty = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_QTY;
const isName = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= MAX_NAME;
const isNote = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_NOTE;

interface Row {
  id: string;
  name: string;
  cat: string;
  qty: number;
  store: string;
  done: number;
  note: string;
}
const toGrocery = (r: Row): Grocery => ({
  id: r.id,
  name: r.name,
  cat: r.cat,
  qty: r.qty,
  store: r.store,
  done: !!r.done,
  note: r.note,
});

/** grocery_names key: one entry per name, whatever its case or spacing */
const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** Remember a name's aisle (and count a use, when it's being added) */
const remember = (env: Env, name: string, cat: string, used: boolean) =>
  env.DB.prepare(
    `INSERT INTO grocery_names (key, name, cat, uses, last_used) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET name = excluded.name, cat = excluded.cat,
       uses = grocery_names.uses + excluded.uses, last_used = excluded.last_used`,
  ).bind(nameKey(name), name.trim(), cat, used ? 1 : 0, now());

/** Purchased before this (ISO) means cleared */
const purchasedBefore = (at = Date.now()) => new Date(at - PURCHASED_DAYS * 24 * 3600 * 1000).toISOString();

/** Daily cron: delete items purchased more than a few days ago */
export async function clearPurchased(env: Env, at = Date.now()): Promise<void> {
  await env.DB.prepare('DELETE FROM groceries WHERE done = 1 AND done_at < ?').bind(purchasedBefore(at)).run();
}

/** GET /api/groceries: { items (in order), known: [[name, aisle], …] (most used first) } */
export async function getGroceries(env: Env): Promise<Response> {
  // Items purchased over a few days ago are left out here, so they're gone on time even though the
  // daily cron (clearPurchased) only deletes them once a day, and locally, where there is no cron
  const [items, known] = await env.DB.batch([
    env.DB.prepare(
      'SELECT id, name, cat, qty, store, done, note FROM groceries WHERE NOT (done = 1 AND done_at < ?) ORDER BY position, added_at',
    ).bind(purchasedBefore()),
    env.DB.prepare('SELECT name, cat FROM grocery_names ORDER BY uses DESC, last_used DESC LIMIT 2000'),
  ]);
  return json({
    items: (items.results as unknown as Row[]).map(toGrocery),
    known: (known.results as unknown as { name: string; cat: string }[]).map((k) => [k.name, k.cat]),
  });
}

/** An item from the app, checked */
function item(v: unknown): Grocery | null {
  const g = v as Partial<Grocery> | null;
  if (!g || typeof g.id !== 'string' || !ID.test(g.id) || !isName(g.name) || !CATS.has(g.cat ?? '')) return null;
  if (!isQty(g.qty) || !STORE_IDS.has(g.store ?? '') || (g.note !== undefined && !isNote(g.note))) return null;
  return {
    id: g.id,
    name: g.name.trim(),
    cat: g.cat!,
    qty: g.qty,
    store: g.store!,
    done: g.done === true,
    note: g.note ?? '',
  };
}

/**
 * POST /api/groceries ({ id, name, cat, qty, store, note?, done? }): added at the end. Also used to
 * bring an item back with Undo (`restore: true` doesn't count it as another use).
 */
export async function addGrocery(req: Request, env: Env): Promise<Response> {
  const b = await readJson<Record<string, unknown>>(req);
  const g = item(b);
  if (!g) return bad('Expected { id, name, cat, qty, store }');
  try {
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO groceries (id, name, cat, qty, store, done, note, position, added_at, done_at) VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM groceries), ?, ?)',
      ).bind(g.id, g.name, g.cat, g.qty, g.store, g.done ? 1 : 0, g.note, now(), g.done ? now() : null),
      remember(env, g.name, g.cat, b?.restore !== true),
    ]);
  } catch (e) {
    if (String(e).includes('UNIQUE')) return bad('Already exists', 409);
    throw e;
  }
  return json({ ok: true }, 201);
}

/** PATCH /api/groceries/:id ({ qty?, done?, cat?, name?, note?, store?, used? }). A new aisle is remembered for the name. */
export async function editGrocery(req: Request, env: Env, id: string): Promise<Response> {
  const b = await readJson<Partial<Grocery> & { used?: unknown }>(req);
  if (!b) return bad('Expected a change');
  if (
    (b.qty !== undefined && !isQty(b.qty)) ||
    (b.done !== undefined && typeof b.done !== 'boolean') ||
    (b.cat !== undefined && !CATS.has(b.cat)) ||
    (b.name !== undefined && !isName(b.name)) ||
    (b.note !== undefined && !isNote(b.note)) ||
    (b.store !== undefined && !STORE_IDS.has(b.store))
  )
    return bad('Bad change');
  const cur = await env.DB.prepare('SELECT name, cat FROM groceries WHERE id = ?')
    .bind(id)
    .first<{ name: string; cat: string }>();
  if (!cur) return notFound('No such item');
  const name = b.name?.trim() ?? cur.name,
    cat = b.cat ?? cur.cat;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE groceries SET qty = COALESCE(?, qty), done = COALESCE(?, done), cat = ?, name = ?,
         note = COALESCE(?, note), store = COALESCE(?, store),
         done_at = CASE WHEN ? IS NULL THEN done_at WHEN ? = 1 THEN ? ELSE NULL END
       WHERE id = ?`,
    ).bind(
      b.qty ?? null,
      typeof b.done === 'boolean' ? (b.done ? 1 : 0) : null,
      cat,
      name,
      b.note ?? null,
      b.store ?? null,
      // checking off records when; unchecking clears it
      typeof b.done === 'boolean' ? 1 : null,
      b.done ? 1 : 0,
      now(),
      id,
    ),
    // Remember the aisle when it (or the name) changed, or when the item was added again ("used")
    ...(b.cat !== undefined || b.name !== undefined || b.used === true
      ? [remember(env, name, cat, b.used === true)]
      : []),
  ]);
  return done();
}

/** DELETE /api/groceries/:id (its name and aisle stay remembered) */
export async function deleteGrocery(env: Env, id: string): Promise<Response> {
  const { meta } = await env.DB.prepare('DELETE FROM groceries WHERE id = ?').bind(id).run();
  return meta.changes ? done() : notFound('No such item');
}

/** POST /api/groceries/clear ({ ids }): remove checked-off items in one go */
export async function clearGroceries(req: Request, env: Env): Promise<Response> {
  const ids = await readIds(req, MAX_ITEMS);
  if (!ids) return bad('Expected { ids: [...] }');
  if (ids.length) {
    const stmt = env.DB.prepare('DELETE FROM groceries WHERE id = ?');
    await env.DB.batch(ids.map((id) => stmt.bind(id)));
  }
  return done();
}

/** PUT /api/groceries/order ({ ids }: every item, in order) */
export async function orderGroceries(req: Request, env: Env): Promise<Response> {
  const ids = await readIds(req, MAX_ITEMS);
  if (!ids) return bad('Expected { ids: [...] }');
  await reorder(env, 'groceries', ids);
  return done();
}
