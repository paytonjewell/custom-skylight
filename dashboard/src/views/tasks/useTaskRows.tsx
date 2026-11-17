// What every task and habit row does, on the Tasks screen and on a person's sheet from Today: tap to
// check off (Undo in the toast), swipe right to edit, left to delete or move to tomorrow, and hold to
// drag it into order, into another part of the day, or onto someone else's column.
import { useEffect, useState, type ReactNode } from 'react';
import type { Task, TaskDone } from '../../data/types';
import { dataStore, useData } from '../../data/store';
import { deleteTask, editTask, moveTaskTo, restoreTask, setTaskDone } from '../../data/actions';
import { useDragDrop, type DragProps } from '../../ui/useDragDrop';
import { SLOTS, doneByTask, dueOn, type DueItem } from '../../data/tasks';
import { habitStats } from '../../data/habits';
import { person, laneName } from '../../data/select';
import { shiftDay } from '../../lib/repeat';
import { fmtDate } from '../../lib/days';
import { createStore, useStore } from '../../lib/store';
import { toast } from '../../app/ui';
import { toneStyle } from '../../ui/people';
import { usePendingAction } from '../../ui/hooks';
import { celebrate } from '../../ui/confetti';
import type { SwipeSide } from '../../ui/useSwipeReveal';
import { openTaskSheet } from './TaskSheet';
import { lanesOf, split, useShowSettings } from './settings';
import css from './Tasks.module.css';

const CHECK_MS = 350; // let the check animation play before the row changes

export interface RowProps {
  open: SwipeSide | null;
  onOpenChange: (side: SwipeSide | null) => void;
  onTap: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** Move it to tomorrow (one-offs that aren't done) */
  onLater?: () => void;
  checking: boolean;
  /** Habits: due days in a row done */
  streak: number;
  /** In the columns: hold to pick up and move to another column */
  drag?: DragProps;
  /** It's the one being dragged */
  lifted?: boolean;
  /** Its drop target value (who|group|id): another can be dropped above or below it */
  drop?: string;
}

/** A task is being dragged (anywhere): lists show every part of the day, so there's somewhere to drop it */
const draggingTask = createStore(false);
export const useTaskDragging = () => useStore(draggingTask, (v) => v);

/** The last streaks worked out, and what from */
let streakCache: { tasks: Task[]; done: TaskDone[]; today: string; streaks: Map<string, number> } | null = null;
/**
 * Each habit's current streak (shown on its row). Every habit counts back up to 400 days, and the
 * Tasks screen and each person sheet use the same answer, so it's kept until the tasks, what's
 * done or the day changes (the store hands out the same arrays until then).
 */
function habitStreaks(tasks: Task[], done: TaskDone[], today: string): Map<string, number> {
  const c = streakCache;
  if (c && c.tasks === tasks && c.done === done && c.today === today) return c.streaks;
  const streaks = new Map<string, number>();
  const doneBy = doneByTask(done);
  for (const t of tasks)
    if (t.habit) streaks.set(t.id, habitStats(t, doneBy.get(t.id) ?? [], today, shiftDay(today, -400)).current);
  streakCache = { tasks, done, today, streaks };
  return streaks;
}

/**
 * Rows' actions, for the Tasks screen and a person's sheet on Today: tap to check off (habits too),
 * swipe right to edit, left to delete. `back` reopens the sheet once the task editor closes.
 */
export function useTaskRows(
  day: string,
  today: string,
  back?: () => void,
): { rowProps: (x: DueItem) => RowProps; layer: ReactNode } {
  const data = useData('family', 'people', 'taskDone', 'tasks');
  const { sections, show } = useShowSettings();
  const pending = usePendingAction(CHECK_MS);
  /** The row swiped open (one at a time) */
  const [swiped, setSwiped] = useState<{ id: string; side: SwipeSide } | null>(null);
  const future = day > today;
  const streaks = habitStreaks(data.tasks, data.taskDone, today);

  const tap = (x: DueItem) => {
    const id = x.task.id + x.day;
    if (pending.isPending(id)) return;
    if (future) return toast('That isn’t due yet', { icon: 'clock' });
    if (x.done) return setTaskDone(x.task.id, x.day, false);
    pending.start(id, () => {
      setTaskDone(x.task.id, x.day, true, x.task.who === 'any' ? null : x.task.who);
      if (x.task.habit) return;
      toast(
        <>
          <b>{x.task.title}</b> done
        </>,
        { icon: 'check', undo: () => setTaskDone(x.task.id, x.day, false) },
      );
      if (day === today) cheerIfFinished(x.task.who, today);
    });
  };
  const remove = (x: DueItem) => {
    const gone = deleteTask(x.task.id);
    if (gone)
      toast(
        <>
          Deleted <b>{x.task.title}</b>
        </>,
        { icon: 'trash', undo: () => restoreTask(gone.task, gone.done) },
      );
  };
  /** A one-off that isn't done: due the day after the one showing (an overdue one: tomorrow) */
  const later = (x: DueItem) => {
    const was = x.task.due;
    const to = shiftDay(day < today ? today : day, 1);
    editTask(x.task.id, { due: to });
    toast(
      <>
        <b>{x.task.title}</b> moved to {to === shiftDay(today, 1) ? 'tomorrow' : fmtDate(to)}
      </>,
      { icon: 'later', undo: () => editTask(x.task.id, { due: was }) },
    );
  };

  // Hold a task, then drag it: within its group to put it in order, into another part of the day,
  // or onto someone else's column (or a group or row in it) to give it to them
  const dnd = useDragDrop<DueItem>({
    onDrop: (x, target, at) => moveTask(x, target, at.side),
    ghost: (x) => (
      <div className={css.ghost} style={toneStyle(person(data, x.task.who))}>
        {x.task.emoji && <span className={css.ghostMark}>{x.task.emoji}</span>}
        <b>{x.task.title}</b>
      </div>
    ),
  });
  /**
   * A drop: `target` is "who" (a column), "who|slot" (a group in it; 'habits' for habits) or
   * "who|slot|taskId" (a row, with the dragged one going before or after it)
   */
  const moveTask = (x: DueItem, target: string, side: 'before' | 'after') => {
    const t = x.task;
    const [who, group, rowId] = target.split('|');
    // What's showing in that group now: the task takes its place among them (they keep their order)
    const there = group
      ? split(
          dueOn(data.tasks, data.taskDone, day, today).filter((y) => y.task.who === who),
          sections,
          show,
        )
      : null;
    const shown = !there
      ? []
      : group === 'habits'
        ? there.shownHabits
        : there.shownTasks.filter((y) => y.task.slot === group);
    const moved = moveTaskTo(
      t,
      { who, group, rowId, side },
      shown.map((y) => y.task),
    );
    if (!moved) return;
    const { change, undo } = moved;
    if (change.who)
      toast(
        <>
          Moved <b>{t.title}</b> to {laneName(data, who)}
        </>,
        { icon: 'check', undo },
      );
    else if (change.slot)
      toast(
        <>
          Moved <b>{t.title}</b> to {SLOTS.find(([s]) => s === change.slot)![1]}
        </>,
        { icon: 'check', undo },
      );
  };

  const lifted = !!dnd.dragging;
  useEffect(() => {
    if (lifted) {
      draggingTask.set(true);
      return () => draggingTask.set(false);
    }
  }, [lifted]);

  const rowProps = (x: DueItem): RowProps => ({
    open: swiped?.id === x.task.id ? swiped.side : null,
    onOpenChange: (side: SwipeSide | null) => setSwiped(side ? { id: x.task.id, side } : null),
    onTap: () => tap(x),
    onEdit: () => openTaskSheet(x.task, undefined, back),
    onDelete: () => remove(x),
    onLater: !x.task.habit && !x.task.repeat && !x.done ? () => later(x) : undefined,
    checking: pending.isPending(x.task.id + x.day),
    streak: streaks.get(x.task.id) ?? 0,
    drag: dnd.bind(x),
    lifted: dnd.dragging?.task.id === x.task.id,
    drop: `${x.task.who}|${x.task.habit ? 'habits' : x.task.slot}|${x.task.id}`,
  });
  return { rowProps, layer: dnd.layer };
}

/**
 * Confetti when that check-off finished someone's tasks for today (habits don't count), from their
 * column; a bigger burst if everyone who had tasks today is now done.
 */
function cheerIfFinished(who: string, today: string): void {
  const d = dataStore.get();
  const due = dueOn(d.tasks, d.taskDone, today, today).filter((x) => !x.task.habit);
  const finished = (id: string) => due.some((x) => x.task.who === id) && due.every((x) => x.task.who !== id || x.done);
  if (!finished(who)) return;
  const everyone = lanesOf(d).every((id) => !due.some((x) => x.task.who === id) || finished(id));
  // From the column's heading (or the person's page, when one is open)
  const from =
    document.querySelector(`[data-lane="${who}"] > button`) ?? document.querySelector(`[data-lane="${who}"]`);
  celebrate({ from, tone: person(d, who).tone, everyone });
}
