// Keeps the weather and the verse of the day in step with the Worker (worker/weather.ts; see
// createSync, src/data/sync.ts). The last ones loaded are kept on the device, so a reload shows real
// weather straight away.
import { api } from './api';
import { dataStore } from './store';
import { createSync } from './sync';
import type { Verse, Weather } from './types';

/** Each loads on its own: when one fails, the other still updates and the failed one keeps its last value */
async function load(): Promise<{ weather: Weather | null; verse: Verse | null }> {
  const [w, v] = await Promise.allSettled([api.weather(), api.verse()]);
  if (w.status === 'rejected' && v.status === 'rejected') throw w.reason;
  return { weather: w.status === 'fulfilled' ? w.value : null, verse: v.status === 'fulfilled' ? v.value : null };
}

const sync = createSync({
  load,
  apply: ({ weather, verse }) =>
    dataStore.set((d) => ({ ...d, weather: weather ?? d.weather, verse: verse ?? d.verse })),
  keep: 'weather.last',
  valid: ({ weather, verse }) => (!weather || !!weather.now) && (!verse || !!verse.text),
  refreshMs: 15 * 60 * 1000,
});

export const startWeatherSync = () => sync.start();
