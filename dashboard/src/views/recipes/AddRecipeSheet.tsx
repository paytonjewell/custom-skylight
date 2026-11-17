// A new recipe, from a phone: name and emoji, tags, time and servings, then ingredients and steps typed
// one per line. Ingredient lines are read as you type ("1 1/2 cups flour, sifted") and shown as they'll
// be kept; tap one there to mark it Pantry (in the cupboard) or Optional.
//
// Or start from a link: the Worker reads the page's recipe (worker/recipeImport.ts) and fills the form
// to check over. A site that won't let apps read it: paste the recipe's text instead, and it's split at
// its "Ingredients" and "Instructions" headings.
import { Stepper } from '../../ui/Stepper';
import { Chip } from '../../ui/Chip';
import { useEffect, useEffectEvent, useState } from 'react';
import type { Ingredient } from '../../data/types';
import { useData, newId } from '../../data/store';
import { amount, guessEmoji, parseIngredient, parseRecipeText, parseSteps } from '../../data/recipes';
import { api } from '../../data/api';
import type { ImportedRecipe } from '../../data/types';
import { addRecipe } from '../../data/kitchenActions';
import { closeSheet, go, openSheet, toast } from '../../app/ui';
import { store } from '../../lib/store';
import { EmojiTitle } from '../../ui/EmojiTitle';
import { Icon } from '../../ui/Icon';
import { SheetHeader } from '../../ui/headers';
import { openRecipe } from './RecipeSheet';
import css from './AddRecipeSheet.module.css';

const TAGS = ['Dinner', 'Lunch', 'Breakfast', 'Side', 'Dessert', 'Baking', "Kids' pick", 'Quick', 'Make ahead'];
const MINUTES = [15, 30, 45, 60, 90];
type Kind = 'needed' | 'pantry' | 'optional';
const NEXT: Record<Kind, Kind> = { needed: 'pantry', pantry: 'optional', optional: 'needed' };

/**
 * A recipe link shared to the app (public/sw.js sends it here as ?recipe=…): open Kitchen with the New
 * recipe form importing it. Called once at start (src/app/App.tsx).
 */
export function checkSharedRecipe(): void {
  const q = new URLSearchParams(location.search);
  const link = q.get('recipe');
  if (!link) return;
  q.delete('recipe');
  history.replaceState(null, '', location.pathname + (q.size ? '?' + q : '') + '#kitchen');
  store('kitchen.tab', 'recipes');
  go('kitchen');
  openAddRecipe(link);
}

/** `link`: start by importing it (e.g. shared to the app from a browser) */
export function openAddRecipe(link?: string): void {
  openSheet(() => <AddRecipe link={link} />, { cls: css.sheet });
}

const site = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

function AddRecipe({ link: startLink }: { link?: string }) {
  const data = useData('recipes');
  const [title, setTitle] = useState('');
  const [emoji, setEmoji] = useState('🍽️');
  const [tags, setTags] = useState<string[]>(['Dinner']);
  const [minutes, setMinutes] = useState(30);
  const [servings, setServings] = useState(4);
  const [ingText, setIngText] = useState('');
  const [stepText, setStepText] = useState('');
  const [notes, setNotes] = useState('');
  /** Pantry / Optional chosen in the preview, by line text */
  const [kinds, setKinds] = useState<Record<string, Kind>>({});
  const [tried, setTried] = useState(false);
  // Importing from a link
  const [link, setLink] = useState(startLink ?? '');
  const [source, setSource] = useState('');
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState('');
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');

  const fill = (x: Pick<ImportedRecipe, 'title' | 'ingredients' | 'steps'> & Partial<ImportedRecipe>) => {
    if (x.title) {
      setTitle(x.title);
      setEmoji(guessEmoji(x.title));
    }
    setIngText(x.ingredients.join('\n'));
    setStepText(x.steps.join('\n'));
    if (x.minutes) setMinutes(Math.min(2880, x.minutes));
    if (x.servings) setServings(x.servings);
    if (x.tags?.length) setTags(x.tags);
    setKinds({});
  };
  const fetchLink = (url = link) => {
    if (!url.trim() || importing) return;
    setImporting(true);
    setImportErr('');
    void api
      .importRecipe(url.trim())
      .then(
        (x) => {
          fill(x);
          setSource(x.source);
          setPasting(false);
        },
        (e: Error) => {
          setImportErr(e.message || 'Couldn’t read that page.');
          setSource(url.trim());
        },
      )
      .then(() => setImporting(false));
  };
  // Opened with a link: import it straight away
  const importStartLink = useEffectEvent(() => {
    if (startLink) fetchLink(startLink);
  });
  useEffect(() => importStartLink(), []);
  const applyPasted = () => {
    const x = parseRecipeText(pasted);
    if (!x)
      return setImportErr(
        'Couldn’t find an “Ingredients” heading in that text. Paste from the recipe’s name down through its steps.',
      );
    fill(x);
    setPasting(false);
    setImportErr('');
  };

  const lines = ingText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const parsed = lines
    .map((line) => ({ line, i: parseIngredient(line) }))
    .filter((x): x is { line: string; i: Ingredient } => !!x.i);
  const kindOf = (line: string, i: Ingredient): Kind =>
    kinds[line] ?? (i.optional ? 'optional' : i.pantry ? 'pantry' : 'needed');
  const ingredients: Ingredient[] = parsed.map(({ line, i }) => {
    const { pantry: _p, optional: _o, ...rest } = i;
    const k = kindOf(line, i);
    return { ...rest, ...(k === 'pantry' ? { pantry: true } : {}), ...(k === 'optional' ? { optional: true } : {}) };
  });
  const steps = parseSteps(stepText);
  const missing = [!title.trim() && 'a name', !ingredients.length && 'ingredients'].filter(Boolean) as string[];

  const save = () => {
    setTried(true);
    if (missing.length) return;
    const id = newId();
    addRecipe({
      id,
      title: title.trim(),
      emoji,
      tone: (data.recipes.length % 4) + 1,
      tags,
      minutes,
      servings,
      ingredients,
      steps,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(/^https?:\/\//.test(source) ? { source } : {}),
      favorite: false,
    });
    closeSheet();
    toast(
      <>
        Added <b>{title.trim()}</b> to Recipes
      </>,
      { icon: 'recipe' },
    );
    openRecipe(id);
  };
  const toggleTag = (t: string) => setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]));

  return (
    <div className={'sheet-pad ' + css.form}>
      <SheetHeader kicker="Kitchen" title="New recipe" />

      {/* Start from a link (or, if the site won't share, the recipe's text) */}
      <div className={css.import}>
        <div className={css.linkRow}>
          <Icon name="link" size={20} />
          <input
            type="url"
            inputMode="url"
            placeholder="Paste a recipe link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') fetchLink();
            }}
            enterKeyHint="go"
          />
          <button className="btn btn--solid" disabled={!link.trim() || importing} onClick={() => fetchLink()}>
            {importing ? 'Reading…' : 'Get recipe'}
          </button>
        </div>
        {source && !importErr && !importing && (
          <small className={css.imported}>From {site(source)} · check it over below</small>
        )}
        {importErr && (
          <p className={css.importErr}>
            {importErr} {!pasting && <button onClick={() => setPasting(true)}>Paste the recipe’s text instead</button>}
          </p>
        )}
        {!importErr && !pasting && !source && (
          <button className={css.pasteLink} onClick={() => setPasting(true)}>
            or paste a recipe’s text
          </button>
        )}
        {pasting && (
          <>
            <textarea
              className={css.area}
              rows={6}
              autoFocus
              placeholder={'Copy the recipe from the page, from its name down through the steps, and paste it here.'}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
            <button className={'btn btn--ghost ' + css.pasteBtn} disabled={!pasted.trim()} onClick={applyPasted}>
              Fill in the form
            </button>
          </>
        )}
      </div>

      <EmojiTitle
        emoji={emoji}
        onEmoji={setEmoji}
        title={title}
        onTitle={setTitle}
        placeholder="Recipe name"
        invalid={tried && !title.trim()}
        enterKeyHint="next"
      />

      <div className="label">Tags</div>
      <div className="chips">
        {TAGS.map((t) => (
          <Chip key={t} on={tags.includes(t)} onClick={() => toggleTag(t)}>
            {t}
          </Chip>
        ))}
      </div>

      <div className={css.nums}>
        <div>
          <div className="label">Minutes, start to finish</div>
          <div className={css.minutes}>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={2880}
              value={minutes}
              onChange={(e) => setMinutes(Math.max(0, Math.min(2880, Math.round(Number(e.target.value) || 0))))}
            />
            <div className="chips">
              {MINUTES.map((m) => (
                <Chip key={m} on={minutes === m} className="chip--ghost" onClick={() => setMinutes(m)}>
                  {m}
                </Chip>
              ))}
            </div>
          </div>
        </div>
        <div>
          <div className="label">Serves</div>
          <Stepper value={servings} onChange={setServings} max={100} label="servings" compact />
        </div>
      </div>

      <div className="label">Ingredients · one per line</div>
      <textarea
        className={css.area + (tried && !ingredients.length ? ' ' + css.isMissing : '')}
        rows={5}
        placeholder={'1 lb ground beef\n2 cloves garlic, minced\n1 1/2 cups shredded cheddar\nsalt and pepper to taste'}
        value={ingText}
        onChange={(e) => setIngText(e.target.value)}
      />
      {parsed.length > 0 && (
        <>
          <small className={css.hint}>How they’ll read · tap one to mark it Pantry or Optional</small>
          <ul className={css.preview}>
            {parsed.map(({ line, i }) => {
              const k = kindOf(line, i);
              return (
                <li key={line}>
                  <button onClick={() => setKinds((x) => ({ ...x, [line]: NEXT[k] }))}>
                    <span>
                      {amount(i) && <b>{amount(i)} </b>}
                      {i.name}
                      {i.note && <small>, {i.note}</small>}
                    </span>
                    {k !== 'needed' && <em className={css.kind}>{k === 'pantry' ? 'Pantry' : 'Optional'}</em>}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="label">Steps · one per line</div>
      <textarea
        className={css.area}
        rows={5}
        placeholder={'Brown the beef in a skillet, about 7 minutes.\nAdd the garlic and cook 1 minute.\n…'}
        value={stepText}
        onChange={(e) => setStepText(e.target.value)}
      />
      {steps.length > 0 && (
        <small className={css.hint}>
          {steps.length} {steps.length === 1 ? 'step' : 'steps'} · times in a step (“bake 25 minutes”) become timers in
          Cook mode
        </small>
      )}

      <div className="label">Notes</div>
      <textarea
        className={css.area}
        rows={2}
        placeholder="Optional"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      {tried && missing.length > 0 && <p className={css.err}>Add {missing.join(' and ')} to save it.</p>}
      <div className="sheet-actions">
        <button className="btn btn--ghost" onClick={closeSheet}>
          Cancel
        </button>
        <button className="btn btn--solid" onClick={save}>
          Save recipe
        </button>
      </div>
    </div>
  );
}
