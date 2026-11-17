// Shapes of everything the dashboard shows, as the Worker + D1 API sends them.
import type { Repeat } from '../lib/repeat';

export interface Person {
  id: string;
  name: string;
  /** Palette slot 0–4; each theme defines the colour for each slot (css/tokens.css). 0 = Family. */
  tone: number;
  /** A colour of its own ('#rrggbb') in place of the palette slot (a calendar that's no one's) */
  color?: string;
  age?: number;
  pet?: boolean;
  /** false: on the calendar only (no task column, ring or task picker), e.g. a baby */
  tasks?: false;
  /** false: for tasks only (not on the calendar or in "everyone"), e.g. a "Dashboard" to-do list */
  calendar?: false;
}

export interface CalEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  /** Person ids */
  people: string[];
  /** Shown before the title, where there is one */
  emoji?: string;
  /** From a calendar that's no one's (birthdays, a team's games): its colour ('#rrggbb'). Shown for everyone. */
  color?: string;
  allDay?: boolean;
  loc?: string;
  /** Minutes of driving before the event */
  travel?: number;
  notes?: string;
  /** From Google: the dashboard's id for its calendar, and Google's id for the event */
  calendar?: string;
  gid?: string;
  /** One occurrence of a repeating Google event (edits change just this one) */
  recurring?: boolean;
  /** A task shown on the calendar ("Show on calendar"): tapping it checks it off */
  task?: { id: string; day: string; done: boolean };
}

/** A Google account connected to the dashboard */
export interface GoogleAccount {
  id: string;
  email: string;
  /** Google stopped accepting it (password changed, access removed): connect it again */
  error: boolean;
}

/** One of a Google account's calendars */
export interface Calendar {
  id: string;
  account: string;
  name: string;
  /** Its colour ('#rrggbb'): chosen on the dashboard, or Google's */
  color: string;
  /** Whose it is: a person id, 'family' (everyone), or 'none' (no one's: shown in its own colour) */
  person: string;
  /** Names in an event's title decide whose it is ("Jacob dentist" is Jacob's); `person` is for the rest */
  byName: boolean;
  /** New events go on this one */
  isDefault: boolean;
  /** Shown on its events that have no emoji of their own ('' for none) */
  emoji: string;
  /** Google's holidays calendar: each holiday gets a fitting emoji (src/data/holidays.ts) */
  holidays: boolean;
  shown: boolean;
  /** Events can be added and changed (not a read-only or shared-view calendar) */
  writable: boolean;
}

/** An event as the Worker keeps it. Times are Google's: 'YYYY-MM-DD' (all day; end is the day
 * after) or an RFC 3339 time. */
export interface EventRecord {
  id: string;
  calendar: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  notes: string;
  recurring: boolean;
  /** People chosen for it on the dashboard (person ids, or ['family']); else whose it is comes from its calendar */
  people?: string[];
  /** This calendar only has a guest's copy; the event belongs to another calendar */
  guest?: boolean;
  /** Emoji chosen for it on the dashboard */
  emoji?: string;
}

/** Part of the day a task belongs to (its group on the Tasks screen) */
export type Slot = 'morning' | 'afternoon' | 'evening' | 'anytime';

/**
 * A task: anything someone needs to do, once or on a repeat (dishes, "Get Appa's meds" monthly,
 * "Call the plumber"). Habits are tasks with `habit` on: they get streaks and sit in the habits panel.
 */
export interface Task {
  id: string;
  title: string;
  /** '' = none (the row shows a dot) */
  emoji: string;
  /** Person id, or 'any' */
  who: string;
  /** null = once */
  repeat: Repeat | null;
  /** For a one-off: the day it's due ('YYYY-MM-DD'), or null for "whenever" */
  due: string | null;
  slot: Slot;
  /** 'HH:MM', optional */
  time: string | null;
  habit: boolean;
  onCalendar: boolean;
  /** 'HH:MM' to send a reminder (phones), and the people who get it */
  remind: string | null;
  notify: string[];
  /** The list item this is a reminder for (Lists screen), if any */
  listId: string | null;
  listItemId: string | null;
  /** ISO time it was made */
  created: string;
}

/** One completion of a task */
export interface TaskDone {
  task: string;
  /** The due day it counts for ('YYYY-MM-DD'); for a one-off, the day it was done */
  day: string;
  /** ISO time it was checked off */
  at: string;
  /** Person id, if known */
  by: string | null;
}

export interface GroceryStore {
  id: string;
  name: string;
  /** Shorter name where space is tight (the store switcher on phones) */
  short?: string;
}

export interface Grocery {
  id: string;
  name: string;
  cat: string;
  qty: number;
  store: string;
  done: boolean;
  note: string;
}

/** One line of a checklist. A heading groups the lines under it (e.g. a person on a gift list). */
export interface ListItem {
  id: string;
  text: string;
  done: boolean;
  heading?: boolean;
}

/** A list someone made on the Lists screen. (The pinned grocery list is separate: `groceries`.) */
export interface Checklist {
  id: string;
  title: string;
  emoji: string;
  /** In display order (people drag to rearrange) */
  items: ListItem[];
}

export type WxCond = 'sun' | 'moon' | 'partly' | 'cloud' | 'rain' | 'snow' | 'fog' | 'storm';

/** Weather at home (worker/weather.ts, from Open-Meteo). °F and mph. */
export interface Weather {
  place: string;
  /** The day the hourly lists start at midnight of ('YYYY-MM-DD') */
  day: string;
  /** When it was fetched (ISO) */
  updated: string;
  /** Conditions now: temperature, condition, feels-like temperature */
  now: { t: number; c: WxCond; feels: number };
  /** Today's high and low */
  hi: number;
  lo: number;
  humidity: number;
  dew: number;
  /** Today's highest UV index */
  uv: number;
  wind: number;
  gust: number;
  windDir: string;
  /** Today's, 'HH:MM' */
  sunrise: string;
  sunset: string;
  /** Phase, % lit, and the days of the next full and new moons ('YYYY-MM-DD') */
  moon: { phase: string; lit: number; waxing: boolean; full: string; new: string };
  /** Each day from today (d = days from today, 0–7) */
  daily: { d: number; c: WxCond; hi: number; lo: number; p: number }[];
  /** Hourly from midnight of `day` (today and tomorrow, 48): temperature, condition, precipitation chance */
  t: number[];
  c: WxCond[];
  p: number[];
}

/** One line of a recipe's ingredients */
export interface Ingredient {
  /** Amount for the recipe's servings (null: "to taste", "a handful") */
  qty: number | null;
  /** 'cup', 'tbsp', 'lb', 'can'… or '' for a count ("2 eggs") */
  unit: string;
  /** As it goes on the grocery list ("ground beef") */
  name: string;
  /** How it's used ("diced", "shredded") */
  note?: string;
  /** Usually in the cupboard (salt, oil): not added to groceries unless picked */
  pantry?: boolean;
  /** Nice to have (a topping, "to serve"): not needed to make it */
  optional?: boolean;
}

/** Something on hand in the kitchen */
export interface InventoryItem {
  id: string;
  name: string;
  /** Pantry, Fridge or Freezer (src/data/kitchen.ts) */
  place: string;
  qty: number;
  note: string;
}

/** A recipe (kept by the Worker, worker/kitchen.ts; it starts with src/data/recipeSamples.ts) */
export interface Recipe {
  id: string;
  title: string;
  emoji: string;
  /** Palette slot for its card (1–4) */
  tone: number;
  /** e.g. Dinner, Breakfast, Kids' pick, Baking */
  tags: string[];
  /** Hands-on plus cooking, start to finish */
  minutes: number;
  servings: number;
  ingredients: Ingredient[];
  steps: string[];
  notes?: string;
  favorite: boolean;
  /** Last time it was cooked ('YYYY-MM-DD') */
  made?: string;
  /** The web page it was imported from */
  source?: string;
}

/** A photo stored by the Worker (R2 + D1); served at /media/<id>/full and /media/<id>/thumb */
export interface Photo {
  id: string;
  w: number;
  h: number;
  /** Orientation: landscape / portrait */
  o: 'l' | 'p';
  /** When it was taken (ISO), from the photo's EXIF when available */
  taken: string | null;
  /** Name of the device that added it */
  by: string | null;
  /** When it was added (ISO) */
  added: string;
}

export interface Verse {
  ref: string;
  text: string;
  /** Translation ('NLT'); the built-in ones are KJV */
  version?: string;
}

/** A story from one of the news feeds (worker/news), served by GET /api/news */
export interface NewsStory {
  id: string;
  topic: string;
  /** Outlet, e.g. "Fox News" */
  source: string;
  title: string;
  /** A sentence or two; may be empty */
  summary: string;
  /** The full article on the outlet's site */
  link: string;
  /** Image URL on the outlet's site, if the feed has one */
  img: string | null;
  /** ISO time it was published */
  published: string;
}

export interface Data {
  people: Person[];
  family: Person;
  ALL: string[];
  /** What the calendar shows: Google's events (none until an account is connected) */
  events: CalEvent[];
  /** Google events as the Worker keeps them */
  eventRecords: EventRecord[];
  calendars: Calendar[];
  googleAccounts: GoogleAccount[];
  /** The server has Google's OAuth client set up (null: not loaded yet) */
  googleConfigured: boolean | null;
  tasks: Task[];
  /** Completions, newest last (the Worker sends about the last year) */
  taskDone: TaskDone[];
  stores: GroceryStore[];
  catOrder: Record<string, string[]>;
  groceries: Grocery[];
  /** Starter aisle guesses: [name, aisle] (src/data/grocery.ts) */
  catalog: [string, string][];
  /** Names added before and the aisle each was last in, most used first (from the Worker) */
  groceryNames: [string, string][];
  usuals: string[];
  lists: Checklist[];
  /** null until it has loaded once (or when home isn't set: worker/home.ts) */
  weather: Weather | null;
  photos: Photo[];
  recipes: Recipe[];
  /** Dinner plan: day ('YYYY-MM-DD') → recipe id */
  mealPlan: Record<string, string>;
  /** What's in the kitchen */
  inventory: InventoryItem[];
  /** Where each name (lowercase) was last kept: [name, place] */
  inventoryNames: [string, string][];
  /** Kitchen data has loaded from the Worker */
  kitchenLoaded: boolean;
  /** Taught matches: [core of a name, core it counts as] (src/data/names.ts) */
  foodAliases: [string, string][];
  /** Built-in verses (KJV), used when today's can't be loaded */
  verses: Verse[];
  /** Today's verse of the day (worker/weather.ts) */
  verse: Verse | null;
  news: NewsStory[];
  /** [id, label] */
  newsTopics: [string, string][];
}
