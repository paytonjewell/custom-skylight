// Import a recipe from a web page. Recipe sites publish the recipe as schema.org "Recipe" data in the
// page (JSON-LD, for search engines): name, ingredients, steps, times, servings. This reads that; the
// app fills its New recipe form from it for review. No AI and nothing guessed from the page's layout.
//
// The request says who it is (it doesn't pretend to be a browser). Sites that turn away apps get a
// clear answer, and the app offers pasting the recipe's text instead.
import type { ImportedRecipe } from '../src/data/types';
import { json, readJson } from './http';
import { NotPublic, fetchPublic, isPublicUrl } from './outbound';

const UA = 'WhiteLotusHQ/1.0 (family dashboard; imports a recipe someone shared)';
const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

type Json = unknown;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  deg: '°',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
};
/** Plain text: no tags or entities, spaces tidied */
function plain(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, (m, e: string) =>
      e[0] === '#'
        ? String.fromCodePoint(
            parseInt(e.slice(e[1] === 'x' || e[1] === 'X' ? 2 : 1), e[1] === 'x' || e[1] === 'X' ? 16 : 10),
          )
        : (ENTITIES[e.toLowerCase()] ?? m),
    )
    .replace(/\s+/g, ' ')
    .trim();
}

const asArray = (v: Json): Json[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const isRecipe = (v: Json): v is Record<string, Json> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return asArray((v as Record<string, Json>)['@type']).some((t) => t === 'Recipe');
};

/** The first schema.org Recipe in a page's JSON-LD blocks (inside @graph, lists, mainEntity…) */
export function findRecipe(html: string): Record<string, Json> | null {
  const blocks = [...html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)].map(
    (m) => m[1],
  );
  const walk = (v: Json, depth = 0): Record<string, Json> | null => {
    if (depth > 8 || !v || typeof v !== 'object') return null;
    if (isRecipe(v)) return v;
    for (const x of Array.isArray(v) ? v : Object.values(v)) {
      const found = walk(x, depth + 1);
      if (found) return found;
    }
    return null;
  };
  for (const b of blocks) {
    try {
      const found = walk(JSON.parse(b.trim()));
      if (found) return found;
    } catch {
      // a broken block: try the next
    }
  }
  return null;
}

/** "PT1H30M" → 90 */
export function isoMinutes(v: Json): number | null {
  if (typeof v !== 'string') return null;
  const m = v.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m || !(m[1] || m[2] || m[3])) return null;
  return (Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0);
}

/** Steps from recipeInstructions: text, a list of text, HowToSteps, or HowToSections of steps */
export function readSteps(v: Json): string[] {
  const out: string[] = [];
  const add = (x: Json) => {
    if (typeof x === 'string') {
      // One block of text: split into its lines (or sentences, if it's all one line)
      const parts = x.includes('\n') ? x.split(/\n+/) : [x];
      for (const p of parts.map(plain).filter(Boolean)) out.push(p.replace(/^(?:step\s*)?\d+[.):]\s*/i, ''));
      return;
    }
    if (!x || typeof x !== 'object') return;
    const o = x as Record<string, Json>;
    if (o.itemListElement) return asArray(o.itemListElement).forEach(add); // a section of steps
    const text = typeof o.text === 'string' ? o.text : typeof o.name === 'string' ? o.name : '';
    if (text) add(text);
  };
  asArray(v).forEach(add);
  return out.filter(Boolean);
}

/** "4 servings", 4, ["6", "6 slices"] → 4; "2 dozen cookies" → 24 */
export function readServings(v: Json): number | null {
  for (const x of asArray(v)) {
    const dozen = typeof x === 'string' && x.match(/(\d+(?:\.\d+)?)\s*dozen/i);
    if (dozen) return Math.round(Number(dozen[1]) * 12);
  }
  for (const x of asArray(v)) {
    const n = typeof x === 'number' ? x : typeof x === 'string' ? parseInt(x.match(/\d+/)?.[0] ?? '', 10) : NaN;
    if (Number.isFinite(n) && n > 0 && n <= 100) return Math.round(n);
  }
  return null;
}

/** The site's categories and keywords → the app's tags */
const TAG_WORDS: [RegExp, string][] = [
  [/\b(dinner|main|entree|entrée|supper)\b/i, 'Dinner'],
  [/\blunch\b/i, 'Lunch'],
  [/\bbreakfast|brunch\b/i, 'Breakfast'],
  [/\b(side|sides|side dish)\b/i, 'Side'],
  [/\b(dessert|cookie|cake|pie|brownie)s?\b/i, 'Dessert'],
  [/\b(baking|bread|muffin)s?\b/i, 'Baking'],
  [/\b(kid|kids|kid-friendly|family)\b/i, "Kids' pick"],
  [/\b(make[- ]ahead|freezer)\b/i, 'Make ahead'],
];
function readTags(r: Record<string, Json>, minutes: number | null): string[] {
  const words = [...asArray(r.recipeCategory), ...asArray(r.keywords)]
    .filter((x): x is string => typeof x === 'string')
    .join(', ');
  const tags = TAG_WORDS.filter(([re]) => re.test(words)).map(([, t]) => t);
  if (minutes !== null && minutes <= 30) tags.push('Quick');
  return [...new Set(tags)];
}

/** A schema.org Recipe → what the form needs */
export function toImported(r: Record<string, Json>, source: string): ImportedRecipe {
  const total = isoMinutes(r.totalTime);
  const parts = (isoMinutes(r.prepTime) ?? 0) + (isoMinutes(r.cookTime) ?? 0);
  const minutes = total ?? (parts || null);
  const ingredients = asArray(r.recipeIngredient ?? r.ingredients)
    .filter((x): x is string => typeof x === 'string')
    .map(plain)
    .filter(Boolean);
  return {
    title: plain(typeof r.name === 'string' ? r.name : ''),
    ingredients,
    steps: readSteps(r.recipeInstructions),
    minutes,
    servings: readServings(r.recipeYield),
    tags: readTags(r, minutes),
    source,
  };
}

/** Read a response body up to MAX_BYTES */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(Math.min(size, MAX_BYTES));
  let at = 0;
  for (const c of chunks) {
    all.set(c.subarray(0, all.length - at), at);
    at += c.length;
    if (at >= all.length) break;
  }
  return new TextDecoder().decode(all);
}

/** POST /api/recipes/import ({ url }) → the recipe's parts, or why it couldn't be read */
export async function importRecipe(req: Request): Promise<Response> {
  const b = await readJson<{ url?: unknown }>(req);
  let url: URL;
  try {
    url = new URL(typeof b?.url === 'string' ? b.url.trim() : '');
  } catch {
    return json({ error: 'That doesn’t look like a link.' }, 400);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    return json({ error: 'That doesn’t look like a web link.' }, 400);
  if (!isPublicUrl(url)) return json({ error: 'That link can’t be read.' }, 400);

  let res: Response;
  try {
    ({ res, url } = await fetchPublic(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }));
  } catch (e) {
    // A redirect to somewhere private
    if (e instanceof NotPublic) return json({ error: 'That link can’t be read.' }, 400);
    return json({ error: 'Couldn’t reach that page.', reason: 'unreachable' }, 502);
  }
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    return json({ error: 'That site doesn’t let apps read its recipes.', reason: 'blocked' }, 422);
  }
  if (!res.ok) return json({ error: `That page didn’t load (${res.status}).`, reason: 'missing' }, 422);
  const recipe = findRecipe(await readCapped(res));
  if (!recipe) return json({ error: 'No recipe found on that page.', reason: 'none' }, 422);
  const out = toImported(recipe, url.toString());
  if (!out.title || !out.ingredients.length)
    return json({ error: 'That page’s recipe is missing its ingredients.', reason: 'none' }, 422);
  return json(out);
}
