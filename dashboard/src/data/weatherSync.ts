// Keeps the weather and the verse of the day in step with the Worker (worker/weather.ts): loads them at
// start, then every 15 minutes and whenever the page becomes visible. The last ones loaded are kept
// on the device, so a reload shows real weather straight away instead of the samples.
import { api } from './api';
import { dataStore } from './store';
import { store, stored } from '../lib/store';
import type { Verse, Weather } from './types';

const REFRESH_MS = 15 * 60 * 1000;
const WEATHER = 'weather.last';
const VERSE = 'verse.last';

const kept = <T>(key: string): T | null => {
  try {
    return JSON.parse(stored(key, 'null')) as T | null;
  } catch {
    return null;
  }
};
const setWeather = (weather: Weather) => dataStore.set((d) => ({ ...d, weather }));
const setVerse = (verse: Verse) => dataStore.set((d) => ({ ...d, verse }));

async function refreshWeather(): Promise<void> {
  await Promise.all([
    api.weather().then((w) => { setWeather(w); store(WEATHER, JSON.stringify(w)); }, () => {}),
    api.verse().then((v) => { setVerse(v); store(VERSE, JSON.stringify(v)); }, () => {}),
  ]);
}

let started = false;
export function startWeatherSync(): void {
  if (started) return;
  started = true;
  const w = kept<Weather>(WEATHER);
  if (w?.now) setWeather(w); // (older saved shapes are skipped)
  const v = kept<Verse>(VERSE);
  if (v?.text) setVerse(v);
  void refreshWeather();
  setInterval(refreshWeather, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshWeather();
  });
}
