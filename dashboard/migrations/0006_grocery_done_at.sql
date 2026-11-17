-- When an item was checked off (purchased), so purchased items can be cleared automatically after a
-- few days (worker/groceries.ts). NULL while it's still on the list.
ALTER TABLE groceries ADD COLUMN done_at TEXT;
CREATE INDEX groceries_done_at ON groceries (done_at) WHERE done_at IS NOT NULL;
