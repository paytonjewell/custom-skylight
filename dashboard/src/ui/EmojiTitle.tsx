// The top of the add/edit sheets (tasks, events, recipes): an emoji button beside a big title field.
// Tapping the button opens the emoji picker under the row; with `clearable`, "No emoji" removes it.
import { useState, type ReactNode } from 'react';
import { EmojiPicker } from './EmojiPicker';
import { Icon } from './Icon';
import css from './EmojiTitle.module.css';

export function EmojiTitle({
  emoji,
  onEmoji,
  fallback,
  clearable,
  title,
  onTitle,
  placeholder,
  autoFocus,
  invalid,
  enterKeyHint = 'done',
}: {
  emoji: string;
  /** The chosen emoji, or '' for none */
  onEmoji: (emoji: string) => void;
  /** Shown on the button when there's no emoji (else a smiley) */
  fallback?: ReactNode;
  clearable?: boolean;
  title: string;
  onTitle: (title: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  /** Marked as needing a title (after trying to save without one) */
  invalid?: boolean;
  enterKeyHint?: 'done' | 'next';
}) {
  const [picking, setPicking] = useState(false);
  const pick = (e: string) => {
    onEmoji(e);
    setPicking(false);
  };
  return (
    <>
      <div className={css.row}>
        <button
          className={css.emoji + (picking ? ' ' + css.isOn : '')}
          aria-label={emoji ? 'Change emoji' : 'Add an emoji'}
          onClick={() => setPicking(!picking)}
        >
          {emoji || fallback || <Icon name="smile" size={28} />}
        </button>
        <input
          className={css.title + (invalid ? ' ' + css.isMissing : '')}
          placeholder={placeholder}
          aria-label={placeholder}
          value={title}
          autoFocus={autoFocus}
          enterKeyHint={enterKeyHint}
          onChange={(e) => onTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && enterKeyHint === 'done') e.currentTarget.blur();
          }}
        />
      </div>
      {picking && (
        <div className={css.picker}>
          <EmojiPicker onPick={pick} />
          {clearable && emoji && (
            <button className="btn btn--ghost" onClick={() => pick('')}>
              No emoji
            </button>
          )}
        </div>
      )}
    </>
  );
}
