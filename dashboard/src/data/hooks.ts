import { useMemo } from 'react';
import { useNow } from '../lib/clock';
import { useData } from './store';
import type { CalEvent } from './types';
import { taskEvents } from './calendar';
import { dayOf } from '../lib/repeat';

/** Calendar events to show */
export function useEvents(): CalEvent[] {
  return useData('events').events;
}

/** What the Calendar screen shows: events, and tasks marked "Show on calendar" */
export function useCalendarEvents(): CalEvent[] {
  const events = useEvents();
  const data = useData('ALL', 'taskDone', 'tasks');
  const now = useNow();
  const day = dayOf(now);
  // Recomputed when tasks change or the day does, not on every clock tick
  const tasks = useMemo(() => taskEvents(data, now), [data.tasks, data.taskDone, data.ALL, day]);
  return useMemo(() => (tasks.length ? events.concat(tasks) : events), [events, tasks]);
}
