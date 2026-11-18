// Tests for Google Calendar: event checks and conversion (worker/google.ts), Google → CalEvent
// and tasks shown on the calendar (src/data/calendar.ts)
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { calendarEmoji, eventFields, toRecord } from '../worker/google.ts';
import { splitEmoji, taskEvents, toCalEvent, whoFor, withEvents } from '../src/data/calendar.ts';
import type { Calendar, Data, Person, Task } from '../src/data/types.ts';

test('Google events become records; cancelled ones are dropped', () => {
  assert.deepEqual(
    toRecord(
      {
        id: 'abc_20261116T150000Z',
        summary: 'Soccer',
        start: { dateTime: '2026-11-16T09:00:00-06:00' },
        end: { dateTime: '2026-11-16T10:00:00-06:00' },
        recurringEventId: 'abc',
      },
      'cal1',
    ),
    {
      id: 'abc_20261116T150000Z',
      calendar: 'cal1',
      title: 'Soccer',
      start: '2026-11-16T09:00:00-06:00',
      end: '2026-11-16T10:00:00-06:00',
      allDay: false,
      location: '',
      notes: '',
      recurring: true,
    },
  );
  assert.equal(toRecord({ id: 'x', status: 'cancelled' }, 'cal1'), null);
  const allDay = toRecord({ id: 'y', start: { date: '2026-11-20' }, end: { date: '2026-11-22' } }, 'cal1')!;
  assert.equal(allDay.allDay, true);
  assert.equal(allDay.title, '(No title)');
});

test('event fields from the app are checked', () => {
  const ok = { title: ' Dentist ', start: '2026-11-16T15:00:00.000Z', end: '2026-11-16T16:00:00.000Z', allDay: false };
  assert.deepEqual(eventFields(ok, false), { title: 'Dentist', start: ok.start, end: ok.end, allDay: false });
  assert.equal(eventFields({ ...ok, title: '' }, false), null); // needs a title
  assert.equal(eventFields({ ...ok, end: '2026-11-16T14:00:00.000Z' }, false), null); // ends before it starts
  assert.equal(eventFields({ title: 'x', start: '2026-11-20', end: '2026-11-20', allDay: true }, false), null); // all-day end is the day after
  assert.ok(eventFields({ title: 'x', start: '2026-11-20', end: '2026-11-21', allDay: true }, false));
  assert.equal(eventFields({ start: ok.start }, true), null); // times change together
  assert.deepEqual(eventFields({ location: 'Park' }, true), { location: 'Park' });
});

const cal = (person: string, byName = false): Calendar => ({
  id: 'cal1',
  account: '1',
  name: 'Reminders',
  color: '#039be5',
  person,
  byName,
  isDefault: false,
  emoji: '',
  holidays: false,
  shown: true,
  writable: true,
});
const PEOPLE: Person[] = [
  { id: 'john', name: 'John', tone: 1 },
  { id: 'mary', name: 'Mary', tone: 2 },
  { id: 'jacob', name: 'Jacob', tone: 3 },
  { id: 'pets', name: 'Pets', tone: 4 },
];
const ALL = PEOPLE.map((p) => p.id);

test('records become calendar events: whose calendar decides the people; all-day days are local', () => {
  const r = {
    id: 'y',
    calendar: 'cal1',
    title: 'Trip',
    start: '2026-11-20',
    end: '2026-11-22',
    allDay: true,
    location: '',
    notes: '',
    recurring: false,
  };
  const e = toCalEvent(r, cal('john'), PEOPLE);
  assert.deepEqual(e.people, ['john']);
  assert.equal(e.color, undefined);
  assert.equal(e.start.getDate(), 20);
  assert.equal(e.start.getHours(), 0);
  assert.equal(e.end.getDate(), 22);
  assert.deepEqual(toCalEvent(r, cal('family'), PEOPLE).people, ALL);
  // No one's (birthdays, a team's games): everyone, in the calendar's colour
  const b = toCalEvent({ ...r, title: 'Jacob birthday' }, cal('none', true), PEOPLE);
  assert.deepEqual(b.people, ALL);
  assert.equal(b.color, '#039be5');
});

test('names in titles pick who; otherwise the calendar’s person; a choice on the event wins', () => {
  const c = cal('john', true);
  assert.deepEqual(whoFor({ title: 'Jacob medical appointment' }, c, PEOPLE), ['jacob']);
  assert.deepEqual(whoFor({ title: "Pick up Jacob's cleats" }, c, PEOPLE), ['jacob']);
  assert.deepEqual(whoFor({ title: 'John & Mary dinner' }, c, PEOPLE), ['john', 'mary']);
  assert.deepEqual(whoFor({ title: 'Oil change' }, c, PEOPLE), ['john']);
  assert.deepEqual(whoFor({ title: 'Leonardo exhibit' }, c, PEOPLE), ['john']); // whole words only
  assert.deepEqual(whoFor({ title: 'Jacob dentist' }, cal('john'), PEOPLE), ['john']); // calendar doesn't go by names
  assert.deepEqual(whoFor({ title: 'medical appointment', people: ['jacob'] }, c, PEOPLE), ['jacob']);
  assert.deepEqual(whoFor({ title: 'Jacob dentist', people: ['family'] }, c, PEOPLE), ALL);
  assert.deepEqual(whoFor({ title: 'Anything' }, cal('none'), PEOPLE), []);
});

test('people chosen on the dashboard are kept on the Google event', () => {
  const r = toRecord(
    {
      id: 'z',
      summary: 'medical appointment',
      start: { date: '2026-11-20' },
      end: { date: '2026-11-21' },
      extendedProperties: { private: { hqWho: 'jacob' } },
    },
    'cal1',
  )!;
  assert.deepEqual(r.people, ['jacob']);
  // Cleared: an empty value means none chosen
  assert.equal(
    toRecord(
      {
        id: 'z',
        start: { date: '2026-11-20' },
        end: { date: '2026-11-21' },
        extendedProperties: { private: { hqWho: '' } },
      },
      'cal1',
    )!.people,
    undefined,
  );
  assert.deepEqual(eventFields({ people: ['jacob', 'mary'] }, true), { people: ['jacob', 'mary'] });
  assert.deepEqual(eventFields({ people: null }, true), { people: [] });
  assert.equal(eventFields({ people: ['Bad Id'] }, true), null);
});

test('tasks marked "show on calendar" appear on the days they are due', () => {
  const t: Task = {
    id: 't',
    title: 'Recycling',
    emoji: '♻️',
    who: 'john',
    repeat: { kind: 'monthlyNth', nth: 1, weekday: 4, offset: -1, start: '2026-01-01' },
    due: null,
    slot: 'evening',
    time: null,
    habit: false,
    onCalendar: true,
    remind: null,
    notify: [],
    listId: null,
    listItemId: null,
    created: '2026-01-01T00:00:00Z',
  };
  const d = {
    tasks: [t, { ...t, id: 'u', onCalendar: false }],
    taskDone: [{ task: 't', day: '2026-12-02', at: '2026-12-02T20:00:00Z', by: null }],
    ALL: ['john'],
  } as unknown as Data;
  const evs = taskEvents(d, '2026-11-16');
  const days = evs.map((e) => `${e.start.getMonth() + 1}/${e.start.getDate()}`);
  assert.ok(days.includes('12/2'), days.join(' ')); // Wed before Thu Dec 3
  // Nov 4 wasn't done: it waits on today as overdue (checking it off counts for Nov 4)
  const today = evs.find((e) => e.start.getMonth() === 10 && e.start.getDate() === 16)!;
  assert.deepEqual(today.task, { id: 't', day: '2026-11-04', done: false });
  assert.ok(!days.includes('11/17'));
  const dec2 = evs.find((e) => e.start.getMonth() === 11 && e.start.getDate() === 2)!;
  assert.equal(dec2.title, '✓ Recycling');
  assert.equal(dec2.emoji, '♻️');
  assert.deepEqual(dec2.task, { id: 't', day: '2026-12-02', done: true });
  assert.ok(evs.every((e) => e.task?.id === 't')); // not the task without "show on calendar"
});

test('Google’s own contact birthdays are left out', () => {
  const bday = {
    id: 'b_20261101',
    summary: "Andy's birthday",
    start: { date: '2026-11-01' },
    end: { date: '2026-11-02' },
  };
  assert.equal(toRecord({ ...bday, eventType: 'birthday' }, 'main'), null);
  assert.ok(toRecord({ ...bday, eventType: 'default' }, 'bdays'));
});

test('an event on two calendars shows once: the organizer’s copy', () => {
  const g = (calendar: string, guest: boolean) =>
    toRecord(
      {
        id: 'bday_20261101',
        summary: "Andy's birthday",
        start: { date: '2026-11-01' },
        end: { date: '2026-11-02' },
        organizer: { self: !guest },
      },
      calendar,
    )!;
  const d = {
    people: PEOPLE,
    googleAccounts: [{ id: '1', email: 'x', error: false }],
    calendars: [
      { ...cal('john', true), id: 'main' },
      { ...cal('none'), id: 'bdays', color: '#fad165' },
    ],
    eventRecords: [g('main', true), g('bdays', false)],
  } as unknown as Data;
  const events = withEvents(d).events;
  assert.equal(events.length, 1);
  assert.equal(events[0].calendar, 'bdays');
  assert.equal(events[0].color, '#fad165');
});

test('countdowns: the next events in date order, the soonest of each title', async () => {
  const { countdowns } = await import('../src/data/select.ts');
  const day = (m: number, d: number, title: string, y = 2026) => ({
    id: title + y,
    title,
    start: new Date(y, m - 1, d),
    end: new Date(y, m - 1, d + 1),
    allDay: true,
    people: [],
  });
  // Next year's birthday comes first in the list, as stored copies can
  const events = [
    day(12, 1, "Ann's birthday", 2027),
    day(12, 25, 'Christmas'),
    day(11, 26, 'Thanksgiving'),
    day(12, 1, "Ann's birthday"),
    day(11, 10, 'Past'),
    // At a time of day: counts too, from tomorrow on (one later today is on the agenda already)
    {
      ...day(11, 20, 'Leo doctor'),
      start: new Date(2026, 10, 20, 15, 30),
      end: new Date(2026, 10, 20, 16),
      allDay: false,
    },
    {
      ...day(11, 16, 'Later today'),
      start: new Date(2026, 10, 16, 17),
      end: new Date(2026, 10, 16, 18),
      allDay: false,
    },
  ];
  const list = countdowns(events, new Date(2026, 10, 16, 9), 6);
  assert.deepEqual(
    list.map((e) => e.title + ' ' + e.start.getFullYear()),
    ['Leo doctor 2026', 'Thanksgiving 2026', "Ann's birthday 2026", 'Christmas 2026'],
  );
});

test('event emoji: chosen on the dashboard (kept on the Google event), or one the title starts with', () => {
  const r = toRecord(
    {
      id: 'e',
      summary: 'Date night',
      start: { date: '2026-11-20' },
      end: { date: '2026-11-21' },
      extendedProperties: { private: { hqEmoji: '🍝' } },
    },
    'cal1',
  )!;
  assert.equal(r.emoji, '🍝');
  assert.equal(r.title, 'Date night'); // the title stays as typed
  const e = toCalEvent(r, cal('john'), PEOPLE);
  assert.equal(e.emoji, '🍝');
  assert.equal(e.title, 'Date night');
  assert.deepEqual(splitEmoji('🎂 Andy’s birthday'), { emoji: '🎂', title: 'Andy’s birthday' });
  assert.deepEqual(splitEmoji('👨‍👩‍👦 Family photos'), { emoji: '👨‍👩‍👦', title: 'Family photos' });
  assert.deepEqual(splitEmoji('Jacob dentist'), { title: 'Jacob dentist' });
  assert.deepEqual(splitEmoji('🎉'), { title: '🎉' }); // nothing but an emoji: keep it as the title
  assert.deepEqual(eventFields({ emoji: '🍝' }, true), { emoji: '🍝' });
  assert.deepEqual(eventFields({ emoji: '' }, true), { emoji: '' });
});

test('calendar emoji: its events get it unless they have their own; holidays get their own', () => {
  const r = {
    id: 'b',
    calendar: 'cal1',
    title: "Andy's birthday",
    start: '2026-11-01',
    end: '2026-11-02',
    allDay: true,
    location: '',
    notes: '',
    recurring: false,
  };
  const bdays = { ...cal('none'), emoji: '🎂' };
  assert.equal(toCalEvent(r, bdays, PEOPLE).emoji, '🎂');
  assert.equal(toCalEvent({ ...r, emoji: '🥳' }, bdays, PEOPLE).emoji, '🥳');
  assert.equal(toCalEvent({ ...r, title: '🎈 Party' }, bdays, PEOPLE).emoji, '🎈');
  const hol = { ...cal('none'), holidays: true };
  const h = (title: string) => toCalEvent({ ...r, title }, hol, PEOPLE).emoji;
  assert.equal(h('Thanksgiving Day'), '🦃');
  assert.equal(h('Christmas Eve'), '🎄');
  assert.equal(h("Valentine's Day"), '❤️');
  assert.equal(h("New Year's Eve"), '🥂');
  assert.equal(h("New Year's Day"), '🎉');
  assert.equal(h('Some new holiday'), undefined);
  assert.equal(calendarEmoji('abc@group.calendar.google.com', 'Birthdays'), '🎂');
  assert.equal(
    calendarEmoji('nfl_-m-03b3j_%47reen+%42ay+%50ackers#sports@group.v.calendar.google.com', 'Green Bay Packers'),
    '🏈',
  );
  assert.equal(calendarEmoji('nba_x#sports@group.v.calendar.google.com', 'Bulls'), '🏀');
  assert.equal(calendarEmoji('abc@group.calendar.google.com', 'Work'), '');
});
