import { useRef } from 'react';

/**
 * Inline text field for editing a row's text in place (list items, groceries): starts focused with
 * the text selected; Enter or tapping elsewhere saves, Escape cancels (onDone gets null).
 */
export function EditField({ className, value, label = 'Item text', onDone }: {
  className: string;
  value: string;
  label?: string;
  onDone: (value: string | null) => void;
}) {
  const cancelled = useRef(false);
  return (
    <input
      className={className}
      defaultValue={value}
      aria-label={label}
      autoComplete="off"
      enterKeyHint="done"
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      // A press in the field is for the text cursor: not a drag, swipe or check-off
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => onDone(cancelled.current ? null : e.currentTarget.value)}
    />
  );
}
