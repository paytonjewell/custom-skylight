// Phone reminders, on this device: turn them on (allow notifications, subscribe with the server's
// key, save which person this phone belongs to) or off, and send a test. The server sends the
// reminders (worker/push.ts); the service worker shows them (public/sw.js).
import { api, type PushInfo } from './api';
import { createStore, useStore } from '../lib/store';
import { IS_KIOSK } from '../app/layout';
import { go } from '../app/ui';

/** Phones and computers with the app open in a browser can; the frame's kiosk WebView can't */
export const pushSupported = !IS_KIOSK && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

interface PushState {
  /** From the server: null until loaded */
  info: PushInfo | null;
  /** This device's subscription, if reminders are on here */
  endpoint: string | null;
  /** Who this phone belongs to, if reminders are on here */
  person: string | null;
}
const state = createStore<PushState>({ info: null, endpoint: null, person: null });
export const usePush = <U>(select: (s: PushState) => U): U => useStore(state, select);
/** People who have reminders on, on at least one phone */
export const peopleWithPhones = () => state.get().info?.people ?? [];

const registration = () => navigator.serviceWorker.ready;

/** Load who has reminders on, and whether this device does */
async function loadPush(): Promise<void> {
  const info = await api.push();
  const sub = pushSupported ? await (await registration()).pushManager.getSubscription() : null;
  const mine = sub ? info.mine.find((m) => m.endpoint === sub.endpoint) : undefined;
  state.set({ info, endpoint: mine ? sub!.endpoint : null, person: mine?.person ?? null });
}

/** Turn reminders on here, for `person`. Throws a message to show if it can't. */
export async function turnOnPush(person: string): Promise<void> {
  const info = state.get().info ?? (await api.push());
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'Notifications are blocked for this app. Allow them in the phone’s settings, then try again.'
      : 'Notifications weren’t allowed.');
  }
  const reg = await registration();
  const subscribe = () => reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: info.key });
  let sub = await reg.pushManager.getSubscription();
  try {
    sub ??= await subscribe();
  } catch {
    // Subscribed before with another key: start over
    await sub?.unsubscribe();
    sub = await subscribe();
  }
  await api.savePush(sub.toJSON(), person, Intl.DateTimeFormat().resolvedOptions().timeZone);
  await loadPush();
}

/** Turn reminders off here */
export async function turnOffPush(): Promise<void> {
  const { endpoint } = state.get();
  const sub = await (await registration()).pushManager.getSubscription();
  await sub?.unsubscribe();
  if (endpoint) await api.deletePush(endpoint);
  await loadPush();
}

export async function testPush(): Promise<void> {
  const { endpoint } = state.get();
  if (endpoint) await api.testPush(endpoint);
}

/** At start: load, and open Tasks when a reminder is tapped while the app is already open */
export function startPush(): void {
  loadPush().catch((e) => console.warn('Reminders not loaded', e));
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'open' && typeof e.data.view === 'string') go(e.data.view);
  });
}
