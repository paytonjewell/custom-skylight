// Today: the glanceable overview. Never scrolls.
import { useRef, useState } from 'react';
import type { CalEvent } from '../data/types';
import { useData } from '../data/store';
import { useEvents } from '../data/hooks';
import { countdowns, person, verseOfDay, weatherNow } from '../data/select';
import { useTaskLanes } from './tasks/Tasks';
import { dayOf } from '../lib/repeat';
import { dueToday } from '../data/tasks';
import { fmt } from '../lib/fmt';
import { useNow } from '../lib/clock';
import { closeSheet, go, openSheet, toast } from '../app/ui';
import { addGrocery, setGroceryDone } from '../data/actions';
import { usePendingAction } from '../ui/hooks';
import type { Grocery } from '../data/types';
import { GROCERY, openList } from './lists/Lists';
import { useLayout } from '../app/layout';
import { openThemeSheet } from '../app/ThemeSheet';
import { Icon } from '../ui/Icon';
import { Ring } from '../ui/Ring';
import { CountdownChip } from '../ui/CountdownChip';
import { toneStyle } from '../ui/people';
import { useEdgeFade } from '../ui/hooks';
import { openWeatherSheet } from './WeatherSheet';
import { HomeCalendar } from './HomeCalendar';
import { openPersonTasks } from './tasks/PersonTasksSheet';
import { openRecipe } from './recipes/RecipeSheet';
import { pickDinner } from './recipes/Recipes';
import { haveNote, readiness } from '../data/kitchen';
import css from './Home.module.css';

export function Home({ active }: { active: boolean }) {
  const events = useEvents();
  const now = useNow();
  const phone = useLayout() === 'phone';

  return (
    <div className={css.home}>
      <header className={css.top}>
        {/* Phones have no sidebar, so the theme picker lives here */}
        {phone && (
          <button className={'icon-btn ' + css.theme} aria-label="Choose a colour theme" onClick={openThemeSheet}>
            <Icon name="palette" size={24} />
          </button>
        )}
        <div className={css.clock} onClick={() => go('calendar')}>
          <div className={css.time + ' num display-num'}>
            {fmt.time(now, false)}
            <span className={css.ampm}>{fmt.ampm(now)}</span>
          </div>
        </div>
        <div className={css.mid}>
          <Countdowns list={countdowns(events, now)} active={active} />
          <div className={css.date} onClick={() => go('calendar')}>
            <b>{fmt.day(now)}<span className={css.dateComma}>,</span></b> {fmt.month(now)} {now.getDate()}
          </div>
        </div>
        <Weather events={events} now={now} />
      </header>

      <div className={css.main}>
        <HomeCalendar now={now} />
      </div>

      <div className={css.side}>
        <DinnerCard now={now} />
        <TasksCard now={now} />
        <GroceriesCard />
        <VerseCard now={now} />
      </div>
    </div>
  );
}

/** Countdown chips fill the space between the clock and the weather; they scroll if they overflow */
function Countdowns({ list, active }: { list: CalEvent[]; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEdgeFade(ref, [list.length, active]);
  return (
    <div className={css.cds} ref={ref}>
      {list.map((e) => (
        <CountdownChip key={e.id} e={e} />
      ))}
    </div>
  );
}

/** Short and sweet: now, high/low and the one-line advice. Tap for the full forecast. */
function Weather({ events, now }: { events: CalEvent[]; now: Date }) {
  const w = weatherNow(useData(), events, now);
  if (!w) return <div className={css.wx} />;
  return (
    <button className={css.wx} aria-label="Weather details" onClick={openWeatherSheet}>
      <span className={css.wxNow}>
        <span className={css.wxIcon}>
          <Icon name={w.cond} size={56} />
        </span>
        <span className={css.wxTemp + ' num display-num'}>{w.temp}°</span>
        <span className={css.wxMeta}>
          <span>H {w.hi}°</span>
          <span>L {w.lo}°</span>
        </span>
      </span>
      <span className={css.wxSay}>
        <span>
          <b>{w.summary}.</b>
          <br />
          {w.advice}.
        </span>
        <Icon name="right" size={18} />
      </span>
    </button>
  );
}

/** Today's tasks per person (habits not counted); tap to open Tasks */
function TasksCard({ now }: { now: Date }) {
  const data = useData();
  const due = dueToday(data.tasks, data.taskDone, dayOf(now)).filter((x) => !x.task.habit);
  // In the order of the Tasks screen's columns (dragged there, saved on this device)
  const who = useTaskLanes(data);
  const left = due.filter((x) => !x.done).length;
  // On a phone the rings can be wider than the card: they scroll sideways, edges fading like the countdowns
  const rings = useRef<HTMLDivElement>(null);
  useEdgeFade(rings, [due.length]);
  return (
    <div className={css.chores + ' card'}>
      {/* The heading opens Tasks; each ring opens that person's tasks for today */}
      <button className={css.choresHead + ' label'} onClick={() => go('tasks')}>
        Tasks · {due.length ? (left ? `${left} left today` : 'all done') : 'nothing today'} <Icon name="right" size={14} />
      </button>
      <div className={css.rings} ref={rings}>
        {who.map((id) => {
          // Everyone always has a ring; an empty one means nothing today
          const list = due.filter((x) => x.task.who === id);
          const done = list.filter((x) => x.done).length;
          const all = list.length > 0 && done === list.length;
          return (
            <button key={id} className={css.ring + (all ? ' ' + css.isDone : '')} style={toneStyle(person(data, id))} onClick={() => openPersonTasks(id)}>
              <Ring done={done} total={list.length || 1} size={64} />
              <b className="num">{all ? '✓' : list.length ? done + '/' + list.length : '–'}</b>
              <span>{id === 'any' ? 'Anyone' : person(data, id).name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Tonight's dinner from the Kitchen plan: tap to open the recipe (and cook), or to plan one */
function DinnerCard({ now }: { now: Date }) {
  const data = useData();
  const today = dayOf(now);
  const r = data.recipes.find((x) => x.id === data.mealPlan[today]);
  if (!r) {
    return (
      <button className={css.dinner + ' card'} onClick={() => pickDinner(today)}>
        <span className={css.dinnerArt}>🍽️</span>
        <span className={css.dinnerText}>
          <span className="label">Tonight’s dinner</span>
          <b>Nothing planned</b>
        </span>
        <span className={css.dinnerGo}>Plan <Icon name="right" size={16} /></span>
      </button>
    );
  }
  const missing = data.inventory.length ? readiness(r, data.inventory).missing : null;
  return (
    <button className={css.dinner + ' card'} style={toneStyle({ tone: r.tone })} onClick={() => openRecipe(r.id, today)}>
      <span className={css.dinnerArt}>{r.emoji}</span>
      <span className={css.dinnerText}>
        <span className="label">Tonight’s dinner</span>
        <b>{r.title}</b>
        <small>
          {r.minutes} min
          {missing && (missing.length ? ` · need ${missing.map((i) => i.name).join(', ')}` : ' · everything’s here')}
        </small>
      </span>
      <Icon name="right" size={20} />
    </button>
  );
}

/**
 * Groceries: an "Add item" bar, then what's on the list (newest first) as rows to check off. The
 * count sits top right; the heading opens the full list. Scrolls when it's long.
 */
function GroceriesCard() {
  const data = useData();
  const open = data.groceries.filter((g) => !g.done);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  // A checked item stays (ticked) a moment, so a second tap can take it back
  const pending = usePendingAction(1200);

  const add = () => {
    const n = name.trim();
    if (!n) return setAdding(false);
    const { item, kind } = addGrocery(n, 'all');
    setName('');
    const have = haveNote(data.inventory, item.name);
    toast(
      <>
        {kind === 'more' ? <>Already on the list · now <b>×{item.qty}</b> {item.name}</> : <>Added <b>{item.name}</b></>}
        {have && <> · you have {have}</>}
      </>,
      { icon: 'cart', ms: have ? 5000 : 2500 },
    );
  };
  const check = (g: Grocery) => {
    if (pending.cancel(g.id)) return;
    pending.start(g.id, () => setGroceryDone(g.id, true));
    toast(<><b>{g.name}</b> checked off</>, { icon: 'check', undo: () => { if (!pending.cancel(g.id)) setGroceryDone(g.id, false); } });
  };

  return (
    <div className={css.shop + ' card'}>
      <div className={css.shopHead}>
        <button className="label" onClick={() => { openList(GROCERY); go('lists'); }}>
          Groceries <Icon name="right" size={14} />
        </button>
        <span className={css.count}>
          <b className="num">{open.length}</b> to get
        </span>
      </div>
      <div className={css.shopList}>
        {adding ? (
          <input
            className={css.addRow + ' ' + css.addInput}
            autoFocus
            placeholder="What do you need?"
            enterKeyHint="done"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); if (e.key === 'Escape') { setName(''); setAdding(false); } }}
            onBlur={() => { if (name.trim()) add(); setAdding(false); }}
          />
        ) : (
          <button className={css.addRow} onClick={() => setAdding(true)}>
            <Icon name="plus" size={20} /> Add item
          </button>
        )}
        {[...open].reverse().map((g) => {
          const ticked = pending.isPending(g.id);
          return (
            <button key={g.id} className={css.item + (ticked ? ' ' + css.isTicked : '')} onClick={() => check(g)}>
              <span>
                {g.name}
                {g.qty > 1 && <small> ×{g.qty}</small>}
              </span>
              <i>{ticked && <Icon name="check" size={16} />}</i>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function VerseCard({ now }: { now: Date }) {
  const v = verseOfDay(useData(), now);
  const size = v.text.length > 180 ? ' ' + css.isVeryLong : v.text.length > 100 ? ' ' + css.isLong : '';
  // Tap for the whole verse (a long one can be cut short here)
  return (
    <button className={css.verse + ' card'} onClick={() => openSheet(() => <VerseSheet text={v.text} ref_={v.ref} version={v.version} />)}>
      <div className="label">Verse of the day</div>
      <p className={css.verseText + ' serif' + size}>
        <VerseText text={v.text} />
      </p>
      <div className={css.verseRef}>
        {v.ref} <span>{v.version}</span>
      </div>
    </button>
  );
}

/** “The verse”, with "LORD" in small capitals as in printed Bibles */
function VerseText({ text }: { text: string }) {
  return (
    <>
      “
      {text.split('LORD').map((part, i) => (
        <span key={i}>
          {i > 0 && <span className={css.sc}>Lord</span>}
          {part}
        </span>
      ))}
      ”
    </>
  );
}

function VerseSheet({ text, ref_, version }: { text: string; ref_: string; version?: string }) {
  return (
    <div className="sheet-pad">
      <div className="label">Verse of the day</div>
      <p className={css.verseFull + ' serif'}>
        <VerseText text={text} />
      </p>
      <div className={css.verseRef}>
        {ref_} <span>{version}</span>
      </div>
      <div className="sheet-actions">
        <button className="btn btn--solid" onClick={closeSheet}>Done</button>
      </div>
    </div>
  );
}
