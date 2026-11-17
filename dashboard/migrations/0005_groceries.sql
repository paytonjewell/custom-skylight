-- The shared grocery list (pinned first on the Lists screen). Aisles and stores are presets in the app
-- (src/data/grocery.ts). Ids come from the app, so changes show at once and are saved in the background.
CREATE TABLE groceries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- Aisle (one of the preset aisles, or 'Other')
  cat TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  -- Store id (preset)
  store TEXT NOT NULL,
  -- Checked off (shown under "Got it" until cleared)
  done INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  -- Order in the list, ascending (within an aisle, items show in this order)
  position REAL NOT NULL,
  added_at TEXT NOT NULL
);
CREATE INDEX groceries_position ON groceries (position);

-- Every item name ever added, and the aisle it was last in: adding that name again puts it back there.
-- Kept after the item is checked off or removed. `uses` counts how often it's been added.
CREATE TABLE grocery_names (
  -- Lowercased name
  key TEXT PRIMARY KEY,
  -- As last added (for display)
  name TEXT NOT NULL,
  cat TEXT NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  last_used TEXT NOT NULL
);
