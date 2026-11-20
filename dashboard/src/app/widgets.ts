// The phone app's home screen widgets (TasksWidget.java) fetch their lists from the server every 30
// minutes. When tasks change here (added, edited, ticked off), this tells them to fetch again now.
import { dataStore } from '../data/store';

/**
 * Wait this long after the last change: the app shows a change before the server has saved it, and a
 * burst of changes (ticking off several) needs only one refresh
 */
const SETTLE_MS = 2500;

export async function startWidgetRefresh(): Promise<void> {
  // Loaded only in the app. The plugin is used straight away, never passed through a promise (it
  // answers to any method name, `then` included: see src/data/push.ts).
  const { registerPlugin } = await import('@capacitor/core');
  const widgets = registerPlugin<{ refresh(): Promise<void> }>('Widgets');
  let { tasks, taskDone } = dataStore.get();
  let timer: ReturnType<typeof setTimeout> | undefined;
  dataStore.subscribe(() => {
    const d = dataStore.get();
    if (d.tasks === tasks && d.taskDone === taskDone) return;
    ({ tasks, taskDone } = d);
    clearTimeout(timer);
    timer = setTimeout(() => void widgets.refresh().catch(() => {}), SETTLE_MS);
  });
}
