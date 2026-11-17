// Tasks API: tasks and when they were done (D1: tasks, task_done). Ids are made by the app, so
// changes show at once there and are saved here in the background, one at a time.
import type { Slot, Task, TaskDone } from '../src/data/types';
import { isDay, parseRepeat } from '../src/lib/repeat';
import { bad, done, json, notFound, now, readJson } from './http';
import { ID, PERSON } from './validate';

const MAX_TITLE = 200;
const MAX_EMOJI = 16;
const MAX_DONE = 5000;
/** How far back completions are sent to the app (habit heatmaps show a year) */
const HISTORY_DAYS = 400;
const SLOTS: Slot[] = ['morning', 'afternoon', 'evening', 'anytime'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

interface TaskRow {
  id: string;
  title: string;
  emoji: string;
  who: string;
  repeat: string | null;
  due: string | null;
  slot: Slot;
  time: string | null;
  habit: number;
  on_calendar: number;
  remind: string | null;
  notify: string;
  list_id: string | null;
  list_item_id: string | null;
  created_at: string;
  position: number | null;
}
interface DoneRow {
  task_id: string;
  day: string;
  done_at: string;
  done_by: string | null;
}

const toTask = (r: TaskRow): Task => ({
  id: r.id,
  title: r.title,
  emoji: r.emoji,
  who: r.who,
  repeat: r.repeat ? JSON.parse(r.repeat) : null,
  due: r.due,
  slot: r.slot,
  time: r.time,
  habit: !!r.habit,
  onCalendar: !!r.on_calendar,
  remind: r.remind,
  notify: JSON.parse(r.notify),
  listId: r.list_id,
  listItemId: r.list_item_id,
  created: r.created_at,
  ...(r.position != null ? { position: r.position } : {}),
});
const toDone = (r: DoneRow): TaskDone => ({ task: r.task_id, day: r.day, at: r.done_at, by: r.done_by });

const loaded = (tasks: D1Result, rows: D1Result) => ({
  tasks: (tasks.results as unknown as TaskRow[]).map(toTask),
  done: (rows.results as unknown as DoneRow[]).map(toDone),
});

/** Tasks and their completions from about the last year */
async function loadTasks(env: Env): Promise<{ tasks: Task[]; done: TaskDone[] }> {
  const since = new Date(Date.now() - HISTORY_DAYS * 864e5).toISOString().slice(0, 10);
  const [tasks, rows] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM tasks ORDER BY created_at'),
    env.DB.prepare('SELECT task_id, day, done_at, done_by FROM task_done WHERE day >= ? ORDER BY done_at').bind(since),
  ]);
  return loaded(tasks, rows);
}

/**
 * Tasks with a reminder, and just the completions that decide whether one is due now (worker/push.ts
 * dueReminders, through src/data/tasks.ts dueItem), which looks at: a completion for today or
 * yesterday (in any time zone), one checked off in the last day or so whatever day it was for, and
 * the latest one (afterDone repeats count from it; a one-off is finished by any). So: the last few
 * days' rows plus each task's latest, instead of a year of history every minute.
 */
export async function loadReminders(env: Env, at = new Date()): Promise<{ tasks: Task[]; done: TaskDone[] }> {
  const recent = new Date(at.getTime() - 3 * 864e5).toISOString();
  const [tasks, rows] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM tasks WHERE remind IS NOT NULL ORDER BY created_at'),
    env.DB.prepare(
      `SELECT task_id, day, done_at, done_by FROM task_done d
       WHERE task_id IN (SELECT id FROM tasks WHERE remind IS NOT NULL)
         AND (day >= ? OR done_at >= ? OR day = (SELECT MAX(day) FROM task_done m WHERE m.task_id = d.task_id))
       ORDER BY done_at`,
    ).bind(recent.slice(0, 10), recent),
  ]);
  return loaded(tasks, rows);
}

/** GET /api/tasks: { tasks, done } */
export async function getTasks(env: Env): Promise<Response> {
  return json(await loadTasks(env));
}

/** Task fields from the app, checked. `partial` allows any subset (for edits). */
function fields(v: unknown, partial: boolean): Partial<Task> | null {
  const b = v as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') return null;
  const out: Partial<Task> = {};
  const has = (k: string) => b[k] !== undefined;
  const need = (k: string) => has(k) || partial;
  if (!need('title') || !need('who') || !need('slot')) return null;
  if (has('title')) {
    if (typeof b.title !== 'string' || !b.title.trim() || b.title.length > MAX_TITLE) return null;
    out.title = b.title.trim();
  }
  if (has('emoji')) {
    if (typeof b.emoji !== 'string' || b.emoji.length > MAX_EMOJI) return null;
    out.emoji = b.emoji;
  }
  if (has('who')) {
    if (typeof b.who !== 'string' || !PERSON.test(b.who)) return null;
    out.who = b.who;
  }
  if (has('repeat')) {
    if (b.repeat === null) out.repeat = null;
    else if (!(out.repeat = parseRepeat(b.repeat))) return null;
  }
  if (has('due')) {
    if (b.due !== null && !isDay(b.due)) return null;
    out.due = b.due as string | null;
  }
  if (has('slot')) {
    if (!SLOTS.includes(b.slot as Slot)) return null;
    out.slot = b.slot as Slot;
  }
  for (const k of ['time', 'remind'] as const) {
    if (!has(k)) continue;
    if (b[k] !== null && !(typeof b[k] === 'string' && TIME.test(b[k]))) return null;
    out[k] = b[k] as string | null;
  }
  for (const k of ['habit', 'onCalendar'] as const) {
    if (!has(k)) continue;
    if (typeof b[k] !== 'boolean') return null;
    out[k] = b[k];
  }
  for (const k of ['listId', 'listItemId'] as const) {
    if (!has(k)) continue;
    if (b[k] !== null && !(typeof b[k] === 'string' && ID.test(b[k]))) return null;
    out[k] = b[k] as string | null;
  }
  if (has('position')) {
    if (b.position !== null && !(typeof b.position === 'number' && Number.isFinite(b.position))) return null;
    out.position = b.position as number | null;
  }
  if (has('notify')) {
    const n = b.notify;
    if (!Array.isArray(n) || n.length > 10 || !n.every((p) => typeof p === 'string' && PERSON.test(p))) return null;
    out.notify = [...new Set(n as string[])];
  }
  return out;
}

/** A completion from the app, checked */
function doneRow(v: unknown): Pick<TaskDone, 'day' | 'at' | 'by'> | null {
  const d = v as Partial<TaskDone> | null;
  if (!d || !isDay(d.day) || typeof d.at !== 'string' || isNaN(Date.parse(d.at))) return null;
  if (d.by != null && !(typeof d.by === 'string' && PERSON.test(d.by))) return null;
  return { day: d.day, at: new Date(d.at).toISOString(), by: d.by ?? null };
}

const insertDone = (env: Env, id: string, d: Pick<TaskDone, 'day' | 'at' | 'by'>) =>
  env.DB.prepare('INSERT OR REPLACE INTO task_done (task_id, day, done_at, done_by) VALUES (?, ?, ?, ?)').bind(
    id,
    d.day,
    d.at,
    d.by,
  );

/**
 * POST /api/tasks ({ id, ...task, done? }): a new task. `done` (its completions) comes with it when
 * a deleted task is brought back with Undo.
 */
export async function addTask(req: Request, env: Env): Promise<Response> {
  const b = await readJson<Record<string, unknown>>(req);
  const f = fields(b, false);
  if (!b || !f || typeof b.id !== 'string' || !ID.test(b.id)) return bad('Expected a task');
  const raw = b.done ?? [];
  if (!Array.isArray(raw) || raw.length > MAX_DONE) return bad('Bad done');
  const rows = raw.map(doneRow);
  if (rows.some((r) => !r)) return bad('Bad done');
  const at = now();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO tasks (id, title, emoji, who, repeat, due, slot, time, habit, on_calendar, remind, notify, list_id, list_item_id, created_at, updated_at, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        b.id,
        f.title,
        f.emoji ?? '',
        f.who,
        f.repeat ? JSON.stringify(f.repeat) : null,
        f.due ?? null,
        f.slot,
        f.time ?? null,
        f.habit ? 1 : 0,
        f.onCalendar ? 1 : 0,
        f.remind ?? null,
        JSON.stringify(f.notify ?? []),
        f.listId ?? null,
        f.listItemId ?? null,
        typeof b.created === 'string' && !isNaN(Date.parse(b.created)) ? new Date(b.created).toISOString() : at,
        at,
        f.position ?? null,
      ),
      ...rows.map((r) => insertDone(env, b.id as string, r!)),
    ]);
  } catch (e) {
    if (String(e).includes('UNIQUE')) return bad('Already exists', 409);
    throw e;
  }
  return json({ ok: true }, 201);
}

const COLUMNS: Record<string, [string, (v: never) => unknown]> = {
  title: ['title', (v) => v],
  emoji: ['emoji', (v) => v],
  who: ['who', (v) => v],
  repeat: ['repeat', (v) => (v ? JSON.stringify(v) : null)],
  due: ['due', (v) => v],
  slot: ['slot', (v) => v],
  time: ['time', (v) => v],
  habit: ['habit', (v) => (v ? 1 : 0)],
  onCalendar: ['on_calendar', (v) => (v ? 1 : 0)],
  remind: ['remind', (v) => v],
  notify: ['notify', (v) => JSON.stringify(v)],
  listId: ['list_id', (v) => v],
  listItemId: ['list_item_id', (v) => v],
  position: ['position', (v) => v],
};

/** PATCH /api/tasks/:id (any task fields) */
export async function editTask(req: Request, env: Env, id: string): Promise<Response> {
  const f = fields(await readJson(req), true);
  const keys = f ? Object.keys(f) : [];
  if (!f || !keys.length) return bad('Expected task fields');
  const sets = keys.map((k) => COLUMNS[k][0] + ' = ?').join(', ');
  const values = keys.map((k) => COLUMNS[k][1](f[k as keyof Task] as never));
  const { meta } = await env.DB.prepare(`UPDATE tasks SET ${sets}, updated_at = ? WHERE id = ?`)
    .bind(...values, now(), id)
    .run();
  return meta.changes ? done() : notFound('No such task');
}

/** DELETE /api/tasks/:id (and its history) */
export async function deleteTask(env: Env, id: string): Promise<Response> {
  const [, gone] = await env.DB.batch([
    env.DB.prepare('DELETE FROM task_done WHERE task_id = ?').bind(id),
    env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id),
  ]);
  return gone.meta.changes ? done() : notFound('No such task');
}

/** PUT /api/tasks/:id/done/:day ({ at, by? }): mark done for that due day */
export async function markDone(req: Request, env: Env, id: string, day: string): Promise<Response> {
  const b = await readJson<Record<string, unknown>>(req);
  const d = doneRow({ ...b, day });
  if (!d) return bad('Expected { at, by? }');
  if (!(await env.DB.prepare('SELECT 1 FROM tasks WHERE id = ?').bind(id).first())) return notFound('No such task');
  await insertDone(env, id, d).run();
  return done();
}

/** DELETE /api/tasks/:id/done/:day: not done after all */
export async function unmarkDone(env: Env, id: string, day: string): Promise<Response> {
  await env.DB.prepare('DELETE FROM task_done WHERE task_id = ? AND day = ?').bind(id, day).run();
  return done();
}
