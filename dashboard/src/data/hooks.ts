import { useMemo } from 'react';
import { useNow } from '../lib/clock';
import { useUI } from '../app/ui';
import { useData } from './store';
import { visibleEvents } from './select';
import type { CalEvent } from './types';
import { taskEvents } from './calendar';
import { dayOf } from '../lib/repeat';

/** Calendar events to show right now (respects the demo's calendar mode). */
export function useEvents(): CalEvent[] {
  const data = useData();
  const calMode = useUI((s) => s.calMode);
  const now = useNow();
  return useMemo(() => visibleEvents(data, calMode, now), [data, calMode, now]);
}

/** What the Calendar screen shows: events, and tasks marked "Show on calendar" */
export function useCalendarEvents(): CalEvent[] {
  const events = useEvents();
  const data = useData();
  const now = useNow();
  const day = dayOf(now);
  // Recomputed when tasks change or the day does, not on every clock tick
  const tasks = useMemo(() => taskEvents(data, now), [data.tasks, data.taskDone, data.ALL, day]);
  return useMemo(() => (tasks.length ? events.concat(tasks) : events), [events, tasks]);
}
