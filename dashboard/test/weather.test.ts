// Tests for worker/weather.ts (Open-Meteo → our weather, the moon, Bible Gateway's text) and the
// Today screen's weather lines (src/data/select.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { condition, moon, plainVerse, toWeather } from '../worker/weather.ts';
import { hourly, weatherNow } from '../src/data/select.ts';
import type { Data, Weather } from '../src/data/types.ts';

test('weather codes become conditions', () => {
  assert.equal(condition(0, true), 'sun');
  assert.equal(condition(1, false), 'moon');
  assert.equal(condition(2, true), 'partly');
  assert.equal(condition(3, true), 'cloud');
  assert.equal(condition(45, true), 'fog');
  assert.equal(condition(61, true), 'rain');
  assert.equal(condition(66, true), 'rain'); // freezing rain
  assert.equal(condition(73, true), 'snow');
  assert.equal(condition(86, true), 'snow');
  assert.equal(condition(95, true), 'storm');
});

test('the moon: phase, light and the next full and new moons', () => {
  // Full moon Nov 24 2026 (about 8:53 AM Central), new moon Dec 9
  const m = moon(new Date('2026-11-16T16:00:00Z'));
  assert.equal(m.phase, 'First quarter'); // new moon was Nov 9
  assert.ok(m.waxing);
  assert.ok(m.lit > 40 && m.lit < 70, String(m.lit));
  assert.equal(m.full, '2026-11-24');
  assert.equal(m.new, '2026-12-09');
  const full = moon(new Date('2026-11-24T15:00:00Z'));
  assert.equal(full.phase, 'Full moon');
  assert.ok(full.lit >= 99);
});

test('Bible Gateway text becomes plain text', () => {
  assert.equal(
    plainVerse('&ldquo;Open my eyes to see the wonderful truths in your instructions.&rdquo;'),
    'Open my eyes to see the wonderful truths in your instructions.',
  );
  assert.equal(
    plainVerse('[16] For God loved the world so much &#8212; he gave <i>his</i> one and only Son'),
    'For God loved the world so much — he gave his one and only Son',
  );
  assert.equal(
    plainVerse('The LORD is my shepherd; I have all that I need.'),
    'The LORD is my shepherd; I have all that I need.',
  );
});

/** Open-Meteo's answer for Nov 16 2026: 48 hours from midnight, rain from 4 PM */
function sample() {
  const hours = Array.from({ length: 120 }, (_, i) => i);
  const day = (i: number) => `2026-11-${16 + Math.floor(i / 24)}T${String(i % 24).padStart(2, '0')}:00`;
  return {
    current: {
      time: '2026-11-16T10:15',
      temperature_2m: 38.4,
      apparent_temperature: 30.5,
      relative_humidity_2m: 76,
      dew_point_2m: 31.5,
      wind_speed_10m: 9.5,
      wind_gusts_10m: 19.2,
      wind_direction_10m: 232,
      weather_code: 0,
      is_day: 1,
    },
    hourly: {
      time: hours.map(day),
      temperature_2m: hours.map((i) => 30 + (i % 24)),
      weather_code: hours.map((i) => (i >= 16 && i < 20 ? 61 : 0)),
      precipitation_probability: hours.map((i) => (i >= 16 && i < 20 ? 80 : null)),
      is_day: hours.map((i) => (i % 24 >= 7 && i % 24 < 17 ? 1 : 0)),
    },
    daily: {
      time: ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'],
      weather_code: [61, 3, 73, 0, 0],
      temperature_2m_max: [49.5, 52.8, 33, 30, 31],
      temperature_2m_min: [22.6, 31.6, 25, 20, 21],
      precipitation_probability_max: [80, 10, 60, 0, null],
      sunrise: ['2026-11-16T06:53'],
      sunset: ['2026-11-16T16:27'],
      uv_index_max: [2.3, 2, 1, 1, 1],
    },
  };
}

test('Open-Meteo’s answer becomes our weather', () => {
  const w = toWeather(sample() as never, new Date('2026-11-16T16:15:00Z'), {
    name: 'Springfield',
    tz: 'America/Chicago',
  });
  assert.equal(w.place, 'Springfield');
  assert.equal(w.day, '2026-11-16');
  assert.deepEqual(w.now, { t: 38, c: 'sun', feels: 31 });
  assert.equal(w.hi, 50); // 49.5 rounds up
  assert.equal(w.lo, 23);
  assert.equal(w.windDir, 'SW');
  assert.equal(w.sunrise, '06:53');
  assert.equal(w.t.length, 48);
  assert.equal(w.c[3], 'moon'); // 3 AM, clear
  assert.equal(w.p[3], 0); // no chance given → 0
  assert.equal(w.c[16], 'rain');
  assert.deepEqual(
    w.daily.map((d) => d.c),
    ['rain', 'cloud', 'snow', 'sun', 'sun'],
  );
  const low = sample();
  low.daily.precipitation_probability_max[2] = 5;
  assert.equal(toWeather(low as never, new Date()).daily[2].c, 'cloud'); // snow at 5%: cloudy
});

test('Today’s weather line: now, rain later, and the hours ahead', () => {
  const weather: Weather = toWeather(sample() as never, new Date('2026-11-16T16:15:00Z'));
  const d = { weather } as Data;
  const at10 = new Date(2026, 10, 16, 10, 20);
  const fresh = { ...weather, updated: at10.toISOString() };
  const w = weatherNow({ weather: fresh } as Data, [], at10);
  assert.equal(w.temp, 38); // current conditions
  assert.equal(w.summary, 'Rain from 4 PM');
  assert.equal(w.advice, 'Grab a rain jacket');
  // Old data: this hour's forecast instead
  assert.equal(weatherNow(d, [], new Date(2026, 10, 16, 12, 5)).temp, 42);
  // In the rain
  assert.equal(weatherNow(d, [], new Date(2026, 10, 16, 17, 0)).summary, 'Rain until 8 PM');
  // The next 12 hours run into tomorrow (not back to this morning)
  const h = hourly(d, new Date(2026, 10, 16, 22, 0), 4);
  assert.deepEqual(
    h.map((x) => x.label),
    ['Now', '11p', '12a', '1a'],
  );
  assert.deepEqual(
    h.map((x) => x.t),
    [52, 53, 30, 31],
  );
});
