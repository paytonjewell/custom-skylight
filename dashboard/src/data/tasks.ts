// What's due: which tasks show on the Tasks screen for a day, from the tasks, their repeat rules
// (src/lib/repeat.ts) and when they were done. Pure functions.
import { carriesOver, dayOf, dueAfter, nextOccurrence, occursOn, prevOccurrence, shiftDay } from '../lib/repeat';
import type { Slot, Task, TaskDone } from './types';

/** A task as it shows on a day: the due day it's for, and whether that's been done */
export interface DueItem {
  task: Task;
  /** The due day this counts for ('YYYY-MM-DD'); checking it off records this day */
  day: string;
  done: TaskDone | null;
  /** A missed due day still waiting (weekly-or-rarer repeats, dated one-offs) */
  overdue: boolean;
}

/** Parts of the day, in the order they show (Anytime first) */
export const SLOTS: [Slot, string][] = [
  ['anytime', 'Anytime'],
  ['morning', 'Morning'],
  ['afternoon', 'Afternoon'],
  ['evening', 'Evening'],
];

/** Completions by task id */
export function doneByTask(done: TaskDone[]): Map<string, TaskDone[]> {
  const m = new Map<string, TaskDone[]>();
  for (const d of done) m.set(d.task, [...(m.get(d.task) ?? []), d]);
  return m;
}

/** The latest due day it was done for */
const lastDay = (rows: TaskDone[]) =>
  rows.reduce<string | undefined>((a, r) => (!a || r.day > a ? r.day : a), undefined);
/** The day a completion was checked off (local time) */
const checkedOn = (r: TaskDone) => dayOf(new Date(r.at));

/**
 * One task on `day` (seen from `today`), or null if it doesn't show. Past days show what was due
 * and what was done; future days show what's coming. Overdue carry-overs only show on today.
 */
export function dueItem(t: Task, rows: TaskDone[], day: string, today: string): DueItem | null {
  const r = t.repeat;
  // A repeating task due this very day is that day's: done only if this day was checked off. (A
  // check-off made this day for another day, like catching up on yesterday, mustn't stand in for it.)
  if (r && r.kind !== 'afterDone' && occursOn(r, day)) {
    return { task: t, day, done: rows.find((x) => x.day === day) ?? null, overdue: false };
  }

  // Checked off on this day: shows (ticked) that day, whatever due day it was for
  const doneThatDay = rows.find((x) => checkedOn(x) === day);
  if (doneThatDay) return { task: t, day: doneThatDay.day, done: doneThatDay, overdue: false };

  if (!r) {
    if (rows.length) return null; // done on another day
    if (t.due === day) return { task: t, day, done: null, overdue: false };
    // Undated, or late: waits on today's list
    if (day === today && (!t.due || t.due < today))
      return { task: t, day: t.due ?? today, done: null, overdue: !!t.due };
    return null;
  }
  if (r.kind === 'afterDone') {
    const due = dueAfter(r, lastDay(rows));
    if (day === today && due <= today) return { task: t, day: today, done: null, overdue: due < today };
    return day > today && due === day ? { task: t, day, done: null, overdue: false } : null;
  }
  if (day !== today || !carriesOver(r)) return null;
  // The last due day before today, if it was missed
  const prev = prevOccurrence(r, shiftDay(today, -1));
  if (!prev || rows.some((x) => x.day === prev)) return null;
  return { task: t, day: prev, done: null, overdue: true };
}

/**
 * Everything showing on `day`, in order: ones given a place (dragged) first, by that place; then
 * overdue, then by time, then oldest first
 */
export function dueOn(
  tasks: Task[],
  /** The history, or doneByTask of it (when calling for many days, build it once) */
  done: TaskDone[] | Map<string, TaskDone[]>,
  day: string,
  today: string,
): DueItem[] {
  const by = done instanceof Map ? done : doneByTask(done);
  return tasks
    .map((t) => dueItem(t, by.get(t.id) ?? [], day, today))
    .filter((x): x is DueItem => !!x)
    .sort(
      (a, b) =>
        (a.task.position ?? Infinity) - (b.task.position ?? Infinity) ||
        Number(b.overdue) - Number(a.overdue) ||
        (a.task.time ?? '99').localeCompare(b.task.time ?? '99') ||
        a.task.created.localeCompare(b.task.created),
    );
}

/** Today's list */
export const dueToday = (tasks: Task[], done: TaskDone[], today: string) => dueOn(tasks, done, today, today);

/** A done item that was checked off after the day it was due ("done late") */
export const doneLate = (x: DueItem): boolean => !!x.done && checkedOn(x.done) > x.day;

/** When a task is next due, for the All tasks list */
export interface NextDue {
  /** null: no date ("whenever"), or a one-off that's done */
  day: string | null;
  overdue: boolean;
  /** A one-off that's been done */
  done: boolean;
}
export function nextDue(t: Task, rows: TaskDone[], today: string): NextDue {
  if (!t.repeat) {
    if (rows.length) return { day: null, overdue: false, done: true };
    return { day: t.due, overdue: !!t.due && t.due < today, done: false };
  }
  // Due (or overdue) today and not done yet
  const now = dueItem(t, rows, today, today);
  if (now && !now.done) return { day: now.day, overdue: now.overdue, done: false };
  return { day: nextOccurrence(t.repeat, shiftDay(today, 1), lastDay(rows)), overdue: false, done: false };
}
