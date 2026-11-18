// News refreshes (worker/news/news.ts) against a real local D1
import { env } from 'cloudflare:test';
import { afterEach, expect, test, vi } from 'vitest';
import { refreshNews } from '../../worker/news/news';
import { feedsFor } from '../../worker/news/feeds';

afterEach(() => {
  vi.unstubAllGlobals();
});

const item = (title: string, at: number) =>
  `<item><title>${title}</title><link>https://example.com/${encodeURIComponent(title)}</link><pubDate>${new Date(at).toUTCString()}</pubDate></item>`;

test('a full topic doesn’t take stories older than its newest 30 (they’d only be trimmed again)', async () => {
  const feeds = feedsFor(env);
  const feed = feeds.find((f) => !f.google && !f.exclude)!;
  const now = Date.now(),
    hour = 3600_000;
  // Every other feed was just checked, so only this one is due
  const claim = env.DB.prepare('INSERT OR REPLACE INTO news_feeds (url, checked_at) VALUES (?, ?)');
  await env.DB.batch(feeds.filter((f) => f !== feed).map((f) => claim.bind(f.url, now)));
  // The topic already holds 30 stories from the last 30 hours
  const store = env.DB.prepare(
    "INSERT INTO news (id, feed, topic, source, title, summary, link, image, published_at, fetched_at) VALUES (?, ?, ?, 'S', ?, '', ?, NULL, ?, ?)",
  );
  await env.DB.batch(
    Array.from({ length: 30 }, (_, n) =>
      store.bind(
        `kept${n}`,
        feed.url,
        feed.topic,
        `Kept ${n}`,
        `https://example.com/kept${n}`,
        new Date(now - (n + 1) * hour).toISOString(),
        new Date(now).toISOString(),
      ),
    ),
  );

  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(
        `<rss><channel>${item('Newest', now - hour / 2)}${item('Too old', now - 40 * hour)}</channel></rss>`,
      ),
  );
  expect(await refreshNews(env, 1)).toEqual({ checked: 1, stored: 1 });

  const titles = (
    await env.DB.prepare('SELECT title FROM news WHERE topic = ? ORDER BY published_at DESC')
      .bind(feed.topic)
      .all<{ title: string }>()
  ).results.map((r) => r.title);
  expect(titles).toHaveLength(30);
  expect(titles[0]).toBe('Newest');
  expect(titles).not.toContain('Too old');
});
