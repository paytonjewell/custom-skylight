// Keeps one kind of data (lists, groceries…) in step with the Worker: loads it at start, then every
// few minutes and whenever the page becomes visible, so a change made on a phone reaches the frame.
//
// Changes show at once (src/data/actions.ts changes the local copy) and are saved in the background,
// one at a time and in order, so "add an item, then check it off" can't reach the server the wrong
// way round. If a save fails, the data is reloaded from the server.
//
// With `keep`, the last data loaded is also kept on the device and shown at start, so a reload shows
// what was there before instead of an empty screen that fills in.
import { toast } from '../app/ui';
import { createStore, store, stored, useStore } from '../lib/store';

const REFRESH_MS = 5 * 60 * 1000;

export type SyncStatus = 'loading' | 'ready' | 'error';

export function createSync<T>({ load, apply, failMessage, busy = () => false, keep }: {
  /** Fetch the current data from the Worker */
  load: () => Promise<T>;
  /** Put it into the data store */
  apply: (data: T) => void;
  /** Toast when a save fails */
  failMessage: string;
  /** Extra local changes still waiting to be sent (e.g. a name being typed) */
  busy?: () => boolean;
  /** localStorage key for the last data loaded (JSON as the Worker sent it) */
  keep?: string;
}) {
  const status = createStore<SyncStatus>('loading');
  // Bumped by every local change. A refresh that started before a change (or while one is still
  // waiting to be saved) would bring back the old data, so it's dropped and tried again later.
  let version = 0;
  let waiting = 0;
  let failed = false;
  let queue: Promise<void> = Promise.resolve();

  async function refresh(): Promise<void> {
    const v = version;
    try {
      const data = await load();
      // Overtaken by a local change: try again once it has settled
      if (v !== version || waiting || busy()) return void setTimeout(refresh, 2000);
      apply(data);
      if (keep) store(keep, JSON.stringify(data));
      status.set('ready');
    } catch {
      if (status.get() === 'loading') status.set('error');
    }
  }

  /** Save a change to the server after any earlier ones */
  function save(run: () => Promise<unknown>): void {
    version++;
    waiting++;
    queue = queue
      .then(run)
      .then(
        () => {},
        (e) => {
          console.warn(failMessage, e);
          failed = true;
        },
      )
      .finally(() => {
        waiting--;
        version++;
        if (waiting || !failed) return;
        // Something didn't save: say so once, and show what the server actually has
        failed = false;
        toast(failMessage, { icon: 'x' });
        void refresh();
      });
  }

  let started = false;
  function start(onHide?: () => void): void {
    if (started) return;
    started = true;
    if (keep) {
      try {
        const last = JSON.parse(stored(keep, 'null')) as T | null;
        if (last) apply(last);
      } catch {
        /* an older or damaged copy: wait for the server */
      }
    }
    void refresh();
    setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void refresh();
      else onHide?.();
    });
    if (onHide) addEventListener('pagehide', onHide);
  }

  return {
    save,
    refresh,
    start,
    /** A local change that isn't saved through `save` yet (holds back refreshes) */
    touch: () => { version++; },
    useStatus: () => useStore(status, (s) => s),
  };
}
