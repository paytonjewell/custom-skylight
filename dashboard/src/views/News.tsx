// News: a lead s plus a scrollable list of headlines, by topic. Stories come from the news feeds
// the Worker collects (worker/news/feeds.ts). Tap a s for its summary; "Read full s" opens
// the article, and on the frame layout a QR code takes it to your phone.
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { createStore, store, stored, useStore } from '../lib/store';
import { useHoldReorder } from '../ui/useHoldReorder';
import type { NewsStory } from '../data/types';
import { useData } from '../data/store';
import { useNewsStatus, useNewsUpdated } from '../data/newsSync';
import { fmt } from '../lib/fmt';
import { useNow } from '../lib/clock';
import { openSheet } from '../app/ui';
import { IS_KIOSK, useLayout } from '../app/layout';
import { Icon } from '../ui/Icon';
import { Segmented } from '../ui/Segmented';
import { PageHeader, SheetHeader } from '../ui/headers';
import { EmptyNote } from '../ui/EmptyNote';
import css from './News.module.css';

function ago(iso: string, now: Date): string {
  const m = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + ' hr ago';
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : d + ' days ago';
}

/** News images come from the outlets' sites; one that fails to load just disappears */
const Img = ({ src }: { src: string }) => (
  <img
    src={src}
    alt=""
    loading="lazy"
    referrerPolicy="no-referrer"
    onError={(e: SyntheticEvent<HTMLImageElement>) => {
      e.currentTarget.style.visibility = 'hidden';
    }}
  />
);

/** The topic tabs' order, saved on this device (ids; null: the server's order) */
const topicOrder = createStore<string[] | null>(
  (() => {
    try {
      const v = JSON.parse(stored('news.order', 'null'));
      return Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  })(),
);
const setTopicOrder = (ids: string[]) => {
  topicOrder.set(ids);
  store('news.order', JSON.stringify(ids));
};
const inOrder = (topics: [string, string][], saved: string[] | null): [string, string][] =>
  !saved
    ? topics
    : [...saved.flatMap((id) => topics.filter((t) => t[0] === id)), ...topics.filter((t) => !saved.includes(t[0]))];

export function News() {
  const data = useData('news', 'newsTopics');
  const now = useNow();
  const status = useNewsStatus();
  const updated = useNewsUpdated();
  // In the order dragged on this device (hold a tab, then drag it); new topics go at the end
  const saved = useStore(topicOrder, (o) => o);
  const topics = inOrder(data.newsTopics, saved);
  const root = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const reorder = useHoldReorder({
    ids: topics.map((t) => t[0]),
    onCommit: setTopicOrder,
    container: root,
    scroller: tabs,
  });
  const shownTopics = reorder.order.map((id) => topics.find((t) => t[0] === id)!).filter(Boolean);
  const [picked, setPicked] = useState('top');
  // The topic list comes from the server; fall back to the first if the picked one went away
  const topic = topics.some((t) => t[0] === picked) ? picked : (topics[0]?.[0] ?? 'top');
  const topicName = (id: string) => topics.find((t) => t[0] === id)?.[1] ?? id;

  const list = data.news.filter((s) => s.topic === topic); // newest first, from the server
  // Lead: the newest s with a picture (else the newest)
  const lead = list.find((s) => s.img) ?? list[0];
  const rest = list.filter((s) => s !== lead);

  const kicker = (s: NewsStory) => (
    <span className={css.kicker + ' label label--sm'}>
      <b>{s.source}</b> · {ago(s.published, now)}
    </span>
  );
  const show = (s: NewsStory) => openStory(s, topicName(s.topic));

  const head =
    status === 'loading'
      ? 'Loading the news…'
      : status === 'error' && !data.news.length
        ? 'Couldn’t load the news'
        : `Updated ${updated ? fmt.time(updated) : '–'} · ${list.length} stories`;

  return (
    <div className={css.news} ref={root}>
      <PageHeader kicker={head} title="News">
        {topics.length > 0 && (
          <Segmented
            className={css.topics}
            options={shownTopics}
            value={topic}
            onChange={setPicked}
            move={reorder.itemProps}
            lifted={reorder.ghost?.id}
            boxRef={tabs}
          />
        )}
      </PageHeader>
      {reorder.ghost && (
        <div className={css.tabGhost} style={reorder.ghostStyle}>
          {topicName(reorder.ghost.id)}
        </div>
      )}
      {!lead ? (
        status !== 'loading' && (
          <EmptyNote large className={css.empty}>
            No {topicName(topic)} stories right now.
            <br />
            <i>Check back in a bit.</i>
          </EmptyNote>
        )
      ) : (
        <div className={css.body}>
          <button
            className={css.lead + ' surface' + (lead.img ? '' : ' ' + css.leadTextOnly)}
            onClick={() => show(lead)}
          >
            {lead.img && (
              <span className={css.leadImg + ' ' + css.media}>
                <Img src={lead.img} />
              </span>
            )}
            <span className={css.leadText}>
              {kicker(lead)}
              <span className={css.leadTitle + ' serif'}>{lead.title}</span>
              {lead.summary && <span className={css.leadSum}>{lead.summary}</span>}
            </span>
          </button>
          <div className={css.list} data-scroll-top>
            {rest.map((s) => (
              <button key={s.id} className={css.row} onClick={() => show(s)}>
                <span className={css.rowText}>
                  {kicker(s)}
                  <b className={css.rowTitle}>{s.title}</b>
                </span>
                {s.img && (
                  <span className={css.rowThumb + ' ' + css.media}>
                    <Img src={s.img} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function openStory(s: NewsStory, topic: string) {
  openSheet(() => <StorySheet s={s} topic={topic} />, {
    cls: 'sheet--wide ' + css.sheet,
  });
}

function StorySheet({ s, topic }: { s: NewsStory; topic: string }) {
  const now = useNow();
  // The frame layout (the wall frame, or a computer) offers a QR code to carry the s to a phone;
  // on a phone you're already holding it. The kiosk can't leave the dashboard, so it gets no link.
  const phone = useLayout() === 'phone';
  return (
    <div>
      {s.img && (
        <div className={css.sheetImg + ' ' + css.media}>
          <Img src={s.img} />
        </div>
      )}
      <div className="sheet-pad">
        <SheetHeader kicker={`${topic} · ${s.source} · ${ago(s.published, now)}`} title={s.title} />
        {s.summary && <p className={css.sum}>{s.summary}</p>}
        {!phone && <ScanToRead url={s.link} />}
        {!IS_KIOSK && (
          <div className="sheet-actions">
            <a className="btn btn--solid" href={s.link} target="_blank" rel="noopener noreferrer">
              Read full story
              <Icon name="right" size={20} />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

const loadQr = () => import('qrcode-generator');

/** A QR code for the article, to open it on a phone (the QR library loads only on the frame) */
function ScanToRead({ url }: { url: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let live = true;
    void loadQr().then(({ default: qrcode }) => {
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      if (live) setSvg(qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }));
    });
    return () => {
      live = false;
    };
  }, [url]);
  return (
    <div className={css.qr}>
      {/* Generated locally from the article's URL: only rectangles, no outside markup */}
      <span className={css.qrCode} dangerouslySetInnerHTML={{ __html: svg }} />
      <span className={css.qrText}>
        <b>Read the full story on your phone</b>
        Point your phone’s camera at the code.
      </span>
    </div>
  );
}
