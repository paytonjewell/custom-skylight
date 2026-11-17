// What's in the kitchen, by where it's kept: Pantry, Fridge, Freezer. Add something by name (it goes
// where that name was kept before, else a good guess, which can be changed before adding); − and +
// change how many (− at one means it's used up, with Undo); tap an item to rename it, move it, add a
// note, or put it on the shopping list. Hold an item and drag it to another column to move it there.
// Recipes use this to tell what can be made.
import { useState } from 'react';
import type { Data, InventoryItem } from '../../data/types';
import { knownGroceries } from '../../data/select';
import { dataStore, useData } from '../../data/store';
import { PLACES, type Place } from '../../data/kitchen';
import {
  addInventory,
  addToGroceries,
  editInventory,
  placeFor,
  removeInventory,
  restoreInventory,
  unteachMatch,
} from '../../data/recipeStore';
import { foodKey } from '../../data/names';
import { onList } from '../../data/recipes';
import { closeSheet, openSheet, toast } from '../../app/ui';
import { Icon } from '../../ui/Icon';
import { PageHeader, SheetHeader } from '../../ui/headers';
import { EmptyNote } from '../../ui/EmptyNote';
import { useDragDrop, type DragProps } from '../../ui/useDragDrop';
import css from './Inventory.module.css';

const PLACE_EMOJI: Record<Place, string> = { Pantry: '🥫', Fridge: '🧊', Freezer: '❄️' };

export function Inventory() {
  const data = useData();
  const [name, setName] = useState('');
  /** Where the typed name will go: chosen, or the guess */
  const [chosen, setChosen] = useState<Place | null>(null);
  const guess = name.trim() ? placeFor(name) : null;
  const place = chosen ?? guess;
  const nextPlace = (p: Place) => PLACES[(PLACES.indexOf(p) + 1) % PLACES.length];
  // Hold an item, drag it to another column
  const dnd = useDragDrop<InventoryItem>({
    onDrop: (i, place) => {
      if (place === i.place) return;
      editInventory(i.id, { place });
      toast(
        <>
          Moved <b>{i.name}</b> to the {place.toLowerCase()}
        </>,
        { icon: 'check', undo: () => editInventory(i.id, { place: i.place }) },
      );
    },
    ghost: (i) => (
      <div className={css.ghost}>
        <b>{i.name}</b>
        <span className="num">×{i.qty}</span>
      </div>
    ),
  });

  const sugg = suggestions(data, name);
  const add = (raw = name) => {
    const n = raw.trim();
    if (!n) return;
    // A suggestion picked: its own place (the one typed was for the typed text)
    const { item, added } = addInventory(n, raw === name ? (place ?? undefined) : undefined);
    setName('');
    setChosen(null);
    toast(
      added ? (
        <>
          Added <b>{item.name}</b> to the {item.place.toLowerCase()}
        </>
      ) : (
        <>
          <b>{item.name}</b> · now ×{item.qty}
        </>
      ),
      { icon: 'check', ms: 2500 },
    );
  };

  return (
    <div className={css.inv}>
      <PageHeader
        kicker="Kitchen"
        title="Inventory"
        meta={
          <span className={css.count}>
            <b className="num">{data.inventory.length}</b> on hand
          </span>
        }
      >
        <div className={css.addBar}>
          {sugg.length > 0 && (
            <ul className={css.sugg} role="listbox" aria-label="Suggestions">
              {sugg.map((x) => (
                // (pressing doesn't take focus from the field, so the keyboard stays up for the next one)
                <li key={x.name}>
                  <button
                    role="option"
                    aria-selected={false}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => add(x.name)}
                  >
                    <b>{x.name}</b>
                    <span>{x.have ? `In kitchen · ×${x.have}` : `${PLACE_EMOJI[x.place]} ${x.place}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            placeholder="Add something you have…"
            value={name}
            enterKeyHint="done"
            onChange={(e) => {
              setName(e.target.value);
              if (!e.target.value.trim()) setChosen(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add();
            }}
          />
          {place && (
            <button
              className={css.placeBtn}
              title="Tap to change where it goes"
              onClick={() => setChosen(nextPlace(place))}
            >
              {PLACE_EMOJI[place]} {place}
            </button>
          )}
          <button className={'btn btn--solid ' + css.addBtn} disabled={!name.trim()} onClick={() => add()}>
            <Icon name="plus" size={20} /> Add
          </button>
        </div>
      </PageHeader>

      <div className={css.cols}>
        {PLACES.map((p) => {
          const items = data.inventory.filter((i) => i.place === p).sort((a, b) => a.name.localeCompare(b.name));
          return (
            <section key={p} className={css.col + ' surface'} data-drop={p}>
              <header className={css.colHead}>
                <span className={css.colEmoji}>{PLACE_EMOJI[p]}</span>
                <b className="serif">{p}</b>
                <span className="label">{items.length}</span>
              </header>
              {items.length ? (
                <ul className={css.list}>
                  {items.map((i) => (
                    <Row key={i.id} i={i} drag={dnd.bind(i)} lifted={dnd.dragging?.id === i.id} />
                  ))}
                </ul>
              ) : (
                <EmptyNote className={css.empty}>
                  <i>Nothing</i> in the {p.toLowerCase()} yet
                </EmptyNote>
              )}
            </section>
          );
        })}
      </div>
      {dnd.layer}
    </div>
  );
}

/**
 * Names to suggest for what's typed: what's been kept before, the grocery list's known names and
 * recipes' ingredients; ones starting with it first. Each says where it would go, or that it's here.
 */
function suggestions(data: Data, typed: string): { name: string; place: Place; have: number }[] {
  const q = typed.trim().toLowerCase();
  if (!q) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  const push = (n: string) => {
    const k = n.trim().toLowerCase();
    if (k && !seen.has(k)) {
      seen.add(k);
      names.push(n.trim());
    }
  };
  data.inventory.forEach((i) => push(i.name));
  data.inventoryNames.forEach(([n]) => push(n));
  knownGroceries(data).forEach(([n]) => push(n));
  data.recipes.forEach((r) => r.ingredients.forEach((i) => push(i.name)));
  const starts = names.filter((n) => n.toLowerCase().startsWith(q));
  const inside = names.filter((n) => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q));
  return [...starts, ...inside]
    .filter((n) => n.toLowerCase() !== q)
    .slice(0, 6)
    .map((n) => ({
      name: n,
      place: placeFor(n),
      have: data.inventory.find((i) => i.name.toLowerCase() === n.toLowerCase())?.qty ?? 0,
    }));
}

/** Used up (or taken out): gone, with Undo */
/**
 * Used up: it leaves the kitchen, and since that means it's run out, ask about the shopping list
 * (unless it's already on it). Either way it can be put back.
 */
function usedUp(i: InventoryItem): void {
  const gone = removeInventory(i.id);
  if (!gone) return;
  if (onList(dataStore.get().groceries, i.name)) {
    toast(
      <>
        Used up <b>{i.name}</b> · it’s on the shopping list
      </>,
      { icon: 'check', undo: () => restoreInventory(gone) },
    );
    return;
  }
  openSheet(() => <AllOut item={gone} />);
}

function AllOut({ item }: { item: InventoryItem }) {
  return (
    <div className="sheet-pad">
      <SheetHeader kicker="Used up" title={`All out of ${item.name}?`} />
      <p className="sheet-p">Add it to the shopping list so it gets picked up.</p>
      <div className="sheet-actions">
        <button
          className="btn btn--ghost"
          onClick={() => {
            restoreInventory(item);
            closeSheet();
          }}
        >
          Put it back
        </button>
        <button className="btn btn--ghost" onClick={closeSheet}>
          No thanks
        </button>
        <button
          className="btn btn--solid"
          onClick={() => {
            const undo = addToGroceries([item.name]);
            closeSheet();
            toast(
              <>
                Added <b>{item.name}</b> to the shopping list
              </>,
              { icon: 'cart', undo },
            );
          }}
        >
          <Icon name="cart" size={20} /> Add to Shopping List
        </button>
      </div>
    </div>
  );
}

function Row({ i, drag, lifted }: { i: InventoryItem; drag: DragProps; lifted: boolean }) {
  return (
    <li className={css.row + (lifted ? ' ' + css.isLifted : '')}>
      <button className={css.rowMain} onClick={() => openItem(i.id)} {...drag}>
        <b>{i.name}</b>
        {i.note && <small>{i.note}</small>}
      </button>
      <div className={css.qty}>
        <button
          aria-label={i.qty > 1 ? 'One less' : 'Used up'}
          onClick={() => (i.qty > 1 ? editInventory(i.id, { qty: i.qty - 1 }) : usedUp(i))}
        >
          <Icon name={i.qty > 1 ? 'minus' : 'trash'} size={18} />
        </button>
        <span className="num">{i.qty}</span>
        <button aria-label="One more" onClick={() => editInventory(i.id, { qty: i.qty + 1 })}>
          <Icon name="plus" size={18} />
        </button>
      </div>
    </li>
  );
}

// ------------------------------------------------------------ edit one
function openItem(id: string): void {
  openSheet(() => <ItemSheet id={id} />);
}
function ItemSheet({ id }: { id: string }) {
  const data = useData();
  const i = data.inventory.find((x) => x.id === id);
  const [name, setName] = useState(i?.name ?? '');
  const [note, setNote] = useState(i?.note ?? '');
  if (!i) return null;
  const listed = !!onList(data.groceries, i.name);
  const key = foodKey(i.name);
  const taughtHere = data.foodAliases.filter(([, to]) => to === key).map(([from]) => from);
  const save = () => {
    const p: Partial<InventoryItem> = {};
    if (name.trim() && name.trim() !== i.name) p.name = name.trim();
    if (note.trim() !== i.note) p.note = note.trim();
    if (Object.keys(p).length) editInventory(i.id, p);
  };
  return (
    <div className={'sheet-pad ' + css.sheet}>
      <div className="label">
        {PLACE_EMOJI[i.place as Place]} {i.place}
      </div>
      <input
        className={css.nameField + ' serif'}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={save}
        aria-label="Name"
      />
      <div className={css.sheetRow}>
        <span className="label">How many</span>
        <div className={css.qty + ' ' + css.qtyBig}>
          <button aria-label="One less" disabled={i.qty <= 1} onClick={() => editInventory(i.id, { qty: i.qty - 1 })}>
            <Icon name="minus" size={20} />
          </button>
          <span className="num">{i.qty}</span>
          <button aria-label="One more" onClick={() => editInventory(i.id, { qty: i.qty + 1 })}>
            <Icon name="plus" size={20} />
          </button>
        </div>
      </div>
      <div className={css.sheetRow}>
        <span className="label">Kept in</span>
        <div className="chips">
          {PLACES.map((p) => (
            <button
              key={p}
              className={'chip' + (i.place === p ? ' is-on' : '')}
              onClick={() => editInventory(i.id, { place: p })}
            >
              {PLACE_EMOJI[p]} {p}
            </button>
          ))}
        </div>
      </div>
      <input
        className={css.noteField}
        placeholder="Note (opened, expires…)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={save}
      />
      {/* Matches taught with "I have this" on a recipe */}
      {taughtHere.length > 0 && (
        <div className={css.sheetRow}>
          <span className="label">Also counts as</span>
          <div className="chips">
            {taughtHere.map((from) => (
              <button
                key={from}
                className="chip chip--ghost"
                aria-label={'Stop counting it as ' + from}
                onClick={() => unteachMatch(from)}
              >
                {from} <Icon name="x" size={14} />
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="sheet-actions">
        <button
          className="btn btn--ghost"
          onClick={() => {
            closeSheet();
            usedUp(i);
          }}
        >
          <Icon name="trash" size={20} /> Used up
        </button>
        <button
          className="btn btn--ghost"
          disabled={listed}
          onClick={() => {
            const undo = addToGroceries([i.name]);
            toast(
              <>
                Added <b>{i.name}</b> to the shopping list
              </>,
              { icon: 'cart', undo },
            );
          }}
        >
          <Icon name="cart" size={20} /> {listed ? 'On the list' : 'Add to Shopping List'}
        </button>
        <button
          className="btn btn--solid"
          onClick={() => {
            save();
            closeSheet();
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}
