#!/usr/bin/env node
// npm run frame: opens the local dashboard (npm run dev, http://localhost:5173) in the same browser
// engine as the frame, so frame-only layout bugs show up on this computer too.
//
// The Skylight Calendar 2's kiosk draws the page with Android System WebView 124, which never
// updates (no Play Store). A current desktop Chrome lays some things out differently, so this uses
// Chrome for Testing 124, downloaded once into .frame-chrome/ (gitignored), with:
// - the frame's user agent, so the app takes its kiosk paths (IS_KIOSK in src/app/layout.ts)
// - the 1280×720 frame preview box (FRAME_PREVIEW), which dev mode always shows
// - its own profile in .frame-chrome/profile, apart from your normal Chrome
//
//   npm run frame                 open the dashboard
//   npm run frame -- --devtools   also open DevTools
//   npm run frame -- '#calendar'  open a screen
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '124.0.6367.207'; // the frame's WebView is 124.0.6367.219
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, '.frame-chrome');
const URL = process.env.FRAME_URL ?? 'http://localhost:5173/';

// The frame's WebView user agent (Android 15, Skylight Calendar 2). "; wv)" marks it as the kiosk.
const UA =
  'Mozilla/5.0 (Linux; Android 15; tb8786p1_64_k66_wifi Build/AY7222B-mt8786_15_inch-build-20260928193323; wv) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.219 Safari/537.36';

function findBinary() {
  const base = join(DIR, 'chrome');
  if (!existsSync(base)) return null;
  const build = readdirSync(base).find((d) => d.endsWith('-' + VERSION));
  if (!build) return null;
  const candidates = [
    join(base, build, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
    join(base, build, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
    join(base, build, 'chrome-linux64', 'chrome'),
    join(base, build, 'chrome-win64', 'chrome.exe'),
  ];
  return candidates.find(existsSync) ?? null;
}

let bin = findBinary();
if (!bin) {
  console.log(`Downloading Chrome for Testing ${VERSION} (once, about 150 MB) into .frame-chrome/`);
  execFileSync('npx', ['-y', '@puppeteer/browsers@2.10.10', 'install', 'chrome@' + VERSION, '--path', DIR], { stdio: 'inherit' });
  bin = findBinary();
  if (!bin) throw new Error('Chrome for Testing was downloaded but not found in .frame-chrome/');
}

const args = process.argv.slice(2);
const hash = args.find((a) => a.startsWith('#')) ?? '';
const flags = [
  '--user-data-dir=' + join(DIR, 'profile'),
  '--user-agent=' + UA,
  '--window-size=1340,840',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-component-update',
  '--disable-features=Translate',
  ...(args.includes('--devtools') ? ['--auto-open-devtools-for-tabs'] : []),
  URL + hash,
];

spawn(bin, flags, { detached: true, stdio: 'ignore' }).unref();
console.log(`Opened ${URL + hash} in Chrome ${VERSION} as the frame. Is npm run dev running?`);
