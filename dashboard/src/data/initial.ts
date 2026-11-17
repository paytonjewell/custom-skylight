// The data before anything has loaded. Everything real comes from the Worker (the *Sync.ts modules);
// what was loaded last is kept on the device and shown at start (src/data/sync.ts), so a reload
// doesn't flash empty screens. Only presets live here: grocery aisles and stores, and fallback verses.
import { AISLE_ORDER, CATALOG, STORES, USUALS } from './grocery';
import { stored } from '../lib/store';
import type { Data, Person, Verse } from './types';
import { calendarPeople } from './select';

/** Shown when today's verse can't be loaded (KJV, public domain) */
const VERSES: Verse[] = [
  { ref: 'Psalm 118:24', text: 'This is the day which the LORD hath made; we will rejoice and be glad in it.' },
  { ref: 'Proverbs 3:5', text: 'Trust in the LORD with all thine heart; and lean not unto thine own understanding.' },
  { ref: 'Psalm 46:10', text: 'Be still, and know that I am God.' },
  { ref: 'Lamentations 3:22–23', text: 'It is of the LORD’s mercies that we are not consumed, because his compassions fail not. They are new every morning: great is thy faithfulness.' },
  { ref: 'Philippians 4:13', text: 'I can do all things through Christ which strengtheneth me.' },
  { ref: 'Psalm 23:1', text: 'The LORD is my shepherd; I shall not want.' },
  { ref: 'Matthew 11:28', text: 'Come unto me, all ye that labour and are heavy laden, and I will give you rest.' },
  { ref: '1 John 4:19', text: 'We love him, because he first loved us.' },
];

/** Where the family from the last load is kept (src/data/familySync.ts) */
export const FAMILY_KEY = 'family.last';

/** The people from the last load on this device, or none yet */
function keptFamily(): Person[] {
  try {
    const list = JSON.parse(stored(FAMILY_KEY, '[]')) as Person[];
    return Array.isArray(list) ? list.filter((p) => p && typeof p.id === 'string') : [];
  } catch {
    return [];
  }
}

export function initialData(): Data {
  const people = keptFamily();
  return {
    people,
    family: { id: 'family', name: 'Family', tone: 0 },
    ALL: calendarPeople(people).map((p) => p.id),
    events: [], eventRecords: [], calendars: [], googleAccounts: [], googleConfigured: null,
    tasks: [], taskDone: [],
    stores: STORES, catOrder: AISLE_ORDER, groceries: [], catalog: CATALOG, groceryNames: [], usuals: USUALS, lists: [],
    weather: null, photos: [], verses: VERSES, verse: null,
    recipes: [], mealPlan: {}, inventory: [], inventoryNames: [], kitchenLoaded: false, foodAliases: [],
    news: [], newsTopics: [],
  };
}
