// Moving calendar events by dragging (press and hold an event, then drag it). On the hour grid
// (Today, 3 Day) it goes to the time under it, in 15-minute steps, and to another day in 3 Day; on
// Week and Month, and onto the all-day row, it goes to another day at the same time. It writes to
// Google like an edit, so a repeating event's occurrence moves on its own ("This event"), and Undo
// puts it back. Events that can't be changed (a view-only calendar, a guest's copy, a task shown on
// the calendar) don't lift.
//
// Drop targets (data-drop): "t:YYYY-MM-DD" an hour-grid column (its top is START o'clock),
// "d:YYYY-MM-DD" a day, "a3:YYYY-MM-DD" the 3-day all-day row (the day comes from where across it).
import { createContext, useContext, type ReactNode } from 'react';
import type { CalEvent, Data, EventRecord } from '../../data/types';
import { useData } from '../../data/store';
import { recordOf } from '../../data/calendar';
import { editCalEvent } from '../../data/actions';
import { evLabel } from '../../data/select';
import { addDays, dayStart, sameDay } from '../../lib/dates';
import { fmt } from '../../lib/fmt';
import { now as clockNow } from '../../lib/clock';
import { toast } from '../../app/ui';
import { eventStyle } from '../../ui/people';
import { useDragDrop, type DragProps, type DropAt } from '../../ui/useDragDrop';
import css from './Calendar.module.css';

const SNAP = 15; // minutes

const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k: string) => new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)));

/** Its stored copy, if the dashboard may change it */
function movable(d: Data, e: CalEvent): EventRecord | null {
  if (e.task || !e.calendar) return null;
  const r = recordOf(d, e);
  const cal = d.calendars.find((c) => c.id === e.calendar);
  return r && !r.guest && cal?.writable ? r : null;
}

/** Where a drop would put it: its new start, or null if that's not a place it can go */
function landing(e: CalEvent, at: DropAt, hourGrid: { px: number; start: number }): Date | null {
  const [kind, key] = at.value.split(/:(.*)/s);
  if (!key) return null;
  if (kind === 'a3') {
    const r = at.el.getBoundingClientRect();
    const i = Math.max(0, Math.min(2, Math.floor(((at.x - r.left) / r.width) * 3)));
    return sameTime(e, addDays(fromKey(key), i));
  }
  if (kind === 'd' || (kind === 't' && e.allDay)) return sameTime(e, fromKey(key));
  if (kind !== 't') return null;
  // The block's top edge (where it was held, not the finger) sets the time
  const r = at.el.getBoundingClientRect();
  const scale = r.height / at.el.offsetHeight || 1;
  const mins = ((at.y - at.dy - r.top) / scale / hourGrid.px) * 60 + hourGrid.start * 60;
  const snapped = Math.max(0, Math.min(24 * 60 - SNAP, Math.round(mins / SNAP) * SNAP));
  const s = fromKey(key);
  s.setMinutes(snapped);
  return s;
}
/** The same time of day (or all day) on another day */
function sameTime(e: CalEvent, day: Date): Date {
  if (e.allDay) return dayStart(day);
  const s = dayStart(day);
  s.setHours(e.start.getHours(), e.start.getMinutes());
  return s;
}

/** Move it to start at `to`, keeping its length; Undo puts it back */
function moveEvent(r: EventRecord, e: CalEvent, to: Date): void {
  if (+to === +e.start) return;
  const len = +e.end - +e.start;
  const change = e.allDay
    ? { allDay: true, start: dayKey(to), end: dayKey(new Date(+to + len + 12 * 36e5)) } // (+12h: a DST day isn't 24h)
    : { allDay: false, start: to.toISOString(), end: new Date(+to + len).toISOString() };
  editCalEvent(r, change);
  const when = fmt.rel(to, clockNow()) + (e.allDay ? '' : ' ' + fmt.time(to));
  toast(
    <>
      Moved <b>{evLabel(e)}</b> to {sameDay(to, clockNow()) && !e.allDay ? fmt.time(to) : when}
    </>,
    {
      icon: 'calendar',
      undo: () => editCalEvent({ ...r, ...change }, { allDay: r.allDay, start: r.start, end: r.end }),
    },
  );
}

interface EventDrag {
  /** Props for an event that can be moved (nothing for one that can't) */
  bind: (e: CalEvent) => Partial<DragProps>;
  /** It's the one being dragged */
  lifted: (e: CalEvent) => boolean;
}
const NONE: EventDrag = { bind: () => ({}), lifted: () => false };
const Ctx = createContext<EventDrag>(NONE);
/** For event blocks and chips (nothing outside the Calendar screen, e.g. the month on Today) */
export const useEventDrag = () => useContext(Ctx);

/** The Calendar screen's dragging: wrap the views in it */
export function EventDragProvider({
  hourGrid,
  children,
}: {
  hourGrid: { px: number; start: number };
  children: ReactNode;
}) {
  const data = useData();
  const dnd = useDragDrop<CalEvent>({
    onDrop: (e, _target, at) => {
      const r = movable(data, e);
      const to = r && landing(e, at, hourGrid);
      if (r && to) moveEvent(r, e, to);
    },
    ghost: (e, at) => {
      const to = at && landing(e, at, hourGrid);
      return (
        <div className={css.dragEv} style={eventStyle(data, e)}>
          <b>{evLabel(e)}</b>
          {to && (
            <small>
              {e.allDay ? fmt.rel(to, clockNow()) + ' · all day' : fmt.rel(to, clockNow()) + ' ' + fmt.time(to)}
            </small>
          )}
        </div>
      );
    },
  });
  const value: EventDrag = {
    bind: (e) => (movable(data, e) ? dnd.bind(e) : {}),
    lifted: (e) => dnd.dragging?.id === e.id,
  };
  return (
    <Ctx.Provider value={value}>
      {children}
      {dnd.layer}
    </Ctx.Provider>
  );
}
