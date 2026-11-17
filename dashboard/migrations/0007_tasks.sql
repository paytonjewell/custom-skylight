-- Tasks (the Tasks screen): anything to do, once or on a repeat; habits are tasks with habit = 1.
-- Ids come from the app, so a new task shows at once and is saved in the background.
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '',
  -- Person id, or 'any'
  who TEXT NOT NULL,
  -- Repeat rule as JSON (src/lib/repeat.ts), or NULL for a one-off
  repeat TEXT,
  -- One-off's due day (YYYY-MM-DD), or NULL for "whenever"
  due TEXT,
  -- morning / afternoon / evening / anytime
  slot TEXT NOT NULL DEFAULT 'anytime',
  -- HH:MM, optional
  time TEXT,
  habit INTEGER NOT NULL DEFAULT 0,
  on_calendar INTEGER NOT NULL DEFAULT 0,
  -- Reminder time (HH:MM) and the person ids who get it (JSON array)
  remind TEXT,
  notify TEXT NOT NULL DEFAULT '[]',
  -- The list item a reminder was made from (Lists screen), if any
  list_id TEXT,
  list_item_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Each time a task was done. day = the due day it counts for, so streaks and history come from here.
CREATE TABLE task_done (
  task_id TEXT NOT NULL,
  day TEXT NOT NULL,
  done_at TEXT NOT NULL,
  done_by TEXT,
  PRIMARY KEY (task_id, day)
);
CREATE INDEX task_done_day ON task_done (day);
