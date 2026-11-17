import type { PointerEvent as ReactPointerEvent, ReactNode, Ref } from 'react';

/** What useHoldReorder puts on each tab, when the tabs can be put in another order */
interface MoveProps {
  ref: (el: HTMLElement | null) => void;
  onPointerDown: (e: ReactPointerEvent) => void;
  onContextMenu: (e: { preventDefault(): void }) => void;
  onClickCapture: (e: { preventDefault(): void; stopPropagation(): void }) => void;
}

interface Props<T extends string> {
  options: readonly (readonly [T, ReactNode])[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** Hold a tab, then drag it to reorder (useHoldReorder's itemProps) */
  move?: (value: T) => MoveProps;
  /** The tab being moved: an empty slot where it will go */
  lifted?: T;
  /** The row of tabs (useHoldReorder measures tabs from it) */
  boxRef?: Ref<HTMLDivElement>;
}

/** Row of tabs with one selected (calendar modes, routines, stores, news topics, photo layouts) */
export function Segmented<T extends string>({ options, value, onChange, className, move, lifted, boxRef }: Props<T>) {
  return (
    <div className={'seg' + (className ? ' ' + className : '')} ref={boxRef}>
      {options.map(([v, label]) => (
        <button
          key={v}
          {...move?.(v)}
          className={(v === value ? 'is-on' : '') + (v === lifted ? ' is-lifted' : '')}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
