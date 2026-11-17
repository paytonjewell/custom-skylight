-- Phone reminders (Web Push). Each phone that turns reminders on saves its push subscription here,
-- with the person it belongs to (they only get reminders for tasks that notify that person) and its
-- time zone (reminder times are local).
CREATE TABLE push_subs (
  endpoint TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  person TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  tz TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Reminders already sent, so each goes out once per due day per phone. Old rows are pruned.
CREATE TABLE push_sent (
  task_id TEXT NOT NULL,
  day TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (task_id, day, endpoint)
);

-- Small server settings (the VAPID key pair push services use to know messages come from us)
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
