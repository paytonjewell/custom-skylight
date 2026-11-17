// Kitchen: three tabs. Recipes (dinners this week, what can be made from what's on hand, the recipes),
// Inventory (what's in the pantry, fridge and freezer) and Shopping List (the grocery list, food only,
// with what planned dinners need marked). The tab is remembered on each device.
import { useState } from 'react';
import { useData } from '../../data/store';
import { plannedFor, shoppingFor } from '../../data/recipes';
import { foodKey } from '../../data/names';
import { dayOf, shiftDay } from '../../lib/repeat';
import { useNow } from '../../lib/clock';
import { store, stored } from '../../lib/store';
import { GroceryList } from '../lists/GroceryList';
import { RecipesTab } from './Recipes';
import { Inventory } from './Inventory';
import { KitchenTitle } from './kitchenTitle';
import css from './Kitchen.module.css';

type Tab = 'recipes' | 'inventory' | 'shopping';
const TABS = [
  ['recipes', 'Recipes'],
  ['inventory', 'Inventory'],
  ['shopping', 'Shopping'],
] as const;
const KEY = 'kitchen.tab';

export function Kitchen() {
  const [tab, setTab] = useState<Tab>(() => {
    const t = stored(KEY, 'recipes');
    return t === 'inventory' || t === 'shopping' ? t : 'recipes';
  });
  const pick = (t: Tab) => {
    setTab(t);
    store(KEY, t);
  };
  return (
    <div className={css.kitchen}>
      <KitchenTitle.Provider
        value={
          <span className={css.tabs} role="tablist">
            {TABS.map(([t, label]) => (
              <button
                key={t}
                role="tab"
                aria-selected={t === tab}
                className={t === tab ? css.isOn : undefined}
                onClick={() => pick(t)}
              >
                {label}
              </button>
            ))}
          </span>
        }
      >
        {tab === 'recipes' && <RecipesTab onInventory={() => pick('inventory')} />}
        {tab === 'inventory' && <Inventory />}
        {tab === 'shopping' && <Shopping />}
      </KitchenTitle.Provider>
    </div>
  );
}

/** Aisles the Shopping List leaves out: not food */
const NOT_FOOD = ['Household'];

/** The grocery list, food only, with what this week's dinners need marked and suggested */
function Shopping() {
  const data = useData('groceries', 'inventory', 'mealPlan', 'recipes');
  const today = dayOf(useNow());
  const week = Array.from({ length: 7 }, (_, i) => shiftDay(today, i));
  const planned = plannedFor(data, week);
  // Name (lowercase) → "🌮 Taco night, 🌶️ Weeknight chili"
  const needs = new Map<string, string>();
  for (const r of planned) {
    for (const i of r.ingredients) {
      const k = foodKey(i.name);
      const label = r.emoji + ' ' + r.title;
      const had = needs.get(k);
      if (!had?.includes(label)) needs.set(k, had ? had + ', ' + label : label);
    }
  }
  // Still needed: not on the list, not a pantry staple, not on hand
  const suggest = shoppingFor(planned, data.groceries, data.inventory)
    .filter((x) => !x.listed && !x.pantry && !x.optional && !x.have)
    .map((x) => x.name);
  return <GroceryList kitchen={{ hide: NOT_FOOD, forRecipes: (name) => needs.get(foodKey(name)), suggest }} />;
}
