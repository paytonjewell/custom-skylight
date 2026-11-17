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
  // By day, not the clock's minute: React Compiler then recomputes them only when the tasks or the day change
  const tasks = taskEvents(data, dayOf(useNow()));
  return tasks.length ? events.concat(tasks) : events;
}
