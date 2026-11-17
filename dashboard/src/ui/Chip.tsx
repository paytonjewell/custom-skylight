// Chips: the rounded choice buttons in sheets (.chip in css/components.css). `on` marks the chosen one.
import { useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import css from './Chip.module.css';

export function Chip({
  on,
  className,
  ...rest
}: { on: boolean; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={'chip' + (on ? ' is-on' : '') + (className ? ' ' + className : '')} {...rest} />;
}

/** Opens the date picker (a tap on a hidden date field doesn't, in desktop Chrome) */
function openPicker(el: HTMLInputElement | null) {
  try {
    el?.showPicker();
  } catch {
    el?.click();
  }
}

/** A chip that opens the system date picker; `value`/`onChange` are YYYY-MM-DD */
export function DateChip({
  on,
  value,
  min,
  onChange,
  children,
}: {
  on: boolean;
  value: string;
  min?: string;
  onChange: (day: string) => void;
  children: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <Chip on={on} className={css.dateChip} onClick={() => openPicker(input.current)}>
      {children}
      <input
        ref={input}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={value}
        min={min}
        onChange={(e) => onChange(e.target.value)}
      />
    </Chip>
  );
}
