import { useSyncExternalStore } from 'react';

/** A minimal external store: plain state + subscribers, read in components with `useStore`. */
export interface Store<T> {
  get(): T;
  set(next: T | ((state: T) => T)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      state = typeof next === 'function' ? (next as (s: T) => T)(state) : next;
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Subscribe to a slice of a store. `select` must return a stable value (primitive or existing reference). */
export function useStore<T, U>(store: Store<T>, select: (state: T) => U): U {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}

/** Read/write helpers for localStorage, which can be unavailable (private mode, blocked storage). */
export function stored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
export function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: keep working without persistence */
  }
}
