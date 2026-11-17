// Weather details: opened by tapping the weather on Today. Current conditions, the next 12 hours,
// today + 3 days, and sun / moon / wind / humidity tiles.
import { useRef, type ReactNode } from 'react';
import type { WxCond } from '../data/types';
import { useData } from '../data/store';
import { useEvents } from '../data/hooks';
import { WX_LABELS, hourly, weatherNow, type WeatherData } from '../data/select';
import { addDays, atTime, daysBetween, minutesBetween } from '../lib/dates';
import { fmt } from '../lib/fmt';
import { useNow } from '../lib/clock';
import { openSheet } from '../app/ui';
import { Icon } from '../ui/Icon';
import { useEdgeFade } from '../ui/hooks';
import css from './WeatherSheet.module.css';

export function openWeatherSheet(): void {
  openSheet(() => <WeatherSheet />, { cls: 'sheet--wide ' + css.sheet });
}

function WeatherSheet() {
  const data = useData('weather');
  const now = useNow();
  const w = weatherNow(data, useEvents(), now);
  const W = data.weather;
  if (!w || !W) return null;
  return (
    <div className={css.wx + ' sheet-pad'}>
      <div className="label">Weather · {W.place}</div>
      <header className={css.head}>
        <span className={css.icon}>
          <Icon name={w.cond} size={72} />
        </span>
        <span className={css.temp}>{w.temp}°</span>
        <span className={css.meta}>
          <b>{WX_LABELS[w.cond]}</b>
          <span>
            {/* kept in pieces that don't break apart */}
            <span className={css.nowrap}>Feels like {w.feels}°</span> ·{' '}
            <span className={css.nowrap}>
              H {W.hi}° L {W.lo}°
            </span>
          </span>
        </span>
      </header>
      <p className={css.say}>
        <b>{w.summary}.</b> {w.advice}.
      </p>
      <section className={css.sec}>
        <div className="label">Next 12 hours</div>
        <Hours data={data} now={now} />
      </section>
      <div className={css.cols}>
        <section className={css.sec}>
          <div className="label">Next few days</div>
          <Days data={data} now={now} todayCond={w.cond} />
        </section>
        <section className={css.tiles}>
          <SunTile data={data} now={now} />
          <MoonTile data={data} now={now} />
          <StatTile label="Wind" value={W.wind} unit="mph" sub={`${W.windDir} · gusts ${W.gust} mph`} />
          <StatTile
            label="Humidity"
            value={W.humidity}
            unit="%"
            sub={`Dew point ${W.dew}° · UV ${W.uv} (${uvLabel(W.uv)})`}
          />
        </section>
      </div>
    </div>
  );
}

function Hours({ data, now }: { data: WeatherData; now: Date }) {
  const list = hourly(data, now, 12);
  // Room for rain chances only when there are some
  const wet = list.some((h) => h.p >= 20);
  // On a phone the hours scroll sideways; the edges fade where there's more
  const row = useRef<HTMLDivElement>(null);
  useEdgeFade(row, list.length);
  return (
    <div className={css.hours + ' surface'} ref={row}>
      {list.map((h) => {
        return (
          <div key={h.label} className={css.hr + (h.p >= 50 ? ' ' + css.isWet : '')}>
            <span className={css.hrLabel}>{h.label}</span>
            <span className={css.hrIcon}>
              <Icon name={h.c} size={24} />
            </span>
            <b>{h.t}°</b>
            {wet && <small>{h.p >= 20 ? h.p + '%' : ''}</small>}
          </div>
        );
      })}
    </div>
  );
}

function Days({ data, now, todayCond }: { data: WeatherData; now: Date; todayCond: WxCond }) {
  const W = data.weather!; // the sheet only opens once it has loaded
  const todayP = Math.max(...W.p.slice(now.getHours()));
  const rows = [
    { d: 0, c: todayP >= 50 ? 'rain' : todayCond, hi: W.hi, lo: W.lo, p: todayP },
    ...W.daily.filter((r) => r.d >= 1 && r.d <= 3),
  ];
  const lo = Math.min(...rows.map((r) => r.lo)),
    hi = Math.max(...rows.map((r) => r.hi));
  return (
    <div className={css.days}>
      {rows.map((r) => (
        <div key={r.d} className={css.day}>
          <b className={css.dayName}>{r.d === 0 ? 'Today' : r.d === 1 ? 'Tomorrow' : fmt.day(addDays(now, r.d))}</b>
          <span className={css.dayIcon + (r.p >= 50 ? ' ' + css.isWet : '')}>
            <Icon name={r.c} size={24} />
          </span>
          <span className={css.dayRain}>{r.p >= 20 ? r.p + '%' : ''}</span>
          <span className={css.dayLo}>{r.lo}°</span>
          <span className={css.bar}>
            <i
              style={{ left: ((r.lo - lo) / (hi - lo)) * 100 + '%', width: ((r.hi - r.lo) / (hi - lo)) * 100 + '%' }}
            />
          </span>
          <span className={css.dayHi}>{r.hi}°</span>
        </div>
      ))}
    </div>
  );
}

function Times({ a, b }: { a: [string, Date]; b: [string, Date] }) {
  return (
    <div className={css.sunTimes}>
      {[a, b].map(([label, t]) => (
        <span key={label}>
          <small>{label}</small>
          <b>{fmt.time(t)}</b>
        </span>
      ))}
    </div>
  );
}

/** Sun position along a half-circle arc between sunrise and sunset */
function SunTile({ data, now }: { data: WeatherData; now: Date }) {
  const rise = atTime(data.weather!.sunrise, now),
    set = atTime(data.weather!.sunset, now);
  const t = Math.max(0, Math.min(1, (now.getTime() - rise.getTime()) / (set.getTime() - rise.getTime())));
  const up = now >= rise && now <= set;
  const a = Math.PI * (1 - t);
  const x = (70 + 56 * Math.cos(a)).toFixed(1),
    y = (62 - 56 * Math.sin(a)).toFixed(1);
  const daylight = Math.round(minutesBetween(rise, set));
  return (
    <div className={css.tile + ' surface'}>
      <div className="label">Sun</div>
      <svg className={css.arc} viewBox="0 0 140 66" aria-hidden="true">
        <path d="M14 62 A56 56 0 0 1 126 62" className={css.arcTrack} />
        <path d={`M14 62 A56 56 0 0 1 ${x} ${y}`} className={css.arcDone} />
        <line x1="4" y1="62" x2="136" y2="62" className={css.arcHorizon} />
        <circle cx={x} cy={y} r="7" className={css.arcSun + (up ? '' : ' ' + css.isDown)} />
      </svg>
      <Times a={['Sunrise', rise]} b={['Sunset', set]} />
      <div className={css.tileSub}>
        {Math.floor(daylight / 60)} hr {daylight % 60} min of daylight
      </div>
    </div>
  );
}

/** Lit part of the moon: outer half-circle on the lit side + an elliptical terminator */
function MoonTile({ data, now }: { data: WeatherData; now: Date }) {
  const M = data.weather!.moon;
  const r = 26,
    f = M.lit / 100,
    rx = Math.abs(1 - 2 * f) * r;
  const d = `M30 ${30 - r} A${r} ${r} 0 0 1 30 ${30 + r} A${rx.toFixed(2)} ${r} 0 0 ${f < 0.5 ? 0 : 1} 30 ${30 - r} Z`;
  return (
    <div className={css.tile + ' surface'}>
      <div className="label">Moon</div>
      <div className={css.moonRow}>
        <svg className={css.moon} viewBox="0 0 60 60" aria-hidden="true">
          <circle cx="30" cy="30" r={r} className={css.moonDark} />
          <path d={d} className={css.moonLit} transform={M.waxing ? undefined : 'matrix(-1 0 0 1 60 0)'} />
        </svg>
        <span>
          <b>{M.phase}</b>
          <small>{M.lit}% lit</small>
        </span>
      </div>
      <div className={css.sunTimes}>
        {[
          ['Full moon', M.full],
          ['New moon', M.new],
        ].map(([label, day]) => (
          <span key={label}>
            <small>{label}</small>
            <b>{moonDay(day, now)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/** UV index in words (WHO scale) */
const uvLabel = (uv: number) =>
  uv < 3 ? 'low' : uv < 6 ? 'moderate' : uv < 8 ? 'high' : uv < 11 ? 'very high' : 'extreme';

/** 'YYYY-MM-DD' → "Today", "Tomorrow", or "Tue, Nov 24" */
function moonDay(day: string, now: Date): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const n = daysBetween(now, date);
  // "Nov 24": the weekday isn't much use for the moon, and two of these share half a card on a phone
  return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : fmt.monthShort(date) + ' ' + d;
}

function StatTile({ label, value, unit, sub }: { label: string; value: ReactNode; unit: string; sub: string }) {
  return (
    <div className={css.tile + ' surface'}>
      <div className="label">{label}</div>
      <div className={css.stat}>
        <b>{value}</b>
        <small>{unit}</small>
      </div>
      <div className={css.tileSub}>{sub}</div>
    </div>
  );
}
