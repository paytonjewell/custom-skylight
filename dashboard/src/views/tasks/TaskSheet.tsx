// Add or edit a task: what, who, how often, when in the day, and whether it's a habit. The common
// repeats are one tap (Once, Daily, Weekdays, Weekly, Monthly); the rest (every few days, weeks or
// months; the 1st Thursday, or the day before it) are under Custom. Repeats can count from the due
// date (the calendar) or from when it was last done ("1 week after it's done").
import { Chip, DateChip } from '../../ui/Chip';
import { useState } from 'react';
import type { Slot, Task } from '../../data/types';
import { useData } from '../../data/store';
import { addTask, deleteTask, editTask, restoreTask, type TaskFields } from '../../data/actions';
import { SLOTS } from '../../data/tasks';
import { dayOf, describeRepeat, shiftDay } from '../../lib/repeat';
import { now as clockNow } from '../../lib/clock';
import { fmtDateShort } from '../../lib/days';
import { peopleWithPhones, usePush } from '../../data/push';
import { closeSheet, dismissSheet, go, openSheet, toast } from '../../app/ui';
import { openList } from '../lists/Lists';
import { PersonPicker } from '../../ui/PersonPicker';
import { EmojiTitle } from '../../ui/EmojiTitle';
import { RepeatPicker } from './RepeatPicker';
import { toControls, toRepeat } from './repeatControls';
import css from './TaskSheet.module.css';
import { phonePeople } from '../../data/select';
import { taskPickerPeople } from './settings';

/** A reminder's time when it's first turned on, by part of the day */
const REMIND_AT: Record<Slot, string> = { morning: '08:00', afternoon: '13:00', evening: '18:00', anytime: '09:00' };

/** `back`: what to reopen once the editor closes (saved, cancelled or deleted), e.g. a person's sheet */
export function openTaskSheet(task?: Task, defaults?: Partial<TaskFields>, back?: () => void): void {
  openSheet(() => <TaskSheet task={task} defaults={defaults} />, { cls: 'sheet--wide', onClose: back });
}

function TaskSheet({ task, defaults }: { task?: Task; defaults?: Partial<TaskFields> }) {
  const data = useData('family', 'lists', 'people');
  const [today] = useState(() => dayOf(clockNow()));

  const [title, setTitle] = useState(task?.title ?? defaults?.title ?? '');
  const [who, setWho] = useState(task?.who ?? defaults?.who ?? 'any');
  const [due, setDue] = useState<string | null>(task?.due ?? defaults?.due ?? null);
  const [often, setOften] = useState(() => toControls(task?.repeat ?? null, today));
  const [slot, setSlot] = useState<Slot>(task?.slot ?? defaults?.slot ?? 'anytime');
  const [habit, setHabit] = useState(task?.habit ?? defaults?.habit ?? false);
  const [emoji, setEmoji] = useState(task?.emoji ?? defaults?.emoji ?? '');
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

  const repeat = toRepeat(often, today);

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
    toast(
      <>
        Added <b>{t.title}</b>
      </>,
      { icon: 'check', undo: () => deleteTask(t.id) },
    );
  };

  const remove = () => {
    if (!task) return;
    closeSheet();
    const gone = deleteTask(task.id);
    if (gone)
      toast(
        <>
          Deleted <b>{task.title}</b>
        </>,
        { icon: 'trash', undo: () => restoreTask(gone.task, gone.done) },
      );
  };

  const tomorrow = shiftDay(today, 1);

  return (
    <div className={'sheet-pad ' + css.sheet}>
      <div className="label">
        {task ? (fromList ? 'Edit reminder' : 'Edit task') : fromList ? 'New reminder' : 'New task'}
      </div>
      <EmojiTitle
        emoji={emoji}
        onEmoji={setEmoji}
        clearable
        title={title}
        onTitle={setTitle}
        placeholder="What needs doing?"
        autoFocus={!task}
      />
      {fromList && (
        <div className={css.from}>
          <span>From</span>
          <b>
            {fromList.emoji} {fromList.title || 'Untitled list'}
          </b>
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

      <div className="label">Who</div>
      <PersonPicker
        {...taskPickerPeople(data)}
        everyone={data.family}
        everyoneLabel="Anyone"
        selected={[who === 'any' ? 'family' : who]}
        onPick={(id) => setWho(id === 'family' ? 'any' : id)}
      />

      <RepeatPicker value={often} onChange={setOften} />
      {/* A one-off's due day */}
      {!repeat && (
        <div className={css.more}>
          <div className="chips">
            <Chip on={!due} onClick={() => setDue(null)}>
              Whenever
            </Chip>
            <Chip on={due === today} onClick={() => setDue(today)}>
              Today
            </Chip>
            <Chip on={due === tomorrow} onClick={() => setDue(tomorrow)}>
              Tomorrow
            </Chip>
            <DateChip
              on={!!due && due !== today && due !== tomorrow}
              value={due ?? ''}
              min={today}
              onChange={(v) => setDue(v || null)}
            >
              {due && due !== today && due !== tomorrow ? fmtDateShort(due) : 'Pick a day'}
            </DateChip>
          </div>
        </div>
      )}
      {repeat && <p className={css.summary}>{describeRepeat(repeat)}</p>}

      <div className="label">When</div>
      <div className="chips">
        {SLOTS.map(([id, label]) => (
          <Chip key={id} on={slot === id} onClick={() => setSlot(id)}>
            {label}
          </Chip>
        ))}
      </div>

      <label className={css.toggle}>
        <input
          type="checkbox"
          checked={!!remind}
          onChange={(e) => (e.target.checked ? turnOnRemind() : setRemind(null))}
        />
        <span>
          <b>Remind on phones</b>
          <small>
            {remind ? 'A notification when it’s due, unless it’s done' : 'Send a notification when it’s due'}
          </small>
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
          <div className={css.basis}>
            <span>Send to</span>
          </div>
          <PersonPicker
            people={humans}
            avatarSize={44}
            selected={notify}
            onPick={(id) => setNotify((n) => (n.includes(id) ? n.filter((x) => x !== id) : [...n, id]))}
          />
          {!notify.length ? (
            <p className={css.hint}>Pick who gets the reminder.</p>
          ) : (
            noPhone.length > 0 && (
              <p className={css.hint}>
                {noPhone.map((id) => humans.find((p) => p.id === id)?.name ?? id).join(' and ')}{' '}
                {noPhone.length === 1 ? 'hasn’t' : 'haven’t'} turned on reminders on a phone yet (Tasks → settings).
              </p>
            )
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
        {task && (
          <button className={'btn btn--ghost ' + css.delete} onClick={remove}>
            Delete
          </button>
        )}
        <button className="btn btn--ghost" onClick={closeSheet}>
          Cancel
        </button>
        <button className="btn btn--solid" onClick={save}>
          {task ? 'Save' : 'Add task'}
        </button>
      </div>
    </div>
  );
}
