// All tasks: every task for the people shown, not just what's due on one day: monthly meds, "1 week
// after it's done", one-offs with a date later on. Grouped by person, soonest first, with when each
// is next due. Tap (or swipe right) to edit; swipe left to delete.
import { useState } from 'react';
import type { Data, Task } from '../../data/types';
import { deleteTask, restoreTask } from '../../data/actions';
import { doneByTask, nextDue, type NextDue } from '../../data/tasks';
import { person } from '../../data/select';
import { dayDiff, describeRepeat } from '../../lib/repeat';
import { toast } from '../../app/ui';
import { Avatar, toneStyle } from '../../ui/people';
import { Icon } from '../../ui/Icon';
import { SwipeRow, deleteAction, editAction } from '../../ui/SwipeRow';
import type { SwipeSide } from '../../ui/useSwipeReveal';
import { openTaskSheet } from './TaskSheet';
import css from './AllTasks.module.css';

export function AllTasks({
  data,
  people,
  today,
}: {
  data: Pick<Data, 'tasks' | 'taskDone' | 'people' | 'family' | 'lists'>;
  people: string[];
  today: string;
}) {
  const [swiped, setSwiped] = useState<{ id: string; side: SwipeSide } | null>(null);
  const by = doneByTask(data.taskDone);
  const rows = data.tasks.map((t) => ({ t, next: nextDue(t, by.get(t.id) ?? [], today) }));
  // Overdue, then soonest; no date after dated; done one-offs last
  const rank = (n: NextDue) => (n.done ? 3 : n.overdue ? 0 : n.day ? 1 : 2);
  rows.sort(
    (a, b) =>
      rank(a.next) - rank(b.next) ||
      (a.next.day ?? '').localeCompare(b.next.day ?? '') ||
      a.t.title.localeCompare(b.t.title),
  );

  const remove = (t: Task) => {
    const gone = deleteTask(t.id);
    if (gone)
      toast(
        <>
          Deleted <b>{t.title}</b>
        </>,
        { icon: 'trash', undo: () => restoreTask(gone.task, gone.done) },
      );
  };

  const groups = people.map((who) => ({ who, list: rows.filter((r) => r.t.who === who) })).filter((g) => g.list.length);
  if (!groups.length) return <p className={css.empty}>No tasks yet. Add one with “New task”.</p>;
  return (
    <div className={css.all} data-scroll-top>
      {groups.map(({ who, list }) => {
        const p = person(data, who);
        return (
          <section key={who} className={css.group} style={toneStyle(p)}>
            <header className={css.head}>
              <Avatar p={p} size={36} />
              <b>{who === 'any' ? 'Anyone' : p.name}</b>
              <span>
                {list.length} {list.length === 1 ? 'task' : 'tasks'}
              </span>
            </header>
            {list.map(({ t, next }) => (
              <SwipeRow
                key={t.id}
                open={swiped?.id === t.id ? swiped.side : null}
                onOpenChange={(side) => setSwiped(side ? { id: t.id, side } : null)}
                onTap={() => openTaskSheet(t)}
                start={[editAction(t.title, () => openTaskSheet(t))]}
                end={[deleteAction(t.title, () => remove(t))]}
                className={next.done ? css.isDone : ''}
                slideClass={css.row + (t.emoji ? '' : ' ' + css.plain)}
              >
                {t.emoji && <span className={css.mark}>{t.emoji}</span>}
                <span className={css.text}>
                  <b>{t.title}</b>
                  <small>
                    {t.repeat ? (
                      <>
                        <Icon name="refresh" size={13} />
                        {describeRepeat(t.repeat)}
                      </>
                    ) : (
                      'Once'
                    )}
                    {listName(data, t) && (
                      <>
                        {' '}
                        · <Icon name="bell" size={13} />
                        {listName(data, t)}
                      </>
                    )}
                    {t.habit && <span className={css.tag}>Habit</span>}
                  </small>
                </span>
                <span className={css.when + (next.overdue ? ' ' + css.late : '')}>{whenText(next, today)}</span>
              </SwipeRow>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/** "Today", "Tomorrow", "Thu", "Nov 24", "Overdue · Nov 4", "Whenever", "Done" */
export function whenText(n: NextDue, today: string): string {
  if (n.done) return 'Done';
  if (!n.day) return 'Whenever';
  const d = new Date(n.day + 'T12:00:00');
  const days = dayDiff(today, n.day);
  const label =
    days === 0
      ? 'Today'
      : days === 1
        ? 'Tomorrow'
        : days > 1 && days < 7
          ? d.toLocaleDateString(undefined, { weekday: 'long' })
          : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return n.overdue ? `Overdue · ${label}` : label;
}

/** "🎄 Xmas list" for a reminder made from a list item (if the list still exists) */
function listName(data: Pick<Data, 'lists'>, t: Task): string | null {
  const l = data.lists.find((x) => x.id === t.listId);
  return l ? `${l.emoji} ${l.title || 'Untitled list'}` : null;
}
