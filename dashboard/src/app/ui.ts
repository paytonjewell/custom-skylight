// App-wide UI state: current screen, display mode, the open pop-up and the toast.
import type { ReactNode } from 'react';
import { createStore, useStore } from '../lib/store';
import type { IconName } from '../ui/icons';

export const VIEWS = ['home', 'calendar', 'tasks', 'lists', 'kitchen', 'news', 'photos'] as const;
export type ViewName = (typeof VIEWS)[number];
/** day = dashboard; ambient = idle photo frame; sleep = black screen during the sleep hours (sleep.ts) */
export type Mode = 'day' | 'ambient' | 'sleep';

export interface SheetSpec {
  id: number;
  render: (close: () => void) => ReactNode;
  cls?: string;
  onClose?: () => void;
}
export interface ToastSpec {
  id: number;
  content: ReactNode;
  icon?: IconName;
  ms: number;
  undo?: () => void;
}
interface UIState {
  view: ViewName;
  mode: Mode;
  sheet: SheetSpec | null;
  toast: ToastSpec | null;
}

const isView = (v: string): v is ViewName => (VIEWS as readonly string[]).includes(v);
const viewFromHash = (): ViewName => {
  const h = location.hash.slice(1);
  return isView(h) ? h : 'home';
};

export const ui = createStore<UIState>({
  view: viewFromHash(),
  mode: 'day',
  sheet: null,
  toast: null,
});
export const useUI = <U>(select: (s: UIState) => U): U => useStore(ui, select);
const patchUI = (p: Partial<UIState>) => ui.set((s) => ({ ...s, ...p }));

// ------------------------------------------------------------ idle counter (ticked by App)
let idleSec = 0;
export const resetIdle = () => { idleSec = 0; };
export const idleTick = () => ++idleSec;

// ------------------------------------------------------------ navigation + modes
export function go(view: string): void {
  const v = isView(view) ? view : 'home';
  patchUI({ view: v });
  if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
}
export const goFromHash = () => go(viewFromHash());

export function setMode(mode: Mode): void {
  patchUI({ mode });
  resetIdle();
}

// ------------------------------------------------------------ pop-ups (one at a time) + toasts
let nextId = 1;

export function openSheet(render: SheetSpec['render'], opts: { cls?: string; onClose?: () => void } = {}): void {
  patchUI({ sheet: { id: nextId++, render, ...opts } });
}
/** Close the open pop-up without running its onClose (e.g. not going back to where it came from) */
export function dismissSheet(): void {
  if (ui.get().sheet) patchUI({ sheet: null });
}
export function closeSheet(): void {
  const s = ui.get().sheet;
  if (!s) return;
  patchUI({ sheet: null });
  s.onClose?.();
}

export function toast(content: ReactNode, opts: { icon?: IconName; ms?: number; undo?: () => void } = {}): void {
  patchUI({ toast: { id: nextId++, content, icon: opts.icon, ms: opts.ms ?? 5000, undo: opts.undo } });
}
export function dismissToast(id: number): void {
  if (ui.get().toast?.id === id) patchUI({ toast: null });
}
