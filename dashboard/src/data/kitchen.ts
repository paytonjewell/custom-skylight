// What's on hand: where an item is kept (Pantry, Fridge, Freezer), matching recipe ingredients to it,
// and which recipes can be made now or with a quick trip for a few things. Pure functions, used by the
// app and the Worker.
import type { Ingredient, InventoryItem, Recipe } from './types';
import { foodKey } from './names';

export const PLACES = ['Pantry', 'Fridge', 'Freezer'] as const;
export type Place = (typeof PLACES)[number];

/** Words that say where something is kept, checked in this order (frozen beats everything) */
const RULES: [RegExp, Place][] = [
  [/\b(frozen|ice cream|popsicles?|ice pops?|waffles|tater tots|pizza rolls)\b/, 'Freezer'],
  [
    /\b(milk|cream|cheese|cheddar|mozzarella|parmesan|feta|butter|yogurt|eggs?|sour cream|cream cheese|half and half)\b/,
    'Fridge',
  ],
  [
    /\b(chicken|beef|pork|turkey|bacon|sausage|ham|salami|steak|salmon|fish|shrimp|tofu|hot dogs?|deli|hummus)\b/,
    'Fridge',
  ],
  [
    /\b(lettuce|spinach|kale|broccoli|carrots?|celery|cucumbers?|peppers?|zucchini|berries|strawberries|raspberries|blueberries|grapes|lemons?|limes?|herbs|cilantro|parsley|green onions?|mushrooms?)\b/,
    'Fridge',
  ],
  [/\b(mayo|mayonnaise|ranch|salad dressing|pickles|juice|tortillas? fresh)\b/, 'Fridge'],
];
/** Grocery aisle → where it usually ends up */
const AISLE_PLACE: Record<string, Place> = {
  Dairy: 'Fridge',
  Meat: 'Fridge',
  Deli: 'Fridge',
  Frozen: 'Freezer',
  Produce: 'Fridge',
};
/** Produce that lives on the counter or in the cupboard */
const COUNTER = /\b(bananas?|potatoes?|sweet potatoes?|onions?|garlic|tomatoes?|avocados?|apples?|bread|squash)\b/;

/**
 * Where to put something new: where that name was kept before, else by what it is, else by its grocery
 * aisle (`aisle`, from the grocery list's own guess), else the pantry.
 */
export function guessPlace(name: string, learned: [string, string][], aisle?: string): Place {
  const n = name.trim().toLowerCase();
  const before = learned.find(([x]) => x === n)?.[1];
  if (before && (PLACES as readonly string[]).includes(before)) return before as Place;
  if (COUNTER.test(n) && !/frozen/.test(n)) return 'Pantry';
  for (const [re, place] of RULES) if (re.test(n)) return place;
  return (aisle && AISLE_PLACE[aisle]) || 'Pantry';
}

/** The on-hand item that's the same food as an ingredient (src/data/names.ts: "Garlic" for "minced garlic") */
export function onHand(inventory: InventoryItem[], name: string): InventoryItem | undefined {
  const want = foodKey(name);
  return inventory.find((i) => foodKey(i.name) === want);
}

/** How close a recipe is: what it still needs (pantry staples are assumed to be in the cupboard, and
 *  optional extras don't count) */
export interface Readiness {
  recipe: Recipe;
  missing: Ingredient[];
}
export function readiness(recipe: Recipe, inventory: InventoryItem[]): Readiness {
  return { recipe, missing: recipe.ingredients.filter((i) => !i.pantry && !i.optional && !onHand(inventory, i.name)) };
}

/** Every recipe's readiness, the closest first (ties: favorites, then quicker) */
export function whatCanWeMake(recipes: Recipe[], inventory: InventoryItem[]): Readiness[] {
  return recipes
    .map((r) => readiness(r, inventory))
    .sort(
      (a, b) =>
        a.missing.length - b.missing.length ||
        Number(b.recipe.favorite) - Number(a.recipe.favorite) ||
        a.recipe.minutes - b.recipe.minutes,
    );
}

/** "1 in the fridge", "2 in the pantry": how much of something is on hand, for the grocery list */
export function haveNote(inventory: InventoryItem[], name: string): string | null {
  const i = onHand(inventory, name);
  return i ? `${i.qty} in the ${i.place.toLowerCase()}` : null;
}
