// For something tapped as a whole that can't be a <button> because it holds buttons of its own (a
// calendar day with its events, a list row with its swipe actions): it still says it's a button,
// can be reached with Tab, and Enter or Space taps it.
import type { KeyboardEvent } from 'react';

export const tappable = (run: () => void) => ({
  role: 'button' as const,
  tabIndex: 0,
  onClick: run,
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
    // Only when it has the focus itself, not one of the buttons inside it
    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    run();
  },
});
