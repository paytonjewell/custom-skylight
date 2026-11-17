// Habits: one card per habit with its streak, best streak, last-30-days rate and a heatmap of the
// past year (about four months on phones), for the people shown. Done today can be ticked here too.
import type { Data, Task, TaskDone } from '../../data/types';
import { setTaskDone } from '../../data/actions';
import { doneByTask, dueItem } from '../../data/tasks';
import { habitStats, type Cell } from '../../data/habits';
import { person, laneName } from '../../data/select';
import { describeRepeat, shiftDay, weekdayOf } from '../../lib/repeat';
import { useLayout } from '../../app/layout';
import { Avatar, toneStyle } from '../../ui/people';
import { Icon } from '../../ui/Icon';
import { openTaskSheet } from './TaskSheet';
import css from './Habits.module.css';

const WEEKS = { frame: 53, phone: 18 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function Habits({
  data,
  people,
  today,
}: {
  data: Pick<Data, 'tasks' | 'taskDone' | 'people' | 'family' | 'lists'>;
  people: string[];
  today: string;
}) {
  const layout = useLayout();
  const by = doneByTask(data.taskDone);
  const habits = data.tasks.filter((t) => t.habit && people.includes(t.who));
  if (!habits.length) {
    return <p className={css.empty}>No habits yet. Turn on “Track as a habit” on a repeating task.</p>;
  }
  // Heatmap columns are weeks (Monday first), ending with this week
  const weeks = WEEKS[layout];
  const start = shiftDay(today, -((weekdayOf(today) + 6) % 7) - (weeks - 1) * 7);
  return (
    <div className={css.habits} data-scroll-top>
      {people.flatMap((who) =>
        habits
          .filter((t) => t.who === who)
          .map((t) => (
            <HabitCard
              key={t.id}
              data={data}
              t={t}
              rows={by.get(t.id) ?? []}
              today={today}
              start={start}
              weeks={weeks}
            />
          )),
      )}
    </div>
  );
}

function HabitCard({
  data,
  t,
  rows,
  today,
  start,
  weeks,
}: {
  data: Pick<Data, 'tasks' | 'taskDone' | 'people' | 'family' | 'lists'>;
  t: Task;
  rows: TaskDone[];
  today: string;
  start: string;
  weeks: number;
}) {
  const p = person(data, t.who);
  const s = habitStats(t, rows, today, shiftDay(today, -400));
  const now = dueItem(t, rows, today, today);
  const doneToday = !!now?.done;
  const days = Array.from({ length: weeks * 7 }, (_, i) => shiftDay(start, i));
  return (
    <section className={css.card + ' surface'} style={toneStyle(p)}>
      <header className={css.head}>
        {t.emoji && <span className={css.emoji}>{t.emoji}</span>}
        <div className={css.name}>
          <b>{t.title}</b>
          <small>
            <Avatar p={p} size={20} />
            {laneName(data, t.who)} · {t.repeat ? describeRepeat(t.repeat) : ''}
          </small>
        </div>
        {now && (
          <button
            className={'btn ' + (doneToday ? css.doneBtn : 'btn--ghost')}
            onClick={() => setTaskDone(t.id, now.day, !doneToday, t.who === 'any' ? null : t.who)}
          >
            <Icon name="check" size={20} />
            {doneToday ? 'Done today' : 'Mark done'}
          </button>
        )}
        <button className={'icon-btn ' + css.edit} aria-label={'Edit ' + t.title} onClick={() => openTaskSheet(t)}>
          <Icon name="edit" size={20} />
        </button>
      </header>
      <div className={css.body}>
        <dl className={css.stats}>
          <div>
            <dt>
              <Icon name="flame" size={18} /> Streak
            </dt>
            <dd className="num">{s.current}</dd>
          </div>
          <div>
            <dt>Best</dt>
            <dd className="num">{s.best}</dd>
          </div>
          <div>
            <dt>Last 30 days</dt>
            <dd className="num">{s.rate === null ? '–' : Math.round(s.rate * 100) + '%'}</dd>
          </div>
        </dl>
        <div className={css.map}>
          <div className={css.months} style={{ gridTemplateColumns: `repeat(${weeks}, var(--cell))` }}>
            {Array.from({ length: weeks }, (_, w) => {
              const first = shiftDay(start, w * 7);
              const prev = shiftDay(first, -7);
              // Label a week when its Monday starts a new month (and the first column)
              return (
                <span key={first}>
                  {w === 0 || first.slice(5, 7) !== prev.slice(5, 7) ? MONTHS[Number(first.slice(5, 7)) - 1] : ''}
                </span>
              );
            })}
          </div>
          <div
            className={css.grid}
            style={{ gridTemplateColumns: `repeat(${weeks}, var(--cell))` }}
            role="img"
            aria-label={`${t.title}: ${s.current} in a row, best ${s.best}`}
          >
            {days.map((d) => (
              <i key={d} className={d > today ? css.future : css[cellClass(s.cells.get(d))]} title={d} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const cellClass = (c: Cell | undefined): 'done' | 'missed' | 'due' | 'off' => c ?? 'off';
