import type { ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * Screen header: small label over a big serif title. `meta` sits right after the title (e.g. a
 * count); `children` are controls pushed to the right edge. `onBack` adds a back button before the
 * title (a screen within a screen, e.g. one list on the Lists screen).
 */
export function PageHeader({
  kicker,
  title,
  meta,
  className,
  onBack,
  children,
}: {
  kicker: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  className?: string;
  onBack?: () => void;
  children?: ReactNode;
}) {
  return (
    <header className={'page-head' + (className ? ' ' + className : '')}>
      {onBack && (
        <button className="icon-btn page-head-back" aria-label="Back" onClick={onBack}>
          <Icon name="left" size={30} />
        </button>
      )}
      <div className="page-head-title">
        <div className="label">{kicker}</div>
        <h1 className="serif">{title}</h1>
      </div>
      {meta}
      {children && <div className="page-head-end">{children}</div>}
    </header>
  );
}

/** Pop-up heading: small label over a serif title */
export function SheetHeader({ kicker, title }: { kicker: ReactNode; title: ReactNode }) {
  return (
    <>
      <div className="label">{kicker}</div>
      <h2 className="serif sheet-h">{title}</h2>
    </>
  );
}
