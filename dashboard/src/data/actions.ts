// Every change the UI makes to the data goes through here: the local copy changes at once, and the
// *Sync.ts modules save it to the Worker + D1 API in the background.
import { toast } from '../app/ui';
import { api, DuplicateError, type CalendarChange, type EventChange } from './api';
import { pendingDeletes, refreshPhotos, trackSave } from './photoSync';
import { dropTitle, saveList, saveTitleSoon } from './listSync';
import { saveGrocery } from './grocerySync';
import { saveTask } from './taskSync';
import { dayOf } from '../lib/repeat';
import { now as clockNow } from '../lib/clock';
import { STORES } from './grocery';
import { dataStore, newId } from './store';
import { fileHash, preparePhoto } from './upload';
import { categorize, findGrocery, spellGrocery } from './select';
import type { Calendar, Checklist, Data, EventRecord, Grocery, ListItem, Task, TaskDone } from './types';
import { refreshEvents, saveEvent } from './calendarSync';
import { withEvents } from './calendar';

import { insertAt, orderBy, patch } from '../lib/list';

const set = dataStore.set;

// ------------------------------------------------------------ calendar
// Google Calendar events: the local copy changes at once, then the change is sent to Google through
// the Worker (src/data/calendarSync.ts), one at a time and in order.
export type EventFields = Omit<EventRecord, 'id' | 'recurring'>;

/** An id Google accepts for a new event (base32hex: 0–9, a–v) */
function newEventId(): string {
  const digits = '0123456789abcdefghijklmnopqrstuv';
  return Array.from(crypto.getRandomValues(new Uint8Array(26)), (b) => digits[b % 32]).join('');
}
const setRecords = (change: (list: EventRecord[]) => EventRecord[]) =>
  set((d) => withEvents({ ...d, eventRecords: change(d.eventRecords) }));
const same = (a: EventRecord) => (b: EventRecord) => a.calendar === b.calendar && a.id === b.id;
/**
 * Events that came back under a new id when a delete was undone (Google wouldn't restore the old one).
 * Changes queued before the restore finished still name the old id, so they look it up when they're sent.
 */
const renamed = new Map<string, string>();
const idNow = (r: EventRecord) => renamed.get(`${r.calendar}/${r.id}`) ?? r.id;

export function addCalEvent(f: EventFields): EventRecord {
  const r: EventRecord = { ...f, id: newEventId(), recurring: false };
  setRecords((list) => [...list, r]);
  saveEvent(() => api.addEvent(r));
  return r;
}
/** Change an event (times change together; `calendar` moves it) */
export function editCalEvent(r: EventRecord, p: EventChange): void {
  setRecords((list) => list.map((x) => (same(r)(x) ? { ...x, ...p } : x)));
  saveEvent(() => api.editEvent(r.calendar, idNow(r), p));
}
export function deleteCalEvent(r: EventRecord): void {
  setRecords((list) => list.filter((x) => !same(r)(x)));
  saveEvent(() => api.deleteEvent(r.calendar, idNow(r)));
}
/** Undo a delete */
export function restoreCalEvent(r: EventRecord): void {
  setRecords((list) => [...list.filter((x) => !same(r)(x)), r]);
  saveEvent(() =>
    api.restoreEvent(r, newEventId()).then((back) => {
      if (!back) return refreshEvents();
      if (back.id !== r.id) renamed.set(`${r.calendar}/${r.id}`, back.id);
      setRecords((list) => [...list.filter((x) => !same(r)(x) && !same(back)(x)), back]);
    }),
  );
}
/** Show or hide a Google calendar, say whose it is, its colour, or make it where new events go */
export function setCalendar(id: string, p: CalendarChange): void {
  set((d) => {
    const cals = p.isDefault ? d.calendars.map((c) => ({ ...c, isDefault: false })) : d.calendars;
    return withEvents({ ...d, calendars: patch<Calendar>(cals, id, p) });
  });
  // Shown: the Worker fetches its events first, so load them after
  saveEvent(() => api.editCalendar(id, p).then(() => (p.shown ? refreshEvents() : undefined)));
}

// ------------------------------------------------------------ tasks
// Each change updates the local copy at once, then is saved to the Worker in the background
// (src/data/taskSync.ts), one at a time and in order.
export type TaskFields = Omit<Task, 'id' | 'created'>;

/** A new task */
export function addTask(f: TaskFields): Task {
  const task: Task = { ...f, id: newId(), created: new Date().toISOString() };
  set((d) => ({ ...d, tasks: [...d.tasks, task] }));
  saveTask(() => api.addTask(task));
  return task;
}
/** Change some of a task's settings */
export function editTask(id: string, p: Partial<TaskFields>): void {
  set((d) => ({ ...d, tasks: patch<Task>(d.tasks, id, p) }));
  saveTask(() => api.editTask(id, p));
}
/** Delete a task and its history; returns both, so Undo can bring them back */
export function deleteTask(id: string): { task: Task; done: TaskDone[] } | null {
  const d = dataStore.get();
  const task = d.tasks.find((t) => t.id === id);
  if (!task) return null;
  const done = d.taskDone.filter((x) => x.task === id);
  set({ ...d, tasks: d.tasks.filter((t) => t.id !== id), taskDone: d.taskDone.filter((x) => x.task !== id) });
  saveTask(() => api.deleteTask(id));
  return { task, done };
}
export function restoreTask(task: Task, done: TaskDone[]): void {
  set((d) => ({ ...d, tasks: [...d.tasks.filter((t) => t.id !== task.id), task], taskDone: [...d.taskDone, ...done] }));
  saveTask(() => api.addTask(task, done));
}
/** Check a task off for a due day (`by`: who did it, if known), or un-check it */
export function setTaskDone(taskId: string, day: string, done: boolean, by: string | null = null): void {
  writeTaskDone(taskId, day, done, by);
  // A one-off reminder from a list item ticks (or unticks) that item too
  const t = dataStore.get().tasks.find((x) => x.id === taskId);
  if (t && !t.repeat && t.listId && t.listItemId) writeItemDone(t.listId, t.listItemId, done);
}
function writeTaskDone(taskId: string, day: string, done: boolean, by: string | null = null): void {
  const others = (d: Data) => d.taskDone.filter((x) => !(x.task === taskId && x.day === day));
  if (done) {
    const row: TaskDone = { task: taskId, day, at: new Date().toISOString(), by };
    set((d) => ({ ...d, taskDone: [...others(d), row] }));
    saveTask(() => api.markDone(taskId, day, { at: row.at, by }));
  } else {
    set((d) => ({ ...d, taskDone: others(d) }));
    saveTask(() => api.unmarkDone(taskId, day));
  }
}

// ------------------------------------------------------------ photos
const UNDO_MS = 6000;

/** Save a new photo order (the grid order, which the slideshow follows) */
export function reorderPhotos(ids: string[]): void {
  set((d) => ({ ...d, photos: orderBy(d.photos, ids) }));
  trackSave(api.reorderPhotos(ids)).catch(() => {
    toast('Couldn’t save the new order', { icon: 'x' });
    void refreshPhotos();
  });
}

/** Deletes waiting out their Undo window, by photo id */
const deleteTimers = new Map<string, number>();

function sendDelete(id: string): void {
  deleteTimers.delete(id);
  trackSave(api.deletePhoto(id))
    .catch(() => toast('Couldn’t delete the photo', { icon: 'x' }))
    .finally(() => {
      pendingDeletes.delete(id);
      void refreshPhotos();
    });
}

/**
 * Send any deletes still waiting out their Undo window right now. Called as the page goes away
 * (reload, pull-to-refresh, app closed or backgrounded); otherwise the timer dies with the page and
 * the photo comes back. keepalive lets the request finish after the page is gone.
 */
function flushPendingDeletes(): void {
  for (const [id, timer] of deleteTimers) {
    clearTimeout(timer);
    deleteTimers.delete(id);
    // If the page was only put away (not closed), this finishes while it's hidden: either way the
    // photo stops being held back, and a delete that failed brings it back on the next refresh
    void trackSave(fetch(`/api/photos/${id}`, { method: 'DELETE', keepalive: true }))
      .catch(() => {})
      .finally(() => pendingDeletes.delete(id));
  }
}
addEventListener('pagehide', flushPendingDeletes);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushPendingDeletes();
});

/** Remove a photo now; it's deleted from the server once the Undo toast has had its chance */
export function deletePhoto(id: string): void {
  const before = dataStore.get().photos;
  const at = before.findIndex((p) => p.id === id);
  if (at < 0) return;
  const photo = before[at];
  pendingDeletes.add(id);
  set((d) => ({ ...d, photos: d.photos.filter((p) => p.id !== id) }));
  deleteTimers.set(
    id,
    window.setTimeout(() => sendDelete(id), UNDO_MS),
  );
  toast('Photo deleted', {
    icon: 'photo',
    ms: UNDO_MS,
    undo: () => {
      const timer = deleteTimers.get(id);
      // Already sent (the app was put away and the delete went through)
      if (timer == null) return void toast('Too late to undo: that photo has been deleted', { icon: 'x' });
      clearTimeout(timer);
      deleteTimers.delete(id);
      pendingDeletes.delete(id);
      set((d) => ({ ...d, photos: insertAt(d.photos, photo, at) }));
    },
  });
}

/**
 * Resize and upload photos one at a time (gentle on a phone's memory). Photos already on the
 * dashboard (same original file) are skipped. New photos go first in the list; they're sent
 * last-to-first so they end up in the order they were picked.
 */
export async function addPhotos(
  files: File[],
  progress?: (done: number, total: number) => void,
): Promise<{ added: number; failed: number; skipped: number }> {
  let added = 0,
    failed = 0,
    skipped = 0;
  // Fingerprint everything first, then ask the server which it already has
  const hashes = await Promise.all(files.map((f) => fileHash(f).catch(() => null)));
  const known = new Set(await api.knownPhotos(hashes.filter((h): h is string => !!h)).catch(() => []));
  const todo: [File, string | null][] = [];
  files.forEach((f, i) => {
    const h = hashes[i];
    if (h && known.has(h)) return void skipped++;
    if (h) known.add(h); // the same photo picked twice in one go
    todo.push([f, h]);
  });
  progress?.(0, todo.length);
  for (const [file, hash] of todo.reverse()) {
    try {
      const p = await preparePhoto(file);
      const form = new FormData();
      form.set('full', p.full, 'full.jpg');
      form.set('thumb', p.thumb, 'thumb.jpg');
      form.set('width', String(p.width));
      form.set('height', String(p.height));
      form.set('takenAt', p.takenAt);
      if (hash) form.set('sourceHash', hash);
      const photo = await trackSave(api.addPhoto(form));
      set((d) => ({ ...d, photos: [photo, ...d.photos.filter((x) => x.id !== photo.id)] }));
      added++;
    } catch (e) {
      if (e instanceof DuplicateError) skipped++;
      else {
        console.warn('Photo upload failed', file.name, e);
        failed++;
      }
    }
    progress?.(added + failed + skipped, todo.length);
  }
  return { added, failed, skipped };
}

// ------------------------------------------------------------ groceries
// Each change updates the local copy at once, then is saved to the Worker in the background
// (src/data/grocerySync.ts), one at a time and in order.
const groceryIds = () => dataStore.get().groceries.map((g) => g.id);

/** Remember a name's aisle here too, so adding it again goes to the same aisle before the next refresh */
const rememberAisle = (name: string, cat: string) =>
  set((d) => ({
    ...d,
    groceryNames: [
      [name, cat] as [string, string],
      ...d.groceryNames.filter(([n]) => n.toLowerCase() !== name.toLowerCase()),
    ],
  }));

export function setQty(id: string, qty: number): void {
  const q = Math.max(1, qty);
  set((d) => ({ ...d, groceries: patch(d.groceries, id, { qty: q }) }));
  saveGrocery(() => api.editGrocery(id, { qty: q }));
}
export function setGroceryDone(id: string, done: boolean): void {
  set((d) => ({ ...d, groceries: patch(d.groceries, id, { done }) }));
  saveGrocery(() => api.editGrocery(id, { done }));
}
/** Fix an item's name (blank keeps the old); its aisle is remembered under the new name */
export function renameGrocery(id: string, raw: string): void {
  const name = raw.trim();
  const g = dataStore.get().groceries.find((x) => x.id === id);
  if (!name || !g || name === g.name) return;
  set((d) => ({ ...d, groceries: patch(d.groceries, id, { name }) }));
  rememberAisle(name, g.cat);
  saveGrocery(() => api.editGrocery(id, { name }));
}
/** Move an item to another store's list */
export function setGroceryStore(id: string, store: string): void {
  set((d) => ({ ...d, groceries: patch(d.groceries, id, { store }) }));
  saveGrocery(() => api.editGrocery(id, { store }));
}

/**
 * Add an item by name: bumps the quantity if it's already on the list, moves it back from Purchased
 * if it was checked off, otherwise adds it to the aisle it was in before (or a best guess for a new
 * name). New items go to the store whose list is showing, else the first store (PickNSave).
 */
export function addGrocery(raw: string, storeFilter: string): { item: Grocery; kind: 'more' | 'revived' | 'new' } {
  const d = dataStore.get();
  const name = raw.trim();
  const open = findGrocery(d, name, false);
  if (open) {
    const item = { ...open, qty: open.qty + 1 };
    // Already on the list: any copies under Purchased go (they'd only be duplicates)
    const stale = d.groceries.filter((g) => g.done && g.name.toLowerCase() === name.toLowerCase()).map((g) => g.id);
    set({ ...d, groceries: patch(d.groceries, open.id, { qty: item.qty }).filter((g) => !stale.includes(g.id)) });
    saveGrocery(() => api.editGrocery(open.id, { qty: item.qty, used: true }));
    if (stale.length) saveGrocery(() => api.clearGroceries(stale));
    return { item, kind: 'more' };
  }
  const got = findGrocery(d, name, true);
  if (got) {
    // Back from Purchased, to the store whose list is showing (or the store it was at)
    const store = storeFilter === 'all' ? got.store : storeFilter;
    const item = { ...got, done: false, qty: 1, store };
    set({ ...d, groceries: patch(d.groceries, got.id, { done: false, qty: 1, store }) });
    saveGrocery(() => api.editGrocery(got.id, { done: false, qty: 1, store, used: true }));
    return { item, kind: 'revived' };
  }
  const item: Grocery = {
    id: newId(),
    name: spellGrocery(d, name),
    cat: categorize(d, name),
    qty: 1,
    store: storeFilter === 'all' ? STORES[0].id : storeFilter,
    done: false,
    note: '',
  };
  set({ ...d, groceries: [...d.groceries, item] });
  rememberAisle(item.name, item.cat);
  saveGrocery(() => api.addGrocery(item));
  return { item, kind: 'new' };
}

/** Remove the given checked-off items; returns them so the change can be undone. */
export function clearGroceries(ids: string[]): Grocery[] {
  const gone = dataStore.get().groceries.filter((g) => ids.includes(g.id));
  set((d) => ({ ...d, groceries: d.groceries.filter((g) => !ids.includes(g.id)) }));
  saveGrocery(() => api.clearGroceries(ids));
  return gone;
}
/** Undo a clear: the items come back (at the end, checked off as they were) */
export function restoreGroceries(items: Grocery[]): void {
  set((d) => ({ ...d, groceries: [...d.groceries, ...items] }));
  for (const g of items) saveGrocery(() => api.addGrocery(g, true));
}

/** Take an item off the list (its count went below 1); returns it and where it was, for Undo */
export function removeGrocery(id: string): { item: Grocery; at: number } | null {
  const list = dataStore.get().groceries;
  const at = list.findIndex((g) => g.id === id);
  if (at < 0) return null;
  set((d) => ({ ...d, groceries: d.groceries.filter((g) => g.id !== id) }));
  saveGrocery(() => api.deleteGrocery(id));
  return { item: list[at], at };
}
/** Undo a removal: the item comes back where it was */
export function restoreGrocery(item: Grocery, at: number): void {
  set((d) => ({ ...d, groceries: insertAt(d.groceries, item, at) }));
  const order = groceryIds();
  saveGrocery(() => api.addGrocery(item, true));
  saveGrocery(() => api.orderGroceries(order));
}

/**
 * Save the order from dragging: `placed` is the shown items in their new order, each with the aisle
 * of the heading it ended up under (which is remembered for that name). They fill the places the shown
 * items had, so items not shown (checked off, or at another store while one is picked) keep theirs.
 */
export function placeGroceries(dragged: { id: string; cat: string }[]): void {
  const before = new Map(dataStore.get().groceries.map((g) => [g.id, g]));
  // A refresh during the drag can remove an item that was on screen when it started
  const placed = dragged.filter((p) => before.has(p.id));
  set((d) => {
    const shown = new Set(placed.map((p) => p.id));
    let k = 0;
    const groceries = d.groceries.map((g) => {
      if (!shown.has(g.id)) return g;
      const p = placed[k++];
      return { ...before.get(p.id)!, cat: p.cat };
    });
    return { ...d, groceries };
  });
  for (const p of placed) {
    const g = before.get(p.id);
    if (!g || g.cat === p.cat) continue;
    rememberAisle(g.name, p.cat);
    saveGrocery(() => api.editGrocery(p.id, { cat: p.cat }));
  }
  const order = groceryIds();
  saveGrocery(() => api.orderGroceries(order));
}

// ------------------------------------------------------------ lists
// Each change updates the local copy at once, then is saved to the Worker in the background
// (src/data/listSync.ts), one at a time and in order.
const patchList = (id: string, f: (l: Checklist) => Checklist) =>
  set((d) => ({ ...d, lists: d.lists.map((l) => (l.id === id ? f(l) : l)) }));
const listIds = () => dataStore.get().lists.map((l) => l.id);
const itemIds = (listId: string) =>
  dataStore
    .get()
    .lists.find((l) => l.id === listId)
    ?.items.map((i) => i.id) ?? [];

/** A new, empty list (it opens with its title ready to type) */
export function addList(): Checklist {
  const list: Checklist = { id: newId(), title: '', emoji: '📝', items: [] };
  set((d) => ({ ...d, lists: [...d.lists, list] }));
  saveList(() => api.addList({ id: list.id, title: list.title, emoji: list.emoji }));
  return list;
}
/** Rename a list as it's typed; saved after a pause in typing */
export function renameList(id: string, title: string): void {
  patchList(id, (l) => ({ ...l, title }));
  saveTitleSoon(id, title);
}
/** Change a list's emoji */
export function setListEmoji(id: string, emoji: string): void {
  patchList(id, (l) => ({ ...l, emoji }));
  saveList(() => api.editList(id, { emoji }));
}
/** Save a new order for the lists (from dragging their cards; the grocery list always stays first) */
export function reorderLists(ids: string[]): void {
  set((d) => ({ ...d, lists: orderBy(d.lists, ids) }));
  saveList(() => api.orderLists(ids));
}

/** Remove a list; returns it and where it was, so the change can be undone */
export function deleteList(id: string): { list: Checklist; at: number } | null {
  const lists = dataStore.get().lists;
  const at = lists.findIndex((l) => l.id === id);
  if (at < 0) return null;
  set((d) => ({ ...d, lists: d.lists.filter((l) => l.id !== id) }));
  dropTitle(id);
  saveList(() => api.deleteList(id));
  return { list: lists[at], at };
}
/** Undo a delete: the list comes back, with its items, where it was */
export function restoreList(list: Checklist, at: number): void {
  set((d) => ({ ...d, lists: insertAt(d.lists, list, at) }));
  const order = listIds();
  saveList(() => api.addList(list));
  saveList(() => api.orderLists(order));
}

export function addListItem(listId: string, text: string, heading = false): ListItem {
  const item: ListItem = { id: newId(), text: text.trim(), done: false, ...(heading ? { heading } : {}) };
  patchList(listId, (l) => ({ ...l, items: [...l.items, item] }));
  saveList(() => api.addItem(listId, item));
  return item;
}
/** Change an item's (or heading's) text; blank text keeps the old */
export function editListItem(listId: string, itemId: string, text: string): void {
  const value = text.trim();
  if (!value) return;
  const old = dataStore
    .get()
    .lists.find((l) => l.id === listId)
    ?.items.find((i) => i.id === itemId)?.text;
  patchList(listId, (l) => ({ ...l, items: patch(l.items, itemId, { text: value }) }));
  saveList(() => api.editItem(listId, itemId, { text: value }));
  // Reminders still named after the item follow its new text
  for (const t of linkedTasks(listId, itemId)) if (t.title === old) editTask(t.id, { title: value });
}
export function toggleListItem(listId: string, itemId: string): void {
  const item = dataStore
    .get()
    .lists.find((l) => l.id === listId)
    ?.items.find((i) => i.id === itemId);
  if (!item) return;
  const done = !item.done;
  writeItemDone(listId, itemId, done);
  // Its one-off reminders are done (or not) too
  const d = dataStore.get();
  for (const t of linkedTasks(listId, itemId).filter((x) => !x.repeat)) {
    const rows = d.taskDone.filter((x) => x.task === t.id);
    if (done && !rows.length) writeTaskDone(t.id, t.due ?? dayOf(clockNow()), true);
    if (!done) for (const r of rows) writeTaskDone(t.id, r.day, false);
  }
}
function writeItemDone(listId: string, itemId: string, done: boolean): void {
  const item = dataStore
    .get()
    .lists.find((l) => l.id === listId)
    ?.items.find((i) => i.id === itemId);
  if (!item || item.done === done) return;
  patchList(listId, (l) => ({ ...l, items: patch(l.items, itemId, { done }) }));
  saveList(() => api.editItem(listId, itemId, { done }));
}
/** Tasks made as reminders for a list's items (or one item) */
export function linkedTasks(listId: string, itemId?: string): Task[] {
  return dataStore.get().tasks.filter((t) => t.listId === listId && (!itemId || t.listItemId === itemId));
}
/** Keep tasks whose list (or item) is going away, as plain tasks */
export function unlinkTasks(tasks: Task[]): void {
  for (const t of tasks) editTask(t.id, { listId: null, listItemId: null });
}
/** Undo unlinkTasks */
export function relinkTasks(tasks: Task[]): void {
  for (const t of tasks) editTask(t.id, { listId: t.listId, listItemId: t.listItemId });
}

/** Remove an item; returns it and where it was, so the change can be undone */
export function removeListItem(listId: string, itemId: string): { item: ListItem; at: number } | null {
  const list = dataStore.get().lists.find((l) => l.id === listId);
  const at = list ? list.items.findIndex((i) => i.id === itemId) : -1;
  if (!list || at < 0) return null;
  patchList(listId, (l) => ({ ...l, items: l.items.filter((i) => i.id !== itemId) }));
  saveList(() => api.deleteItem(listId, itemId));
  return { item: list.items[at], at };
}
/** Undo a removal: the item comes back where it was */
export function restoreListItem(listId: string, item: ListItem, at: number): void {
  patchList(listId, (l) => ({ ...l, items: insertAt(l.items, item, at) }));
  const order = itemIds(listId);
  saveList(() => api.addItem(listId, item));
  saveList(() => api.orderItems(listId, order));
}

/** Save a new item order (from dragging) */
export function reorderListItems(listId: string, ids: string[]): void {
  patchList(listId, (l) => ({ ...l, items: orderBy(l.items, ids) }));
  saveList(() => api.orderItems(listId, ids));
}
