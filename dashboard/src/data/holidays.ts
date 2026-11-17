// An emoji for each holiday on Google's holidays calendars, by its name. Pure.

const HOLIDAYS: [RegExp, string][] = [
  [/christmas/i, '🎄'],
  [/thanksgiving/i, '🦃'],
  [/valentine/i, '❤️'],
  [/halloween/i, '🎃'],
  [/new year.s eve/i, '🥂'],
  [/lunar new year|chinese new year/i, '🧧'],
  [/new year/i, '🎉'],
  [/independence day/i, '🎆'],
  [/easter sunday/i, '⛪️'],
  [/easter/i, '🐣'],
  [/good friday/i, '✝️'],
  [/patrick/i, '☘️'],
  [/mother.s day/i, '💐'],
  [/father.s day/i, '👔'],
  [/memorial day/i, '🇺🇸'],
  [/flag day/i, '🇺🇸'],
  [/veterans/i, '🎖️'],
  [/labor day/i, '🏝️'],
  [/martin luther king/i, '🕊️'],
  [/juneteenth/i, '✊🏾'],
  [/president/i, '🏛️'],
  [/columbus|indigenous/i, '🧭'],
  [/daylight saving/i, '⏰'],
  [/black friday/i, '🛍️'],
  [/cyber monday/i, '💻'],
  [/tax day/i, '🧾'],
  [/cinco de mayo/i, '🪅'],
  [/election/i, '🗳️'],
  [/groundhog/i, '🦫'],
  [/mardi gras/i, '🎭'],
  [/earth day/i, '🌎'],
  [/hanukkah|chanukah/i, '🕎'],
  [/kwanzaa/i, '🕯️'],
  [/ramadan|eid/i, '🌙'],
  [/diwali/i, '🪔'],
  [/rosh hashanah/i, '🍎'],
  [/yom kippur|passover/i, '✡️'],
];

/** "Thanksgiving Day" → 🦃 (undefined for a holiday not listed) */
export function holidayEmoji(title: string): string | undefined {
  return HOLIDAYS.find(([re]) => re.test(title))?.[1];
}
