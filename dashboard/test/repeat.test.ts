// Tests for src/lib/repeat.ts. Run: npm test (Node's built-in runner; Node 24 runs .ts directly).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  carriesOver,
  describeRepeat,
  nextOccurrence,
  occursOn,
  prevOccurrence,
  type Repeat,
} from '../src/lib/repeat.ts';

/** Every due day from `from` to `to` (inclusive) */
function dueDays(r: Repeat, from: string, to: string, lastDone?: string): string[] {
  const out: string[] = [];
  for (let d = Date.parse(from + 'T00:00:00Z'); d <= Date.parse(to + 'T00:00:00Z'); d += 864e5) {
    const day = new Date(d).toISOString().slice(0, 10);
    if (occursOn(r, day, lastDone)) out.push(day);
  }
  return out;
}

const RECYCLING: Repeat = { kind: 'monthlyNth', nth: 1, weekday: 4, offset: -1, start: '2026-01-01' };

test('recycling: the Wednesday before the 1st Thursday', () => {
  // Nov 2026: 1st Thursday is the 5th → Wed Nov 4
  assert.ok(occursOn(RECYCLING, '2026-11-04'));
  // Oct 1 2026 is a Thursday → recycling goes out Wed Sep 30, in the previous month
  assert.ok(occursOn(RECYCLING, '2026-09-30'));
  assert.ok(!occursOn(RECYCLING, '2026-10-07')); // the 1st Wednesday of October is NOT it
  assert.deepEqual(dueDays(RECYCLING, '2026-09-01', '2026-12-31'), [
    '2026-09-02', // Thu Sep 3
    '2026-09-30', // Thu Oct 1
    '2026-11-04', // Thu Nov 5
    '2026-12-02', // Thu Dec 3
  ]);
  // Jan 1 2027 is a Friday → 1st Thursday is Jan 7 → Wed Jan 6
  assert.equal(nextOccurrence(RECYCLING, '2026-12-03'), '2027-01-06');
});

test('recycling across a year boundary', () => {
  // Thu Jan 1 2026 → due Wed Dec 31 2025, but the rule starts Jan 1, so it's skipped
  assert.ok(!occursOn(RECYCLING, '2025-12-31'));
  const early = { ...RECYCLING, start: '2025-12-01' };
  assert.ok(occursOn(early, '2025-12-31'));
});

test('weekdays only', () => {
  const r: Repeat = { kind: 'weekly', days: [1, 2, 3, 4, 5], start: '2026-11-01' };
  // Mon Nov 16 – Sun Nov 22
  assert.deepEqual(dueDays(r, '2026-11-16', '2026-11-22'), [
    '2026-11-16',
    '2026-11-17',
    '2026-11-18',
    '2026-11-19',
    '2026-11-20',
  ]);
  assert.equal(nextOccurrence(r, '2026-11-21'), '2026-11-23'); // Saturday → Monday
  assert.equal(prevOccurrence(r, '2026-11-22'), '2026-11-20'); // Sunday → Friday
});

test('every other week', () => {
  const r: Repeat = { kind: 'weekly', days: [2], every: 2, start: '2026-11-03' }; // Tuesdays
  assert.deepEqual(dueDays(r, '2026-11-01', '2026-12-01'), ['2026-11-03', '2026-11-17', '2026-12-01']);
});

test('every N days', () => {
  const r: Repeat = { kind: 'daily', every: 3, start: '2026-11-10' };
  assert.deepEqual(dueDays(r, '2026-11-08', '2026-11-20'), ['2026-11-10', '2026-11-13', '2026-11-16', '2026-11-19']);
});

test('monthly on a day; the 31st falls on the last day of short months', () => {
  const r: Repeat = { kind: 'monthly', day: 31, start: '2026-01-01' };
  assert.deepEqual(dueDays(r, '2026-01-01', '2026-04-30'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  const leap: Repeat = { kind: 'monthly', day: 30, start: '2028-01-01' };
  assert.ok(occursOn(leap, '2028-02-29'));
});

test('every N months', () => {
  const r: Repeat = { kind: 'monthly', day: 14, every: 3, start: '2026-11-01' };
  assert.deepEqual(dueDays(r, '2026-11-01', '2027-06-30'), ['2026-11-14', '2027-02-14', '2027-05-14']);
  assert.equal(describeRepeat(r), 'Every 3 months on the 14th');
});

test('last Friday, and 5-week months', () => {
  const r: Repeat = { kind: 'monthlyNth', nth: -1, weekday: 5, start: '2026-01-01' };
  // Oct 2026 has five Fridays (2, 9, 16, 23, 30): the last is the 30th, not the 4th one
  assert.deepEqual(dueDays(r, '2026-10-01', '2026-11-30'), ['2026-10-30', '2026-11-27']);
  const fourth: Repeat = { kind: 'monthlyNth', nth: 4, weekday: 5, start: '2026-01-01' };
  assert.deepEqual(dueDays(fourth, '2026-10-01', '2026-10-31'), ['2026-10-23']);
});

test('repeat from when it was done: days, weeks, months', () => {
  const r: Repeat = { kind: 'afterDone', every: 30, unit: 'day', start: '2026-11-01' };
  assert.equal(nextOccurrence(r, '2026-10-01'), '2026-11-01'); // never done: due on start
  assert.equal(nextOccurrence(r, '2026-11-15', '2026-11-10'), '2026-12-10');
  assert.ok(occursOn(r, '2026-12-10', '2026-11-10'));
  assert.equal(nextOccurrence(r, '2026-12-20', '2026-11-10'), '2026-12-20'); // overdue: due now
  assert.equal(prevOccurrence(r, '2026-12-01', '2026-11-10'), null);
  const week: Repeat = { kind: 'afterDone', every: 1, unit: 'week', start: '2026-11-01' };
  assert.equal(nextOccurrence(week, '2026-11-13', '2026-11-13'), '2026-11-20'); // done Fri → next Fri
  const month: Repeat = { kind: 'afterDone', every: 1, unit: 'month', start: '2026-01-01' };
  assert.equal(nextOccurrence(month, '2026-01-31', '2026-01-31'), '2026-02-28'); // Jan 31 → Feb 28
  assert.equal(nextOccurrence(month, '2026-11-14', '2026-11-14'), '2026-12-14');
});

test('nothing is due before start', () => {
  const r: Repeat = { kind: 'daily', start: '2026-11-15' };
  assert.ok(!occursOn(r, '2026-11-14'));
  assert.ok(occursOn(r, '2026-11-15'));
  assert.equal(prevOccurrence(r, '2026-11-14'), null);
});

test('daylight saving weeks do not shift days', () => {
  // US DST ends Sun Nov 1 2026 and starts Sun Mar 8 2026
  const daily: Repeat = { kind: 'daily', every: 2, start: '2026-10-30' };
  assert.deepEqual(dueDays(daily, '2026-10-30', '2026-11-05'), [
    '2026-10-30',
    '2026-11-01',
    '2026-11-03',
    '2026-11-05',
  ]);
  const sun: Repeat = { kind: 'weekly', days: [0], start: '2026-03-01' };
  assert.deepEqual(dueDays(sun, '2026-03-01', '2026-03-15'), ['2026-03-01', '2026-03-08', '2026-03-15']);
});

test('which misses carry over as overdue', () => {
  assert.equal(carriesOver({ kind: 'daily', start: '2026-01-01' }), false);
  assert.equal(carriesOver({ kind: 'weekly', days: [1, 2, 3, 4, 5], start: '2026-01-01' }), false);
  assert.equal(carriesOver({ kind: 'weekly', days: [1, 3, 5], start: '2026-01-01' }), false);
  assert.equal(carriesOver({ kind: 'weekly', days: [3], start: '2026-01-01' }), true);
  assert.equal(carriesOver(RECYCLING), true);
  assert.equal(carriesOver({ kind: 'afterDone', every: 30, unit: 'day', start: '2026-01-01' }), true);
});

test('repeat rules in words', () => {
  const s = '2026-01-01';
  assert.equal(describeRepeat({ kind: 'daily', start: s }), 'Daily');
  assert.equal(describeRepeat({ kind: 'weekly', days: [1, 2, 3, 4, 5], start: s }), 'Weekdays');
  assert.equal(describeRepeat({ kind: 'weekly', days: [3], start: s }), 'Wednesdays');
  assert.equal(describeRepeat({ kind: 'weekly', days: [1, 3, 5], start: s }), 'Mon, Wed, Fri');
  assert.equal(describeRepeat({ kind: 'weekly', days: [2], every: 2, start: s }), 'Every 2 weeks on Tue');
  assert.equal(describeRepeat({ kind: 'monthly', day: 22, start: s }), 'Monthly on the 22nd');
  assert.equal(describeRepeat(RECYCLING), 'Day before the 1st Thursday');
  assert.equal(describeRepeat({ kind: 'afterDone', every: 30, unit: 'day', start: s }), '30 days after it’s done');
  assert.equal(describeRepeat({ kind: 'afterDone', every: 1, unit: 'week', start: s }), '1 week after it’s done');
});
