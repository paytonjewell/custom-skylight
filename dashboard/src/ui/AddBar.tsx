// The big "+ Add an item…" field at the top of a list's side panel (checklists and groceries)
import type { Ref } from 'react';
import { Icon } from './Icon';
import css from './AddBar.module.css';

export function AddBar({
  value,
  onChange,
  onSubmit,
  inputRef,
  placeholder = 'Add an item…',
}: {
  value: string;
  onChange: (value: string) => void;
  /** Enter was pressed */
  onSubmit: () => void;
  inputRef?: Ref<HTMLInputElement>;
  placeholder?: string;
}) {
  return (
    <label className={css.bar}>
      <Icon name="plus" size={30} />
      <input
        ref={inputRef}
        className={css.input}
        placeholder={placeholder}
        autoComplete="off"
        enterKeyHint="done"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit();
        }}
      />
    </label>
  );
}
