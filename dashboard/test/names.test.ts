// Tests for src/data/names.ts (the same food however it's written)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { core, sameFood } from '../src/data/names.ts';

test('capitals, punctuation and plurals', () => {
  assert.equal(core('Eggs'), 'egg');
  assert.equal(core('Tomatoes'), 'tomato');
  assert.equal(core('blueberries'), 'blueberry');
  assert.equal(core('Peaches'), 'peach');
  assert.equal(core('bay leaves'), 'bay leaf');
  assert.equal(core('molasses'), 'molasses'); // only looks plural
  assert.equal(core('hummus'), 'hummus');
  assert.ok(sameFood('Half & Half', 'half and half'));
});

test('prep and descriptor words don’t matter', () => {
  assert.ok(sameFood('minced garlic', 'garlic'));
  assert.ok(sameFood('3 cloves of garlic'.replace(/^\d+ /, ''), 'garlic'));
  assert.ok(sameFood('extra virgin olive oil', 'olive oil'));
  assert.ok(sameFood('boneless skinless chicken breasts', 'chicken breast'));
  assert.ok(sameFood('Shredded Cheddar Cheese', 'cheddar'));
  assert.ok(sameFood('lean ground beef', 'ground beef'));
  assert.ok(sameFood('fresh cilantro', 'cilantro'));
  assert.ok(sameFood('unsalted butter', 'butter'));
  assert.ok(sameFood('ground cumin', 'cumin'));
});

test('synonyms', () => {
  assert.ok(sameFood('marinara', 'pasta sauce'));
  assert.ok(sameFood('Marinara sauce', 'spaghetti sauce'));
  assert.ok(sameFood('vanilla extract', 'vanilla'));
  assert.ok(sameFood('scallions', 'green onions'));
  assert.ok(sameFood('garbanzo beans', 'chickpeas'));
  assert.ok(sameFood('hamburger', 'ground beef'));
  assert.ok(sameFood('all-purpose flour', 'flour'));
  assert.ok(sameFood('mayonnaise', 'mayo'));
});

test('different foods stay different', () => {
  assert.ok(!sameFood('sour cream', 'cream'));
  assert.ok(!sameFood('cream cheese', 'cheddar'));
  assert.ok(!sameFood('ice cream', 'cream'));
  assert.ok(!sameFood('ground beef', 'beef broth'));
  assert.ok(!sameFood('tortilla chips', 'tortillas'));
  assert.ok(!sameFood('garlic powder', 'garlic'));
  assert.ok(!sameFood('chicken broth', 'chicken breast'));
  assert.ok(!sameFood('peanut butter', 'butter'));
});

test('taught matches ("I have this"): a recipe’s name counts as what’s on hand', async () => {
  const { setTaught, foodKey } = await import('../src/data/names.ts');
  assert.equal(core("Rao's Marinara"), 'rao pasta sauce');
  assert.ok(!sameFood('pasta sauce', "Rao's"));
  setTaught([['pasta sauce', foodKey("Rao's")]]);
  assert.ok(sameFood('pasta sauce', "Rao's"));
  assert.ok(sameFood('marinara', "rao's")); // marinara is pasta sauce, which is now Rao's
  setTaught([]);
  assert.ok(!sameFood('pasta sauce', "Rao's"));
});
