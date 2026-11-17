// One person's tasks for today, opened from their ring on Today: tap a task to check it off (or back
// on). Habits aren't listed, as they aren't counted in the rings. "All tasks" opens the Tasks screen.
import type { DueItem } from '../../data/tasks';
import { dueToday } from '../../data/tasks';
import { useData } from '../../data/store';
import { person } from '../../data/select';
import { setTaskDone } from '../../data/actions';
import { describeRepeat, dayOf } from '../../lib/repeat';
import { useNow } from '../../lib/clock';
import { closeSheet, go, openSheet, toast } from '../../app/ui';
import { Avatar, toneStyle } from '../../ui/people';
import { EmptyNote } from '../../ui/EmptyNote';
import css from './PersonTasksSheet.module.css';

/** `who`: a person id, or 'any' for tasks anyone can do */
export function openPersonTasks(who: string): void {
  openSheet(() => <PersonTasks who={who} />);
}

function PersonTasks({ who }: { who: string }) {
  const data = useData();
  const now = useNow();
  const list = dueToday(data.tasks, data.taskDone, dayOf(now)).filter((x) => !x.task.habit && x.task.who === who);
  const p = person(data, who);
  const name = who === 'any' ? 'Anyone' : p.name;
  const left = list.filter((x) => !x.done).length;

  const tap = (x: DueItem) => {
    if (x.done) return setTaskDone(x.task.id, x.day, false);
    setTaskDone(x.task.id, x.day, true, who === 'any' ? null : who);
    toast(<><b>{x.task.title}</b> done</>, { icon: 'check', undo: () => setTaskDone(x.task.id, x.day, false) });
  };

  return (
    <div className={'sheet-pad ' + css.sheet} style={toneStyle(p)}>
      <header className={css.head}>
        <Avatar p={p} size={48} />
        <span className={css.who}>
          <b>{name}</b>
          <small>{list.length ? (left ? `${left} of ${list.length} left today` : 'All done today') : 'Nothing today'}</small>
        </span>
      </header>
      {list.length ? (
        <ul className={css.list}>
          {list.map((x) => (
            <li key={x.task.id + x.day}>
              <button className={css.row + (x.done ? ' ' + css.isDone : '') + (x.overdue ? ' ' + css.isOverdue : '')} onClick={() => tap(x)}>
                {/* As on the Tasks screen: the emoji on a tinted square, which fills and ticks when done */}
                <span className={css.mark}>
                  {x.task.emoji}
                  <span className={css.check}>
                    <svg viewBox="0 0 24 24" width="24" height="24"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
                  </span>
                </span>
                <span className={css.text}>
                  <b>{x.task.title}</b>
                  {(x.overdue || x.task.repeat) && (
                    <small>{x.overdue ? 'Overdue' : describeRepeat(x.task.repeat!)}</small>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyNote className={css.empty}>
          <i>Nothing</i> for {name} today
        </EmptyNote>
      )}
      <div className="sheet-actions">
        <button className="btn btn--ghost" onClick={() => { closeSheet(); go('tasks'); }}>All tasks</button>
        <button className="btn btn--solid" onClick={closeSheet}>Done</button>
      </div>
    </div>
  );
}
