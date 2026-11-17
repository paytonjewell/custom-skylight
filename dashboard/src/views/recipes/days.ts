// Day names for Recipes ("Today", "Tue 17", "Tuesday, Nov 17") and "made 3 days ago"
import { asDate } from '../../lib/days';
import { dayDiff } from '../../lib/repeat';

export function dayLabel(day: string, today: string, long = false): string {
  const n = dayDiff(today, day);
  if (n === 0) return 'Tonight';
  if (n === 1) return 'Tomorrow';
  const d = asDate(day);
  return long
    ? d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
    : d.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + d.getDate();
}

export function madeAgo(day: string, today: string): string {
  const n = dayDiff(day, today);
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 14) return n + ' days ago';
  if (n < 60) return Math.round(n / 7) + ' weeks ago';
  return Math.round(n / 30) + ' months ago';
}
