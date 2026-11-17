// Press-and-hold, then drag something onto a drop target (an inventory item onto another column, a
// recipe onto a day). A quick swipe still scrolls and a tap still taps: the drag only starts once the
// finger has stayed put for `holdMs` (as in src/ui/useHoldReorder.ts). While dragging, a copy follows
// the finger, the target under it is marked (`data-drop-over` on it), and letting go drops it there.
// Near the top or bottom of the screen it scrolls, so a target out of view can be reached.
//
//   const dnd = useDragDrop<Item>({ onDrop: (item, target) => … , ghost: (item) => <Row …/> });
//   <div data-drop="Fridge">…<button {...dnd.bind(item)}>…</button></div>
//   {dnd.layer}
import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';

const MOVE_SLOP = 10; // px a finger may wander during the hold
const EDGE = 90; // px from the top/bottom of what's showing where dragging scrolls the page
const SCROLL_SPEED = 14; // px per frame at the very edge

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

/** The drop target under a point: the nearest [data-drop] (its value) */
function targetAt(x: number, y: number): { el: HTMLElement; value: string } | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]');
  return el ? { el, value: el.dataset.drop! } : null;
}

/** What `bind` puts on something that can be picked up */
export type DragProps = ReturnType<ReturnType<typeof useDragDrop>['bind']>;

export function useDragDrop<T>({ onDrop, ghost, holdMs = 350, compact = false }: {
  onDrop: (item: T, target: string) => void;
  /** What follows the finger */
  ghost: (item: T) => ReactNode;
  holdMs?: number;
  /** The copy is only as wide as it needs, held near its left end (so what's under it stays in view),
   *  instead of the picked-up thing's size held where it was grabbed */
  compact?: boolean;
}) {
  const [drag, setDrag] = useState<Drag<T> | null>(null);
  const live = useRef<Live<T> | null>(null);
  const pending = useRef<{ timer: number; x: number; y: number } | null>(null);
  const over = useRef<HTMLElement | null>(null);
  /** A drag just ended: the click that follows isn't a tap */
  const justDragged = useRef(false);
  const drop = useRef(onDrop);
  drop.current = onDrop;

  const mark = (el: HTMLElement | null) => {
    if (over.current === el) return;
    over.current?.removeAttribute('data-drop-over');
    el?.setAttribute('data-drop-over', '');
    over.current = el;
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = pending.current;
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_SLOP) {
        // Moved before the hold: it's a scroll or a swipe
        clearTimeout(p.timer);
        pending.current = null;
      }
      const d = live.current;
      if (!d) return;
      d.x = e.clientX;
      d.y = e.clientY;
      setDrag({ ...d });
      mark(targetAt(e.clientX, e.clientY)?.el ?? null);
    };
    const end = (e: PointerEvent) => {
      if (pending.current) { clearTimeout(pending.current.timer); pending.current = null; }
      const d = live.current;
      if (!d) return;
      const t = e.type === 'pointerup' ? targetAt(e.clientX, e.clientY) : null;
      cancelAnimationFrame(d.raf);
      live.current = null;
      setDrag(null);
      mark(null);
      justDragged.current = true;
      setTimeout(() => { justDragged.current = false; }, 50);
      if (t) drop.current(d.item, t.value);
    };
    // While dragging, a finger moving mustn't scroll the page
    const noScroll = (ev: TouchEvent) => { if (live.current && ev.cancelable) ev.preventDefault(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('touchmove', noScroll, { passive: false });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('touchmove', noScroll);
    };
  }, []);

  /** Props for something that can be picked up */
  const bind = (item: T) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      const el = e.currentTarget;
      const x = e.clientX, y = e.clientY;
      pending.current = {
        x, y,
        timer: window.setTimeout(() => {
          pending.current = null;
          const r = el.getBoundingClientRect();
          navigator.vibrate?.(12);
          const d: Live<T> = { item, x, y, dx: x - r.left, dy: y - r.top, w: r.width, sc: scrollerOf(el), raf: 0 };
          live.current = d;
          setDrag({ ...d });
          // Near the top or bottom of what's showing, scroll (faster nearer the edge); what slides
          // under the finger becomes the target
          const step = () => {
            const cur = live.current;
            if (!cur) return;
            const { top, bottom } = visibleBox(cur.sc);
            const v = cur.y < top + EDGE ? -(top + EDGE - cur.y) / EDGE : cur.y > bottom - EDGE ? (cur.y - (bottom - EDGE)) / EDGE : 0;
            if (v) {
              const before = cur.sc.scrollTop;
              cur.sc.scrollTop += Math.max(-1, Math.min(1, v)) * SCROLL_SPEED;
              if (cur.sc.scrollTop !== before) mark(targetAt(cur.x, cur.y)?.el ?? null);
            }
            cur.raf = requestAnimationFrame(step);
          };
          d.raf = requestAnimationFrame(step);
        }, holdMs),
      };
    },
    // A hold mustn't bring up the phone's long-press menu; a drag's release isn't a tap
    onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
    onClickCapture: (e: { preventDefault(): void; stopPropagation(): void }) => {
      if (justDragged.current) { e.preventDefault(); e.stopPropagation(); }
    },
    style: { WebkitTouchCallout: 'none', userSelect: 'none' } as const,
  });

  const layer = drag
    ? createPortal(
        <div
          className={'drag-ghost' + (compact ? ' drag-ghost--compact' : '')}
          style={compact ? { left: drag.x - 24, top: drag.y - 24 } : { left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w }}
        >
          {ghost(drag.item)}
        </div>,
        document.body,
      )
    : null;

  return { bind, layer, dragging: drag?.item ?? null };
}
