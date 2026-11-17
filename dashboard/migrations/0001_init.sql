-- Photos shown on the dashboard. The image files live in R2 under photos/<id>/full.jpg and thumb.jpg.
CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  -- When the photo was taken (ISO 8601, from EXIF when available)
  taken_at TEXT,
  -- Name of the device that added it
  added_by TEXT,
  added_at TEXT NOT NULL,
  -- Grid and slideshow order, ascending
  position REAL NOT NULL
);
CREATE INDEX photos_position ON photos (position);

-- Devices that have signed in with the PIN. The cookie holds a random token; only its SHA-256 is stored.
-- Delete a row to sign that device out.
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

-- Wrong PIN attempts, for rate limiting. Old rows are pruned as new attempts come in.
CREATE TABLE signin_failures (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX signin_failures_at ON signin_failures (at);
