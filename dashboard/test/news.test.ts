// Tests for worker/news/parse.ts: RSS and Atom feeds become plain stories
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseFeed, slim } from '../worker/news/parse.ts';
import type { Feed } from '../worker/news/feeds.ts';

const feed: Feed = { topic: 'tech', source: 'Example News', url: 'https://example.com/feed' };

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>Example</title>
  <item>
    <title>Robots &amp; rockets</title>
    <link>https://example.com/robots?utm_source=rss</link>
    <pubDate>Mon, 16 Nov 2026 14:00:00 GMT</pubDate>
    <description><![CDATA[<p>Robots built a <b>rocket</b>.</p> The post Robots appeared first on Example.]]></description>
    <media:content url="https://img.example.com/small.jpg" medium="image" width="300"/>
    <media:content url="https://img.example.com/big.jpg" medium="image" width="1200"/>
  </item>
  <item>
    <title>Second story</title>
    <guid>https://example.com/second</guid>
    <description>Plain &amp;quot;text&amp;quot;</description>
    <enclosure url="http://img.example.com/second.png" type="image/png"/>
  </item>
  <item>
    <title></title>
    <link>https://example.com/untitled</link>
  </item>
</channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom example</title>
  <entry>
    <title type="html">Atom &amp;amp; friends</title>
    <link rel="alternate" href="https://atom.example/one"/>
    <link rel="enclosure" href="https://atom.example/one.mp3"/>
    <updated>2026-11-15T09:30:00Z</updated>
    <summary>Short summary</summary>
    <content type="html">&lt;p&gt;Long &lt;img src="https://atom.example/pic.webp"&gt; body&lt;/p&gt;</content>
  </entry>
</feed>`;

test('RSS items: headline, summary, link, the widest image and the date', () => {
  const [one, two, ...rest] = parseFeed(RSS, feed);
  assert.deepEqual(one, {
    title: 'Robots & rockets',
    summary: 'Robots built a rocket .',
    link: 'https://example.com/robots?utm_source=rss',
    image: 'https://img.example.com/big.jpg',
    published: Date.parse('2026-11-16T14:00:00Z'),
    source: 'Example News',
  });
  // A guid that's a link stands in for a missing <link>; images are made https
  assert.equal(two.link, 'https://example.com/second');
  assert.equal(two.summary, 'Plain "text"');
  assert.equal(two.image, 'https://img.example.com/second.png');
  // No headline: skipped
  assert.equal(rest.length, 0);
});

test('Atom entries: the alternate link, and an image from the content', () => {
  const stories = parseFeed(slim(ATOM, 10), feed);
  assert.equal(stories.length, 1);
  assert.equal(stories[0].title, 'Atom & friends');
  assert.equal(stories[0].link, 'https://atom.example/one');
  assert.equal(stories[0].summary, 'Short summary');
  assert.equal(stories[0].image, 'https://atom.example/pic.webp');
  assert.equal(stories[0].published, Date.parse('2026-11-15T09:30:00Z'));
});

test('Google News: the outlet comes from each item, and its summary is dropped', () => {
  const google = `<rss><channel><item>
    <title>Hawkeyes win again - The Gazette</title>
    <link>https://news.google.com/articles/abc</link>
    <source url="https://thegazette.com">The Gazette</source>
    <description>&lt;a href="x"&gt;links&lt;/a&gt;</description>
  </item></channel></rss>`;
  const [s] = parseFeed(google, { ...feed, google: true });
  assert.equal(s.title, 'Hawkeyes win again');
  assert.equal(s.source, 'The Gazette');
  assert.equal(s.summary, '');
  assert.equal(s.image, null);
});

test('slim keeps only the first items', () => {
  assert.equal(parseFeed(slim(RSS, 1), feed).length, 1);
});
