// Swipe a row sideways to reveal an action behind it: swiping left shows the action at the row's end
// (e.g. delete), swiping right shows the one at its start (e.g. edit). Works with useHoldReorder on the
// same row: moving sideways before the hold finishes cancels the hold and becomes a swipe, and a swipe
// never starts while the row is lifted for dragging. Vertical moves are left to scrolling.
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** How far the row slides to show an action, in layout px */
export const REVEAL = 88;
const DECIDE = 10; // px of movement before deciding swipe vs scroll

/** Which action is showing: 'start' (row swiped right) or 'end' (row swiped left) */
export type SwipeSide = 'start' | 'end';

export function useSwipeReveal({ open, onOpenChange, start = false, end = false, startWidth = REVEAL, endWidth = REVEAL, disabled }: {
  /** The side that's open (the parent keeps one row open at a time) */
  open: SwipeSide | null;
  onOpenChange: (side: SwipeSide | null) => void;
  /** Which sides have an action */
  start?: boolean;
  end?: boolean;
  /** How far each side slides open (px; default REVEAL), e.g. wider for two buttons */
  startWidth?: number;
  endWidth?: number;
  /** e.g. while the row is being dragged or edited */
  disabled?: boolean;
}) {
  const [live, setLive] = useState<number | null>(null); // offset while the finger is down
  const g = useRef<{ x0: number; y0: number; pointer: number; base: number; scale: number; horizontal: boolean | null } | null>(null);
  /** A swipe just ended: the click the browser fires after it isn't a tap */
  const swiped = useRef(false);

  const stop = () => {
    g.current = null;
    setLive(null);
  };
  const resting = open === 'end' ? -endWidth : open === 'start' ? startWidth : 0;

  return {
    /** Current offset (px; negative = swiped left) for the sliding part */
    offset: live ?? resting,
    /** The finger is moving the row (turn transitions off) */
    swiping: live !== null,
    /** True (once) if the last click came at the end of a swipe; call from the row's click handler */
    consumeSwipe: () => {
      const s = swiped.current;
      swiped.current = false;
      return s;
    },
    /** Spread on the sliding part */
    handlers: {
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        if (e.button !== 0 || disabled) return;
        const el = e.currentTarget;
        g.current = {
          x0: e.clientX, y0: e.clientY, pointer: e.pointerId, base: resting, horizontal: null,
          // The frame's stage is CSS-scaled; client px ÷ scale = layout px
          scale: el.getBoundingClientRect().width / el.offsetWidth || 1,
        };
        swiped.current = false;
      },
      onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
        const s = g.current;
        if (!s || e.pointerId !== s.pointer) return;
        if (disabled) return stop();
        const mx = e.clientX - s.x0, my = e.clientY - s.y0;
        if (s.horizontal === null) {
          if (Math.hypot(mx, my) < DECIDE) return;
          s.horizontal = Math.abs(mx) > Math.abs(my);
          if (!s.horizontal) return void (g.current = null); // a scroll
          e.currentTarget.setPointerCapture(e.pointerId);
          swiped.current = true;
        }
        let x = s.base + mx / s.scale;
        // Each side stops at its width; one without an action barely moves
        const max = start ? startWidth : 0, min = end ? -endWidth : 0;
        if (x > max) x = max + (x - max) * (start ? 0.3 : 0.15);
        else if (x < min) x = min + (x - min) * (end ? 0.3 : 0.15);
        setLive(x);
      },
      onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
        const s = g.current;
        if (!s || e.pointerId !== s.pointer) return;
        if (s.horizontal && live !== null) {
          onOpenChange(end && live < -endWidth / 2 ? 'end' : start && live > startWidth / 2 ? 'start' : null);
        }
        stop();
      },
      onPointerCancel: stop,
    },
  };
}
