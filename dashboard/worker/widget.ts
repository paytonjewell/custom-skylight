// The phone app's Tasks widget (TasksWidget.java): one person's list for today, worked out here with the
// same rules as the Tasks screen (src/data/tasks.ts) so the widget only has to draw it.
import type { Task, WidgetTask, WidgetTasks } from '../src/data/types';
import { SLOTS, dueOn, type DueItem } from '../src/data/tasks';
import { describeRepeat } from '../src/lib/repeat';
import { fmtTime, shortDay } from '../src/lib/days';
import { family } from './home';
import { bad, json } from './http';
import { localNow } from './push';
import { loadTasks } from './tasks';
import { validTz } from './validate';

/** GET /api/widget/tasks?person=<id or 'any'> */
export async function getWidgetTasks(env: Env, url: URL): Promise<Response> {
  const who = url.searchParams.get('person') ?? '';
  const p =
    who === 'any' ? { id: 'any', name: 'Anyone', tone: 0 } : family(env).find((x) => x.id === who && x.tasks !== false);
  if (!p) return bad('No such person', 404);

  const tz = validTz(env.HOME_TZ) ? env.HOME_TZ : 'UTC';
  const today = localNow(tz).day;
  const [{ tasks, done }, lists] = await Promise.all([
    loadTasks(env),
    env.DB.prepare('SELECT id, title, emoji FROM lists').all<{ id: string; title: string; emoji: string }>(),
  ]);
  // The rules ask which day a task was checked off on, in the Worker's own zone (UTC). Pin each
  // completion to midday of its day at home, so that comes out as the household's day.
  const local = done.map((d) => ({ ...d, at: `${localNow(tz, new Date(d.at)).day}T12:00:00.000Z` }));
  const items = dueOn(
    tasks.filter((t) => t.who === p.id),
    local,
    today,
    today,
  );
  const listNames = new Map(
    lists.results.map((l) => [l.id, [l.emoji, l.title || 'Untitled list'].filter(Boolean).join(' ')]),
  );

  const row = (x: DueItem): WidgetTask => ({
    id: x.task.id,
    title: x.task.title,
    emoji: x.task.emoji,
    done: !!x.done,
    overdue: x.overdue,
    note: note(x, today, listNames),
  });
  const groups = [
    { label: 'Habits', items: items.filter((x) => x.task.habit) },
    ...SLOTS.map(([slot, label]) => ({ label, items: items.filter((x) => !x.task.habit && x.task.slot === slot) })),
  ]
    .filter((g) => g.items.length)
    .map((g) => ({ label: g.label, items: g.items.map(row) }));

  return json<WidgetTasks>({
    person: { id: p.id, name: p.name, tone: p.tone },
    day: today,
    done: items.filter((x) => x.done).length,
    total: items.length,
    groups,
  });
}

/** The line under a task's title, as its row on the Tasks screen shows it (src/views/tasks/PersonList.tsx) */
function note(x: DueItem, today: string, lists: Map<string, string>): string {
  const t: Task = x.task;
  const sub = x.overdue
    ? `Overdue · ${shortDay(x.day, today)}`
    : t.repeat
      ? describeRepeat(t.repeat)
      : t.listId
        ? (lists.get(t.listId) ?? '')
        : '';
  const at = t.remind && !x.done ? fmtTime(t.remind) : '';
  return [sub, at].filter(Boolean).join(' · ');
}
