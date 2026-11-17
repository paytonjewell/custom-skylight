// Which layout the app uses:
// - frame: the wall display. A fixed 1280×800 stage scaled to fit, sidebar rail, idle photo frame.
// - phone: a phone (or any narrow window). Full-screen, scrolling screens, bottom tab bar.
// The kiosk app on the frame always gets the frame layout, whatever its screen size.
// Phone styles sit inside each component's own rules, scoped under the `phone` class this sets on <html>
// (`.phone &` in css/, `:global(.phone) &` in *.module.css). Phone-sized tokens are in css/tokens.css.
import { createStore, useStore } from '../lib/store';

export type Layout = 'frame' | 'phone';

/** The frame's kiosk app is an Android WebView; its user agent says "wv" */
export const IS_KIOSK = /; wv\)/.test(navigator.userAgent);

// Narrow screens, plus phones turned sideways (short and touch-driven)
const phoneQuery = matchMedia('(max-width: 760px), (max-height: 500px) and (pointer: coarse)');
const pick = (): Layout => (!IS_KIOSK && phoneQuery.matches ? 'phone' : 'frame');

export const layout = createStore<Layout>(pick());
const apply = () => document.documentElement.classList.toggle('phone', layout.get() === 'phone');
apply();
phoneQuery.addEventListener('change', () => {
  layout.set(pick());
  apply();
});

export const useLayout = (): Layout => useStore(layout, (l) => l);
export const isPhone = (): boolean => layout.get() === 'phone';
