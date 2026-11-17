// Google Calendar settings: connected Google accounts, which of their calendars show, whose each one
// is (a person or everyone, by the names in titles, or no one: shown in a colour of its own), and
// which one new events go on. Connecting happens on Google's pages (worker/google.ts), which send
// the browser back to /?google=…#calendar; checkGoogleReturn opens this sheet then.
import { useState } from 'react';
import type { Data } from '../../data/types';
import { useData } from '../../data/store';
import { api } from '../../data/api';
import { setCalendar } from '../../data/actions';
import { refreshEvents } from '../../data/calendarSync';
import { IS_KIOSK } from '../../app/layout';
import { closeSheet, go, openSheet, toast } from '../../app/ui';
import { SheetHeader } from '../../ui/headers';
import { Icon } from '../../ui/Icon';
import { EmojiPicker } from '../../ui/EmojiPicker';
import { Avatar, toneStyle } from '../../ui/people';
import css from './CalendarSettings.module.css';
import { calendarPeople } from '../../data/select';

export function openCalendarSettings(): void {
  // Up to date when it opens (e.g. Google just set up on the server, or a calendar added in Google)
  void refreshEvents();
  openSheet(() => <CalendarSettings />, { cls: 'sheet--wide' });
}

const RESULTS: Record<string, string> = {
  connected: 'Google account connected. Pick which calendars to show.',
  cancelled: 'Google sign-in was cancelled',
  noaccess: 'Calendar access wasn’t allowed. Connect again and tick the calendar boxes.',
  failed: 'Couldn’t connect to Google. Try again.',
};

/** Back from Google's sign-in: say how it went, and open the settings */
export function checkGoogleReturn(): void {
  const q = new URLSearchParams(location.search);
  const result = q.get('google');
  if (!result) return;
  q.delete('google');
  history.replaceState(null, '', location.pathname + (q.size ? '?' + q : '') + location.hash);
  go('calendar');
  toast(RESULTS[result] ?? RESULTS.failed, { icon: result === 'connected' ? 'calendar' : 'x', ms: 6000 });
  if (result === 'connected') openCalendarSettings();
}

/** Who a calendar can belong to */
const owners = (d: Data) => [...calendarPeople(d.people), d.family];
/** Colours for calendars that are no one's */
const COLORS = ['#D9534F', '#F0883E', '#FFCD00', '#7FB069', '#203731', '#3FA7B5', '#4A7BD0', '#8E6CCF', '#D96BA8', '#8D6E63', '#5F6B73'];

function CalendarSettings() {
  const data = useData();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  /** The calendar whose emoji is being picked */
  const [picking, setPicking] = useState<string | null>(null);
  const run = (f: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    f().then(
      () => { void refreshEvents(); if (done) toast(done, { icon: 'calendar' }); },
      (e: Error) => toast(e.message || 'Something went wrong', { icon: 'x' }),
    ).finally(() => setBusy(false));
  };
  const connectButton = (label: string) =>
    IS_KIOSK ? null : (
      <a className="btn btn--solid" href="/api/google/connect">
        <Icon name="calendar" size={20} /> {label}
      </a>
    );

  return (
    <div className="sheet-pad">
      <SheetHeader kicker="Calendar" title="Google Calendar" />
      {data.googleConfigured === false && (
        <p className={css.note}>Google Calendar isn’t set up on the server yet (the Google OAuth client id and secret).</p>
      )}
      {data.googleConfigured && !data.googleAccounts.length && (
        <p className={css.note}>
          Connect a Google account to show its calendars here and add events to them.
          {IS_KIOSK && ' Do this from a phone or computer; Google doesn’t allow signing in on the frame.'}
        </p>
      )}

      {data.googleAccounts.map((a) => (
        <section key={a.id} className={css.account}>
          <header className={css.accountHead}>
            <b>{a.email}</b>
            {a.error && <span className={css.error}>Needs connecting again</span>}
            <button
              className={'btn btn--ghost ' + css.disconnect}
              disabled={busy}
              onClick={() => {
                if (confirm !== a.id) return setConfirm(a.id);
                setConfirm(null);
                run(() => api.disconnectGoogle(a.id), 'Disconnected ' + a.email);
              }}
            >
              {confirm === a.id ? 'Tap again to disconnect' : 'Disconnect'}
            </button>
          </header>
          {a.error && connectButton('Connect again')}
          <ul className={css.calendars}>
            {data.calendars.filter((c) => c.account === a.id).map((c) => (
              <li key={c.id} className={css.cal + (c.shown ? ' ' + css.isShown : '')}>
                <label className={css.calName}>
                  <input type="checkbox" checked={c.shown} onChange={(e) => setCalendar(c.id, { shown: e.target.checked })} />
                  <i style={{ background: c.color }} />
                  <span>
                    {c.name}
                    {!c.writable && <small>View only</small>}
                  </span>
                </label>
                {c.shown && (
                  <div className={css.settings}>
                    <small className={css.ask}>{c.person !== 'none' && c.byName ? 'Events that name no one are for' : 'Whose is it?'}</small>
                    <div className={css.owners} role="group" aria-label={'Whose is ' + c.name + '?'}>
                      {owners(data).map((p) => (
                        <button
                          key={p.id}
                          className={css.owner + (c.person === p.id ? ' ' + css.isOn : '')}
                          style={toneStyle(p)}
                          onClick={() => setCalendar(c.id, { person: p.id })}
                        >
                          <Avatar p={p} size={30} />
                          <span>{p.id === 'family' ? 'Everyone' : p.name}</span>
                        </button>
                      ))}
                      <button
                        className={css.owner + (c.person === 'none' ? ' ' + css.isOn : '')}
                        style={toneStyle({ tone: 0, color: c.color })}
                        onClick={() => setCalendar(c.id, { person: 'none' })}
                      >
                        <i className={css.swatch} style={{ background: c.color }} />
                        <span>No one</span>
                      </button>
                    </div>
                    {c.person === 'none' ? (
                      <>
                        <small className={css.ask}>Shown for everyone in its own colour</small>
                        <div className={css.colors} role="group" aria-label={'Colour for ' + c.name}>
                          {COLORS.map((hex) => (
                            <button
                              key={hex}
                              className={css.color + (c.color.toLowerCase() === hex.toLowerCase() ? ' ' + css.isOn : '')}
                              style={{ background: hex }}
                              aria-label={'Colour ' + hex}
                              onClick={() => setCalendar(c.id, { color: hex })}
                            />
                          ))}
                        </div>
                      </>
                    ) : (
                      <label className={css.toggle}>
                        <input type="checkbox" checked={c.byName} onChange={(e) => setCalendar(c.id, { byName: e.target.checked })} />
                        <span>
                          Names in titles pick who it’s for
                          <small>“{(data.people[0]?.name ?? 'Sam') + ' dentist'}” is {(data.people[0]?.name ?? 'Sam') + '’s'}</small>
                        </span>
                      </label>
                    )}
                    <div className={css.emojiRow}>
                      <button
                        className={css.emojiBtn + (picking === c.id ? ' ' + css.isOn : '')}
                        aria-label={'Emoji for ' + c.name}
                        onClick={() => setPicking(picking === c.id ? null : c.id)}
                      >
                        {c.emoji || <Icon name="smile" size={24} />}
                      </button>
                      <span>
                        {c.emoji ? 'On its events' : 'Emoji for its events'}
                        <small>
                          {c.holidays ? 'Each holiday already gets its own; this is for the rest' : 'Unless an event has its own'}
                        </small>
                      </span>
                    </div>
                    {picking === c.id && (
                      <div className={css.picker}>
                        <EmojiPicker onPick={(e) => { setCalendar(c.id, { emoji: e }); setPicking(null); }} />
                        {c.emoji && (
                          <button className="btn btn--ghost" onClick={() => { setCalendar(c.id, { emoji: '' }); setPicking(null); }}>No emoji</button>
                        )}
                      </div>
                    )}
                    {c.writable && (
                      <label className={css.toggle}>
                        <input type="radio" name="default-calendar" checked={c.isDefault} onChange={() => setCalendar(c.id, { isDefault: true })} />
                        <span>New events go here</span>
                      </label>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <div className={css.actions}>
        {data.googleConfigured && connectButton(data.googleAccounts.length ? 'Connect another account' : 'Connect Google Calendar')}
        {data.googleAccounts.length > 0 && (
          <button className="btn btn--ghost" disabled={busy} onClick={() => run(api.refreshCalendars, 'Calendars refreshed')}>
            <Icon name="refresh" size={20} /> Refresh from Google
          </button>
        )}
      </div>
      <div className="sheet-actions">
        <button className="btn btn--solid" onClick={closeSheet}>Done</button>
      </div>
    </div>
  );
}
