import { daysBetween } from './dates';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

/** The word for a count: pluralize(1, 'photo') → "photo", pluralize(3, 'photo') → "photos".
 *  Pass the plural for irregular words: pluralize(n, 'person', 'people'). */
export const pluralize = (count: number, singular: string, plural = singular + 's'): string =>
  count === 1 ? singular : plural;

const pad = (m: number) => (m < 10 ? '0' : '') + m;

export const fmt = {
  /** "3:45 PM", or "3:45" with ampm = false */
  time(d: Date, ampm = true): string {
    const h = d.getHours();
    const s = (h % 12 || 12) + ':' + pad(d.getMinutes());
    return ampm ? s + ' ' + (h >= 12 ? 'PM' : 'AM') : s;
  },
  /** "4 PM", "3:45 PM" */
  hour(d: Date): string {
    const h = d.getHours(),
      m = d.getMinutes();
    return (h % 12 || 12) + (m ? ':' + pad(m) : '') + ' ' + (h >= 12 ? 'PM' : 'AM');
  },
  ampm: (d: Date) => (d.getHours() >= 12 ? 'PM' : 'AM'),
  /** "3:45 – 4:30 PM", "11:30 AM – 12:15 PM" */
  range(a: Date, b: Date): string {
    const same = fmt.ampm(a) === fmt.ampm(b);
    return (same ? fmt.time(a, false) : fmt.time(a)) + ' – ' + fmt.time(b);
  },
  day: (d: Date) => DAYS[d.getDay()],
  dayShort: (d: Date) => DAYS[d.getDay()].slice(0, 3),
  month: (d: Date) => MONTHS[d.getMonth()],
  monthShort: (d: Date) => MON_SHORT[d.getMonth()],
  /** "12 min", "1 hr 37 min" */
  mins(m: number): string {
    m = Math.max(0, Math.round(m));
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60),
      r = m % 60;
    return h + ' hr' + (r ? ' ' + r + ' min' : '');
  },
  /** "Today" / "Tomorrow" / "Yesterday" / weekday name, relative to `now` */
  rel(d: Date, now: Date): string {
    const diff = daysBetween(now, d);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    return DAYS[d.getDay()];
  },
};
