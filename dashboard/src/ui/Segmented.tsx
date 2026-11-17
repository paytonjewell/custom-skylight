import type { ReactNode } from 'react';

interface Props<T extends string> {
  options: readonly (readonly [T, ReactNode])[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/** Row of tabs with one selected (calendar modes, routines, stores, news topics, photo layouts) */
export function Segmented<T extends string>({ options, value, onChange, className }: Props<T>) {
  return (
    <div className={'seg' + (className ? ' ' + className : '')}>
      {options.map(([v, label]) => (
        <button key={v} className={v === value ? 'is-on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}
