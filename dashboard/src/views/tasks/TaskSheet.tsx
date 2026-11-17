// Add or edit a task: what, who, how often, when in the day, and whether it's a habit. The common
// repeats are one tap (Once, Daily, Weekdays, Weekly, Monthly); the rest (every few days, weeks or
// months; the 1st Thursday, or the day before it) are under Custom. Repeats can count from the due
// date (the calendar) or from when it was last done ("1 week after it's done").
import { useRef, useState } from 'react';
import type { Slot, Task } from '../../data/types';
import { useData } from '../../data/store';
import { addTask, deleteTask, editTask, restoreTask, type TaskFields } from '../../data/actions';
import { SLOTS } from '../../data/tasks';
import { dayOf, describeRepeat, shiftDay, weekdayOf, type Repeat, type Unit, type Weekday } from '../../lib/repeat';
import { now as clockNow } from '../../lib/clock';
import { peopleWithPhones, usePush } from '../../data/push';
import { closeSheet, dismissSheet, go, openSheet, toast } from '../../app/ui';
import { openList } from '../lists/Lists';
import { PersonPicker } from '../../ui/PersonPicker';
import { EmojiPicker } from '../../ui/EmojiPicker';
import { Icon } from '../../ui/Icon';
import css from './TaskSheet.module.css';
import { phonePeople, taskPeople } from '../../data/select';

type Often = 'once' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom';
type Custom = 'days' | 'weeks' | 'months' | 'nth';
type Basis = 'due' | 'done';

const OFTEN: [Often, string][] = [
  ['once', 'Once'], ['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['custom', 'Custom…'],
];
const CUSTOM: [Custom, string][] = [['days', 'Every few days'], ['weeks', 'Every few weeks'], ['months', 'Every few months'], ['nth', 'A weekday of the month']];
const WEEK: [Weekday, string][] = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
const NTHS: [1 | 2 | 3 | 4 | -1, string][] = [[1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [-1, 'Last']];
const OFFSETS: [number, string][] = [[-1, 'Day before'], [0, 'On the day'], [1, 'Day after']];
/** A reminder's time when it's first turned on, by part of the day */
const REMIND_AT: Record<Slot, string> = { morning: '08:00', afternoon: '13:00', evening: '18:00', anytime: '09:00' };

/** `back`: what to reopen once the editor closes (saved, cancelled or deleted), e.g. a person's sheet */
export function openTaskSheet(task?: Task, defaults?: Partial<TaskFields>, back?: () => void): void {
  openSheet(() => <TaskSheet task={task} defaults={defaults} />, { cls: 'sheet--wide', onClose: back });
}

/** The controls that describe an existing rule */
function controls(r: Repeat | null): { mode: Often; custom: Custom; basis: Basis } {
  const out = (mode: Often, custom: Custom = 'days', basis: Basis = 'due') => ({ mode, custom, basis });
  if (!r) return out('once');
  switch (r.kind) {
    case 'afterDone': {
      const custom: Custom = r.unit === 'day' ? 'days' : r.unit === 'week' ? 'weeks' : 'months';
      if (r.every > 1) return out('custom', custom, 'done');
      return out(r.unit === 'day' ? 'daily' : r.unit === 'week' ? 'weekly' : 'monthly', custom, 'done');
    }
    case 'monthlyNth': return out('custom', 'nth');
    case 'daily': return (r.every ?? 1) > 1 ? out('custom', 'days') : out('daily');
    case 'monthly': return (r.every ?? 1) > 1 ? out('custom', 'months') : out('monthly');
    case 'weekly':
      if ((r.every ?? 1) > 1) return out('custom', 'weeks');
      return out(r.days.length === 5 && [1, 2, 3, 4, 5].every((d) => r.days.includes(d as Weekday)) ? 'weekdays' : 'weekly');
  }
}

function TaskSheet({ task, defaults }: { task?: Task; defaults?: Partial<TaskFields> }) {
  const data = useData();
  const [today] = useState(() => dayOf(clockNow()));
  const r = task?.repeat ?? null;
  const start = r?.start ?? today;
  const init = controls(r);

  const [title, setTitle] = useState(task?.title ?? defaults?.title ?? '');
  const [who, setWho] = useState(task?.who ?? defaults?.who ?? 'any');
  const [mode, setMode] = useState<Often>(init.mode);
  const [custom, setCustom] = useState<Custom>(init.custom);
  const [basis, setBasis] = useState<Basis>(init.basis);
  const [due, setDue] = useState<string | null>(task?.due ?? defaults?.due ?? null);
  const [days, setDays] = useState<Weekday[]>(r?.kind === 'weekly' ? r.days : [weekdayOf(today)]);
  const [monthDay, setMonthDay] = useState(r?.kind === 'monthly' ? r.day : Number(today.slice(8)));
  const [every, setEvery] = useState(r && 'every' in r && r.every && r.every > 1 ? r.every : 2);
  const [nth, setNth] = useState<1 | 2 | 3 | 4 | -1>(r?.kind === 'monthlyNth' ? r.nth : 1);
  const [nthDay, setNthDay] = useState<Weekday>(r?.kind === 'monthlyNth' ? r.weekday : weekdayOf(today));
  const [offset, setOffset] = useState(r?.offset ?? 0);
  const [slot, setSlot] = useState<Slot>(task?.slot ?? defaults?.slot ?? 'anytime');
  const [habit, setHabit] = useState(task?.habit ?? defaults?.habit ?? false);
  const dateInput = useRef<HTMLInputElement>(null);
  const [emoji, setEmoji] = useState(task?.emoji ?? defaults?.emoji ?? '');
  const [picking, setPicking] = useState(false);
  const [onCalendar, setOnCalendar] = useState(task?.onCalendar ?? defaults?.onCalendar ?? false);
  const [remind, setRemind] = useState<string | null>(task?.remind ?? null);
  const [notify, setNotify] = useState<string[]>(task?.notify ?? []);
  const myPerson = usePush((s) => s.person);
  usePush((s) => s.info); // re-render when who has phones loads
  const phones = peopleWithPhones();
  /** People a reminder can go to (not pets) */
  const humans = phonePeople(data.people);
  const turnOnRemind = () => {
    setRemind(REMIND_AT[slot]);
    // To the person it's for if they're a person; otherwise whoever's phone this is
    if (!notify.length) {
      const forWho = humans.find((p) => p.id === who)?.id ?? myPerson;
      setNotify(forWho ? [forWho] : []);
    }
  };
  const noPhone = notify.filter((id) => !phones.includes(id));
  /** The list this is a reminder from (if it still exists) */
  const fromList = data.lists.find((l) => l.id === (task?.listId ?? defaults?.listId));

  /** Can this choice count from when it's done? (Not weekdays, or the Nth weekday of a month.) */
  const canBasis = mode === 'daily' || mode === 'weekly' || mode === 'monthly' || (mode === 'custom' && custom !== 'nth');
  const fromDone = canBasis && basis === 'done';
  const weekDays = days.length ? days : [weekdayOf(today)];

  /** The rule the controls describe */
  function rule(): Repeat | null {
    const base = { start };
    if (fromDone) {
      const unit: Unit = mode === 'daily' || custom === 'days' ? 'day' : mode === 'weekly' || custom === 'weeks' ? 'week' : 'month';
      return { kind: 'afterDone', every: mode === 'custom' ? every : 1, unit, ...base };
    }
    switch (mode) {
      case 'once': return null;
      case 'daily': return { kind: 'daily', ...base };
      case 'weekdays': return { kind: 'weekly', days: [1, 2, 3, 4, 5], ...base };
      case 'weekly': return { kind: 'weekly', days: weekDays, ...base };
      case 'monthly': return { kind: 'monthly', day: monthDay, ...base };
      case 'custom':
        switch (custom) {
          case 'days': return { kind: 'daily', every, ...base };
          case 'weeks': return { kind: 'weekly', days: weekDays, every, ...base };
          case 'months': return { kind: 'monthly', day: monthDay, every, ...base };
          case 'nth': return { kind: 'monthlyNth', nth, weekday: nthDay, ...(offset ? { offset } : {}), ...base };
        }
    }
  }
  const repeat = rule();

  const save = () => {
    const f: TaskFields = {
      title: title.trim() || 'New task',
      emoji,
      who,
      repeat,
      due: repeat ? null : due,
      slot,
      time: task?.time ?? null,
      habit: !!repeat && habit, // a habit needs a repeat to keep a streak
      onCalendar,
      remind: remind && notify.length ? remind : null,
      notify: remind ? notify : [],
      listId: task?.listId ?? defaults?.listId ?? null,
      listItemId: task?.listItemId ?? defaults?.listItemId ?? null,
    };
    closeSheet();
    if (task) {
      editTask(task.id, f);
      return;
    }
    const t = addTask(f);
    toast(<>Added <b>{t.title}</b></>, { icon: 'check', undo: () => deleteTask(t.id) });
  };

  const remove = () => {
    if (!task) return;
    closeSheet();
    const gone = deleteTask(task.id);
    if (gone) toast(<>Deleted <b>{task.title}</b></>, { icon: 'trash', undo: () => restoreTask(gone.task, gone.done) });
  };

  const chip = (on: boolean) => 'chip' + (on ? ' is-on' : '');
  const toggleDay = (d: Weekday) => setDays((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d]));
  const step = (label: string, value: number, set: (n: number) => void, min = 1, max = 365) => (
    <div className={css.stepper}>
      <button className="icon-btn" aria-label="Fewer" onClick={() => set(Math.max(min, value - 1))}>−</button>
      <b className="num">{value}</b>
      <button className="icon-btn" aria-label="More" onClick={() => set(Math.min(max, value + 1))}>+</button>
      <span>{label}</span>
    </div>
  );
  const weekdays = (
    <div className="chips">
      {WEEK.map(([d, label]) => (
        <button key={d} className={chip(days.includes(d))} onClick={() => toggleDay(d)}>{label}</button>
      ))}
    </div>
  );
  const tomorrow = shiftDay(today, 1);

  return (
    <div className={'sheet-pad ' + css.sheet}>
      <div className="label">{task ? (fromList ? 'Edit reminder' : 'Edit task') : fromList ? 'New reminder' : 'New task'}</div>
      <div className={css.titleRow}>
        <button
          className={css.emojiBtn + (picking ? ' ' + css.isOn : '')}
          aria-label={emoji ? 'Change emoji' : 'Add an emoji'}
          onClick={() => setPicking(!picking)}
        >
          {emoji || <Icon name="smile" size={30} />}
        </button>
        <input
          className={css.bigInput}
          placeholder="What needs doing?"
          value={title}
          autoFocus={!task}
          enterKeyHint="done"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
      </div>
      {fromList && (
        <div className={css.from}>
          <span>From</span>
          <b>{fromList.emoji} {fromList.title || 'Untitled list'}</b>
          <button
            className="btn btn--ghost"
            onClick={() => {
              // Off to the list: don't go back to a sheet this editor was opened from
              dismissSheet();
              openList(fromList.id);
              go('lists');
            }}
          >
            Open list
          </button>
        </div>
      )}
      {picking && (
        <div className={css.picker}>
          <EmojiPicker onPick={(e) => { setEmoji(e); setPicking(false); }} />
          {emoji && (
            <button className="btn btn--ghost" onClick={() => { setEmoji(''); setPicking(false); }}>No emoji</button>
          )}
        </div>
      )}

      <div className="label">Who</div>
      <PersonPicker
        people={taskPeople(data.people).filter((p) => p.calendar !== false)}
        everyone={data.family}
        everyoneLabel="Anyone"
        after={taskPeople(data.people).filter((p) => p.calendar === false)}
        selected={[who === 'any' ? 'family' : who]}
        onPick={(id) => setWho(id === 'family' ? 'any' : id)}
      />

      <div className="label">How often</div>
      <div className="chips">
        {OFTEN.map(([id, label]) => (
          <button key={id} className={chip(mode === id)} onClick={() => setMode(id)}>{label}</button>
        ))}
      </div>

      {mode === 'once' && (
        <div className={css.more}>
          <div className="chips">
            <button className={chip(!due)} onClick={() => setDue(null)}>Whenever</button>
            <button className={chip(due === today)} onClick={() => setDue(today)}>Today</button>
            <button className={chip(due === tomorrow)} onClick={() => setDue(tomorrow)}>Tomorrow</button>
            <button
              className={chip(!!due && due !== today && due !== tomorrow) + ' ' + css.dateChip}
              onClick={() => {
                // Opens the date picker (a tap on a hidden date field doesn't, in desktop Chrome)
                const el = dateInput.current;
                try { el?.showPicker(); } catch { el?.click(); }
              }}
            >
              {due && due !== today && due !== tomorrow ? fmtDay(due) : 'Pick a day'}
              <input
                ref={dateInput}
                type="date"
                tabIndex={-1}
                aria-hidden
                value={due ?? ''}
                min={today}
                onChange={(e) => setDue(e.target.value || null)}
              />
            </button>
          </div>
        </div>
      )}
      {canBasis && (
        <div className={css.basis}>
          <span>Repeat from</span>
          <div className="chips">
            <button className={chip(basis === 'due')} onClick={() => setBasis('due')}>The due date</button>
            <button className={chip(basis === 'done')} onClick={() => setBasis('done')}>When it’s done</button>
          </div>
        </div>
      )}
      {mode === 'weekly' && !fromDone && <div className={css.more}>{weekdays}</div>}
      {mode === 'monthly' && !fromDone && <div className={css.more}>{step('day of the month', monthDay, setMonthDay, 1, 31)}</div>}
      {mode === 'custom' && (
        <div className={css.more}>
          <div className="chips">
            {CUSTOM.map(([id, label]) => (
              <button key={id} className={chip(custom === id) + ' chip--ghost'} onClick={() => setCustom(id)}>{label}</button>
            ))}
          </div>
          {custom === 'days' && step(every === 1 ? 'day' : 'days', every, setEvery)}
          {custom === 'weeks' && (
            <>
              {step(fromDone ? (every === 1 ? 'week' : 'weeks') : every === 1 ? 'week, on' : 'weeks, on', every, setEvery, 1, 52)}
              {!fromDone && weekdays}
            </>
          )}
          {custom === 'months' && (
            <>
              {step(fromDone ? (every === 1 ? 'month' : 'months') : every === 1 ? 'month, on' : 'months, on', every, setEvery, 1, 24)}
              {!fromDone && step('day of the month', monthDay, setMonthDay, 1, 31)}
            </>
          )}
          {custom === 'nth' && (
            <>
              <div className="chips">
                {NTHS.map(([n, label]) => (
                  <button key={n} className={chip(nth === n)} onClick={() => setNth(n)}>{label}</button>
                ))}
              </div>
              <div className="chips">
                {WEEK.map(([d, label]) => (
                  <button key={d} className={chip(nthDay === d)} onClick={() => setNthDay(d)}>{label}</button>
                ))}
              </div>
              <div className="chips">
                {OFFSETS.map(([o, label]) => (
                  <button key={o} className={chip(offset === o) + ' chip--ghost'} onClick={() => setOffset(o)}>{label}</button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {repeat && <p className={css.summary}>{describeRepeat(repeat)}</p>}

      <div className="label">When</div>
      <div className="chips">
        {SLOTS.map(([id, label]) => (
          <button key={id} className={chip(slot === id)} onClick={() => setSlot(id)}>{label}</button>
        ))}
      </div>

      <label className={css.toggle}>
        <input type="checkbox" checked={!!remind} onChange={(e) => (e.target.checked ? turnOnRemind() : setRemind(null))} />
        <span>
          <b>Remind on phones</b>
          <small>{remind ? 'A notification when it’s due, unless it’s done' : 'Send a notification when it’s due'}</small>
        </span>
      </label>
      {remind && (
        <div className={css.more}>
          <div className={css.basis}>
            <span>At</span>
            <input
              className={css.time}
              type="time"
              value={remind}
              required
              onChange={(e) => e.target.value && setRemind(e.target.value)}
            />
          </div>
          <div className={css.basis}><span>Send to</span></div>
          <PersonPicker
            people={humans}
            avatarSize={44}
            selected={notify}
            onPick={(id) => setNotify((n) => (n.includes(id) ? n.filter((x) => x !== id) : [...n, id]))}
          />
          {!notify.length ? (
            <p className={css.hint}>Pick who gets the reminder.</p>
          ) : noPhone.length > 0 && (
            <p className={css.hint}>
              {noPhone.map((id) => humans.find((p) => p.id === id)?.name ?? id).join(' and ')}{' '}
              {noPhone.length === 1 ? 'hasn’t' : 'haven’t'} turned on reminders on a phone yet (Tasks → settings).
            </p>
          )}
        </div>
      )}

      <label className={css.toggle}>
        <input type="checkbox" checked={onCalendar} onChange={(e) => setOnCalendar(e.target.checked)} />
        <span>
          <b>Show on calendar</b>
          <small>On each day it’s due, where it can be checked off (not added to Google)</small>
        </span>
      </label>

      {repeat && (
        <label className={css.toggle}>
          <input type="checkbox" checked={habit} onChange={(e) => setHabit(e.target.checked)} />
          <span>
            <b>Track as a habit</b>
            <small>Keep a streak, and show it in the habits panel</small>
          </span>
        </label>
      )}

      <div className="sheet-actions">
        {task && <button className={'btn btn--ghost ' + css.delete} onClick={remove}>Delete</button>}
        <button className="btn btn--ghost" onClick={closeSheet}>Cancel</button>
        <button className="btn btn--solid" onClick={save}>{task ? 'Save' : 'Add task'}</button>
      </div>
    </div>
  );
}

/** 'YYYY-MM-DD' → "Fri, Nov 20" */
function fmtDay(day: string): string {
  const d = new Date(day + 'T12:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
