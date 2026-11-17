// One recipe: servings (amounts scale), ingredients (those already on the grocery list say so;
// pantry staples start unticked) with "Add to Groceries", the steps, planning it for a day, and Cook
// mode. Also the "Shop for this week" sheet, which does the same for every planned dinner at once.
import { useEffect, useRef, useState } from 'react';
import { dataStore, useData } from '../../data/store';
import { onHand } from '../../data/kitchen';
import { amount, nameFor, onList, plannedFor, shoppingFor, stepSeconds, timerLabel } from '../../data/recipes';
import {
  addInventory,
  addToGroceries,
  editInventory,
  markMade,
  placeFor,
  planDinner,
  removeInventory,
  teachMatch,
  toggleFavorite,
} from '../../data/kitchenActions';
import { dayOf, shiftDay } from '../../lib/repeat';
import { useNow } from '../../lib/clock';
import { closeSheet, openSheet, toast } from '../../app/ui';
import { Icon } from '../../ui/Icon';
import { SheetHeader } from '../../ui/headers';
import { toneStyle } from '../../ui/people';
import { dayLabel, madeAgo } from './days';
import css from './RecipeSheet.module.css';

/** `day`: the day it was opened from in the week plan */
export function openRecipe(id: string, day?: string): void {
  openSheet(() => <RecipeSheet id={id} day={day} />, { cls: 'sheet--wide ' + css.sheet });
}

/** Add what's ticked to groceries, with Undo */
function addWithUndo(names: string[]): void {
  if (!names.length) return;
  const undo = addToGroceries(names);
  toast(
    <>
      Added <b>{names.length}</b> {names.length === 1 ? 'item' : 'items'} to Groceries
    </>,
    { icon: 'cart', undo },
  );
}

function RecipeSheet({ id, day }: { id: string; day?: string }) {
  const data = useData('groceries', 'inventory', 'mealPlan', 'recipes');
  const today = dayOf(useNow());
  const r = data.recipes.find((x) => x.id === id);
  const [servings, setServings] = useState(r?.servings ?? 4);
  /** Ingredients picked to buy (by name); starts with what's needed: not pantry, not listed, not in the kitchen */
  const [picked, setPicked] = useState<Set<string>>(
    () =>
      new Set(
        r?.ingredients
          .filter((i) => !i.pantry && !i.optional && !onList(data.groceries, i.name) && !onHand(data.inventory, i.name))
          .map((i) => i.name),
      ),
  );
  const [planning, setPlanning] = useState(false);
  if (!r) return null;
  const factor = servings / r.servings;
  const toAdd = r.ingredients.filter((i) => picked.has(i.name) && !onList(data.groceries, i.name)).map((i) => i.name);
  const week = Array.from({ length: 7 }, (_, i) => shiftDay(today, i));
  const plannedOn = week.filter((d) => data.mealPlan[d] === r.id);
  const toggle = (name: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  return (
    <div className={'sheet-pad ' + css.recipe} style={toneStyle({ tone: r.tone })}>
      <header className={css.head}>
        <span className={css.art}>{r.emoji}</span>
        <div className={css.titleBlock}>
          <div className="label">{r.tags.join(' · ')}</div>
          <h2 className="serif">{r.title}</h2>
          <div className={css.meta}>
            <span>
              <Icon name="clock" size={18} /> {r.minutes} min
            </span>
            {r.made && <span>Made {madeAgo(r.made, today)}</span>}
            {plannedOn.length > 0 && (
              <span className={css.planned}>Planned · {plannedOn.map((d) => dayLabel(d, today)).join(', ')}</span>
            )}
            {r.source && (
              <a className={css.source} href={r.source} target="_blank" rel="noopener noreferrer">
                From {r.source.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]} ↗
              </a>
            )}
          </div>
        </div>
        <button
          className={css.heart + (r.favorite ? ' ' + css.isFav : '')}
          aria-label={r.favorite ? 'Unfavorite' : 'Favorite'}
          aria-pressed={r.favorite}
          onClick={() => toggleFavorite(r.id)}
        >
          <Icon name="heart" size={26} />
        </button>
      </header>

      <div className={css.cols}>
        <section className={css.ingredients}>
          <div className={css.secHead}>
            <div className="label">Ingredients</div>
            <div className={css.stepper} aria-label="Servings">
              <button
                className="icon-btn"
                aria-label="Fewer servings"
                onClick={() => setServings(Math.max(1, servings - 1))}
              >
                −
              </button>
              <b className="num">{servings}</b>
              <button
                className="icon-btn"
                aria-label="More servings"
                onClick={() => setServings(Math.min(24, servings + 1))}
              >
                +
              </button>
              <small>servings</small>
            </div>
          </div>
          <ul className={css.ingList}>
            {r.ingredients.map((i) => {
              const listed = !!onList(data.groceries, i.name);
              const have = !listed && !!onHand(data.inventory, i.name);
              const on = picked.has(i.name) && !listed;
              // Not in the kitchen yet (pantry staples too: they're assumed, but can still be recorded):
              // "I have this" adds it, or teaches that it's here under another name
              const canTeach = !listed && !have;
              return (
                <li key={i.name + i.note} className={css.ingRow}>
                  <button
                    className={css.ing + (on ? ' ' + css.isOn : '') + (listed ? ' ' + css.isListed : '')}
                    disabled={listed}
                    onClick={() => toggle(i.name)}
                  >
                    <span className={css.box}>{(on || listed) && <Icon name="check" size={16} />}</span>
                    <span className={css.ingText}>
                      <b>{amount(i, factor)}</b> {nameFor(i, factor)}
                      {i.note && <small>, {i.note}</small>}
                    </span>
                    {listed ? (
                      <em className={css.tag}>On list</em>
                    ) : have ? (
                      <em className={css.tagHave}>In kitchen</em>
                    ) : i.pantry ? (
                      <em className={css.tagSoft}>Pantry</em>
                    ) : i.optional ? (
                      <em className={css.tagSoft}>Optional</em>
                    ) : null}
                  </button>
                  {canTeach && (
                    <button className={css.haveIt} onClick={() => openHaveIt(r.id, i.name)}>
                      I have this
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <button
            className={'btn btn--solid ' + css.addBtn}
            disabled={!toAdd.length}
            onClick={() => {
              addWithUndo(toAdd);
              setPicked(new Set());
            }}
          >
            <Icon name="cart" size={20} />
            {toAdd.length ? `Add ${toAdd.length} to Groceries` : 'Everything ticked is on the list'}
          </button>
        </section>

        <section className={css.steps}>
          <div className="label">Steps</div>
          <ol>
            {r.steps.map((s, i) => (
              <li key={i}>
                <span className={css.n + ' num'}>{i + 1}</span>
                <p>{s}</p>
              </li>
            ))}
          </ol>
          {r.notes && (
            <p className={css.notes}>
              <b>Note:</b> {r.notes}
            </p>
          )}
        </section>
      </div>

      {planning && (
        <div className={css.planRow}>
          <div className="label">Plan for dinner on</div>
          <div className="chips">
            {week.map((d) => {
              const other = data.recipes.find((x) => x.id === data.mealPlan[d] && x.id !== r.id);
              const mine = data.mealPlan[d] === r.id;
              return (
                <button
                  key={d}
                  className={'chip' + (mine ? ' is-on' : '')}
                  title={other ? 'Replaces ' + other.title : undefined}
                  onClick={() => planDinner(d, mine ? null : r.id)}
                >
                  {dayLabel(d, today)}
                  {other && <small className={css.replaces}>{other.emoji}</small>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="sheet-actions">
        {day && data.mealPlan[day] === r.id && (
          <button
            className="btn btn--ghost"
            onClick={() => {
              planDinner(day, null);
              closeSheet();
            }}
          >
            Take off {dayLabel(day, today)}
          </button>
        )}
        <button
          className={'btn btn--ghost' + (planning ? ' ' + css.isOnBtn : '')}
          onClick={() => setPlanning(!planning)}
        >
          <Icon name="calendar" size={20} /> Plan
        </button>
        <button className="btn btn--solid" onClick={() => openCook(r.id, servings)}>
          <Icon name="recipe" size={20} /> Start cooking
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ "I have this": pick what it is in the kitchen
function openHaveIt(recipeId: string, name: string): void {
  openSheet(() => <HaveIt recipeId={recipeId} name={name} />);
}
function HaveIt({ recipeId, name }: { recipeId: string; name: string }) {
  const data = useData('inventory');
  const [q, setQ] = useState('');
  const back = () => openRecipe(recipeId);
  const list = data.inventory
    .filter((i) => !q.trim() || i.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.place.localeCompare(b.place) || a.name.localeCompare(b.name));
  return (
    <div className="sheet-pad">
      <SheetHeader kicker="I have this" title={`Add ${name} to the kitchen?`} />
      {/* As written: it goes in the kitchen under this name */}
      <button
        className={css.haveAdd}
        onClick={() => {
          const { item, added } = addInventory(name);
          back();
          toast(
            <>
              Added <b>{item.name}</b> to the {item.place.toLowerCase()}
            </>,
            {
              icon: 'check',
              undo: added
                ? () => {
                    removeInventory(item.id);
                  }
                : () => editInventory(item.id, { qty: Math.max(1, item.qty - 1) }),
            },
          );
        }}
      >
        <Icon name="plus" size={22} />
        <span>
          <b>Add “{name}”</b>
          <small>to the {placeFor(name).toLowerCase()}</small>
        </span>
      </button>
      {data.inventory.length > 0 && (
        <>
          <p className={'sheet-p ' + css.haveOr}>
            Or, if it’s in the kitchen under another name, pick it. From then on, recipes that need {name} will count
            it, for everyone.
          </p>
          <input
            className={css.haveSearch}
            placeholder="Search the kitchen"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </>
      )}
      <ul className={css.haveList}>
        {list.map((i) => (
          <li key={i.id}>
            <button
              className={css.haveRow}
              onClick={() => {
                const undo = teachMatch(name, i);
                back();
                toast(
                  <>
                    <b>{i.name}</b> now counts as {name}
                  </>,
                  { icon: 'check', undo },
                );
              }}
            >
              <b>{i.name}</b>
              <span className="label">{i.place}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="sheet-actions">
        <button className="btn btn--ghost" onClick={back}>
          Back
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ shop for this week
export function openShopSheet(days: string[]): void {
  openSheet(() => <ShopSheet days={days} />, { cls: 'sheet--wide' });
}
function ShopSheet({ days }: { days: string[] }) {
  const data = useData('groceries', 'inventory', 'mealPlan', 'recipes');
  const recipes = plannedFor(data, days);
  const items = shoppingFor(recipes, data.groceries, data.inventory);
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(items.filter((x) => !x.pantry && !x.optional && !x.listed && !x.have).map((x) => x.name)),
  );
  const toAdd = items.filter((x) => picked.has(x.name) && !x.listed).map((x) => x.name);
  const toggle = (name: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });
  return (
    <div className="sheet-pad">
      <SheetHeader kicker="Shop for this week" title={recipes.map((r) => r.emoji).join(' ')} />
      <p className="sheet-p">{recipes.map((r) => r.title).join(', ')}</p>
      <ul className={css.shopList}>
        {items.map((x) => {
          const on = picked.has(x.name) && !x.listed;
          return (
            <li key={x.name}>
              <button
                className={css.ing + (on ? ' ' + css.isOn : '') + (x.listed ? ' ' + css.isListed : '')}
                disabled={x.listed}
                onClick={() => toggle(x.name)}
              >
                <span className={css.box}>{(on || x.listed) && <Icon name="check" size={16} />}</span>
                <span className={css.ingText}>
                  {x.name}
                  <small> · {x.for.join(', ')}</small>
                </span>
                {x.listed ? (
                  <em className={css.tag}>On list</em>
                ) : x.have ? (
                  <em className={css.tagHave}>In kitchen</em>
                ) : x.pantry ? (
                  <em className={css.tagSoft}>Pantry</em>
                ) : x.optional ? (
                  <em className={css.tagSoft}>Optional</em>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="sheet-actions">
        <button className="btn btn--ghost" onClick={closeSheet}>
          Close
        </button>
        <button
          className="btn btn--solid"
          disabled={!toAdd.length}
          onClick={() => {
            addWithUndo(toAdd);
            closeSheet();
          }}
        >
          <Icon name="cart" size={20} /> {toAdd.length ? `Add ${toAdd.length} to Groceries` : 'Nothing to add'}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ cook mode
function openCook(id: string, servings: number): void {
  openSheet(() => <Cook id={id} servings={servings} />, { cls: css.cookSheet });
}

/** A short chime when a timer ends (three soft beeps) */
function chime(): void {
  try {
    const ctx = new AudioContext();
    [0, 0.35, 0.7].forEach((t) => {
      const o = ctx.createOscillator(),
        g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.32);
    });
    setTimeout(() => void ctx.close(), 1500);
  } catch {
    /* no sound available */
  }
}

function Cook({ id, servings }: { id: string; servings: number }) {
  const r = dataStore.get().recipes.find((x) => x.id === id);
  const today = dayOf(useNow());
  const [step, setStep] = useState(0);
  // One timer at a time: when it ends and how long it was
  const [timer, setTimer] = useState<{ end: number; secs: number; step: number } | null>(null);
  const [, tick] = useState(0);
  const rang = useRef(false);
  useEffect(() => {
    if (!timer) return;
    rang.current = false;
    const t = setInterval(() => {
      tick((n) => n + 1);
      if (Date.now() >= timer.end && !rang.current) {
        rang.current = true;
        chime();
        toast(<>Timer done · step {timer.step + 1}</>, { icon: 'timer', ms: 8000 });
      }
    }, 250);
    return () => clearInterval(t);
  }, [timer]);
  if (!r) return null;
  const factor = servings / r.servings;
  const last = step === r.steps.length - 1;
  const secs = stepSeconds(r.steps[step]);
  const left = timer ? Math.max(0, Math.round((timer.end - Date.now()) / 1000)) : 0;
  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

  return (
    <div className={css.cook} style={toneStyle({ tone: r.tone })}>
      <aside className={css.cookSide}>
        <div className={css.cookTitle}>
          <span>{r.emoji}</span>
          <b className="serif">{r.title}</b>
        </div>
        <div className="label">Ingredients · serves {servings}</div>
        <ul>
          {r.ingredients.map((i) => (
            <li key={i.name + i.note}>
              <b>{amount(i, factor)}</b> {nameFor(i, factor)}
              {i.note && <small>, {i.note}</small>}
            </li>
          ))}
        </ul>
      </aside>
      <section className={css.cookMain}>
        <div className={css.progress}>
          {r.steps.map((_, i) => (
            <button
              key={i}
              className={i === step ? css.isAt : i < step ? css.isPast : ''}
              aria-label={'Step ' + (i + 1)}
              onClick={() => setStep(i)}
            />
          ))}
        </div>
        <div className="label">
          Step {step + 1} of {r.steps.length}
        </div>
        <p className={css.stepText + ' serif'}>{r.steps[step]}</p>
        <div className={css.timerRow}>
          {timer ? (
            <button className={css.timer + (left === 0 ? ' ' + css.isRinging : '')} onClick={() => setTimer(null)}>
              <Icon name="timer" size={24} />
              <b className="num">{left ? mmss : 'Done!'}</b>
              <small>{left ? `Step ${timer.step + 1} · tap to stop` : 'Tap to clear'}</small>
            </button>
          ) : secs ? (
            <button className={css.timerStart} onClick={() => setTimer({ end: Date.now() + secs * 1000, secs, step })}>
              <Icon name="timer" size={22} /> Start a {timerLabel(secs)} timer
            </button>
          ) : null}
        </div>
        <div className={css.cookNav}>
          <button className="btn btn--ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
            <Icon name="left" size={22} /> Back
          </button>
          {last ? (
            <button
              className="btn btn--solid"
              onClick={() => {
                markMade(r.id, today);
                closeSheet();
                toast(
                  <>
                    Enjoy! <b>{r.title}</b> marked as made
                  </>,
                  { icon: 'check' },
                );
              }}
            >
              <Icon name="check" size={22} /> Done cooking
            </button>
          ) : (
            <button className="btn btn--solid" onClick={() => setStep(step + 1)}>
              Next <Icon name="right" size={22} />
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
