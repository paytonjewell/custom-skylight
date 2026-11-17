import type { ReactNode } from 'react';
import css from './EmptyNote.module.css';

/**
 * Quiet serif line for empty states ("Free the rest of the day"). Put an aside in <i> for the
 * lighter italic. `className` adds placement (padding, position) for where it's used.
 */
export function EmptyNote({ large, className, children }: { large?: boolean; className?: string; children: ReactNode }) {
  return <div className={css.note + ' serif' + (large ? ' ' + css.large : '') + (className ? ' ' + className : '')}>{children}</div>;
}
