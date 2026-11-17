#!/usr/bin/env node
// npm run frame:shot -- [out.png] [#screen] [--js "<code run before the shot>"]
// Screenshot of the local dashboard as the frame draws it: headless Chrome 124 (the frame's WebView
// version) posing as the kiosk at 1280×720. For checking frame-only layout bugs without the frame.
// Signs in to the local dev server with DASHBOARD_PIN from .dev.vars the first time (its own profile).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, '.frame-chrome');
const BASE = process.env.FRAME_URL ?? 'http://localhost:5173/';
const UA =
  'Mozilla/5.0 (Linux; Android 15; tb8786p1_64_k66_wifi Build/AY7222B-mt8786_15_inch-build-20260928193323; wv) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.219 Safari/537.36';

const argv = process.argv.slice(2);
const jsAt = argv.indexOf('--js');
const js = jsAt >= 0 ? argv.splice(jsAt, 2)[1] : '';
const out = argv.find((a) => a.endsWith('.png')) ?? 'frame-shot.png';
const hash = argv.find((a) => a.startsWith('#')) ?? '';

// Same binary as npm run frame (downloads it if needed)
const { execFileSync } = await import('node:child_process');
const found = execFileSync(
  'find',
  [join(DIR, 'chrome'), '-name', 'Google Chrome for Testing', '-type', 'f', '-perm', '+111'],
  { encoding: 'utf8' },
)
  .split('\n')
  .find((p) => p.includes('/MacOS/'));
if (!found) throw new Error('Run npm run frame once to download Chrome 124');

const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(
  found,
  [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + join(DIR, 'shot-profile'),
    '--user-agent=' + UA,
    '--window-size=1280,720',
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
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r?.result?.value;
  };

  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1.5, mobile: false });
  await send('Page.navigate', { url: BASE + hash });
  await sleep(2500);

  if (await evalJs(`!!document.querySelector('form[action="/signin"]')`)) {
    const vars = existsSync(join(ROOT, '.dev.vars')) ? readFileSync(join(ROOT, '.dev.vars'), 'utf8') : '';
    const pin = /^DASHBOARD_PIN=["']?([^"'\n]*)/m.exec(vars)?.[1];
    if (!pin) throw new Error('Signed out and no DASHBOARD_PIN in .dev.vars');
    await evalJs(
      `(() => { document.getElementById('pin').value = ${JSON.stringify(pin)}; const n = document.getElementById('name'); if (n) n.value = 'Frame preview'; document.querySelector('form[action="/signin"]').submit(); })()`,
    );
    await sleep(2500);
    await send('Page.navigate', { url: BASE + hash });
    await sleep(2500);
  }
  if (js) {
    const r = await evalJs(`(async () => { ${js} })()`);
    if (r !== undefined) console.log(JSON.stringify(r, null, 2));
    await sleep(800);
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('Saved', out);
  ws.close();
} finally {
  chrome.kill();
}
