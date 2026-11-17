import { useMemo, useSyncExternalStore } from 'react';

// The app's clock. Components read it with useNow(), which re-renders once a minute (the UI never
// shows seconds).
const listeners = new Set<() => void>();

export const now = () => new Date();
const minuteKey = () => Math.floor(Date.now() / 60000);
let key = minuteKey();

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

setInterval(() => {
  const k = minuteKey();
  if (k !== key) {
    key = k;
    listeners.forEach((l) => l());
  }
}, 1000);

/** Current time, floored to the minute; stable identity within a minute. */
export function useNow(): Date {
  const k = useSyncExternalStore(subscribe, () => key);
  return useMemo(() => new Date(k * 60000), [k]);
}
