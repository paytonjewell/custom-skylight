// News: collects stories from the feeds into D1, and serves them to the News screen.
//
// Cost: a few feeds at a time. The cron trigger (wrangler.jsonc, every 5 minutes) refreshes up to
// PER_RUN feeds that are due, so each feed is checked about hourly and each run stays far inside the
// free plan's per-run CPU allowance. A check sends the feed's ETag / Last-Modified, so an unchanged feed
// answers "304 Not Modified" without being downloaded or parsed. /api/news does the same as a
// fallback when feeds are overdue (which is also how local dev, with no cron, stays current).
import type { NewsStory } from '../../src/data/types';
import { json } from '../http';
import { sha256, hex } from '../hash';
import { TOPICS, feedsFor, type Feed } from './feeds';
import { parseFeed, slim, type ParsedStory } from './parse';

const EVERY_MS = 60 * 60 * 1000; // how often each feed is checked
const RETRY_MS = 15 * 60 * 1000; // after a failed check, try again sooner
const PER_RUN = 3; // feeds refreshed per run
const PER_TOPIC = 30; // newest stories kept (and shown) per topic
const DAY = 24 * 3600 * 1000;
const KEEP_DAYS = 5; // default age limit (Feed.days)
const LIMIT = 15; // default stories taken from a feed (Feed.limit)
const UA = 'WhiteLotusHQ/1.0 (family dashboard; RSS reader)';

async function idFor(link: string): Promise<string> {
  // The same article from two feeds (or with tracking parameters) gets the same id
  let key = link;
  try {
    const u = new URL(link);
    u.hash = '';
    for (const p of [...u.searchParams.keys()]) if (/^(utm_|cmpid|ito|taid)/i.test(p)) u.searchParams.delete(p);
    key = u.toString();
  } catch {
    // not a URL; use as is
  }
  return hex((await sha256(key)).slice(0, 16));
}

interface FeedState {
  url: string;
  checked_at: number;
  etag: string | null;
  last_modified: string | null;
}

/** Feeds whose check is due, longest-waiting first (never-checked ones first of all) */
async function dueFeeds(env: Env, now: number): Promise<{ feed: Feed; state: FeedState | null }[]> {
  const { results } = await env.DB.prepare(
    'SELECT url, checked_at, etag, last_modified FROM news_feeds',
  ).all<FeedState>();
  const byUrl = new Map(results.map((r) => [r.url, r]));
  return feedsFor(env)
    .map((feed) => ({ feed, state: byUrl.get(feed.url) ?? null }))
    .filter(({ state }) => !state || now - state.checked_at >= EVERY_MS)
    .sort((a, b) => (a.state?.checked_at ?? 0) - (b.state?.checked_at ?? 0));
}

/** Check one feed; store new or changed stories. Returns how many stories it took. */
async function refreshFeed(env: Env, feed: Feed, state: FeedState | null, now: number): Promise<number> {
  // Left out (undefined): keep the stored ETag / Last-Modified. null: the site stopped sending one, so
  // forget it rather than keep sending a stale If-None-Match / If-Modified-Since.
  const setState = (s: {
    checked_at: number;
    etag?: string | null;
    last_modified?: string | null;
    error?: string | null;
  }) =>
    env.DB.prepare(
      `INSERT INTO news_feeds (url, checked_at, etag, last_modified, error) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET checked_at = excluded.checked_at, etag = excluded.etag,
         last_modified = excluded.last_modified, error = excluded.error`,
    )
      .bind(
        feed.url,
        s.checked_at,
        s.etag !== undefined ? s.etag : (state?.etag ?? null),
        s.last_modified !== undefined ? s.last_modified : (state?.last_modified ?? null),
        s.error ?? null,
      )
      .run();

  let res: Response;
  try {
    const headers: Record<string, string> = {
      'User-Agent': UA,
      Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8',
    };
    if (state?.etag) headers['If-None-Match'] = state.etag;
    if (state?.last_modified) headers['If-Modified-Since'] = state.last_modified;
    res = await fetch(feed.url, { headers, signal: AbortSignal.timeout(10_000) });
    if (res.status === 304) {
      await setState({ checked_at: now });
      return 0;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.warn('News feed failed', feed.url, String(e));
    await setState({ checked_at: now - EVERY_MS + RETRY_MS, error: String(e).slice(0, 200) });
    return 0;
  }

  const limit = feed.limit ?? LIMIT;
  const keepFrom = now - (feed.days ?? KEEP_DAYS) * DAY;
  let stories: ParsedStory[];
  try {
    stories = parseFeed(slim(await res.text(), limit + 10), feed);
  } catch (e) {
    console.warn('News feed unreadable', feed.url, String(e));
    await setState({ checked_at: now - EVERY_MS + RETRY_MS, error: 'Unreadable: ' + String(e).slice(0, 180) });
    return 0;
  }
  const fresh = stories
    .filter((s) => s.published >= keepFrom)
    .filter((s) => !feed.exclude || !(feed.exclude.test(s.source) || feed.exclude.test(s.title)))
    // Google News results from an outlet we already follow directly would be duplicates
    .filter(
      (s) =>
        !feed.google ||
        !feedsFor(env).some(
          (f) => !f.google && f.topic === feed.topic && f.source.toLowerCase() === s.source.toLowerCase(),
        ),
    )
    .sort((a, b) => b.published - a.published)
    .slice(0, limit);

  // New stories are added; known ones are only rewritten if they changed (no wasted writes). A story
  // already stored from another feed keeps its topic.
  const upsert = env.DB.prepare(
    `INSERT INTO news (id, feed, topic, source, title, summary, link, image, published_at, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, summary = excluded.summary, image = COALESCE(excluded.image, news.image)
     WHERE news.title IS NOT excluded.title OR news.summary IS NOT excluded.summary
       OR (excluded.image IS NOT NULL AND news.image IS NOT excluded.image)`,
  );
  const at = new Date(now).toISOString();
  const stmts = await Promise.all(
    fresh.map(async (s) =>
      upsert.bind(
        await idFor(s.link),
        feed.url,
        feed.topic,
        s.source,
        s.title,
        s.summary,
        s.link,
        s.image,
        new Date(Math.min(s.published, now)).toISOString(),
        at,
      ),
    ),
  );

  await env.DB.batch([
    ...stmts,
    // This feed's stories past its age limit, and anything beyond the topic's newest PER_TOPIC
    env.DB.prepare('DELETE FROM news WHERE feed = ? AND published_at < ?').bind(
      feed.url,
      new Date(keepFrom).toISOString(),
    ),
    env.DB.prepare(
      `DELETE FROM news WHERE topic = ? AND id NOT IN (
         SELECT id FROM news WHERE topic = ? ORDER BY published_at DESC LIMIT ?)`,
    ).bind(feed.topic, feed.topic, PER_TOPIC),
  ]);
  await setState({ checked_at: now, etag: res.headers.get('ETag'), last_modified: res.headers.get('Last-Modified') });
  return fresh.length;
}

/** Refresh up to `max` due feeds. Also clears out stories from feeds no longer in the list. */
export async function refreshNews(env: Env, max = PER_RUN): Promise<{ checked: number; stored: number }> {
  const now = Date.now();
  const due = (await dueFeeds(env, now)).slice(0, max);
  // Claim them first, so an overlapping run doesn't check the same feeds
  if (due.length) {
    const claim = env.DB.prepare(
      'INSERT INTO news_feeds (url, checked_at) VALUES (?, ?) ON CONFLICT(url) DO UPDATE SET checked_at = excluded.checked_at',
    );
    await env.DB.batch(due.map(({ feed }) => claim.bind(feed.url, now)));
  }
  let stored = 0;
  for (const { feed, state } of due) stored += await refreshFeed(env, feed, state, now);

  // The list goes in as one JSON parameter: D1 allows at most 100 bound parameters per query, and
  // LOCAL_NEWS can make the list any length
  const urls = JSON.stringify(feedsFor(env).map((f) => f.url));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM news WHERE feed NOT IN (SELECT value FROM json_each(?))').bind(urls),
    env.DB.prepare('DELETE FROM news_feeds WHERE url NOT IN (SELECT value FROM json_each(?))').bind(urls),
  ]);
  return { checked: due.length, stored };
}

interface Row {
  id: string;
  topic: string;
  source: string;
  title: string;
  summary: string;
  link: string;
  image: string | null;
  published_at: string;
}

/** GET /api/news: { topics, updated, stories } — each topic's newest PER_TOPIC stories */
export async function getNews(env: Env, ctx: ExecutionContext): Promise<Response> {
  // Overdue feeds (no cron locally, or a missed run): refresh a few after answering
  if ((await dueFeeds(env, Date.now())).length) {
    ctx.waitUntil(refreshNews(env).catch((e) => console.error('News refresh failed', e)));
  }
  const { results } = await env.DB.prepare(
    `SELECT id, topic, source, title, summary, link, image, published_at FROM (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY topic ORDER BY published_at DESC) AS n FROM news
     ) WHERE n <= ? ORDER BY published_at DESC`,
  )
    .bind(PER_TOPIC)
    .all<Row>();
  // The same headline from two feeds in a topic (sister outlets, a site's overlapping feeds): once,
  // the newest copy
  const seen = new Set<string>();
  const stories: NewsStory[] = results
    .filter((r) => {
      const key =
        r.topic +
        ':' +
        r.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((r) => ({
      id: r.id,
      topic: r.topic,
      source: r.source,
      title: r.title,
      summary: r.summary,
      link: r.link,
      img: r.image,
      published: r.published_at,
    }));
  const last = await env.DB.prepare('SELECT MAX(checked_at) AS t FROM news_feeds WHERE error IS NULL').first<{
    t: number | null;
  }>();
  return json({ topics: TOPICS, updated: new Date(last?.t ?? Date.now()).toISOString(), stories });
}
