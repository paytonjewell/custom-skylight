// Kitchen changes: favorites, the dinner plan, "made", what's on hand. Each changes the app's copy at
// once and is saved by the Worker in the background (src/data/kitchenSync.ts), shared by every screen.
// Adding ingredients to groceries goes through the grocery list's own add (src/data/actions.ts), so it
// lands in the right aisle and syncs like any other item.
import type { InventoryItem, Recipe } from './types';
import { dataStore, newId } from './store';
import { api } from './api';
import { saveKitchen } from './kitchenSync';
import { addGrocery, removeGrocery, setGroceryDone, setQty } from './actions';
import { categorize } from './select';
import { guessPlace, type Place } from './kitchen';
import { core, foodKey, setTaught } from './names';

const set = dataStore.set;

/** A new recipe, last in the list */
export function addRecipe(r: Recipe): void {
  set((d) => ({ ...d, recipes: [...d.recipes, r] }));
  saveKitchen(() => api.addRecipe(r));
}

export function toggleFavorite(id: string): void {
  const r = dataStore.get().recipes.find((x) => x.id === id);
  if (!r) return;
  const favorite = !r.favorite;
  set((d) => ({ ...d, recipes: d.recipes.map((x) => (x.id === id ? { ...x, favorite } : x)) }));
  saveKitchen(() => api.editRecipe(id, { favorite }));
}

/** Plan a dinner for a day ('YYYY-MM-DD'), or clear it (null) */
export function planDinner(day: string, id: string | null): void {
  set((d) => {
    const mealPlan = { ...d.mealPlan };
    if (id) mealPlan[day] = id;
    else delete mealPlan[day];
    return { ...d, mealPlan };
  });
  saveKitchen(() => (id ? api.setPlan(day, id) : api.clearPlan(day)));
}

export function markMade(id: string, day: string): void {
  set((d) => ({ ...d, recipes: d.recipes.map((r) => (r.id === id ? { ...r, made: day } : r)) }));
  saveKitchen(() => api.editRecipe(id, { made: day }));
}

/**
 * Add ingredients to the grocery list (as the list's own add does: a name already on it goes up by
 * one, one checked off comes back). Returns how to undo it all.
 */
export function addToGroceries(names: string[]): () => void {
  const undo: (() => void)[] = [];
  for (const name of names) {
    const before = dataStore.get().groceries.find((g) => g.name.toLowerCase() === name.toLowerCase() && !g.done);
    const { item, kind } = addGrocery(name, 'all');
    if (kind === 'new') undo.push(() => { removeGrocery(item.id); });
    else if (kind === 'more' && before) undo.push(() => setQty(item.id, before.qty));
    else if (kind === 'revived') undo.push(() => setGroceryDone(item.id, true));
  }
  return () => undo.reverse().forEach((f) => f());
}

// ------------------------------------------------------------ what's on hand
/** Where a new name goes: where it was kept before, else a guess */
export function placeFor(name: string): Place {
  const d = dataStore.get();
  return guessPlace(name, d.inventoryNames, categorize(d, name));
}

const learn = (name: string, place: string) =>
  set((d) => ({ ...d, inventoryNames: [[name.toLowerCase(), place] as [string, string], ...d.inventoryNames.filter(([n]) => n !== name.toLowerCase())] }));

/**
 * Put something in the kitchen. If it's already there (by name), it goes up by one instead.
 * Returns the item and whether it was new.
 */
export function addInventory(raw: string, place?: string): { item: InventoryItem; added: boolean } {
  const name = raw.trim();
  const d = dataStore.get();
  const had = d.inventory.find((i) => i.name.toLowerCase() === name.toLowerCase());
  if (had) {
    const qty = had.qty + 1;
    set((x) => ({ ...x, inventory: x.inventory.map((i) => (i.id === had.id ? { ...i, qty } : i)) }));
    saveKitchen(() => api.editInventory(had.id, { qty }));
    return { item: { ...had, qty }, added: false };
  }
  const item: InventoryItem = { id: newId(), name, place: place ?? placeFor(name), qty: 1, note: '' };
  set((x) => ({ ...x, inventory: [...x.inventory, item] }));
  learn(name, item.place);
  saveKitchen(() => api.addInventory(item));
  return { item, added: true };
}

export function editInventory(id: string, p: Partial<Omit<InventoryItem, 'id'>>): void {
  const before = dataStore.get().inventory.find((i) => i.id === id);
  if (!before) return;
  set((d) => ({ ...d, inventory: d.inventory.map((i) => (i.id === id ? { ...i, ...p } : i)) }));
  if (p.place || p.name) learn(p.name ?? before.name, p.place ?? before.place);
  saveKitchen(() => api.editInventory(id, p));
}

/** Take something out; returns it so it can be put back */
export function removeInventory(id: string): InventoryItem | null {
  const item = dataStore.get().inventory.find((i) => i.id === id);
  if (!item) return null;
  set((d) => ({ ...d, inventory: d.inventory.filter((i) => i.id !== id) }));
  saveKitchen(() => api.deleteInventory(id));
  return item;
}
export function restoreInventory(item: InventoryItem): void {
  set((d) => ({ ...d, inventory: [...d.inventory, item] }));
  saveKitchen(() => api.addInventory(item));
}

// ------------------------------------------------------------ taught matches ("I have this")
const setAliases = (pairs: [string, string][]) => {
  setTaught(pairs);
  set((d) => ({ ...d, foodAliases: pairs }));
};

/** From now on, `name` (a recipe's) counts as the on-hand `item`'s food, for everyone. Returns Undo. */
export function teachMatch(name: string, item: InventoryItem): () => void {
  const from = core(name), to = foodKey(item.name);
  const before = dataStore.get().foodAliases;
  const had = before.find(([n]) => n === from);
  setAliases([...before.filter(([n]) => n !== from), [from, to]]);
  saveKitchen(() => api.teach(from, to));
  return () => {
    setAliases(dataStore.get().foodAliases.filter(([n]) => n !== from).concat(had ? [had] : []));
    saveKitchen(() => (had ? api.teach(had[0], had[1]) : api.unteach(from)));
  };
}

/** Forget a taught match (by the core of the name it was taught for) */
export function unteachMatch(from: string): void {
  setAliases(dataStore.get().foodAliases.filter(([n]) => n !== from));
  saveKitchen(() => api.unteach(from));
}
