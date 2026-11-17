// Google Calendar events and tasks as the calendar shows them. Pure functions.
import { dueOn } from './tasks';
import { holidayEmoji } from './holidays';
import { dayOf, shiftDay } from '../lib/repeat';
import type { Calendar, CalEvent, Data, EventRecord, Person } from './types';
import { calendarPeople } from './select';

/** 'YYYY-MM-DD' → local midnight that day */
const localDay = (day: string) => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));

/** People named in a title, as whole words ("Jacob dentist", "John & Mary dinner", "Jacob's game") */
export function namesIn(title: string, people: Person[]): string[] {
  const words = new Set(title.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  return people.filter((p) => words.has(p.name.toLowerCase())).map((p) => p.id);
}

/**
 * Whose an event is: the people chosen for it on the dashboard; else, on a calendar that goes by
 * names, the people its title names; else the calendar's person ('family': everyone). A calendar
 * that's no one's gives [] (shown for everyone, in its own colour).
 */
export function whoFor(r: Pick<EventRecord, 'title' | 'people'>, c: Calendar, people: Person[]): string[] {
  if (c.person === 'none') return [];
  const all = people.map((p) => p.id);
  const pick = r.people?.length ? r.people : c.byName && namesIn(r.title, people).length ? namesIn(r.title, people) : [c.person];
  return pick.includes('family') ? all : pick.filter((id) => all.includes(id));
}

const LEADING_EMOJI = /^\s*(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*)\s*/u;

/** An event's emoji and the title to show beside it: the emoji chosen on the dashboard, or one the title starts with */
export function splitEmoji(title: string, emoji?: string): { emoji?: string; title: string } {
  if (emoji) return { emoji, title };
  const m = title.match(LEADING_EMOJI);
  return m && title.length > m[0].length ? { emoji: m[1], title: title.slice(m[0].length) } : { title };
}

/** No emoji of its own: a holiday's, or its calendar's (🎂 on Birthdays, 🏈 on a team's games) */
function withCalendarEmoji(t: { emoji?: string; title: string }, c: Calendar): { emoji?: string; title: string } {
  if (t.emoji) return t;
  const emoji = (c.holidays ? holidayEmoji(t.title) : undefined) ?? (c.emoji || undefined);
  return emoji ? { ...t, emoji } : t;
}

export function toCalEvent(r: EventRecord, c: Calendar, people: Person[]): CalEvent {
  const at = (v: string) => (r.allDay ? localDay(v) : new Date(v));
  const who = whoFor(r, c, people);
  return {
    id: r.calendar + ':' + r.id,
    gid: r.id,
    calendar: r.calendar,
    ...withCalendarEmoji(splitEmoji(r.title, r.emoji), c),
    start: at(r.start),
    end: at(r.end),
    ...(r.allDay ? { allDay: true } : {}),
    ...(r.location ? { loc: r.location } : {}),
    ...(r.notes ? { notes: r.notes } : {}),
    recurring: r.recurring,
    // No one's: placed like a family event, in the calendar's colour
    people: who.length ? who : people.map((p) => p.id),
    ...(c.person === 'none' ? { color: c.color } : {}),
  };
}

/** The data with `events` rebuilt from Google's events and calendars */
export function withEvents(d: Data): Data {
  if (!d.googleAccounts.length) return { ...d, events: [] };
  const shown = new Map(d.calendars.filter((c) => c.shown).map((c) => [c.id, c]));
  // One event can be on several calendars (one organizes it, the others have a guest's copy; Google
  // gives each copy the same id). Show it once, as Google Calendar does: the organizer's copy.
  const best = new Map<string, EventRecord>();
  for (const r of d.eventRecords) {
    if (!shown.has(r.calendar)) continue;
    const had = best.get(r.id);
    if (!had || (had.guest && !r.guest)) best.set(r.id, r);
  }
  return { ...d, events: [...best.values()].map((r) => toCalEvent(r, shown.get(r.calendar)!, calendarPeople(d.people))) };
}

/** The Worker's copy of a CalEvent from Google */
export const recordOf = (d: Data, e: CalEvent): EventRecord | undefined =>
  d.eventRecords.find((r) => r.calendar === e.calendar && r.id === e.gid);

/** Days either side of today that tasks are put on the calendar for */
const TASK_DAYS = 62;

/**
 * Tasks with "Show on calendar", as all-day items for each day they're due (from two months back to
 * two months ahead). Tapping one checks it off (src/views/calendar/EventSheet.tsx).
 */
export function taskEvents(d: Data, now: Date): CalEvent[] {
  const tasks = d.tasks.filter((t) => t.onCalendar);
  if (!tasks.length) return [];
  const today = dayOf(now);
  const out: CalEvent[] = [];
  for (let i = -TASK_DAYS; i <= TASK_DAYS; i++) {
    const day = shiftDay(today, i);
    const [y, m, dd] = day.split('-').map(Number);
    for (const x of dueOn(tasks, d.taskDone, day, today)) {
      const t = x.task;
      out.push({
        id: `task:${t.id}:${day}`,
        title: (x.done ? '✓ ' : '') + t.title,
        ...(t.emoji ? { emoji: t.emoji } : {}),
        start: new Date(y, m - 1, dd),
        end: new Date(y, m - 1, dd + 1),
        allDay: true,
        people: t.who === 'any' ? [...d.ALL] : [t.who],
        task: { id: t.id, day: x.day, done: !!x.done },
      });
    }
  }
  return out;
}
