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
  const button = (p: Person, label: string) => (
    <button
      key={p.id}
      className={css.person + (selected.includes(p.id) ? ' ' + css.isOn : '')}
      style={toneStyle(p)}
      onClick={() => onPick(p.id)}
    >
      <Avatar p={p} size={avatarSize} />
      <span>{label}</span>
    </button>
  );
  return (
    <div className={css.picker + (big ? ' ' + css.big : '')}>
      {people.map((p) => button(p, p.name))}
      {everyone && button(everyone, everyoneLabel)}
      {after.map((p) => button(p, p.name))}
    </div>
  );
}
