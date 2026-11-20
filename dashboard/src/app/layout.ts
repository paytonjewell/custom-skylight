// Which layout the app uses:
// - frame: the wall display. A fixed 1280×800 stage scaled to fit, sidebar rail, idle photo frame.
// - phone: a phone (or any narrow window). Full-screen, scrolling screens, bottom tab bar.
// The kiosk app on the frame always gets the frame layout, whatever its screen size.
// Phone styles sit inside each component's own rules, scoped under the `phone` class this sets on <html>
// (`.phone &` in css/, `:global(.phone) &` in *.module.css). Phone-sized tokens are in css/tokens.css.
import { createStore, useStore } from '../lib/store';

export type Layout = 'frame' | 'phone';

/**
 * The frame's kiosk app is an Android WebView; its user agent says "wv". The phone app (Capacitor,
 * dashboard/android) is a WebView too, so it marks itself with "WhiteLotusApp/" (appendUserAgent in
 * capacitor.config.json) and gets the usual phone treatment.
 */
export const IS_KIOSK = /; wv\)/.test(navigator.userAgent) && !/WhiteLotusApp\//.test(navigator.userAgent);

/**
 * The frame's screen in CSS pixels: the Skylight Calendar 2 is 1920×1080 at density 240, and the
 * kiosk is full screen, so its WebView sees 1280×720.
 */
const FRAME_VIEWPORT = { w: 1280, h: 720 } as const;

/**
 * Local dev (npm run dev): show the app exactly as the frame does, in a 1280×720 box centred in the
 * window (scaled down only if the window is smaller). Also in `npm run frame`, which poses as the
 * kiosk (frame's user agent) in Chrome 124 (scripts/frame-chrome.mjs). Add ?fit to the address to
 * fill the window with the usual layout picking instead.
 */
const FRAME_PREVIEW = import.meta.env.DEV && !new URLSearchParams(location.search).has('fit');

/** The area the frame layout fits its stage into: the preview box, or the visible window */
export function viewportSize(): { w: number; h: number } {
  if (FRAME_PREVIEW) return FRAME_VIEWPORT;
  // The visible area, not innerWidth/innerHeight: those follow the layout viewport, which grows to
  // fit content that overflows it (see useStageFit in App.tsx)
  return { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight };
}

// Narrow screens, plus phones turned sideways (short and touch-driven)
const phoneQuery = matchMedia('(max-width: 760px), (max-height: 500px) and (pointer: coarse)');
const pick = (): Layout => (!IS_KIOSK && !FRAME_PREVIEW && phoneQuery.matches ? 'phone' : 'frame');

const layout = createStore<Layout>(pick());
const apply = () => document.documentElement.classList.toggle('phone', layout.get() === 'phone');
apply();
phoneQuery.addEventListener('change', () => {
  layout.set(pick());
  apply();
});

export const useLayout = (): Layout => useStore(layout, (l) => l);
export const isPhone = (): boolean => layout.get() === 'phone';

if (FRAME_PREVIEW) {
  const root = document.documentElement;
  root.classList.add('frame-preview');
  const zoom = () =>
    root.style.setProperty(
      '--preview-zoom',
      String(Math.min(1, innerWidth / FRAME_VIEWPORT.w, innerHeight / FRAME_VIEWPORT.h)),
    );
  zoom();
  addEventListener('resize', zoom);
}
