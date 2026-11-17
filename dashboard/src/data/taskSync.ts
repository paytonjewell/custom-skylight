// Keeps tasks and their history in step with the Worker (worker/tasks.ts); see createSync
// (src/data/sync.ts).
import { api } from './api';
import { dataStore } from './store';
import { createSync } from './sync';

const sync = createSync({
  load: api.tasks,
  apply: ({ tasks, done }) => dataStore.set((d) => ({ ...d, tasks, taskDone: done })),
  failMessage: 'Couldn’t save a change to your tasks',
  keep: 'tasks.last',
});

export const saveTask = sync.save;
export const useTaskStatus = sync.useStatus;
export function startTaskSync(): void {
  sync.start();
  // A reminder's "Done" button (public/sw.js) ticked a task: show it
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'tasks-changed') void sync.refresh();
  });
}
