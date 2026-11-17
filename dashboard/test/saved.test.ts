// Tests for src/lib/saved.ts (lists kept in an order saved on this device)
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { inSavedOrder } from '../src/lib/saved.ts';

test('items go in the saved order, ones it doesn’t mention at the end', () => {
  assert.deepEqual(
    inSavedOrder(['a', 'b', 'c', 'd'], ['c', 'a'], (x) => x),
    ['c', 'a', 'b', 'd'],
  );
});

test('saved ids that no longer exist are skipped', () => {
  assert.deepEqual(
    inSavedOrder(['a', 'b'], ['gone', 'b'], (x) => x),
    ['b', 'a'],
  );
});

test('items that are arrays stay whole (the news topics are [id, label] pairs)', () => {
  const topics: [string, string][] = [
    ['top', 'Top'],
    ['local', 'Local'],
    ['world', 'World'],
  ];
  assert.deepEqual(
    inSavedOrder(topics, ['world', 'top', 'local'], (t) => t[0]),
    [
      ['world', 'World'],
      ['top', 'Top'],
      ['local', 'Local'],
    ],
  );
});
