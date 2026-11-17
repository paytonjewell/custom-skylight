// Who the dashboard is for: the Worker's FAMILY setting (worker/home.ts). Loaded at start and kept on
// the device, so a reload shows the right people straight away.
import { api } from './api';
import { dataStore } from './store';
import { store } from '../lib/store';
import { FAMILY_KEY } from './initial';
import type { Person } from './types';

const setFamily = (people: Person[]) => dataStore.set((d) => ({ ...d, people, ALL: people.map((p) => p.id) }));

let started = false;
export function startFamilySync(): void {
  if (started) return;
  started = true;
  api.family().then(
    (people) => {
      setFamily(people);
      store(FAMILY_KEY, JSON.stringify(people));
    },
    (e) => console.warn('Family not loaded', e),
  );
}
