// Confetti (canvas-confetti) for finishing someone's tasks for the day. Skipped when the device asks
// for reduced motion. Colours come from the person's palette slot in the active theme.
import confetti from 'canvas-confetti';

/** Read a CSS colour variable (e.g. "--t1") from the page, as the theme sets it */
const cssColor = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * A burst from `from` (e.g. the person's column heading), in their colour. `everyone` = the last
 * person just finished too: a bigger burst from both sides of the screen.
 */
export function celebrate({ from, tone, everyone = false }: { from?: Element | null; tone: number; everyone?: boolean }): void {
  const colors = [cssColor(`--t${tone}`), cssColor('--t1'), cssColor('--t2'), cssColor('--t3'), cssColor('--t4'), '#ffffff'].filter(Boolean);
  const base = { colors, disableForReducedMotion: true, zIndex: 100 };
  const r = from?.getBoundingClientRect();
  const origin = r
    ? { x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height / 2) / innerHeight }
    : { x: 0.5, y: 0.4 };
  void confetti({ ...base, particleCount: 90, spread: 75, startVelocity: 38, origin });
  if (!everyone) return;
  setTimeout(() => {
    void confetti({ ...base, particleCount: 120, angle: 60, spread: 70, origin: { x: 0, y: 0.75 } });
    void confetti({ ...base, particleCount: 120, angle: 120, spread: 70, origin: { x: 1, y: 0.75 } });
  }, 250);
}
