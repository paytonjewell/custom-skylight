// Lists of ids kept on this device: the people and sections shown on Tasks, the order of its columns
// and of the news topics.
import { createStore, store, stored } from './store';

/** A saved list of ids, or null for "all" / "the usual order" */
export function savedIds(key: string) {
  const s = createStore<string[] | null>(
    (() => {
      try {
        const v = JSON.parse(stored(key, 'null'));
        return Array.isArray(v) && v.length ? v : null;
      } catch {
        return null;
      }
    })(),
  );
  return {
    store: s,
    set(ids: string[] | null) {
      s.set(ids);
      store(key, JSON.stringify(ids));
    },
  };
}
export type SavedIds = ReturnType<typeof savedIds>;

/** `items` in the saved order; ones it doesn't mention (new since) keep their usual place, at the end */
export function inSavedOrder<T>(items: T[], saved: string[] | null, idOf: (item: T) => string): T[] {
  if (!saved) return items;
  const byId = new Map(items.map((x) => [idOf(x), x]));
  const known = new Set(saved);
  // Not flatMap(id => byId.get(id) ?? []): that would also flatten items that are arrays themselves
  // (the news topics are [id, label] pairs), leaving loose strings in their place
  const ordered = saved.map((id) => byId.get(id)).filter((x): x is T => x !== undefined);
  return [...ordered, ...items.filter((x) => !known.has(idOf(x)))];
}
