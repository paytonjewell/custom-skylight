// Tests for src/ui/useHoldReorder.ts (a drag's order, brought up to date with a sync that landed mid-drag)
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { reconcile } from '../src/ui/useHoldReorder.ts';

test('an unchanged list keeps the dragged order', () => {
  assert.deepEqual(reconcile(['b', 'a', 'c'], ['a', 'b', 'c']), ['b', 'a', 'c']);
});

test('an item removed while dragging is dropped', () => {
  assert.deepEqual(reconcile(['b', 'a', 'c'], ['a', 'c']), ['a', 'c']);
});

test('an item added while dragging keeps its place', () => {
  assert.deepEqual(reconcile(['c', 'a', 'b'], ['a', 'b', 'c', 'd']), ['c', 'a', 'b', 'd']);
  assert.deepEqual(reconcile(['b', 'a'], ['x', 'a', 'b']), ['x', 'b', 'a']);
});
