// News: a lead story plus a scrollable list of headlines, by topic. Stories come from the news feeds
// the Worker collects (worker/news/feeds.ts). Tap a story for its summary; "Read full story" opens
// the article, and on the frame layout a QR code takes it to your phone. Swipe sideways for the next
// or previous topic, in the tabs' order (src/ui/Pager.tsx), with that topic sliding in.
import { inSavedOrder, savedIds } from '../lib/saved';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
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
import { Pager } from '../ui/Pager';
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

/**
 * News images come from the outlets' sites. The box pulses until the picture has loaded, then it
 * fades in; one that fails to load just leaves the box empty. Use with key={src}: an <img> given a
 * new src keeps showing the old picture until the new one arrives (another topic's, on a slow first
 * load of the day).
 */
function Img({ src, eager }: { src: string; eager?: boolean }) {
  const [state, setState] = useState<'loading' | 'shown' | 'failed'>('loading');
  return (
    <img
      src={src}
      alt=""
      // A lead picture loads at once, so it's there when its topic slides in; the rest as they near view
      loading={eager ? 'eager' : 'lazy'}
      referrerPolicy="no-referrer"
      className={state === 'loading' ? css.imgLoading : state === 'failed' ? css.imgFailed : undefined}
      // Already in the browser's cache: it may have loaded before React was listening
      ref={(el) => {
        if (el?.complete && el.naturalWidth && state === 'loading') setState('shown');
      }}
      onLoad={() => setState('shown')}
      onError={() => setState('failed')}
    />
  );
}

/** The topic tabs' order, saved on this device (ids; null: the server's order) */
const topicOrder = savedIds('news.order');

export function News() {
  const data = useData('news', 'newsTopics');
  const now = useNow();
  const status = useNewsStatus();
  const updated = useNewsUpdated();
  // In the order dragged on this device (hold a tab, then drag it); new topics go at the end
  const saved = useStore(topicOrder.store, (o) => o);
  const topics = inSavedOrder(data.newsTopics, saved, (t) => t[0]);
  const root = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const reorder = useHoldReorder({
    ids: topics.map((t) => t[0]),
    onCommit: topicOrder.set,
    container: root,
    scroller: tabs,
  });
  const shownTopics = reorder.order.map((id) => topics.find((t) => t[0] === id)!).filter(Boolean);
  const [picked, setPicked] = useState('top');
  // The topic list comes from the server; fall back to the first if the picked one went away
  const topic = topics.some((t) => t[0] === picked) ? picked : (topics[0]?.[0] ?? 'top');
  const topicName = (id: string) => topics.find((t) => t[0] === id)?.[1] ?? id;

  const count = data.news.filter((s) => s.topic === topic).length;
  // Swiping steps through the tabs as they're shown
  const at = shownTopics.findIndex((t) => t[0] === topic);
  const near = (off: number) => shownTopics[at + off]?.[0];

  // Keep the picked tab in view in the tab row (phones scroll it sideways). Not scrollIntoView: that
  // would also scroll the page up to the tabs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the picked topic changes
  useEffect(() => {
    const box = tabs.current,
      on = box?.querySelector<HTMLElement>('.is-on');
    if (!box || !on) return;
    const left = on.offsetLeft - box.offsetLeft,
      right = left + on.offsetWidth;
    if (left < box.scrollLeft) box.scrollTo({ left: left - 24, behavior: 'smooth' });
    else if (right > box.scrollLeft + box.clientWidth)
      box.scrollTo({ left: right - box.clientWidth + 24, behavior: 'smooth' });
  }, [topic]);

  const head =
    status === 'loading'
      ? 'Loading the news…'
      : status === 'error' && !data.news.length
        ? 'Couldn’t load the news'
        : `Updated ${updated ? fmt.time(updated) : '–'} · ${count} stories`;

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
      <Pager
        className={css.pager}
        index={at}
        has={(dir) => !!near(dir)}
        onStep={(dir) => {
          setPicked(near(dir) ?? topic);
          // A swipe lands at the top of the new topic (phones scroll the whole screen)
          for (const el of document.querySelectorAll<HTMLElement>('#view-news, #view-news [data-scroll-top]'))
            el.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        render={(off) => {
          const id = near(off);
          if (!id) return null;
          const page = (
            <TopicPage news={data.news} topic={id} name={topicName(id)} loading={status === 'loading'} now={now} />
          );
          // A topic sliding in beside a phone's page is cut to that page's height rather than
          // stretching it: the page scrolls as a whole there, and would get the longer topic's length.
          // The same element either way, so the page that slid in isn't built again (and its pictures
          // loaded again) as it becomes the current one.
          return <div className={css.page + (off ? ' ' + css.peek : '')}>{page}</div>;
        }}
      />
    </div>
  );
}

function TopicPage({
  news,
  topic,
  name,
  loading,
  now,
}: {
  news: NewsStory[];
  topic: string;
  name: string;
  loading: boolean;
  now: Date;
}) {
  const list = news.filter((s) => s.topic === topic); // newest first, from the server
  // Lead: the newest story with a picture (else the newest)
  const lead = list.find((s) => s.img) ?? list[0];
  const rest = list.filter((s) => s !== lead);

  const kicker = (s: NewsStory) => (
    <span className={css.kicker + ' label label--sm'}>
      <b>{s.source}</b> · {ago(s.published, now)}
    </span>
  );
  const show = (s: NewsStory) => openStory(s, name);

  if (!lead)
    return (
      !loading && (
        <EmptyNote large className={css.empty}>
          No {name} stories right now.
          <br />
          <i>Check back in a bit.</i>
        </EmptyNote>
      )
    );
  return (
    <div className={css.body}>
      <button className={css.lead + ' surface' + (lead.img ? '' : ' ' + css.leadTextOnly)} onClick={() => show(lead)}>
        {lead.img && (
          <span className={css.leadImg + ' ' + css.media}>
            <Img key={lead.img} src={lead.img} eager />
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
                <Img key={s.img} src={s.img} />
              </span>
            )}
          </button>
        ))}
      </div>
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
  // The frame layout (the wall frame, or a computer) offers a QR code to carry the story to a phone;
  // on a phone you're already holding it. The kiosk can't leave the dashboard, so it gets no link.
  const phone = useLayout() === 'phone';
  return (
    <div>
      {s.img && (
        <div className={css.sheetImg + ' ' + css.media}>
          <Img key={s.img} src={s.img} />
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
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: see above */}
      <span className={css.qrCode} dangerouslySetInnerHTML={{ __html: svg }} />
      <span className={css.qrText}>
        <b>Read the full story on your phone</b>
        Point your phone’s camera at the code.
      </span>
    </div>
  );
}
