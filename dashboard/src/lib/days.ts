// Words for 'YYYY-MM-DD' days and 'HH:MM' times, in this device's language and clock style. (fmt.ts
// spells Dates out itself, always 12-hour; tasks show times the way the phone does.)
import { dayDiff } from './repeat';

/** Midday, so a time-zone shift can never land on the day before or after */
export const asDate = (day: string) => new Date(day + 'T12:00:00');

/** 'HH:MM' → "8:00 AM" (or "08:00", as this device shows times) */
export const fmtTime = (hhmm: string) =>
  new Date(`2000-01-01T${hhmm}:00`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** 'YYYY-MM-DD' → "Friday, Nov 20" */
export const fmtDate = (day: string) =>
  asDate(day).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

/** 'YYYY-MM-DD' → "Fri, Nov 20" */
export const fmtDateShort = (day: string) =>
  asDate(day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/** The day `offset` days from today: "Today", "Tomorrow", "Thursday" within a week, else "Nov 24" */
export function dayName(offset: number, day: string): string {
  if (offset === 0) return 'Today';
  if (offset === -1) return 'Yesterday';
  if (offset === 1) return 'Tomorrow';
  return asDate(day).toLocaleDateString(
    undefined,
    Math.abs(offset) < 7 ? { weekday: 'long' } : { month: 'short', day: 'numeric' },
  );
}

/** A day before `today`: "Wed" within the last week, else "Nov 4" */
export function shortDay(day: string, today: string): string {
  const ago = dayDiff(day, today);
  return asDate(day).toLocaleDateString(undefined, ago < 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' });
}
