-- The sample recipes the Kitchen started with are gone: only the family's own recipes from here on.
DELETE FROM meal_plan WHERE recipe_id IN ('tacos', 'sheet-pan-chicken', 'spaghetti', 'stir-fry', 'mac-cheese', 'chili', 'pancakes', 'banana-bread', 'timer-test');
DELETE FROM recipes WHERE id IN ('tacos', 'sheet-pan-chicken', 'spaghetti', 'stir-fry', 'mac-cheese', 'chili', 'pancakes', 'banana-bread', 'timer-test');
DELETE FROM config WHERE key = 'kitchen.samples';
