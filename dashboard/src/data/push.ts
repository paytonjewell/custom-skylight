// Phone reminders, on this device: turn them on (allow notifications, subscribe, save which person
// this phone belongs to) or off, and send a test. The server sends the reminders (worker/push.ts).
// - In a browser: Web Push; the service worker shows them (public/sw.js).
// - In the phone app (dashboard/android): Firebase Cloud Messaging; the app shows them itself, as
//   proper Android notifications (Reminders.java), through its Reminders plugin (ReminderPlugin.java).
import type { PluginListenerHandle } from '@capacitor/core';
import { api } from './api';
import type { PushInfo } from './types';
import { createStore, useStore } from '../lib/store';
import { IS_APP, IS_KIOSK } from '../app/layout';
import { go } from '../app/ui';

/** The phone app can; so can phones and computers with it open in a browser; the frame's kiosk can't */
export const pushSupported =
  IS_APP || (!IS_KIOSK && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);

interface PushState {
  /** From the server: null until loaded */
  info: PushInfo | null;
  /** This device's subscription (a push endpoint, or the app's FCM token), if reminders are on here */
  endpoint: string | null;
  /** Who this phone belongs to, if reminders are on here */
  person: string | null;
}
const state = createStore<PushState>({ info: null, endpoint: null, person: null });
export const usePush = <U>(select: (s: PushState) => U): U => useStore(state, select);
/** People who have reminders on, on at least one phone */
export const peopleWithPhones = () => state.get().info?.people ?? [];

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const BLOCKED = 'Notifications are blocked for this app. Allow them in the phone’s settings, then try again.';

// ---------------------------------------------------------------- the phone app (FCM)

interface RemindersPlugin {
  requestPermission(): Promise<{ granted: boolean }>;
  token(): Promise<{ token: string }>;
  takeLaunchView(): Promise<{ view: string | null }>;
  addListener(event: 'open', fn: (e: { view: string }) => void): Promise<PluginListenerHandle>;
}
// Wrapped in an object: a Capacitor plugin answers to any method name, `then` included, so a promise
// resolved with the plugin itself would take it for another promise and never settle.
let native: Promise<{ reminders: RemindersPlugin }> | null = null;
// Loaded only in the app, so the frame and browsers never download it
const plugin = () =>
  (native ??= import('@capacitor/core').then(({ registerPlugin }) => ({
    reminders: registerPlugin<RemindersPlugin>('Reminders'),
  })));

/** This app's FCM token, or null when Firebase can't be reached */
const appToken = () =>
  plugin()
    .then(({ reminders }) => reminders.token())
    .then((r) => r.token)
    .catch((e) => {
      console.warn('No FCM token', e);
      return null;
    });

// ---------------------------------------------------------------- a browser (Web Push)

const registration = () => navigator.serviceWorker.ready;
const browserSub = async () => (await registration()).pushManager.getSubscription();

// ----------------------------------------------------------------

/** Load who has reminders on, and whether this device does */
async function loadPush(): Promise<void> {
  const info = await api.push();
  const current = IS_APP ? await appToken() : pushSupported ? (await browserSub())?.endpoint : null;
  let mine = current ? info.mine.find((m) => m.endpoint === current) : undefined;
  // Firebase changes an app's token now and then: move this phone's reminders to the new one
  const stale = IS_APP && current && !mine ? info.mine[0] : undefined;
  if (stale && current) {
    await api.saveAppPush(current, stale.person, timeZone());
    await api.deletePush(stale.endpoint);
    mine = { endpoint: current, person: stale.person };
  }
  state.set({ info, endpoint: mine ? current! : null, person: mine?.person ?? null });
}

/** Turn reminders on here, for `person`. Throws a message to show if it can't. */
export async function turnOnPush(person: string): Promise<void> {
  if (IS_APP) {
    const { reminders: p } = await plugin();
    if (!(await p.requestPermission()).granted) throw new Error(BLOCKED);
    const { token } = await p.token();
    await api.saveAppPush(token, person, timeZone());
    await loadPush();
    return;
  }
  const info = state.get().info ?? (await api.push());
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied' ? BLOCKED : 'Notifications weren’t allowed.');
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
  await api.savePush(sub.toJSON(), person, timeZone());
  await loadPush();
}

/** Turn reminders off here */
export async function turnOffPush(): Promise<void> {
  const { endpoint } = state.get();
  if (!IS_APP) await (await browserSub())?.unsubscribe();
  if (endpoint) await api.deletePush(endpoint);
  await loadPush();
}

export async function testPush(): Promise<void> {
  const { endpoint } = state.get();
  if (endpoint) await api.testPush(endpoint);
}

/** At start: load, and open Tasks when a reminder is tapped */
export function startPush(): void {
  loadPush().catch((e) => console.warn('Reminders not loaded', e));
  const open = (view: unknown) => {
    if (typeof view === 'string') go(view);
  };
  if (IS_APP) {
    void plugin().then(async ({ reminders: p }) => {
      void p.addListener('open', (e) => open(e.view));
      open((await p.takeLaunchView()).view);
    });
    return;
  }
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'open') open(e.data.view);
  });
}
