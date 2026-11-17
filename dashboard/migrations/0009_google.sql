-- Google Calendar. Each signed-in Google account (e.g. each parent's) keeps a refresh token; it never
-- goes to the browser. Each of the account's calendars can be shown or not, and is either someone's
-- (a person or the family, which decides colour and lane) or no one's ('none': shown everywhere in
-- its own colour, like birthdays or a team's games). With by_name, names in an event's title decide
-- whose it is ("Jacob dentist" is Jacob's); `person` is then for events naming no one. An event can also
-- carry its own choice of people (set on the dashboard, kept on the Google event). A shown calendar's events, from a few months
-- back to a year ahead, are kept here as JSON and refreshed from Google (worker/google.ts).
CREATE TABLE google_accounts (
  id TEXT PRIMARY KEY,            -- Google's account id ("sub")
  email TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  expires_at INTEGER,             -- ms
  error TEXT,                     -- set when Google stops accepting the token (sign in again)
  created_at TEXT NOT NULL
);

CREATE TABLE calendars (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES google_accounts (id) ON DELETE CASCADE,
  google_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,              -- Google's colour
  own_color TEXT,                   -- chosen on the dashboard instead ('#rrggbb')
  person TEXT NOT NULL DEFAULT 'family',
  by_name INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,   -- new events go here
  emoji TEXT NOT NULL DEFAULT '',          -- shown on its events that have none of their own
  shown INTEGER NOT NULL DEFAULT 0,
  writable INTEGER NOT NULL,
  position INTEGER NOT NULL,      -- Google's order (primary first)
  events TEXT NOT NULL DEFAULT '[]',
  synced_at TEXT,
  UNIQUE (account_id, google_id)
);
