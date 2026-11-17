// The photo frame: slideshow with the clock, date, weather and next event over it. Shared by the
// idle photo frame (ambient mode) and the Photos preview, so the preview shows exactly what idle will.
import type { Ref } from 'react';
import { useData } from '../data/store';
import { useEvents } from '../data/hooks';
import { countdowns, evLabel, nextEvent, weatherNow } from '../data/select';
import { fmt } from '../lib/fmt';
import { useNow } from '../lib/clock';
import { Icon } from '../ui/Icon';
import { CountdownChip } from '../ui/CountdownChip';
import { eventStyle } from '../ui/people';
import { usePixelShift } from '../ui/hooks';
import { Slideshow, type SlideshowHandle } from './Slideshow';
import css from './PhotoFrame.module.css';

const FRAME_INTERVAL = 10000;

export function PhotoFrame({ active, showCountdowns, slideshowRef }: {
  active: boolean;
  /** Countdown chips along the bottom (idle only) */
  showCountdowns?: boolean;
  slideshowRef?: Ref<SlideshowHandle>;
}) {
  const data = useData();
  const events = useEvents();
  const now = useNow();
  const shift = usePixelShift(active, now);
  const w = weatherNow(data, events, now);
  const next = nextEvent(events, now);
  const cds = showCountdowns ? countdowns(events, now) : [];
  return (
    <div className={css.frame + (cds.length ? ' ' + css.hasCds : '')}>
      <div className={css.stage}>
        <Slideshow ref={slideshowRef} interval={FRAME_INTERVAL} active={active} />
      </div>
      <div className={css.scrim} />
      {active && (
        <>
          <div className={css.info} style={shift}>
            <div>
              <div className={css.time + ' num display-num'}>{fmt.time(now, false)}</div>
              <div className={css.date}>{fmt.day(now)}, {fmt.month(now)} {now.getDate()}</div>
            </div>
            <div className={css.right}>
              {w && (
                <div className={css.wx}>
                  <div className={css.wxNow}>
                    <Icon name={w.cond} size={44} />
                    <span className="num display-num">{w.temp}°</span>
                  </div>
                  <small>{w.summary}</small>
                </div>
              )}
              {next && (
                <div className={css.next} style={eventStyle(data, next)}>
                  <i />
                  {evLabel(next)} · {fmt.time(next.start)}
                </div>
              )}
            </div>
          </div>
          {cds.length > 0 && (
            <div className={css.cds} style={shift}>
              {cds.map((e) => (
                <CountdownChip key={e.id} e={e} glass className={css.cd} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
