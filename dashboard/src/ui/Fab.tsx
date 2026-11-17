import { Icon } from './Icon';

/**
 * The round + for a screen's main "add" (event, task, list, recipe). On a phone it floats above the
 * tab bar in the same spot on every screen; on the frame it sits wherever it's placed (the calendar
 * header). Styles: .fab in css/components.css.
 */
export function Fab({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="fab" aria-label={label} onClick={onClick}>
      <Icon name="plus" size={26} />
    </button>
  );
}
