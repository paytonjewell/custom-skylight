// Press-and-hold, then drag something onto a drop target (an inventory item onto another column, a
// recipe onto a day). A quick swipe still scrolls and a tap still taps: the drag only starts once the
// finger has stayed put for `holdMs` (as in src/ui/useHoldReorder.ts). While dragging, a copy follows
// the finger, the target under it is marked (`data-drop-over` on it), and letting go drops it there.
// Near the top or bottom of the screen it scrolls, so a target out of view can be reached.
//
//   const dnd = useDragDrop<Item>({ onDrop: (item, target, at) => … , ghost: (item, at) => <Row …/> });
//   <div data-drop="Fridge">…<button {...dnd.bind(item)}>…</button></div>
//   {dnd.layer}
//
// `at` says where it landed: the target element and the finger (client px), plus where in the item
// it was held, so a drop can work out a time from a position (the calendar) or a place in a list.
// A target with `data-drop-sides` also gets `data-drop-side="before"|"after"` while hovered (which
// half the finger is over), for an insertion line.
import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useLatest } from './hooks';
import { SCROLL_SPEED, edgeSpeed, useAfterDrag, watchHold } from './hold';

/** What scrolls the picked-up thing: its nearest scrolling ancestor, else the page */
function scrollerOf(el: HTMLElement): HTMLElement {
  for (let n: HTMLElement | null = el.parentElement; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** The part of the screen a scroller shows (the page: the window, less a phone's tab bar) */
function visibleBox(sc: HTMLElement): { top: number; bottom: number } {
  if (sc === document.scrollingElement || sc === document.documentElement || sc === document.body) {
    const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tabbar-h')) || 0;
    return { top: 0, bottom: window.innerHeight - (document.documentElement.classList.contains('phone') ? bar : 0) };
  }
  const r = sc.getBoundingClientRect();
  return { top: Math.max(0, r.top), bottom: Math.min(window.innerHeight, r.bottom) };
}

interface Drag<T> {
  item: T;
  x: number;
  y: number;
  /** Where in the item it was grabbed */
  dx: number;
  dy: number;
  w: number;
}
interface Live<T> extends Drag<T> {
  /** Auto-scroll: what scrolls, and the running frame */
  sc: HTMLElement;
  raf: number;
}

/** Where a drag is, for onDrop and the ghost: the target under the finger, the finger, and the grab offset */
export interface DropAt {
  el: HTMLElement;
  value: string;
  x: number;
  y: number;
  /** Where in the item it was held (client px from its top-left) */
  dx: number;
  dy: number;
  /** For targets with data-drop-sides: which half the finger is over */
  side: 'before' | 'after';
}

const sideOf = (el: HTMLElement, y: number): 'before' | 'after' => {
  const r = el.getBoundingClientRect();
  return y < r.top + r.height / 2 ? 'before' : 'after';
};

/**
 * The drop target under a point: the nearest [data-drop] of the topmost thing there that's in one.
 * Things over a target that aren't in it themselves (the calendar's event chips over its days) don't
 * hide it.
 */
function targetAt(x: number, y: number): { el: HTMLElement; value: string } | null {
  for (const hit of document.elementsFromPoint(x, y)) {
    const el = hit.closest<HTMLElement>('[data-drop]');
    if (el) return { el, value: el.dataset.drop! };
  }
  return null;
}
/** While something is dragged, <html data-dragging>: swipes (the calendar's pages, pull-to-refresh) stand aside */
const flagDragging = (on: boolean) => document.documentElement.toggleAttribute('data-dragging', on);

/** What `bind` puts on something that can be picked up */
export type DragProps = ReturnType<ReturnType<typeof useDragDrop>['bind']>;

export function useDragDrop<T>({
  onDrop,
  ghost,
  holdMs = 350,
  compact = false,
}: {
  onDrop: (item: T, target: string, at: DropAt) => void;
  /** What follows the finger (`at`: where it is now, or null when it's over no target) */
  ghost: (item: T, at: DropAt | null) => ReactNode;
  holdMs?: number;
  /** The copy is only as wide as it needs, held near its left end (so what's under it stays in view),
   *  instead of the picked-up thing's size held where it was grabbed */
  compact?: boolean;
}) {
  const [drag, setDrag] = useState<Drag<T> | null>(null);
  const live = useRef<Live<T> | null>(null);
  /** Stops watching the press under way (see watchHold) */
  const stopHold = useRef<(() => void) | null>(null);
  const over = useRef<HTMLElement | null>(null);
  const afterDrag = useAfterDrag();
  const drop = useLatest(onDrop);

  const mark = (el: HTMLElement | null, y = 0) => {
    if (el && el.hasAttribute('data-drop-sides')) el.setAttribute('data-drop-side', sideOf(el, y));
    if (over.current === el) return;
    over.current?.removeAttribute('data-drop-over');
    over.current?.removeAttribute('data-drop-side');
    el?.setAttribute('data-drop-over', '');
    over.current = el;
  };
  const atOf = (d: Drag<T>): DropAt | null => {
    const t = targetAt(d.x, d.y);
    return t ? { ...t, x: d.x, y: d.y, dx: d.dx, dy: d.dy, side: sideOf(t.el, d.y) } : null;
  };

  // Unmounted mid-drag: cancel it
  useEffect(() => () => stopHold.current?.(), []);

  /** Near the top or bottom of what's showing, scroll; what slides under the finger becomes the target */
  const autoScroll = () => {
    const cur = live.current;
    if (!cur) return;
    const { top, bottom } = visibleBox(cur.sc);
    const v = edgeSpeed(cur.y, top, bottom);
    if (v) {
      const before = cur.sc.scrollTop;
      cur.sc.scrollTop += v * SCROLL_SPEED;
      if (cur.sc.scrollTop !== before) {
        mark(targetAt(cur.x, cur.y)?.el ?? null, cur.y);
        setDrag({ ...cur });
      }
    }
    cur.raf = requestAnimationFrame(autoScroll);
  };

  /** Props for something that can be picked up */
  const bind = (item: T) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0 || stopHold.current) return;
      const el = e.currentTarget;
      const x0 = e.clientX,
        y0 = e.clientY;
      stopHold.current = watchHold(e, holdMs, {
        lift: (x, y) => {
          const r = el.getBoundingClientRect();
          const d: Live<T> = { item, x, y, dx: x0 - r.left, dy: y0 - r.top, w: r.width, sc: scrollerOf(el), raf: 0 };
          live.current = d;
          flagDragging(true);
          setDrag({ ...d });
          d.raf = requestAnimationFrame(autoScroll);
        },
        move: (x, y) => {
          const d = live.current;
          if (!d) return;
          d.x = x;
          d.y = y;
          setDrag({ ...d });
          mark(targetAt(x, y)?.el ?? null, y);
        },
        end: (dropped, x, y) => {
          const d = live.current;
          if (!d) return;
          d.x = x;
          d.y = y;
          const at = dropped ? atOf(d) : null;
          cancelAnimationFrame(d.raf);
          live.current = null;
          flagDragging(false);
          setDrag(null);
          mark(null);
          afterDrag.dragged();
          if (at) drop.current(d.item, at.value, at);
        },
        settle: () => {
          stopHold.current = null;
        },
      });
    },
    ...afterDrag.props,
    style: { WebkitTouchCallout: 'none', userSelect: 'none' } as const,
  });

  const layer = drag
    ? createPortal(
        <div
          className={'drag-ghost' + (compact ? ' drag-ghost--compact' : '')}
          style={
            compact
              ? { left: drag.x - 24, top: drag.y - 24 }
              : { left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w }
          }
        >
          {ghost(drag.item, atOf(drag))}
        </div>,
        document.body,
      )
    : null;

  return { bind, layer, dragging: drag?.item ?? null };
}
