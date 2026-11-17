// The hidden demo drawer (hold the sidebar clock, or press D) + keyboard shortcuts.
// TODO before deploying to the frame: remove or gate behind ?demo (kept for troubleshooting).
import { useEffect } from 'react';
import { fmt } from '../lib/fmt';
import { setDemoTime, useNow } from '../lib/clock';
import type { CalMode } from '../data/select';
import { Icon } from '../ui/Icon';
import { VIEWS, closeSheet, go, setCalMode, setDemoOpen, setFastIdle, setMode, ui, useUI } from './ui';
import css from './Demo.module.css';

const TIMES: [number, number, string][] = [[7, 10, '7:10 AM'], [15, 18, '3:18 PM'], [19, 45, '7:45 PM'], [23, 40, '11:40 PM']];
const CAL_MODES: [CalMode, string][] = [['normal', 'Normal day'], ['empty', 'Empty day'], ['busy', 'Overloaded']];

export function Demo() {
  const open = useUI((s) => s.demoOpen);
  const calMode = useUI((s) => s.calMode);
  const fast = useUI((s) => s.idleAfter < 120);
  const now = useNow();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'd') setDemoOpen(!ui.get().demoOpen);
      if (k === 'a') setMode('ambient');
      if (k === 'n') setMode('night');
      if (k === 'escape') { setDemoOpen(false); closeSheet(); }
      if (k >= '1' && k <= String(VIEWS.length)) go(VIEWS[+k - 1]);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const close = () => setDemoOpen(false);
  return (
    <div className={css.demo + (open ? ' ' + css.isOpen : '')} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      {open && (
        <div className={css.panel}>
          <div className={css.head}>
            <div>
              <div className="label label--light">Prototype</div>
              <h2>Demo controls</h2>
            </div>
            <button className={css.close} onClick={close}>
              <Icon name="x" size={28} />
            </button>
          </div>
          <div className={css.sec}>
            <div className="label label--light">Time of day · now {fmt.time(now)}</div>
            <div className={css.grid}>
              {TIMES.map(([h, m, label]) => (
                <button key={label} onClick={() => setDemoTime(h, m)}>{label}</button>
              ))}
              <button onClick={() => setDemoTime(null)}>Real time</button>
            </div>
          </div>
          <div className={css.sec}>
            <div className="label label--light">Modes</div>
            <div className={css.grid}>
              <button onClick={() => { close(); setMode('ambient'); }}>Ambient</button>
              <button onClick={() => { close(); setMode('night'); }}>Night</button>
              <button onClick={() => setFastIdle(!fast)}>{fast ? 'Idle: fast ✓' : 'Idle: fast'}</button>
            </div>
          </div>
          <div className={css.sec}>
            <div className="label label--light">Calendar data</div>
            <div className={css.grid}>
              {CAL_MODES.map(([m, label]) => (
                <button key={m} className={calMode === m ? css.isOn : ''} onClick={() => setCalMode(m)}>{label}</button>
              ))}
            </div>
          </div>
          <p className={css.note}>
            Keyboard: <b>D</b> demo · <b>A</b> ambient · <b>N</b> night · <b>1–{VIEWS.length}</b> views
          </p>
        </div>
      )}
    </div>
  );
}
