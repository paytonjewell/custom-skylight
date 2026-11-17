// Photo slideshow: steps through the photos in their saved (grid) order, looping at the end.
// The current photo sits on a strip between its neighbours (already loaded, off-screen), so a swipe
// can drag the strip under the finger and glide on to the next photo, like a Frameo frame.
// The timed advance glides on the same way, once the next photo has loaded.
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type Ref,
  type RefObject,
} from 'react';
import type { Photo } from '../data/types';
import { dataStore } from '../data/store';
import { useStore } from '../lib/store';
import { photoSrc } from '../data/select';
import css from './Slideshow.module.css';

export interface SlideshowHandle {
  /** Glide to the next / previous photo */
  next(): void;
  prev(): void;
  /** Follow a finger that has moved `dx` client px sideways */
  drag(dx: number): void;
  /** The finger lifted after `dx` px, moving at `vx` px/ms: finish the swipe or spring back */
  release(dx: number, vx: number): void;
}

interface Props {
  interval: number;
  /** Only advance while visible */
  active: boolean;
  ref?: Ref<SlideshowHandle>;
}

const GLIDE_MS = 320;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Slideshow({ interval, active, ref }: Props) {
  const photos = useStore(dataStore, (d) => d.photos);
  const [curId, setCurId] = useState<string | null>(null);
  const track = useRef<HTMLDivElement>(null);
  /** A drag or glide is in progress: the timer waits, and a new drag can't start mid-glide */
  const moving = useRef<'drag' | 'glide' | null>(null);
  const loaded = useRef(new Set<string>());

  const n = photos.length;
  // The chosen photo; else (none chosen yet, or it was deleted) the first, once visible
  const chosen = curId ? photos.findIndex((p) => p.id === curId) : -1;
  const at = chosen >= 0 ? chosen : active && n ? 0 : -1;
  const cur = at >= 0 ? photos[at] : null;
  const prev = cur && n > 1 ? photos[(at - 1 + n) % n] : null;
  const next = cur && n > 1 ? photos[(at + 1) % n] : null;

  /** Move the strip to `x` local px (0 = current photo centred), optionally gliding */
  const setX = (x: number, ms = 0) => {
    const el = track.current;
    if (!el) return;
    el.style.transition = ms ? `transform ${ms}ms var(--ease-glide)` : 'none';
    el.style.transform = x ? `translate3d(${x}px, 0, 0)` : '';
  };
  // The strip is re-centred in the same frame the new photo becomes current, so nothing flickers
  useLayoutEffect(() => {
    setX(0);
    moving.current = null;
  }, [curId]);

  /** Client px → the strip's own px (the frame's stage is CSS-scaled) */
  const local = (px: number) => {
    const el = track.current;
    return el ? px / (el.getBoundingClientRect().width / el.offsetWidth || 1) : px;
  };

  /** Glide from where the strip is now to the neighbour on `step`'s side, then make it current */
  const glide = (step: 1 | -1, fromX = 0) => {
    const target = step > 0 ? next : prev;
    const el = track.current;
    if (!target || !el) return setX(0, 220);
    if (reducedMotion()) return setCurId(target.id);
    moving.current = 'glide';
    const w = el.offsetWidth;
    const ms = Math.max(160, Math.round(GLIDE_MS * (1 - Math.abs(fromX) / w)));
    setX(-step * w, ms);
    setTimeout(() => setCurId(target.id), ms);
  };

  useImperativeHandle(ref, () => ({
    next: () => {
      if (!moving.current) glide(1);
    },
    prev: () => {
      if (!moving.current) glide(-1);
    },
    drag(dx) {
      if (moving.current === 'glide') return;
      moving.current = 'drag';
      // With nothing to swipe to, the photo only gives a little
      setX(n > 1 ? local(dx) : local(dx) * 0.25);
    },
    release(dx, vx) {
      if (moving.current !== 'drag') return;
      const x = local(dx),
        w = track.current?.offsetWidth ?? 1;
      if (n > 1 && (Math.abs(x) > w * 0.2 || (Math.abs(vx) > 0.35 && Math.abs(x) > 24))) glide(x < 0 ? 1 : -1, x);
      else {
        moving.current = null;
        setX(0, 220);
      }
    },
  }));

  // Advance every `interval` while visible, gliding like a swipe; any change of photo restarts the
  // timer. Waits for the next photo to have loaded, and for any swipe to finish.
  useEffect(() => {
    if (!active || !curId || n < 2) return;
    const t = setInterval(() => {
      if (moving.current || (next && !loaded.current.has(next.id))) return;
      glide(1);
    }, interval);
    return () => clearInterval(t);
  }, [active, curId, interval, n, next]);

  const onLoad = (id: string) => loaded.current.add(id);
  // Keyed by photo id, so when a neighbour becomes current its (loaded) image is simply moved, not
  // reloaded. With only two photos the same one is on both sides, so those two get their own keys.
  const twin = prev && next && prev.id === next.id;
  return (
    <div className={css.track} ref={track}>
      {prev && <SlideView key={twin ? 'prev:' + prev.id : prev.id} photo={prev} pos={-1} onLoad={onLoad} />}
      {cur && <SlideView key={cur.id} photo={cur} pos={0} onLoad={onLoad} />}
      {next && <SlideView key={twin ? 'next:' + next.id : next.id} photo={next} pos={1} onLoad={onLoad} />}
    </div>
  );
}

function SlideView({ photo: p, pos, onLoad }: { photo: Photo; pos: -1 | 0 | 1; onLoad: (id: string) => void }) {
  // Landscape fills the screen; portrait is shown whole, centred
  return (
    <div
      className={css.slide + ' ' + (p.o === 'p' ? css.fit : css.cover)}
      style={pos ? { transform: `translateX(${pos * 100}%)` } : undefined}
      aria-hidden={pos !== 0}
    >
      {p.o === 'p' ? (
        <SlideImg id={p.id} className={css.fitImg} onLoad={onLoad} />
      ) : (
        <div className={css.kb}>
          <SlideImg id={p.id} onLoad={onLoad} />
        </div>
      )}
    </div>
  );
}

function SlideImg({ id, className, onLoad }: { id: string; className?: string; onLoad: (id: string) => void }) {
  return (
    <img
      className={className}
      src={photoSrc(id)}
      alt=""
      draggable={false}
      onLoad={() => onLoad(id)}
      onError={(e) => {
        // Fallback look if an image can't load (offline): hide it, the dark slide shows through
        e.currentTarget.classList.add('is-broken');
        onLoad(id);
      }}
    />
  );
}

/**
 * Swipe and tap handling for a surface over a slideshow: a sideways drag moves the photos with the
 * finger (and mouse); a tap that doesn't move goes to `onTap`. Spread the result on the surface.
 */
export function useSwipeNav(show: RefObject<SlideshowHandle | null>, onTap: (e: PointerEvent<HTMLElement>) => void) {
  const g = useRef<{
    id: number;
    x: number;
    y: number;
    dragging: boolean;
    lastX: number;
    lastT: number;
    vx: number;
  } | null>(null);
  const end = (e: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const d = g.current;
    g.current = null;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x,
      dy = e.clientY - d.y;
    if (d.dragging) show.current?.release(cancelled ? 0 : dx, cancelled ? 0 : d.vx);
    else if (!cancelled && Math.hypot(dx, dy) < 12) onTap(e);
  };
  return {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      g.current = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        dragging: false,
        lastX: e.clientX,
        lastT: e.timeStamp,
        vx: 0,
      };
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const d = g.current;
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.x,
        dy = e.clientY - d.y;
      if (!d.dragging) {
        // Sideways and past a little slop: it's a swipe. Mostly vertical: leave it alone.
        if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return;
        d.dragging = true;
        // Keep getting this pointer's events even if it leaves the surface (best effort)
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // the pointer is already gone
        }
      }
      const dt = e.timeStamp - d.lastT;
      if (dt > 0) d.vx = 0.7 * ((e.clientX - d.lastX) / dt) + 0.3 * d.vx;
      d.lastX = e.clientX;
      d.lastT = e.timeStamp;
      show.current?.drag(dx);
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => end(e, false),
    onPointerCancel: (e: PointerEvent<HTMLElement>) => end(e, true),
  };
}
