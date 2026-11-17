// "How often" in the task editor: Once, Daily, Weekdays, Weekly, Monthly or Custom…, with the
// weekdays, day of the month, every-few steppers and "Repeat from" each one needs. The controls are
// plain data (repeatControls.ts); TaskSheet keeps them and turns them into the rule with toRepeat.
import { Chip } from '../../ui/Chip';
import type { Weekday } from '../../lib/repeat';
import { canCountFromDone, fromDone, type Custom, type Often, type RepeatControls } from './repeatControls';
// Part of the task editor, so it shares the editor's styles (the grey boxes, the steppers)
import css from './TaskSheet.module.css';

const OFTEN: [Often, string][] = [
  ['once', 'Once'],
  ['daily', 'Daily'],
  ['weekdays', 'Weekdays'],
  ['weekly', 'Weekly'],
  ['monthly', 'Monthly'],
  ['custom', 'Custom…'],
];
const CUSTOM: [Custom, string][] = [
  ['days', 'Every few days'],
  ['weeks', 'Every few weeks'],
  ['months', 'Every few months'],
  ['nth', 'A weekday of the month'],
];
const WEEK: [Weekday, string][] = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [0, 'Sun'],
];
const NTHS: [1 | 2 | 3 | 4 | -1, string][] = [
  [1, '1st'],
  [2, '2nd'],
  [3, '3rd'],
  [4, '4th'],
  [-1, 'Last'],
];
const OFFSETS: [number, string][] = [
  [-1, 'Day before'],
  [0, 'On the day'],
  [1, 'Day after'],
];

/** − 3 + days */
function Stepper({
  label,
  value,
  onChange,
  min = 1,
  max = 365,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className={css.stepper}>
      <button className="icon-btn" aria-label="Fewer" onClick={() => onChange(Math.max(min, value - 1))}>
        −
      </button>
      <b className="num">{value}</b>
      <button className="icon-btn" aria-label="More" onClick={() => onChange(Math.min(max, value + 1))}>
        +
      </button>
      <span>{label}</span>
    </div>
  );
}

export function RepeatPicker({
  value: c,
  onChange,
}: {
  value: RepeatControls;
  onChange: (next: RepeatControls) => void;
}) {
  const set = (p: Partial<RepeatControls>) => onChange({ ...c, ...p });
  const done = fromDone(c);
  const { mode, custom, every, monthDay } = c;
  const toggleDay = (d: Weekday) => set({ days: c.days.includes(d) ? c.days.filter((y) => y !== d) : [...c.days, d] });
  const weekdays = (
    <div className="chips">
      {WEEK.map(([d, label]) => (
        <Chip key={d} on={c.days.includes(d)} onClick={() => toggleDay(d)}>
          {label}
        </Chip>
      ))}
    </div>
  );
  const monthDayStep = (
    <Stepper label="day of the month" value={monthDay} onChange={(n) => set({ monthDay: n })} max={31} />
  );
  /** "2 weeks" counting from when it's done, "2 weeks, on" (then the weekdays) from the calendar */
  const unit = (one: string) => (every === 1 ? one : one + 's') + (done ? '' : ', on');

  return (
    <>
      <div className="label">How often</div>
      <div className="chips">
        {OFTEN.map(([id, label]) => (
          <Chip key={id} on={mode === id} onClick={() => set({ mode: id })}>
            {label}
          </Chip>
        ))}
      </div>
      {canCountFromDone(c) && (
        <div className={css.basis}>
          <span>Repeat from</span>
          <div className="chips">
            <Chip on={c.basis === 'due'} onClick={() => set({ basis: 'due' })}>
              The due date
            </Chip>
            <Chip on={c.basis === 'done'} onClick={() => set({ basis: 'done' })}>
              When it’s done
            </Chip>
          </div>
        </div>
      )}
      {mode === 'weekly' && !done && <div className={css.more}>{weekdays}</div>}
      {mode === 'monthly' && !done && <div className={css.more}>{monthDayStep}</div>}
      {mode === 'custom' && (
        <div className={css.more}>
          <div className="chips">
            {CUSTOM.map(([id, label]) => (
              <Chip key={id} on={custom === id} className="chip--ghost" onClick={() => set({ custom: id })}>
                {label}
              </Chip>
            ))}
          </div>
          {custom === 'days' && (
            <Stepper label={every === 1 ? 'day' : 'days'} value={every} onChange={(n) => set({ every: n })} />
          )}
          {custom === 'weeks' && (
            <>
              <Stepper label={unit('week')} value={every} onChange={(n) => set({ every: n })} max={52} />
              {!done && weekdays}
            </>
          )}
          {custom === 'months' && (
            <>
              <Stepper label={unit('month')} value={every} onChange={(n) => set({ every: n })} max={24} />
              {!done && monthDayStep}
            </>
          )}
          {custom === 'nth' && (
            <>
              <div className="chips">
                {NTHS.map(([n, label]) => (
                  <Chip key={n} on={c.nth === n} onClick={() => set({ nth: n })}>
                    {label}
                  </Chip>
                ))}
              </div>
              <div className="chips">
                {WEEK.map(([d, label]) => (
                  <Chip key={d} on={c.nthDay === d} onClick={() => set({ nthDay: d })}>
                    {label}
                  </Chip>
                ))}
              </div>
              <div className="chips">
                {OFFSETS.map(([o, label]) => (
                  <Chip key={o} on={c.offset === o} className="chip--ghost" onClick={() => set({ offset: o })}>
                    {label}
                  </Chip>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
