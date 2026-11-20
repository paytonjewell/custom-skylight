// The phone app's Tasks widget (worker/widget.ts): one person's tasks for today, grouped as the Tasks
// screen groups them
import { describe, expect, test } from 'vitest';
import type { WidgetTasks } from '../../src/data/types';
import { localNow } from '../../worker/push';
import { client, signIn } from './helpers';

const base = {
  emoji: '',
  due: null,
  time: null,
  habit: false,
  onCalendar: false,
  remind: null,
  notify: [],
  listId: null,
  listItemId: null,
  created: '2026-11-01T12:00:00.000Z',
};

describe('tasks widget', () => {
  test('a person’s tasks for today, habits first, then by part of the day', async () => {
    const api = client(await signIn('203.0.113.90'));
    const today = localNow('America/Chicago').day;
    const daily = { kind: 'daily', start: '2026-01-01' };
    const add = (t: Record<string, unknown>) => api('POST', '/api/tasks', { ...base, ...t });
    await add({ id: 'wtask001', title: 'Feed the cat', emoji: '🐱', who: 'john', repeat: daily, slot: 'morning' });
    await add({ id: 'wtask002', title: 'Stretch', who: 'john', repeat: daily, slot: 'anytime', habit: true });
    await add({
      id: 'wtask003',
      title: 'Mail the letter',
      who: 'john',
      repeat: null,
      slot: 'anytime',
      remind: '09:00',
    });
    await add({ id: 'wtask004', title: 'Mary’s task', who: 'mary', repeat: daily, slot: 'morning' });
    await api('PUT', `/api/tasks/wtask001/done/${today}`, { at: new Date().toISOString(), by: 'john' });

    const res = await api('GET', '/api/widget/tasks?person=john');
    expect(res.status).toBe(200);
    const w = await res.json<WidgetTasks>();
    expect(w).toMatchObject({ person: { id: 'john', name: 'John' }, day: today, done: 1, total: 3 });
    expect(w.groups.map((g) => [g.label, g.items.map((i) => i.title)])).toEqual([
      ['Habits', ['Stretch']],
      ['Anytime', ['Mail the letter']],
      ['Morning', ['Feed the cat']],
    ]);
    expect(w.groups[2].items[0]).toMatchObject({ emoji: '🐱', done: true, note: 'Daily' });
    expect(w.groups[1].items[0]).toMatchObject({ done: false, note: '9:00 AM' });
  });

  test('only real people (or Anyone)', async () => {
    const api = client(await signIn('203.0.113.91'));
    expect((await api('GET', '/api/widget/tasks?person=nobody')).status).toBe(404);
    expect((await api('GET', '/api/widget/tasks?person=any')).status).toBe(200);
  });
});
