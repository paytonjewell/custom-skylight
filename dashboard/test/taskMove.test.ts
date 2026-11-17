// Tests for src/data/taskMove.ts: where a dragged task lands
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { taskMoveEdits } from '../src/data/taskMove.ts';
import type { Task } from '../src/data/types.ts';

const task = (id: string, p: Partial<Task> = {}): Task => ({
  id,
  title: id,
  emoji: '',
  who: 'ann',
  repeat: null,
  due: null,
  slot: 'anytime',
  time: null,
  habit: false,
  onCalendar: false,
  remind: null,
  notify: [],
  listId: null,
  listItemId: null,
  created: '2026-01-01T00:00:00Z',
  ...p,
});
const [a, b, c] = [task('a'), task('b'), task('c')];
const edits = (m: Map<string, unknown>) => Object.fromEntries(m);

test('dropping before a row numbers the group with the task in its new place', () => {
  assert.deepEqual(edits(taskMoveEdits(c, { who: 'ann', group: 'anytime', rowId: 'a', side: 'before' }, [a, b, c])), {
    c: { position: 1 },
    a: { position: 2 },
    b: { position: 3 },
  });
});

test('dropping after a row, or on the group, puts it after; unchanged numbers are not edited', () => {
  const numbered = [task('a', { position: 1 }), task('b', { position: 2 }), task('c', { position: 3 })];
  assert.deepEqual(
    edits(taskMoveEdits(numbered[0], { who: 'ann', group: 'anytime', rowId: 'b', side: 'after' }, numbered)),
    { b: { position: 1 }, a: { position: 2 } },
  );
  assert.deepEqual(edits(taskMoveEdits(numbered[0], { who: 'ann', group: 'anytime', side: 'before' }, numbered)), {
    b: { position: 1 },
    c: { position: 2 },
    a: { position: 3 },
  });
  // Dropped where it already was: nothing to do
  assert.equal(taskMoveEdits(numbered[2], { who: 'ann', group: 'anytime', side: 'before' }, numbered).size, 0);
});

test('another part of the day changes its slot; another column changes whose it is', () => {
  assert.deepEqual(edits(taskMoveEdits(a, { who: 'ann', group: 'morning', side: 'before' }, [])), {
    a: { position: 1, slot: 'morning' },
  });
  assert.deepEqual(edits(taskMoveEdits(a, { who: 'bo', side: 'before' }, [])), { a: { who: 'bo' } });
});

test('a habit dropped on a part of the day only changes whose it is', () => {
  const h = task('h', { habit: true });
  assert.deepEqual(edits(taskMoveEdits(h, { who: 'bo', group: 'evening', side: 'before' }, [a])), {
    h: { who: 'bo' },
  });
});
