// Tests for src/data/recipes.ts (amounts, grocery matching, a week's shopping, times in steps)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amount, nameFor, filterRecipes, formatQty, plannedFor, shoppingFor, stepSeconds, timeWords, timerLabel } from '../src/data/recipes.ts';
import { SAMPLE_RECIPES } from './fixtures/recipes.ts';
import type { Grocery } from '../src/data/types.ts';

test('amounts read like a recipe card', () => {
  assert.equal(formatQty(1.5), '1½');
  assert.equal(formatQty(0.33), '⅓');
  assert.equal(formatQty(0.75), '¾');
  assert.equal(formatQty(2), '2');
  assert.equal(formatQty(0.97), '1');
  assert.equal(formatQty(12), '12');
  assert.equal(amount({ qty: 1, unit: 'lb', name: 'ground beef' }, 1.5), '1½ lb');
  assert.equal(amount({ qty: 8, unit: '', name: 'tortillas' }, 0.5), '4');
  assert.equal(amount({ qty: null, unit: '', name: 'salt' }), '');
  assert.equal(amount({ qty: 1, unit: 'lb', name: 'spaghetti' }, 7 / 6), '1¼ lb'); // not 1⅛
  assert.equal(amount({ qty: 1, unit: '', name: 'eggs' }, 7 / 6), '1'); // whole eggs
  assert.equal(amount({ qty: 2, unit: 'cloves', name: 'garlic' }, 7 / 6), '2 cloves');
  assert.equal(amount({ qty: 0.5, unit: 'tsp', name: 'salt' }, 0.25), '⅛ tsp');
  assert.equal(nameFor({ qty: 1, unit: '', name: 'eggs' }), 'egg');
  assert.equal(nameFor({ qty: 1, unit: '', name: 'tomatoes' }), 'tomato');
  assert.equal(nameFor({ qty: 1, unit: '', name: 'eggs' }, 2), 'eggs');
  assert.equal(nameFor({ qty: 1, unit: 'lb', name: 'potatoes' }), 'potatoes');
});

const g = (name: string, done = false): Grocery => ({ id: name, name, cat: 'Other', qty: 1, store: 'picknsave', done, note: '' });

test('a week’s shopping: each thing once, what’s on the list, and pantry staples', () => {
  const tacos = SAMPLE_RECIPES.find((r) => r.id === 'tacos')!, chili = SAMPLE_RECIPES.find((r) => r.id === 'chili')!;
  const items = shoppingFor([tacos, chili], [g('Cheddar'), g('salsa', true)]);
  const beef = items.find((x) => x.name === 'ground beef')!;
  assert.deepEqual(beef.for, ['Taco night', 'Weeknight chili']); // once, for both
  assert.equal(items.filter((x) => x.name === 'cheddar').length, 1);
  assert.equal(items.find((x) => x.name === 'cheddar')!.listed, true); // on the list (any case)
  assert.equal(items.find((x) => x.name === 'salsa')!.listed, false); // checked off doesn't count
  assert.equal(items.find((x) => x.name === 'cumin')!.pantry, true);
});

test('the plan, times in steps, and search', () => {
  const plan = { '2026-11-16': 'tacos', '2026-11-18': 'chili', '2026-11-30': 'pancakes' };
  assert.deepEqual(plannedFor({ recipes: SAMPLE_RECIPES, mealPlan: plan }, ['2026-11-16', '2026-11-17', '2026-11-18']).map((r) => r.id), ['tacos', 'chili']);
  assert.equal(stepSeconds('Simmer uncovered 40 minutes, stirring now and then.'), 2400);
  assert.equal(stepSeconds('Flip when bubbles cover the top, about 2 minutes'), 120);
  assert.equal(stepSeconds('Bake 1 hour'), 3600);
  assert.equal(stepSeconds('Wait 30 seconds.'), 30);
  assert.equal(stepSeconds('Serve topped with cheddar.'), null);
  assert.equal(timeWords(30), '30 seconds');
  assert.equal(timeWords(60), '1 minute');
  assert.equal(timeWords(5400), '1 hr 30 min');
  assert.equal(timerLabel(30), '30-second');
  assert.equal(timerLabel(60), '1-minute');
  assert.deepEqual(filterRecipes(SAMPLE_RECIPES, 'beans', 'All').map((r) => r.id), ['chili']);
  assert.ok(filterRecipes(SAMPLE_RECIPES, '', 'Quick').every((r) => r.minutes <= 30));
});

test('reading typed ingredients', async () => {
  const { parseIngredient: p, parseSteps } = await import('../src/data/recipes.ts');
  assert.deepEqual(p('1 1/2 cups flour, sifted'), { qty: 1.5, unit: 'cups', name: 'flour', note: 'sifted', pantry: true });
  assert.deepEqual(p('2 cloves garlic, minced'), { qty: 2, unit: 'cloves', name: 'garlic', note: 'minced' });
  assert.deepEqual(p('½ cup sour cream'), { qty: 0.5, unit: 'cup', name: 'sour cream' });
  assert.deepEqual(p('1½ lbs ground beef'), { qty: 1.5, unit: 'lb', name: 'ground beef' });
  assert.deepEqual(p('3 eggs'), { qty: 3, unit: '', name: 'eggs' });
  assert.deepEqual(p('1 (24 oz) jar marinara'), { qty: 1, unit: 'jar', name: 'marinara', note: '24 oz' });
  assert.deepEqual(p('salt and pepper to taste'), { qty: null, unit: '', name: 'salt and pepper', pantry: true });
  assert.deepEqual(p('blueberries (optional)'), { qty: null, unit: '', name: 'blueberries', optional: true });
  assert.deepEqual(p('2-3 Tbsp. of olive oil'), { qty: 2, unit: 'tbsp', name: 'olive oil', pantry: true });
  assert.deepEqual(p('1/2 tsp cumin'), { qty: 0.5, unit: 'tsp', name: 'cumin', pantry: true });
  assert.deepEqual(p('- 4 tortillas'), { qty: 4, unit: '', name: 'tortillas' });
  assert.deepEqual(p('1 cup shredded cheddar'), { qty: 1, unit: 'cup', name: 'cheddar', note: 'shredded' });
  assert.deepEqual(p('8 small tortillas'), { qty: 8, unit: '', name: 'tortillas', note: 'small' });
  assert.deepEqual(p('2 large boneless chicken breasts, sliced'), { qty: 2, unit: '', name: 'chicken breasts', note: 'large boneless, sliced' });
  assert.deepEqual(p('fresh'), { qty: null, unit: '', name: 'fresh' }); // a lone word stays the name
  assert.deepEqual(p('Lettuce'), { qty: null, unit: '', name: 'Lettuce' });
  assert.equal(p('   '), null);
  assert.deepEqual(parseSteps('1. Boil water.\n\nStep 2: Add pasta.\n3) Drain'), ['Boil water.', 'Add pasta.', 'Drain']);
});

test('pasted recipe text and an emoji from the title', async () => {
  const { parseRecipeText, guessEmoji } = await import('../src/data/recipes.ts');
  const r = parseRecipeText(`Jump to Recipe
Grandma's Banana Bread

Ingredients
3 ripe bananas, mashed
For the topping:
1/3 cup melted butter

Instructions
1. Heat the oven to 350°F.
2. Mix everything and bake 60 minutes.
Notes`)!;
  assert.equal(r.title, "Grandma's Banana Bread");
  assert.deepEqual(r.ingredients, ['3 ripe bananas, mashed', '1/3 cup melted butter']);
  assert.deepEqual(r.steps, ['Heat the oven to 350°F.', 'Mix everything and bake 60 minutes.']);
  assert.equal(parseRecipeText('just some words'), null);
  assert.equal(guessEmoji('The Best Soft Chocolate Chip Cookies'), '🍪');
  assert.equal(guessEmoji('One-Pot Chili Pasta'), '🍝'); // pasta before chili
  assert.equal(guessEmoji('Something new'), '🍽️');
});
