// Keeps the photo list in step with the Worker (see createSync, src/data/sync.ts), so photos added
// from a phone reach the frame on their own. Uploads, reorders and deletes report their own errors
// (src/data/actions.ts), so they're tracked rather than queued.
import { api } from './api';
import { dataStore } from './store';
import { createSync } from './sync';

/** Deleted here but still on the server while the Undo toast is up; refreshes must not bring them back */
export const pendingDeletes = new Set<string>();

const sync = createSync({
  load: api.photos,
  apply: (list) => dataStore.set((d) => ({ ...d, photos: list.filter((p) => !pendingDeletes.has(p.id)) })),
});

export const refreshPhotos = sync.refresh;
/** Run a save to the server, holding back refreshes until it's done */
export const trackSave = sync.track;
export const usePhotoStatus = sync.useStatus;
export const startPhotoSync = () => sync.start();
