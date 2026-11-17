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

/**
 * Part of every `keep` key. Bump it when the shape of what the Worker sends changes, so a device
 * doesn't show (and crash on) a copy saved by the old code before the first refresh replaces it.
 */
const KEPT_VERSION = 2;

export type SyncStatus = 'loading' | 'ready' | 'error';

/** Remove copies of `keep` saved under an older KEPT_VERSION (or before keys had one) */
function forget(keep: string, current: string): void {
  try {
    for (const k of Object.keys(localStorage))
      if ((k === keep || k.startsWith(`${keep}@`)) && k !== current) localStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
}

export function createSync<T>({
  load,
  apply,
  failMessage = 'Couldn’t save a change',
  busy = () => false,
  keep,
  valid = () => true,
  refreshMs = 5 * 60 * 1000,
}: {
  /** Fetch the current data from the Worker */
  load: () => Promise<T>;
  /** Put it into the data store */
  apply: (data: T) => void;
  /** Toast when a save fails */
  failMessage?: string;
  /** Extra local changes still waiting to be sent (e.g. a name being typed) */
  busy?: () => boolean;
  /** localStorage key for the last data loaded (JSON as the Worker sent it) */
  keep?: string;
  /** Whether a copy kept on the device still has the expected shape */
  valid?: (data: T) => boolean;
  refreshMs?: number;
}) {
  const status = createStore<SyncStatus>('loading');
  const keptKey = keep && `${keep}@${KEPT_VERSION}`;
  // Bumped by every local change. A refresh that started before a change (or while one is still
  // waiting to be saved) would bring back the old data, so it's dropped and tried again later.
  let version = 0;
  let waiting = 0;
  let failed = false;
  let queue: Promise<void> = Promise.resolve();
  /** The data last applied, as JSON: a refresh that brings back the same thing changes nothing */
  let last = '';
  let running: Promise<void> | null = null;
  let retry = 0;

  async function load1(): Promise<void> {
    const v = version;
    try {
      const data = await load();
      // Overtaken by a local change: try again once it has settled
      if (v !== version || waiting || busy()) {
        clearTimeout(retry);
        retry = window.setTimeout(refresh, 2000);
        return;
      }
      const json = JSON.stringify(data);
      if (json !== last) {
        last = json;
        apply(data);
        if (keptKey) store(keptKey, json);
      }
      status.set('ready');
    } catch {
      if (status.get() === 'loading') status.set('error');
    }
  }

  /** Load from the server now (joining a load already under way) */
  function refresh(): Promise<void> {
    running ??= load1().finally(() => {
      running = null;
    });
    return running;
  }

  /** A local change is about to be sent: hold back refreshes until `settle` */
  function hold(): () => void {
    version++;
    waiting++;
    return () => {
      waiting--;
      version++;
      // Whatever the server has now differs from what was last loaded
      last = '';
    };
  }

  /** Save a change to the server after any earlier ones */
  function save(run: () => Promise<unknown>): void {
    const settle = hold();
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
        settle();
        if (waiting || !failed) return;
        // Something didn't save: say so once, and show what the server actually has
        failed = false;
        toast(failMessage, { icon: 'x' });
        void refresh();
      });
  }

  /** A request sent outside the queue (it reports its own errors): refreshes wait for it */
  async function track<R>(p: Promise<R>): Promise<R> {
    const settle = hold();
    try {
      return await p;
    } finally {
      settle();
    }
  }

  let started = false;
  function start(onHide?: () => void): void {
    if (started) return;
    started = true;
    if (keep && keptKey) {
      forget(keep, keptKey);
      try {
        const kept = JSON.parse(stored(keptKey, 'null')) as T | null;
        if (kept && valid(kept)) apply(kept);
      } catch {
        /* a damaged copy: wait for the server */
      }
    }
    void refresh();
    setInterval(refresh, refreshMs);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void refresh();
      else onHide?.();
    });
    if (onHide) addEventListener('pagehide', onHide);
  }

  return {
    save,
    track,
    refresh,
    start,
    /** A local change that isn't saved through `save` yet (holds back refreshes) */
    touch: () => {
      version++;
      last = '';
    },
    useStatus: () => useStore(status, (s) => s),
  };
}
