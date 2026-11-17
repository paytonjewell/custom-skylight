-- Calendar events, one row each, instead of one JSON list per calendar (calendars.events). A busy
-- calendar's list could outgrow D1's 2 MB value limit, and changing one event rewrote the whole list,
-- racing the sync that rewrites it too.
CREATE TABLE events (
  calendar_id TEXT NOT NULL REFERENCES calendars (id) ON DELETE CASCADE,
  id TEXT NOT NULL,          -- Google's event id
  position INTEGER NOT NULL, -- order within the calendar, as the app gets them (Google's, then changes)
  data TEXT NOT NULL,        -- the event as the app gets it (JSON: src/data/types.ts EventRecord)
  PRIMARY KEY (calendar_id, id)
);
CREATE INDEX events_order ON events (calendar_id, position);

-- Move the events already copied from Google out of the lists, in the same order. A list never
-- held the same id twice; if one did, the later copy is kept, as the app would have shown it last.
INSERT OR REPLACE INTO events (calendar_id, id, position, data)
SELECT c.id, json_extract(j.value, '$.id'), j.key, j.value
FROM calendars c, json_each(c.events) j
WHERE j.type = 'object' AND json_extract(j.value, '$.id') IS NOT NULL;

ALTER TABLE calendars DROP COLUMN events;
