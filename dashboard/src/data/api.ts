// Calls to the Worker API (worker/index.ts). Same origin, so the device cookie rides along.
import type {
  CalendarChange,
  CalendarInfo,
  Checklist,
  EventChange,
  EventRecord,
  EventsInfo,
  GroceriesInfo,
  Grocery,
  ImportedRecipe,
  InventoryItem,
  KitchenInfo,
  ListItem,
  NewsInfo,
  Person,
  Photo,
  PushInfo,
  AppRelease,
  Recipe,
  Task,
  TaskDone,
  TasksInfo,
  Verse,
  Weather,
} from './types';

/** The server already has this photo (same original file) */
export class DuplicateError extends Error {}

async function call(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, init);
  // This device was signed out (or its cookie expired): reloading shows the PIN page
  if (res.status === 401) {
    location.reload();
    throw new Error('Signed out');
  }
  if (res.status === 409) throw new DuplicateError('Already added');
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res;
}

const send = (method: string, path: string, body?: unknown) =>
  call(
    path,
    body === undefined
      ? { method }
      : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );

export const api = {
  news: async (): Promise<NewsInfo> => (await call('/api/news')).json(),
  // Kitchen: recipes, the dinner plan and what's on hand (worker/kitchen.ts)
  kitchen: async (): Promise<KitchenInfo> => (await call('/api/kitchen')).json(),
  addRecipe: (r: Recipe) => send('POST', '/api/recipes', r),
  /** Read a recipe from a web page (worker/recipeImport.ts); throws with a message saying why not */
  importRecipe: async (url: string): Promise<ImportedRecipe> =>
    (await send('POST', '/api/recipes/import', { url })).json(),
  editRecipe: (id: string, p: { favorite?: boolean; made?: string | null }) => send('PATCH', `/api/recipes/${id}`, p),
  setPlan: (day: string, recipe: string) => send('PUT', `/api/plan/${day}`, { recipe }),
  clearPlan: (day: string) => send('DELETE', `/api/plan/${day}`),
  addInventory: (i: InventoryItem) => send('POST', '/api/inventory', i),
  editInventory: (id: string, p: Partial<Omit<InventoryItem, 'id'>>) => send('PATCH', `/api/inventory/${id}`, p),
  deleteInventory: (id: string) => send('DELETE', `/api/inventory/${id}`),
  teach: (name: string, sameAs: string) => send('PUT', '/api/aliases', { name, sameAs }),
  unteach: (name: string) => send('DELETE', '/api/aliases', { name }),
  // Weather and the verse of the day (worker/weather.ts)
  weather: async (): Promise<Weather> => (await call('/api/weather')).json(),
  /** Who the dashboard is for (worker/home.ts) */
  family: async (): Promise<Person[]> => (await call('/api/family')).json(),
  verse: async (): Promise<Verse> => (await call('/api/verse')).json(),
  photos: async (): Promise<Photo[]> => (await call('/api/photos')).json(),
  addPhoto: async (form: FormData): Promise<Photo> =>
    (await call('/api/photos', { method: 'POST', body: form })).json(),
  knownPhotos: async (hashes: string[]): Promise<string[]> =>
    (
      await (
        await call('/api/photos/known', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hashes }),
        })
      ).json()
    ).known,
  deletePhoto: (id: string) => call(`/api/photos/${id}`, { method: 'DELETE' }),
  reorderPhotos: (ids: string[]) =>
    call('/api/photos/order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    }),
  // lists (worker/lists.ts)
  lists: async (): Promise<Checklist[]> => (await call('/api/lists')).json(),
  addList: (l: Pick<Checklist, 'id' | 'title' | 'emoji'> & { items?: ListItem[] }) => send('POST', '/api/lists', l),
  editList: (id: string, p: { title?: string; emoji?: string }) => send('PATCH', `/api/lists/${id}`, p),
  deleteList: (id: string) => send('DELETE', `/api/lists/${id}`),
  orderLists: (ids: string[]) => send('PUT', '/api/lists/order', { ids }),
  addItem: (listId: string, i: ListItem) => send('POST', `/api/lists/${listId}/items`, i),
  editItem: (listId: string, id: string, p: { text?: string; done?: boolean }) =>
    send('PATCH', `/api/lists/${listId}/items/${id}`, p),
  deleteItem: (listId: string, id: string) => send('DELETE', `/api/lists/${listId}/items/${id}`),
  orderItems: (listId: string, ids: string[]) => send('PUT', `/api/lists/${listId}/items/order`, { ids }),
  // groceries (worker/groceries.ts)
  groceries: async (): Promise<GroceriesInfo> => (await call('/api/groceries')).json(),
  addGrocery: (g: Grocery, restore = false) => send('POST', '/api/groceries', restore ? { ...g, restore } : g),
  editGrocery: (id: string, p: Partial<Omit<Grocery, 'id'>> & { used?: boolean }) =>
    send('PATCH', `/api/groceries/${id}`, p),
  deleteGrocery: (id: string) => send('DELETE', `/api/groceries/${id}`),
  clearGroceries: (ids: string[]) => send('POST', '/api/groceries/clear', { ids }),
  orderGroceries: (ids: string[]) => send('PUT', '/api/groceries/order', { ids }),
  // tasks (worker/tasks.ts)
  tasks: async (): Promise<TasksInfo> => (await call('/api/tasks')).json(),
  addTask: (t: Task, done?: TaskDone[]) => send('POST', '/api/tasks', done?.length ? { ...t, done } : t),
  editTask: (id: string, p: Partial<Omit<Task, 'id' | 'created'>>) => send('PATCH', `/api/tasks/${id}`, p),
  deleteTask: (id: string) => send('DELETE', `/api/tasks/${id}`),
  markDone: (id: string, day: string, p: { at: string; by: string | null }) =>
    send('PUT', `/api/tasks/${id}/done/${day}`, p),
  unmarkDone: (id: string, day: string) => send('DELETE', `/api/tasks/${id}/done/${day}`),
  // phone reminders (worker/push.ts)
  push: async (): Promise<PushInfo> => (await call('/api/push')).json(),
  savePush: (sub: PushSubscriptionJSON, person: string, tz: string) => send('PUT', '/api/push', { ...sub, person, tz }),
  /** The phone app turns reminders on with its FCM token (worker/fcm.ts) */
  saveAppPush: (token: string, person: string, tz: string) =>
    send('PUT', '/api/push', { kind: 'app', token, person, tz }),
  deletePush: (endpoint: string) => send('DELETE', '/api/push', { endpoint }),
  testPush: (endpoint: string) => send('POST', '/api/push/test', { endpoint }),
  /** The newest phone app build (worker/app.ts) */
  appRelease: async (): Promise<AppRelease | null> => (await call('/api/app')).json(),
  // Google Calendar (worker/google.ts)
  calendars: async (): Promise<CalendarInfo> => (await call('/api/calendars')).json(),
  refreshCalendars: async (): Promise<CalendarInfo> => (await send('POST', '/api/calendars/refresh')).json(),
  editCalendar: (id: string, p: CalendarChange) => send('PATCH', `/api/calendars/${id}`, p),
  disconnectGoogle: (id: string) => send('DELETE', `/api/google/accounts/${id}`),
  events: async (): Promise<EventRecord[]> => ((await (await call('/api/events')).json()) as EventsInfo).events,
  addEvent: (e: EventRecord) => send('POST', '/api/events', e),
  editEvent: (calendar: string, id: string, p: EventChange) =>
    send('PATCH', `/api/events/${calendar}/${encodeURIComponent(id)}`, p),
  deleteEvent: (calendar: string, id: string) => send('DELETE', `/api/events/${calendar}/${encodeURIComponent(id)}`),
  /** The restored event (its id is `newId` if Google wouldn't bring the old one back), or null */
  restoreEvent: async (e: EventRecord, newId: string): Promise<EventRecord | null> => {
    const res = await send('POST', `/api/events/${e.calendar}/${encodeURIComponent(e.id)}/restore`, { ...e, newId });
    return res.status === 204 ? null : res.json();
  },
};
