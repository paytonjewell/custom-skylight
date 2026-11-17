// Adding and checking off groceries, as the grocery list and Home's groceries card both do it: a
// toast says what happened (and if it's already in the kitchen), and a checked item stays ticked a
// moment so a second tap, or Undo, can take it back.
import { addGrocery, setGroceryDone } from '../../data/actions';
import { haveNote } from '../../data/kitchen';
import { useData } from '../../data/store';
import type { Grocery } from '../../data/types';
import { toast } from '../../app/ui';
import { usePendingAction } from '../../ui/hooks';

export function useGroceryActions(checkMs: number) {
  const { inventory } = useData('inventory');
  const pending = usePendingAction(checkMs);

  /** Add `name` (to `store`, or 'all'); returns the item on the list */
  const add = (name: string, store: string): Grocery => {
    const { item, kind } = addGrocery(name, store);
    // Already in the kitchen (Inventory): say so, in case it's not needed after all
    const have = haveNote(inventory, item.name);
    toast(
      <>
        {kind === 'more' ? (
          <>
            Already on the list · now <b>×{item.qty}</b> {item.name}
          </>
        ) : kind === 'revived' ? (
          <>
            Added back <b>{item.name}</b>
          </>
        ) : (
          <>
            Added <b>{item.name}</b> to {item.cat}
          </>
        )}
        {have && <> · you have {have}</>}
      </>,
      { icon: 'cart', ms: have ? 5000 : 3000 },
    );
    return item;
  };

  const check = (g: Grocery) => {
    if (pending.cancel(g.id)) return; // a second tap takes it back
    pending.start(g.id, () => setGroceryDone(g.id, true));
    toast(
      <>
        <b>{g.name}</b> checked off
      </>,
      {
        icon: 'check',
        undo: () => {
          if (!pending.cancel(g.id)) setGroceryDone(g.id, false);
        },
      },
    );
  };

  return { add, check, isChecking: pending.isPending };
}
