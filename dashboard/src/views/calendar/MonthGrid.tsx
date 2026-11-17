// Weeks of days with their events as chips, for the Calendar's month view and the month view on Today.
// Each week is a row: the date and the day's weather on top, then events in lanes. An all-day event
// that runs over several days is one bar across them. Lanes are fitted to the row's height; when a
// day has more than fit, its last lane says "+N more". Phones get slim bars with just the name in small text.
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { CalEvent } from '../../data/types';
import { useData } from '../../data/store';
import { useCalendarEvents } from '../../data/hooks';
import { dayWeather, evColor, evLabel } from '../../data/select';
import { addDays, dayStart, DAY_MS, sameDay } from '../../lib/dates';
import { fmt } from '../../lib/fmt';
import { useLayout } from '../../app/layout';
import { Icon } from '../../ui/Icon';
import { toneStyle } from '../../ui/people';
import { openEventSheet } from './EventSheet';
import css from './MonthGrid.module.css';

/** Row heights (px): the date line, and one lane of chips (frame / phone) */
const HEAD = 30;
const LANE = { frame: 23, phone: 16 };

/** Sunday on or before a day */
export const weekStart = (d: Date) => addDays(dayStart(d), -dayStart(d).getDay());

interface Placed { e: CalEvent; a: number; b: number; lane: number }

/** A week's events placed in lanes: longer all-day spans first, then all-day, then by time */
export function placeWeek(events: CalEvent[], start: Date): Placed[] {
  const end = addDays(start, 7);
  const col = (t: Date) => Math.round((+dayStart(t) - +start) / DAY_MS);
  const items = events
    .filter((e) => (e.allDay ? e.start < end && e.end > start : e.start >= start && e.start < end))
    .map((e) => {
      // All-day events end at midnight after their last day; timed ones sit on the day they start
      const a = Math.max(0, col(e.start));
      const b = e.allDay ? Math.min(7, Math.max(a + 1, col(e.end))) : a + 1;
      return { e, a, b };
    })
    .sort((x, y) => y.b - y.a - (x.b - x.a) || Number(!!y.e.allDay) - Number(!!x.e.allDay) || +x.e.start - +y.e.start);
  const used: boolean[][] = [];
  return items.map((it) => {
    let lane = 0;
    for (; ; lane++) {
      const row = (used[lane] ??= []);
      let free = true;
      for (let c = it.a; c < it.b; c++) if (row[c]) free = false;
      if (free) {
        for (let c = it.a; c < it.b; c++) row[c] = true;
        break;
      }
    }
    return { ...it, lane };
  });
}

export function MonthGrid({ start, weeks, now, month, onDay }: {
  /** The first Sunday shown */
  start: Date;
  weeks: number;
  now: Date;
  /** Days outside this month (0–11) are dimmed */
  month?: number;
  onDay: (d: Date) => void;
}) {
  const data = useData();
  const events = useCalendarEvents();
  const phone = useLayout() === 'phone';
  const lane = phone ? LANE.phone : LANE.frame;
  // How many lanes fit in a week's row
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(3);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const row = el.firstElementChild as HTMLElement | null;
      if (row) setFit(Math.max(1, Math.floor((row.clientHeight - HEAD - 2) / lane)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [lane, weeks]);

  return (
    <div className={css.grid + (phone ? ' ' + css.isPhone : '')}>
      <div className={css.dow}>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <span key={i} className="label">{fmt.dayShort(addDays(start, i))}</span>
        ))}
      </div>
      <div className={css.weeks} ref={ref} style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}>
        {Array.from({ length: weeks }, (_, w) => {
          const s = addDays(start, w * 7);
          const placed = placeWeek(events, s);
          const need = placed.reduce((m, p) => Math.max(m, p.lane + 1), 0);
          // Too many: the last lane that fits says "+N more" for each day that has hidden events
          const shown = need > fit ? fit - 1 : need;
          const hidden = [0, 1, 2, 3, 4, 5, 6].map((c) => placed.filter((p) => p.lane >= shown && p.a <= c && c < p.b).length);
          return (
            <div key={w} className={css.week}>
              {/* The days, filling the row (tap one to open it), with the date and weather on top */}
              <div className={css.days}>
                {[0, 1, 2, 3, 4, 5, 6].map((c) => {
                  const d = addDays(s, c);
                  const wx = dayWeather(data.weather, d);
                  const out = month !== undefined && d.getMonth() !== month;
                  const past = d < dayStart(now);
                  return (
                    <button
                      key={c}
                      className={css.day + (out ? ' ' + css.isOut : '') + (past ? ' ' + css.isPast : '')}
                      aria-label={fmt.day(d) + ' ' + fmt.month(d) + ' ' + d.getDate()}
                      onClick={() => onDay(d)}
                    >
                      <span className={css.head}>
                        {wx && !past && !phone ? <Icon name={wx} size={18} /> : <i />}
                        <span className={css.num + (sameDay(d, now) ? ' ' + css.isToday : '') + ' num'}>
                          {d.getDate() === 1 && !phone ? fmt.monthShort(d) + ' 1' : d.getDate()}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {/* Events in lanes over the days, below the date line */}
              <div className={css.lanes} style={{ gridTemplateRows: `${HEAD}px repeat(${Math.max(1, need > fit ? fit : need)}, ${lane}px)` } as CSSProperties}>
              {placed.filter((p) => p.lane < shown).map((p) => (
                <button
                  key={p.e.id}
                  className={css.chip + (p.e.allDay ? ' ' + css.isAllDay : '') + (p.e.end <= now ? ' ' + css.isPast : '')}
                  style={toneStyle(evColor(data, p.e), { gridColumn: `${p.a + 1} / ${p.b + 1}`, gridRow: p.lane + 2 })}
                  onClick={() => openEventSheet(p.e)}
                >
                  {!phone && !p.e.allDay && <small>{fmt.time(p.e.start).replace(':00', '')}</small>}
                  {/* Phones: the name only, small */}
                  <span>{phone ? p.e.title : evLabel(p.e)}</span>
                </button>
              ))}
              {need > fit &&
                hidden.map((n, c) =>
                  n ? (
                    <button key={'more' + c} className={css.more} style={{ gridColumn: c + 1, gridRow: shown + 2 }} onClick={() => onDay(addDays(s, c))}>
                      +{n}{phone ? '' : ' more'}
                    </button>
                  ) : null,
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
