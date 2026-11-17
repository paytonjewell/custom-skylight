// Keeps the photo list in step with the Worker: loads it at start, then refreshes every few minutes
// and whenever the page becomes visible, so photos added from a phone reach the frame on their own.
import { createStore, useStore } from '../lib/store';
import { api } from './api';
import { dataStore } from './store';

const REFRESH_MS = 5 * 60 * 1000;

export type PhotoStatus = 'loading' | 'ready' | 'error';
const status = createStore<PhotoStatus>('loading');
export const usePhotoStatus = () => useStore(status, (s) => s);

/** Deleted here but still on the server while the Undo toast is up; refreshes must not bring them back */
export const pendingDeletes = new Set<string>();

// Bumped by every local change. A refresh that started before a change (or while one is still
// being saved) would bring back the old list, so it's dropped.
let version = 0;
let saving = 0;
/** Run a save to the server, holding back refreshes until it's done */
export async function trackSave<T>(p: Promise<T>): Promise<T> {
  version++;
  saving++;
  try {
    return await p;
  } finally {
    saving--;
    version++;
  }
}

export async function refreshPhotos(): Promise<void> {
  const v = version;
  try {
    const list = await api.photos();
    // Overtaken by a local change: try again once it has settled
    if (v !== version || saving) return void setTimeout(refreshPhotos, 2000);
    dataStore.set((d) => ({ ...d, photos: list.filter((p) => !pendingDeletes.has(p.id)) }));
    status.set('ready');
  } catch {
    if (status.get() === 'loading') status.set('error');
  }
}

let started = false;
export function startPhotoSync(): void {
  if (started) return;
  started = true;
  void refreshPhotos();
  setInterval(refreshPhotos, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshPhotos();
  });
}
