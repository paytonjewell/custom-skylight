import type { CSSProperties } from 'react';
import type { CalEvent, Data, Person } from '../data/types';
import { useData } from '../data/store';
import { evColor, evStripes, person } from '../data/select';
import { Icon } from './Icon';

/**
 * CSS variables for a person's colour. People carry a palette slot ("tone"); the active theme
 * defines the actual colours, so switching themes recolours everything without re-rendering.
 */
export function toneStyle(p: Pick<Person, 'tone' | 'color'>, extra?: CSSProperties): CSSProperties {
  if (p.color) return { ...ownColor(p.color), ...NO_STRIPES, ...extra } as CSSProperties;
  return {
    ...NO_STRIPES,
    '--c': `var(--t${p.tone})`,
    '--c-rgb': `var(--t${p.tone}-rgb)`,
    '--c-ink': `var(--t${p.tone}-ink)`,
    // Soft background in the person's colour; strength (--tint) comes from the theme
    '--c-tint': `rgb(var(--t${p.tone}-rgb) / var(--tint))`,
    ...extra,
  } as CSSProperties;
}

// Only eventStyle sets the striped fills; everything else resets them, so a stripe never leaks
// from an event into something inside it ('initial' makes var() use its fallback)
const NO_STRIPES = { '--c-fill': 'initial', '--c-tint-fill': 'initial' };

/** One person's colour, solid and as the theme's soft tint */
function shades(p: Pick<Person, 'tone' | 'color'>): [string, string] {
  if (p.color) {
    const v = ownColor(p.color);
    return [v['--c'], v['--c-tint']];
  }
  return [`var(--t${p.tone})`, `rgb(var(--t${p.tone}-rgb) / var(--tint))`];
}

/** Diagonal bands, one per colour, repeating (the band width is in CSS: --stripe) */
const bands = (colors: string[]) =>
  'repeating-linear-gradient(135deg, ' +
  colors.map((c, i) => `${c} calc(var(--stripe, 16px) * ${i}) calc(var(--stripe, 16px) * ${i + 1})`).join(', ') +
  ')';

/**
 * An event's colours: toneStyle for its colour (the first person's, Family's for everyone, or its
 * calendar's own), plus, when it's for two or more people, striped fills in each of their colours.
 * Event surfaces paint with var(--c-fill, var(--c)) or var(--c-tint-fill, var(--c-tint)).
 */
export function eventStyle(d: Data, e: CalEvent, extra?: CSSProperties): CSSProperties {
  const ps = evStripes(d, e);
  const base = toneStyle(ps[0] ?? evColor(d, e), extra);
  if (!ps.length) return base;
  const s = ps.map(shades);
  return {
    ...base,
    '--c-fill': bands(s.map((x) => x[0])),
    '--c-tint-fill': bands(s.map((x) => x[1])),
  } as CSSProperties;
}

export function Avatar({ p, size = 48, className }: { p: Person; size?: number; className?: string }) {
  return (
    <span
      className={'avatar' + (className ? ' ' + className : '')}
      style={toneStyle(p, { width: size, height: size, fontSize: Math.round(size * 0.46) })}
    >
      {p.id === 'family' ? (
        <Icon name="asterisk" size={Math.round(size * 0.5)} className="avatar-asterisk" />
      ) : p.pet ? (
        <Icon name="paw" size={Math.round(size * 0.5)} className="i--fill" />
      ) : (
        p.name[0]
      )}
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
  const n = parseInt(hex.slice(1), 16),
    r = n >> 16,
    g = (n >> 8) & 255,
    b = n & 255;
  const light = 0.299 * r + 0.587 * g + 0.114 * b > 160;
  return {
    '--c': hex,
    '--c-rgb': `${r} ${g} ${b}`,
    '--c-ink': light ? '#1F1B24' : '#FFFFFF',
    '--c-tint': `rgb(${r} ${g} ${b} / var(--tint))`,
  };
}
