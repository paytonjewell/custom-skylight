// The household's own settings, kept out of the code: where home is (weather, the date), who lives
// there (the people on every screen), and the local news. Each is a Worker secret (`wrangler secret
// put NAME`, or .dev.vars locally); see .dev.vars.example. Without them the app still runs: no
// weather, sample people and no local news.
import type { Person } from '../src/data/types';
import type { Feed } from './news/feeds';
import { json } from './http';
import { validTz } from './validate';

export interface Home {
  /** Shown with the weather */
  name: string;
  lat: number;
  lon: number;
  /** IANA time zone, e.g. America/Chicago */
  tz: string;
}

/** HOME_PLACE, HOME_LAT, HOME_LON and HOME_TZ; null until the coordinates are set */
export function home(env: Env): Home | null {
  const lat = Number(env.HOME_LAT),
    lon = Number(env.HOME_LON);
  if (!env.HOME_LAT || !env.HOME_LON || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { name: env.HOME_PLACE || '', lat, lon, tz: validTz(env.HOME_TZ) ? env.HOME_TZ : 'UTC' };
}

/** Who the dashboard shows when FAMILY isn't set */
const SAMPLE_FAMILY: Person[] = [
  { id: 'john', name: 'John', tone: 1 },
  { id: 'mary', name: 'Mary', tone: 2 },
  { id: 'jacob', name: 'Jacob', age: 10, tone: 3 },
  { id: 'pets', name: 'Pets', pet: true, tone: 4 },
];

/**
 * FAMILY: a JSON list of people, in the order they're shown, e.g.
 * [{"id":"john","name":"John"},{"id":"jacob","name":"Jacob","age":10},{"id":"pets","name":"Pets","pet":true}]
 * Ids are stored with tasks, events and reminders, so don't change one once it's in use. Each person
 * gets the next colour (tone 1–4) unless they name one ("tone": 1–4). "tasks": false keeps someone
 * off the task screens (calendar only); "calendar": false makes a tasks-only profile, such as a
 * project's to-do list, that isn't on the calendar or part of "everyone".
 */
function family(env: Env): Person[] {
  if (!env.FAMILY) return SAMPLE_FAMILY;
  try {
    const list = JSON.parse(env.FAMILY) as Partial<Person>[];
    const people = list
      .filter(
        (p) =>
          p && typeof p.id === 'string' && p.id && p.id !== 'any' && p.id !== 'family' && typeof p.name === 'string',
      )
      .map(
        (p, i): Person => ({
          id: p.id!,
          name: p.name!,
          tone: typeof p.tone === 'number' ? p.tone : (i % 4) + 1,
          ...(typeof p.age === 'number' ? { age: p.age } : {}),
          ...(p.pet ? { pet: true } : {}),
          ...(p.tasks === false ? { tasks: false as const } : {}),
          ...(p.calendar === false ? { calendar: false as const } : {}),
        }),
      );
    return people.length ? people : SAMPLE_FAMILY;
  } catch (e) {
    console.warn('FAMILY is not valid JSON', e);
    return SAMPLE_FAMILY;
  }
}

/** GET /api/family */
export const getFamily = (env: Env): Response => json(family(env));

/**
 * LOCAL_NEWS: a JSON list of the Local topic's sources. Each is a feed ({"source":"WPR","url":"https://…"})
 * or a Google News search for a place ({"search":"Springfield"}). limit and days work as in feeds.ts.
 */
export function localFeeds(env: Env): Feed[] {
  if (!env.LOCAL_NEWS) return [];
  try {
    const list = JSON.parse(env.LOCAL_NEWS) as {
      source?: string;
      url?: string;
      search?: string;
      limit?: number;
      days?: number;
    }[];
    return list.flatMap((f): Feed[] => {
      const extra = { ...(f.limit ? { limit: f.limit } : {}), ...(f.days ? { days: f.days } : {}) };
      if (f.search) {
        return [
          {
            topic: 'local',
            source: 'Google News',
            url: googleNews(`${f.search} when:14d`),
            google: true,
            limit: 20,
            days: 10,
            ...extra,
            // obituary sites and game-stream/schedule listings
            exclude: /obituar|legacy|tribute archive|funeral|maxpreps|nfhs network|hudl/i,
          },
        ];
      }
      if (f.url && f.source) return [{ topic: 'local', source: f.source, url: f.url, ...extra }];
      return [];
    });
  } catch (e) {
    console.warn('LOCAL_NEWS is not valid JSON', e);
    return [];
  }
}

export const googleNews = (q: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
