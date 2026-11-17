// Tests for worker/recipeImport.ts (reading schema.org Recipe data from a page)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRecipe, isoMinutes, readServings, readSteps, toImported } from '../worker/recipeImport.ts';

const page = (data: unknown) => `<html><head><script type="application/ld+json">${JSON.stringify(data)}</script></head><body>…</body></html>`;

test('finds the Recipe, wherever the page puts it', () => {
  const recipe = { '@type': 'Recipe', name: 'Cookies' };
  assert.equal(findRecipe(page(recipe))?.name, 'Cookies');
  assert.equal(findRecipe(page({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, recipe] }))?.name, 'Cookies');
  assert.equal(findRecipe(page([{ '@type': 'Organization' }, { '@type': ['Recipe', 'NewsArticle'], name: 'Both' }]))?.name, 'Both');
  assert.equal(findRecipe('<script type="application/ld+json">{ broken</script>' + page(recipe))?.name, 'Cookies');
  assert.equal(findRecipe(page({ '@type': 'WebPage' })), null);
});

test('times, servings and steps in their many shapes', () => {
  assert.equal(isoMinutes('PT1H30M'), 90);
  assert.equal(isoMinutes('PT45M'), 45);
  assert.equal(isoMinutes('P0DT2H'), 120);
  assert.equal(isoMinutes(''), null);
  assert.equal(readServings('4 servings'), 4);
  assert.equal(readServings(['24', '24 cookies']), 24);
  assert.equal(readServings(6), 6);
  assert.equal(readServings(['2', '2 dozen cookies']), 24);
  assert.deepEqual(readSteps('Mix.\nBake.'), ['Mix.', 'Bake.']);
  assert.deepEqual(readSteps([{ '@type': 'HowToStep', text: 'Heat the oven &amp; grease a pan.' }, { '@type': 'HowToStep', text: '<p>Bake 20 minutes.</p>' }]), ['Heat the oven & grease a pan.', 'Bake 20 minutes.']);
  assert.deepEqual(readSteps([{ '@type': 'HowToSection', name: 'Dough', itemListElement: [{ '@type': 'HowToStep', text: 'Mix.' }] }, '2. Rest.']), ['Mix.', 'Rest.']);
});

test('a Recipe becomes the form’s fields', () => {
  const r = toImported({
    '@type': 'Recipe', name: 'The Best Soft Chocolate Chip Cookies', recipeIngredient: ['2 1/4 cups (281g) all-purpose flour', '1 teaspoon baking soda'],
    recipeInstructions: [{ '@type': 'HowToStep', text: 'Whisk the flour and baking soda.' }], prepTime: 'PT20M', cookTime: 'PT10M', recipeYield: ['24', '24 cookies'],
    recipeCategory: 'Dessert', keywords: 'cookies, baking',
  }, 'https://example.com/cookies');
  assert.deepEqual(r, {
    title: 'The Best Soft Chocolate Chip Cookies', ingredients: ['2 1/4 cups (281g) all-purpose flour', '1 teaspoon baking soda'],
    steps: ['Whisk the flour and baking soda.'], minutes: 30, servings: 24, tags: ['Dessert', 'Baking', 'Quick'], source: 'https://example.com/cookies',
  });
});
