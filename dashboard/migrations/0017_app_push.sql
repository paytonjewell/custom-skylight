-- Reminders to the phone app (worker/fcm.ts) as well as browsers. An app's row holds its FCM
-- registration token in `endpoint`, and no Web Push keys.
ALTER TABLE push_subs ADD COLUMN kind TEXT NOT NULL DEFAULT 'web';
