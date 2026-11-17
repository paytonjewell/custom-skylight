// Keeps Google Calendar in step with the Worker (worker/google.ts); see createSync (src/data/sync.ts).
// The Worker sends events as Google has them; src/data/calendar.ts makes them the calendar's
// CalEvents.
import { api } from './api';
import { dataStore } from './store';
import { createSync } from './sync';
import { withEvents } from './calendar';

const sync = createSync({
  load: async () => {
    const [info, events] = await Promise.all([api.calendars(), api.events()]);
    return { ...info, events };
  },
  apply: ({ configured, accounts, calendars, events }) =>
    dataStore.set((d) =>
      withEvents({ ...d, googleConfigured: configured, googleAccounts: accounts, calendars, eventRecords: events }),
    ),
  failMessage: 'Couldn’t save a change to the calendar',
  keep: 'calendar.last',
});

export const saveEvent = sync.save;
export const refreshEvents = sync.refresh;
export const startCalendarSync = () => sync.start();
