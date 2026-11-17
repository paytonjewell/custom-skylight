// Add or edit a Google Calendar event: what, an optional emoji (kept beside the title, not in it), which calendar, who it's for,
// the day, all day or the times, and where. New events go on the default calendar (Calendar settings).
// Who it's for starts as whose the calendar says (names in the title, on one that goes by names) and
// can be changed; a change is kept on the event. The title is saved exactly as typed.
// Editing one occurrence of a repeating event changes just that occurrence.
import { Stepper } from '../../ui/Stepper';
import { Chip, DateChip } from '../../ui/Chip';
import { useState } from 'react';
import type { CalEvent, Calendar } from '../../data/types';
import { dataStore, useData } from '../../data/store';
import { addCalEvent, deleteCalEvent, editCalEvent, restoreCalEvent, type EventFields } from '../../data/actions';
import { recordOf, whoFor } from '../../data/calendar';
import { calendarPeople, person } from '../../data/select';
import { addDays, dayStart, sameDay } from '../../lib/dates';
import { fmt } from '../../lib/fmt';
import { now as clockNow } from '../../lib/clock';
import { closeSheet, openSheet, toast } from '../../app/ui';
import { EmojiTitle } from '../../ui/EmojiTitle';
import { Avatar } from '../../ui/people';
import { PersonPicker } from '../../ui/PersonPicker';
import { openCalendarSettings } from './CalendarSettings';
import css from './AddEventSheet.module.css';

const TIMES = [
  ['08:00', '8 AM'],
  ['12:00', 'Noon'],
  ['15:30', '3:30 PM'],
  ['16:30', '4:30 PM'],
  ['18:00', '6 PM'],
  ['19:30', '7:30 PM'],
];
const LENGTHS = [
  [30, '30m'],
  [60, '1h'],
  [90, '1½h'],
  [120, '2h'],
] as const;

/** `onAdded` lets the calendar jump to the new event's day */
export function openAddEventSheet(onAdded: (start: Date) => void, day?: Date): void {
  openSheet(() => <EventForm onAdded={onAdded} day={day} />, { cls: 'sheet--wide' });
}
export function openEditEventSheet(e: CalEvent): void {
  openSheet(() => <EventForm event={e} />, { cls: 'sheet--wide' });
}

/** Delete an event, with Undo */
export function removeEvent(e: CalEvent): void {
  const r = recordOf(dataStore.get(), e);
  if (!r) return;
  deleteCalEvent(r);
  toast(
    <>
      Deleted <b>{r.title}</b>
    </>,
    { icon: 'trash', undo: () => restoreCalEvent(r) },
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMinutes = (m: number) => `${pad(Math.floor((m % 1440) / 60))}:${pad(m % 60)}`;
const at = (day: Date, t: string) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutesOf(t));
/** "3:30 PM" */
const timeLabel = (t: string) => fmt.time(at(new Date(2000, 0, 1), t));

function EventForm({
  event,
  onAdded,
  day: startDay,
}: {
  event?: CalEvent;
  onAdded?: (start: Date) => void;
  day?: Date;
}) {
  const data = useData('calendars', 'eventRecords', 'family', 'googleAccounts', 'people');
  const [today] = useState(() => dayStart(clockNow()));
  const record = event ? recordOf(data, event) : undefined;
  /** Calendars it can go on: shown and writable (moving an existing one: same Google account only) */
  const choices = data.calendars.filter(
    (c) =>
      c.shown &&
      c.writable &&
      (!record ||
        (c.account === calOf(data.calendars, record.calendar)?.account &&
          (!record.recurring || c.id === record.calendar))),
  );

  const init = () => {
    if (event) {
      const mins = Math.max(15, Math.round((+event.end - +event.start) / 60000));
      return {
        day: dayStart(event.start),
        allDay: !!event.allDay,
        days: event.allDay ? Math.max(1, Math.round((+dayStart(event.end) - +dayStart(event.start)) / 864e5)) : 1,
        start: hhmm(event.start),
        end: fromMinutes(minutesOf(hhmm(event.start)) + mins),
      };
    }
    return {
      day: startDay && startDay >= today ? dayStart(startDay) : today,
      allDay: false,
      days: 1,
      start: '15:30',
      end: '16:30',
    };
  };
  const first = useState(init)[0];
  // The title as saved in Google (the event's own may have had a leading emoji split off for showing)
  const [title, setTitle] = useState(record?.title ?? event?.title ?? '');
  const [emoji, setEmoji] = useState(record?.emoji ?? '');
  const [calendar, setCalendar] = useState(
    () => record?.calendar ?? (choices.find((c) => c.isDefault) ?? choices[0])?.id ?? '',
  );
  /** People picked here (person ids, or ['family']); null: whose the calendar says */
  const [chosen, setChosen] = useState<string[] | null>(record?.people?.length ? record.people : null);
  const [day, setDay] = useState(first.day);
  const [allDay, setAllDay] = useState(first.allDay);
  const [days, setDays] = useState(first.days);
  const [start, setStart] = useState(first.start);
  const [end, setEnd] = useState(first.end);
  const [loc, setLoc] = useState(event?.loc ?? '');
  const [notes, setNotes] = useState(event?.notes ?? '');

  if (!choices.length) {
    return (
      <div className={'sheet-pad ' + css.add}>
        <div className="label">{event ? 'Edit event' : 'New event'}</div>
        <p className={css.note}>
          {event
            ? 'This event is on a calendar the dashboard can’t change.'
            : data.googleAccounts.length
              ? 'Pick which calendars to show (and one you can add to) in Calendar settings.'
              : 'Connect Google Calendar to add events.'}
        </p>
        <div className="sheet-actions">
          <button className="btn btn--ghost" onClick={closeSheet}>
            Close
          </button>
          {!event && (
            <button
              className="btn btn--solid"
              onClick={() => {
                closeSheet();
                openCalendarSettings();
              }}
            >
              Calendar settings
            </button>
          )}
        </div>
      </div>
    );
  }

  const cal = calOf(data.calendars, calendar);
  const calPeople = calendarPeople(data.people);
  const allIds = calPeople.map((p) => p.id);
  /** Whose the calendar says it is, from the title as it is now */
  const auto = cal ? whoFor({ title }, cal, calPeople) : [];
  const who = chosen ? (chosen.includes('family') ? allIds : chosen) : auto;
  const pickWho = (id: string) => {
    if (id === 'family') return setChosen(['family']);
    // The first tap replaces whose the calendar says; later taps add or remove people
    const now = !chosen || who.length === allIds.length ? [] : who;
    const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
    setChosen(next.length ? next : null);
  };
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  /** Kept on the event only when it differs from whose the calendar says ([]: none kept) */
  const people =
    !cal || cal.person === 'none' || !chosen || same(who, auto) ? [] : who.length === allIds.length ? ['family'] : who;

  const length = (minutesOf(end) - minutesOf(start) + 1440) % 1440 || 1440;
  const pickStart = (t: string) => {
    setStart(t);
    setEnd(fromMinutes(minutesOf(t) + length)); // keep the length
  };

  const save = () => {
    const name = title.trim() || 'New event';
    const s = at(day, start);
    // Ends at or before it starts: the end is the next day
    const e = new Date(s.getTime() + length * 60000);
    const f: EventFields = {
      calendar,
      title: name,
      allDay,
      start: allDay ? dayKey(day) : s.toISOString(),
      end: allDay ? dayKey(addDays(day, days)) : e.toISOString(),
      location: loc.trim(),
      notes: notes.trim(),
      ...(people.length ? { people } : {}),
      ...(emoji ? { emoji } : {}),
    };
    closeSheet();
    if (record) {
      // Always sent on an edit, so clearing either one reaches Google
      f.people = people;
      f.emoji = emoji;
      const { calendar: to, ...rest } = f;
      editCalEvent(record, to !== record.calendar ? { ...rest, calendar: to } : rest);
      return;
    }
    addCalEvent(f);
    onAdded?.(allDay ? day : s);
    toast(
      <>
        Added <b>{name}</b> · {fmt.rel(day, clockNow())}
        {allDay ? '' : ' ' + fmt.time(s)}
      </>,
      { icon: 'calendar' },
    );
  };

  const dayChoices = [0, 1, 2, 3, 4].map((i) => addDays(today, i));
  const picked = !dayChoices.some((d) => sameDay(d, day));
  return (
    <div className={'sheet-pad ' + css.add}>
      <div className="label">{event ? 'Edit event' : 'New event'}</div>
      {/* Its own emoji, or else the calendar's (🎂 on Birthdays), which it gets without saving one */}
      <EmojiTitle
        emoji={emoji}
        onEmoji={setEmoji}
        fallback={cal?.emoji || undefined}
        clearable
        title={title}
        onTitle={setTitle}
        placeholder="What’s happening?"
        autoFocus={!event}
      />
      {record?.recurring && (
        <p className={css.note}>This is one occurrence of a repeating event; changes apply to this one only.</p>
      )}

      <div className="label">Calendar</div>
      <div className="chips">
        {choices.map((c) => (
          <Chip key={c.id} on={calendar === c.id} className={css.calChip} onClick={() => setCalendar(c.id)}>
            <CalendarMark c={c} />
            {c.name}
          </Chip>
        ))}
      </div>

      {cal && cal.person !== 'none' && (
        <>
          <div className="label">
            Who
            {!chosen && !same(auto, whoFor({ title: '' }, cal, calPeople)) && (
              <span className={css.hint}> · from the name in the title</span>
            )}
          </div>
          <PersonPicker
            people={calPeople}
            everyone={data.family}
            avatarSize={44}
            selected={who.length === allIds.length ? ['family'] : who}
            onPick={pickWho}
          />
        </>
      )}

      <div className="label">Day</div>
      <div className="chips">
        {dayChoices.map((d, i) => (
          <Chip key={i} on={sameDay(d, day)} onClick={() => setDay(d)}>
            {i < 2 ? fmt.rel(d, today) : fmt.dayShort(d) + ' ' + d.getDate()}
          </Chip>
        ))}
        <DateChip on={picked} value={dayKey(day)} onChange={(v) => v && setDay(new Date(v + 'T00:00:00'))}>
          {picked ? fmt.dayShort(day) + ', ' + fmt.monthShort(day) + ' ' + day.getDate() : 'Pick a day'}
        </DateChip>
      </div>

      <div className="label">Time</div>
      <div className="chips">
        <Chip on={allDay} onClick={() => setAllDay(true)}>
          All day
        </Chip>
        <Chip on={!allDay} onClick={() => setAllDay(false)}>
          At a time
        </Chip>
      </div>
      {allDay ? (
        <div className={css.more}>
          <Stepper value={days} onChange={setDays} max={60} label="days" unit={(n) => (n === 1 ? 'day' : 'days')} />
        </div>
      ) : (
        <div className={css.more}>
          <div className="chips">
            {TIMES.map(([t, label]) => (
              <Chip key={t} on={start === t} onClick={() => pickStart(t)}>
                {label}
              </Chip>
            ))}
          </div>
          <div className="chips">
            {LENGTHS.map(([m, label]) => (
              <Chip
                key={m}
                on={length === m}
                className="chip--ghost"
                onClick={() => setEnd(fromMinutes(minutesOf(start) + m))}
              >
                {label}
              </Chip>
            ))}
          </div>
          <div className={css.times}>
            <label>
              <span>Starts</span>
              <input type="time" value={start} required onChange={(e) => e.target.value && pickStart(e.target.value)} />
            </label>
            <label>
              <span>Ends</span>
              <input type="time" value={end} required onChange={(e) => e.target.value && setEnd(e.target.value)} />
            </label>
            <small>
              {timeLabel(start)} – {timeLabel(end)}
              {minutesOf(end) <= minutesOf(start) ? ' (next day)' : ''}
            </small>
          </div>
        </div>
      )}

      <div className="label">Where</div>
      <input
        className={css.field}
        placeholder="Add a place (optional)"
        value={loc}
        onChange={(e) => setLoc(e.target.value)}
      />
      <div className="label">Notes</div>
      <textarea
        className={css.field}
        rows={2}
        placeholder="Optional"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      <div className="sheet-actions">
        {event && (
          <button
            className={'btn btn--ghost ' + css.delete}
            onClick={() => {
              closeSheet();
              removeEvent(event);
            }}
          >
            Delete
          </button>
        )}
        <button className="btn btn--ghost" onClick={closeSheet}>
          Cancel
        </button>
        <button className="btn btn--solid" onClick={save}>
          {event ? 'Save' : 'Add to calendar'}
        </button>
      </div>
    </div>
  );
}

const calOf = (list: Calendar[], id: string) => list.find((c) => c.id === id);

/** A calendar's colour dot and whose it is */
function CalendarMark({ c }: { c: Calendar }) {
  const data = useData('family', 'people');
  return (
    <span className={css.mark}>
      <i style={{ background: c.color }} />
      {data.people.some((p) => p.id === c.person) && <Avatar p={person(data, c.person)} size={22} />}
    </span>
  );
}
