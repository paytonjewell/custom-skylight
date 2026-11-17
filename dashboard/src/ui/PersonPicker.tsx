import type { Person } from '../data/types';
import { Avatar, toneStyle } from './people';
import css from './PersonPicker.module.css';

interface Props {
  people: Person[];
  /** Ids shown as selected (include 'family' to highlight the Everyone button) */
  selected?: string[];
  onPick: (id: string) => void;
  /** Adds an "Everyone" button; picking it calls onPick('family') */
  everyone?: Person;
  /** Label for that button (default "Everyone"; tasks say "Anyone") */
  everyoneLabel?: string;
  avatarSize?: number;
  big?: boolean;
  /** Shown after the Everyone button (tasks-only profiles, after Anyone) */
  after?: Person[];
}

/** Row of people as big avatar buttons (who's involved / who did it) */
export function PersonPicker({
  people,
  selected = [],
  onPick,
  everyone,
  everyoneLabel = 'Everyone',
  avatarSize = 56,
  big,
  after = [],
}: Props) {
  const button = (p: Person, label?: string) => (
    <PersonButton
      key={p.id}
      p={p}
      label={label ?? p.name}
      on={selected.includes(p.id)}
      size={avatarSize}
      onPick={onPick}
    />
  );
  return (
    <div className={css.picker + (big ? ' ' + css.big : '')}>
      {people.map((p) => button(p))}
      {everyone && button(everyone, everyoneLabel)}
      {after.map((p) => button(p))}
    </div>
  );
}

function PersonButton({
  p,
  label,
  on,
  size,
  onPick,
}: {
  p: Person;
  label: string;
  on: boolean;
  size: number;
  onPick: (id: string) => void;
}) {
  return (
    <button className={css.person + (on ? ' ' + css.isOn : '')} style={toneStyle(p)} onClick={() => onPick(p.id)}>
      <Avatar p={p} size={size} />
      <span>{label}</span>
    </button>
  );
}
