import { useData } from '../data/store';
import { atTime } from '../lib/dates';
import { fmt } from '../lib/fmt';
import { useNow } from '../lib/clock';
import { Icon } from '../ui/Icon';
import { SheetHeader } from '../ui/headers';
import { openSheet } from './ui';
import { THEMES, setAutoDark, setThemeChoice, useThemeSettings, type ThemeName } from './theme';
import css from './ThemeSheet.module.css';

export function openThemeSheet(): void {
  openSheet(() => <ThemeSheet />, { cls: 'sheet--wide' });
}

/** Theme picker: live previews of each theme (theme tokens apply to any element with data-theme) */
function ThemeSheet() {
  const { choice, autoDark } = useThemeSettings();
  const W = useData().weather;
  const now = useNow();
  return (
    <div className="sheet-pad">
      <SheetHeader kicker="Appearance" title="Theme" />
      <div className={css.grid}>
        {(Object.keys(THEMES) as ThemeName[]).map((k) => (
          <button key={k} className={css.card + (k === choice ? ' ' + css.isOn : '')} onClick={() => setThemeChoice(k)}>
            <span className={css.prev} data-theme={k}>
              <span className={css.panel}>
                <span className={css.title} />
                <span className={css.dots}>
                  {[1, 2, 3, 4, 0].map((i) => (
                    <i key={i} style={{ background: `var(--t${i})` }} />
                  ))}
                </span>
                <span className={css.row} />
                <span className={css.row + ' ' + css.rowShort} />
              </span>
            </span>
            <span className={css.name + ' serif'}>
              {THEMES[k].label}
              {k === choice && <Icon name="check" size={18} />}
            </span>
            <span className={css.blurb}>{THEMES[k].blurb}</span>
          </button>
        ))}
      </div>
      <button className={css.auto + ' surface' + (autoDark ? ' ' + css.isOn : '')} role="switch" aria-checked={autoDark} onClick={() => setAutoDark(!autoDark)}>
        <Icon name="moon" size={24} />
        <span>
          <b>Dark after sunset</b>
          <small>
            Switches to Dark from sunset ({W ? fmt.time(atTime(W.sunset, now)) : '7 PM'}) to sunrise ({W ? fmt.time(atTime(W.sunrise, now)) : '7 AM'})
          </small>
        </span>
        <i className={css.switch} />
      </button>
    </div>
  );
}
