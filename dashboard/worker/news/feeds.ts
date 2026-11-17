// The news sources. Each feed belongs to one topic; topics show in this order on the News screen.
// To add a source: find its RSS/Atom feed URL (often /feed or /rss on the site) and add a line.
// Google News searches (news.google.com/rss/search?q=...) cover places and teams without a feed.
import { googleNews, localFeeds } from '../home';

export const TOPICS: [id: string, label: string][] = [
  ['top', 'Top'],
  ['local', 'Local'],
  ['world', 'World'],
  ['military', 'Military'],
  ['tech', 'Tech'],
  ['arr', 'Arr'],
  ['entertainment', 'Entertainment'],
  ['sports', 'Sports'],
];

export interface Feed {
  topic: string;
  /** Shown on each story */
  source: string;
  url: string;
  /** Google News: each item names its own outlet, and its summary is just a list of links */
  google?: boolean;
  /** Most stories kept from this feed (default 15). Lower it for feeds that post constantly. */
  limit?: number;
  /** How long its stories are kept (default 5 days). Longer for feeds that post rarely. */
  days?: number;
  /** Skip stories whose outlet or headline matches (e.g. obituaries in a Google News search) */
  exclude?: RegExp;
}


export const FEEDS: Feed[] = [
  // Top: politics and national news
  { topic: 'top', source: 'Fox News', url: 'https://moxie.foxnews.com/google-publisher/politics.xml' },
  { topic: 'top', source: 'Fox News', url: 'https://moxie.foxnews.com/google-publisher/us.xml' },
  { topic: 'top', source: 'The Hill', url: 'https://thehill.com/homenews/feed/' },
  { topic: 'top', source: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },

  // Local: from the LOCAL_NEWS secret (worker/home.ts), so where home is stays out of the code

  { topic: 'world', source: 'Fox News', url: 'https://moxie.foxnews.com/google-publisher/world.xml' },
  { topic: 'world', source: 'BBC', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },

  // Military: news for and about the services, defense, and the Department of Defense's own news
  { topic: 'military', source: 'Military Times', url: 'https://www.militarytimes.com/arc/outboundfeeds/rss/?outputType=xml', limit: 8 },
  { topic: 'military', source: 'Military.com', url: 'https://www.military.com/rss-feeds/content?keyword=headlines&channel=news&type=news', limit: 8 },
  { topic: 'military', source: 'Task & Purpose', url: 'https://taskandpurpose.com/feed/', limit: 8 },
  { topic: 'military', source: 'The War Zone', url: 'https://www.twz.com/feed', limit: 8 },
  { topic: 'military', source: 'Defense News', url: 'https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml', limit: 8 },
  { topic: 'military', source: 'DoD News', url: 'https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=10', limit: 6, days: 7 },

  { topic: 'tech', source: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
  { topic: 'tech', source: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { topic: 'tech', source: 'Fox News', url: 'https://moxie.foxnews.com/google-publisher/tech.xml' },

  { topic: 'arr', source: 'TorrentFreak', url: 'https://torrentfreak.com/feed/', days: 14 },

  { topic: 'entertainment', source: 'Fox News', url: 'https://moxie.foxnews.com/google-publisher/entertainment.xml' },
  { topic: 'entertainment', source: 'Variety', url: 'https://variety.com/feed/' },
  { topic: 'entertainment', source: 'Deadline', url: 'https://deadline.com/feed/' },

  // Sports: Green Bay Packers and Iowa Hawkeyes
  { topic: 'sports', source: 'Packers.com', url: 'https://www.packers.com/rss/news' },
  { topic: 'sports', source: 'Acme Packing Company', url: 'https://www.acmepackingcompany.com/rss/index.xml' },
  { topic: 'sports', source: 'Black Heart Gold Pants', url: 'https://www.blackheartgoldpants.com/rss/index.xml' },
  { topic: 'sports', source: 'Google News', url: googleNews('"Iowa Hawkeyes" when:7d'), google: true, limit: 10 },
];

/** Every feed: the ones above plus this home's local ones */
export const feedsFor = (env: Env): Feed[] => [...FEEDS, ...localFeeds(env)];
