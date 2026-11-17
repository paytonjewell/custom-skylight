// One person's tasks, opened from their ring on Today: a small Tasks screen for just them. Habits,
// then tasks by part of the day (Anytime first); tap to check off, swipe right to edit, left to
// delete; arrows step to other days; the cog picks which sections show and all / to do / done tasks
// (the same settings as the Tasks screen, saved on this device). Editing a task comes back here.
import { useLayoutEffect, useRef, useState } from 'react';
import { dueOn } from '../../data/tasks';
import { useData } from '../../data/store';
import { person } from '../../data/select';
import { dayOf, shiftDay } from '../../lib/repeat';
import { useNow } from '../../lib/clock';
import { closeSheet, go, openSheet } from '../../app/ui';
import { Avatar, toneStyle } from '../../ui/people';
import { Icon } from '../../ui/Icon';
import { openTaskSheet } from './TaskSheet';
import {
  PersonList,
  SHEET_LIST,
  ShowSettings,
  dayName,
  fmtDate,
  split,
  useShowSettings,
  useTaskDragging,
  useTaskRows,
} from './Tasks';
import css from './PersonTasksSheet.module.css';

/** `who`: a person id, or 'any' for tasks anyone can do */
export function openPersonTasks(who: string): void {
  openSheet(() => <PersonTasks who={who} />);
}

function PersonTasks({ who }: { who: string }) {
  const data = useData('family', 'people', 'taskDone', 'tasks');
  const now = useNow();
  const { sections, show, filtered } = useShowSettings();
  const [offset, setOffset] = useState(0);
  const [settings, setSettings] = useState(false);
  const today = dayOf(now);
  const day = shiftDay(today, offset);
  const back = () => openPersonTasks(who);
  const { rowProps, layer: dragLayer } = useTaskRows(day, today, back);
  // While a task is dragged, empty parts of the day show up as places to drop it. Keep the sheet the
  // size it was (the list scrolls instead): it's centred, so growing would slide it from under the finger.
  const box = useRef<HTMLDivElement>(null);
  const dragging = useTaskDragging();
  /** Its height before the drag (by the time `dragging` is seen, the drop spaces are already in) */
  const settled = useRef(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (!dragging) {
      el.style.height = '';
      settled.current = el.offsetHeight;
    } else el.style.height = settled.current + 'px';
  });

  const items = dueOn(data.tasks, data.taskDone, day, today).filter((x) => x.task.who === who);
  const { tasks, done } = split(items, sections, show);
  const p = person(data, who);
  const name = who === 'any' ? 'Anyone' : p.name;
  const left = tasks.length - done;
  const summary = !tasks.length
    ? 'Nothing due'
    : offset > 0
      ? `${tasks.length} due`
      : left
        ? `${left} of ${tasks.length} left`
        : 'All done';

  return (
    // data-lane: confetti comes from here when the last task is checked off
    <div className={'sheet-pad ' + css.sheet} style={toneStyle(p)} data-lane={who} ref={box}>
      <header className={css.head}>
        <Avatar p={p} size={48} />
        <span className={css.who}>
          <b>{name}</b>
          {/* The day is in the arrows; the full date only when away from today */}
          <small>
            {offset ? fmtDate(day) + ' · ' : ''}
            {summary}
          </small>
        </span>
        <span className={css.nav}>
          <button className="icon-btn" aria-label="Previous day" onClick={() => setOffset(offset - 1)}>
            <Icon name="left" size={26} />
          </button>
          <button
            className={css.dayName}
            onClick={() => setOffset(0)}
            disabled={offset === 0}
            aria-label="Back to today"
          >
            {dayName(offset, day)}
          </button>
          <button className="icon-btn" aria-label="Next day" onClick={() => setOffset(offset + 1)}>
            <Icon name="right" size={26} />
          </button>
        </span>
        <button
          className={css.cog + (settings ? ' ' + css.isOn : '')}
          aria-label="What shows"
          aria-expanded={settings}
          onClick={() => setSettings(!settings)}
        >
          <Icon name="settings" size={24} />
          {filtered && !settings && <i className={css.cogDot} />}
        </button>
      </header>
      {settings && (
        <div className={css.settings}>
          <ShowSettings labelClass={css.settingsLabel} />
        </div>
      )}
      <div className={css.scroll}>
        <PersonList
          who={who}
          day={day}
          items={items}
          sections={sections}
          show={show}
          rowProps={rowProps}
          className={SHEET_LIST}
        />
      </div>
      {dragLayer}
      <div className="sheet-actions">
        <button
          className="btn btn--ghost"
          onClick={() => {
            closeSheet();
            go('tasks');
          }}
        >
          Tasks screen
        </button>
        <button className="btn btn--ghost" onClick={() => openTaskSheet(undefined, { who }, back)}>
          <Icon name="plus" size={20} />
          New task
        </button>
        <button className="btn btn--solid" onClick={closeSheet}>
          Done
        </button>
      </div>
    </div>
  );
}
