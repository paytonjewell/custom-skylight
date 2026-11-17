// Colour themes. The chosen theme and the "Dark after sunset" switch are saved per device; the
// effective theme is also saved so the inline script in index.html can apply it before first paint.
import { useLayoutEffect } from 'react';
import { createStore, store, stored, useStore } from '../lib/store';
import { useNow } from '../lib/clock';
import { useData } from '../data/store';
import { afterDark } from '../data/select';
import type { IconName } from '../ui/icons';
import { useLayout } from './layout';

export const THEMES = {
  pastel: { label: 'Pastel', icon: 'palette', blurb: 'Soft purple, pink, blue and green on white' },
  earth: { label: 'Earth', icon: 'leaf', blurb: 'Sage, moss, brown and sand on cream' },
  nordic: { label: 'Nordic', icon: 'snow', blurb: 'Dusty blue, slate and teal with a mustard accent' },
  dark: { label: 'Dark', icon: 'moon', blurb: 'Charcoal with muted colours, easy on the eyes at night' },
  glass: { label: 'Glass', icon: 'sparkle', blurb: 'Pink-to-lavender gradient with frosted glass' },
} satisfies Record<string, { label: string; icon: IconName; blurb: string }>;
export type ThemeName = keyof typeof THEMES;

const isTheme = (t: string): t is ThemeName => t in THEMES;
const saved = stored('theme', 'pastel');

const themeStore = createStore({
  choice: (isTheme(saved) ? saved : 'pastel') as ThemeName,
  autoDark: stored('themeAutoDark', '0') === '1',
});
export const useThemeSettings = () => useStore(themeStore, (s) => s);

export function setThemeChoice(choice: ThemeName): void {
  store('theme', choice);
  themeStore.set((s) => ({ ...s, choice }));
}
export function setAutoDark(autoDark: boolean): void {
  store('themeAutoDark', autoDark ? '1' : '0');
  themeStore.set((s) => ({ ...s, autoDark }));
}

/** The theme in effect right now (the chosen one, or Dark after sunset if that's switched on). */
export function useTheme(): ThemeName {
  const { choice, autoDark } = useThemeSettings();
  const data = useData();
  const now = useNow();
  return autoDark && afterDark(data, now) ? 'dark' : choice;
}

/** Apply the effective theme to <html> (only when it changes). Used once, by App. */
export function useApplyTheme(): ThemeName {
  const theme = useTheme();
  const phone = useLayout() === 'phone';
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    store('themeApplied', theme);
    // Phone browsers tint their status bar with theme-color; the frame's kiosk ignores it. On a phone
    // the bar sits over the screen's panel (--paper), unless that's see-through (Glass).
    const css = getComputedStyle(document.documentElement);
    const paper = css.getPropertyValue('--paper').trim();
    const bar = phone && !paper.startsWith('rgba') ? paper : css.getPropertyValue('--shell').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bar);
  }, [theme, phone]);
  return theme;
}
