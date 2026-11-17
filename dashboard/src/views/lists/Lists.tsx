// Lists: a grid of lists, the shared grocery list pinned first. Tapping one opens it in place; holding
// one lets you drag it to a new spot (the grocery list stays first).
import { useEffect, useRef } from 'react';
import type { Checklist } from '../../data/types';
import { dataStore, useData } from '../../data/store';
import { addList, deleteList, reorderLists } from '../../data/actions';
import { useListStatus } from '../../data/listSync';
import { useGroceryStatus } from '../../data/grocerySync';
import { createStore, useStore } from '../../lib/store';
import { Icon } from '../../ui/Icon';
import { Fab } from '../../ui/Fab';
import { useLayout } from '../../app/layout';
import { PageHeader } from '../../ui/headers';
import { useHoldReorder } from '../../ui/useHoldReorder';
import { GroceryList } from './GroceryList';
import { ChecklistView } from './ChecklistView';
import css from './Lists.module.css';
import { pluralize } from '../../lib/fmt';

/** Id of the open list ('grocery' for the grocery list), or null for the grid */
const open = createStore<string | null>(null);
export const GROCERY = 'grocery';
/** Open a list (e.g. from the Today screen's groceries card); null goes back to the grid.
 *  Leaving a list that's still empty (no name, no items or headings) deletes it, so backing out
 *  of "New list" without typing anything doesn't leave an "Untitled list" behind. */
export const openList = (id: string | null) => {
  const leaving = open.get();
  if (leaving && leaving !== GROCERY && leaving !== id) {
    const l = dataStore.get().lists.find((x) => x.id === leaving);
    if (l && !l.title.trim() && !l.items.length) deleteList(l.id);
  }
  open.set(id);
};
const back = () => openList(null);

export function Lists() {
  const data = useData('lists');
  const id = useStore(open, (s) => s);
  const list = data.lists.find((l) => l.id === id);

  // A list that was deleted (or never existed) falls back to the grid
  useEffect(() => {
    if (id && id !== GROCERY && !list) back();
  }, [id, list]);

  if (id === GROCERY) return <GroceryList onBack={back} />;
  if (list) return <ChecklistView list={list} onBack={back} />;
  return <Grid lists={data.lists} />;
}

function Grid({ lists }: { lists: Checklist[] }) {
  const groceries = useData('groceries').groceries;
  const toGet = groceries.filter((g) => !g.done);
  const view = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  // Only the user's lists are drag items: the grocery card can't move, and nothing can drop before it
  const { order, ghost, ghostStyle, itemProps } = useHoldReorder({
    ids: lists.map((l) => l.id),
    onCommit: reorderLists,
    container: view,
    scroller: grid,
  });
  const byId = new Map(lists.map((l) => [l.id, l]));
  const dragged = ghost && byId.get(ghost.id);
  const status = useListStatus();
  const groceryStatus = useGroceryStatus();
  const phone = useLayout() === 'phone';
  const kicker =
    status === 'loading'
      ? 'Loading lists…'
      : status === 'error'
        ? 'Couldn’t load your lists'
        : `${lists.length + 1} ${pluralize(lists.length + 1, 'list')}`;

  const create = () => openList(addList().id);

  return (
    <div className={css.lists} ref={view}>
      <PageHeader kicker={kicker} title="Lists">
        {phone ? (
          <Fab label="New list" onClick={create} />
        ) : (
          <button className="btn btn--solid" onClick={create}>
            <Icon name="plus" size={22} />
            New list
          </button>
        )}
      </PageHeader>
      <div className={css.grid} ref={grid} data-dragging={ghost ? '' : undefined} data-scroll-top>
        <button className={css.card + ' ' + css.pinned + ' surface'} onClick={() => openList(GROCERY)}>
          <span className={css.cardHead}>
            <span className={css.emoji}>🛒</span>
            <span className={css.pin + ' label label--sm'}>
              <Icon name="tack" size={16} /> Pinned
            </span>
          </span>
          <span className={css.title + ' serif'}>Groceries</span>
          <span className="label">
            {groceryStatus === 'loading' ? 'Loading…' : `${toGet.length} ${pluralize(toGet.length, 'item')}`}
          </span>
          <ul className={css.preview}>
            {toGet.slice(0, 6).map((g) => (
              <li key={g.id}>
                <i />
                {g.name}
                {g.qty > 1 ? ` ×${g.qty}` : ''}
              </li>
            ))}
          </ul>
        </button>

        {order.map((id) => {
          const l = byId.get(id);
          return l ? (
            <button
              key={id}
              className={css.card + ' surface' + (ghost?.id === id ? ' ' + css.isLifted : '')}
              {...itemProps(id)}
              onClick={() => openList(id)}
            >
              <CardBody l={l} />
            </button>
          ) : null;
        })}
      </div>
      {ghost && dragged && (
        <div className={css.card + ' surface ' + css.ghost} style={ghostStyle}>
          <CardBody l={dragged} />
        </div>
      )}
    </div>
  );
}

/** A list's card contents (also drawn under the finger while it's dragged) */
function CardBody({ l }: { l: Checklist }) {
  const lines = l.items.filter((i) => !i.heading);
  const done = lines.filter((i) => i.done).length;
  return (
    <>
      <span className={css.cardHead}>
        <span className={css.emoji}>{l.emoji}</span>
      </span>
      <span className={css.title + ' serif'}>{l.title || 'Untitled list'}</span>
      <span className="label">{lines.length ? `${done} of ${lines.length} done` : 'Empty'}</span>
      <ul className={css.preview}>
        {l.items.slice(0, 7).map((i) => (
          <li key={i.id} className={i.heading ? css.previewHeading : i.done ? css.previewDone : ''}>
            {!i.heading && <i />}
            {i.text}
          </li>
        ))}
      </ul>
      {lines.length > 0 && (
        <span className={css.bar}>
          <i style={{ width: (done / lines.length) * 100 + '%' }} />
        </span>
      )}
    </>
  );
}
