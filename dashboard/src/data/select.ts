// Read-only helpers over the data. Pure functions: pass in what they need (data, events, now).
import { addDays, atTime, dayStart, daysBetween } from '../lib/dates';
import { OTHER } from './grocery';
import { fmt } from '../lib/fmt';
import type { CalEvent, Data, Person, Verse, Weather, WxCond } from './types';

// ------------------------------------------------------------ people
export function person(d: Data, id: string): Person {
  if (id === 'family' || id === 'any') return d.family;
  return d.people.find((p) => p.id === id) ?? d.family;
}
/** People on the calendar (event people, columns, "everyone"): not tasks-only profiles */
export const calendarPeople = (people: Person[]): Person[] => people.filter((p) => p.calendar !== false);
/** People with tasks (columns, rings, the task picker): not calendar-only profiles */
export const taskPeople = (people: Person[]): Person[] => people.filter((p) => p.tasks !== false);
/**
 * The columns on the task screens, in order: people, Anyone, then tasks-only profiles (a project's
 * list like "Dashboard" comes last, after the household)
 */
export const taskLanes = (people: Person[]): string[] => {
  const ps = taskPeople(people);
  return [...ps.filter((p) => p.calendar !== false).map((p) => p.id), 'any', ...ps.filter((p) => p.calendar === false).map((p) => p.id)];
};
/** Who reminders can go to (a phone's owner): people, not pets or tasks-only profiles */
export const phonePeople = (people: Person[]): Person[] => people.filter((p) => !p.pet && p.calendar !== false);

// ------------------------------------------------------------ calendar
export const isFamily = (d: Data, e: CalEvent) => e.people.length >= d.ALL.length;
export const evColor = (d: Data, e: CalEvent): Person =>
  e.color ? { ...d.family, color: e.color } : isFamily(d, e) ? d.family : person(d, e.people[0]);
/**
 * The people an event is striped with: two or more, but not everyone (that's Family's colour) and
 * not on a calendar with a colour of its own. Empty when it's drawn in one colour.
 */
export function evStripes(d: Data, e: CalEvent): Person[] {
  if (e.color || isFamily(d, e)) return [];
  const ps = [...new Set(e.people)].map((id) => person(d, id)).filter((p, i, all) => p !== d.family && all.indexOf(p) === i);
  return ps.length >= 2 ? ps : [];
}
/** An event's title with its emoji in front, where it has one */
export const evLabel = (e: Pick<CalEvent, 'emoji' | 'title'>): string => (e.emoji ? e.emoji + ' ' + e.title : e.title);
export const leaveBy = (e: CalEvent): Date => (e.travel ? new Date(e.start.getTime() - e.travel * 60000) : e.start);

function onDay(events: CalEvent[], day: Date, allDay: boolean, pid?: string) {
  const s = dayStart(day), e = addDays(s, 1);
  return events.filter((ev) => !!ev.allDay === allDay && ev.start < e && ev.end > s && (!pid || ev.people.includes(pid)));
}
export function timedOn(events: CalEvent[], day: Date, pid?: string): CalEvent[] {
  return onDay(events, day, false, pid).sort((a, b) => +a.start - +b.start || +b.end - +a.end);
}
export const allDayOn = (events: CalEvent[], day: Date, pid?: string) => onDay(events, day, true, pid);

/** The next thing someone needs to act on: earliest upcoming "leave by" today. */
export function nextEvent(events: CalEvent[], now: Date): CalEvent | null {
  const list = timedOn(events, now).filter((e) => e.start > now);
  list.sort((a, b) => +leaveBy(a) - +leaveBy(b));
  return list[0] ?? null;
}

/** Countdown chips: the next few all-day events (starting tomorrow or later), one per title. */
export function countdowns(events: CalEvent[], now: Date, limit = 6): CalEvent[] {
  const today = dayStart(now), seen = new Set<string>();
  // Sorted before keeping one per title, so it's the soonest of a repeating one (this year's birthday,
  // not next year's)
  return events
    .filter((e) => e.allDay && dayStart(e.start) > today)
    .sort((a, b) => +a.start - +b.start)
    .filter((e) => !seen.has(e.title) && !!seen.add(e.title))
    .slice(0, limit);
}

// ------------------------------------------------------------ weather
export const WX_LABELS: Record<WxCond, string> = {
  sun: 'Sunny', moon: 'Clear', partly: 'Partly cloudy', cloud: 'Overcast', rain: 'Rain', snow: 'Snow', fog: 'Fog', storm: 'Thunderstorms',
};
const WET: WxCond[] = ['rain', 'snow', 'storm'];

/** Index into the hourly lists for an hour (they start at midnight of `W.day`) */
function hourIndex(W: Weather, at: Date): number {
  const [y, m, d] = W.day.split('-').map(Number);
  return Math.max(0, Math.round((at.getTime() - new Date(y, m - 1, d).getTime()) / 3600000 - 0.5));
}
/** The forecast for an hour: temperature, condition, precipitation chance (the last one known, if past the end) */
function hourAt(W: Weather, i: number) {
  const x = Math.min(i, W.t.length - 1);
  return { t: W.t[x], c: W.c[x], p: W.p[x] };
}

/** What to wear for a temperature (°F) */
function advise(t: number): string {
  if (t < 20) return 'Bundle up, it’s bitter';
  if (t < 35) return 'Coat, hat and gloves';
  if (t < 55) return 'Jacket weather';
  if (t < 70) return 'Light layers';
  return 'T-shirt weather';
}

/** What the dashboard says about the weather; null until it has loaded */
export function weatherNow(d: Data, events: CalEvent[], now: Date) {
  const W = d.weather;
  if (!W) return null;
  const i = hourIndex(W, now);
  // Current conditions if fresh (fetched in the last 90 minutes), else this hour's forecast
  const fresh = now.getTime() - Date.parse(W.updated) < 90 * 60000;
  const cur = fresh ? { t: W.now.t, c: W.now.c } : hourAt(W, i);
  const at = (hour: number) => new Date(2000, 0, 1, hour % 24);
  // Rain or snow (50%+) before the end of today
  const endOfDay = i - now.getHours() + 24;
  let wetAt = -1;
  for (let x = i; x < Math.min(endOfDay, W.p.length); x++) if (W.p[x] >= 50) { wetAt = x; break; }
  const word = (x: number) => (W.c[x] === 'snow' ? 'Snow' : 'Rain');
  let summary: string, advice: string;
  if (wetAt === i) {
    let stop = i;
    while (stop < Math.min(endOfDay, W.p.length) && W.p[stop] >= 50) stop++;
    summary = word(i) + (stop >= endOfDay ? ' through tonight' : ' until ' + fmt.hour(at(stop)));
    advice = W.c[i] === 'snow' ? 'Boots and gloves' : 'Umbrella weather';
  } else if (wetAt > -1) {
    summary = word(wetAt) + ' from ' + fmt.hour(at(wetAt));
    const soccer = timedOn(events, now).some((e) => /soccer/i.test(e.title) && e.start > now);
    advice = W.c[wetAt] === 'snow' ? 'Boots and gloves later' : soccer ? 'Pack a rain jacket for soccer' : 'Grab a rain jacket';
  } else {
    summary = WET.includes(cur.c) ? WX_LABELS[cur.c] : W.hi < 32 ? 'Cold and dry' : 'Dry all day';
    advice = advise(fresh ? W.now.feels : cur.t);
  }
  return { temp: cur.t, cond: cur.c, label: WX_LABELS[cur.c], hi: W.hi, lo: W.lo, feels: fresh ? W.now.feels : cur.t, summary, advice };
}

export function hourly(d: Data, now: Date, count: number) {
  const W = d.weather;
  if (!W) return [];
  const i = hourIndex(W, now);
  const fresh = now.getTime() - Date.parse(W.updated) < 90 * 60000;
  return Array.from({ length: count }, (_, k) => {
    const x = (now.getHours() + k) % 24;
    const f = hourAt(W, i + k);
    // "Now" is the current reading, as at the top
    return { h: x, ...f, ...(k === 0 && fresh ? { t: W.now.t, c: W.now.c } : {}), label: k === 0 ? 'Now' : (x % 12 || 12) + (x >= 12 ? 'p' : 'a') };
  });
}

/** The forecast condition for a day (today's from now on, as on the weather sheet); undefined past the forecast */
export function dayWeather(W: Weather | null, day: Date): WxCond | undefined {
  if (!W) return undefined;
  const [y, m, dd] = W.day.split('-').map(Number);
  const n = Math.round((dayStart(day).getTime() - new Date(y, m - 1, dd).getTime()) / 864e5);
  return W.daily.find((r) => r.d === n)?.c;
}

/** Between sunset and sunrise (today's times from the weather data) */
export function afterDark(d: Data, now: Date): boolean {
  if (!d.weather) return now.getHours() >= 19 || now.getHours() < 7; // no sun times yet: 7 pm to 7 am
  return now >= atTime(d.weather.sunset, now) || now < atTime(d.weather.sunrise, now);
}

// ------------------------------------------------------------ photos
/** A stored photo: `full` for the slideshow (≤1920px), `thumb` for the grid */
export const photoSrc = (id: string, size: 'full' | 'thumb' = 'full') => `/media/${id}/${size}`;

// ------------------------------------------------------------ groceries
/**
 * Every item name we know, [name, aisle]: names added before (with the aisle each was last in, most
 * used first), then the starter guesses for names never added. Drives aisle guesses and suggestions.
 */
export function knownGroceries(d: Data): [string, string][] {
  const seen = new Set(d.groceryNames.map(([n]) => n.toLowerCase()));
  // remembered names that are also presets show with the presets' spelling
  const preset = new Map(d.catalog.map(([n]) => [n.toLowerCase(), n]));
  const remembered = d.groceryNames.map(([n, cat]): [string, string] => [preset.get(n.toLowerCase()) ?? n, cat]);
  return [...remembered, ...d.catalog.filter(([n]) => !seen.has(n.toLowerCase()))];
}

/**
 * How an item's name is spelled on the list: a usual or starter item always as the presets spell it
 * (lowercase, except brands), else as it was last added, else exactly as typed.
 */
export function spellGrocery(d: Data, name: string): string {
  const typed = name.trim().replace(/\s+/g, ' ');
  const lower = typed.toLowerCase();
  return d.usuals.find((u) => u.toLowerCase() === lower)
    ?? d.catalog.find(([n]) => n.toLowerCase() === lower)?.[0]
    ?? d.groceryNames.find(([n]) => n.toLowerCase() === lower)?.[0]
    ?? typed;
}

/** Aisle for a typed item: where it was last time, else the closest known name's, else 'Other' */
export function categorize(d: Data, name: string): string {
  const n = name.trim().toLowerCase();
  const known = knownGroceries(d);
  const hit =
    known.find((c) => c[0].toLowerCase() === n) ||
    known.find((c) => { const a = c[0].toLowerCase(); return a.includes(n) || n.includes(a); }) ||
    known.find((c) => n.split(/\s+/).some((w) => w.length > 3 && c[0].toLowerCase().includes(w)));
  return hit ? hit[1] : OTHER;
}
export const findGrocery = (d: Data, name: string, done: boolean) =>
  d.groceries.find((g) => g.done === done && g.name.toLowerCase() === name.toLowerCase());

// ------------------------------------------------------------ verse of the day
/** Today's verse (from Bible Gateway), or a built-in one if it couldn't be loaded */
export function verseOfDay(d: Data, now: Date): Verse {
  if (d.verse) return d.verse;
  const dayOfYear = daysBetween(new Date(now.getFullYear(), 0, 0), now);
  return { ...d.verses[dayOfYear % d.verses.length], version: 'KJV' };
}
