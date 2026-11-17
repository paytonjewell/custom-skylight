#!/usr/bin/env node
// npm run frame:sweep -- [phone|frame] [theme]
// Layout check for the local dashboard: opens every screen and every sheet that can be opened without
// changing anything, in headless Chrome 124 (the frame's WebView version), and reports text that
// spills out of its card or pill, runs into other text or an icon, button and chip labels that wrap
// onto a second line, and anything wider than the screen. Screenshots of the cases with problems go to
// .frame-chrome/sweep/. Run both layouts after UI changes; the dev server must be running.
// It never taps tasks, habits, grocery items or anything else that would change data.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, '.frame-chrome');
const [layout = 'phone', theme = 'pastel'] = process.argv.slice(2);
const phone = layout === 'phone';
const OUT = join(DIR, 'sweep');
mkdirSync(OUT, { recursive: true });
const UA = phone
  ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'
  : 'Mozilla/5.0 (Linux; Android 15; tb8786p1_64_k66_wifi Build/AY7222B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.219 Safari/537.36';
const BASE = phone ? 'http://localhost:5173/?fit' : 'http://localhost:5173/';
const [W, H] = phone ? [390, 844] : [1280, 720];

// Helpers available to each case's `open` code
const HELPERS = `
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const vis = (el) => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const view = () => document.querySelector('.' + [...document.querySelectorAll('[id^=view-]')].find(v => getComputedStyle(v).contentVisibility !== 'hidden')?.className.split(' ')[0]) && [...document.querySelectorAll('[id^=view-]')].find(v => getComputedStyle(v).contentVisibility !== 'hidden');
  const byText = (sel, text, root = document) => [...root.querySelectorAll(sel)].find(b => vis(b) && b.textContent.trim().startsWith(text));
  const byLabel = (label) => [...document.querySelectorAll('[aria-label]')].find(b => vis(b) && b.getAttribute('aria-label').startsWith(label));
  const tap = async (el) => { if (!el) throw new Error('not found'); el.scrollIntoView({ block: 'center' }); el.click(); await wait(900); };
`;

// Each case: a screen, then (optionally) taps that only open things
const CASES = [
  ['home', 'home', ''],
  ['calendar-day', 'calendar', ''],
  ['calendar-3day', 'calendar', `await tap(byText('.seg button', '3 Day'))`],
  ['calendar-week', 'calendar', `await tap(byText('.seg button', 'Week'))`],
  ['calendar-month', 'calendar', `await tap(byText('.seg button', 'Month'))`],
  ['tasks', 'tasks', ''],
  ['tasks-habits', 'tasks', `await tap(byLabel('Habits'))`],
  ['tasks-all', 'tasks', `await tap(byLabel('All tasks'))`],
  ['lists', 'lists', ''],
  ['grocery-list', 'lists', `await tap(byText('button', '🛒') || byText('button', 'Groceries'))`],
  [
    'kitchen-recipes',
    'kitchen',
    `localStorage.setItem('kitchen.tab','recipes'); await tap(byText('[role=tab]', 'Recipes'))`,
  ],
  ['kitchen-inventory', 'kitchen', `await tap(byText('[role=tab]', 'Inventory'))`],
  ['kitchen-shopping', 'kitchen', `await tap(byText('[role=tab]', 'Shopping'))`],
  ['news', 'news', ''],
  ['photos', 'photos', ''],
  // sheets
  ['sheet-weather', 'home', `await tap(byLabel('Weather details'))`],
  [
    'sheet-theme',
    'home',
    `await tap(byLabel('Choose a colour theme') || [...document.querySelectorAll('nav button, [class*=rail] button')].find(b => vis(b) && /^(Pastel|Earth|Nordic|Dark|Glass)$/.test(b.textContent.trim())))`,
  ],
  ['sheet-verse', 'home', `await tap(byText('button', 'Verse of the day'))`],
  [
    'sheet-plan-dinner',
    'home',
    `await tap([...document.querySelectorAll('button')].find(b => vis(b) && b.textContent.includes('Tonight')))`,
  ],
  [
    'sheet-person-tasks',
    'home',
    `await tap([...document.querySelectorAll('#view-home button[class*=ring]')].find(b => vis(b) && b.textContent.includes('Payton')))`,
  ],
  ['sheet-task-settings', 'tasks', `await tap(byLabel('Task settings'))`],
  ['sheet-new-task', 'tasks', `await tap(byLabel('New task') || byText('button', 'New task'))`],
  ['sheet-add-event', 'calendar', `await tap(byLabel('Add event'))`],
  ['sheet-calendar-settings', 'calendar', `await tap(byLabel('Calendar settings'))`],
  [
    'sheet-event',
    'calendar',
    `await tap(byText('.seg button', 'Week')); const e = [...document.querySelectorAll('#view-calendar button')].find(b => vis(b) && /Birthday|Iowa|Doctor/.test(b.textContent)); await tap(e)`,
  ],
  [
    'sheet-news-story',
    'news',
    `await tap([...document.querySelectorAll('#view-news button')].find(b => vis(b) && b.textContent.length > 40))`,
  ],
  [
    'sheet-recipe',
    'kitchen',
    `await tap(byText('[role=tab]', 'Recipes')); await tap([...document.querySelectorAll('#view-kitchen button')].find(b => vis(b) && b.textContent.includes('Beef Chili') && b.textContent.includes('min')))`,
  ],
  ['sheet-photo', 'photos', `await tap([...document.querySelectorAll('#view-photos [class*=tile]')].find(vis))`],
  [
    'sheet-inventory-item',
    'kitchen',
    `await tap(byText('[role=tab]', 'Inventory')); await tap([...document.querySelectorAll('#view-kitchen [class*=rowMain]')].find(vis))`,
  ],
];

// Runs in the page: text that pokes out of the nearest box around it, with nothing clipping it on the
// way; and anything wider than the screen
const DETECT = `(() => {
  const out = [];
  const W = document.documentElement.clientWidth;
  const isBox = (el) => { const cs = getComputedStyle(el); const full = ['Top','Right','Bottom','Left'].every((s) => cs['border' + s + 'Width'] !== '0px'); return el.tagName === 'BUTTON' || cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.boxShadow !== 'none' || full; };
  const H = document.documentElement.clientHeight; const seen = new Set(); const rects = [];
  const clips = (el) => { const cs = getComputedStyle(el); return cs.overflowX !== 'visible' || cs.overflow !== 'visible'; };
  const root = document.querySelector('.sheet-layer.is-open .sheet') || [...document.querySelectorAll('[id^=view-]')].find(v => getComputedStyle(v).contentVisibility !== 'hidden') || document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.textContent.trim() ? 1 : 3 });
  for (let n; (n = walker.nextNode()); ) {
    const el = n.parentElement;
    if (!el || !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
    const r = document.createRange(); r.selectNodeContents(n);
    const t = r.getBoundingClientRect();
    if (!t.width) continue;
    // a neighbouring page of a pager, or scrolled far away: not on screen
    if (t.right < 0 || t.left > W) continue;
    // Walk up to the nearest box; stop if something on the way clips (ellipsis, a scroll row)
    let box = null, clipped = false;
    for (let a = el; a && a !== root.parentElement; a = a.parentElement) {
      if (a !== el && isBox(a)) { if (clips(a)) clipped = true; else box = a; break; }
      if (clips(a)) { clipped = true; break; }
    }
    // Each line of the text, trimmed to its element's box: a font's line box can be taller than the
    // line height the element gives it (big Fraunces titles), and that extra isn't drawn
    if (!clipped && !el.closest('.sheet-actions')) {
      const eb = el.getBoundingClientRect();
      // and to everything above it that clips (a sideways-scrolling row hides what's scrolled away)
      let cl = { left: -1e9, right: 1e9, top: -1e9, bottom: 1e9 };
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (!clips(a)) continue;
        const ar = a.getBoundingClientRect();
        cl = { left: Math.max(cl.left, ar.left), right: Math.min(cl.right, ar.right), top: Math.max(cl.top, ar.top), bottom: Math.min(cl.bottom, ar.bottom) };
      }
      for (const lr of r.getClientRects()) {
        const top = Math.max(lr.top, eb.top, cl.top), bottom = Math.min(lr.bottom, eb.bottom, cl.bottom);
        const left = Math.max(lr.left, cl.left), right = Math.min(lr.right, cl.right);
        if (bottom > top && right > left) rects.push({ t: { left, right, top, bottom, height: bottom - top }, el, text: n.textContent.trim() });
      }
    }
    if (clipped) continue;
    if (box) {
      const b = box.getBoundingClientRect(), cs = getComputedStyle(box);
      const pl = parseFloat(cs.paddingLeft) * 0, pr = 0;
      if (t.left < b.left - 2 || t.right > b.right + 2)
      { const k = n.textContent.trim() + '|' + box.className; if (!seen.has(k)) { seen.add(k); out.push({ text: n.textContent.trim().slice(0, 40), by: Math.round(Math.max(b.left - t.left, t.right - b.right)), box: (box.className && String(box.className).slice(0, 50)) || box.tagName }); } }
    }
    if (t.right > W + 1 || t.left < -1) {
      // past the screen edge, not inside something that scrolls sideways
      let scrolls = false;
      for (let a = el; a; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflowX === 'hidden' || cs.overflow === 'hidden') { scrolls = true; break; } }
      if (!scrolls) out.push({ text: n.textContent.trim().slice(0, 40), by: Math.round(t.right - W), box: 'SCREEN EDGE' });
    }
  }
  // Text running into an icon that isn't part of it (a name into the arrows beside it)
  const bar0 = document.querySelector('.sheet-layer.is-open .sheet-actions')?.getBoundingClientRect();
  for (const ic of root.querySelectorAll('svg')) {
    if (!ic.getClientRects().length || getComputedStyle(ic).visibility === 'hidden') continue;
    let ir = ic.getBoundingClientRect();
    // trimmed to whatever clips it (an off-screen pager page, a scrolled row)
    for (let a = ic.parentElement; a && a !== document.body; a = a.parentElement) {
      if (!clips(a)) continue;
      const ar = a.getBoundingClientRect();
      ir = { left: Math.max(ir.left, ar.left), right: Math.min(ir.right, ar.right), top: Math.max(ir.top, ar.top), bottom: Math.min(ir.bottom, ar.bottom) };
    }
    ir.height = ir.bottom - ir.top;
    if (ir.right <= ir.left || ir.bottom <= ir.top) continue;
    if (ir.right < 0 || ir.left > W || (bar0 && ir.bottom > bar0.top && !ic.closest('.sheet-actions'))) continue;
    for (const a of rects) {
      if (bar0 && a.t.bottom > bar0.top) continue;
      if (a.el.contains(ic) || ic.contains(a.el) || a.el.closest('button') && a.el.closest('button') === ic.closest('button')) continue;
      const x = Math.min(a.t.right, ir.right) - Math.max(a.t.left, ir.left), y = Math.min(a.t.bottom, ir.bottom) - Math.max(a.t.top, ir.top);
      if (x > 2 && y > 0.4 * Math.min(a.t.height, ir.height)) { const k = a.text + '×icon'; if (!seen.has(k)) { seen.add(k); out.push({ text: a.text.slice(0, 30) + '" runs into an icon', by: Math.round(x), box: 'ICON OVERLAP (' + (ic.parentElement.className.baseVal ?? ic.parentElement.className).toString().slice(0, 40) + ' / ' + (ic.getAttribute('class') || '') + ')' }); } }
    }
  }
  // A button, chip or tab whose label wraps onto a second line
  for (const b of root.querySelectorAll('.btn, .chip, .seg button, [role=tab]')) {
    if (!b.getClientRects().length) continue;
    const br = b.getBoundingClientRect(); if (br.right < 0 || br.left > W) continue;
    const tw = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    for (let n; (n = tw.nextNode()); ) {
      if (!n.textContent.trim()) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      const tops = new Set([...rg.getClientRects()].map((q) => Math.round(q.top)));
      if (tops.size > 1) { const k = n.textContent.trim() + '×wrap'; if (!seen.has(k)) { seen.add(k); out.push({ text: n.textContent.trim().slice(0, 30) + '" wraps onto ' + tops.size + ' lines', by: 0, box: 'WRAPPED LABEL' }); } }
    }
  }
  // Two pieces of text drawn over each other (e.g. a name running into the controls beside it)
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
    // hidden under the sticky actions bar: not a real collision
    const bar = document.querySelector('.sheet-layer.is-open .sheet-actions')?.getBoundingClientRect();
    if (bar && (a.t.bottom > bar.top || b.t.bottom > bar.top)) continue;
    const x = Math.min(a.t.right, b.t.right) - Math.max(a.t.left, b.t.left), y = Math.min(a.t.bottom, b.t.bottom) - Math.max(a.t.top, b.t.top);
    if (x > 2 && y > 0.4 * Math.min(a.t.height, b.t.height)) { const k = a.text + '×' + b.text; if (!seen.has(k)) { seen.add(k); out.push({ text: a.text.slice(0, 30) + '" overlaps "' + b.text.slice(0, 30), by: Math.round(x), box: 'OVERLAP' }); } }
  }
  if (document.documentElement.scrollWidth > W + 1) out.push({ text: '(page)', by: document.documentElement.scrollWidth - W, box: 'PAGE SCROLLS SIDEWAYS' });
  return out;
})()`;

const found = execFileSync(
  'find',
  [join(DIR, 'chrome'), '-name', 'Google Chrome for Testing', '-type', 'f', '-perm', '+111'],
  { encoding: 'utf8' },
)
  .split('\n')
  .find((p) => p.includes('/MacOS/'));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(
  found,
  [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + join(DIR, 'shot-profile'),
    '--user-agent=' + UA,
    `--window-size=${W},${H}`,
    '--hide-scrollbars',
    '--no-first-run',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    target = await fetch(`http://127.0.0.1:${port}/json`)
      .then((r) => r.json())
      .then((t) => t.find((x) => x.type === 'page'))
      .catch(() => null);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const evalJs = async (expression) => {
    const r = (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result;
    if (r?.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] ?? r.exceptionDetails.text);
    return r?.result?.value;
  };
  await send('Emulation.setDeviceMetricsOverride', {
    width: W,
    height: H,
    deviceScaleFactor: phone ? 2 : 1.5,
    mobile: phone,
  });
  if (phone) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setUserAgentOverride', { userAgent: UA });
  await send('Page.navigate', { url: BASE });
  await sleep(2500);
  if (await evalJs(`!!document.querySelector('form[action="/signin"]')`)) {
    const pin = /^DASHBOARD_PIN=["']?([^"'\n]*)/m.exec(readFileSync(join(ROOT, '.dev.vars'), 'utf8'))?.[1];
    await evalJs(
      `(() => { document.getElementById('pin').value = ${JSON.stringify(pin)}; document.querySelector('form[action="/signin"]').submit(); })()`,
    );
    await sleep(2500);
  }
  await evalJs(
    `localStorage.setItem('theme', ${JSON.stringify(theme)}); localStorage.setItem('themeApplied', ${JSON.stringify(theme)}); localStorage.removeItem('news.order')`,
  );
  let problems = 0;
  for (const [name, v, open] of CASES) {
    await send('Page.navigate', { url: BASE + '#' + v });
    await sleep(1800);
    await send('Page.reload', {});
    await sleep(2200);
    let res;
    try {
      if (open) await evalJs(`(async () => { ${HELPERS} ${open} })()`);
      await sleep(400);
      res = await evalJs(DETECT);
    } catch (e) {
      console.log(`?? ${name}: couldn't open (${e.message})`);
      continue;
    }
    if (res.length) {
      problems += res.length;
      console.log(`✗ ${name}`);
      for (const p of res) console.log(`    "${p.text}" spills ${p.by}px out of ${p.box}`);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(OUT, `${layout}-${name}.png`), Buffer.from(shot.result.data, 'base64'));
    } else console.log(`✓ ${name}`);
  }
  console.log(`\n${layout}: ${problems} problem(s)${problems ? ' (screenshots in .frame-chrome/sweep/)' : ''}`);
  process.exitCode = problems ? 1 : 0;
  ws.close();
} finally {
  chrome.kill();
}
