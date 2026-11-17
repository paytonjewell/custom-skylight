// Weather for home (HOME_LAT/HOME_LON, worker/home.ts) from Open-Meteo (free, no key), and the verse of the day (NLT) from
// Bible Gateway. Each is kept in the config table and shared by every screen: the weather is refreshed
// every 15 minutes (by the cron, or when the app asks and it's older), the verse once a day.
import type { Verse, Weather, WxCond } from '../src/data/types';
import { home, type Home } from './home';
import { json } from './photos';

const VERSION = 'NLT';
const WEATHER_MS = 15 * 60 * 1000;
const UA = 'WhiteLotusHQ/1.0 (family dashboard)';

const getConfig = async <T>(env: Env, key: string): Promise<T | null> => {
  const row = await env.DB.prepare('SELECT value FROM config WHERE key = ?').bind(key).first<{ value: string }>();
  return row ? (JSON.parse(row.value) as T) : null;
};
const setConfig = (env: Env, key: string, value: unknown) =>
  env.DB.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, JSON.stringify(value)).run();

/** Today's date at home ('YYYY-MM-DD') */
const homeDay = (tz: string, at = new Date()) => at.toLocaleDateString('en-CA', { timeZone: tz });

// ------------------------------------------------------------ weather
/** Open-Meteo's weather code (WMO) → our condition; clear and partly cloudy differ by day and night */
export function condition(code: number, day: boolean): WxCond {
  if (code <= 1) return day ? 'sun' : 'moon';
  if (code === 2) return day ? 'partly' : 'moon';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'rain'; // drizzle, rain, freezing rain, showers
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8];

const SYNODIC = 29.530588853;
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // a known new moon
const MOON_PHASES: [number, string][] = [
  [1.85, 'New moon'], [5.54, 'Waxing crescent'], [9.23, 'First quarter'], [12.92, 'Waxing gibbous'], [16.61, 'Full moon'],
  [20.3, 'Waning gibbous'], [23.99, 'Last quarter'], [27.68, 'Waning crescent'], [99, 'New moon'],
];
/** The moon on a date: phase, % lit, and the days of the next full and new moons (to within about a day) */
export function moon(at: Date, tz = 'UTC'): Weather['moon'] {
  const days = (at.getTime() - NEW_MOON) / 864e5;
  const age = ((days % SYNODIC) + SYNODIC) % SYNODIC;
  const lunation = Math.floor(days / SYNODIC);
  const day = (n: number) => homeDay(tz, new Date(NEW_MOON + n * SYNODIC * 864e5));
  const full = lunation + 0.5 > days / SYNODIC ? lunation + 0.5 : lunation + 1.5;
  return {
    phase: MOON_PHASES.find(([d]) => age < d)![1],
    lit: Math.round(((1 - Math.cos((2 * Math.PI * age) / SYNODIC)) / 2) * 100),
    waxing: age < SYNODIC / 2,
    full: day(full),
    new: day(lunation + 1),
  };
}

interface OpenMeteo {
  current: {
    time: string; temperature_2m: number; apparent_temperature: number; relative_humidity_2m: number; dew_point_2m: number;
    wind_speed_10m: number; wind_gusts_10m: number; wind_direction_10m: number; weather_code: number; is_day: number;
  };
  hourly: { time: string[]; temperature_2m: number[]; weather_code: number[]; precipitation_probability: (number | null)[]; is_day: number[] };
  daily: {
    time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[];
    precipitation_probability_max: (number | null)[]; sunrise: string[]; sunset: string[]; uv_index_max: (number | null)[];
  };
}

/** Open-Meteo's answer → ours: today and tomorrow by the hour (from midnight today), and each day for a week */
export function toWeather(o: OpenMeteo, at: Date, place: Pick<Home, 'name' | 'tz'> = { name: '', tz: 'UTC' }): Weather {
  const r = Math.round;
  const H = o.hourly, D = o.daily, C = o.current;
  const hours = H.time.slice(0, 48).map((_, i) => i);
  return {
    place: place.name,
    day: D.time[0],
    updated: at.toISOString(),
    now: { t: r(C.temperature_2m), c: condition(C.weather_code, !!C.is_day), feels: r(C.apparent_temperature) },
    hi: r(D.temperature_2m_max[0]),
    lo: r(D.temperature_2m_min[0]),
    humidity: r(C.relative_humidity_2m),
    dew: r(C.dew_point_2m),
    uv: r(D.uv_index_max[0] ?? 0),
    wind: r(C.wind_speed_10m),
    gust: r(C.wind_gusts_10m),
    windDir: compass(C.wind_direction_10m),
    sunrise: D.sunrise[0].slice(11, 16),
    sunset: D.sunset[0].slice(11, 16),
    moon: moon(at, place.tz),
    daily: D.time.map((_, d) => d).map((d) => {
      const p = D.precipitation_probability_max[d] ?? 0;
      const c = condition(D.weather_code[d], true);
      // A day Open-Meteo calls wet but gives little chance of it: show it as cloudy
      return { d, c: p < 30 && (c === 'rain' || c === 'snow' || c === 'storm') ? 'cloud' : c, hi: r(D.temperature_2m_max[d]), lo: r(D.temperature_2m_min[d]), p };
    }),
    t: hours.map((i) => r(H.temperature_2m[i])),
    c: hours.map((i) => condition(H.weather_code[i], !!H.is_day[i])),
    p: hours.map((i) => H.precipitation_probability[i] ?? 0),
  };
}

/** The forecast for home, fetched now and kept; null when home isn't set */
export async function refreshWeather(env: Env): Promise<Weather | null> {
  const place = home(env);
  if (!place) return null;
  const q = new URLSearchParams({
    latitude: String(place.lat), longitude: String(place.lon), timezone: place.tz,
    temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', forecast_days: '8',
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code,is_day',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max',
  });
  const res = await fetch('https://api.open-meteo.com/v1/forecast?' + q, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('Open-Meteo ' + res.status);
  const w = toWeather(await res.json<OpenMeteo>(), new Date(), place);
  await setConfig(env, 'weather', w);
  return w;
}

/** GET /api/weather: the kept forecast; one that's 15 minutes old is refreshed after (or first, if hours old) */
export async function getWeather(env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!home(env)) return json({ error: 'Set HOME_LAT and HOME_LON for the weather' }, 404);
  const w = await getConfig<Weather>(env, 'weather');
  const age = w ? Date.now() - Date.parse(w.updated) : Infinity;
  if (age > 3 * 3600 * 1000) {
    try {
      return json((await refreshWeather(env))!);
    } catch (e) {
      console.warn('Weather', e);
      return w ? json(w) : json({ error: 'Weather unavailable' }, 502);
    }
  }
  if (age > WEATHER_MS) ctx.waitUntil(refreshWeather(env).catch((e) => console.warn('Weather', e)));
  return json(w);
}

// ------------------------------------------------------------ verse of the day
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', mdash: '—', ndash: '–', hellip: '…' };
/** Bible Gateway's text → plain text: no tags, entities, verse numbers or outer quotes */
export function plainVerse(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(parseInt(e.slice(e[1] === 'x' ? 2 : 1), e[1] === 'x' ? 16 : 10)) : (ENTITIES[e.toLowerCase()] ?? m))
    .replace(/\[\d+\]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[“"](.*)[”"]$/s, '$1');
}

interface Votd { votd?: { rawtext?: string; content?: string; display_ref?: string; version_id?: string } }
type KeptVerse = Verse & { day: string };

/** GET /api/verse: today's verse of the day (fetched once a day; yesterday's if Bible Gateway is down) */
export async function getVerse(env: Env): Promise<Response> {
  const today = homeDay(home(env)?.tz ?? 'UTC');
  const kept = await getConfig<KeptVerse>(env, 'verse');
  if (kept?.day === today) return json(kept);
  try {
    const res = await fetch(`https://www.biblegateway.com/votd/get/?format=json&version=${VERSION}`, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error('Bible Gateway ' + res.status);
    const v = (await res.json<Votd>()).votd;
    const text = plainVerse(v?.rawtext || v?.content || '');
    if (!text || !v?.display_ref) throw new Error('Bible Gateway: no verse');
    const verse: KeptVerse = { day: today, ref: plainVerse(v.display_ref), text, version: v.version_id || VERSION };
    await setConfig(env, 'verse', verse);
    return json(verse);
  } catch (e) {
    console.warn('Verse', e);
    return kept ? json(kept) : json({ error: 'Verse unavailable' }, 502);
  }
}
