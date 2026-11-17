// Turns an RSS 2.0 or Atom feed into plain stories: headline, short summary, link, image, date.
import { XMLParser } from 'fast-xml-parser';
import type { Feed } from './feeds';

export interface ParsedStory {
  title: string;
  summary: string;
  link: string;
  image: string | null;
  published: number;
  source: string;
}

const ARRAYS = new Set(['item', 'entry', 'link', 'media:content', 'media:thumbnail', 'enclosure']);
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ARRAYS.has(name),
});

// fast-xml-parser hands back strings, or objects with '#text' when an element has attributes
const text = (v: unknown): string =>
  typeof v === 'string'
    ? v
    : typeof v === 'number'
      ? String(v)
      : v && typeof v === 'object'
        ? text((v as Record<string, unknown>)['#text'])
        : '';
const attr = (v: unknown, name: string): string =>
  v && typeof v === 'object' ? String((v as Record<string, unknown>)['@_' + name] ?? '') : '';
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
};
/** Decode HTML entities left in feed text (summaries are often HTML inside CDATA) */
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** HTML → one tidy line of text, cut at a word boundary */
function plain(html: string, max = 320): string {
  let s = decode(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '));
  s = decode(s) // some feeds encode twice
    .replace(/\s+/g, ' ')
    .replace(/The post .* appeared first on .*\.?$/i, '') // WordPress footer (TorrentFreak, Variety…)
    .replace(/\s*(Continue reading|Read more)…?\s*$/i, '')
    .trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ') > max * 0.6 ? cut.lastIndexOf(' ') : max).replace(/[,;:\s]+$/, '') + '…';
}

const https = (u: string) => u.replace(/^http:\/\//i, 'https://');
const isImage = (url: string, type = '', medium = '') =>
  medium === 'image' || type.startsWith('image/') || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url);

/** The best image for an item, from wherever this feed puts it */
function imageOf(item: Record<string, unknown>, html: string): string | null {
  const media = [
    ...list(item['media:content']),
    ...list((item['media:group'] as Record<string, unknown> | undefined)?.['media:content']),
  ].filter((m) => isImage(attr(m, 'url'), attr(m, 'type'), attr(m, 'medium')));
  if (media.length) {
    // the widest one, when sizes are given
    media.sort((a, b) => Number(attr(b, 'width') || 0) - Number(attr(a, 'width') || 0));
    return https(decode(attr(media[0], 'url')));
  }
  const thumb = list(item['media:thumbnail'])[0];
  if (thumb && attr(thumb, 'url')) return https(decode(attr(thumb, 'url')));
  const enc = list(item.enclosure).find((e) => isImage(attr(e, 'url'), attr(e, 'type')));
  if (enc) return https(decode(attr(enc, 'url')));
  const img = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return img ? https(decode(img[1])) : null;
}

function linkOf(item: Record<string, unknown>): string {
  const links = list(item.link);
  // Atom: <link rel="alternate" href="..."/>; RSS: <link>url</link>
  const atom = links.find((l) => attr(l, 'href') && (!attr(l, 'rel') || attr(l, 'rel') === 'alternate'));
  if (atom) return attr(atom, 'href');
  const rss = links.map(text).find(Boolean);
  if (rss) return rss;
  const guid = text(item.guid);
  return /^https?:\/\//.test(guid) ? guid : '';
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Cut a feed down before parsing, which is most of the CPU cost: keep only its first `limit` items, and
 * replace each full article body (Fox's feeds carry every article in full) with its first image and
 * a short text snippet, which is all we use. Turns ~10 ms of parsing into ~1-2 ms.
 */
export function slim(xml: string, limit: number): string {
  const atom = /<feed[\s>]/.test(xml.slice(0, 2000));
  const close = atom ? '</entry>' : '</item>';
  let at = -1;
  for (let k = 0; k < limit; k++) {
    const j = xml.indexOf(close, at + 1);
    if (j < 0) {
      at = -1;
      break;
    }
    at = j;
  }
  if (at >= 0) xml = xml.slice(0, at + close.length) + (atom ? '</feed>' : '</channel></rss>');
  return xml.replace(
    /<(content:encoded|content)(\s[^>]*)?>([\s\S]*?)<\/\1>/g,
    (_m, tag: string, attrs = '', body: string) => {
      const raw = body.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '');
      const html = raw.includes('&lt;') && !raw.includes('<') ? decode(raw) : raw; // Atom: escaped HTML
      const img = html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
      const snippet = decode(html.replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 600);
      return `<${tag}${attrs}>${escapeXml((img ? `<img src="${img}"> ` : '') + snippet)}</${tag}>`;
    },
  );
}

export function parseFeed(xml: string, feed: Feed): ParsedStory[] {
  const doc = parser.parse(xml) as Record<string, Record<string, unknown>>;
  const items = (
    list(doc.rss?.channel && (doc.rss.channel as Record<string, unknown>).item).length
      ? list((doc.rss.channel as Record<string, unknown>).item)
      : list(doc.feed?.entry)
  ) as Record<string, unknown>[];

  const out: ParsedStory[] = [];
  for (const item of items) {
    const html = text(item['content:encoded']) || text(item.content) || text(item.description) || text(item.summary);
    let title = plain(text(item.title), 200);
    const link = linkOf(item);
    if (!title || !link) continue;
    let source = feed.source;
    let summary = plain(text(item.description) || text(item.summary) || html);
    if (feed.google) {
      // "Headline - Outlet": the outlet is also in <source>; the description is only links
      source = text(item.source) || source;
      title = title.replace(new RegExp(`\\s+-\\s+${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
      summary = '';
    }
    const when = Date.parse(text(item.pubDate) || text(item.published) || text(item.updated) || text(item['dc:date']));
    out.push({
      title,
      summary: summary === title ? '' : summary,
      link,
      image: feed.google ? null : imageOf(item, html),
      published: Number.isFinite(when) ? when : Date.now(),
      source,
    });
  }
  return out;
}
