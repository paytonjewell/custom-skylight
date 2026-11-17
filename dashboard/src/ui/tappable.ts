// For something tapped as a whole that can't be a <button> because it holds buttons of its own (a
// calendar day with its events, a list row with its swipe actions): it still says it's a button,
// can be reached with Tab, and Enter or Space taps it. Write role="button" tabIndex={0} beside it (in
// the JSX, so the linter sees them).
import type { KeyboardEvent } from 'react';

export const tappable = (run: () => void) => ({
  onClick: run,
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
    // Only when it has the focus itself, not one of the buttons inside it
    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    run();
  },
});
