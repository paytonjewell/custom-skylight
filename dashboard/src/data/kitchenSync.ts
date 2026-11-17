// Keeps the kitchen (recipes, dinner plan, what's on hand) in step with the Worker (worker/kitchen.ts);
// see createSync (src/data/sync.ts): changes show at once and are saved in order in the background.
import { api } from './api';
import { dataStore } from './store';
import { createSync } from './sync';
import { setTaught } from './names';

const sync = createSync({
  load: api.kitchen,
  apply: (k) => {
    setTaught(k.aliases);
    dataStore.set((d) => ({
      ...d,
      recipes: k.recipes,
      mealPlan: k.plan,
      inventory: k.inventory,
      inventoryNames: k.names,
      foodAliases: k.aliases,
      kitchenLoaded: true,
    }));
  },
  failMessage: 'Couldn’t save a change in the kitchen',
  keep: 'kitchen.last',
});

export const saveKitchen = sync.save;
export const useKitchenStatus = sync.useStatus;
export const startKitchenSync = () => sync.start();
