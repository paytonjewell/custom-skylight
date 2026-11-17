-- News stories collected from RSS/Atom feeds (worker/news). Each feed is checked about hourly; each
-- topic keeps its 30 newest stories.
CREATE TABLE news (
  -- Hash of the article link (so the same story from two feeds is stored once)
  id TEXT PRIMARY KEY,
  -- URL of the feed it came from
  feed TEXT NOT NULL,
  topic TEXT NOT NULL,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  link TEXT NOT NULL,
  image TEXT,
  published_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
CREATE INDEX news_topic_published ON news (topic, published_at);
CREATE INDEX news_feed_published ON news (feed, published_at);

-- Each feed's last check, so feeds are refreshed a few at a time (about hourly each), and so the next
-- check can ask the site whether anything changed (ETag / Last-Modified) instead of downloading it all.
CREATE TABLE news_feeds (
  url TEXT PRIMARY KEY,
  -- When it was last checked (ms since epoch)
  checked_at INTEGER NOT NULL,
  etag TEXT,
  last_modified TEXT,
  -- Last error, if the check failed
  error TEXT
);
