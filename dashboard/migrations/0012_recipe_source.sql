-- Where a recipe came from (a web page it was imported from), if anywhere
ALTER TABLE recipes ADD COLUMN source TEXT NOT NULL DEFAULT '';
