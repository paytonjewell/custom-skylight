// A row you can tap, or swipe sideways to reveal actions behind it: `start` actions (swipe right, e.g.
// Edit) and `end` actions (swipe left, e.g. Delete). Used by tasks, habits, checklists and groceries.
// The parent keeps one row open at a time via `open` / `onOpenChange`.
//
// Press-and-hold dragging (useHoldReorder's itemProps, or useDragDrop's bind) goes in `rowProps`: a
// quick sideways move still swipes, and pressing an action never lifts the row. While open, a tap on
// the row just closes it. `data-open="start"|"end"` is on the row while it's swiped, for styling.
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { REVEAL, useSwipeReveal, type SwipeSide } from './useSwipeReveal';
import { Icon } from './Icon';
import type { IconName } from './icons';
import css from './SwipeRow.module.css';

export interface SwipeAction {
  icon: IconName;
  /** Its accessible name ("Delete milk") */
  label: string;
  run: () => void;
  /** Colour: edit (accent), delete (alert), later (ink), remind (amber), move (ink, with `text`) */
  tone: 'edit' | 'delete' | 'later' | 'remind' | 'move';
  /** Words under the icon */
  text?: string;
  iconSize?: number;
}

export function SwipeRow({
  open,
  onOpenChange,
  start = [],
  end = [],
  onTap,
  disabled,
  className,
  slideClass,
  style,
  rowProps,
  children,
}: {
  open: SwipeSide | null;
  onOpenChange: (side: SwipeSide | null) => void;
  start?: SwipeAction[];
  end?: SwipeAction[];
  /** A tap on the row (not after a swipe, and not while it's open) */
  onTap?: () => void;
  /** No swiping (e.g. while it's being dragged or edited) */
  disabled?: boolean;
  className?: string;
  /** Classes for the sliding part (the visible card) */
  slideClass?: string;
  style?: CSSProperties;
  /** Spread on the row: drag handling, data attributes */
  rowProps?: HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | undefined>;
  children: ReactNode;
}) {
  const swipe = useSwipeReveal({
    open,
    onOpenChange,
    start: start.length > 0,
    end: end.length > 0,
    startWidth: REVEAL * Math.max(1, start.length),
    endWidth: REVEAL * Math.max(1, end.length),
    disabled,
  });
  const side = swipe.offset > 0 ? 'start' : swipe.offset < 0 ? 'end' : undefined;
  return (
    <div
      {...rowProps}
      className={css.row + (className ? ' ' + className : '')}
      style={{ ...rowProps?.style, ...style }}
      data-open={side}
      onClick={() => {
        if (swipe.consumeSwipe()) return;
        if (open) return onOpenChange(null);
        onTap?.();
      }}
    >
      {start.map((a, i) => (
        <ActionButton key={a.label} a={a} at="start" i={i} shown={open === 'start'} onOpenChange={onOpenChange} />
      ))}
      {end.map((a, i) => (
        <ActionButton key={a.label} a={a} at="end" i={i} shown={open === 'end'} onOpenChange={onOpenChange} />
      ))}
      <div
        className={css.slide + (swipe.swiping ? ' ' + css.swiping : '') + (slideClass ? ' ' + slideClass : '')}
        style={swipe.offset ? { transform: `translateX(${swipe.offset}px)` } : undefined}
        {...swipe.handlers}
      >
        {children}
      </div>
    </div>
  );
}

function ActionButton({
  a,
  at,
  i,
  shown,
  onOpenChange,
}: {
  a: SwipeAction;
  at: SwipeSide;
  /** Its place from the row's edge */
  i: number;
  shown: boolean;
  onOpenChange: (side: SwipeSide | null) => void;
}) {
  return (
    <button
      className={css.action + ' ' + css[a.tone] + ' ' + css[at]}
      style={at === 'start' ? { left: i * REVEAL } : { right: i * REVEAL }}
      aria-label={a.label}
      tabIndex={shown ? 0 : -1}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onOpenChange(null);
        a.run();
      }}
    >
      <Icon name={a.icon} size={a.iconSize ?? 24} />
      {a.text && <span>{a.text}</span>}
    </button>
  );
}

// The usual actions, named for what they do to `what` (the row's title, for their accessible names)
export const editAction = (what: string, run: () => void): SwipeAction => ({
  icon: 'edit',
  tone: 'edit',
  label: 'Edit ' + what,
  run,
});
export const deleteAction = (what: string, run: () => void): SwipeAction => ({
  icon: 'trash',
  tone: 'delete',
  label: 'Delete ' + what,
  run,
  iconSize: 26,
});
export const laterAction = (what: string, run: () => void): SwipeAction => ({
  icon: 'later',
  tone: 'later',
  label: 'Move to tomorrow: ' + what,
  run,
  iconSize: 28,
});
