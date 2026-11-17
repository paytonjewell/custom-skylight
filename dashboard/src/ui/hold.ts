// Press-and-hold, the start of every drag in the app (useDragDrop: drop onto a target; useHoldReorder:
// reorder in place). A finger that moves before the hold finishes is scrolling or swiping, so nothing
// lifts; once lifted, the finger no longer scrolls the page. Listeners exist only during a press.
import { useRef } from 'react';

/** px a finger may wander during the hold */
const MOVE_SLOP = 10;
/** px from the top/bottom of the scrolling box where a drag scrolls it */
const EDGE = 90;
/** px per frame at the very edge */
export const SCROLL_SPEED = 14;

/** How fast to auto-scroll (-1 up … 1 down) for a finger at `y` in a box showing `top`…`bottom` */
export function edgeSpeed(y: number, top: number, bottom: number): number {
  const v = y < top + EDGE ? -(top + EDGE - y) / EDGE : y > bottom - EDGE ? (y - (bottom - EDGE)) / EDGE : 0;
  return Math.max(-1, Math.min(1, v));
}

export interface HoldCallbacks {
  /** The hold finished: pick it up. (x, y): where the finger is now. */
  lift(x: number, y: number): void;
  /** The finger moved while lifted */
  move(x: number, y: number): void;
  /** Let go (`drop`: true) or cancelled (false), after a lift */
  end(drop: boolean, x: number, y: number): void;
  /** Watching stopped, lifted or not (the press is over) */
  settle?(): void;
}

/**
 * Watch a press that started with `e`. Returns a function that stops watching (ending a lifted drag
 * as cancelled), e.g. when the component unmounts mid-drag.
 */
export function watchHold(e: { clientX: number; clientY: number }, holdMs: number, cb: HoldCallbacks): () => void {
  const x0 = e.clientX,
    y0 = e.clientY;
  let x = x0,
    y = y0,
    lifted = false,
    done = false;
  const timer = window.setTimeout(() => {
    lifted = true;
    navigator.vibrate?.(12);
    cb.lift(x, y);
  }, holdMs);

  const onMove = (ev: PointerEvent) => {
    x = ev.clientX;
    y = ev.clientY;
    if (lifted) cb.move(x, y);
    // Moved before the hold finished: it's a scroll or a swipe, not a drag
    else if (Math.hypot(x - x0, y - y0) > MOVE_SLOP) finish(false);
  };
  const onUp = (ev: PointerEvent) => {
    x = ev.clientX;
    y = ev.clientY;
    finish(true);
  };
  const onCancel = () => finish(false);
  // Once lifted, stop the finger from scrolling (needs a non-passive listener)
  const noScroll = (ev: TouchEvent) => {
    if (lifted && ev.cancelable) ev.preventDefault();
  };

  function finish(drop: boolean) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('touchmove', noScroll);
    if (lifted) cb.end(drop, x, y);
    cb.settle?.();
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('touchmove', noScroll, { passive: false });
  return () => finish(false);
}

/**
 * After a drag, the browser still fires a click on what was pressed; this swallows it. Call `dragged()`
 * when a drag ends, and spread `props` on what can be pressed. A hold also mustn't bring up a phone's
 * long-press menu.
 */
export function useAfterDrag() {
  const just = useRef(false);
  return {
    dragged: () => {
      just.current = true;
      setTimeout(() => {
        just.current = false;
      }, 50);
    },
    props: {
      onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
      onClickCapture: (e: { preventDefault(): void; stopPropagation(): void }) => {
        if (!just.current) return;
        e.preventDefault();
        e.stopPropagation();
      },
    },
  };
}
