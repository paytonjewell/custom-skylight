import { createStore, useStore } from '../lib/store';
import { initialData } from './initial';
import type { Data } from './types';

/** All dashboard data, loaded from (and saved through) the Worker + D1 API */
export const dataStore = createStore<Data>(initialData());

export const useData = (): Data => useStore(dataStore, (d) => d);

/**
 * Id for a record saved to the server (e.g. lists): 20 random base-36 characters, unique across
 * devices. (crypto.randomUUID needs HTTPS; getRandomValues also works over plain-http LAN dev.)
 */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}
