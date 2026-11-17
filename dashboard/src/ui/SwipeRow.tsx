// A row you can tap, swipe right to edit, or swipe left to delete (tasks, habits); with `onLater`,
// swiping left also shows "move to tomorrow" (») beside Delete. The parent keeps
// one row open at a time via `open` / `onOpenChange`. Lists use their own version (with drag to
// reorder) in views/lists/ChecklistView.tsx.
import type { ReactNode } from 'react';
import { REVEAL, useSwipeReveal, type SwipeSide } from './useSwipeReveal';
import type { DragProps } from './useDragDrop';
import { Icon } from './Icon';
import css from './SwipeRow.module.css';

export function SwipeRow({ label, open, onOpenChange, onTap, onEdit, onDelete, onLater, className, slideClass, style, drag, lifted, drop, children }: {
  /** What the row is, for the actions' labels ("Edit <label>") */
  label: string;
  open: SwipeSide | null;
  onOpenChange: (side: SwipeSide | null) => void;
  onTap: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** Move it to tomorrow: shown beside Delete when given */
  onLater?: () => void;
  className?: string;
  /** Classes for the sliding part (the visible card) */
  slideClass?: string;
  style?: React.CSSProperties;
  /** Press-and-hold to pick it up and drop it elsewhere (useDragDrop); a quick swipe still swipes */
  drag?: DragProps;
  /** It's the one being dragged: no swiping, and it shows faded where it was */
  lifted?: boolean;
  /** A drop target value (useDragDrop): something dragged can be put just above or below this row */
  drop?: string;
  children: ReactNode;
}) {
  const swipe = useSwipeReveal({ open, onOpenChange, start: true, end: true, disabled: lifted, endWidth: onLater ? REVEAL * 2 : REVEAL });
  const action = (name: string, run: () => void) => ({
    'aria-label': name + ' ' + label,
    tabIndex: open ? 0 : -1,
    onClick: (e: { stopPropagation(): void }) => {
      e.stopPropagation();
      onOpenChange(null);
      run();
    },
  });
  return (
    <div
      className={css.row + (swipe.offset > 0 ? ' ' + css.showStart : swipe.offset < 0 ? ' ' + css.showEnd : '') + (lifted ? ' ' + css.lifted : '') + (className ? ' ' + className : '')}
      style={drag ? { ...drag.style, ...style } : style}
      onClickCapture={drag?.onClickCapture}
      data-drop={drop}
      data-drop-sides={drop ? '' : undefined}
      onContextMenu={drag?.onContextMenu}
      onClick={() => {
        if (swipe.consumeSwipe()) return;
        // While open, a tap just closes it
        if (open) return onOpenChange(null);
        onTap();
      }}
    >
      <button className={css.action + ' ' + css.edit} {...action('Edit', onEdit)}>
        <Icon name="edit" size={24} />
      </button>
      {onLater && (
        <button className={css.action + ' ' + css.later} {...action('Move to tomorrow:', onLater)}>
          <Icon name="later" size={28} />
        </button>
      )}
      <button className={css.action + ' ' + css.delete} {...action('Delete', onDelete)}>
        <Icon name="trash" size={26} />
      </button>
      <div
        className={css.slide + (swipe.swiping ? ' ' + css.swiping : '') + (slideClass ? ' ' + slideClass : '')}
        style={swipe.offset ? { transform: `translateX(${swipe.offset}px)` } : undefined}
        {...swipe.handlers}
        onPointerDown={(e) => {
          swipe.handlers.onPointerDown(e);
          drag?.onPointerDown(e);
        }}
      >
        {children}
      </div>
    </div>
  );
}
