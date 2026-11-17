import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

// The app's clock: real time, optionally shifted by the demo controls. Components read it with
// useNow(), which re-renders once a minute (the UI never shows seconds).
let offset = 0;
let epoch = 0; // bumps whenever the demo clock is changed
const listeners = new Set<() => void>();

export const now = () => new Date(Date.now() + offset);
const minuteKey = () => Math.floor(now().getTime() / 60000);
let key = minuteKey();

const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

setInterval(() => {
  const k = minuteKey();
  if (k !== key) {
    key = k;
    notify();
  }
}, 1000);

/** Jump the app clock to h:m today (demo controls), or back to real time with null. */
export function setDemoTime(h: number | null, m = 0): void {
  if (h == null) offset = 0;
  else {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    offset = d.getTime() - Date.now();
  }
  key = minuteKey();
  epoch++;
  notify();
}

/** Current time, floored to the minute; stable identity within a minute. */
export function useNow(): Date {
  const k = useSyncExternalStore(subscribe, () => key);
  return useMemo(() => new Date(k * 60000), [k]);
}

/** Run `fn` whenever the demo clock is set (not on mount), e.g. to jump a view back to "today". */
export function useOnDemoTimeChange(fn: () => void): void {
  const e = useSyncExternalStore(subscribe, () => epoch);
  const first = useRef(e);
  const latest = useRef(fn);
  useEffect(() => { latest.current = fn; });
  useEffect(() => {
    if (e !== first.current) latest.current();
  }, [e]);
}
