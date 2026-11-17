// Tasks: a column per person (plus Anyone), each with its habits and then its tasks for the day by
// part of the day (Anytime first). Tapping a column's heading opens that person on their own: tasks
// on the left, habits on the right. Arrows step to other days: past days show what was due and done,
// future days what's coming. Tap a task to check it off; swipe right to edit, left to delete; hold
// one, then drag it onto another column to give it to them; hold a column's heading to move the
// column (the order is saved on this device, and Today's rings follow it). The
// settings (cog, saved on this device) pick which people and sections show, and all tasks, only those
// to do, or only done ones (done ones sit at the bottom of their group).
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useHoldReorder } from '../../ui/useHoldReorder';
import type { Data, Slot } from '../../data/types';
import { useData } from '../../data/store';
import { deleteTask, editTask, restoreTask, setTaskDone, type TaskFields } from '../../data/actions';
import { useDragDrop } from '../../ui/useDragDrop';
import type { DragProps } from '../../ui/useDragDrop';
import { useTaskStatus } from '../../data/taskSync';
import { pushSupported, testPush, turnOffPush, turnOnPush, usePush } from '../../data/push';
import { SLOTS, doneByTask, doneLate, dueOn, type DueItem } from '../../data/tasks';
import { habitStats } from '../../data/habits';
import { person, phonePeople, taskLanes, taskPeople } from '../../data/select';
import { dayDiff, dayOf, describeRepeat, shiftDay } from '../../lib/repeat';
import { createStore, store, stored, useStore } from '../../lib/store';
import { useNow } from '../../lib/clock';
import { closeSheet, openSheet, toast, useUI } from '../../app/ui';
import { Icon } from '../../ui/Icon';
import { Ring } from '../../ui/Ring';
import { Avatar, toneStyle } from '../../ui/people';
import { PageHeader, SheetHeader } from '../../ui/headers';
import { PersonPicker } from '../../ui/PersonPicker';
import { SwipeRow } from '../../ui/SwipeRow';
import { usePendingAction } from '../../ui/hooks';
import { celebrate } from '../../ui/confetti';
import { dataStore } from '../../data/store';
import type { SwipeSide } from '../../ui/useSwipeReveal';
import { openTaskSheet } from './TaskSheet';
import { AllTasks } from './AllTasks';
import { Habits } from './Habits';
import css from './Tasks.module.css';

const CHECK_MS = 350; // let the check animation play before the row changes
/** A column per person (FAMILY, worker/home.ts), then Anyone, then tasks-only profiles */
const lanesOf = (d: Data): string[] => taskLanes(d.people);
type Section = Slot | 'habits';
const SECTIONS: [Section, string][] = [['habits', 'Habits'], ...SLOTS];

// ------------------------------------------------------------ filter (saved per device)
/** A saved list of ids, or null for "all" */
function savedIds(key: string) {
  const s = createStore<string[] | null>(
    (() => {
      try {
        const v = JSON.parse(stored(key, 'null'));
        return Array.isArray(v) && v.length ? v : null;
      } catch {
        return null;
      }
    })(),
  );
  return {
    store: s,
    set(ids: string[] | null) {
      s.set(ids);
      store(key, JSON.stringify(ids));
    },
  };
}
const peopleFilter = savedIds('tasks.people');
/** Which sections show (saved on this device): shared with a person's sheet on Today */
const sectionFilter = savedIds('tasks.sections');
/** Which tasks show: everything (done ones last in each group), only what's left, or only what's done */
export type DoneView = 'all' | 'todo' | 'done';
const DONE_VIEWS: [DoneView, string][] = [
  ['all', 'All'],
  ['todo', 'To do'],
  ['done', 'Done'],
];
const isDoneView = (v: string): v is DoneView => DONE_VIEWS.some(([k]) => k === v);
// Saved on this device (also for that sheet). Before this was three-way it was "hide done" on or off.
const doneView = createStore<DoneView>(
  ((v) => (isDoneView(v) ? v : stored('tasks.hideDone', '0') === '1' ? 'todo' : 'all'))(stored('tasks.doneView', '')),
);
const setDoneView = (v: DoneView) => {
  doneView.set(v);
  store('tasks.doneView', v);
};
const showing = (ids: string[] | null, id: string) => !ids || ids.includes(id);

/** The columns' order, as dragged by their headings (saved on this device); null: the usual order */
const laneOrder = savedIds('tasks.order');
/** Columns in the saved order; ones it doesn't mention (someone new) keep their usual place at the end */
const inOrder = (ids: string[], saved: string[] | null): string[] =>
  !saved ? ids : [...saved.filter((id) => ids.includes(id)), ...ids.filter((id) => !saved.includes(id))];
/** Today's rings and the Tasks columns, in the order chosen on the Tasks screen */
export function useTaskLanes(d: Data): string[] {
  return inOrder(
    lanesOf(d),
    useStore(laneOrder.store, (s) => s),
  );
}

export function Tasks() {
  const data = useData();
  const now = useNow();
  const status = useTaskStatus();
  const people = useStore(peopleFilter.store, (s) => s);
  const sections = useStore(sectionFilter.store, (s) => s);
  const show = useStore(doneView, (s) => s);
  /** The person opened on their own (their column's heading was tapped), or null for the columns */
  const [focus, setFocus] = useState<string | null>(null);
  /** One day's tasks, every task, or the habits page */
  const [mode, setMode] = useState<'day' | 'all' | 'habits'>('day');
  /** Days from today being shown */
  const [offset, setOffset] = useState(0);
  // Leaving the screen goes back to today, so a check-off never lands on a day stepped to earlier
  const onScreen = useUI((s) => s.view) === 'tasks';
  useEffect(() => {
    if (!onScreen) setOffset(0);
  }, [onScreen]);
  const today = dayOf(now);
  const day = shiftDay(today, offset);
  const future = offset > 0;
  const { rowProps, layer: dragLayer } = useTaskRows(day, today);

  // Everything due, done or not: counts and "All done!" use all of it, even when done tasks are hidden
  const due = dueOn(data.tasks, data.taskDone, day, today);
  const allLanes = useTaskLanes(data);
  const lanes = allLanes.filter((id) => showing(people, id));
  // Hold a column's heading, then drag it to another place (the order of hidden columns is kept)
  const root = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const reorder = useHoldReorder({
    ids: lanes,
    onCommit: (next) => laneOrder.set([...next, ...allLanes.filter((id) => !next.includes(id))]),
    container: root,
    scroller: grid,
  });
  const counted = due.filter((x) => !x.task.habit && (focus ? x.task.who === focus : showing(people, x.task.who)));
  const left = counted.filter((x) => !x.done).length;

  const shownPeople = focus ? [focus] : lanes;
  const allCount = data.tasks.filter((t) => shownPeople.includes(t.who)).length;
  const habitCount = data.tasks.filter((t) => t.habit && shownPeople.includes(t.who)).length;
  const kicker =
    mode === 'all'
      ? `${allCount} ${allCount === 1 ? 'task' : 'tasks'}`
      : mode === 'habits'
        ? `${habitCount} ${habitCount === 1 ? 'habit' : 'habits'}`
        : status === 'loading'
          ? 'Loading tasks…'
          : status === 'error'
            ? 'Couldn’t load your tasks'
            : `${focus ? (focus === 'any' ? 'Anyone' : person(data, focus).name) + ' · ' : ''}${fmtDate(day)} · ${counted.length ? (future ? `${counted.length} due` : left ? `${left} left` : 'all done') : 'nothing due'}`;

  return (
    <div className={css.tasks} ref={root}>
      <PageHeader
        kicker={kicker}
        title={
          mode !== 'day' ? (
            <span className={css.dayNav}>
              <button className={'btn btn--ghost ' + css.back} onClick={() => setMode('day')}>
                <Icon name="left" size={22} />
                Back
              </button>
              {mode === 'all' ? 'All tasks' : 'Habits'}
            </span>
          ) : (
            <span className={css.dayNav}>
              {focus && (
                // A labelled pill, so it isn't mistaken for the previous-day arrow beside it
                <button className={'btn btn--ghost ' + css.back} onClick={() => setFocus(null)}>
                  <Icon name="left" size={22} />
                  Back
                </button>
              )}
              <button className="icon-btn" aria-label="Previous day" onClick={() => setOffset(offset - 1)}>
                <Icon name="left" size={30} />
              </button>
              <span className={css.dayName}>{dayName(offset, day)}</span>
              <button className="icon-btn" aria-label="Next day" onClick={() => setOffset(offset + 1)}>
                <Icon name="right" size={30} />
              </button>
              {offset !== 0 && (
                <button className={'chip chip--ghost ' + css.todayBtn} onClick={() => setOffset(0)}>
                  Today
                </button>
              )}
            </span>
          )
        }
      >
        {mode !== 'habits' && (
          <button className={'icon-btn ' + css.cog} aria-label="Habits" onClick={() => setMode('habits')}>
            <Icon name="flame" size={26} />
          </button>
        )}
        {mode !== 'all' && (
          <button className={'icon-btn ' + css.cog} aria-label="All tasks" onClick={() => setMode('all')}>
            <Icon name="list" size={26} />
          </button>
        )}
        <button
          className={'icon-btn ' + css.cog}
          aria-label="Task settings"
          onClick={() => openSheet(() => <SettingsSheet data={data} />)}
        >
          <Icon name="settings" size={28} />
          {(people || sections || show !== 'all') && <i className={css.cogDot} />}
        </button>
        <button
          className="btn btn--solid"
          onClick={() =>
            openTaskSheet(undefined, focus ? { who: focus } : people?.length === 1 ? { who: people[0] } : undefined)
          }
        >
          <Icon name="plus" size={22} />
          New task
        </button>
      </PageHeader>
      {mode === 'all' ? (
        <AllTasks data={data} people={shownPeople} today={today} />
      ) : mode === 'habits' ? (
        <Habits data={data} people={shownPeople} today={today} />
      ) : focus ? (
        <Detail
          data={data}
          who={focus}
          day={day}
          items={due.filter((x) => x.task.who === focus)}
          sections={sections}
          show={show}
          rowProps={rowProps}
        />
      ) : (
        <div
          className={css.lanes}
          ref={grid}
          style={{ gridTemplateColumns: `repeat(${lanes.length || 1}, minmax(0, 1fr))` }}
        >
          {reorder.order.map((who) => (
            <Lane
              key={who}
              data={data}
              who={who}
              day={day}
              items={due.filter((x) => x.task.who === who)}
              sections={sections}
              show={show}
              rowProps={rowProps}
              onOpen={() => setFocus(who)}
              move={reorder.itemProps(who)}
              lifted={reorder.ghost?.id === who}
            />
          ))}
        </div>
      )}
      {/* The column being moved, under the finger */}
      {reorder.ghost && !focus && mode === 'day' && (
        <div
          className={css.laneGhost}
          style={{ left: reorder.ghost.x, top: reorder.ghost.y, width: reorder.ghost.w, height: reorder.ghost.h }}
        >
          <Lane
            data={data}
            who={reorder.ghost.id}
            day={day}
            items={due.filter((x) => x.task.who === reorder.ghost!.id)}
            sections={sections}
            show={show}
            rowProps={rowProps}
            onOpen={() => {}}
          />
        </div>
      )}
      {dragLayer}
    </div>
  );
}

/** A column's name, for "Moved … to Ace" */
const laneName = (d: Data, who: string) => (who === 'any' ? 'Anyone' : person(d, who).name);

/**
 * Rows' actions, for the Tasks screen and a person's sheet on Today: tap to check off (habits too),
 * swipe right to edit, left to delete. `back` reopens the sheet once the task editor closes.
 */
/** A task is being dragged (anywhere): lists show every part of the day, so there's somewhere to drop it */
const draggingTask = createStore(false);
export const useTaskDragging = () => useStore(draggingTask, (v) => v);

export function useTaskRows(
  day: string,
  today: string,
  back?: () => void,
): { rowProps: (x: DueItem) => RowProps; layer: ReactNode } {
  const data = useData();
  const { sections, show } = useShowSettings();
  const pending = usePendingAction(CHECK_MS);
  /** The row swiped open (one at a time) */
  const [swiped, setSwiped] = useState<{ id: string; side: SwipeSide } | null>(null);
  const future = day > today;
  // Current streak per habit (shown on its row)
  const streaks = new Map<string, number>();
  const doneBy = doneByTask(data.taskDone);
  for (const t of data.tasks)
    if (t.habit) streaks.set(t.id, habitStats(t, doneBy.get(t.id) ?? [], today, shiftDay(today, -400)).current);

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
    const change: Partial<TaskFields> = {};
    if (who !== t.who) change.who = who;
    // A habit stays a habit and a task a task: a drop on the other kind's group just changes whose it is
    const fits = group && (group === 'habits') === t.habit;
    if (fits && !t.habit && group !== t.slot) change.slot = group as Slot;
    // Its place among what's showing in that group now (others there keep their order)
    const edits = new Map<string, Partial<TaskFields>>();
    if (fits) {
      const showingThere = split(
        dueOn(data.tasks, data.taskDone, day, today).filter((y) => y.task.who === who),
        sections,
        show,
      );
      const list = (t.habit ? showingThere.shownHabits : showingThere.shownTasks.filter((y) => y.task.slot === group))
        .map((y) => y.task)
        .filter((y) => y.id !== t.id);
      let at = rowId ? list.findIndex((y) => y.id === rowId) : list.length;
      if (at < 0) at = list.length;
      else if (rowId && side === 'after') at++;
      list.splice(at, 0, t);
      list.forEach((y, i) => {
        if (y.position !== i + 1) edits.set(y.id, { position: i + 1 });
      });
    }
    if (Object.keys(change).length) edits.set(t.id, { ...edits.get(t.id), ...change });
    if (!edits.size) return;
    // Undo puts back what each one had
    const before = [...edits.keys()].map((id) => {
      const y = data.tasks.find((z) => z.id === id)!;
      const was: Partial<TaskFields> = {};
      for (const k of Object.keys(edits.get(id)!) as (keyof TaskFields)[])
        (was as Record<string, unknown>)[k] = y[k] ?? null;
      return [id, was] as const;
    });
    for (const [id, p] of edits) editTask(id, p);
    const undo = () => before.forEach(([id, p]) => editTask(id, p));
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

/** What useHoldReorder puts on a column: the column is measured, its heading picks it up */
interface LaneMove {
  ref: (el: HTMLElement | null) => void;
  onPointerDown: (e: ReactPointerEvent) => void;
  onContextMenu: (e: { preventDefault(): void }) => void;
  onClickCapture: (e: { preventDefault(): void; stopPropagation(): void }) => void;
}

function Lane({
  data,
  who,
  day,
  items,
  sections,
  show,
  rowProps,
  onOpen,
  move,
  lifted,
}: {
  data: Data;
  who: string;
  day: string;
  items: DueItem[];
  sections: string[] | null;
  show: DoneView;
  rowProps: (x: DueItem) => RowProps;
  onOpen: () => void;
  /** Hold the heading to move the column (absent on the copy being dragged) */
  move?: LaneMove;
  /** This column is being moved: an empty slot shows where it will go */
  lifted?: boolean;
}) {
  const p = person(data, who);
  const { tasks, done, all } = split(items, sections, show);
  return (
    <section
      ref={move?.ref}
      className={css.lane + ' surface' + (lifted ? ' ' + css.laneLifted : '')}
      style={toneStyle(p)}
      data-lane={who}
      data-drop={who}
    >
      <button
        className={css.head}
        onClick={onOpen}
        onPointerDown={move?.onPointerDown}
        onContextMenu={move?.onContextMenu}
        onClickCapture={move?.onClickCapture}
        aria-label={`Open ${who === 'any' ? 'Anyone' : p.name}’s tasks (hold to move the column)`}
      >
        <Avatar p={p} size={42} />
        <div>
          <b>{who === 'any' ? 'Anyone' : p.name}</b>
          <span className={css.sub}>{tasks.length ? `${done} of ${tasks.length}` : 'Nothing'}</span>
        </div>
        <div className={css.ring}>
          <Ring done={done} total={tasks.length || 1} size={46} />
          {(() => {
            const label = all ? '✓' : tasks.length ? done + '/' + tasks.length : '–';
            return <span className={'num' + (label.length > 3 ? ' ' + css.long : '')}>{label}</span>;
          })()}
        </div>
      </button>
      <PersonList
        who={who}
        day={day}
        items={items}
        sections={sections}
        show={show}
        rowProps={rowProps}
        className={css.list}
      />
    </section>
  );
}

/** Rows on a sheet, which is paper-coloured: cards stand out on it (PersonTasksSheet) */
export const SHEET_LIST = css.sheetList;

/**
 * One person's list for a day: habits, then tasks by part of the day (Anytime first). A column on
 * the Tasks screen, and the sheet from their ring on Today.
 */
export function PersonList({
  who,
  day,
  items,
  sections,
  show,
  rowProps,
  className,
}: {
  who: string;
  day: string;
  items: DueItem[];
  sections: string[] | null;
  show: DoneView;
  rowProps: (x: DueItem) => RowProps;
  className?: string;
}) {
  const { tasks, all, shownTasks, shownHabits: habits } = split(items, sections, show);
  const dragging = useStore(draggingTask, (v) => v);
  return (
    <div className={className}>
      {habits.length > 0 && (
        <div className={css.group} data-drop={who + '|habits'}>
          <div className={css.groupLabel}>Habits</div>
          {habits.map((x) => (
            <HabitRow key={x.task.id} x={x} {...rowProps(x)} />
          ))}
        </div>
      )}
      {SLOTS.map(([slot, label]) => {
        const group = shownTasks.filter((x) => x.task.slot === slot);
        // While a task is dragged, empty parts of the day show too, as places to drop it
        if (!group.length && !(dragging && showing(sections, slot))) return null;
        return (
          <div key={slot} className={css.group} data-drop={who + '|' + slot}>
            <div className={css.groupLabel}>{label}</div>
            {group.map((x) => (
              <TaskRow key={x.task.id} x={x} viewing={day} {...rowProps(x)} />
            ))}
            {!group.length && <div className={css.dropHere}>Drop here</div>}
          </div>
        );
      })}
      {!habits.length && !tasks.length && <p className={css.none}>Nothing to do</p>}
      {show === 'done' && !habits.length && !shownTasks.length && tasks.length > 0 && (
        <p className={css.none}>Nothing done yet</p>
      )}
      {all && show !== 'done' && (
        <div className={css.allDone + ' serif'}>
          All done<i>!</i>
        </div>
      )}
    </div>
  );
}

/** One person on their own: tasks by part of the day on the left, habits on the right (stacked on phones) */
function Detail({
  data,
  who,
  day,
  items,
  sections,
  show,
  rowProps,
}: {
  data: Data;
  who: string;
  day: string;
  items: DueItem[];
  sections: string[] | null;
  show: DoneView;
  rowProps: (x: DueItem) => RowProps;
}) {
  const p = person(data, who);
  const { tasks, all, shownTasks, shownHabits: habits } = split(items, sections, show);
  const dragging = useStore(draggingTask, (v) => v);
  const habitPanel = showing(sections, 'habits') && (
    <aside className={css.detailHabits} data-drop={who + '|habits'}>
      <div className={css.groupLabel}>Habits</div>
      {habits.length ? (
        habits.map((x) => <HabitRow key={x.task.id} x={x} {...rowProps(x)} />)
      ) : (
        <p className={css.none}>
          {!items.some((x) => x.task.habit) ? 'No habits today' : show === 'done' ? 'None done yet' : 'All done'}
        </p>
      )}
    </aside>
  );
  return (
    <div className={css.detail} style={toneStyle(p)} data-lane={who}>
      <div className={css.detailTasks}>
        {SLOTS.filter(([slot]) => showing(sections, slot)).map(([slot, label]) => {
          const group = shownTasks.filter((x) => x.task.slot === slot);
          if (!group.length && !dragging) return null;
          return (
            <div key={slot} className={css.group} data-drop={who + '|' + slot}>
              <div className={css.groupLabel}>{label}</div>
              {group.map((x) => (
                <TaskRow key={x.task.id} x={x} viewing={day} {...rowProps(x)} />
              ))}
              {!group.length && <div className={css.dropHere}>Drop here</div>}
            </div>
          );
        })}
        {!tasks.length && <p className={css.none}>Nothing to do</p>}
        {show === 'done' && !shownTasks.length && tasks.length > 0 && <p className={css.none}>Nothing done yet</p>}
        {all && show !== 'done' && (
          <div className={css.allDone + ' serif'}>
            All done<i>!</i>
          </div>
        )}
      </div>
      {habitPanel}
    </div>
  );
}

function TaskRow({ x, viewing, checking, streak: _streak, ...swipe }: { x: DueItem; viewing: string } & RowProps) {
  const t = x.task;
  const done = !!x.done || checking;
  // A reminder from a list item names the list
  const list = useData().lists.find((l) => l.id === t.listId);
  const sub = x.overdue ? (
    <span className={css.late}>Overdue · {shortDay(x.day)}</span>
  ) : x.done && doneLate(x) ? (
    viewing === x.day ? (
      <>Done late · on {shortDay(dayOf(new Date(x.done.at)))}</>
    ) : (
      <>Done late · was due {shortDay(x.day)}</>
    )
  ) : t.repeat ? (
    <>
      <Icon name="refresh" size={13} />
      {describeRepeat(t.repeat)}
    </>
  ) : list ? (
    <>
      <Icon name="bell" size={13} />
      {list.emoji} {list.title || 'Untitled list'}
    </>
  ) : t.due ? (
    'Once'
  ) : null;
  // Its phone reminder's time (list reminders already show a bell)
  const at =
    t.remind && !done ? (
      <>
        {!list && <Icon name="bell" size={13} />}
        {fmtTime(t.remind)}
      </>
    ) : null;
  return (
    <SwipeRow
      label={t.title}
      {...swipe}
      className={(done ? css.isDone : '') + (x.overdue ? ' ' + css.isOverdue : '')}
      slideClass={css.task + (t.emoji ? '' : ' ' + css.plain)}
    >
      {/* No emoji: no box at all, just the text (done shows as struck through) */}
      {t.emoji && (
        <span className={css.mark}>
          {t.emoji}
          <span className={css.check}>
            <svg viewBox="0 0 24 24" width="24" height="24">
              <path d="M5 12.5l4.5 4.5L19 7" />
            </svg>
          </span>
        </span>
      )}
      <span className={css.text}>
        <b>{t.title}</b>
        {(sub || at) && (
          <small>
            {sub}
            {sub && at && ' · '}
            {at}
          </small>
        )}
      </span>
    </SwipeRow>
  );
}

function HabitRow({ x, checking, streak, ...swipe }: { x: DueItem } & RowProps) {
  const t = x.task;
  const done = !!x.done || checking;
  return (
    <SwipeRow
      label={t.title}
      {...swipe}
      className={done ? css.isDone : ''}
      slideClass={css.habit + (t.emoji ? '' : ' ' + css.plain)}
    >
      {t.emoji && <span className={css.habitMark}>{done ? <Icon name="check" size={20} /> : t.emoji}</span>}
      <span className={css.habitName}>{t.title}</span>
      {streak > 1 && (
        <span className={css.streak} title={`${streak} in a row`}>
          <Icon name="flame" size={15} />
          <span className="num">{streak}</span>
        </span>
      )}
      <span className={css.count + ' num'}>{done ? 1 : 0}/1</span>
    </SwipeRow>
  );
}

// ------------------------------------------------------------ filter
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

function SettingsSheet({ data }: { data: Data }) {
  const people = useStore(peopleFilter.store, (s) => s);
  const sections = useStore(sectionFilter.store, (s) => s);
  const show = useStore(doneView, (s) => s);
  const onPeople = people ?? lanesOf(data);
  return (
    <div className="sheet-pad">
      <SheetHeader kicker="Tasks" title="Settings" />
      <div className={'label ' + css.sheetLabel}>People</div>
      <PersonPicker
        people={taskPeople(data.people).filter((p) => p.calendar !== false)}
        everyone={data.family}
        everyoneLabel="Anyone"
        after={taskPeople(data.people).filter((p) => p.calendar === false)}
        selected={onPeople.map((id) => (id === 'any' ? 'family' : id))}
        onPick={(id) => toggleIn(peopleFilter, people, lanesOf(data), id === 'family' ? 'any' : id)}
      />
      <ShowSettings />
      <div className={'label ' + css.sheetLabel}>Reminders on this phone</div>
      <PhoneReminders data={data} />
      <div className="sheet-actions">
        <button
          className="btn btn--ghost"
          disabled={!people && !sections && show === 'all'}
          onClick={() => {
            peopleFilter.set(null);
            sectionFilter.set(null);
            setDoneView('all');
          }}
        >
          Reset
        </button>
        <button className="btn btn--solid" onClick={closeSheet}>
          Done
        </button>
      </div>
    </div>
  );
}

/** A saved list's toggle: all (or none) ticked means "all" */
function toggleIn(f: ReturnType<typeof savedIds>, cur: string[] | null, all: string[], id: string) {
  const on = cur ?? all;
  const next = on.includes(id) ? on.filter((x) => x !== id) : [...on, id];
  f.set(next.length === 0 || next.length === all.length ? null : all.filter((x) => next.includes(x)));
}

/** Which sections show, and all tasks, only those to do, or only done ones. Saved on this device, for the Tasks screen and the sheets on Today. */
export function ShowSettings({ labelClass = css.sheetLabel }: { labelClass?: string }) {
  const sections = useStore(sectionFilter.store, (s) => s);
  const show = useStore(doneView, (s) => s);
  const chip = (on: boolean) => 'chip' + (on ? ' is-on' : '');
  return (
    <>
      <div className={'label ' + labelClass}>Sections</div>
      <div className="chips">
        {SECTIONS.map(([id, label]) => (
          <button
            key={id}
            className={chip(showing(sections, id))}
            onClick={() =>
              toggleIn(
                sectionFilter,
                sections,
                SECTIONS.map(([s]) => s),
                id,
              )
            }
          >
            {showing(sections, id) && <Icon name="check" size={18} />}
            {label}
          </button>
        ))}
      </div>
      <div className={'label ' + labelClass}>Show</div>
      <div className="chips">
        {DONE_VIEWS.map(([v, label]) => (
          <button key={v} className={chip(show === v)} onClick={() => setDoneView(v)}>
            {label}
          </button>
        ))}
      </div>
    </>
  );
}

/** The shown sections and which tasks show (see ShowSettings) */
export function useShowSettings(): { sections: string[] | null; show: DoneView; filtered: boolean } {
  const sections = useStore(sectionFilter.store, (s) => s);
  const show = useStore(doneView, (s) => s);
  return { sections, show, filtered: !!sections || show !== 'all' };
}

/** Turn phone reminders on or off on this device, and say whose phone it is */
function PhoneReminders({ data }: { data: Data }) {
  const on = usePush((s) => s.person);
  const [who, setWho] = useState<string | null>(on);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const humans = phonePeople(data.people);
  if (!pushSupported) {
    return (
      <p className={css.remindNote}>Reminders go to phones. Open White Lotus HQ on your phone and turn them on here.</p>
    );
  }
  const run = (f: () => Promise<void>, done?: string) => {
    setBusy(true);
    setError('');
    f()
      .then(
        () => {
          if (done) toast(done, { icon: 'bell' });
        },
        (e: Error) => setError(e.message || 'Something went wrong'),
      )
      .finally(() => setBusy(false));
  };
  const pick = (id: string) => {
    setWho(id);
    // Already on: switching person just saves it
    if (on && id !== on) run(() => turnOnPush(id), `Reminders here are now for ${person(data, id).name}`);
  };
  return (
    <div className={css.remind}>
      <p className={css.remindNote}>
        {on ? (
          <>
            On: this phone gets <b>{person(data, on).name}</b>’s reminders.
          </>
        ) : (
          'Whose phone is this? It will only get reminders sent to them.'
        )}
      </p>
      <PersonPicker people={humans} avatarSize={44} selected={who ? [who] : []} onPick={pick} />
      <div className="chips">
        {on ? (
          <>
            <button className="chip" disabled={busy} onClick={() => run(testPush, 'Test sent')}>
              <Icon name="bell" size={18} /> Send a test
            </button>
            <button className="chip" disabled={busy} onClick={() => run(turnOffPush, 'Reminders off on this phone')}>
              Turn off
            </button>
          </>
        ) : (
          <button
            className="chip is-on"
            disabled={busy || !who}
            onClick={() => run(() => turnOnPush(who!), 'Reminders on')}
          >
            <Icon name="bell" size={18} /> Turn on reminders
          </button>
        )}
      </div>
      {error && <p className={css.remindError}>{error}</p>}
    </div>
  );
}

// ------------------------------------------------------------ dates
/** 'HH:MM' → "8:00 AM" (or "08:00", as this device shows times) */
const fmtTime = (hhmm: string) =>
  new Date(`2000-01-01T${hhmm}:00`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const asDate = (day: string) => new Date(day + 'T12:00:00');
export const fmtDate = (day: string) =>
  asDate(day).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
export function dayName(offset: number, day: string): string {
  if (offset === 0) return 'Today';
  if (offset === -1) return 'Yesterday';
  if (offset === 1) return 'Tomorrow';
  return asDate(day).toLocaleDateString(
    undefined,
    Math.abs(offset) < 7 ? { weekday: 'long' } : { month: 'short', day: 'numeric' },
  );
}
/** 'YYYY-MM-DD' → "Wed" within the last week, else "Nov 4" */
function shortDay(day: string): string {
  const ago = dayDiff(day, dayOf(new Date()));
  return asDate(day).toLocaleDateString(undefined, ago < 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' });
}
