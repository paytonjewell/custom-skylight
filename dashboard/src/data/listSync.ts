// Keeps the lists in step with the Worker (worker/lists.ts); see createSync (src/data/sync.ts).
// A list's name is saved after a pause in typing, not on every keystroke.
import { api } from './api';
import { dataStore } from './store';
import { createSync } from './sync';

const TITLE_MS = 700; // a list's name is saved this long after the last keystroke

/** Names typed but not sent yet, by list id */
const titles = new Map<string, { timer: number; title: string }>();

const sync = createSync({
  load: api.lists,
  apply: (lists) => dataStore.set((d) => ({ ...d, lists })),
  failMessage: 'Couldn’t save a change to your lists',
  keep: 'lists.last',
  busy: () => titles.size > 0,
});

export const saveList = sync.save;
export const useListStatus = sync.useStatus;
export const startListSync = () => sync.start(flushTitles);

export function saveTitleSoon(id: string, title: string): void {
  sync.touch();
  clearTimeout(titles.get(id)?.timer);
  titles.set(id, {
    title,
    timer: window.setTimeout(() => {
      titles.delete(id);
      saveList(() => api.editList(id, { title }));
    }, TITLE_MS),
  });
}
/** A list is being deleted: its name no longer needs saving */
export function dropTitle(id: string): void {
  clearTimeout(titles.get(id)?.timer);
  titles.delete(id);
}
/** The page is going away: send names still waiting (keepalive lets them finish after it's gone) */
function flushTitles(): void {
  for (const [id, { timer, title }] of titles) {
    clearTimeout(timer);
    void fetch(`/api/lists/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
      keepalive: true,
    });
  }
  titles.clear();
}
