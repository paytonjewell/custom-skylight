// The calendar on Today: this week (default), a day's schedule, or five weeks as a month, picked from
// a small menu (remembered on each device). The arrows, or a swipe, step through days, weeks or
// five-week blocks; a couple of minutes after someone leaves it elsewhere, it goes back to today.
// Tapping a day opens it on the Calendar screen; tapping an event opens the event.
import { useEffect, useRef, useState } from 'react';
import type { CalEvent } from '../data/types';
import { useData } from '../data/store';
import { useCalendarEvents } from '../data/hooks';
import { allDayOn, dayWeather, evLabel, timedOn } from '../data/select';
import { addDays, dayStart, sameDay } from '../lib/dates';
import { fmt } from '../lib/fmt';
import { store, stored } from '../lib/store';
import { useLayout } from '../app/layout';
import { go } from '../app/ui';
import { Icon } from '../ui/Icon';
import { Dots, eventStyle } from '../ui/people';
import { EmptyNote } from '../ui/EmptyNote';
import { Pager, type PagerHandle } from '../ui/Pager';
import { openEventSheet } from './calendar/EventSheet';
import { openCalendarAt } from './calendar/Calendar';
import { MonthGrid, weekStart } from './calendar/MonthGrid';
import css from './HomeCalendar.module.css';

type View = 'day' | 'week' | 'month';
const VIEWS: [View, string][] = [
  ['day', 'Day'],
  ['week', 'Week'],
  ['month', 'Month'],
];
const KEY = 'home.calendar';
/** Back to today this long after the last tap */
const IDLE_MS = 2 * 60 * 1000;
/** Events listed in a week's day before "+N more" */
const PER_DAY = 4;

/** A day's events: all-day first, then by time */
const dayEvents = (events: CalEvent[], d: Date) => [...allDayOn(events, d), ...timedOn(events, d)];

export function HomeCalendar({ now }: { now: Date }) {
  const [view, setView] = useState<View>(() => {
    const v = stored(KEY, 'week');
    return v === 'day' || v === 'month' ? v : 'week';
  });
  /** Steps away from today: days, weeks or five-week blocks */
  const [step, setStep] = useState(0);
  const [menu, setMenu] = useState(false);

  // Drift back to today a couple of minutes after the last step
  useEffect(() => {
    if (!step) return;
    const t = setTimeout(() => setStep(0), IDLE_MS);
    return () => clearTimeout(t);
  }, [step]);

  const today = dayStart(now);
  const choose = (v: View) => {
    setView(v);
    store(KEY, v);
    setStep(0);
    setMenu(false);
  };
  const nav = (dir: 1 | -1) => setStep((s) => s + dir);

  // Swipe left or right to step, like the arrows, with the next page sliding in
  const pager = useRef<PagerHandle>(null);
  const stepBy = (dir: 1 | -1) => pager.current?.go(dir);

  /** The first day of a page, `n` steps from today */
  const startOf = (n: number) =>
    view === 'day' ? addDays(today, n) : view === 'week' ? addDays(today, n * 7) : addDays(weekStart(today), n * 35);
  const date = startOf(step);
  const atToday = step === 0;

  let title: string;
  if (view === 'day')
    title = sameDay(date, today) ? 'Today' : fmt.day(date) + ', ' + fmt.monthShort(date) + ' ' + date.getDate();
  else if (view === 'week') title = step === 0 ? 'This week' : range(date, addDays(date, 6));
  else title = range(date, addDays(date, 34));

  return (
    <section className={css.card + ' card'}>
      <header className={css.head}>
        <button className={css.label + ' label'} onClick={() => go('calendar')}>
          <Icon name="calendar" size={18} /> Calendar
        </button>
        <b className={css.title}>{title}</b>
        <div className={css.menuWrap}>
          <button className={css.viewBtn} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            {VIEWS.find(([v]) => v === view)![1]} <Icon name={menu ? 'up' : 'down'} size={16} />
          </button>
          {menu && (
            <>
              <div className={css.scrim} onClick={() => setMenu(false)} />
              <div className={css.menu} role="menu">
                {VIEWS.map(([v, label]) => (
                  <button
                    key={v}
                    role="menuitemradio"
                    aria-checked={view === v}
                    className={css.item + (view === v ? ' ' + css.isOn : '')}
                    onClick={() => choose(v)}
                  >
                    {label}
                    <i />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <button className="icon-btn" aria-label="Back" onClick={() => stepBy(-1)}>
          <Icon name="left" size={22} />
        </button>
        <button
          className={css.today + (atToday ? ' ' + css.isAtToday : '')}
          disabled={atToday}
          onClick={() => setStep(0)}
        >
          Today
        </button>
        <button className="icon-btn" aria-label="Forward" onClick={() => stepBy(1)}>
          <Icon name="right" size={22} />
        </button>
      </header>
      <Pager
        className={css.body}
        index={step}
        onStep={nav}
        handle={pager}
        render={(off) => {
          const d = startOf(step + off);
          if (view === 'week') return <Week start={d} now={now} next={() => stepBy(1)} />;
          if (view === 'day') return <Schedule date={d} now={now} />;
          return <MonthGrid start={d} weeks={5} now={now} onDay={openCalendarAt} />;
        }}
      />
    </section>
  );
}

const range = (a: Date, b: Date) =>
  fmt.monthShort(a) +
  ' ' +
  a.getDate() +
  ' – ' +
  (a.getMonth() === b.getMonth() ? '' : fmt.monthShort(b) + ' ') +
  b.getDate();

// ------------------------------------------------------------ week: 7 days and "Next week"
function Week({ start, now, next }: { start: Date; now: Date; next: () => void }) {
  const data = useData();
  const events = useCalendarEvents();
  const phone = useLayout() === 'phone';
  const after = addDays(start, 7);
  const nextCount = [0, 1, 2, 3, 4, 5, 6].reduce((n, i) => n + dayEvents(events, addDays(after, i)).length, 0);
  return (
    <div className={css.week}>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => {
        const d = addDays(start, i);
        const list = dayEvents(events, d);
        const fits = phone || list.length <= PER_DAY ? list : list.slice(0, PER_DAY - 1);
        const wx = dayWeather(data.weather, d);
        const today = sameDay(d, now);
        return (
          // The whole day opens it on the Calendar screen; its events open themselves
          <div
            key={i}
            className={css.cell + (today ? ' ' + css.isToday : '')}
            role="button"
            tabIndex={0}
            aria-label={'Open ' + fmt.day(d)}
            onClick={() => openCalendarAt(d)}
          >
            <div className={css.dayHead}>
              <span className={css.dayName}>
                {fmt.dayShort(d)} <span className={css.dayNum + ' num'}>{d.getDate()}</span>
              </span>
              {wx && <Icon name={wx} size={22} />}
              <small>{list.length ? list.length + (list.length === 1 ? ' event' : ' events') : 'No events'}</small>
            </div>
            {fits.map((e) => (
              <button
                key={e.id}
                className={css.ev + (e.allDay ? ' ' + css.isAllDay : '') + (e.end <= now ? ' ' + css.isPast : '')}
                style={eventStyle(data, e)}
                onClick={(ev) => {
                  ev.stopPropagation();
                  openEventSheet(e);
                }}
              >
                <b>{evLabel(e)}</b>
                <small>{e.allDay ? 'All day' : fmt.range(e.start, e.end)}</small>
              </button>
            ))}
            {fits.length < list.length && <span className={css.more}>+{list.length - fits.length} more</span>}
          </div>
        );
      })}
      <button className={css.cell + ' ' + css.next} onClick={next}>
        <span className={css.dayName}>Next week</span>
        <small>{range(after, addDays(after, 6))}</small>
        <small>{nextCount ? nextCount + (nextCount === 1 ? ' event' : ' events') : 'Nothing yet'}</small>
      </button>
    </div>
  );
}

// ------------------------------------------------------------ day: a schedule
function Schedule({ date, now }: { date: Date; now: Date }) {
  const data = useData();
  const events = useCalendarEvents();
  const list = dayEvents(events, date);
  if (!list.length) {
    return (
      <div className={css.open} onClick={() => openCalendarAt(date)}>
        <EmptyNote className={css.empty}>
          <i>Nothing</i> on the calendar
        </EmptyNote>
      </div>
    );
  }
  return (
    <ul
      className={css.schedule}
      onClick={(e) => {
        if (e.target === e.currentTarget) openCalendarAt(date);
      }}
    >
      {list.map((e) => {
        const cur = !e.allDay && e.start <= now && e.end > now;
        return (
          <li key={e.id}>
            <button
              className={css.row + (e.end <= now && !e.allDay ? ' ' + css.isPast : '') + (cur ? ' ' + css.isNow : '')}
              style={eventStyle(data, e)}
              onClick={() => openEventSheet(e)}
            >
              <span className={css.when}>
                {e.allDay ? (
                  'All day'
                ) : (
                  <>
                    <b>{fmt.time(e.start)}</b>
                    <small>{fmt.time(e.end)}</small>
                  </>
                )}
              </span>
              <span className={css.bar} />
              <span className={css.what}>
                <b>{evLabel(e)}</b>
                {(cur || e.loc) && <small>{[cur ? 'Now' : '', e.loc ?? ''].filter(Boolean).join(' · ')}</small>}
              </span>
              {!e.color && e.people.length > 1 && <Dots ids={e.people} size={16} />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
