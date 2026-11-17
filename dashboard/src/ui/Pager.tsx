// Sideways paging through days, weeks or months, like a carousel: the page before and after are drawn
// just off either side, and the strip of three follows the finger, so the next page slides into view
// as the current one leaves. Let go past a short distance (or flick) and it settles on the next page;
// otherwise it springs back. Arrows use `go` (through the handle) for the same motion.
//
// Pages are keyed by their absolute position (index + offset), so when the strip settles the page
// that slid in keeps its state (e.g. its scroll) as it becomes the current one. Vertical scrolling
// inside pages is left to the browser (touch-action: pan-y), and a swipe is never also a tap.
import { useImperativeHandle, useLayoutEffect, useRef, type ReactNode, type Ref } from 'react';

export interface PagerHandle {
  /** Slide to the next (1) or previous (-1) page */
  go: (dir: 1 | -1) => void;
}

/** Distance (px) or quick flick that turns the page */
const TURN = 70;
const FLICK = 0.5; // px per ms
const MS = 280;
const EASE = 'cubic-bezier(.2, .8, .3, 1)';
/** Space between pages while they move (px); at rest the current page sits where it would without it */
const GAP = 24;

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Pager({ index, render, onStep, handle, className, pageClass }: {
  /** The current page's position; changes by ±1 as onStep is applied */
  index: number;
  /** A page: 0 the current one, -1 before, 1 after */
  render: (offset: -1 | 0 | 1) => ReactNode;
  onStep: (dir: 1 | -1) => void;
  handle?: Ref<PagerHandle>;
  className?: string;
  pageClass?: string;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; t: number; dx: number; horiz: boolean | null } | null>(null);
  const swiped = useRef(false);
  /** Settling onto a new page: the strip is put back to the middle once it has been drawn */
  const settling = useRef(false);
  const busy = useRef(false);

  const place = (dx: number, dir: 0 | 1 | -1, ms: number) => {
    const el = strip.current;
    if (!el) return;
    el.style.transition = ms ? `transform ${ms}ms ${EASE}` : 'none';
    el.style.transform = `translate3d(calc(${-100 / 3 - (dir * 100) / 3}% + ${dx}px), 0, 0)`;
  };

  // After a step has been drawn, the new current page is in the middle again: no motion, no flash
  useLayoutEffect(() => {
    if (!settling.current) return;
    settling.current = false;
    place(0, 0, 0);
    busy.current = false;
  });

  const settle = (dir: 1 | -1, ms: number) => {
    busy.current = true;
    place(0, dir, ms);
    setTimeout(() => {
      settling.current = true;
      onStep(dir);
    }, ms);
  };

  const go = (dir: 1 | -1) => {
    if (busy.current) return;
    if (reduced()) return onStep(dir);
    settle(dir, MS);
  };
  useImperativeHandle(handle, () => ({ go }));

  return (
    <div
      className={'pager' + (className ? ' ' + className : '')}
      style={{ overflow: 'hidden', touchAction: 'pan-y', margin: `0 ${-GAP / 2}px` }}
      onPointerDown={(e) => {
        if (busy.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
        drag.current = { x: e.clientX, y: e.clientY, t: Date.now(), dx: 0, horiz: null };
        swiped.current = false;
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        // Something was picked up (held, then dragged): the finger is moving that, not the pages
        if (document.documentElement.hasAttribute('data-dragging')) {
          if (d.horiz) place(0, 0, MS);
          drag.current = null;
          return;
        }
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        // Decide once whether this is a sideways swipe or a vertical scroll
        if (d.horiz === null) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          d.horiz = Math.abs(dx) > Math.abs(dy) * 1.2;
          // Keep getting the finger's moves even if it leaves the area
          if (d.horiz) e.currentTarget.setPointerCapture?.(e.pointerId);
        }
        if (!d.horiz) return;
        d.dx = dx;
        swiped.current = true;
        place(dx, 0, 0);
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (!d?.horiz) return;
        const w = strip.current ? strip.current.offsetWidth / 3 : 1;
        const fast = Math.abs(d.dx) / Math.max(1, Date.now() - d.t) > FLICK && Math.abs(d.dx) > 30;
        if (Math.abs(d.dx) < TURN && !fast) return place(0, 0, MS); // spring back
        const dir: 1 | -1 = d.dx < 0 ? 1 : -1;
        if (reduced()) { place(0, 0, 0); return onStep(dir); }
        // The rest of the way takes less time the further the finger already moved it
        settle(dir, Math.round(MS * Math.max(0.4, 1 - Math.abs(d.dx) / w)));
      }}
      onPointerCancel={() => {
        if (drag.current?.horiz) place(0, 0, MS);
        drag.current = null;
      }}
      onClickCapture={(e) => {
        if (swiped.current) {
          e.stopPropagation();
          e.preventDefault();
          swiped.current = false;
        }
      }}
    >
      <div ref={strip} style={{ display: 'flex', width: '300%', height: '100%', transform: `translate3d(${-100 / 3}%, 0, 0)` }}>
        {([-1, 0, 1] as const).map((off) => (
          <div
            key={index + off}
            className={pageClass}
            style={{ width: `${100 / 3}%`, flex: 'none', height: '100%', position: 'relative', padding: `0 ${GAP / 2}px`, boxSizing: 'border-box' }}
            aria-hidden={off !== 0}
            inert={off !== 0}
          >
            {render(off)}
          </div>
        ))}
      </div>
    </div>
  );
}
