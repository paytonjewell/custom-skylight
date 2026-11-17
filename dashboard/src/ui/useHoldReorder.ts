// Press-and-hold, then drag to reorder items in a (scrollable) grid. A quick swipe still scrolls:
// the drag only starts once the finger has stayed put for `holdMs`. Items glide to new slots (FLIP).
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { useLatest } from './hooks';
import { SCROLL_SPEED, edgeSpeed, useAfterDrag, watchHold } from './hold';

/** The lifted item, positioned in `container`'s (unscaled) coordinates */
export interface Ghost {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const GLIDE = 'transform 220ms var(--ease-glide)';

/**
 * The dragged order, brought up to date with the list as it is now: items removed while dragging (a
 * sync landed) are dropped, and items added are kept at their place in the current list.
 */
export function reconcile(order: string[], ids: string[]): string[] {
  const now = new Set(ids);
  const next = order.filter((id) => now.has(id));
  const had = new Set(next);
  ids.forEach((id, i) => {
    if (!had.has(id)) next.splice(Math.min(i, next.length), 0, id);
  });
  return next;
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The element that actually scrolls: `el` itself (the frame, where lists scroll inside their box), or
 * the nearest scrolling ancestor (phones, where each screen scrolls as a whole)
 */
function scrollingBox(el: HTMLElement): HTMLElement {
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return el;
}

export function useHoldReorder({
  ids,
  onCommit,
  container,
  scroller,
  holdMs = 400,
}: {
  ids: string[];
  onCommit: (ids: string[]) => void;
  /** Positioned ancestor the ghost is drawn in (must not scroll) */
  container: RefObject<HTMLElement | null>;
  /** The items' box; must be positioned (items' offsetTop/Left are measured from it). Auto-scroll moves it
   *  or, if it doesn't scroll itself, its nearest scrolling ancestor. */
  scroller: RefObject<HTMLElement | null>;
  holdMs?: number;
}) {
  const [order, setOrder] = useState<string[] | null>(null); // only while dragging
  // The listeners added at pointerdown live for the whole drag; they read the list and callback from
  // here, so a sync landing mid-drag doesn't leave them working on the list as it was at the start.
  const latest = useLatest({ ids, onCommit });
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const items = useRef(new Map<string, HTMLElement>());
  const drag = useRef<{
    id: string;
    order: string[];
    /** Grab point inside the item, in unscaled px */
    gx: number;
    gy: number;
    /** Last pointer position, client px */
    cx: number;
    cy: number;
    /** Item size, unscaled px */
    w: number;
    h: number;
    raf: number;
    /** What auto-scroll moves (see scrollingBox), and how far it can go: measured when the item is
     *  lifted, because the dragged copy can stretch the scrolling box as it nears the bottom */
    sc: HTMLElement;
    max: number;
  } | null>(null);
  /** Stops watching the press under way (see watchHold) */
  const stopHold = useRef<(() => void) | null>(null);
  const afterDrag = useAfterDrag();
  /** Where items were on screen before the next render, so they can glide from there (FLIP) */
  const before = useRef(new Map<string, DOMRect>());

  // The stage is CSS-scaled to fit the screen; client px ÷ scale = layout px
  const scaleOf = (el: HTMLElement) => el.getBoundingClientRect().width / el.offsetWidth || 1;

  const snapshot = () => {
    if (reducedMotion()) return;
    for (const [id, el] of items.current)
      if (!before.current.has(id)) before.current.set(id, el.getBoundingClientRect());
  };

  // After a reorder renders: start each moved item where it was, then let it glide to its new slot
  useLayoutEffect(() => {
    const prev = before.current;
    if (!prev.size) return;
    before.current = new Map();
    const moved: [HTMLElement, number, number][] = [];
    for (const [id, was] of prev) {
      const el = items.current.get(id);
      if (!el) continue;
      el.style.transition = 'none';
      el.style.transform = '';
      const now = el.getBoundingClientRect(),
        s = scaleOf(el);
      const dx = (was.left - now.left) / s,
        dy = (was.top - now.top) / s;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) moved.push([el, dx, dy]);
    }
    for (const [el, dx, dy] of moved) el.style.transform = `translate(${dx}px, ${dy}px)`;
    void document.body.offsetWidth; // commit the starting positions before animating
    for (const [el] of moved) {
      el.style.transition = GLIDE;
      el.style.transform = '';
    }
  });

  const place = () => {
    const d = drag.current,
      box = container.current;
    if (!d || !box) return;
    const r = box.getBoundingClientRect(),
      s = scaleOf(box);
    setGhost((g) => g && { ...g, x: (d.cx - r.left) / s - d.gx, y: (d.cy - r.top) / s - d.gy });
    // Move the lifted item into the slot under the finger. Slots are tested by layout position
    // (offsetLeft/Top), not on-screen position, so items mid-glide don't cause flip-flopping.
    const sc = scroller.current;
    if (!sc) return;
    const sr = sc.getBoundingClientRect(),
      ss = scaleOf(sc);
    const px = (d.cx - sr.left) / ss + sc.scrollLeft,
      py = (d.cy - sr.top) / ss + sc.scrollTop;
    for (const [id, el] of items.current) {
      if (id === d.id) continue;
      if (
        px >= el.offsetLeft &&
        px <= el.offsetLeft + el.offsetWidth &&
        py >= el.offsetTop &&
        py <= el.offsetTop + el.offsetHeight
      ) {
        const next = d.order.filter((x) => x !== d.id);
        next.splice(d.order.indexOf(id), 0, d.id);
        d.order = next;
        snapshot();
        setOrder(next);
        break;
      }
    }
  };

  // Scroll while the finger sits near the scrolling box's top or bottom edge
  const autoScroll = () => {
    const d = drag.current;
    if (!d) return;
    const sc = d.sc;
    // The edge zone scales with the stage, so measure in layout px
    const r = sc.getBoundingClientRect(),
      s = scaleOf(sc);
    const v = edgeSpeed(d.cy / s, r.top / s, r.bottom / s);
    const next = Math.max(0, Math.min(d.max, sc.scrollTop + v * SCROLL_SPEED));
    if (v && next !== sc.scrollTop) {
      sc.scrollTop = next;
      place();
    }
    d.raf = requestAnimationFrame(autoScroll);
  };

  const end = (commit: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (d) {
      cancelAnimationFrame(d.raf);
      afterDrag.dragged();
      // The dropped item settles from under the finger into its slot
      const box = container.current;
      if (box && !reducedMotion()) {
        const s = scaleOf(box);
        before.current.set(d.id, new DOMRect(d.cx - d.gx * s, d.cy - d.gy * s, d.w * s, d.h * s));
      }
      const { ids: now, onCommit: commitOrder } = latest.current;
      const next = reconcile(d.order, now);
      if (commit && next.join() !== now.join()) commitOrder(next);
    }
    setOrder(null);
    setGhost(null);
  };

  const start = (id: string, e: ReactPointerEvent) => {
    if (e.button !== 0 || stopHold.current) return;
    stopHold.current = watchHold(e, holdMs, {
      lift: (cx, cy) => {
        const el = items.current.get(id),
          box = container.current;
        if (!el || !box) return stopHold.current?.();
        const b = el.getBoundingClientRect(),
          r = box.getBoundingClientRect(),
          s = scaleOf(box);
        const sc = scrollingBox(scroller.current ?? box);
        const ids = latest.current.ids;
        drag.current = {
          id,
          order: ids,
          gx: (e.clientX - b.left) / s,
          gy: (e.clientY - b.top) / s,
          cx,
          cy,
          w: b.width / s,
          h: b.height / s,
          raf: 0,
          sc,
          max: sc.scrollHeight - sc.clientHeight,
        };
        setOrder(ids);
        setGhost({ id, x: (b.left - r.left) / s, y: (b.top - r.top) / s, w: b.width / s, h: b.height / s });
        drag.current.raf = requestAnimationFrame(autoScroll);
      },
      move: (cx, cy) => {
        const d = drag.current;
        if (!d) return;
        d.cx = cx;
        d.cy = cy;
        place();
      },
      end: (drop) => end(drop),
      settle: () => {
        stopHold.current = null;
      },
    });
  };

  // Unmounted mid-drag: drop it where it started
  useEffect(() => () => stopHold.current?.(), []);

  return {
    /** Item order to render (live while dragging) */
    order: order ?? ids,
    ghost,
    /** Where to draw the copy of the lifted item, in `container` (absolutely positioned) */
    ghostStyle: ghost ? { left: ghost.x, top: ghost.y, width: ghost.w, height: ghost.h } : undefined,
    /** Spread on each item */
    itemProps: (id: string) => ({
      ref: (el: HTMLElement | null) => {
        if (el) items.current.set(id, el);
        else items.current.delete(id);
      },
      onPointerDown: (e: ReactPointerEvent) => start(id, e),
      ...afterDrag.props,
    }),
  };
}
