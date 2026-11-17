// Food names, boiled down so the same thing matches however it's written: a recipe's "minced garlic"
// and the kitchen's "Garlic", "Marinara" and "pasta sauce", "eggs" and "egg". Pure functions.
//
// core(name), in order:
//   1. lowercase; apostrophes go ("Rao's" → "raos"); other punctuation and "&" become spaces ("Half & Half" → "half and half")
//   2. each word singular (tomatoes → tomato), except words that only look plural (molasses, hummus)
//   3. synonyms to one name (marinara → pasta sauce, scallion → green onion)
//   4. prep and descriptor words dropped (minced, shredded, fresh, boneless, extra virgin…), but not
//      ones that change what it is (sour cream stays sour cream)
// Two names are the same food when their cores are equal.

/** Words that only look plural */
const NOT_PLURAL = new Set([
  'molasses',
  'hummus',
  'asparagus',
  'couscous',
  'swiss',
  'citrus',
  'grits',
  'species',
  'chess',
  'brussels',
  'bass',
]);

function singular(w: string): string {
  if (w.length <= 3 || NOT_PLURAL.has(w) || w.endsWith('ss') || w.endsWith('us')) return w;
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y'; // berries
  if (/(o|ch|sh|x)es$/.test(w)) return w.slice(0, -2); // tomatoes, peaches, radishes, boxes
  if (w.endsWith('ves') && w !== 'cloves' && w !== 'olives') return w.slice(0, -3) + 'f'; // leaves, halves
  if (w.endsWith('s')) return w.slice(0, -1); // eggs, cloves
  return w;
}

/** Synonyms, written singular, longest first wins: phrase → the name used everywhere */
const SAME: [string, string][] = [
  ['marinara sauce', 'pasta sauce'],
  ['marinara', 'pasta sauce'],
  ['spaghetti sauce', 'pasta sauce'],
  ['vanilla extract', 'vanilla'],
  ['pure vanilla', 'vanilla'],
  ['scallion', 'green onion'],
  ['spring onion', 'green onion'],
  ['coriander leaf', 'cilantro'],
  ['garbanzo bean', 'chickpea'],
  ['garbanzo', 'chickpea'],
  ['confectioner sugar', 'powdered sugar'],
  ['confectioners sugar', 'powdered sugar'],
  ['icing sugar', 'powdered sugar'],
  ['hamburger meat', 'ground beef'],
  ['hamburger', 'ground beef'],
  ['ground chuck', 'ground beef'],
  ['sweet pepper', 'bell pepper'],
  ['parmigiano reggiano', 'parmesan'],
  ['catsup', 'ketchup'],
  ['half and half', 'half and half'],
  ['all purpose flour', 'flour'],
  ['ap flour', 'flour'],
  ['clove of garlic', 'garlic'],
  ['garlic clove', 'garlic'],
  ['bread crumb', 'breadcrumb'],
  ['mayonnaise', 'mayo'],
  ['chicken stock', 'chicken broth'],
  ['tortilla shell', 'tortilla'],
  ['flour tortilla', 'tortilla'],
  ['corn tortilla', 'tortilla'],
];
/** Cheese names that don't need the word "cheese" ("cheddar cheese" → "cheddar") */
const CHEESES = [
  'cheddar',
  'mozzarella',
  'parmesan',
  'feta',
  'swiss',
  'provolone',
  'colby',
  'monterey jack',
  'pepper jack',
  'gouda',
  'ricotta',
  'american',
];
/** Spices sold "ground" ("ground cumin" → "cumin") */
const SPICES = [
  'cinnamon',
  'cumin',
  'ginger',
  'nutmeg',
  'clove',
  'paprika',
  'coriander',
  'turmeric',
  'allspice',
  'mustard',
  'black pepper',
];

/** Words about how it's prepared or sold, not what it is */
const DESCRIPTORS = new Set([
  'minced',
  'chopped',
  'diced',
  'sliced',
  'shredded',
  'grated',
  'crushed',
  'cubed',
  'julienned',
  'halved',
  'quartered',
  'peeled',
  'pitted',
  'trimmed',
  'fresh',
  'freshly',
  'dried',
  'dry',
  'frozen',
  'canned',
  'jarred',
  'thawed',
  'cooked',
  'uncooked',
  'raw',
  'leftover',
  'large',
  'small',
  'medium',
  'big',
  'whole',
  'boneless',
  'skinless',
  'lean',
  'extra',
  'virgin',
  'low',
  'reduced',
  'sodium',
  'fat',
  'free',
  'unsalted',
  'salted',
  'unsweetened',
  'sweetened',
  'organic',
  'plain',
  'light',
  'packed',
  'softened',
  'melted',
  'room',
  'temperature',
  'ripe',
  'very',
  'yellow',
  'white',
  'finely',
  'roughly',
  'thinly',
  'of',
  'a',
  'the',
  'can',
  'jar',
  'package',
  'bag',
]);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The core of a food name (see the top of this file) */
export function core(name: string): string {
  let s = name
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ');
  s = s.split(/\s+/).filter(Boolean).map(singular).join(' ');
  for (const [from, to] of SAME)
    s = (' ' + s + ' ').replace(new RegExp(' ' + escape(from) + ' ', 'g'), ' ' + to + ' ').trim();
  for (const c of CHEESES) s = (' ' + s + ' ').replace(' ' + c + ' cheese ', ' ' + c + ' ').trim();
  for (const sp of SPICES) s = (' ' + s + ' ').replace(' ground ' + sp + ' ', ' ' + sp + ' ').trim();
  const words = s.split(' ').filter((w) => w && !DESCRIPTORS.has(w));
  // Nothing but descriptors (e.g. "large"): keep what was there
  return words.length ? words.join(' ') : s;
}

/** Matches the family taught ("I have this"): core → the core it counts as. Set from the kitchen data. */
let taught = new Map<string, string>();
export function setTaught(pairs: [string, string][]): void {
  taught = new Map(pairs);
}

/** The key two names share when they're the same food: the core, after any taught match */
export const foodKey = (name: string): string => {
  const c = core(name);
  return taught.get(c) ?? c;
};

/** Are these the same food? */
export const sameFood = (a: string, b: string): boolean => foodKey(a) === foodKey(b);
