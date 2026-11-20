// The phone app updating itself. Only in the app (dashboard/android): it asks the native side which
// build is installed and the Worker which is newest (worker/app.ts); when there's a newer one,
// src/app/UpdateBanner.tsx offers it. Installing hands the download to the app's AppUpdate plugin
// (AppUpdatePlugin.java), which asks Android to install it.
//
// Most changes never need this: the app loads the live site, so a deploy reaches it at once. Only a
// change to the app itself (android/, capacitor.config.json) makes a new build.
import type { PluginListenerHandle } from '@capacitor/core';
import { IS_APP } from '../app/layout';
import { toast } from '../app/ui';
import { createStore, useStore } from '../lib/store';
import { api } from './api';
import type { AppRelease } from './types';

interface AppUpdatePlugin {
  info(): Promise<{ versionCode: number; versionName: string }>;
  install(opts: { url: string }): Promise<void>;
  addListener(event: 'progress', fn: (e: { fraction: number }) => void): Promise<PluginListenerHandle>;
  addListener(
    event: 'status',
    fn: (e: { state: 'confirm' | 'failed'; message?: string }) => void,
  ): Promise<PluginListenerHandle>;
}

interface UpdateState {
  /** The newest build, when it's newer than this one */
  available: AppRelease | null;
  /** idle → downloading (with progress) → confirm (Android's "Update this app?" is up) */
  phase: 'idle' | 'downloading' | 'confirm';
  progress: number;
  /** Hidden with ×, until the next build comes along */
  dismissed: number;
}
const state = createStore<UpdateState>({ available: null, phase: 'idle', progress: 0, dismissed: 0 });
export const useAppUpdate = <U>(select: (s: UpdateState) => U): U => useStore(state, select);
const patch = (p: Partial<UpdateState>) => state.set({ ...state.get(), ...p });

let plugin: AppUpdatePlugin | null = null;
let lastCheck = 0;
/** Check again when the app comes back to the screen, at most this often */
const RECHECK_MS = 30 * 60 * 1000;

export async function startAppUpdate(): Promise<void> {
  if (!IS_APP) return;
  // Loaded only in the app, so the frame and browsers never download it
  const { registerPlugin } = await import('@capacitor/core');
  plugin = registerPlugin<AppUpdatePlugin>('AppUpdate');
  void plugin.addListener('progress', (e) => patch({ progress: e.fraction }));
  void plugin.addListener('status', (e) => {
    if (e.state === 'confirm') patch({ phase: 'confirm' });
    else {
      patch({ phase: 'idle', progress: 0 });
      toast(e.message || 'The update didn’t install', { icon: 'x' });
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > RECHECK_MS) void check();
  });
  await check();
}

async function check(): Promise<void> {
  if (!plugin) return;
  lastCheck = Date.now();
  try {
    const [installed, newest] = await Promise.all([plugin.info(), api.appRelease()]);
    patch({ available: newest && newest.versionCode > installed.versionCode ? newest : null });
  } catch (e) {
    // Offline, or the server has no build yet: just don't offer one
    console.warn('Update check failed', e);
  }
}

export async function installUpdate(): Promise<void> {
  if (!plugin || state.get().phase !== 'idle') return;
  patch({ phase: 'downloading', progress: 0 });
  try {
    await plugin.install({ url: location.origin + '/api/app/apk' });
    // Downloaded; the installer reports back through the "status" listener
  } catch (e) {
    patch({ phase: 'idle', progress: 0 });
    toast(e instanceof Error ? e.message : 'The update didn’t download', { icon: 'x' });
  }
}

export const dismissUpdate = () => patch({ dismissed: state.get().available?.versionCode ?? 0 });
