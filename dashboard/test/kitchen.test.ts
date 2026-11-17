// Tests for src/data/kitchen.ts (where things are kept, matching ingredients, what can be made)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessPlace, onHand, readiness, whatCanWeMake } from '../src/data/kitchen.ts';
import { SAMPLE_RECIPES } from './fixtures/recipes.ts';
import type { InventoryItem } from '../src/data/types.ts';

test('where things go: learned first, then what it is, then its aisle', () => {
  assert.equal(guessPlace('Frozen peas', []), 'Freezer');
  assert.equal(guessPlace('ice cream', []), 'Freezer');
  assert.equal(guessPlace('milk', []), 'Fridge');
  assert.equal(guessPlace('shredded cheddar', []), 'Fridge');
  assert.equal(guessPlace('chicken thighs', []), 'Fridge');
  assert.equal(guessPlace('frozen chicken', []), 'Freezer');
  assert.equal(guessPlace('bananas', []), 'Pantry'); // counter
  assert.equal(guessPlace('onions', []), 'Pantry');
  assert.equal(guessPlace('spaghetti', []), 'Pantry');
  assert.equal(guessPlace('broccoli', []), 'Fridge');
  assert.equal(guessPlace('something odd', [], 'Frozen'), 'Freezer'); // by grocery aisle
  assert.equal(guessPlace('Ground Beef', [['ground beef', 'Freezer']]), 'Freezer'); // kept there before
});

const inv = (...names: string[]): InventoryItem[] =>
  names.map((name, i) => ({ id: 'i' + i, name, place: 'Pantry', qty: 1, note: '' }));

test('matching ingredients to what’s on hand', () => {
  const have = inv('Shredded cheddar', 'egg', 'lean ground beef', 'tortilla');
  assert.ok(onHand(have, 'cheddar'));
  assert.ok(onHand(have, 'eggs'));
  assert.ok(onHand(have, 'ground beef'));
  assert.ok(onHand(have, 'tortillas'));
  assert.equal(onHand(have, 'beef broth'), undefined);
  assert.equal(onHand(have, 'cream cheese'), undefined);
  assert.equal(onHand(inv('cream cheese', 'sour cream', 'ice cream'), 'cream'), undefined); // not the same food
});

test('what can be made: pantry staples are assumed, the closest come first', () => {
  const tacos = SAMPLE_RECIPES.find((r) => r.id === 'tacos')!;
  const have = inv('ground beef', 'taco seasoning', 'tortillas', 'cheddar', 'tomatoes', 'lettuce', 'sour cream');
  assert.deepEqual(
    readiness(tacos, have).missing.map((i) => i.name),
    ['salsa'],
  );
  const ready = whatCanWeMake(SAMPLE_RECIPES, [...have, ...inv('salsa')]);
  assert.equal(ready[0].missing.length, 0);
  assert.ok(ready.some((x) => x.recipe.id === 'tacos' && !x.missing.length));
  // Timer test only needs water, a pantry staple
  assert.equal(readiness(SAMPLE_RECIPES.find((r) => r.id === 'timer-test')!, []).missing.length, 0);
});
