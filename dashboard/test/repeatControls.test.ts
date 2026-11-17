// Tests for src/views/tasks/repeatControls.ts: the task editor's "How often" controls
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { toControls, toRepeat } from '../src/views/tasks/repeatControls.ts';
import type { Repeat } from '../src/lib/repeat.ts';

const today = '2026-11-17'; // a Tuesday
const start = '2026-10-01';

test('every rule the editor can make comes back unchanged from its controls', () => {
  const rules: Repeat[] = [
    { kind: 'daily', start },
    { kind: 'daily', every: 3, start },
    { kind: 'weekly', days: [1, 2, 3, 4, 5], start },
    { kind: 'weekly', days: [2, 6], start },
    { kind: 'weekly', days: [0], every: 2, start },
    { kind: 'monthly', day: 31, start },
    { kind: 'monthly', day: 15, every: 3, start },
    { kind: 'monthlyNth', nth: 1, weekday: 4, offset: -1, start },
    { kind: 'monthlyNth', nth: -1, weekday: 5, start },
    { kind: 'afterDone', every: 1, unit: 'day', start },
    { kind: 'afterDone', every: 1, unit: 'week', start },
    { kind: 'afterDone', every: 1, unit: 'month', start },
    { kind: 'afterDone', every: 2, unit: 'week', start },
    { kind: 'afterDone', every: 6, unit: 'month', start },
  ];
  for (const r of rules) assert.deepEqual(toRepeat(toControls(r, today), today), r, JSON.stringify(r));
});

test('a one-off shows as Once, with the rest starting from today', () => {
  const c = toControls(null, today);
  assert.equal(c.mode, 'once');
  assert.equal(toRepeat(c, today), null);
  assert.deepEqual(c.days, [2]);
  assert.equal(c.monthDay, 17);
  assert.equal(c.start, today);
  // Switching to Weekly from there: today's weekday, starting today
  assert.deepEqual(toRepeat({ ...c, mode: 'weekly' }, today), { kind: 'weekly', days: [2], start: today });
});

test('no weekdays ticked means today’s; "Repeat from" only counts where it shows', () => {
  const c = toControls({ kind: 'weekly', days: [1], start }, today);
  assert.deepEqual(toRepeat({ ...c, days: [] }, today), { kind: 'weekly', days: [2], start });
  // Weekdays can't count from when it's done, so a leftover basis is ignored
  assert.deepEqual(toRepeat({ ...c, mode: 'weekdays', basis: 'done' }, today), {
    kind: 'weekly',
    days: [1, 2, 3, 4, 5],
    start,
  });
});
