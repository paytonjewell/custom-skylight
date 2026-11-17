// The Tasks settings sheet (the cog): which people and sections show, all tasks or only those to do
// or done (all saved on this device), and turning phone reminders on for this phone.
import { useState } from 'react';
import { Chip } from '../../ui/Chip';
import { pushSupported, testPush, turnOffPush, turnOnPush, usePush } from '../../data/push';
import { person, phonePeople, type PeopleData } from '../../data/select';
import { useStore } from '../../lib/store';
import { closeSheet, toast } from '../../app/ui';
import { Icon } from '../../ui/Icon';
import { SheetHeader } from '../../ui/headers';
import { PersonPicker } from '../../ui/PersonPicker';
import {
  DONE_VIEWS,
  SECTIONS,
  doneView,
  lanesOf,
  peopleFilter,
  sectionFilter,
  setDoneView,
  showing,
  taskPickerPeople,
  toggleIn,
} from './settings';
import css from './TaskSettingsSheet.module.css';

export function SettingsSheet({ data }: { data: PeopleData }) {
  const people = useStore(peopleFilter.store, (s) => s);
  const sections = useStore(sectionFilter.store, (s) => s);
  const show = useStore(doneView, (s) => s);
  const onPeople = people ?? lanesOf(data);
  return (
    <div className="sheet-pad">
      <SheetHeader kicker="Tasks" title="Settings" />
      <div className={'label ' + css.sheetLabel}>People</div>
      <PersonPicker
        {...taskPickerPeople(data)}
        everyone={data.family}
        everyoneLabel="Anyone"
        selected={onPeople.map((id) => (id === 'any' ? 'family' : id))}
        onPick={(id) => toggleIn(peopleFilter, people, lanesOf(data), id === 'family' ? 'any' : id)}
      />
      <ShowSettings />
      <div className={'label ' + css.sheetLabel}>Reminders on this phone</div>
      <PhoneReminders data={data} />
      <div className="sheet-actions">
        <button
          className="btn btn--ghost"
          disabled={!people && !sections && show === 'all'}
          onClick={() => {
            peopleFilter.set(null);
            sectionFilter.set(null);
            setDoneView('all');
          }}
        >
          Reset
        </button>
        <button className="btn btn--solid" onClick={closeSheet}>
          Done
        </button>
      </div>
    </div>
  );
}

/** Which sections show, and all tasks, only those to do, or only done ones. Saved on this device, for the Tasks screen and the sheets on Today. */
export function ShowSettings({ labelClass = css.sheetLabel }: { labelClass?: string }) {
  const sections = useStore(sectionFilter.store, (s) => s);
  const show = useStore(doneView, (s) => s);
  return (
    <>
      <div className={'label ' + labelClass}>Sections</div>
      <div className="chips">
        {SECTIONS.map(([id, label]) => (
          <Chip
            key={id}
            on={showing(sections, id)}
            onClick={() =>
              toggleIn(
                sectionFilter,
                sections,
                SECTIONS.map(([s]) => s),
                id,
              )
            }
          >
            {showing(sections, id) && <Icon name="check" size={18} />}
            {label}
          </Chip>
        ))}
      </div>
      <div className={'label ' + labelClass}>Show</div>
      <div className="chips">
        {DONE_VIEWS.map(([v, label]) => (
          <Chip key={v} on={show === v} onClick={() => setDoneView(v)}>
            {label}
          </Chip>
        ))}
      </div>
    </>
  );
}

/** Turn phone reminders on or off on this device, and say whose phone it is */
function PhoneReminders({ data }: { data: PeopleData }) {
  const on = usePush((s) => s.person);
  /** Who's ticked when reminders are off (who to turn them on for), or while a change is being saved */
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // While on, the ticked person is the push state's, so it follows changes made elsewhere
  const who = on && !(busy && picked) ? on : picked;
  const [error, setError] = useState('');
  const humans = phonePeople(data.people);
  if (!pushSupported) {
    return (
      <p className={css.remindNote}>Reminders go to phones. Open White Lotus HQ on your phone and turn them on here.</p>
    );
  }
  /** `ticked`: who shows as ticked meanwhile (and afterwards, if that turns reminders off) */
  const run = (f: () => Promise<void>, done: string, ticked = on) => {
    setPicked(ticked);
    setBusy(true);
    setError('');
    f()
      .then(
        () => {
          toast(done, { icon: 'bell' });
        },
        (e: Error) => setError(e.message || 'Something went wrong'),
      )
      .finally(() => setBusy(false));
  };
  const pick = (id: string) => {
    // Already on: switching person just saves it
    if (!on) setPicked(id);
    else if (id !== on) run(() => turnOnPush(id), `Reminders here are now for ${person(data, id).name}`, id);
  };
  return (
    <div className={css.remind}>
      <p className={css.remindNote}>
        {on ? (
          <>
            On: this phone gets <b>{person(data, on).name}</b>’s reminders.
          </>
        ) : (
          'Whose phone is this? It will only get reminders sent to them.'
        )}
      </p>
      <PersonPicker people={humans} avatarSize={44} selected={who ? [who] : []} onPick={pick} />
      <div className="chips">
        {on ? (
          <>
            <button className="chip" disabled={busy} onClick={() => run(testPush, 'Test sent')}>
              <Icon name="bell" size={18} /> Send a test
            </button>
            <button className="chip" disabled={busy} onClick={() => run(turnOffPush, 'Reminders off on this phone')}>
              Turn off
            </button>
          </>
        ) : (
          <button
            className="chip is-on"
            disabled={busy || !who}
            onClick={() => run(() => turnOnPush(who!), 'Reminders on', who)}
          >
            <Icon name="bell" size={18} /> Turn on reminders
          </button>
        )}
      </div>
      {error && <p className={css.remindError}>{error}</p>}
    </div>
  );
}
