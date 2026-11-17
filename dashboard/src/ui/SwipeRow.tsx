// A row you can tap, swipe right to edit, or swipe left to delete (tasks, habits). The parent keeps
// one row open at a time via `open` / `onOpenChange`. Lists use their own version (with drag to
// reorder) in views/lists/ChecklistView.tsx.
import type { ReactNode } from 'react';
import { useSwipeReveal, type SwipeSide } from './useSwipeReveal';
import type { DragProps } from './useDragDrop';
import { Icon } from './Icon';
import css from './SwipeRow.module.css';

export function SwipeRow({ label, open, onOpenChange, onTap, onEdit, onDelete, className, slideClass, style, drag, lifted, children }: {
  /** What the row is, for the actions' labels ("Edit <label>") */
  label: string;
  open: SwipeSide | null;
  onOpenChange: (side: SwipeSide | null) => void;
  onTap: () => void;
  onEdit: () => void;
  onDelete: () => void;
  className?: string;
  /** Classes for the sliding part (the visible card) */
  slideClass?: string;
  style?: React.CSSProperties;
  /** Press-and-hold to pick it up and drop it elsewhere (useDragDrop); a quick swipe still swipes */
  drag?: DragProps;
  /** It's the one being dragged: no swiping, and it shows faded where it was */
  lifted?: boolean;
  children: ReactNode;
}) {
  const swipe = useSwipeReveal({ open, onOpenChange, start: true, end: true, disabled: lifted });
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
