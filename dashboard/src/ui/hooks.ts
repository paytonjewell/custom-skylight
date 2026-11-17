import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';

/**
 * A ref that always holds the latest `value`. For handlers attached once (window listeners that live
 * for a whole drag) that must still see this render's props, not the props from when they were attached.
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * Tap now, commit shortly after: `start(id, commit)` marks the item as pending (for a check
 * animation, or a window to change your mind), then runs `commit` after `delay` ms.
 * `cancel(id)` aborts it and returns true if it was still pending.
 */
export function usePendingAction(delay: number) {
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Map<string, number>());
  const unmark = (id: string) =>
    setPending((p) => {
      const n = new Set(p);
      n.delete(id);
      return n;
    });

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((t) => clearTimeout(t));
  }, []);

  return {
    isPending: (id: string) => pending.has(id),
    start(id: string, commit: () => void) {
      if (timers.current.has(id)) return;
      setPending((p) => new Set(p).add(id));
      timers.current.set(
        id,
        window.setTimeout(() => {
          timers.current.delete(id);
          unmark(id);
          commit();
        }, delay),
      );
    },
    cancel(id: string): boolean {
      const t = timers.current.get(id);
      if (t == null) return false;
      clearTimeout(t);
      timers.current.delete(id);
      unmark(id);
      return true;
    },
  };
}

/**
 * Horizontal scrollers: fade an edge only when there is more content past it. Sets --fade-l /
 * --fade-r on the element (see .h-cds). Re-checks when `key` changes (pass what changes the content's
 * width, e.g. a count).
 */
export function useEdgeFade(ref: RefObject<HTMLElement | null>, key: string | number) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      el.style.setProperty('--fade-l', el.scrollLeft > 1 ? '40px' : '0px');
      el.style.setProperty('--fade-r', el.scrollLeft < max - 1 ? '40px' : '0px');
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [ref, key]);
}

/** Nudge static content a few px every minute so nothing sits still for hours (image retention) */
export function usePixelShift(active: boolean, now: Date): CSSProperties | undefined {
  return useMemo(() => {
    if (!active) return undefined;
    const x = Math.round(Math.random() * 8 - 4),
      y = Math.round(Math.random() * 8 - 4);
    return { transform: `translate(${x}px, ${y}px)` };
  }, [active, now]);
}
