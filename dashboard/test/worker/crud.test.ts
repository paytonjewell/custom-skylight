// Round trips through the API against a real local D1: what the app saves is what it loads back
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, test } from 'vitest';
import { AISLES, STORES } from '../../src/data/grocery';
import { clearPurchased } from '../../worker/groceries';
import { client, signIn } from './helpers';

let api: ReturnType<typeof client>;
beforeAll(async () => {
  api = client(await signIn());
});
const get = async <T>(path: string) => {
  const res = await api('GET', path);
  expect(res.status).toBe(200);
  return (await res.json()) as T;
};

describe('tasks', () => {
  const task = {
    id: 'task0001',
    title: '  Take out recycling ',
    emoji: '♻️',
    who: 'john',
    repeat: { kind: 'daily', start: '2026-11-01' },
    due: null,
    slot: 'evening',
    time: '19:00',
    habit: false,
    onCalendar: true,
    remind: '18:30',
    notify: ['john', 'john', 'mary'],
    listId: null,
    listItemId: null,
    created: '2026-11-01T12:00:00.000Z',
  };
  type Tasks = { tasks: Record<string, unknown>[]; done: Record<string, unknown>[] };

  test('add, load, change, check off and delete', async () => {
    expect((await api('POST', '/api/tasks', task)).status).toBe(201);
    expect((await api('POST', '/api/tasks', task)).status).toBe(409);
    let got = await get<Tasks>('/api/tasks');
    expect(got.tasks).toEqual([
      { ...task, title: 'Take out recycling', notify: ['john', 'mary'], created: '2026-11-01T12:00:00.000Z' },
    ]);

    expect((await api('PATCH', '/api/tasks/task0001', { title: 'Recycling', position: 2 })).status).toBe(204);
    expect((await api('PATCH', '/api/tasks/task0001', { slot: 'teatime' })).status).toBe(400);
    expect(
      (await api('PUT', '/api/tasks/task0001/done/2026-11-16', { at: '2026-11-16T20:00:00Z', by: 'john' })).status,
    ).toBe(204);
    got = await get<Tasks>('/api/tasks');
    expect(got.tasks[0]).toMatchObject({ title: 'Recycling', position: 2 });
    expect(got.done).toEqual([{ task: 'task0001', day: '2026-11-16', at: '2026-11-16T20:00:00.000Z', by: 'john' }]);

    expect((await api('DELETE', '/api/tasks/task0001/done/2026-11-16')).status).toBe(204);
    expect((await get<Tasks>('/api/tasks')).done).toEqual([]);
    expect((await api('DELETE', '/api/tasks/task0001')).status).toBe(204);
    expect((await get<Tasks>('/api/tasks')).tasks).toEqual([]);
  });

  test('changes to a task that isn’t there are 404', async () => {
    expect((await api('PATCH', '/api/tasks/missing01', { title: 'x' })).status).toBe(404);
    expect((await api('DELETE', '/api/tasks/missing01')).status).toBe(404);
    expect((await api('PUT', '/api/tasks/missing01/done/2026-11-16', { at: '2026-11-16T20:00:00Z' })).status).toBe(404);
    // Not an id or not a day: no such route
    expect((await api('PATCH', '/api/tasks/NOT-AN-ID', { title: 'x' })).status).toBe(404);
    expect((await api('PUT', '/api/tasks/task0001/done/yesterday', {})).status).toBe(404);
  });
});

describe('lists', () => {
  type Lists = { id: string; title: string; emoji: string; items: { id: string; text: string; done: boolean }[] }[];

  test('a list and its items, in order', async () => {
    expect(
      (
        await api('POST', '/api/lists', {
          id: 'list0001',
          title: 'Packing',
          emoji: '🧳',
          items: [{ id: 'item0001', text: 'Socks', done: false }],
        })
      ).status,
    ).toBe(201);
    expect((await api('POST', '/api/lists/list0001/items', { id: 'item0002', text: ' Toothbrush ' })).status).toBe(201);
    expect((await api('POST', '/api/lists/nolist01/items', { id: 'item0003', text: 'x' })).status).toBe(404);
    expect((await api('PATCH', '/api/lists/list0001/items/item0001', { done: true })).status).toBe(204);
    expect((await api('PUT', '/api/lists/list0001/items/order', { ids: ['item0002', 'item0001'] })).status).toBe(204);
    expect((await api('PATCH', '/api/lists/list0001', { title: 'Trip' })).status).toBe(204);

    const lists = await get<Lists>('/api/lists');
    const mine = lists.find((l) => l.id === 'list0001')!;
    expect(mine).toEqual({
      id: 'list0001',
      title: 'Trip',
      emoji: '🧳',
      items: [
        { id: 'item0002', text: 'Toothbrush', done: false },
        { id: 'item0001', text: 'Socks', done: true },
      ],
    });

    expect((await api('DELETE', '/api/lists/list0001/items/item0002')).status).toBe(204);
    expect((await api('DELETE', '/api/lists/list0001/items/item0002')).status).toBe(404);
    expect((await api('DELETE', '/api/lists/list0001')).status).toBe(204);
    expect((await api('PATCH', '/api/lists/list0001', { title: 'x' })).status).toBe(404);
    expect((await get<Lists>('/api/lists')).some((l) => l.id === 'list0001')).toBe(false);
  });

  test('lists reorder', async () => {
    for (const id of ['lista001', 'listb001'])
      expect((await api('POST', '/api/lists', { id, title: id, emoji: '' })).status).toBe(201);
    expect((await api('PUT', '/api/lists/order', { ids: ['listb001', 'lista001'] })).status).toBe(204);
    const ids = (await get<Lists>('/api/lists')).map((l) => l.id).filter((id) => id.endsWith('001'));
    expect(ids.indexOf('listb001')).toBeLessThan(ids.indexOf('lista001'));
    expect((await api('PUT', '/api/lists/order', { ids: ['BAD'] })).status).toBe(400);
  });
});

describe('groceries', () => {
  type Groceries = { items: { id: string; name: string; qty: number; done: boolean }[]; known: [string, string][] };
  const milk = { id: 'groc0001', name: 'Milk', cat: AISLES[0], qty: 1, store: STORES[0].id };

  test('add, change, reorder, clear and delete', async () => {
    expect((await api('POST', '/api/groceries', milk)).status).toBe(201);
    expect((await api('POST', '/api/groceries', { ...milk, id: 'groc0002', name: 'Eggs' })).status).toBe(201);
    expect((await api('PATCH', '/api/groceries/groc0001', { qty: 2 })).status).toBe(204);
    expect((await api('PATCH', '/api/groceries/missing1', { qty: 2 })).status).toBe(404);
    expect((await api('PUT', '/api/groceries/order', { ids: ['groc0002', 'groc0001'] })).status).toBe(204);
    let got = await get<Groceries>('/api/groceries');
    expect(got.items.map((i) => [i.id, i.qty])).toEqual([
      ['groc0002', 1],
      ['groc0001', 2],
    ]);
    expect(got.known.map(([name]) => name).sort()).toEqual(['Eggs', 'Milk']);

    expect((await api('POST', '/api/groceries/clear', { ids: ['groc0002'] })).status).toBe(204);
    expect((await api('DELETE', '/api/groceries/groc0001')).status).toBe(204);
    expect((await api('DELETE', '/api/groceries/groc0001')).status).toBe(404);
    got = await get<Groceries>('/api/groceries');
    expect(got.items).toEqual([]);
  });

  test('purchased items are hidden after a few days, and deleted by the daily cron', async () => {
    await api('POST', '/api/groceries', { ...milk, id: 'groc0010', done: true });
    await api('POST', '/api/groceries', { ...milk, id: 'groc0011', done: true });
    const old = new Date(Date.now() - 5 * 864e5).toISOString();
    await env.DB.prepare("UPDATE groceries SET done_at = ? WHERE id = 'groc0010'").bind(old).run();
    expect((await get<Groceries>('/api/groceries')).items.map((i) => i.id)).toEqual(['groc0011']);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM groceries').first('n')).toBe(2);
    await clearPurchased(env);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM groceries').first('n')).toBe(1);
  });
});

describe('kitchen', () => {
  test('changes to a recipe, plan or item that isn’t there are 404', async () => {
    expect((await api('PATCH', '/api/recipes/no-such-recipe', { favorite: true })).status).toBe(404);
    expect((await api('DELETE', '/api/plan/2026-11-20')).status).toBe(404);
    expect((await api('DELETE', '/api/inventory/missing1')).status).toBe(404);
    expect((await api('PATCH', '/api/inventory/missing1', { qty: 2 })).status).toBe(404);
  });

  test('a recipe, planned and unplanned', async () => {
    const recipe = {
      id: 'pancakes',
      title: 'Pancakes',
      emoji: '🥞',
      tone: 2,
      tags: ['Breakfast'],
      minutes: 20,
      servings: 4,
      ingredients: [{ qty: 2, unit: 'cups', name: 'flour' }],
      steps: ['Mix', 'Cook'],
    };
    expect((await api('POST', '/api/recipes', recipe)).status).toBe(201);
    expect((await api('PATCH', '/api/recipes/pancakes', { favorite: true })).status).toBe(204);
    expect((await api('PUT', '/api/plan/2026-11-20', { recipe: 'pancakes' })).status).toBe(204);
    const k = await get<{ recipes: { id: string; favorite: boolean }[]; plan: Record<string, string> }>('/api/kitchen');
    expect(k.recipes).toEqual([{ ...recipe, favorite: true }]);
    expect(k.plan).toEqual({ '2026-11-20': 'pancakes' });
    expect((await api('DELETE', '/api/plan/2026-11-20')).status).toBe(204);
  });
});

describe('photos', () => {
  const hash = (n: number) => n.toString(16).padStart(64, '0');

  test('which photos are already added, for more than 100 at once (D1’s parameter limit)', async () => {
    for (const n of [3, 150, 499])
      await env.DB.prepare(
        "INSERT INTO photos (id, width, height, added_at, position, source_hash) VALUES (?, 1, 1, '2026-01-01', 0, ?)",
      )
        .bind(crypto.randomUUID(), hash(n))
        .run();
    const hashes = Array.from({ length: 500 }, (_, n) => hash(n));
    const res = await api('POST', '/api/photos/known', { hashes });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { known: string[] }).known.sort()).toEqual([hash(150), hash(3), hash(499)].sort());
    expect((await api('POST', '/api/photos/known', { hashes: [...hashes, hash(500)] })).status).toBe(400);
  });
});
