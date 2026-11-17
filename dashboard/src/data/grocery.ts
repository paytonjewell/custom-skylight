// Grocery presets, the same everywhere (local and production): each store's aisles in walking order,
// the stores, the usual items, and starter guesses for which aisle an item belongs in. Used by the app
// and by the Worker (worker/groceries.ts), which checks items against them.

import type { GroceryStore } from './types';

/** The first store is the default for new items (unless another store's list is showing) */
export const STORES: GroceryStore[] = [
  { id: 'picknsave', name: 'PickNSave', short: 'PNS' },
  { id: 'aldi', name: 'Aldi' },
];

/**
 * Each store's aisles as it's laid out, in walking order. Every store lists every aisle, so an item
 * always has a heading to show under.
 * Items in no aisle go under 'Other', last.
 */
export const AISLE_ORDER: Record<string, string[]> = {
  picknsave: ['Produce', 'Deli', 'Bakery', 'Meat', 'Condiments', 'Pantry', 'Household', 'Snacks', 'Beverages', 'Dairy', 'Frozen'],
  aldi: ['Produce', 'Bakery', 'Snacks', 'Condiments', 'Dairy', 'Pantry', 'Household', 'Meat', 'Deli', 'Beverages', 'Frozen'],
};
/** "All" follows the first store's layout */
AISLE_ORDER.all = AISLE_ORDER[STORES[0].id];
/** Every aisle */
export const AISLES = AISLE_ORDER.all;
export const OTHER = 'Other';

/** Quick-add tiles, in this order (three to a row). Lowercase, except brand names. */
export const USUALS = [
  'milk', 'eggs', 'bananas', 'raspberries', 'strawberries', 'diapers', 'wipes', 'Redbull', 'Monster',
  'string cheese', 'Veggie Straws', 'frozen sausage', 'apple juice', 'ground beef', 'chicken breast',
];

/**
 * Starter aisle guesses for names never added before, spelled as items should show (lowercase, except
 * brand names and acronyms). Once a name has been added, the aisle it was
 * last in is remembered on the server (grocery_names) and used instead.
 */
const STARTER: Record<string, string[]> = {
  Produce: ['raspberries', 'apples', 'avocados', 'bananas', 'baby spinach', 'blueberries', 'broccoli', 'carrots', 'cucumber', 'garlic', 'grapes', 'lemons', 'limes', 'onions', 'potatoes', 'strawberries', 'tomatoes'],
  Deli: ['sliced turkey', 'sliced ham', 'salami', 'rotisserie chicken', 'hummus'],
  Bakery: ['bread', 'bagels', 'croissants', 'sourdough loaf', 'tortillas', 'hamburger buns'],
  Meat: ['chicken breast', 'bacon', 'chicken breasts', 'chicken thighs', 'ground beef', 'salmon fillets', 'shrimp'],
  Pantry: ['black beans', 'cereal', 'coffee beans', 'flour', 'honey', 'maple syrup', 'olive oil', 'pasta sauce', 'peanut butter', 'rice', 'rigatoni', 'spaghetti', 'sugar', 'tea'],
  Condiments: ['ketchup', 'mustard', 'mayo', 'ranch', 'BBQ sauce', 'hot sauce', 'salad dressing', 'pickles', 'soy sauce', 'salsa'],
  Household: ['diapers', 'wipes', 'dish soap', 'dishwasher pods', 'garbage bags', 'laundry detergent', 'paper towels', 'toilet paper', 'toothpaste'],
  Snacks: ['Veggie Straws', 'chips', 'crackers', 'dark chocolate', 'Goldfish crackers', 'granola bars', 'popcorn'],
  Beverages: ['Redbull', 'Monster', 'sparkling water', 'orange juice', 'apple juice', 'soda'],
  Dairy: ['milk', 'string cheese', 'butter', 'cheddar', 'cream cheese', 'eggs', 'greek yogurt', 'milk 2%', 'oat milk', 'parmesan'],
  Frozen: ['frozen sausage', 'frozen peas', 'frozen berries', 'ice cream', 'pizza', 'waffles'],
};
/** [name, aisle] for every starter item */
export const CATALOG: [string, string][] = Object.entries(STARTER).flatMap(([aisle, names]) => names.map((n): [string, string] => [n, aisle]));
