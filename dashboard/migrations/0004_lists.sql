-- Lists made on the Lists screen (the pinned grocery list is separate). Ids come from the app, so a new
-- list or item shows at once and is saved in the background.
CREATE TABLE lists (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  emoji TEXT NOT NULL,
  -- Order on the Lists screen, ascending
  position REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX lists_position ON lists (position);

-- A list's lines. A heading groups the lines under it (e.g. one per person on a gift list).
CREATE TABLE list_items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  heading INTEGER NOT NULL DEFAULT 0,
  -- Order within the list, ascending
  position REAL NOT NULL
);
CREATE INDEX list_items_list ON list_items (list_id, position);
