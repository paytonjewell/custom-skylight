import type { CalEvent } from '../data/types';
import { useData } from '../data/store';
import { daysBetween } from '../lib/dates';
import { fmt, pluralize } from '../lib/fmt';
import { useNow } from '../lib/clock';
import { openEventSheet } from '../views/calendar/EventSheet';
import { Icon } from './Icon';
import { eventStyle } from './people';
import css from './CountdownChip.module.css';

const EMOJI = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/u;

/**
 * "Jacob's birthday · 12 days" chip for an upcoming event. The event's emoji becomes the icon; one at a
 * time of day also shows when it starts ("Leo doctor · Tue, Nov 25 · 3:30 PM").
 * glass: compact two-line version for over photos (ambient mode shares the width six ways).
 */
export function CountdownChip({ e, glass, className }: { e: CalEvent; glass?: boolean; className?: string }) {
  const data = useData('ALL', 'family', 'people');
  const now = useNow();
  const days = daysBetween(now, e.start);
  // Its emoji (or, for the sample events, one in the title) becomes the icon
  const emoji = e.emoji ?? e.title.match(EMOJI)?.[0];
  const title = !e.emoji && emoji ? e.title.replace(emoji, '').replace(/\s+/g, ' ').trim() : e.title;
  const d = e.start;
  const unit = pluralize(days, 'day');
  const at = e.allDay ? '' : ` · ${fmt.hour(d)}`;
  const icon = (
    <span className={css.icon}>
      {emoji ? <span className={css.emoji}>{emoji}</span> : <Icon name="calendar" size={22} />}
    </span>
  );

  return (
    <button
      className={css.chip + (glass ? ' ' + css.glass : ' surface') + (className ? ' ' + className : '')}
      style={eventStyle(data, e)}
      onClick={() => openEventSheet(e)}
    >
      {icon}
      {glass ? (
        <span className={css.text}>
          <b>{title}</b>
          <small>
            <em className={css.n}>{days}</em> {unit} · {fmt.monthShort(d)} {d.getDate()}
            {at}
          </small>
        </span>
      ) : (
        <>
          <span className={css.text}>
            <b>{title}</b>
            <small>
              {fmt.dayShort(d)}, {fmt.monthShort(d)} {d.getDate()}
              {at}
            </small>
          </span>
          <span className={css.days}>
            <b>{days}</b>
            <small>{unit}</small>
          </span>
        </>
      )}
    </button>
  );
}
