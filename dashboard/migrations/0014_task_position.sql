-- Tasks can be put in an order of their own within their group (dragged on the Tasks screen).
-- NULL: no place chosen; those follow the ones that have one, in the usual order (time, then oldest).
ALTER TABLE tasks ADD COLUMN position REAL;
