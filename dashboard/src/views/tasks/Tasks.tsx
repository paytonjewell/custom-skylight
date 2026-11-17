// Tasks: a column per person (plus Anyone), each with its habits and then its tasks for the day by
// part of the day (Anytime first). Tapping a column's heading opens that person on their own: tasks
// on the left, habits on the right. Arrows step to other days: past days show what was due and done,
// future days what's coming. Tap a task to check it off; swipe right to edit, left to delete. The
// settings (cog, saved on this device) pick which people and sections show, and whether done tasks do.
import { useEffect, useState } from 'react';
import type { Data, Slot } from '../../data/types';
import { useData } from '../../data/store';
import { deleteTask, restoreTask, setTaskDone } from '../../data/actions';
import { useTaskStatus } from '../../data/taskSync';
import { pushSupported, testPush, turnOffPush, turnOnPush, usePush } from '../../data/push';
import { SLOTS, doneByTask, doneLate, dueOn, type DueItem } from '../../data/tasks';
import { habitStats } from '../../data/habits';
import { person } from '../../data/select';
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
/** A column per person (FAMILY, worker/home.ts), then Anyone */
const lanesOf = (d: Data): string[] => [...d.people.map((p) => p.id), 'any'];
type Section = Slot | 'habits';
const SECTIONS: [Section, string][] = [['habits', 'Habits'], ...SLOTS];

// ------------------------------------------------------------ filter (saved per device)
/** A saved list of ids, or null for "all" */
function savedIds(key: string) {
  const s = createStore<string[] | null>((() => {
    try {
      const v = JSON.parse(stored(key, 'null'));
      return Array.isArray(v) && v.length ? v : null;
    } catch {
      return null;
    }
  })());
  return {
    store: s,
    set(ids: string[] | null) {
      s.set(ids);
      store(key, JSON.stringify(ids));
    },
  };
}
const peopleFilter = savedIds('tasks.people');
const sectionFilter = savedIds('tasks.sections');
/** Hide tasks once they're done */
const hideDone = createStore(stored('tasks.hideDone', '0') === '1');
const setHideDone = (on: boolean) => {
  hideDone.set(on);
  store('tasks.hideDone', on ? '1' : '0');
};
const showing = (ids: string[] | null, id: string) => !ids || ids.includes(id);

export function Tasks() {
  const data = useData();
  const now = useNow();
  const status = useTaskStatus();
  const people = useStore(peopleFilter.store, (s) => s);
  const sections = useStore(sectionFilter.store, (s) => s);
  const hide = useStore(hideDone, (s) => s);
  const pending = usePendingAction(CHECK_MS);
  /** The person opened on their own (their column's heading was tapped), or null for the columns */
  const [focus, setFocus] = useState<string | null>(null);
  /** One day's tasks, every task, or the habits page */
  const [mode, setMode] = useState<'day' | 'all' | 'habits'>('day');
  /** Days from today being shown */
  const [offset, setOffset] = useState(0);
  // Leaving the screen goes back to today, so a check-off never lands on a day stepped to earlier
  const onScreen = useUI((s) => s.view) === 'tasks';
  useEffect(() => { if (!onScreen) setOffset(0); }, [onScreen]);
  /** The row swiped open (one at a time) */
  const [swiped, setSwiped] = useState<{ id: string; side: SwipeSide } | null>(null);
  const today = dayOf(now);
  const day = shiftDay(today, offset);
  const future = offset > 0;

  // Everything due, done or not: counts and "All done!" use all of it, even when done tasks are hidden
  const due = dueOn(data.tasks, data.taskDone, day, today);
  const lanes = lanesOf(data).filter((id) => showing(people, id));
  // Current streak per habit (shown on its row)
  const streaks = new Map<string, number>();
  const doneBy = doneByTask(data.taskDone);
  for (const t of data.tasks) if (t.habit) streaks.set(t.id, habitStats(t, doneBy.get(t.id) ?? [], today, shiftDay(today, -400)).current);
  const counted = due.filter((x) => !x.task.habit && (focus ? x.task.who === focus : showing(people, x.task.who)));
  const left = counted.filter((x) => !x.done).length;

  const tap = (x: DueItem) => {
    const id = x.task.id + x.day;
    if (pending.isPending(id)) return;
    if (future) return toast('That isn’t due yet', { icon: 'clock' });
    if (x.done) return setTaskDone(x.task.id, x.day, false);
    pending.start(id, () => {
      setTaskDone(x.task.id, x.day, true, x.task.who === 'any' ? null : x.task.who);
      if (x.task.habit) return;
      toast(<><b>{x.task.title}</b> done</>, { icon: 'check', undo: () => setTaskDone(x.task.id, x.day, false) });
      if (day === today) cheerIfFinished(x.task.who, today);
    });
  };
  const remove = (x: DueItem) => {
    const gone = deleteTask(x.task.id);
    if (gone) toast(<>Deleted <b>{x.task.title}</b></>, { icon: 'trash', undo: () => restoreTask(gone.task, gone.done) });
  };
  const rowProps = (x: DueItem) => ({
    open: swiped?.id === x.task.id ? swiped.side : null,
    onOpenChange: (side: SwipeSide | null) => setSwiped(side ? { id: x.task.id, side } : null),
    onTap: () => tap(x),
    onEdit: () => openTaskSheet(x.task),
    onDelete: () => remove(x),
    checking: pending.isPending(x.task.id + x.day),
    streak: streaks.get(x.task.id) ?? 0,
  });

  const shownPeople = focus ? [focus] : lanes;
  const allCount = data.tasks.filter((t) => shownPeople.includes(t.who)).length;
  const habitCount = data.tasks.filter((t) => t.habit && shownPeople.includes(t.who)).length;
  const kicker =
    mode === 'all' ? `${allCount} ${allCount === 1 ? 'task' : 'tasks'}`
    : mode === 'habits' ? `${habitCount} ${habitCount === 1 ? 'habit' : 'habits'}`
    : status === 'loading' ? 'Loading tasks…'
    : status === 'error' ? 'Couldn’t load your tasks'
    : `${focus ? (focus === 'any' ? 'Anyone' : person(data, focus).name) + ' · ' : ''}${fmtDate(day)} · ${counted.length ? (future ? `${counted.length} due` : left ? `${left} left` : 'all done') : 'nothing due'}`;

  return (
    <div className={css.tasks}>
      <PageHeader
        kicker={kicker}
        title={mode !== 'day' ? (
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
              <button className={'chip chip--ghost ' + css.todayBtn} onClick={() => setOffset(0)}>Today</button>
            )}
          </span>
        )}
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
        <button className={'icon-btn ' + css.cog} aria-label="Task settings" onClick={() => openSheet(() => <SettingsSheet data={data} />)}>
          <Icon name="settings" size={28} />
          {(people || sections || hide) && <i className={css.cogDot} />}
        </button>
        <button className="btn btn--solid" onClick={() => openTaskSheet(undefined, focus ? { who: focus } : people?.length === 1 ? { who: people[0] } : undefined)}>
          <Icon name="plus" size={22} />
          New task
        </button>
      </PageHeader>
      {mode === 'all' ? (
        <AllTasks data={data} people={shownPeople} today={today} />
      ) : mode === 'habits' ? (
        <Habits data={data} people={shownPeople} today={today} />
      ) : focus ? (
        <Detail data={data} who={focus} day={day} items={due.filter((x) => x.task.who === focus)} sections={sections} hide={hide} rowProps={rowProps} />
      ) : (
        <div className={css.lanes} style={{ gridTemplateColumns: `repeat(${lanes.length || 1}, minmax(0, 1fr))` }}>
          {lanes.map((who) => (
            <Lane
              key={who}
              data={data}
              who={who}
              day={day}
              items={due.filter((x) => x.task.who === who)}
              sections={sections}
              hide={hide}
              rowProps={rowProps}
              onOpen={() => setFocus(who)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface RowProps {
  open: SwipeSide | null;
  onOpenChange: (side: SwipeSide | null) => void;
  onTap: () => void;
  onEdit: () => void;
  onDelete: () => void;
  checking: boolean;
  /** Habits: due days in a row done */
  streak: number;
}

/** A person's tasks for a day, split for showing: counts use them all, rows skip hidden done ones */
function split(items: DueItem[], sections: string[] | null, hide: boolean) {
  const tasks = items.filter((x) => !x.task.habit && showing(sections, x.task.slot));
  const done = tasks.filter((x) => x.done).length;
  const visible = (x: DueItem) => !hide || !x.done;
  return {
    tasks,
    done,
    all: tasks.length > 0 && done === tasks.length,
    shownTasks: tasks.filter(visible),
    shownHabits: showing(sections, 'habits') ? items.filter((x) => x.task.habit && visible(x)) : [],
  };
}

function Lane({ data, who, day, items, sections, hide, rowProps, onOpen }: {
  data: Data; who: string; day: string; items: DueItem[]; sections: string[] | null; hide: boolean;
  rowProps: (x: DueItem) => RowProps; onOpen: () => void;
}) {
  const p = person(data, who);
  const { tasks, done, all, shownTasks, shownHabits: habits } = split(items, sections, hide);
  return (
    <section className={css.lane + ' surface'} style={toneStyle(p)} data-lane={who}>
      <button className={css.head} onClick={onOpen} aria-label={`Open ${who === 'any' ? 'Anyone' : p.name}’s tasks`}>
        <Avatar p={p} size={42} />
        <div>
          <b>{who === 'any' ? 'Anyone' : p.name}</b>
          <span className={css.sub}>{tasks.length ? `${done} of ${tasks.length}` : 'Nothing'}</span>
        </div>
        <div className={css.ring}>
          <Ring done={done} total={tasks.length || 1} size={46} />
          <span className="num">{all ? '✓' : tasks.length ? done + '/' + tasks.length : '–'}</span>
        </div>
      </button>
      <div className={css.list}>
        {habits.length > 0 && (
          <div className={css.group}>
            <div className={css.groupLabel}>Habits</div>
            {habits.map((x) => <HabitRow key={x.task.id} x={x} {...rowProps(x)} />)}
          </div>
        )}
        {SLOTS.map(([slot, label]) => {
          const group = shownTasks.filter((x) => x.task.slot === slot);
          if (!group.length) return null;
          return (
            <div key={slot} className={css.group}>
              <div className={css.groupLabel}>{label}</div>
              {group.map((x) => <TaskRow key={x.task.id} x={x} viewing={day} {...rowProps(x)} />)}
            </div>
          );
        })}
        {!habits.length && !tasks.length && <p className={css.none}>Nothing to do</p>}
        {all && <div className={css.allDone + ' serif'}>All done<i>!</i></div>}
      </div>
    </section>
  );
}

/** One person on their own: tasks by part of the day on the left, habits on the right (stacked on phones) */
function Detail({ data, who, day, items, sections, hide, rowProps }: {
  data: Data; who: string; day: string; items: DueItem[]; sections: string[] | null; hide: boolean; rowProps: (x: DueItem) => RowProps;
}) {
  const p = person(data, who);
  const { tasks, all, shownTasks, shownHabits: habits } = split(items, sections, hide);
  const habitPanel = showing(sections, 'habits') && (
    <aside className={css.detailHabits}>
      <div className={css.groupLabel}>Habits</div>
      {habits.length
        ? habits.map((x) => <HabitRow key={x.task.id} x={x} {...rowProps(x)} />)
        : <p className={css.none}>{items.some((x) => x.task.habit) ? 'All done' : 'No habits today'}</p>}
    </aside>
  );
  return (
    <div className={css.detail} style={toneStyle(p)} data-lane={who}>
      <div className={css.detailTasks}>
        {SLOTS.filter(([slot]) => showing(sections, slot)).map(([slot, label]) => {
          const group = shownTasks.filter((x) => x.task.slot === slot);
          if (!group.length) return null;
          return (
            <div key={slot} className={css.group}>
              <div className={css.groupLabel}>{label}</div>
              {group.map((x) => <TaskRow key={x.task.id} x={x} viewing={day} {...rowProps(x)} />)}
            </div>
          );
        })}
        {!tasks.length && <p className={css.none}>Nothing to do</p>}
        {all && <div className={css.allDone + ' serif'}>All done<i>!</i></div>}
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
  const sub =
    x.overdue ? <span className={css.late}>Overdue · {shortDay(x.day)}</span>
    : x.done && doneLate(x)
      ? viewing === x.day ? <>Done late · on {shortDay(dayOf(new Date(x.done.at)))}</> : <>Done late · was due {shortDay(x.day)}</>
    : t.repeat ? <><Icon name="refresh" size={13} />{describeRepeat(t.repeat)}</>
    : list ? <><Icon name="bell" size={13} />{list.emoji} {list.title || 'Untitled list'}</>
    : t.due ? 'Once'
    : null;
  // Its phone reminder's time (list reminders already show a bell)
  const at = t.remind && !done ? <>{!list && <Icon name="bell" size={13} />}{fmtTime(t.remind)}</> : null;
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
            <svg viewBox="0 0 24 24" width="24" height="24"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
          </span>
        </span>
      )}
      <span className={css.text}>
        <b>{t.title}</b>
        {(sub || at) && <small>{sub}{sub && at && ' · '}{at}</small>}
      </span>
    </SwipeRow>
  );
}

function HabitRow({ x, checking, streak, ...swipe }: { x: DueItem } & RowProps) {
  const t = x.task;
  const done = !!x.done || checking;
  return (
    <SwipeRow label={t.title} {...swipe} className={done ? css.isDone : ''} slideClass={css.habit + (t.emoji ? '' : ' ' + css.plain)}>
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
  const from = document.querySelector(`[data-lane="${who}"] > button`) ?? document.querySelector(`[data-lane="${who}"]`);
  celebrate({ from, tone: person(d, who).tone, everyone });
}

function SettingsSheet({ data }: { data: Data }) {
  const people = useStore(peopleFilter.store, (s) => s);
  const sections = useStore(sectionFilter.store, (s) => s);
  const hide = useStore(hideDone, (s) => s);
  /** Toggle one id in a saved list; all (or none) ticked means "all" */
  const toggle = (f: typeof peopleFilter, cur: string[] | null, all: string[], id: string) => {
    const on = cur ?? all;
    const next = on.includes(id) ? on.filter((x) => x !== id) : [...on, id];
    f.set(next.length === 0 || next.length === all.length ? null : all.filter((x) => next.includes(x)));
  };
  const onPeople = people ?? lanesOf(data);
  const chip = (on: boolean) => 'chip' + (on ? ' is-on' : '');
  return (
    <div className="sheet-pad">
      <SheetHeader kicker="Tasks" title="Settings" />
      <div className={'label ' + css.sheetLabel}>People</div>
      <PersonPicker
        people={data.people}
        everyone={data.family}
        everyoneLabel="Anyone"
        selected={onPeople.map((id) => (id === 'any' ? 'family' : id))}
        onPick={(id) => toggle(peopleFilter, people, lanesOf(data), id === 'family' ? 'any' : id)}
      />
      <div className={'label ' + css.sheetLabel}>Sections</div>
      <div className="chips">
        {SECTIONS.map(([id, label]) => (
          <button key={id} className={chip(showing(sections, id))} onClick={() => toggle(sectionFilter, sections, SECTIONS.map(([s]) => s), id)}>
            {showing(sections, id) && <Icon name="check" size={18} />}
            {label}
          </button>
        ))}
      </div>
      <div className={'label ' + css.sheetLabel}>Done tasks</div>
      <div className="chips">
        <button className={chip(!hide)} onClick={() => setHideDone(false)}>Show</button>
        <button className={chip(hide)} onClick={() => setHideDone(true)}>Hide</button>
      </div>
      <div className={'label ' + css.sheetLabel}>Reminders on this phone</div>
      <PhoneReminders data={data} />
      <div className="sheet-actions">
        <button
          className="btn btn--ghost"
          disabled={!people && !sections && !hide}
          onClick={() => { peopleFilter.set(null); sectionFilter.set(null); setHideDone(false); }}
        >
          Reset
        </button>
        <button className="btn btn--solid" onClick={closeSheet}>Done</button>
      </div>
    </div>
  );
}

/** Turn phone reminders on or off on this device, and say whose phone it is */
function PhoneReminders({ data }: { data: Data }) {
  const on = usePush((s) => s.person);
  const [who, setWho] = useState<string | null>(on);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const humans = data.people.filter((p) => !p.pet);
  if (!pushSupported) {
    return <p className={css.remindNote}>Reminders go to phones. Open White Lotus HQ on your phone and turn them on here.</p>;
  }
  const run = (f: () => Promise<void>, done?: string) => {
    setBusy(true);
    setError('');
    f().then(
      () => { if (done) toast(done, { icon: 'bell' }); },
      (e: Error) => setError(e.message || 'Something went wrong'),
    ).finally(() => setBusy(false));
  };
  const pick = (id: string) => {
    setWho(id);
    // Already on: switching person just saves it
    if (on && id !== on) run(() => turnOnPush(id), `Reminders here are now for ${person(data, id).name}`);
  };
  return (
    <div className={css.remind}>
      <p className={css.remindNote}>
        {on
          ? <>On: this phone gets <b>{person(data, on).name}</b>’s reminders.</>
          : 'Whose phone is this? It will only get reminders sent to them.'}
      </p>
      <PersonPicker people={humans} avatarSize={44} selected={who ? [who] : []} onPick={pick} />
      <div className="chips">
        {on ? (
          <>
            <button className="chip" disabled={busy} onClick={() => run(testPush, 'Test sent')}>
              <Icon name="bell" size={18} /> Send a test
            </button>
            <button className="chip" disabled={busy} onClick={() => run(turnOffPush, 'Reminders off on this phone')}>Turn off</button>
          </>
        ) : (
          <button className="chip is-on" disabled={busy || !who} onClick={() => run(() => turnOnPush(who!), 'Reminders on')}>
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
const fmtDate = (day: string) => asDate(day).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
function dayName(offset: number, day: string): string {
  if (offset === 0) return 'Today';
  if (offset === -1) return 'Yesterday';
  if (offset === 1) return 'Tomorrow';
  return asDate(day).toLocaleDateString(undefined, Math.abs(offset) < 7 ? { weekday: 'long' } : { month: 'short', day: 'numeric' });
}
/** 'YYYY-MM-DD' → "Wed" within the last week, else "Nov 4" */
function shortDay(day: string): string {
  const ago = dayDiff(day, dayOf(new Date()));
  return asDate(day).toLocaleDateString(undefined, ago < 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' });
}
