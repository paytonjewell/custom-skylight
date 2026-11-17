// What the Tasks screen shows, saved on this device: which people and sections, all tasks or only
// those to do or done, and the columns' order. A person's sheet on Today shares the same settings.
import { inSavedOrder, savedIds, type SavedIds } from '../../lib/saved';
import type { Data, Person, Slot } from '../../data/types';
import { SLOTS, type DueItem } from '../../data/tasks';
import { taskLanes, taskPeople } from '../../data/select';
import { createStore, store, stored, useStore } from '../../lib/store';

/** A column per person (FAMILY, worker/home.ts), then Anyone, then tasks-only profiles */
export const lanesOf = (d: Pick<Data, 'people'>): string[] => taskLanes(d.people);
type Section = Slot | 'habits';
export const SECTIONS: [Section, string][] = [['habits', 'Habits'], ...SLOTS];

export const peopleFilter = savedIds('tasks.people');
/** Which sections show (saved on this device): shared with a person's sheet on Today */
export const sectionFilter = savedIds('tasks.sections');
/** Which tasks show: everything (done ones last in each group), only what's left, or only what's done */
export type DoneView = 'all' | 'todo' | 'done';
export const DONE_VIEWS: [DoneView, string][] = [
  ['all', 'All'],
  ['todo', 'To do'],
  ['done', 'Done'],
];
const isDoneView = (v: string): v is DoneView => DONE_VIEWS.some(([k]) => k === v);
// Saved on this device (also for that sheet). Before this was three-way it was "hide done" on or off.
export const doneView = createStore<DoneView>(
  ((v) => (isDoneView(v) ? v : stored('tasks.hideDone', '0') === '1' ? 'todo' : 'all'))(stored('tasks.doneView', '')),
);
export const setDoneView = (v: DoneView) => {
  doneView.set(v);
  store('tasks.doneView', v);
};
export const showing = (ids: string[] | null, id: string) => !ids || ids.includes(id);

/** A saved list's toggle: all (or none) ticked means "all" */
export function toggleIn(f: SavedIds, cur: string[] | null, all: string[], id: string) {
  const on = cur ?? all;
  const next = on.includes(id) ? on.filter((x) => x !== id) : [...on, id];
  f.set(next.length === 0 || next.length === all.length ? null : all.filter((x) => next.includes(x)));
}

/** The columns' order, as dragged by their headings (saved on this device); null: the usual order */
export const laneOrder = savedIds('tasks.order');
/** Today's rings and the Tasks columns, in the order chosen on the Tasks screen */
export function useTaskLanes(d: Pick<Data, 'people'>): string[] {
  // Columns in the saved order; someone new keeps their usual place, at the end
  return inSavedOrder(
    lanesOf(d),
    useStore(laneOrder.store, (s) => s),
    (id) => id,
  );
}

/** The shown sections and which tasks show (see ShowSettings) */
export function useShowSettings(): { sections: string[] | null; show: DoneView; filtered: boolean } {
  const sections = useStore(sectionFilter.store, (s) => s);
  const show = useStore(doneView, (s) => s);
  return { sections, show, filtered: !!sections || show !== 'all' };
}

/**
 * Who a task can be for, as PersonPicker takes them: people on the calendar, then (after Anyone)
 * the tasks-only profiles
 */
export function taskPickerPeople(d: Pick<Data, 'people'>): { people: Person[]; after: Person[] } {
  const all = taskPeople(d.people);
  return { people: all.filter((p) => p.calendar !== false), after: all.filter((p) => p.calendar === false) };
}

/** A person's tasks for a day, split for showing: counts use them all, rows skip hidden done ones */
export function split(items: DueItem[], sections: string[] | null, show: DoneView) {
  const tasks = items.filter((x) => !x.task.habit && showing(sections, x.task.slot));
  const done = tasks.filter((x) => x.done).length;
  const visible = (x: DueItem) => (show === 'todo' ? !x.done : show === 'done' ? !!x.done : true);
  // Done ones at the bottom of their group (a stable sort keeps the rest in order)
  const doneLast = (list: DueItem[]) => list.slice().sort((a, b) => Number(!!a.done) - Number(!!b.done));
  return {
    tasks,
    done,
    all: tasks.length > 0 && done === tasks.length,
    shownTasks: doneLast(tasks.filter(visible)),
    shownHabits: showing(sections, 'habits') ? doneLast(items.filter((x) => x.task.habit && visible(x))) : [],
  };
}
