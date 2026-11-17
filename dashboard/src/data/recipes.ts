// Recipes: amounts (scaled to servings, written as kitchen fractions), what's already on the grocery
// list, a week's shopping, and cooking times found in steps (for Cook mode's timers). Pure functions.
import type { Data, Grocery, Ingredient, InventoryItem, Recipe } from './types';
import { onHand } from './kitchen';
import { foodKey } from './names';

/** Kitchen fractions, by how close a remainder is to each (eighths only for small amounts) */
const FRACTIONS: [number, string][] = [
  [0, ''],
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [1 / 2, '½'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
  [1, ''],
];
const SMALL: [number, string][] = [[1 / 8, '⅛'], ...FRACTIONS];

/** 1.5 → "1½", 0.33 → "⅓", 2 → "2", 0.1 → "⅛", 1.17 → "1¼" */
export function formatQty(n: number): string {
  if (n >= 10) return String(Math.round(n));
  const whole = Math.floor(n);
  const rest = n - whole;
  const [f, sym] = (whole ? FRACTIONS : SMALL).reduce((best, x) =>
    Math.abs(x[0] - rest) < Math.abs(best[0] - rest) ? x : best,
  );
  const w = whole + (f === 1 ? 1 : 0);
  if (!sym) return String(w || (n > 0 ? '⅛' : 0));
  return (w ? String(w) : '') + sym;
}

/** Units that come whole */
const WHOLE = /^(cloves?|cans?|jars?|packets?|packages?|boxes?|bags?)$/;

/** "1½ lb ground beef", scaled by `factor` (to taste: just the name) */
export function amount(i: Ingredient, factor = 1): string {
  if (i.qty === null) return '';
  // Counted things (eggs, tortillas, cloves, cans) in whole numbers; at least one
  const n = i.qty * factor;
  const q = formatQty((!i.unit || WHOLE.test(i.unit)) && i.qty >= 1 ? Math.max(1, Math.round(n)) : n);
  return i.unit ? `${q} ${i.unit}` : q;
}

/** An ingredient's name as written with its amount: one of a counted thing is singular ("1 egg") */
export function nameFor(i: Ingredient, factor = 1): string {
  if (i.unit || i.qty === null || (i.qty >= 1 ? Math.round(i.qty * factor) : i.qty * factor) > 1) return i.name;
  return i.name
    .replace(/ies$/, 'y')
    .replace(/oes$/, 'o')
    .replace(/([^s])s$/, '$1');
}

/** The open grocery item that's the same food as an ingredient, if it's on the list */
export function onList(groceries: Grocery[], name: string): Grocery | undefined {
  const want = foodKey(name);
  return groceries.find((g) => !g.done && foodKey(g.name) === want);
}

/** One thing to buy for some recipes: its name, which recipes need it, and if it's a pantry staple */
export interface ShopItem {
  name: string;
  for: string[];
  pantry: boolean;
  /** Already on the grocery list */
  listed: boolean;
  /** Already in the kitchen (Inventory) */
  have: boolean;
  /** Only optional in every recipe that has it */
  optional: boolean;
}

/** What some recipes need, once each (the same name in two recipes is one item), in order of first use */
export function shoppingFor(recipes: Recipe[], groceries: Grocery[], inventory: InventoryItem[] = []): ShopItem[] {
  const by = new Map<string, ShopItem>();
  for (const r of recipes) {
    for (const i of r.ingredients) {
      // The same food in two recipes ("garlic", "minced garlic") is one thing to buy
      const key = foodKey(i.name);
      const had = by.get(key);
      if (had) {
        if (!had.for.includes(r.title)) had.for.push(r.title);
        had.pantry &&= !!i.pantry;
        had.optional &&= !!i.optional;
      } else {
        by.set(key, {
          name: i.name,
          for: [r.title],
          pantry: !!i.pantry,
          listed: !!onList(groceries, i.name),
          have: !!onHand(inventory, i.name),
          optional: !!i.optional,
        });
      }
    }
  }
  return [...by.values()];
}

/** Recipes planned for the days given, in day order (days with nothing planned are skipped) */
export const plannedFor = (d: Pick<Data, 'recipes' | 'mealPlan'>, days: string[]): Recipe[] =>
  days.flatMap((day) => {
    const r = d.recipes.find((x) => x.id === d.mealPlan[day]);
    return r ? [r] : [];
  });

/** A time a step mentions, in seconds ("simmer 40 minutes", "about 2 minutes", "1 hour", "30 seconds") */
export function stepSeconds(step: string): number | null {
  const m = step.match(/(\d+(?:\.\d+)?)\s*(?:–|-|to)?\s*(?:\d+\s*)?(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  return Math.round(unit.startsWith('h') ? n * 3600 : unit.startsWith('s') ? n : n * 60);
}

/** For a button: "30-second", "1-minute", "90-minute" */
export function timerLabel(secs: number): string {
  return secs < 60 ? `${secs}-second` : `${Math.round(secs / 60)}-minute`;
}

/** "30 seconds", "1 minute", "1 hr 30 min" */
export function timeWords(secs: number): string {
  if (secs < 60) return `${secs} seconds`;
  const h = Math.floor(secs / 3600),
    m = Math.round((secs % 3600) / 60);
  if (!h) return m === 1 ? '1 minute' : `${m} minutes`;
  return `${h} hr${m ? ` ${m} min` : ''}`;
}

/** Recipes matching a search (title, tags or ingredients) and a filter chip */
export function filterRecipes(recipes: Recipe[], query: string, filter: string): Recipe[] {
  const q = query.trim().toLowerCase();
  return recipes.filter((r) => {
    if (filter === 'Favorites' && !r.favorite) return false;
    if (filter === 'Quick' && r.minutes > 30) return false;
    if (filter !== 'All' && filter !== 'Favorites' && filter !== 'Quick' && !r.tags.includes(filter)) return false;
    if (!q) return true;
    return (
      r.title.toLowerCase().includes(q) ||
      r.tags.some((t) => t.toLowerCase().includes(q)) ||
      r.ingredients.some((i) => i.name.toLowerCase().includes(q))
    );
  });
}

// ------------------------------------------------------------ reading what's typed into a new recipe
const UNICODE_FRACTIONS: Record<string, number> = {
  '¼': 0.25,
  '½': 0.5,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};
/** Ways to write a unit → how it's kept */
const UNITS: Record<string, string> = {
  cup: 'cup',
  cups: 'cups',
  c: 'cup',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  tbsp: 'tbsp',
  tbs: 'tbsp',
  tbl: 'tbsp',
  T: 'tbsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  tsp: 'tsp',
  t: 'tsp',
  pound: 'lb',
  pounds: 'lb',
  lb: 'lb',
  lbs: 'lb',
  ounce: 'oz',
  ounces: 'oz',
  oz: 'oz',
  gram: 'g',
  grams: 'g',
  g: 'g',
  kilogram: 'kg',
  kg: 'kg',
  ml: 'ml',
  milliliter: 'ml',
  milliliters: 'ml',
  liter: 'l',
  liters: 'l',
  l: 'l',
  can: 'can',
  cans: 'cans',
  jar: 'jar',
  jars: 'jars',
  packet: 'packet',
  packets: 'packets',
  package: 'package',
  packages: 'packages',
  pkg: 'package',
  box: 'box',
  boxes: 'boxes',
  bag: 'bag',
  bags: 'bags',
  bottle: 'bottle',
  bottles: 'bottles',
  clove: 'clove',
  cloves: 'cloves',
  head: 'head',
  heads: 'heads',
  bunch: 'bunch',
  bunches: 'bunches',
  stalk: 'stalk',
  stalks: 'stalks',
  slice: 'slice',
  slices: 'slices',
  stick: 'stick',
  sticks: 'sticks',
  sprig: 'sprig',
  sprigs: 'sprigs',
  pinch: 'pinch',
  dash: 'dash',
  quart: 'quart',
  quarts: 'quarts',
  pint: 'pint',
  pints: 'pints',
  gallon: 'gallon',
  gallons: 'gallons',
};
/** Usually in the cupboard: start as "Pantry" (not bought for every recipe) */
const STAPLES =
  /^(salt|pepper|black pepper|salt and pepper|kosher salt|sea salt|olive oil|vegetable oil|canola oil|cooking spray|oil|flour|sugar|brown sugar|baking soda|baking powder|cornstarch|vanilla|water|ice|cinnamon|cumin|paprika|chili powder|garlic powder|onion powder|oregano|basil|thyme|italian seasoning|red pepper flakes|nutmeg|bay leaf|honey|vinegar|soy sauce)$/;

/** Words before an ingredient's name that say its size or prep */
const LEAD =
  /^(small|medium|large|extra-large|fresh|freshly|shredded|grated|minced|chopped|diced|sliced|cubed|crushed|boneless|skinless|ripe|softened|melted|cold|warm|uncooked|cooked)\s+/i;

/** "1", "1.5", "1/2", "1 1/2", "½", "1½", "2-3" (the first) → a number; with what's left after it */
function readQty(s: string): { qty: number | null; rest: string } {
  const m = s.match(
    /^(\d+(?:\.\d+)?)?\s*([¼½¾⅓⅔⅛⅜⅝⅞])?(?:\s*(\d+)\/(\d+)|\/(\d+))?(?:\s*(?:-|–|to)\s*[\d½¼¾⅓⅔/ ]+)?\s*/,
  );
  if (!m?.[0].trim()) return { qty: null, rest: s };
  let n = 0;
  if (m[5] && m[1])
    n = Number(m[1]) / Number(m[5]); // "1/2"
  else {
    if (m[1]) n += Number(m[1]);
    if (m[2]) n += UNICODE_FRACTIONS[m[2]];
    if (m[3] && m[4]) n += Number(m[3]) / Number(m[4]); // "1 1/2"
  }
  return n > 0 ? { qty: Math.round(n * 1000) / 1000, rest: s.slice(m[0].length) } : { qty: null, rest: s };
}

/**
 * One typed ingredient line → an ingredient: "1 1/2 cups flour, sifted", "2 cloves garlic, minced",
 * "salt and pepper to taste", "1 (24 oz) jar marinara", "blueberries (optional)".
 */
export function parseIngredient(line: string): Ingredient | null {
  let s = line.trim().replace(/^[-•*]\s*/, '');
  if (!s) return null;
  const optional = /\(?\boptional\b\)?/i.test(s);
  s = s.replace(/,?\s*\(?\boptional\b\)?/i, '');
  const toTaste = /\bto taste\b/i.test(s);
  s = s.replace(/,?\s*\bto taste\b/i, '');
  const { qty, rest } = readQty(s);
  s = rest;
  // A size in brackets ("(24 oz)") is a note
  const notes: string[] = [];
  s = s
    .replace(/\(([^)]*)\)/g, (_, inner: string) => {
      if (inner.trim()) notes.push(inner.trim());
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
  let unit = '';
  const word = s.match(/^([A-Za-z]+)\.?\s+/);
  if (word && qty !== null) {
    const u = UNITS[word[1]] ?? UNITS[word[1].toLowerCase()];
    if (u) {
      unit = u;
      s = s.slice(word[0].length).replace(/^of\s+/i, '');
    }
  }
  const comma = s.indexOf(',');
  if (comma > 0) {
    notes.unshift(s.slice(comma + 1).trim());
    s = s.slice(0, comma).trim();
  }
  // Size and prep words before the name go to the note ("1 cup shredded cheddar" → cheddar, shredded),
  // so the grocery list gets the plain name
  let name = s.trim();
  const lead: string[] = [];
  for (let m = name.match(LEAD); m && name.length > m[0].length; m = name.match(LEAD)) {
    lead.push(m[1].toLowerCase());
    name = name.slice(m[0].length);
  }
  if (lead.length) notes.unshift(lead.join(' '));
  if (!name) return null;
  const note = notes.filter(Boolean).join(', ');
  return {
    qty: toTaste ? null : qty,
    unit: toTaste ? '' : unit,
    name,
    ...(note ? { note } : {}),
    ...(STAPLES.test(name.toLowerCase()) ? { pantry: true } : {}),
    ...(optional ? { optional: true } : {}),
  };
}

/** Typed steps: one per line (blank lines and pasted numbering like "1." or "Step 2:" dropped) */
export const parseSteps = (text: string): string[] =>
  text
    .split('\n')
    .map((l) =>
      l
        .trim()
        .replace(/^(?:step\s*)?\d+[.):]\s*/i, '')
        .trim(),
    )
    .filter(Boolean);

/**
 * A recipe's text copied from a web page or a note: a title, then "Ingredients" and "Instructions"
 * (or Directions, Method, Steps) headings with lines under each. Null if it has no ingredients heading.
 */
export function parseRecipeText(text: string): { title: string; ingredients: string[]; steps: string[] } | null {
  const lines = text.split('\n').map((l) => l.trim());
  const isIng = (l: string) => /^ingredients?\s*:?$/i.test(l);
  const isSteps = (l: string) => /^(instructions?|directions?|method|steps|preparation|how to make it)\s*:?$/i.test(l);
  const ing = lines.findIndex(isIng);
  if (ing < 0) return null;
  const st = lines.findIndex((l, i) => i > ing && isSteps(l));
  const title = lines.slice(0, ing).find((l) => l && !/^(print|jump to|save|pin|rate)/i.test(l)) ?? '';
  // Within a section, a short line ending in ":" ("For the sauce:") is a sub-heading, not an item
  const items = (from: number, to: number) => lines.slice(from, to).filter((l) => l && !/^[^,.]{1,40}:$/.test(l));
  return {
    title,
    ingredients: items(ing + 1, st < 0 ? lines.length : st),
    steps:
      st < 0
        ? []
        : items(st + 1, lines.length)
            .map((l) => l.replace(/^(?:step\s*)?\d+[.):]\s*/i, ''))
            .filter((l) => !/^notes?\s*:?$/i.test(l)),
  };
}

/** An emoji for a recipe from its title ("Chocolate chip cookies" → 🍪) */
const EMOJI_WORDS: [RegExp, string][] = [
  [/cookie/i, '🍪'],
  [/cake|cupcake/i, '🧁'],
  [/brownie|chocolate/i, '🍫'],
  [/pie\b|tart/i, '🥧'],
  [/pizza/i, '🍕'],
  [/taco|burrito|quesadilla|enchilada/i, '🌮'],
  [/spaghetti|pasta|lasagna|noodle|mac\b|macaroni|penne|ziti/i, '🍝'],
  [/soup|stew|chowder/i, '🍲'],
  [/chili/i, '🌶️'],
  [/curry/i, '🍛'],
  [/salad/i, '🥗'],
  [/burger/i, '🍔'],
  [/sandwich|panini|sub\b/i, '🥪'],
  [/pancake|waffle/i, '🥞'],
  [/egg|omelet|frittata|quiche/i, '🍳'],
  [/bread|loaf|roll/i, '🍞'],
  [/muffin|scone/i, '🧁'],
  [/smoothie|shake/i, '🥤'],
  [/salmon|fish|cod|tilapia/i, '🐟'],
  [/shrimp|prawn/i, '🍤'],
  [/chicken|turkey/i, '🍗'],
  [/steak|beef|roast/i, '🥩'],
  [/pork|bacon|ham/i, '🥓'],
  [/rice|risotto/i, '🍚'],
  [/potato|fries/i, '🥔'],
  [/corn/i, '🌽'],
  [/banana/i, '🍌'],
  [/apple/i, '🍎'],
  [/strawberr/i, '🍓'],
  [/lemon/i, '🍋'],
  [/cheese/i, '🧀'],
  [/dumpling|potsticker/i, '🥟'],
  [/sushi/i, '🍣'],
];
export const guessEmoji = (title: string): string => EMOJI_WORDS.find(([re]) => re.test(title))?.[1] ?? '🍽️';
