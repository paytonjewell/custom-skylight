// Kitchen › Recipes: this week's dinners across the top (tap a day to plan one; "Shop this week"
// gathers what they need for the grocery list), what can be made from what's on hand (Inventory),
// then the recipes as cards, with search and filter chips. A card opens the recipe (RecipeSheet):
// ingredients to add to groceries, steps, and Cook mode.
import { useRef, useState } from 'react';
import type { Recipe } from '../../data/types';
import { useData } from '../../data/store';
import { filterRecipes, onList, plannedFor, shoppingFor } from '../../data/recipes';
import { whatCanWeMake, type Readiness } from '../../data/kitchen';
import { addToGroceries } from '../../data/kitchenActions';
import { useKitchenStatus } from '../../data/kitchenSync';
import { planDinner, toggleFavorite } from '../../data/kitchenActions';
import { dayOf, shiftDay } from '../../lib/repeat';
import { useNow } from '../../lib/clock';
import { closeSheet, openSheet, toast } from '../../app/ui';
import { Icon } from '../../ui/Icon';
import { PageHeader, SheetHeader } from '../../ui/headers';
import { EmptyNote } from '../../ui/EmptyNote';
import { useEdgeFade } from '../../ui/hooks';
import { useDragDrop, type DragProps } from '../../ui/useDragDrop';
import { toneStyle } from '../../ui/people';
import { openRecipe, openShopSheet } from './RecipeSheet';
import { openAddRecipe } from './AddRecipeSheet';
import { useLayout } from '../../app/layout';
import { dayLabel, madeAgo } from './days';
import css from './Recipes.module.css';

const FILTERS = [
  'All',
  'Ready to make',
  'Favorites',
  'Quick',
  'Dinner',
  'Breakfast',
  "Kids' pick",
  'Baking',
  'Make ahead',
];

/** `onInventory`: switch to the Inventory tab */
export function RecipesTab({ onInventory }: { onInventory: () => void }) {
  const data = useData('inventory', 'kitchenLoaded', 'mealPlan', 'recipes');
  const now = useNow();
  const today = dayOf(now);
  const status = useKitchenStatus();
  const phone = useLayout() === 'phone';
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const ready = whatCanWeMake(data.recipes, data.inventory);
  const missingFor = new Map(ready.map((x) => [x.recipe.id, x.missing.map((i) => i.name)]));
  // Hold a recipe, drag it onto a day this week to plan it; or hold a planned dinner and drag it to
  // another day (onto a day that has one, the two swap)
  const dnd = useDragDrop<{ rec: Recipe; from?: string }>({
    onDrop: ({ rec, from }, day) => {
      const before = data.mealPlan[day];
      // Already that dinner there (or dropped back where it was): nothing to do
      if (before === rec.id || from === day) return;
      planDinner(day, rec.id);
      const when = dayLabel(day, today).toLowerCase();
      if (from) {
        planDinner(from, before ?? null);
        const other = before ? data.recipes.find((x) => x.id === before) : undefined;
        toast(
          other ? (
            <>
              Swapped <b>{rec.title}</b> and <b>{other.title}</b>
            </>
          ) : (
            <>
              Moved <b>{rec.title}</b> to {when}
            </>
          ),
          {
            icon: 'calendar',
            undo: () => {
              planDinner(from, rec.id);
              planDinner(day, before ?? null);
            },
          },
        );
        return;
      }
      toast(
        <>
          Planned <b>{rec.title}</b> for {when}
        </>,
        { icon: 'calendar', undo: () => planDinner(day, before ?? null) },
      );
    },
    ghost: ({ rec }) => (
      <div className={css.dragCard} style={toneStyle({ tone: rec.tone })}>
        <span>{rec.emoji}</span>
        <b>{rec.title}</b>
      </div>
    ),
    compact: true,
  });
  const list = filterRecipes(data.recipes, query, filter === 'Ready to make' ? 'All' : filter).filter(
    (r) => filter !== 'Ready to make' || !missingFor.get(r.id)?.length,
  );
  /** Recipe id → the days this week it's planned for */
  const week = Array.from({ length: 7 }, (_, i) => shiftDay(today, i));
  const plannedDays = new Map<string, string[]>();
  for (const day of week) {
    const id = data.mealPlan[day];
    if (id) plannedDays.set(id, [...(plannedDays.get(id) ?? []), day]);
  }

  return (
    <div className={css.page}>
      <PageHeader kicker={status === 'loading' && !data.kitchenLoaded ? 'Loading…' : 'Kitchen'} title="Recipes">
        <label className={css.search}>
          <Icon name="search" size={20} />
          <input
            placeholder="Search recipes or ingredients"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            enterKeyHint="search"
          />
          {query && (
            <button className={css.clear} aria-label="Clear search" onClick={() => setQuery('')}>
              <Icon name="x" size={18} />
            </button>
          )}
        </label>
      </PageHeader>

      {/* Phones: + adds a recipe (typing one in is a phone job; the frame just shows them) */}
      {phone && (
        <button className={css.fab} aria-label="Add a recipe" onClick={() => openAddRecipe()}>
          <Icon name="plus" size={26} />
        </button>
      )}
      <div className={css.scroll}>
        <WeekPlan days={week} today={today} drag={(rec, from) => dnd.bind({ rec, from })} lifted={dnd.dragging?.from} />
        <FromKitchen ready={ready} hasInventory={data.inventory.length > 0} onInventory={onInventory} />

        <div className={'chips ' + css.filters}>
          {FILTERS.filter(
            (f) =>
              ['All', 'Ready to make', 'Favorites', 'Quick'].includes(f) ||
              data.recipes.some((r) => r.tags.includes(f)),
          ).map((f) => (
            <button key={f} className={'chip' + (filter === f ? ' is-on' : '')} onClick={() => setFilter(f)}>
              {f === 'Favorites' && <Icon name="heart" size={16} />}
              {f}
            </button>
          ))}
        </div>

        {list.length ? (
          <div className={css.grid}>
            {list.map((r) => (
              <RecipeCard
                key={r.id}
                r={r}
                today={today}
                planned={plannedDays.get(r.id) ?? []}
                missing={data.inventory.length ? missingFor.get(r.id) : undefined}
                drag={dnd.bind({ rec: r })}
                lifted={!dnd.dragging?.from && dnd.dragging?.rec.id === r.id}
              />
            ))}
          </div>
        ) : (
          <EmptyNote className={css.empty}>
            <i>No recipes</i>{' '}
            {query
              ? `match “${query}”`
              : filter === 'Favorites'
                ? 'marked as favorites yet'
                : filter === 'Ready to make'
                  ? 'can be made from what’s on hand'
                  : 'here yet'}
          </EmptyNote>
        )}
      </div>
      {dnd.layer}
    </div>
  );
}

// ------------------------------------------------------------ this week's dinners
function WeekPlan({
  days,
  today,
  drag,
  lifted,
}: {
  days: string[];
  today: string;
  /** Hold a planned dinner to drag it to another day */
  drag: (rec: Recipe, from: string) => DragProps;
  /** The day whose dinner is being dragged */
  lifted?: string;
}) {
  const data = useData('groceries', 'inventory', 'mealPlan', 'recipes');
  const planned = plannedFor(data, days);
  const toBuy = shoppingFor(planned, data.groceries, data.inventory).filter(
    (x) => !x.listed && !x.pantry && !x.optional && !x.have,
  ).length;
  return (
    <section className={css.week}>
      <div className={css.weekHead}>
        <div className="label">Dinners this week</div>
        <button
          className={'btn ' + (toBuy ? 'btn--solid' : 'btn--ghost') + ' ' + css.shopBtn}
          disabled={!planned.length}
          onClick={() => openShopSheet(days)}
        >
          <Icon name="cart" size={20} />
          {!planned.length ? 'Plan a dinner to shop for it' : toBuy ? `Shop this week · ${toBuy}` : 'All on the list'}
        </button>
      </div>
      <div className={css.days}>
        {days.map((day) => {
          const r = data.recipes.find((x) => x.id === data.mealPlan[day]);
          return (
            <button
              key={day}
              data-drop={day}
              className={
                css.day +
                (r ? ' ' + css.isPlanned : '') +
                (day === today ? ' ' + css.isToday : '') +
                (lifted === day ? ' ' + css.isLifted : '')
              }
              {...(r ? drag(r, day) : {})}
              style={r ? { ...drag(r, day).style, ...toneStyle({ tone: r.tone }) } : undefined}
              onClick={() => (r ? openRecipe(r.id, day) : pickDinner(day))}
            >
              <span className={css.dayName}>{dayLabel(day, today)}</span>
              {r ? (
                <>
                  <span className={css.dayEmoji}>{r.emoji}</span>
                  <b>{r.title}</b>
                </>
              ) : (
                <span className={css.plan}>
                  <Icon name="plus" size={20} /> Plan
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Choose a recipe for a day's dinner */
export function pickDinner(day: string): void {
  openSheet(() => <PickDinner day={day} />, { cls: 'sheet--wide' });
}
function PickDinner({ day }: { day: string }) {
  const data = useData('recipes');
  const today = dayOf(useNow());
  // Favorites first, then the ones not made for longest
  const list = [...data.recipes].sort(
    (a, b) => Number(b.favorite) - Number(a.favorite) || (a.made ?? '').localeCompare(b.made ?? ''),
  );
  return (
    <div className="sheet-pad">
      <SheetHeader kicker="Plan dinner" title={dayLabel(day, today, true)} />
      <div className={css.pickGrid}>
        {list.map((r) => (
          <button
            key={r.id}
            className={css.pick}
            style={toneStyle({ tone: r.tone })}
            onClick={() => {
              planDinner(day, r.id);
              closeSheet();
            }}
          >
            <span className={css.pickEmoji}>{r.emoji}</span>
            <span>
              <b>{r.title}</b>
              <small>
                {r.minutes} min{r.made ? ' · made ' + madeAgo(r.made, today) : ''}
              </small>
            </span>
            {r.favorite && <Icon name="heart" size={16} className={css.fav} />}
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ a recipe card
function RecipeCard({
  r,
  today,
  planned,
  missing,
  drag,
  lifted,
}: {
  r: Recipe;
  today: string;
  planned: string[];
  missing?: string[];
  drag: DragProps;
  lifted: boolean;
}) {
  return (
    <div className={css.card + (lifted ? ' ' + css.isLifted : '')} style={toneStyle({ tone: r.tone })}>
      <button className={css.cardMain} onClick={() => openRecipe(r.id)} {...drag}>
        <span className={css.art}>{r.emoji}</span>
        <span className={css.cardText}>
          <b className="serif">{r.title}</b>
          <small>
            {r.minutes} min · serves {r.servings}
            {r.made ? ' · made ' + madeAgo(r.made, today) : ''}
          </small>
          {missing && (
            <span className={css.need + (missing.length ? '' : ' ' + css.isReady)}>
              {missing.length
                ? `Need ${missing.length}: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`
                : 'Ready to make'}
            </span>
          )}
          <span className={css.tags}>
            {planned.map((d) => (
              <em key={d} className={css.plannedTag}>
                {dayLabel(d, today)}
              </em>
            ))}
            {r.tags.map((t) => (
              <i key={t}>{t}</i>
            ))}
          </span>
        </span>
      </button>
      <button
        className={css.heart + (r.favorite ? ' ' + css.isFav : '')}
        aria-label={r.favorite ? 'Unfavorite' : 'Favorite'}
        aria-pressed={r.favorite}
        onClick={() => toggleFavorite(r.id)}
      >
        <Icon name="heart" size={22} />
      </button>
    </div>
  );
}

// ------------------------------------------------------------ what can be made from what's on hand
/** Missing this many or fewer: "a quick trip away" */
const CLOSE = 3;

function FromKitchen({
  ready,
  hasInventory,
  onInventory,
}: {
  ready: Readiness[];
  hasInventory: boolean;
  onInventory: () => void;
}) {
  const data = useData('groceries');
  const close = ready.filter((x) => x.missing.length <= CLOSE).slice(0, 8);
  const row = useRef<HTMLDivElement>(null);
  useEdgeFade(row, `${close.length}:${hasInventory}`);
  if (!hasInventory) {
    return (
      <button className={css.kitchenHint} onClick={onInventory}>
        <span className={css.hintEmoji}>🥫</span>
        <span className={css.hintText}>
          <b>What can we make?</b>
          <small>
            Add what’s in your pantry, fridge and freezer under Inventory, and recipes will show what they still need.
          </small>
        </span>
        <Icon name="right" size={20} />
      </button>
    );
  }
  if (!close.length) return null;
  const now = close.filter((x) => !x.missing.length).length;
  return (
    <section className={css.fromKitchen}>
      <div className="label">From your kitchen · {now ? `${now} ready now` : 'a quick trip away'}</div>
      <div className={css.closeRow} ref={row}>
        {close.map(({ recipe: r, missing }) => {
          const toBuy = missing.map((i) => i.name).filter((n) => !onList(data.groceries, n));
          return (
            <div
              key={r.id}
              className={css.closeCard + (missing.length ? '' : ' ' + css.isReady)}
              style={toneStyle({ tone: r.tone })}
            >
              <button className={css.closeMain} onClick={() => openRecipe(r.id)}>
                <span className={css.closeEmoji}>{r.emoji}</span>
                <span>
                  <b>{r.title}</b>
                  <small>
                    {missing.length ? 'Need ' + missing.map((i) => i.name).join(', ') : 'Everything’s here'}
                  </small>
                </span>
              </button>
              {missing.length > 0 && (
                <button
                  className={css.closeAdd}
                  disabled={!toBuy.length}
                  onClick={() => {
                    const undo = addToGroceries(toBuy);
                    toast(
                      <>
                        Added <b>{toBuy.length}</b> for {r.title} to the shopping list
                      </>,
                      { icon: 'cart', undo },
                    );
                  }}
                >
                  <Icon name="cart" size={16} /> {toBuy.length ? 'Add missing to list' : 'On the list'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
