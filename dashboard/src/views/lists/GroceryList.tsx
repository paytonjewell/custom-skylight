// The grocery list, pinned first on the Lists screen: categorized list (left) + quick-add with usuals
// and suggestions (right). Hold an item to drag it, within its aisle or under another aisle's heading
// (every aisle's heading shows, even with nothing under it). Swipe an item right to fix its name; in
// "All", swipe it left to move it to the other store.
import { useEffect, useRef, useState } from 'react';
import type { Data, Grocery } from '../../data/types';
import { useData } from '../../data/store';
import {
  addGrocery, clearGroceries, placeGroceries, removeGrocery, renameGrocery, restoreGrocery, restoreGroceries, setGroceryDone,
  setGroceryStore, setQty,
} from '../../data/actions';
import { categorize, findGrocery, knownGroceries } from '../../data/select';
import { haveNote } from '../../data/kitchen';
import { useGroceryStatus } from '../../data/grocerySync';
import { OTHER, STORES } from '../../data/grocery';
import { useLayout } from '../../app/layout';
import { toast } from '../../app/ui';
import { Icon } from '../../ui/Icon';
import { Segmented } from '../../ui/Segmented';
import { PageHeader } from '../../ui/headers';
import { EmptyNote } from '../../ui/EmptyNote';
import { usePendingAction } from '../../ui/hooks';
import { useHoldReorder } from '../../ui/useHoldReorder';
import { store as remember, stored } from '../../lib/store';
import { useSwipeReveal, type SwipeSide } from '../../ui/useSwipeReveal';
import { EditField } from '../../ui/EditField';
import css from './GroceryList.module.css';
import { pluralize } from '../../lib/fmt';

const CHECK_MS = 1200; // time to undo by tapping again before a checked item leaves the list
/** Aisle headings take part in dragging (as places to drop, not things to pick up); their ids start with this */
const HEAD = 'cat:';
/** This device's choices: every aisle's heading (or only aisles with something in them), and the
 *  − / + count controls on each row (or just "×2" after the name) */
const SHOW_ALL_KEY = 'groceries.allAisles';
const COUNTS_KEY = 'groceries.countControls';

/**
 * The Kitchen's Shopping List shows this same list, food only: `hide` aisles are left out, items a
 * planned dinner needs say which (`forRecipes`), and `suggest` offers what those dinners still need.
 */
export interface KitchenMode {
  hide: string[];
  forRecipes: (name: string) => string | undefined;
  suggest: string[];
}

export function GroceryList({ onBack, kitchen }: { onBack?: () => void; kitchen?: KitchenMode }) {
  const data = useData();
  const [store, setStore] = useState('all');
  const [query, setQuery] = useState('');
  const [drawer, setDrawer] = useState(false);
  const pending = usePendingAction(CHECK_MS);
  const [flash, setFlash] = useState<string | null>(null);
  const status = useGroceryStatus();
  // Phones show stores' short names in the switcher (PNS), where space is tight
  const phone = useLayout() === 'phone';
  const listRef = useRef<HTMLDivElement>(null);
  const shopRef = useRef<HTMLDivElement>(null);

  const shown = (g: Grocery) => !kitchen?.hide.includes(g.cat);
  const inStore = (g: Grocery) => shown(g) && (store === 'all' || g.store === store);
  const open = data.groceries.filter((g) => !g.done && inStore(g));
  const got = data.groceries.filter((g) => g.done && inStore(g));
  const allOpen = data.groceries.filter((g) => !g.done && shown(g));
  // Aisles with nothing in them are hidden unless "all aisles" is on (handy for dragging an item into
  // an empty aisle). 'Other' only shows when something's in it.
  const [allAisles, setAllAisles] = useState(() => stored(SHOW_ALL_KEY, '0') === '1');
  const toggleAisles = () => {
    remember(SHOW_ALL_KEY, allAisles ? '0' : '1');
    setAllAisles(!allAisles);
  };
  const [counts, setCounts] = useState(() => stored(COUNTS_KEY, '0') === '1');
  const toggleCounts = () => {
    remember(COUNTS_KEY, counts ? '0' : '1');
    setCounts(!counts);
  };
  const groups = [...data.catOrder[store].filter((c) => !kitchen?.hide.includes(c)), OTHER]
    .map((cat) => ({ cat, items: open.filter((g) => g.cat === cat) }))
    .filter((x) => x.items.length || (allAisles && x.cat !== OTHER));
  /** The row swiped open, and which side (one at a time) */
  const [swiped, setSwiped] = useState<{ id: string; side: SwipeSide } | null>(null);
  /** The row whose name is being edited */
  const [editing, setEditing] = useState<string | null>(null);

  // Headings and items as one sequence, so an item can be dragged under another aisle's heading.
  // When it's dropped, each item takes the aisle of the heading above it.
  const { order, ghost, itemProps } = useHoldReorder({
    ids: groups.flatMap((gr) => [HEAD + gr.cat, ...gr.items.map((g) => g.id)]),
    onCommit: (ids) => {
      let cat = groups[0]?.cat ?? 'Other';
      const placed: { id: string; cat: string }[] = [];
      for (const id of ids) {
        if (id.startsWith(HEAD)) cat = id.slice(HEAD.length);
        else placed.push({ id, cat });
      }
      placeGroceries(placed);
    },
    container: shopRef,
    scroller: listRef,
  });
  const byId = new Map(open.map((g) => [g.id, g]));

  // Briefly highlight (and scroll to) an item that was just added
  useEffect(() => {
    if (!flash) return;
    listRef.current?.querySelector(`[data-id="${flash}"]`)?.scrollIntoView({ block: 'nearest' });
    const t = setTimeout(() => setFlash(null), 1200);
    return () => clearTimeout(t);
  }, [flash]);

  const add = (name: string) => {
    if (!name.trim()) return;
    const { item, kind } = addGrocery(name, store);
    setQuery('');
    setFlash(item.id);
    // Already in the kitchen (Inventory): say so, in case it's not needed after all
    const have = haveNote(data.inventory, item.name);
    toast(
      <>
        {kind === 'more' ? <>Already on the list · now <b>×{item.qty}</b> {item.name}</>
          : kind === 'revived' ? <>Added back <b>{item.name}</b></>
          : <>Added <b>{item.name}</b> to {item.cat}</>}
        {have && <> · you have {have}</>}
      </>,
      { icon: 'cart', ms: have ? 5000 : 3000 },
    );
  };

  const check = (g: Grocery) => {
    if (pending.cancel(g.id)) return; // second tap cancels
    pending.start(g.id, () => setGroceryDone(g.id, true));
    toast(<><b>{g.name}</b> checked off</>, {
      icon: 'check',
      undo: () => { if (!pending.cancel(g.id)) setGroceryDone(g.id, false); },
    });
  };

  // At one, minus takes the item off the list (with Undo)
  const less = (g: Grocery) => {
    if (g.qty > 1) return setQty(g.id, g.qty - 1);
    const gone = removeGrocery(g.id);
    if (gone) toast(<>Removed <b>{g.name}</b></>, { icon: 'trash', undo: () => restoreGrocery(gone.item, gone.at) });
  };

  const revive = (g: Grocery) => {
    setGroceryDone(g.id, false);
    toast(<>Added back <b>{g.name}</b></>, { icon: 'cart', ms: 2500 });
  };

  const clear = () => {
    const gone = clearGroceries(got.map((g) => g.id));
    setDrawer(false);
    toast(`Cleared ${gone.length} items`, { icon: 'check', undo: () => restoreGroceries(gone) });
  };

  return (
    <div className={css.shop} ref={shopRef}>
      <PageHeader
        className={css.head}
        onBack={onBack}
        kicker={status === 'loading' ? 'Loading…' : status === 'error' ? 'Couldn’t load the list' : kitchen ? 'Groceries · food only' : 'Shared list · pinned'}
        title={kitchen ? 'Shopping List' : 'Groceries'}
        meta={<div className={css.count}><span className="num display-num">{open.length}</span> to get</div>}
      >
        <div className={css.controls}>
          <Segmented
            className={css.stores}
            options={[['all', 'All'] as const, ...data.stores.map((s) => [s.id, phone ? s.short ?? s.name : s.name] as const)].map(([id, name]) => [
              id,
              <>{name} <span className="num">{id === 'all' ? allOpen.length : allOpen.filter((g) => g.store === id).length}</span></>,
            ] as const)}
            value={store}
            onChange={setStore}
          />
          {/* Fold: hide empty aisles. Unfold: show every aisle. */}
          <button
            className={'icon-btn ' + css.aisleToggle}
            aria-pressed={allAisles}
            aria-label={allAisles ? 'Hide empty aisles' : 'Show all aisles'}
            title={allAisles ? 'Hide empty aisles' : 'Show all aisles'}
            onClick={toggleAisles}
          >
            <Icon name={allAisles ? 'fold' : 'unfold'} size={26} />
          </button>
          {/* − / + on each row to change how many (otherwise counts show as "×2" after the name) */}
          <button
            className={'icon-btn ' + css.aisleToggle}
            aria-pressed={counts}
            aria-label={counts ? 'Hide count buttons' : 'Show count buttons'}
            title={counts ? 'Hide count buttons' : 'Show count buttons'}
            onClick={toggleCounts}
          >
            <Icon name="amounts" size={24} />
          </button>
        </div>
      </PageHeader>

      <div className={css.list} ref={listRef} data-dragging={ghost ? '' : undefined}>
        {open.length ? (
          order.map((id, n) => {
            if (id.startsWith(HEAD)) {
              // items under this heading, as it stands while dragging
              const next = order.findIndex((x, k) => k > n && x.startsWith(HEAD));
              const count = (next < 0 ? order.length : next) - n - 1;
              return (
                <div key={id} className={css.catHead} ref={itemProps(id).ref}>
                  <span className="label">{id.slice(HEAD.length)}</span>
                  <span className="label">{count}</span>
                </div>
              );
            }
            const g = byId.get(id);
            return g ? (
              <Row
                key={id}
                g={g}
                showStore={store === 'all'}
                counts={counts}
                checking={pending.isPending(id)}
                flash={flash === id}
                lifted={ghost?.id === id}
                props={itemProps(id)}
                // While a row is open, a tap anywhere in the list just closes it
                onCheck={(x) => (swiped ? setSwiped(null) : check(x))}
                onLess={less}
                open={swiped?.id === id ? swiped.side : null}
                onOpenChange={(side) => setSwiped(side ? { id, side } : null)}
                // In "All", an item can be moved to the other store
                moveTo={store === 'all' ? otherStore(g.store) : null}
                onMove={(to) => { setSwiped(null); setGroceryStore(id, to); toast(<><b>{g.name}</b> moved to {storeName(to)}</>, { icon: 'cart', ms: 2500 }); }}
                editing={editing === id}
                forRecipes={kitchen?.forRecipes(g.name)}
                have={haveNote(data.inventory, g.name)}
                onEdit={() => { setSwiped(null); setEditing(id); }}
                onEditDone={(value) => { if (value !== null) renameGrocery(id, value); setEditing(null); }}
              />
            ) : null;
          })
        ) : status !== 'ready' ? null : (
          <EmptyNote large className={css.empty}>
            All stocked up.
            <br />
            <i>Nothing left to buy.</i>
          </EmptyNote>
        )}
        {got.length > 0 && (
          <div className={css.drawer + ' surface' + (drawer ? ' is-open' : '')}>
            <button className={css.drawerHead} onClick={() => setDrawer(!drawer)}>
              <span>
                <Icon name="check" size={22} /> Purchased <b className="num">({got.length})</b>
              </span>
              <span className="label">{drawer ? 'Hide' : 'Show'}</span>
            </button>
            {drawer && (
              <div className={css.drawerList}>
                {got.map((g) => (
                  <button key={g.id} className={css.got} onClick={() => revive(g)}>
                    {g.name}
                    <span className="label">Add back</span>
                  </button>
                ))}
                <button className={'btn btn--ghost ' + css.clear} onClick={clear}>
                  Clear {got.length} purchased {pluralize(got.length, 'item')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* the item being dragged, under the finger */}
      {ghost && byId.get(ghost.id) && (
        <div className={css.ghost} style={{ left: ghost.x, top: ghost.y, width: ghost.w, height: ghost.h }}>
          <Row g={byId.get(ghost.id)!} showStore={store === 'all'} counts={counts} checking={false} flash={false} onCheck={() => {}} onLess={() => {}} />
        </div>
      )}

      <aside className={css.side}>
        <div className={css.add + ' surface'}>
          <label className={css.inputWrap}>
            <Icon name="plus" size={30} />
            <input
              className={css.input}
              placeholder="Add an item…"
              autoComplete="off"
              enterKeyHint="done"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') add(query); }}
            />
          </label>
        </div>
        <div className={css.suggest}>
          <Suggest data={data} query={query} onAdd={add} planned={kitchen?.suggest} />
        </div>
      </aside>
    </div>
  );
}

const storeName = (id: string) => STORES.find((s) => s.id === id)?.name ?? id;
/** The store an item would move to (with two stores, the other one) */
const otherStore = (id: string) => STORES.find((s) => s.id !== id)?.id ?? null;

function Row({ g, showStore, counts, checking, flash, lifted, props, onCheck, onLess, open = null, onOpenChange, moveTo = null, onMove, editing = false, onEdit, onEditDone, forRecipes, have }: {
  g: Grocery;
  /** Already in the kitchen: how much and where ("1 in the fridge") */
  have?: string | null;
  /** Needed for a planned dinner: which ("🌮 Taco night") */
  forRecipes?: string;
  showStore: boolean;
  /** Show the − / + count buttons (else the count shows as "×2" after the name, nothing for one) */
  counts: boolean;
  checking: boolean;
  flash: boolean;
  /** Being dragged (this is its empty slot) */
  lifted?: boolean;
  /** Drag handling (useHoldReorder); left out for the copy under the finger */
  props?: ReturnType<ReturnType<typeof useHoldReorder>['itemProps']>;
  onCheck: (g: Grocery) => void;
  onLess: (g: Grocery) => void;
  /** Swiped open: 'start' shows Edit, 'end' shows the move-to-store button */
  open?: SwipeSide | null;
  onOpenChange?: (side: SwipeSide | null) => void;
  /** Store a left swipe moves it to (null: no left swipe) */
  moveTo?: string | null;
  onMove?: (store: string) => void;
  editing?: boolean;
  onEdit?: () => void;
  /** The new name, or null if editing was cancelled */
  onEditDone?: (value: string | null) => void;
}) {
  const swipe = useSwipeReveal({
    open, onOpenChange: onOpenChange ?? (() => {}), start: !!onEdit, end: !!moveTo, disabled: lifted || editing || !props,
  });
  // The count and action buttons aren't drag handles: holding one shouldn't lift the row
  const noDrag = (e: { stopPropagation(): void }) => e.stopPropagation();
  const action = (label: string, run: () => void) => ({
    'aria-label': label,
    tabIndex: open ? 0 : -1,
    onPointerDown: noDrag,
    onClick: (e: { stopPropagation(): void }) => { e.stopPropagation(); run(); },
  });
  // While editing, the name is a text field, so the tap area can't be a button
  const Hit = editing ? 'div' : 'button';
  return (
    <div
      className={css.row + (checking ? ' ' + css.isChecking : '') + (flash ? ' ' + css.isFlash : '') + (lifted ? ' ' + css.isLifted : '') + (forRecipes ? ' ' + css.isForRecipe : '')
        + (swipe.offset > 0 ? ' ' + css.showStart : swipe.offset < 0 ? ' ' + css.showEnd : '')}
      data-id={g.id}
      {...props}
    >
      {/* Behind the row: Edit is revealed by swiping it right, Move by swiping it left */}
      {onEdit && (
        <button className={css.action + ' ' + css.editAction} {...action('Edit ' + g.name, onEdit)}>
          <Icon name="edit" size={24} />
        </button>
      )}
      {moveTo && onMove && (
        <button className={css.action + ' ' + css.moveAction} {...action('Move ' + g.name + ' to ' + storeName(moveTo), () => onMove(moveTo))}>
          <Icon name="cart" size={22} />
          <span>{storeName(moveTo)}</span>
        </button>
      )}
      <div
        className={css.slide + (swipe.swiping ? ' ' + css.swiping : '')}
        style={swipe.offset ? { transform: `translateX(${swipe.offset}px)` } : undefined}
        {...swipe.handlers}
      >
        <Hit className={css.hit} onClick={() => { if (!swipe.consumeSwipe() && !editing) onCheck(g); }}>
          <span className={css.box}>
            <Icon name="check" size={22} />
          </span>
          <span className={css.name}>
            {editing && onEditDone ? (
              <EditField className={css.editField} value={g.name} label="Item name" onDone={onEditDone} />
            ) : (
              <b>
                {g.name}
                {!counts && g.qty > 1 && <span className={css.times}>×{g.qty}</span>}
              </b>
            )}
            {g.note && <small>{g.note}</small>}
            {forRecipes && <small className={css.forRecipe}>For {forRecipes}</small>}
            {have && <small className={css.have}>Have {have}</small>}
          </span>
          {/* In "All", items for a store other than the usual one are marked */}
          {showStore && g.store !== STORES[0].id && <span className={css.store + ' label label--sm'}>{storeName(g.store)}</span>}
        </Hit>
        {counts && (
          <div className={css.qty}>
            <button aria-label={g.qty > 1 ? 'Less' : 'Remove'} onPointerDown={noDrag} onClick={() => onLess(g)}>
              <Icon name="minus" size={22} />
            </button>
            <span className="num">{g.qty}</span>
            <button aria-label="More" onPointerDown={noDrag} onClick={() => setQty(g.id, g.qty + 1)}>
              <Icon name="plus" size={22} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Typing: catalog matches (+ "Add “…”"). Otherwise: the usual items as quick-add tiles. */
function Suggest({ data, query, onAdd, planned }: { data: Data; query: string; onAdd: (name: string) => void; planned?: string[] }) {
  const q = query.trim().toLowerCase();
  if (q) {
    // Things you've added before come first (most used first), then the starter list
    const known = knownGroceries(data);
    const starts = known.filter((c) => c[0].toLowerCase().startsWith(q));
    const contains = known.filter((c) => c[0].toLowerCase().indexOf(q) > 0);
    const matches = [...starts, ...contains].slice(0, 5);
    const exact = matches.some((m) => m[0].toLowerCase() === q);
    return (
      <>
        <div className="label">Suggestions</div>
        <div className={css.ac}>
          {matches.map(([name, cat]) => {
            const on = findGrocery(data, name, false);
            const have = haveNote(data.inventory, name);
            return (
              <button key={name} className={css.acRow + ' surface'} onClick={() => onAdd(name)}>
                <b>{name}</b>
                <span className="label">{on ? 'On list · ×' + on.qty : have ? 'Have ' + have : cat}</span>
                <Icon name="plus" size={26} />
              </button>
            );
          })}
          {!exact && (
            <button className={css.acRow + ' surface ' + css.acRowNew} onClick={() => onAdd(query)}>
              <b>Add “{query.trim()}”</b>
              <span className="label">{haveNote(data.inventory, query) ? 'Have ' + haveNote(data.inventory, query) : categorize(data, query)}</span>
              <Icon name="plus" size={26} />
            </button>
          )}
        </div>
      </>
    );
  }
  return (
    <>
      {planned && planned.length > 0 && (
        <>
          <div className="label">For this week’s dinners · tap to add</div>
          <div className={css.ac + ' ' + css.planned}>
            {planned.map((name) => (
              <button key={name} className={css.acRow + ' surface'} onClick={() => onAdd(name)}>
                <b>{name}</b>
                <span className="label">{categorize(data, name)}</span>
                <Icon name="plus" size={26} />
              </button>
            ))}
          </div>
        </>
      )}
      <div className="label">Usuals · tap to add</div>
      <div className={css.usuals}>
        {data.usuals.map((name) => {
          const on = findGrocery(data, name, false);
          return (
            <button key={name} className={css.tile + ' surface' + (on ? ' ' + css.isOn : '')} onClick={() => onAdd(name)}>
              <b>{name}</b>
              <span>
                {on ? <><Icon name="check" size={16} />On list{on.qty > 1 ? ' ×' + on.qty : ''}</> : categorize(data, name)}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
