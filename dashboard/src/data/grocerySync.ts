// Keeps the grocery list (and the remembered item names) in step with the Worker
// (worker/groceries.ts); see createSync (src/data/sync.ts).
import { api } from './api';
import { dataStore } from './store';
import { createSync } from './sync';

const sync = createSync({
  load: api.groceries,
  apply: ({ items, known }) => dataStore.set((d) => ({ ...d, groceries: items, groceryNames: known })),
  failMessage: 'Couldn’t save a change to the grocery list',
  keep: 'groceries.last',
});

export const saveGrocery = sync.save;
export const useGroceryStatus = sync.useStatus;
export const startGrocerySync = () => sync.start();
