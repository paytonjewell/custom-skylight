// Calendar: Today-by-person lanes (default), 3-day, rolling week, month.
import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import type { CalEvent } from '../../data/types';
import { useData } from '../../data/store';
import { useCalendarEvents as useEvents } from '../../data/hooks';
import { allDayOn, calendarPeople, evLabel, isFamily, leaveBy, timedOn } from '../../data/select';
import { addDays, dayStart, DAY_MS, sameDay } from '../../lib/dates';
import { fmt } from '../../lib/fmt';
import { now as clockNow, useNow } from '../../lib/clock';
import { Icon } from '../../ui/Icon';
import { Dots, eventStyle, toneStyle } from '../../ui/people';
import { Segmented } from '../../ui/Segmented';
import { EmptyNote } from '../../ui/EmptyNote';
import { openEventSheet, openMoreSheet } from './EventSheet';
import { openAddEventSheet } from './AddEventSheet';
import { openCalendarSettings } from './CalendarSettings';
import { MonthGrid, weekStart } from './MonthGrid';
import { useLayout } from '../../app/layout';
import { Pager, type PagerHandle } from '../../ui/Pager';
import { go } from '../../app/ui';
import { createStore, useStore } from '../../lib/store';
import { EventDragProvider, dayKey, useEventDrag } from './eventDrag';
import css from './Calendar.module.css';

const PX = 72,
  START = 6,
  END = 23; // 72px per hour, 6 AM → 11 PM
const MODES = [
  ['day', 'Today'],
  ['3day', '3 Day'],
  ['week', 'Week'],
  ['month', 'Month'],
] as const;
type CalView = (typeof MODES)[number][0];
const STEP: Record<Exclude<CalView, 'month'>, number> = { day: 1, '3day': 3, week: 7 };

const y = (d: Date) => (d.getHours() + d.getMinutes() / 60 - START) * PX;

/** Top/height of an event block on `day`, clipped to the visible hours */
function blockBox(e: CalEvent, day: Date) {
  const s = dayStart(day);
  const a = e.start < s ? new Date(s.getTime() + START * 36e5) : e.start;
  const endOfDay = new Date(s.getTime() + END * 36e5);
  const b = e.end > endOfDay ? endOfDay : e.end;
  const top = Math.max(0, y(a));
  return { top, h: Math.max(24, y(b) - top - 3) };
}

type Placed =
  | { e: CalEvent; col: number; cols: number }
  | { more: CalEvent[]; col: number; cols: number; start: Date; end: Date };

/** Side-by-side layout for overlapping events: at most 2 columns, the rest collapse into "+N more". */
function layout(evs: CalEvent[]): Placed[] {
  const out: Placed[] = [],
    clusters: CalEvent[][] = [];
  let cur: CalEvent[] | null = null,
    curEnd = 0;
  for (const e of evs) {
    if (!cur || +e.start >= curEnd) {
      cur = [];
      clusters.push(cur);
      curEnd = 0;
    }
    cur.push(e);
    curEnd = Math.max(curEnd, +e.end);
  }
  for (const c of clusters) {
    const cols: number[] = [],
      placed: { e: CalEvent; col: number }[] = [];
    for (const e of c) {
      let i = cols.findIndex((end) => end <= +e.start);
      if (i < 0) {
        i = cols.length;
        cols.push(0);
      }
      cols[i] = +e.end;
      placed.push({ e, col: i });
    }
    if (cols.length <= 2) placed.forEach((p) => out.push({ e: p.e, col: p.col, cols: cols.length }));
    else {
      const extra = placed.filter((p) => p.col > 0).map((p) => p.e);
      placed.filter((p) => p.col === 0).forEach((p) => out.push({ e: p.e, col: 0, cols: 2 }));
      out.push({
        more: extra,
        col: 1,
        cols: 2,
        start: new Date(Math.min(...extra.map((e) => +e.start))),
        end: new Date(Math.max(...extra.map((e) => +e.end))),
      });
    }
  }
  return out;
}

/** A day another screen asked the Calendar to show (e.g. tapped on Today's calendar) */
const target = createStore<{ day: Date } | null>(null);
/** Open the Calendar on a day, in the day view */
export function openCalendarAt(day: Date): void {
  target.set({ day: dayStart(day) });
  go('calendar');
}

export function Calendar({ active }: { active: boolean }) {
  const now = useNow();
  const data = useData('googleAccounts', 'googleConfigured');
  const [mode, setMode] = useState<CalView>('day');
  const [date, setDate] = useState(() => dayStart(clockNow()));
  /** Counts jumps to another date (Today, a picked day), not steps */
  const [jumps, setJumps] = useState(0);

  // Asked to show a day (openCalendarAt)
  const asked = useStore(target, (t) => t);
  useLayoutEffect(() => {
    if (!asked) return;
    setMode('day');
    setDate(asked.day);
    setJumps((j) => j + 1);
  }, [asked]);

  const nav = (dir: 1 | -1) =>
    setDate((d) =>
      mode === 'month' ? new Date(d.getFullYear(), d.getMonth() + dir, 1) : addDays(d, dir * STEP[mode]),
    );
  const goToday = () => {
    const t = dayStart(clockNow());
    if (mode === 'month') t.setDate(1);
    setDate(t);
    setJumps((j) => j + 1);
  };
  // Switching views always starts from today (this month), not wherever the last view was
  const pickMode = (m: CalView) => {
    setMode(m);
    const t = dayStart(clockNow());
    if (m === 'month') t.setDate(1);
    setDate(t);
    setJumps((j) => j + 1);
  };
  const openDay = (d: Date) => {
    setMode('day');
    setDate(dayStart(d));
    setJumps((j) => j + 1);
  };
  const onAdded = (start: Date) => {
    setDate(dayStart(start));
    if (mode === 'month') setMode('day');
  };

  // Swipe left/right to change day, week or month, with the next one sliding in; the arrows slide too.
  // `pos` counts steps, so each page keeps its identity (and scroll) as it slides into the middle.
  const pager = useRef<PagerHandle>(null);
  const [pos, setPos] = useState(0);
  const stepBy = (dir: 1 | -1) => pager.current?.go(dir);
  const shifted = (n: number) =>
    n === 0
      ? date
      : mode === 'month'
        ? new Date(date.getFullYear(), date.getMonth() + n, 1)
        : addDays(date, n * STEP[mode]);

  const isToday = mode === 'month' ? date.getMonth() === now.getMonth() : sameDay(date, now);
  // Jumps (not steps) scroll the day grid back to now; a page that slid in keeps its scroll
  const resetKey = mode + ':' + jumps;

  return (
    <div className={css.cal + (mode === 'day' ? ' ' + css.calDay : '')}>
      <header className={css.head}>
        <button className="icon-btn" aria-label="Previous" onClick={() => stepBy(-1)}>
          <Icon name="left" size={24} />
        </button>
        <Title mode={mode} date={date} now={now} />
        <button className="icon-btn" aria-label="Next" onClick={() => stepBy(1)}>
          <Icon name="right" size={24} />
        </button>
        <button className={'btn btn--ghost ' + css.today + (isToday ? ' is-hidden' : '')} onClick={goToday}>
          Today
        </button>
        <Segmented options={MODES} value={mode} onChange={pickMode} />
        <button className={'icon-btn ' + css.cog} aria-label="Calendar settings" onClick={openCalendarSettings}>
          <Icon name="settings" size={26} />
        </button>
        <button
          className={css.fab}
          aria-label="Add event"
          onClick={() => openAddEventSheet(onAdded, mode === 'month' ? undefined : date)}
        >
          <Icon name="plus" size={26} />
        </button>
      </header>
      {data.googleConfigured && !data.googleAccounts.length && (
        <button className={css.sample} onClick={openCalendarSettings}>
          <Icon name="calendar" size={20} />
          <span>
            These are sample events. <b>Connect Google Calendar</b> to see yours.
          </span>
        </button>
      )}
      {/* Hold an event, then drag it to another time or day (eventDrag.tsx) */}
      <EventDragProvider hourGrid={{ px: PX, start: START }}>
        <Pager
          className={css.body}
          index={pos}
          onStep={(dir) => {
            nav(dir);
            setPos((p) => p + dir);
          }}
          handle={pager}
          render={(off) => {
            const d = shifted(off);
            if (mode === 'day') return <DayView date={d} now={now} active={active} resetKey={resetKey} />;
            if (mode === '3day') return <ThreeDay date={d} now={now} active={active} resetKey={resetKey} />;
            if (mode === 'week') return <WeekView date={d} now={now} openDay={openDay} />;
            return <MonthView date={d} now={now} openDay={openDay} />;
          }}
        />
      </EventDragProvider>
    </div>
  );
}

function Title({ mode, date: d, now }: { mode: CalView; date: Date; now: Date }) {
  let t, k;
  if (mode === 'day') {
    k = fmt.month(d) + ' ' + d.getFullYear() + ' · ' + (sameDay(d, now) ? 'Today' : fmt.rel(d, now));
    t = (
      <>
        {fmt.day(d)} <i>{d.getDate()}</i>
      </>
    );
  } else if (mode === '3day') {
    const e = addDays(d, 2);
    k = fmt.month(d) + ' ' + d.getFullYear();
    t = (
      <>
        {fmt.dayShort(d)} {d.getDate()} <i>–</i> {fmt.dayShort(e)} {e.getDate()}
      </>
    );
  } else if (mode === 'week') {
    const w = addDays(d, 6);
    k = 'Next 7 days';
    t = (
      <>
        {fmt.monthShort(d)} {d.getDate()} <i>–</i> {fmt.monthShort(w)} {w.getDate()}
      </>
    );
  } else {
    k = String(d.getFullYear());
    t = fmt.month(d);
  }
  return (
    <div className={css.title}>
      <div className="serif">{t}</div>
      <div className="label">{k}</div>
    </div>
  );
}

// ------------------------------------------------------------ time grid pieces
function EvBlock({
  e,
  style,
  lane,
  half,
  day,
  now,
}: {
  e: CalEvent;
  style: CSSProperties;
  lane?: string;
  half?: boolean;
  day: Date;
  now: Date;
}) {
  const data = useData('ALL', 'family', 'people');
  const fam = isFamily(data, e);
  const mins = (+e.end - +e.start) / 60000;
  const others = lane ? e.people.filter((id) => id !== lane) : e.people.length > 1 && !fam ? e.people : [];
  const cls =
    css.ev +
    (e.end <= now ? ' ' + css.isPast : '') +
    (e.start <= now && e.end > now ? ' ' + css.isNow : '') +
    (mins < 45 ? ' ' + css.isShort : '') +
    (fam ? ' ' + css.isFamily : '') +
    (half ? ' ' + css.isHalf : '');
  const box = blockBox(e, day);
  const drag = useEventDrag();
  const b = drag.bind(e);
  return (
    <button
      {...b}
      className={cls + (drag.lifted(e) ? ' ' + css.isLifted : '')}
      style={eventStyle(data, e, { top: box.top, height: box.h, ...style, ...b.style })}
      onClick={() => openEventSheet(e)}
    >
      {e.travel ? <span className={css.travel} style={{ height: (e.travel * PX) / 60 }} /> : null}
      <span className={css.evTitle}>{evLabel(e)}</span>
      <span className={css.evMeta}>
        {fmt.range(e.start, e.end)}
        {e.travel ? (
          <>
            {' · '}
            <b>
              <Icon name="car" size={16} />
              Leave {fmt.time(leaveBy(e), false)}
            </b>
          </>
        ) : null}
      </span>
      {e.color ? null : fam ? (
        <span className={css.evWith}>
          <Dots ids={data.ALL} size={14} />
        </span>
      ) : others.length ? (
        <span className={css.evWith}>
          <Dots ids={others} size={14} />
        </span>
      ) : null}
    </button>
  );
}

/** Timed events for one column, laid out side by side where they overlap */
function Blocks({ list, day, now, lane }: { list: CalEvent[]; day: Date; now: Date; lane?: string }) {
  return (
    <>
      {layout(list).map((it) => {
        const w = 100 / it.cols,
          horiz = { left: `calc(${it.col * w}% + 2px)`, width: `calc(${w}% - 4px)` };
        if ('more' in it) {
          const top = y(it.start);
          return (
            <button
              key={'more' + it.more[0].id}
              className={css.ev + ' ' + css.evMore}
              style={{ top, height: Math.max(30, y(it.end) - top - 3), ...horiz }}
              onClick={() => openMoreSheet(it.more)}
            >
              +{it.more.length}
              <small>more</small>
            </button>
          );
        }
        return <EvBlock key={it.e.id} e={it.e} style={horiz} lane={lane} half={it.cols > 1} day={day} now={now} />;
      })}
    </>
  );
}

function Hours() {
  const rows = [];
  for (let i = START; i <= END; i++) {
    rows.push(
      <div key={i} className={css.hr} style={{ top: (i - START) * PX }}>
        <span>{i === 12 ? 'Noon' : (i % 12 || 12) + (i < 12 ? ' AM' : ' PM')}</span>
      </div>,
    );
  }
  return <div className={css.hours}>{rows}</div>;
}

function NowLine({ days, now, indexed }: { days: Date[]; now: Date; indexed?: boolean }) {
  const idx = days.findIndex((d) => sameDay(d, now));
  if (idx < 0 || now.getHours() < START || now.getHours() >= END) return null;
  return (
    <div className={css.nowLine + (indexed ? ' ' + css['nowLine' + idx] : '')} style={{ top: y(now) }}>
      <span className="num">{fmt.time(now, false)}</span>
    </div>
  );
}

/** Scrollable hour grid; scrolls to just above "now" when the day/mode changes or the screen opens */
function GridScroll({ resetKey, active, children }: { resetKey: string; active: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (active && ref.current) ref.current.scrollTop = Math.max(0, y(clockNow()) - 170);
  }, [resetKey, active]);
  return (
    <div className={css.gridScroll} ref={ref}>
      <div className={css.grid} style={{ height: (END - START) * PX }}>
        <Hours />
        {children}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ Today (lanes per person; one timeline on a phone)
function DayView({ date, now, active, resetKey }: { date: Date; now: Date; active: boolean; resetKey: string }) {
  const data = useData('ALL', 'family', 'people');
  const events = useEvents();
  // A phone is too narrow for a lane per person: everyone shares one timeline, in their colours
  const single = useLayout() === 'phone';
  const timed = timedOn(events, date);
  const allDay = allDayOn(events, date);
  const s = dayStart(date);
  const lanes = calendarPeople(data.people);
  const ids = lanes.map((p) => p.id);
  const cols = single ? 1 : lanes.length;
  const drag = useEventDrag();
  const t = 't:' + dayKey(date);
  return (
    <div className={css.day}>
      {allDay.length > 0 && (
        <div className={css.allday}>
          <div className={css.gutter + ' label'}>All day</div>
          <div
            className={css.alldayGrid}
            style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
            data-drop={'d:' + dayKey(date)}
          >
            {allDay.map((e) => {
              const col = single || isFamily(data, e) ? '1 / -1' : ids.indexOf(e.people[0]) + 1 + ' / span 1';
              const spanDays = Math.round((+e.end - +e.start) / DAY_MS),
                dayN = Math.round((+s - +e.start) / DAY_MS) + 1;
              return (
                <button
                  key={e.id}
                  {...drag.bind(e)}
                  className={
                    css.ad + (e.start < s ? ' ' + css.adCont : '') + (drag.lifted(e) ? ' ' + css.isLifted : '')
                  }
                  style={eventStyle(data, e, { gridColumn: col, ...drag.bind(e).style })}
                  onClick={() => openEventSheet(e)}
                >
                  {e.start < s && <Icon name="left" size={16} />}
                  {evLabel(e)}
                  {spanDays > 1 && (
                    <small>
                      Day {dayN} of {spanDays}
                    </small>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <GridScroll resetKey={resetKey} active={active}>
        {single ? (
          <div className={css.lanes} style={{ gridTemplateColumns: '1fr' }}>
            <div className={css.lane} data-drop={t}>
              <Blocks list={timed} day={date} now={now} />
            </div>
          </div>
        ) : (
          <div className={css.lanes} style={{ gridTemplateColumns: `repeat(${lanes.length}, 1fr)` }}>
            {lanes.map((p) => (
              <div key={p.id} className={css.lane} style={toneStyle(p)} data-drop={t}>
                <Blocks
                  list={timedOn(events, date, p.id).filter((e) => !isFamily(data, e))}
                  day={date}
                  now={now}
                  lane={p.id}
                />
              </div>
            ))}
            <div className={css.laneFam}>
              {timed
                .filter((e) => isFamily(data, e))
                .map((e) => (
                  <EvBlock key={e.id} e={e} style={{ left: 2, right: 2 }} day={date} now={now} />
                ))}
            </div>
          </div>
        )}
        {/* Outside .lanes (which is already offset by the hour gutter), as in the 3-day view */}
        <NowLine days={[date]} now={now} />
      </GridScroll>
      {!timed.length && (
        <EmptyNote large className={css.empty}>
          Nothing on the calendar.
          <br />
          <i>A rare, quiet day.</i>
        </EmptyNote>
      )}
    </div>
  );
}

// ------------------------------------------------------------ 3 day
function ThreeDay({ date, now, active, resetKey }: { date: Date; now: Date; active: boolean; resetKey: string }) {
  const data = useData('ALL', 'family', 'people');
  const events = useEvents();
  const days = [0, 1, 2].map((i) => addDays(date, i));
  const s0 = dayStart(date),
    s3 = addDays(s0, 3);
  const allDay = days.some((d) => allDayOn(events, d).length)
    ? events.filter((e) => e.allDay && e.start < s3 && e.end > s0)
    : [];
  const drag = useEventDrag();
  return (
    <div className={css.day + ' ' + css.three}>
      <div className={css.lanesHead}>
        <div className={css.gutter} />
        {days.map((d) => (
          <div key={+d} className={css.dayHead + (sameDay(d, now) ? ' ' + css.isToday : '')}>
            <span className="num display-num">{d.getDate()}</span>
            <b>{fmt.rel(d, now)}</b>
            <small className="label label--sm">{fmt.monthShort(d)}</small>
          </div>
        ))}
      </div>
      {allDay.length > 0 && (
        <div className={css.allday}>
          <div className={css.gutter + ' label'}>All day</div>
          <div className={css.alldayGrid + ' ' + css.alldayGrid3} data-drop={'a3:' + dayKey(s0)}>
            {allDay.map((e) => {
              const a = Math.max(0, Math.round((+e.start - +s0) / DAY_MS)),
                b = Math.min(3, Math.round((+e.end - +s0) / DAY_MS));
              return (
                <button
                  key={e.id}
                  {...drag.bind(e)}
                  className={
                    css.ad + (e.start < s0 ? ' ' + css.adCont : '') + (drag.lifted(e) ? ' ' + css.isLifted : '')
                  }
                  style={eventStyle(data, e, { gridColumn: `${a + 1} / ${b + 1}`, ...drag.bind(e).style })}
                  onClick={() => openEventSheet(e)}
                >
                  {e.start < s0 && <Icon name="left" size={16} />}
                  {evLabel(e)}
                  {e.end > s3 && <Icon name="right" size={16} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <GridScroll resetKey={resetKey} active={active}>
        <div className={css.lanes + ' ' + css.lanes3}>
          {days.map((d) => (
            <div
              key={+d}
              className={css.lane + (sameDay(d, now) ? ' ' + css.isToday : '')}
              data-drop={'t:' + dayKey(d)}
            >
              <Blocks list={timedOn(events, d)} day={d} now={now} />
            </div>
          ))}
        </div>
        <NowLine days={days} now={now} indexed />
      </GridScroll>
    </div>
  );
}

// ------------------------------------------------------------ rolling week
function WeekView({ date, now, openDay }: { date: Date; now: Date; openDay: (d: Date) => void }) {
  const data = useData('ALL', 'family', 'people');
  const events = useEvents();
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  // On a phone the week is a scrolling agenda, so every event fits; the frame's columns stop at 7
  const agenda = useLayout() === 'phone';
  const drag = useEventDrag();
  return (
    <div className={css.week}>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => {
        const d = addDays(date, i);
        const ad = allDayOn(events, d),
          list = timedOn(events, d),
          max = agenda ? Infinity : 7 - ad.length,
          more = list.length - max;
        return (
          <div
            key={i}
            className={css.wkCol + (sameDay(d, now) ? ' ' + css.isToday : '')}
            onClick={() => openDay(d)}
            data-drop={'d:' + dayKey(d)}
          >
            <div className={css.wkHead}>
              <b>{fmt.dayShort(d)}</b>
              <span className="num display-num">{d.getDate()}</span>
            </div>
            {ad.map((e) => (
              <button
                key={e.id}
                {...drag.bind(e)}
                className={css.wkAd + (drag.lifted(e) ? ' ' + css.isLifted : '')}
                style={eventStyle(data, e, drag.bind(e).style)}
                onClick={stop(() => openEventSheet(e))}
              >
                {evLabel(e)}
              </button>
            ))}
            {list.slice(0, max).map((e) => (
              <button
                key={e.id}
                {...drag.bind(e)}
                className={
                  css.wkEv + (e.end <= now ? ' ' + css.isPast : '') + (drag.lifted(e) ? ' ' + css.isLifted : '')
                }
                style={eventStyle(data, e, drag.bind(e).style)}
                onClick={stop(() => openEventSheet(e))}
              >
                <span className={css.wkT}>{fmt.time(e.start, false)}</span>
                <span className={css.wkN}>{evLabel(e)}</span>
              </button>
            ))}
            {more > 0 && <button className={css.wkMore}>+{more} more</button>}
            {!list.length && !ad.length && (
              <EmptyNote className={css.wkFree}>
                <i>Free</i>
              </EmptyNote>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------ month: weeks with event chips (MonthGrid)
function MonthView({ date, now, openDay }: { date: Date; now: Date; openDay: (d: Date) => void }) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = weekStart(first);
  const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((first.getDay() + days) / 7);
  return (
    <div className={css.month}>
      <MonthGrid start={start} weeks={weeks} now={now} month={first.getMonth()} onDay={openDay} />
    </div>
  );
}
