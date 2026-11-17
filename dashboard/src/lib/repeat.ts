// Repeat rules for tasks: which days a task is due on. Shared by the app and the Worker (reminders),
// so it has no imports. Days are 'YYYY-MM-DD' strings, worked out in UTC, so daylight-saving
// changes and time zones never shift a day.
//
// Every rule has a `start` day (nothing is due before it) and an optional `offset` in days, applied
// after the rule: recycling is "1st Thursday of the month, offset -1", the Wednesday before, even
// when that Wednesday falls in the previous month.

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday, as in Date.getDay()
export type Unit = 'day' | 'week' | 'month';

export type Repeat = (
  /** Every day, or every N days */
  | { kind: 'daily'; every?: number }
  /** On these weekdays, every week or every N weeks (weekdays = [1, 2, 3, 4, 5]) */
  | { kind: 'weekly'; days: Weekday[]; every?: number }
  /** On this day of the month, every month or every N months; 29–31 fall on the last day of shorter months */
  | { kind: 'monthly'; day: number; every?: number }
  /** On the Nth weekday of the month (1–4), or the last one (-1) */
  | { kind: 'monthlyNth'; nth: 1 | 2 | 3 | 4 | -1; weekday: Weekday }
  /**
   * Counted from when it was last done, not from the calendar: "1 week after it's done". Due on
   * `start` if it never has been, and stays due (overdue) until it's done.
   */
  | { kind: 'afterDone'; every: number; unit: Unit }
) & {
  /** First day it can be due */
  start: string;
  /** Days to move each due day by, e.g. -1 = the day before */
  offset?: number;
};

const DAY = 864e5;
const toMs = (day: string) => Date.parse(day + 'T00:00:00Z');
const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** `day` moved by n days */
export const shiftDay = (day: string, n: number): string => toDay(toMs(day) + n * DAY);
/** Whole days from a to b */
export const dayDiff = (a: string, b: string): number => Math.round((toMs(b) - toMs(a)) / DAY);
/** A local Date's calendar day as 'YYYY-MM-DD' */
export const dayOf = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const weekdayOf = (day: string): Weekday => new Date(toMs(day)).getUTCDay() as Weekday;
/** `day` moved by n months; the 31st lands on the last day of shorter months */
function shiftMonths(day: string, n: number): string {
  const d = new Date(toMs(day));
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return toDay(Date.UTC(y, m, Math.min(d.getUTCDate(), last)));
}

/** When an 'afterDone' task is next due, given the day it was last done */
export function dueAfter(r: Extract<Repeat, { kind: 'afterDone' }>, lastDone?: string): string {
  if (!lastDone) return r.start;
  const next = r.unit === 'month' ? shiftMonths(lastDone, r.every) : shiftDay(lastDone, r.every * (r.unit === 'week' ? 7 : 1));
  return shiftDay(next, r.offset ?? 0);
}

/** Does the rule (ignoring offset and start) land on this day? */
function base(r: Repeat, day: string): boolean {
  const d = new Date(toMs(day));
  switch (r.kind) {
    case 'daily': {
      const n = dayDiff(r.start, day);
      return n % (r.every ?? 1) === 0;
    }
    case 'weekly': {
      if (!r.days.includes(d.getUTCDay() as Weekday)) return false;
      // Weeks counted Monday to Sunday from the week `start` is in
      const monday = (x: string) => shiftDay(x, -((weekdayOf(x) + 6) % 7));
      const weeks = Math.round(dayDiff(monday(r.start), monday(day)) / 7);
      return weeks % (r.every ?? 1) === 0;
    }
    case 'monthly': {
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      if (d.getUTCDate() !== Math.min(r.day, last)) return false;
      const s = new Date(toMs(r.start));
      const months = (d.getUTCFullYear() - s.getUTCFullYear()) * 12 + d.getUTCMonth() - s.getUTCMonth();
      return months % (r.every ?? 1) === 0;
    }
    case 'monthlyNth': {
      if (d.getUTCDay() !== r.weekday) return false;
      const date = d.getUTCDate();
      if (r.nth === -1) {
        const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
        return date + 7 > last;
      }
      return Math.ceil(date / 7) === r.nth;
    }
    case 'afterDone':
      return false; // handled in occursOn (it doesn't follow the calendar)
  }
}

/**
 * Is the task due on this day? `lastDone` is only used by 'afterDone' rules (the day it was last
 * completed).
 */
export function occursOn(r: Repeat, day: string, lastDone?: string): boolean {
  const offset = r.offset ?? 0;
  if (dayDiff(r.start, day) < 0) return false;
  if (r.kind === 'afterDone') return day === dueAfter(r, lastDone);
  // Due on `day` when the rule lands on the day `offset` days earlier
  return base(r, shiftDay(day, -offset));
}

const SCAN = 3660; // ten years: far enough for any rule

/** The first due day on or after `from` */
export function nextOccurrence(r: Repeat, from: string, lastDone?: string): string | null {
  if (r.kind === 'afterDone') {
    const due = dueAfter(r, lastDone);
    return dayDiff(from, due) >= 0 ? due : from; // overdue: due now
  }
  for (let i = 0; i < SCAN; i++) {
    const day = shiftDay(from, i);
    if (occursOn(r, day)) return day;
  }
  return null;
}

/** The last due day on or before `to`, or null if there hasn't been one yet */
export function prevOccurrence(r: Repeat, to: string, lastDone?: string): string | null {
  if (r.kind === 'afterDone') {
    const due = dueAfter(r, lastDone);
    return dayDiff(due, to) >= 0 ? due : null;
  }
  for (let i = 0; i < SCAN; i++) {
    const day = shiftDay(to, -i);
    if (dayDiff(r.start, day) < 0) return null;
    if (occursOn(r, day)) return day;
  }
  return null;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (v: unknown): v is string => typeof v === 'string' && DAY_RE.test(v) && !isNaN(toMs(v));
const int = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const weekday = (v: unknown): v is Weekday => int(v, 0, 6);

/** A repeat rule from outside (the app → Worker), checked; null if it isn't a valid rule */
export function parseRepeat(v: unknown): Repeat | null {
  const r = v as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || !isDay(r.start)) return null;
  if (r.offset !== undefined && !int(r.offset, -31, 31)) return null;
  const common = { start: r.start, ...(r.offset ? { offset: r.offset as number } : {}) };
  const every = r.every === undefined || r.every === 1 ? {} : int(r.every, 2, 365) ? { every: r.every } : null;
  if (!every) return null;
  switch (r.kind) {
    case 'daily':
      return { kind: 'daily', ...every, ...common };
    case 'weekly': {
      const days = r.days;
      if (!Array.isArray(days) || !days.length || !days.every(weekday)) return null;
      return { kind: 'weekly', days: [...new Set(days)].sort(), ...every, ...common };
    }
    case 'monthly':
      return int(r.day, 1, 31) ? { kind: 'monthly', day: r.day, ...every, ...common } : null;
    case 'monthlyNth':
      return (r.nth === -1 || int(r.nth, 1, 4)) && weekday(r.weekday)
        ? { kind: 'monthlyNth', nth: r.nth as 1 | 2 | 3 | 4 | -1, weekday: r.weekday, ...common }
        : null;
    case 'afterDone': {
      const n = r.every ?? 1;
      return int(n, 1, 3650) && (r.unit === 'day' || r.unit === 'week' || r.unit === 'month')
        ? { kind: 'afterDone', every: n, unit: r.unit, ...common }
        : null;
    }
  }
  return null;
}

/**
 * Does a missed due day stay on the list as Overdue? Not for things that come round more than once
 * a week (yesterday's dishes just count as missed); yes for weekly or rarer, and 'afterDone'
 * tasks, which stay due until they're done.
 */
export function carriesOver(r: Repeat): boolean {
  switch (r.kind) {
    case 'daily': return (r.every ?? 1) >= 7;
    case 'weekly': return r.days.length <= 1 || (r.every ?? 1) > 1; // once a week, or rarer
    default: return true;
  }
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const NTH = ['', '1st', '2nd', '3rd', '4th'];
const ordinal = (n: number) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

/** A repeat rule in words: "Weekdays", "Every 2 weeks on Tue", "Day before the 1st Thursday" */
export function describeRepeat(r: Repeat): string {
  let s: string;
  switch (r.kind) {
    case 'daily':
      s = (r.every ?? 1) === 1 ? 'Daily' : `Every ${r.every} days`;
      break;
    case 'weekly': {
      const days = r.days;
      const on =
        days.length === 7 ? 'every day'
        : days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d as Weekday)) ? 'weekdays'
        : days.length === 2 && days.includes(0) && days.includes(6) ? 'weekends'
        : days.map((d) => SHORT[d]).join(', ');
      if ((r.every ?? 1) > 1) s = `Every ${r.every} weeks on ${on}`;
      else if (days.length === 1) s = DAY_NAMES[days[0]] + 's'; // "Wednesdays"
      else s = on[0].toUpperCase() + on.slice(1); // "Weekdays", "Mon, Wed, Fri"
      break;
    }
    case 'monthly':
      s = (r.every ?? 1) > 1 ? `Every ${r.every} months on the ${ordinal(r.day)}` : `Monthly on the ${ordinal(r.day)}`;
      break;
    case 'monthlyNth':
      s = `The ${r.nth === -1 ? 'last' : NTH[r.nth]} ${DAY_NAMES[r.weekday]} of the month`;
      break;
    case 'afterDone':
      return r.every === 1 ? `1 ${r.unit} after it’s done` : `${r.every} ${r.unit}s after it’s done`;
  }
  const off = r.offset ?? 0;
  if (!off) return s;
  if (r.kind === 'monthlyNth') {
    const which = `the ${r.nth === -1 ? 'last' : NTH[r.nth]} ${DAY_NAMES[r.weekday]}`;
    return off === -1 ? `Day before ${which}` : off === 1 ? `Day after ${which}` : `${Math.abs(off)} days ${off < 0 ? 'before' : 'after'} ${which}`;
  }
  return `${s}, ${Math.abs(off)} ${Math.abs(off) === 1 ? 'day' : 'days'} ${off < 0 ? 'early' : 'late'}`;
}
