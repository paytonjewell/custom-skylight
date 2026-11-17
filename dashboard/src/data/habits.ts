// Habit history: streaks, completion rate and the heatmap's days, from a habit's repeat rule and
// when it was done. Pure functions.
//
// Streaks count due days only: a weekday habit isn't broken by the weekend, and today doesn't break
// a streak until it's over. Habits that repeat from when they were done ("3 days after it's done")
// keep their streak while each completion comes before the next one is due.
import { dayDiff, isDay, occursOn, shiftDay, type Repeat } from '../lib/repeat';
import type { Task, TaskDone } from './types';

/** How a day looks on the heatmap */
export type Cell = 'done' | 'missed' | 'due' | 'off';

export interface HabitStats {
  /** Due days in a row it was done (up to today) */
  current: number;
  /** The longest run in the history we have (about a year) */
  best: number;
  /** Share of due days done over the last 30 days (0–1), or null if none were due */
  rate: number | null;
  /** Day → how it looks, from `from` to today */
  cells: Map<string, Cell>;
}

/** Days between due dates for "after it's done" repeats (a month counts as 31) */
function interval(r: Extract<Repeat, { kind: 'afterDone' }>): number {
  return r.every * (r.unit === 'month' ? 31 : r.unit === 'week' ? 7 : 1) + (r.offset ?? 0);
}

export function habitStats(t: Task, rows: TaskDone[], today: string, from: string): HabitStats {
  const r = t.repeat;
  const done = new Set(rows.map((x) => x.day));
  const cells = new Map<string, Cell>();
  if (!r || !isDay(from)) return { current: 0, best: 0, rate: null, cells };
  const first = dayDiff(r.start, from) > 0 ? from : r.start;

  if (r.kind === 'afterDone') {
    for (let d = first; d <= today; d = shiftDay(d, 1)) cells.set(d, done.has(d) ? 'done' : 'off');
    const days = [...done].filter((d) => d <= today).sort();
    const gap = interval(r);
    let run = 0, best = 0;
    days.forEach((d, i) => {
      run = i > 0 && dayDiff(days[i - 1], d) <= gap ? run + 1 : 1;
      best = Math.max(best, run);
    });
    // Overdue now: the streak is over
    const last = days[days.length - 1];
    const current = last && dayDiff(last, today) <= gap ? run : 0;
    return { current, best, rate: null, cells };
  }

  let run = 0, best = 0, due30 = 0, done30 = 0;
  const since30 = shiftDay(today, -29);
  for (let d = first; d <= today; d = shiftDay(d, 1)) {
    const due = occursOn(r, d);
    const hit = done.has(d);
    cells.set(d, hit ? 'done' : !due ? 'off' : d === today ? 'due' : 'missed');
    if (!due) continue;
    if (hit) {
      run++;
      best = Math.max(best, run);
    } else if (d !== today) {
      run = 0; // missed; today only counts once it's done
    }
    if (d >= since30 && (hit || d !== today)) {
      due30++;
      if (hit) done30++;
    }
  }
  return { current: run, best, rate: due30 ? done30 / due30 : null, cells };
}
