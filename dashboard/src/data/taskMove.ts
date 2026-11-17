// Where a dragged task lands, worked out without touching the store (moveTaskTo in actions.ts saves
// it), so the ordering can be tested on its own.
import type { Slot, Task } from './types';

/** A drop: whose column, the group in it (a part of the day, or 'habits') and the row it went beside */
export interface TaskDrop {
  who: string;
  group?: string;
  rowId?: string;
  side: 'before' | 'after';
}

/** What a move changes on each task it touches */
export type MoveEdit = Partial<Pick<Task, 'who' | 'slot' | 'position'>>;

/**
 * The edits that move `t` to `drop`. `shown` is what's showing in the group it was dropped on, in
 * order: the moved task gets its place among them, and they're numbered 1, 2, 3… (only the ones whose
 * number changes are edited). A habit stays a habit and a task a task: a drop on the other kind's
 * group (or on a column, not a group) only changes whose it is.
 */
export function taskMoveEdits(t: Task, drop: TaskDrop, shown: Task[]): Map<string, MoveEdit> {
  const { who, group, rowId, side } = drop;
  const change: MoveEdit = {};
  if (who !== t.who) change.who = who;
  const fits = !!group && (group === 'habits') === t.habit;
  if (fits && !t.habit && group !== t.slot) change.slot = group as Slot;
  const edits = new Map<string, MoveEdit>();
  if (fits) {
    const list = shown.filter((y) => y.id !== t.id);
    let at = rowId ? list.findIndex((y) => y.id === rowId) : list.length;
    if (at < 0) at = list.length;
    else if (rowId && side === 'after') at++;
    list.splice(at, 0, t);
    list.forEach((y, i) => {
      if (y.position !== i + 1) edits.set(y.id, { position: i + 1 });
    });
  }
  if (Object.keys(change).length) edits.set(t.id, { ...edits.get(t.id), ...change });
  return edits;
}
