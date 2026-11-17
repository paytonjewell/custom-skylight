// Emoji picker (emoji-mart), sized for touch: big buttons on the frame, smaller on phones. The picker
// and its emoji data (bundled, so it works offline) load the first time it opens, so they don't
// slow down the app's start. Uses emoji-mart's own element: its React wrapper doesn't support React 19.
import { useEffect, useRef, useState } from 'react';
import { useLayout } from '../app/layout';
import { useTheme } from '../app/theme';
import css from './EmojiPicker.module.css';

/** Sizes by layout: buttons per row, button and emoji size (px) */
const SIZES = {
  frame: { perLine: 11, emojiButtonSize: 64, emojiSize: 40 },
  phone: { perLine: 7, emojiButtonSize: 46, emojiSize: 30 },
};

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const layout = useLayout();
  const dark = useTheme() === 'dark';
  const [ready, setReady] = useState(false);
  // The latest onPick, so the picker doesn't need rebuilding when it changes
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    let picker: HTMLElement | null = null;
    let cancelled = false;
    void Promise.all([import('emoji-mart'), import('@emoji-mart/data')]).then(([{ Picker }, data]) => {
      if (cancelled || !host.current) return;
      picker = new Picker({
        data: data.default,
        set: 'native',
        theme: dark ? 'dark' : 'light',
        ...SIZES[layout],
        emojiButtonRadius: '14px',
        previewPosition: 'none',
        navPosition: 'top',
        searchPosition: 'sticky',
        skinTonePosition: 'search',
        maxFrequentRows: 2,
        // Focusing the search would pop up the on-screen keyboard over the grid
        autoFocus: false,
        onEmojiSelect: (e: { native: string }) => pick.current(e.native),
      }) as unknown as HTMLElement;
      host.current.appendChild(picker);
      setReady(true);
    });
    return () => {
      cancelled = true;
      picker?.remove();
    };
  }, [layout, dark]);

  return (
    <div className={css.host + (layout === 'phone' ? ' ' + css.phone : '')} ref={host}>
      {!ready && <p className={css.loading}>Loading emoji…</p>}
    </div>
  );
}
