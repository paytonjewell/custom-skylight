import type { CalEvent } from '../../data/types';
import { dataStore, useData } from '../../data/store';
import { evLabel, isFamily, leaveBy, person } from '../../data/select';
import { fmt } from '../../lib/fmt';
import { useNow } from '../../lib/clock';
import { closeSheet, openSheet, toast } from '../../app/ui';
import { setTaskDone } from '../../data/actions';
import { openEditEventSheet, removeEvent } from './AddEventSheet';
import { Icon } from '../../ui/Icon';
import { Avatar, eventStyle, toneStyle } from '../../ui/people';
import { SheetHeader } from '../../ui/headers';
import css from './EventSheet.module.css';

export function openEventSheet(e: CalEvent): void {
  // A task on the calendar: tapping it checks it off (or back on)
  if (e.task) {
    const { id, day, done } = e.task;
    const t = dataStore.get().tasks.find((x) => x.id === id);
    if (!t) return;
    setTaskDone(id, day, !done, t.who === 'any' ? null : t.who);
    toast(
      <>
        {done ? 'Not done: ' : 'Done: '}
        <b>{t.title}</b>
      </>,
      { icon: 'check', undo: () => setTaskDone(id, day, done, t.who === 'any' ? null : t.who) },
    );
    return;
  }
  openSheet(() => <EventSheet e={e} />, { cls: css.sheet });
}

function EventSheet({ e }: { e: CalEvent }) {
  const data = useData();
  const now = useNow();
  const fam = isFamily(data, e);
  const who = fam ? data.people : e.people.map((id) => person(data, id));
  const cal = data.calendars.find((c) => c.id === e.calendar);
  return (
    <div className={css.evs} style={eventStyle(data, e)}>
      <div className={css.band}>
        <div className="label label--on">
          {fmt.rel(e.start, now)} · {fmt.month(e.start)} {e.start.getDate()}
        </div>
        <h2 className="serif">{evLabel(e)}</h2>
        <div className={css.time + ' num'}>{e.allDay ? 'All day' : fmt.range(e.start, e.end)}</div>
      </div>
      <div className={css.body}>
        {e.travel ? (
          <div className={css.row + ' ' + css.leave}>
            <Icon name="car" size={28} />
            <div>
              <b>Leave by {fmt.time(leaveBy(e))}</b>
              <span>{e.travel} min drive in current traffic</span>
            </div>
          </div>
        ) : null}
        {e.loc ? (
          <div className={css.row}>
            <Icon name="place" size={28} />
            <div>
              <b>{e.loc}</b>
              <span>Tap to send directions to phone</span>
            </div>
          </div>
        ) : null}
        {!e.color && (
          <div className={css.row}>
            <Icon name="person" size={28} />
            <div className={css.people}>
              {who.map((p) => (
                <span key={p.id} className="chip" style={toneStyle(p)}>
                  <Avatar p={p} size={32} />
                  {p.name}
                </span>
              ))}
            </div>
          </div>
        )}
        {cal && (
          <div className={css.row}>
            <Icon name="calendar" size={28} />
            <div>
              <b>{cal.name}</b>
              <span>{e.recurring ? 'Repeating event' : 'Google Calendar'}</span>
            </div>
          </div>
        )}
        {e.notes ? <div className={css.notes + ' serif'}>“{e.notes}”</div> : null}
        {cal?.writable && (
          <div className={css.actions}>
            <button
              className={'btn btn--ghost ' + css.delete}
              onClick={() => {
                closeSheet();
                removeEvent(e);
              }}
            >
              <Icon name="trash" size={20} /> Delete
            </button>
            <button
              className="btn btn--solid"
              onClick={() => {
                closeSheet();
                openEditEventSheet(e);
              }}
            >
              <Icon name="edit" size={20} /> Edit
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Events that didn't fit side by side in a time slot */
export function openMoreSheet(list: CalEvent[]): void {
  openSheet(() => <MoreSheet list={list} />);
}

function MoreSheet({ list }: { list: CalEvent[] }) {
  const data = useData();
  return (
    <div className="sheet-pad">
      <SheetHeader kicker="Overlapping" title={`${list.length} more events`} />
      <div className={css.moreList}>
        {list.map((e) => (
          <button key={e.id} className={css.moreRow} style={eventStyle(data, e)} onClick={() => openEventSheet(e)}>
            <i />
            <b>{evLabel(e)}</b>
            <span>{fmt.range(e.start, e.end)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
