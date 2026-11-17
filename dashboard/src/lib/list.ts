// Small immutable helpers for lists of records with ids (the data store's arrays).

/** The list with one record's fields changed */
export const patch = <T extends { id: string }>(list: T[], id: string, p: Partial<T>): T[] =>
  list.map((x) => (x.id === id ? { ...x, ...p } : x));

/** The list with `item` back at index `at` (for Undo); a copy already in the list is replaced */
export function insertAt<T extends { id: string }>(list: T[], item: T, at: number): T[] {
  const out = list.filter((x) => x.id !== item.id);
  out.splice(Math.min(at, out.length), 0, item);
  return out;
}

/** The records in the order of `ids` (ids with no record are skipped) */
export function orderBy<T extends { id: string }>(list: T[], ids: string[]): T[] {
  const byId = new Map(list.map((x) => [x.id, x]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}
