// Tests for src/data/habits.ts (streaks, rate, heatmap cells)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { habitStats } from '../src/data/habits.ts';
import type { Task, TaskDone } from '../src/data/types.ts';
import type { Repeat } from '../src/lib/repeat.ts';

const habit = (repeat: Repeat): Task => ({
  id: 'h', title: 'Habit', emoji: '', who: 'john', repeat, due: null, slot: 'anytime', time: null,
  habit: true, onCalendar: false, remind: null, notify: [], listId: null, listItemId: null, created: '2026-01-01T00:00:00Z',
});
const done = (...days: string[]): TaskDone[] => days.map((day) => ({ task: 'h', day, at: day + 'T12:00:00Z', by: null }));
const FROM = '2025-11-01';

test('daily: streak counts back from today; today undone does not break it', () => {
  const t = habit({ kind: 'daily', start: '2026-11-01' });
  // Done Nov 10–14, not yet on the 15th
  const s = habitStats(t, done('2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'), '2026-11-15', FROM);
  assert.equal(s.current, 5);
  assert.equal(s.cells.get('2026-11-15'), 'due');
  assert.equal(s.cells.get('2026-11-09'), 'missed');
  // Done today too
  const s2 = habitStats(t, done('2026-11-13', '2026-11-14', '2026-11-15'), '2026-11-15', FROM);
  assert.equal(s2.current, 3);
});

test('a missed day resets the streak; best keeps the longest run', () => {
  const t = habit({ kind: 'daily', start: '2026-11-01' });
  const s = habitStats(t, done('2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-06', '2026-11-07'), '2026-11-07', FROM);
  assert.equal(s.current, 2);
  assert.equal(s.best, 4);
});

test('weekday habit: the weekend does not break the streak', () => {
  const t = habit({ kind: 'weekly', days: [1, 2, 3, 4, 5], start: '2026-11-01' });
  // Thu 12, Fri 13, (weekend), Mon 16
  const s = habitStats(t, done('2026-11-12', '2026-11-13', '2026-11-16'), '2026-11-16', FROM);
  assert.equal(s.current, 3);
  assert.equal(s.cells.get('2026-11-14'), 'off');
});

test('completion rate over the last 30 days', () => {
  const t = habit({ kind: 'daily', start: '2026-11-01' });
  // Nov 1–10 due (10 days, today the 10th done), 5 done
  const s = habitStats(t, done('2026-11-01', '2026-11-03', '2026-11-05', '2026-11-07', '2026-11-10'), '2026-11-10', FROM);
  assert.equal(s.rate, 0.5);
  // Today not done yet: it doesn't count against the rate
  const s2 = habitStats(t, done('2026-11-01', '2026-11-02'), '2026-11-03', FROM);
  assert.equal(s2.rate, 1);
});

test('"after it’s done" habits: streak holds while each completion is on time', () => {
  const t = habit({ kind: 'afterDone', every: 3, unit: 'day', start: '2026-11-01' });
  const s = habitStats(t, done('2026-11-01', '2026-11-04', '2026-11-06', '2026-11-12'), '2026-11-13', FROM);
  assert.equal(s.best, 3); // 1 → 4 → 6, then a 6-day gap
  assert.equal(s.current, 1); // the 12th, still within 3 days
  const late = habitStats(t, done('2026-11-01', '2026-11-04'), '2026-11-13', FROM);
  assert.equal(late.current, 0); // overdue
});

test('catching up on past days doesn’t tick the day it was done on', async () => {
  const { dueItem } = await import('../src/data/tasks.ts');
  const t = habit({ kind: 'daily', start: '2026-11-01' });
  // Friday's and Saturday's done on Sunday night (Central time, 10:17 PM)
  const sundayNight = new Date(2026, 10, 15, 22, 17).toISOString();
  const rows: TaskDone[] = ['2026-11-13', '2026-11-14'].map((day) => ({ task: 'h', day, at: sundayNight, by: null }));
  const sun = dueItem(t, rows, '2026-11-15', '2026-11-16')!;
  assert.equal(sun.day, '2026-11-15');
  assert.equal(sun.done, null); // Sunday itself is still to do
  assert.equal(dueItem(t, rows, '2026-11-14', '2026-11-16')!.done?.day, '2026-11-14');
});
