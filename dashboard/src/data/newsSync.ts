// Keeps the news in step with the Worker (worker/news; see createSync, src/data/sync.ts). The Worker
// checks each feed about hourly, so every 15 minutes is often enough here.
import { createStore, useStore } from '../lib/store';
import { api } from './api';
import { dataStore } from './store';
import { createSync } from './sync';

/** When the Worker last refreshed the feeds */
const updated = createStore<Date | null>(null);
export const useNewsUpdated = () => useStore(updated, (u) => u);

const sync = createSync({
  load: api.news,
  apply: (n) => {
    dataStore.set((d) => ({ ...d, news: n.stories, newsTopics: n.topics }));
    updated.set(new Date(n.updated));
  },
  refreshMs: 15 * 60 * 1000,
});

export const useNewsStatus = sync.useStatus;
export const startNewsSync = () => sync.start();
