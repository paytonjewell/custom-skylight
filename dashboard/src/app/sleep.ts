// Sleep hours (frame only): during them, an idle frame shows a black screen instead of the photo
// frame, and the kiosk turns the backlight down. A tap wakes it. Saved on this device.
import { createStore, store, stored, useStore } from '../lib/store';

/** Minutes after midnight */
export interface SleepSettings {
  on: boolean;
  from: number;
  to: number;
}

const num = (key: string, fallback: number) => {
  const n = Number(stored(key, String(fallback)));
  return Number.isFinite(n) && n >= 0 && n < 1440 ? n : fallback;
};

const sleepStore = createStore<SleepSettings>({
  on: stored('sleepOn', '1') === '1',
  from: num('sleepFrom', 22 * 60),
  to: num('sleepTo', 6 * 60),
});
export const useSleepSettings = () => useStore(sleepStore, (s) => s);

export function setSleep(p: Partial<SleepSettings>): void {
  sleepStore.set((s) => ({ ...s, ...p }));
  const s = sleepStore.get();
  store('sleepOn', s.on ? '1' : '0');
  store('sleepFrom', String(s.from));
  store('sleepTo', String(s.to));
}

/** Within the sleep hours (which may run past midnight) */
export function isSleepTime(now: Date): boolean {
  const { on, from, to } = sleepStore.get();
  if (!on || from === to) return false;
  const m = now.getHours() * 60 + now.getMinutes();
  return from < to ? m >= from && m < to : m >= from || m < to;
}

declare global {
  interface Window {
    /** The kiosk app's bridge (dashboard/kiosk MainActivity); missing in a browser or older kiosks */
    HomeHQ?: { setBrightness(level: number): void };
  }
}

/**
 * Backlight for the kiosk window: 0 = lowest the panel allows, -1 = back to the system setting.
 * Does nothing outside the kiosk.
 */
export function setBacklight(level: number): void {
  try {
    window.HomeHQ?.setBrightness(level);
  } catch {
    /* an older kiosk without the bridge */
  }
}
