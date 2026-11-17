// Tests for the Worker's checks on what the app sends: tasks (worker/tasks.ts fields, doneRow) and
// recipes (worker/kitchen.ts recipeFields)
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { doneRow, fields } from '../worker/tasks.ts';
import { recipeFields } from '../worker/kitchen.ts';

const task = { title: ' Feed the cat ', who: 'jacob', slot: 'morning' };

test('a new task needs a title, who and slot; the rest is checked when given', () => {
  assert.deepEqual(fields(task, false), { title: 'Feed the cat', who: 'jacob', slot: 'morning' });
  assert.equal(fields({ ...task, title: undefined }, false), null);
  assert.equal(fields({ ...task, title: '   ' }, false), null);
  assert.equal(fields({ ...task, who: 'Jacob!' }, false), null);
  assert.equal(fields({ ...task, slot: 'brunch' }, false), null);
  assert.equal(fields(null, false), null);
  assert.equal(fields('task', false), null);

  const full = fields(
    {
      ...task,
      emoji: '🐈',
      repeat: { kind: 'daily', start: '2026-11-01' },
      due: null,
      time: '07:30',
      remind: '07:15',
      habit: true,
      onCalendar: false,
      listId: null,
      listItemId: 'abcd1234',
      position: 1.5,
      notify: ['john', 'john', 'mary'],
    },
    false,
  );
  assert.deepEqual(full, {
    title: 'Feed the cat',
    emoji: '🐈',
    who: 'jacob',
    repeat: { kind: 'daily', start: '2026-11-01' },
    due: null,
    slot: 'morning',
    time: '07:30',
    remind: '07:15',
    habit: true,
    onCalendar: false,
    listId: null,
    listItemId: 'abcd1234',
    position: 1.5,
    notify: ['john', 'mary'],
  });
});

test('an edit can be any part of a task, each still checked', () => {
  assert.deepEqual(fields({ remind: null }, true), { remind: null });
  assert.deepEqual(fields({ repeat: null }, true), { repeat: null });
  assert.deepEqual(fields({}, true), {});
  for (const bad of [
    { time: '24:00' },
    { remind: '7:15' },
    { due: '2026-13-01' },
    { habit: 'yes' },
    { repeat: { kind: 'hourly' } },
    { position: Number.NaN },
    { listId: 'X' },
    { notify: 'john' },
    { notify: Array(11).fill('john') },
    { emoji: 'x'.repeat(17) },
  ])
    assert.equal(fields(bad, true), null, JSON.stringify(bad));
});

test('a completion needs a day and a time; who did it is optional', () => {
  assert.deepEqual(doneRow({ day: '2026-11-16', at: '2026-11-16T20:00:00-06:00', by: 'john' }), {
    day: '2026-11-16',
    at: '2026-11-17T02:00:00.000Z',
    by: 'john',
  });
  assert.deepEqual(doneRow({ day: '2026-11-16', at: '2026-11-16T20:00:00Z' }), {
    day: '2026-11-16',
    at: '2026-11-16T20:00:00.000Z',
    by: null,
  });
  assert.equal(doneRow({ day: 'today', at: '2026-11-16T20:00:00Z' }), null);
  assert.equal(doneRow({ day: '2026-11-16', at: 'soon' }), null);
  assert.equal(doneRow({ day: '2026-11-16', at: '2026-11-16T20:00:00Z', by: 'John Smith' }), null);
  assert.equal(doneRow(null), null);
});

const recipe = {
  id: 'banana-bread',
  title: ' Banana bread ',
  emoji: '🍌',
  tone: 3,
  tags: [' Baking '],
  minutes: 70,
  servings: 8,
  ingredients: [
    { qty: 3, unit: ' ', name: ' bananas ', note: ' ripe ' },
    { qty: null, unit: '', name: 'salt', pantry: true },
    { qty: 0.5, unit: 'cup', name: 'walnuts', optional: true, note: '  ' },
  ],
  steps: [' Mash ', 'Bake'],
};

test('a recipe from the app is tidied and checked', () => {
  assert.deepEqual(recipeFields({ ...recipe, notes: ' Freezes well ', source: 'https://example.com/bread' }), {
    id: 'banana-bread',
    title: 'Banana bread',
    emoji: '🍌',
    tone: 3,
    tags: ['Baking'],
    minutes: 70,
    servings: 8,
    ingredients: [
      { qty: 3, unit: '', name: 'bananas', note: 'ripe' },
      { qty: null, unit: '', name: 'salt', pantry: true },
      { qty: 0.5, unit: 'cup', name: 'walnuts', optional: true },
    ],
    steps: ['Mash', 'Bake'],
    notes: 'Freezes well',
    source: 'https://example.com/bread',
  });
  // Notes and source are optional
  assert.equal(recipeFields(recipe)?.notes, undefined);
  assert.equal(recipeFields({ ...recipe, source: '' })?.source, undefined);
});

test('a recipe with anything off is refused', () => {
  for (const [what, bad] of Object.entries({
    id: { id: 'Banana Bread' },
    title: { title: '  ' },
    tone: { tone: 5 },
    minutes: { minutes: 1.5 },
    servings: { servings: 0 },
    tags: { tags: Array(13).fill('x') },
    steps: { steps: ['ok', ' '] },
    noIngredients: { ingredients: [] },
    ingredientName: { ingredients: [{ qty: 1, unit: '', name: '' }] },
    ingredientQty: { ingredients: [{ qty: -1, unit: '', name: 'egg' }] },
    notes: { notes: 'x'.repeat(4001) },
    source: { source: 'javascript:alert(1)' },
  }))
    assert.equal(recipeFields({ ...recipe, ...bad }), null, what);
  assert.equal(recipeFields(null), null);
});
