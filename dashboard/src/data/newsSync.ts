// Keeps the news in step with the Worker (worker/news): loads it at start, then every 15 minutes and
// whenever the page becomes visible. The Worker checks each feed about hourly.
import { createStore, useStore } from '../lib/store';
import { api } from './api';
import { dataStore } from './store';

const REFRESH_MS = 15 * 60 * 1000;

export type NewsStatus = 'loading' | 'ready' | 'error';
const status = createStore<NewsStatus>('loading');
export const useNewsStatus = () => useStore(status, (s) => s);

/** When the Worker last refreshed the feeds */
const updated = createStore<Date | null>(null);
export const useNewsUpdated = () => useStore(updated, (u) => u);

async function refreshNews(): Promise<void> {
  try {
    const n = await api.news();
    dataStore.set((d) => ({ ...d, news: n.stories, newsTopics: n.topics }));
    updated.set(new Date(n.updated));
    status.set('ready');
  } catch {
    if (status.get() === 'loading') status.set('error');
  }
}

let started = false;
export function startNewsSync(): void {
  if (started) return;
  started = true;
  void refreshNews();
  setInterval(refreshNews, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshNews();
  });
}
