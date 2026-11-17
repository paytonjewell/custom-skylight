// − 3 + : a number changed one at a time (days an event lasts, servings, every N weeks)
import { Icon } from './Icon';
import css from './Stepper.module.css';

export function Stepper({
  value,
  onChange,
  min = 1,
  max,
  unit,
  label,
  compact,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max: number;
  /** After the number ("days"), given the number so it can say "day" for one */
  unit?: (n: number) => string;
  /** What's being counted, for the buttons' names ("servings" → "Fewer servings") */
  label: string;
  /** Smaller, on a card (the recipe sheets) */
  compact?: boolean;
}) {
  return (
    <div className={css.stepper + (compact ? ' ' + css.compact : '')} role="group" aria-label={label}>
      <button
        className="icon-btn"
        aria-label={'Fewer ' + label}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        <Icon name="minus" size={compact ? 18 : 22} />
      </button>
      <b className="num">{value}</b>
      <button
        className="icon-btn"
        aria-label={'More ' + label}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <Icon name="plus" size={compact ? 18 : 22} />
      </button>
      {unit && <span>{unit(value)}</span>}
    </div>
  );
}
