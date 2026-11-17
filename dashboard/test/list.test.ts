// Tests for src/lib/list.ts
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { insertAt, orderBy, patch } from '../src/lib/list.ts';

const abc = [
  { id: 'a', n: 1 },
  { id: 'b', n: 2 },
  { id: 'c', n: 3 },
];

test('patch changes one record', () => {
  assert.deepEqual(
    patch(abc, 'b', { n: 9 }).map((x) => x.n),
    [1, 9, 3],
  );
});
test('insertAt puts a record back where it was, or last when the list got shorter', () => {
  assert.deepEqual(
    insertAt(abc.slice(1), abc[0], 0).map((x) => x.id),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    insertAt([abc[0]], abc[2], 5).map((x) => x.id),
    ['a', 'c'],
  );
  assert.deepEqual(
    insertAt(abc, { id: 'a', n: 7 }, 2).map((x) => x.id),
    ['b', 'c', 'a'],
  );
});
test('orderBy follows the ids and skips unknown ones', () => {
  assert.deepEqual(
    orderBy(abc, ['c', 'x', 'a']).map((x) => x.id),
    ['c', 'a'],
  );
});
