-- Kitchen: recipes, the dinner plan and what's on hand, shared by every screen (worker/kitchen.ts).
-- (Recipes once started as samples; 0013 removed them.)

CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '',
  tone INTEGER NOT NULL DEFAULT 1,
  tags TEXT NOT NULL DEFAULT '[]',        -- JSON array of strings
  minutes INTEGER NOT NULL DEFAULT 0,
  servings INTEGER NOT NULL DEFAULT 4,
  ingredients TEXT NOT NULL DEFAULT '[]', -- JSON (src/data/types.ts Ingredient)
  steps TEXT NOT NULL DEFAULT '[]',       -- JSON array of strings
  notes TEXT NOT NULL DEFAULT '',
  favorite INTEGER NOT NULL DEFAULT 0,
  made TEXT,                              -- last cooked, YYYY-MM-DD
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- Dinner for a day
CREATE TABLE meal_plan (
  day TEXT PRIMARY KEY,                   -- YYYY-MM-DD
  recipe_id TEXT NOT NULL REFERENCES recipes (id) ON DELETE CASCADE
);

-- What's in the kitchen: Pantry, Fridge or Freezer
CREATE TABLE inventory (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  place TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Where each name was last kept, so it goes back there next time
CREATE TABLE inventory_names (
  name TEXT PRIMARY KEY,                  -- lowercase
  place TEXT NOT NULL
);
