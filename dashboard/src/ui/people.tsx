import type { CSSProperties } from 'react';
import type { Person } from '../data/types';
import { useData } from '../data/store';
import { person } from '../data/select';
import { Icon } from './Icon';

/**
 * CSS variables for a person's colour. People carry a palette slot ("tone"); the active theme
 * defines the actual colours, so switching themes recolours everything without re-rendering.
 */
export function toneStyle(p: Pick<Person, 'tone' | 'color'>, extra?: CSSProperties): CSSProperties {
  if (p.color) return { ...ownColor(p.color), ...extra } as CSSProperties;
  return {
    '--c': `var(--t${p.tone})`,
    '--c-rgb': `var(--t${p.tone}-rgb)`,
    '--c-ink': `var(--t${p.tone}-ink)`,
    // Soft background in the person's colour; strength (--tint) comes from the theme
    '--c-tint': `rgb(var(--t${p.tone}-rgb) / var(--tint))`,
    ...extra,
  } as CSSProperties;
}

export function Avatar({ p, size = 48, className }: { p: Person; size?: number; className?: string }) {
  return (
    <span
      className={'avatar' + (className ? ' ' + className : '')}
      style={toneStyle(p, { width: size, height: size, fontSize: Math.round(size * 0.46) })}
    >
      {p.id === 'family' ? <Icon name="asterisk" size={Math.round(size * 0.5)} className="avatar-asterisk" /> : p.pet ? <Icon name="paw" size={Math.round(size * 0.5)} className="i--fill" /> : p.name[0]}
    </span>
  );
}

/** A row of small colour dots, one per person */
export function Dots({ ids, size }: { ids: string[]; size?: number }) {
  const data = useData();
  return (
    <span className="dots">
      {ids.map((id) => (
        <i key={id} style={toneStyle(person(data, id), size ? { width: size, height: size } : undefined)} />
      ))}
    </span>
  );
}

/** The same variables as toneStyle, for a colour of its own ('#rrggbb'); text is dark or white to suit */
function ownColor(hex: string): Record<string, string> {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const light = 0.299 * r + 0.587 * g + 0.114 * b > 160;
  return {
    '--c': hex,
    '--c-rgb': `${r} ${g} ${b}`,
    '--c-ink': light ? '#1F1B24' : '#FFFFFF',
    '--c-tint': `rgb(${r} ${g} ${b} / var(--tint))`,
  };
}
