// Kitchen API: recipes (with favorites and when each was last made), the dinner plan, and what's on
// hand (D1: recipes, meal_plan, inventory, inventory_names). Shared by every screen; the app changes
// its copy at once and saves here in the background (src/data/kitchenSync.ts).

import type { InventoryItem, Ingredient, Recipe } from '../src/data/types';
import { PLACES } from '../src/data/kitchen';
import { isDay } from '../src/lib/repeat';
import { bad, done, json, notFound, now, pathParts, readJson } from './http';
import { ID, isId, str } from './validate';
import { importRecipe } from './recipeImport';

const RECIPE_ID = /^[a-z0-9-]{3,40}$/;

interface RecipeRow {
  id: string;
  title: string;
  emoji: string;
  tone: number;
  tags: string;
  minutes: number;
  servings: number;
  ingredients: string;
  steps: string;
  notes: string;
  favorite: number;
  made: string | null;
  source: string;
}
const toRecipe = (r: RecipeRow): Recipe => ({
  id: r.id,
  title: r.title,
  emoji: r.emoji,
  tone: r.tone,
  tags: JSON.parse(r.tags) as string[],
  minutes: r.minutes,
  servings: r.servings,
  ingredients: JSON.parse(r.ingredients) as Ingredient[],
  steps: JSON.parse(r.steps) as string[],
  ...(r.notes ? { notes: r.notes } : {}),
  favorite: !!r.favorite,
  ...(r.made ? { made: r.made } : {}),
  ...(r.source ? { source: r.source } : {}),
});

/** GET /api/kitchen: recipes, the dinner plan, what's on hand, and where names were last kept */
async function getKitchen(env: Env): Promise<Response> {
  const [recipes, plan, inv, names, aliases] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM recipes ORDER BY position'),
    env.DB.prepare('SELECT day, recipe_id FROM meal_plan WHERE day >= ?').bind(
      new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10),
    ),
    env.DB.prepare('SELECT id, name, place, qty, note FROM inventory ORDER BY created_at'),
    env.DB.prepare('SELECT name, place FROM inventory_names'),
    env.DB.prepare('SELECT name, same_as FROM food_aliases'),
  ]);
  return json({
    recipes: (recipes.results as unknown as RecipeRow[]).map(toRecipe),
    plan: Object.fromEntries((plan.results as { day: string; recipe_id: string }[]).map((p) => [p.day, p.recipe_id])),
    inventory: inv.results as unknown as InventoryItem[],
    names: (names.results as { name: string; place: string }[]).map((n) => [n.name, n.place]),
    aliases: (aliases.results as { name: string; same_as: string }[]).map((a) => [a.name, a.same_as]),
  });
}

/** A recipe from the app, checked (null if anything's off) */
function recipeFields(v: unknown): Omit<Recipe, 'favorite' | 'made'> | null {
  const b = v as Partial<Recipe> | null;
  if (!b || typeof b !== 'object') return null;
  if (typeof b.id !== 'string' || !RECIPE_ID.test(b.id) || !str(b.title, 200) || !b.title.trim() || !str(b.emoji, 16))
    return null;
  const int = (n: unknown, lo: number, hi: number) =>
    typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi;
  if (!int(b.tone, 1, 4) || !int(b.minutes, 0, 2880) || !int(b.servings, 1, 100)) return null;
  if (!Array.isArray(b.tags) || b.tags.length > 12 || !b.tags.every((t) => str(t, 40) && t.trim())) return null;
  if (!Array.isArray(b.steps) || b.steps.length > 80 || !b.steps.every((s) => str(s, 2000) && s.trim())) return null;
  if (!Array.isArray(b.ingredients) || !b.ingredients.length || b.ingredients.length > 120) return null;
  const ingredients: Ingredient[] = [];
  for (const raw of b.ingredients as unknown[]) {
    const i = raw as Partial<Ingredient> | null;
    if (!i || !str(i.name, 200) || !i.name.trim() || !str(i.unit ?? '', 30)) return null;
    if (i.qty !== null && !(typeof i.qty === 'number' && i.qty > 0 && i.qty < 10000)) return null;
    if (i.note !== undefined && !str(i.note, 300)) return null;
    ingredients.push({
      qty: i.qty ?? null,
      unit: (i.unit ?? '').trim(),
      name: i.name.trim(),
      ...(i.note?.trim() ? { note: i.note.trim() } : {}),
      ...(i.pantry === true ? { pantry: true } : {}),
      ...(i.optional === true ? { optional: true } : {}),
    });
  }
  const notes = str(b.notes ?? '', 4000) ? (b.notes ?? '').trim() : null;
  if (notes === null) return null;
  // Where it was imported from: a web link, or nothing
  const source =
    typeof b.source === 'string' && b.source.length <= 1000 && /^https?:\/\//.test(b.source) ? b.source : '';
  if (b.source !== undefined && b.source !== '' && !source) return null;
  return {
    id: b.id,
    title: b.title.trim(),
    emoji: b.emoji,
    tone: b.tone!,
    tags: b.tags.map((t) => t.trim()),
    minutes: b.minutes!,
    servings: b.servings!,
    ingredients,
    steps: b.steps.map((s) => s.trim()),
    ...(notes ? { notes } : {}),
    ...(source ? { source } : {}),
  };
}

/** POST /api/recipes: a new recipe, last in the list */
async function addRecipe(req: Request, env: Env): Promise<Response> {
  const r = recipeFields(await readJson(req));
  if (!r) return bad('Expected a recipe');
  await env.DB.prepare(
    `INSERT OR IGNORE INTO recipes (id, title, emoji, tone, tags, minutes, servings, ingredients, steps, notes, source, favorite, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, (SELECT COALESCE(MAX(position), 0) + 1 FROM recipes), ?)`,
  )
    .bind(
      r.id,
      r.title,
      r.emoji,
      r.tone,
      JSON.stringify(r.tags),
      r.minutes,
      r.servings,
      JSON.stringify(r.ingredients),
      JSON.stringify(r.steps),
      r.notes ?? '',
      r.source ?? '',
      now(),
    )
    .run();
  return json({ ok: true }, 201);
}

/** PATCH /api/recipes/:id ({ favorite?, made? }) */
async function editRecipe(req: Request, env: Env, id: string): Promise<Response> {
  const b = await readJson<{ favorite?: unknown; made?: unknown }>(req);
  if (!b || (b.favorite === undefined && b.made === undefined)) return bad('Expected { favorite?, made? }');
  if (b.favorite !== undefined && typeof b.favorite !== 'boolean') return bad('Bad favorite');
  if (b.made !== undefined && b.made !== null && !(typeof b.made === 'string' && isDay(b.made))) return bad('Bad made');
  const sets: string[] = [],
    vals: unknown[] = [];
  if (b.favorite !== undefined) {
    sets.push('favorite = ?');
    vals.push(b.favorite ? 1 : 0);
  }
  if (b.made !== undefined) {
    sets.push('made = ?');
    vals.push(b.made);
  }
  const { meta } = await env.DB.prepare(`UPDATE recipes SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...vals, id)
    .run();
  return meta.changes ? done() : notFound('No such recipe');
}

/** PUT /api/plan/:day ({ recipe }) and DELETE /api/plan/:day */
async function setPlan(req: Request, env: Env, day: string): Promise<Response> {
  const b = await readJson<{ recipe?: unknown }>(req);
  if (!b || typeof b.recipe !== 'string' || !RECIPE_ID.test(b.recipe)) return bad('Expected { recipe }');
  const r = await env.DB.prepare('SELECT 1 FROM recipes WHERE id = ?').bind(b.recipe).first();
  if (!r) return notFound('No such recipe');
  await env.DB.prepare(
    'INSERT INTO meal_plan (day, recipe_id) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET recipe_id = excluded.recipe_id',
  )
    .bind(day, b.recipe)
    .run();
  return done();
}
async function clearPlan(env: Env, day: string): Promise<Response> {
  const { meta } = await env.DB.prepare('DELETE FROM meal_plan WHERE day = ?').bind(day).run();
  return meta.changes ? done() : notFound('Nothing planned that day');
}

// ------------------------------------------------------------ what's on hand
const isPlace = (v: unknown): v is string => typeof v === 'string' && (PLACES as readonly string[]).includes(v);
const remember = (env: Env, name: string, place: string) =>
  env.DB.prepare(
    'INSERT INTO inventory_names (name, place) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET place = excluded.place',
  ).bind(name.toLowerCase(), place);

/** POST /api/inventory ({ id, name, place, qty?, note? }) */
async function addInventory(req: Request, env: Env): Promise<Response> {
  const b = await readJson<Partial<InventoryItem>>(req);
  if (!b || typeof b.id !== 'string' || !ID.test(b.id) || !str(b.name, 200) || !b.name.trim() || !isPlace(b.place))
    return bad('Expected { id, name, place }');
  const qty = typeof b.qty === 'number' && Number.isInteger(b.qty) && b.qty >= 1 && b.qty <= 999 ? b.qty : 1;
  const note = str(b.note, 300) ? b.note : '';
  const at = now();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT OR IGNORE INTO inventory (id, name, place, qty, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(b.id, b.name.trim(), b.place, qty, note, at, at),
    remember(env, b.name.trim(), b.place),
  ]);
  return json({ ok: true }, 201);
}

/** PATCH /api/inventory/:id ({ name?, place?, qty?, note? }) */
async function editInventory(req: Request, env: Env, id: string): Promise<Response> {
  const b = await readJson<Partial<InventoryItem>>(req);
  if (!b) return bad('Expected changes');
  const sets: string[] = [],
    vals: unknown[] = [];
  if (b.name !== undefined) {
    if (!str(b.name, 200) || !b.name.trim()) return bad('Bad name');
    sets.push('name = ?');
    vals.push(b.name.trim());
  }
  if (b.place !== undefined) {
    if (!isPlace(b.place)) return bad('Bad place');
    sets.push('place = ?');
    vals.push(b.place);
  }
  if (b.qty !== undefined) {
    if (typeof b.qty !== 'number' || !Number.isInteger(b.qty) || b.qty < 1 || b.qty > 999) return bad('Bad qty');
    sets.push('qty = ?');
    vals.push(b.qty);
  }
  if (b.note !== undefined) {
    if (!str(b.note, 300)) return bad('Bad note');
    sets.push('note = ?');
    vals.push(b.note);
  }
  if (!sets.length) return bad('Expected changes');
  sets.push('updated_at = ?');
  vals.push(now());
  const stmts = [env.DB.prepare(`UPDATE inventory SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id)];
  // A move (or a rename) is remembered for next time
  if (b.place !== undefined || b.name !== undefined) {
    const row = await env.DB.prepare('SELECT name, place FROM inventory WHERE id = ?')
      .bind(id)
      .first<{ name: string; place: string }>();
    if (row) stmts.push(remember(env, b.name?.trim() ?? row.name, (b.place as string | undefined) ?? row.place));
  }
  const [changed] = await env.DB.batch(stmts);
  return changed.meta.changes ? done() : notFound('No such item');
}

/** DELETE /api/inventory/:id */
async function deleteInventory(env: Env, id: string): Promise<Response> {
  const { meta } = await env.DB.prepare('DELETE FROM inventory WHERE id = ?').bind(id).run();
  return meta.changes ? done() : notFound('No such item');
}

// ------------------------------------------------------------ taught matches
const ALIAS = /^[a-z0-9 ]{1,120}$/;
/** PUT /api/aliases ({ name, sameAs }): a recipe's name (its core) counts as an on-hand item's */
async function teach(req: Request, env: Env): Promise<Response> {
  const b = await readJson<{ name?: unknown; sameAs?: unknown }>(req);
  if (!b || typeof b.name !== 'string' || !ALIAS.test(b.name) || typeof b.sameAs !== 'string' || !ALIAS.test(b.sameAs))
    return bad('Expected { name, sameAs }');
  if (b.name === b.sameAs) return done();
  await env.DB.prepare(
    'INSERT INTO food_aliases (name, same_as, created_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET same_as = excluded.same_as',
  )
    .bind(b.name, b.sameAs, now())
    .run();
  return done();
}
/** DELETE /api/aliases ({ name }) */
async function unteach(req: Request, env: Env): Promise<Response> {
  const b = await readJson<{ name?: unknown }>(req);
  if (!b || typeof b.name !== 'string' || !ALIAS.test(b.name)) return bad('Expected { name }');
  await env.DB.prepare('DELETE FROM food_aliases WHERE name = ?').bind(b.name).run();
  return done();
}

/** /api/kitchen, /api/recipes…, /api/plan…, /api/inventory…, /api/aliases */
export async function kitchenRoute(req: Request, env: Env, path: string, m: string): Promise<Response | null> {
  if (path === '/api/kitchen' && m === 'GET') return getKitchen(env);
  if (path === '/api/recipes' && m === 'POST') return addRecipe(req, env);
  if (path === '/api/recipes/import' && m === 'POST') return importRecipe(req);
  const [recipe] = pathParts(path, '/api/recipes/*', (p) => RECIPE_ID.test(p)) ?? [];
  if (recipe && m === 'PATCH') return editRecipe(req, env, recipe);
  const [day] = pathParts(path, '/api/plan/*', isDay) ?? [];
  if (day && m === 'PUT') return setPlan(req, env, day);
  if (day && m === 'DELETE') return clearPlan(env, day);
  if (path === '/api/inventory' && m === 'POST') return addInventory(req, env);
  if (path === '/api/aliases') {
    if (m === 'PUT') return teach(req, env);
    if (m === 'DELETE') return unteach(req, env);
  }
  const [item] = pathParts(path, '/api/inventory/*', isId) ?? [];
  if (item && m === 'PATCH') return editInventory(req, env, item);
  if (item && m === 'DELETE') return deleteInventory(env, item);
  return null;
}
