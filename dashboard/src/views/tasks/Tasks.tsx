// Tasks: a column per person (plus Anyone), each with its habits and then its tasks for the day by
// part of the day (Anytime first). Tapping a column's heading opens that person on their own: tasks
// on the left, habits on the right. Arrows step to other days: past days show what was due and done,
// future days what's coming. Tap a task to check it off; swipe right to edit, left to delete; hold
// one, then drag it onto another column to give it to them; hold a column's heading to move the
// column (the order is saved on this device, and Today's rings follow it). The
// settings (cog, saved on this device) pick which people and sections show, and all tasks, only those
// to do, or only done ones (done ones sit at the bottom of their group).
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useHoldReorder } from '../../ui/useHoldReorder';
import type { Data } from '../../data/types';
import { useData } from '../../data/store';
import { useTaskStatus } from '../../data/taskSync';
import { dueOn, type DueItem } from '../../data/tasks';
import { person, laneName } from '../../data/select';
import { dayOf, shiftDay } from '../../lib/repeat';
import { dayName, fmtDate } from '../../lib/days';
import { useStore } from '../../lib/store';
import { useNow } from '../../lib/clock';
import { openSheet, useUI } from '../../app/ui';
import { Icon } from '../../ui/Icon';
import { Fab } from '../../ui/Fab';
import { useLayout } from '../../app/layout';
import { Ring } from '../../ui/Ring';
import { Avatar, toneStyle } from '../../ui/people';
import { PageHeader } from '../../ui/headers';
import { openTaskSheet } from './TaskSheet';
import { AllTasks } from './AllTasks';
import { Habits } from './Habits';
import {
  type DoneView,
  doneView,
  laneOrder,
  peopleFilter,
  sectionFilter,
  showing,
  split,
  useTaskLanes,
} from './settings';
import { type RowProps, useTaskRows } from './useTaskRows';
import { Detail, PersonList } from './PersonList';
import { SettingsSheet } from './TaskSettingsSheet';
import css from './Tasks.module.css';

// Home (Today's rings) reads the columns' order from here

export function Tasks() {
  const data = useData('family', 'lists', 'people', 'taskDone', 'tasks');
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
  // (reset while rendering the change, rather than in an effect that would draw the old day first)
  const onScreen = useUI((s) => s.view) === 'tasks';
  const [wasOnScreen, setWasOnScreen] = useState(onScreen);
  if (onScreen !== wasOnScreen) {
    setWasOnScreen(onScreen);
    if (!onScreen) setOffset(0);
  }
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
  const phone = useLayout() === 'phone';
  const newTask = () =>
    openTaskSheet(undefined, focus ? { who: focus } : people?.length === 1 ? { who: people[0] } : undefined);
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
            : `${focus ? laneName(data, focus) + ' · ' : ''}${fmtDate(day)} · ${counted.length ? (future ? `${counted.length} due` : left ? `${left} left` : 'all done') : 'nothing due'}`;

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
        {phone ? (
          <Fab label="New task" onClick={newTask} />
        ) : (
          <button className="btn btn--solid" onClick={newTask}>
            <Icon name="plus" size={22} />
            New task
          </button>
        )}
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
        <div className={css.laneGhost} style={reorder.ghostStyle}>
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
  data: Pick<Data, 'tasks' | 'taskDone' | 'people' | 'family' | 'lists'>;
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
  const { tasks, done } = split(items, sections, show);
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
        aria-label={`Open ${laneName(data, who)}’s tasks (hold to move the column)`}
      >
        <Avatar p={p} size={42} />
        <div>
          <b>{laneName(data, who)}</b>
          <span className={css.sub}>{tasks.length ? `${done} of ${tasks.length}` : 'Nothing'}</span>
        </div>
        {/* The count is written beside the name, so the ring only shows progress (and ✓ when all done) */}
        <div className={css.ring}>
          <Ring done={done} total={tasks.length || 1} size={40} />
          {tasks.length > 0 && done === tasks.length && (
            <span className="num">
              <Icon name="check" size={18} />
            </span>
          )}
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
