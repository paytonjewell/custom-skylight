import { useRef } from 'react';
import { createStore, useStore } from '../lib/store';
import { initialData } from './initial';
import type { Data } from './types';

/** All dashboard data, loaded from (and saved through) the Worker + D1 API */
export const dataStore = createStore<Data>(initialData());

/**
 * The parts of the data a component uses: `useData('tasks', 'taskDone')`. It re-renders only when one
 * of those changes, not on every change anywhere (a grocery checked off doesn't redraw the calendar).
 * Functions it's passed to take the same `Pick<Data, …>`, so a missing key is a type error.
 */
export function useData<K extends keyof Data>(...keys: [K, ...K[]]): Pick<Data, K> {
  const last = useRef<Pick<Data, K> | null>(null);
  const prevAliases = useRef<Data['foodAliases'] | null>(null);
  // Matching foods (src/data/names.ts) also depends on the matches the family taught, which it reads
  // outside the store: anything showing kitchen or grocery data redraws when one is taught too
  const kitchen = keys.some((k) => k === 'inventory' || k === 'groceries' || k === 'recipes');
  return useStore(dataStore, (d) => {
    const prev = last.current;
    const aliasesSame = !kitchen || prevAliases.current === d.foodAliases;
    if (prev && aliasesSame && keys.every((k) => prev[k] === d[k])) return prev;
    prevAliases.current = d.foodAliases;
    const next = {} as Pick<Data, K>;
    for (const k of keys) next[k] = d[k];
    last.current = next;
    return next;
  });
}

/**
 * Id for a record saved to the server (e.g. lists): 20 random base-36 characters, unique across
 * devices. (crypto.randomUUID needs HTTPS; getRandomValues also works over plain-http LAN dev.)
 */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}
