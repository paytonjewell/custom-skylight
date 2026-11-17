// The "How often" controls in the task editor, as plain data: an existing rule → the controls that
// show it, and the controls → the rule they describe. Kept apart from RepeatPicker so the round trip
// can be tested.
import { weekdayOf, type Repeat, type Unit, type Weekday } from '../../lib/repeat';

export type Often = 'once' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom';
export type Custom = 'days' | 'weeks' | 'months' | 'nth';
type Basis = 'due' | 'done';

export interface RepeatControls {
  mode: Often;
  /** Which custom repeat (when mode is 'custom') */
  custom: Custom;
  /** Count from the due date (the calendar) or from when it was last done */
  basis: Basis;
  /** Weekly: the weekdays */
  days: Weekday[];
  /** Monthly: the day of the month */
  monthDay: number;
  /** Custom: every N days, weeks or months */
  every: number;
  /** A weekday of the month: the 1st–4th or last (-1)… */
  nth: 1 | 2 | 3 | 4 | -1;
  /** …this weekday… */
  nthDay: Weekday;
  /** …moved by this many days (-1: the day before) */
  offset: number;
  /** The rule's first day (kept from the rule being edited) */
  start: string;
}

/** The controls that show `r` (null: once); ones it doesn't use start from `today` */
export function toControls(r: Repeat | null, today: string): RepeatControls {
  const rest = {
    days: r?.kind === 'weekly' ? r.days : [weekdayOf(today)],
    monthDay: r?.kind === 'monthly' ? r.day : Number(today.slice(8)),
    every: r && 'every' in r && r.every && r.every > 1 ? r.every : 2,
    nth: r?.kind === 'monthlyNth' ? r.nth : 1,
    nthDay: r?.kind === 'monthlyNth' ? r.weekday : weekdayOf(today),
    offset: r?.offset ?? 0,
    start: r?.start ?? today,
  };
  const out = (mode: Often, custom: Custom = 'days', basis: Basis = 'due'): RepeatControls => ({
    mode,
    custom,
    basis,
    ...rest,
  });
  if (!r) return out('once');
  switch (r.kind) {
    case 'afterDone': {
      const custom: Custom = r.unit === 'day' ? 'days' : r.unit === 'week' ? 'weeks' : 'months';
      if (r.every > 1) return out('custom', custom, 'done');
      return out(r.unit === 'day' ? 'daily' : r.unit === 'week' ? 'weekly' : 'monthly', custom, 'done');
    }
    case 'monthlyNth':
      return out('custom', 'nth');
    case 'daily':
      return (r.every ?? 1) > 1 ? out('custom', 'days') : out('daily');
    case 'monthly':
      return (r.every ?? 1) > 1 ? out('custom', 'months') : out('monthly');
    case 'weekly':
      if ((r.every ?? 1) > 1) return out('custom', 'weeks');
      return out(
        r.days.length === 5 && [1, 2, 3, 4, 5].every((d) => r.days.includes(d as Weekday)) ? 'weekdays' : 'weekly',
      );
  }
}

/** Can this choice count from when it's done? (Not weekdays, or the Nth weekday of a month.) */
export const canCountFromDone = (c: RepeatControls): boolean =>
  c.mode === 'daily' || c.mode === 'weekly' || c.mode === 'monthly' || (c.mode === 'custom' && c.custom !== 'nth');

/** It counts from when it's done (the controls for that are showing, and it's picked) */
export const fromDone = (c: RepeatControls): boolean => canCountFromDone(c) && c.basis === 'done';

/** The rule the controls describe (null: once). No weekdays ticked means today's. */
export function toRepeat(c: RepeatControls, today: string): Repeat | null {
  const { mode, custom, every, monthDay, start } = c;
  const base = { start };
  const weekDays = c.days.length ? c.days : [weekdayOf(today)];
  if (fromDone(c)) {
    const unit: Unit =
      mode === 'daily' || custom === 'days' ? 'day' : mode === 'weekly' || custom === 'weeks' ? 'week' : 'month';
    return { kind: 'afterDone', every: mode === 'custom' ? every : 1, unit, ...base };
  }
  switch (mode) {
    case 'once':
      return null;
    case 'daily':
      return { kind: 'daily', ...base };
    case 'weekdays':
      return { kind: 'weekly', days: [1, 2, 3, 4, 5], ...base };
    case 'weekly':
      return { kind: 'weekly', days: weekDays, ...base };
    case 'monthly':
      return { kind: 'monthly', day: monthDay, ...base };
    case 'custom':
      switch (custom) {
        case 'days':
          return { kind: 'daily', every, ...base };
        case 'weeks':
          return { kind: 'weekly', days: weekDays, every, ...base };
        case 'months':
          return { kind: 'monthly', day: monthDay, every, ...base };
        case 'nth':
          return {
            kind: 'monthlyNth',
            nth: c.nth,
            weekday: c.nthDay,
            ...(c.offset ? { offset: c.offset } : {}),
            ...base,
          };
      }
  }
}
