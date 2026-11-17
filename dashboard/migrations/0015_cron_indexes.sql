-- For the cron (worker/push.ts): the daily prune of old sent reminders looks them up by day (the
-- primary key starts with task_id, so it couldn't), and the every-minute check reads just the
-- reminder times in use.
CREATE INDEX push_sent_day ON push_sent (day);
CREATE INDEX tasks_remind ON tasks (remind) WHERE remind IS NOT NULL;
