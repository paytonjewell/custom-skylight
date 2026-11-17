-- Foods the family taught the kitchen are the same ("I have this" on a recipe's missing ingredient):
-- the ingredient's name, boiled down (src/data/names.ts core), counts as the on-hand item's.
CREATE TABLE food_aliases (
  name TEXT PRIMARY KEY,   -- core of the recipe's name ("pasta sauce")
  same_as TEXT NOT NULL,   -- core of what it counts as ("rao")
  created_at TEXT NOT NULL
);
