// Layers above the screens: pop-up sheets, toasts, the idle photo frame and the sleep screen.
import { useEffect, useRef, type CSSProperties, type RefObject } from 'react';
import { Icon } from '../ui/Icon';
import { PhotoFrame } from '../views/PhotoFrame';
import { useSwipeNav, type SlideshowHandle } from '../views/Slideshow';
import { closeSheet, dismissToast, setMode, useUI } from './ui';
import { isPhone } from './layout';
import css from './Overlays.module.css';

export function SheetHost() {
  const sheet = useUI((s) => s.sheet);
  const box = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  useDragToClose(box, scrim, sheet?.id);
  return (
    <div className={'sheet-layer' + (sheet ? ' is-open' : '')}>
      {sheet && (
        <>
          <div className="sheet-scrim" ref={scrim} onClick={closeSheet} />
          <div key={sheet.id} ref={box} className={'sheet' + (sheet.cls ? ' ' + sheet.cls : '')}>
            <button className="sheet-x" aria-label="Close" onClick={closeSheet}>
              <Icon name="x" size={28} />
            </button>
            {sheet.render(closeSheet)}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Phone bottom sheets: drag down to close (from the handle, or anywhere once the sheet is scrolled to
 * its top). Let go past a threshold, or flick, and it slides away; otherwise it springs back.
 */
function useDragToClose(
  box: RefObject<HTMLDivElement | null>,
  scrim: RefObject<HTMLDivElement | null>,
  id: number | undefined,
) {
  useEffect(() => {
    const el = box.current;
    if (!el || !isPhone()) return;
    let x0 = 0,
      y0 = 0,
      t0 = 0,
      dy = 0,
      armed = false,
      dragging = false;
    const place = (d: number) => {
      el.style.transform = d ? `translateY(${d}px)` : '';
      if (scrim.current) scrim.current.style.opacity = d ? String(Math.max(0, 1 - d / el.offsetHeight)) : '';
    };
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      x0 = t.clientX;
      y0 = t.clientY;
      dy = 0;
      dragging = false;
      // The handle strip always drags; elsewhere only when there's nothing above to scroll back to
      armed = el.scrollTop <= 0 || t.clientY - el.getBoundingClientRect().top < 36;
    };
    const move = (e: TouchEvent) => {
      if (!armed) return;
      const t = e.touches[0];
      const d = t.clientY - y0,
        dx = t.clientX - x0;
      if (!dragging) {
        if (Math.abs(d) < 6 && Math.abs(dx) < 6) return;
        // Up is a scroll, sideways belongs to whatever scrolls sideways (e.g. the hourly forecast)
        if (d <= 0 || Math.abs(dx) > d) {
          armed = false;
          return;
        }
        dragging = true;
        t0 = Date.now();
        el.style.transition = 'none';
        el.style.animation = 'none';
      }
      if (e.cancelable) e.preventDefault();
      dy = Math.max(0, d);
      place(dy);
    };
    const end = () => {
      armed = false;
      if (!dragging) return;
      dragging = false;
      const speed = dy / Math.max(1, Date.now() - t0); // px per ms
      el.style.transition = 'transform .2s ease-out';
      if (scrim.current) scrim.current.style.transition = 'opacity .2s';
      if (dy > 140 || (speed > 0.5 && dy > 40)) {
        el.style.transform = 'translateY(100%)';
        if (scrim.current) scrim.current.style.opacity = '0';
        setTimeout(closeSheet, 190);
      } else {
        place(0);
      }
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
      if (scrim.current) {
        scrim.current.style.opacity = '';
        scrim.current.style.transition = '';
      }
    };
  }, [box, scrim, id]);
}

/** One toast at a time, optionally with Undo */
export function Toasts() {
  const t = useUI((s) => s.toast);
  useEffect(() => {
    if (!t) return;
    const timer = setTimeout(() => dismissToast(t.id), t.ms);
    return () => clearTimeout(timer);
  }, [t]);
  return (
    <div className={css.toasts} aria-live="polite">
      {t && (
        <div key={t.id} className={css.toast + ' ' + css.isIn} style={{ '--ms': t.ms + 'ms' } as CSSProperties}>
          {t.icon && <Icon name={t.icon} size={26} />}
          <span className={css.msg}>{t.content}</span>
          {t.undo && (
            <button
              className={css.undo}
              onClick={() => {
                t.undo?.();
                dismissToast(t.id);
              }}
            >
              <Icon name="undo" size={22} />
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Idle photo frame: slideshow with the clock, weather, next event and countdowns. Tap to go back to the last screen. */
export function Ambient({ active }: { active: boolean }) {
  const show = useRef<SlideshowHandle>(null);
  // Swipe sideways to flip through the photos (they follow the finger); a tap wakes the dashboard
  const swipe = useSwipeNav(show, () => setMode('day'));
  return (
    <div className={css.ambient} {...swipe}>
      <PhotoFrame active={active} showCountdowns slideshowRef={show} />
    </div>
  );
}

/** Sleep hours (sleep.ts): nothing on screen, backlight down. A tap wakes the dashboard. */
export function Sleep() {
  return <div className={css.sleep} onClick={() => setMode('day')} />;
}
