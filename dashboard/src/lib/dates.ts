export const DAY_MS = 864e5;

export function dayStart(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** '16:52' -> that time on `day` */
export function atTime(hm: string, day: Date): Date {
  const [h, m] = hm.split(':').map(Number);
  const d = dayStart(day);
  d.setHours(h, m);
  return d;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Whole calendar days from `from` to `to` (0 = same day) */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((dayStart(to).getTime() - dayStart(from).getTime()) / DAY_MS);
}

export const minutesBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60000;
