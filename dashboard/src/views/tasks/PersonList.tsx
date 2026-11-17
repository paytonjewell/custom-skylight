// One person's tasks for a day, as rows: a column on the Tasks screen, the person on their own
// (Detail), and their sheet from Today. Rows get what they do from useTaskRows.
import type { Data } from '../../data/types';
import { useData } from '../../data/store';
import { SLOTS, doneLate, type DueItem } from '../../data/tasks';
import { person } from '../../data/select';
import { dayOf, describeRepeat } from '../../lib/repeat';
import { fmtTime, shortDay } from '../../lib/days';
import { Icon } from '../../ui/Icon';
import { toneStyle } from '../../ui/people';
import { SwipeRow, deleteAction, editAction, laterAction } from '../../ui/SwipeRow';
import { type DoneView, showing, split } from './settings';
import { type RowProps, useTaskDragging } from './useTaskRows';
import css from './Tasks.module.css';

/** Rows on a sheet, which is paper-coloured: cards stand out on it (PersonTasksSheet) */
export const SHEET_LIST = css.sheetList;

interface ListProps {
  who: string;
  day: string;
  items: DueItem[];
  sections: string[] | null;
  show: DoneView;
  rowProps: (x: DueItem) => RowProps;
}

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
}: ListProps & { className?: string }) {
  const { tasks, all, shownTasks, shownHabits: habits } = split(items, sections, show);
  const dragging = useTaskDragging();
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
export function Detail({
  data,
  who,
  day,
  items,
  sections,
  show,
  rowProps,
}: ListProps & { data: Pick<Data, 'people' | 'family'> }) {
  const p = person(data, who);
  const { tasks, all, shownTasks, shownHabits: habits } = split(items, sections, show);
  const dragging = useTaskDragging();
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

/** SwipeRow's props for a task or habit row: Edit behind the start; Delete (and Later) behind the end */
function swipeRowProps(title: string, r: Omit<RowProps, 'checking' | 'streak'>) {
  return {
    open: r.open,
    onOpenChange: r.onOpenChange,
    onTap: r.onTap,
    disabled: r.lifted,
    start: [editAction(title, r.onEdit)],
    end: [deleteAction(title, r.onDelete), ...(r.onLater ? [laterAction(title, r.onLater)] : [])],
    rowProps: { ...r.drag, 'data-drop': r.drop, 'data-drop-sides': r.drop ? '' : undefined },
  };
}

function TaskRow({ x, viewing, checking, streak: _streak, ...swipe }: { x: DueItem; viewing: string } & RowProps) {
  const t = x.task;
  const done = !!x.done || checking;
  const today = dayOf(new Date());
  // A reminder from a list item names the list
  const list = useData('lists').lists.find((l) => l.id === t.listId);
  const sub = x.overdue ? (
    <span className={css.late}>Overdue · {shortDay(x.day, today)}</span>
  ) : x.done && doneLate(x) ? (
    viewing === x.day ? (
      <>Done late · on {shortDay(dayOf(new Date(x.done.at)), today)}</>
    ) : (
      <>Done late · was due {shortDay(x.day, today)}</>
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
      {...swipeRowProps(t.title, swipe)}
      className={
        (done ? css.isDone : '') + (x.overdue ? ' ' + css.isOverdue : '') + (swipe.lifted ? ' ' + css.lifted : '')
      }
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
      {...swipeRowProps(t.title, swipe)}
      className={(done ? css.isDone : '') + (swipe.lifted ? ' ' + css.lifted : '')}
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
