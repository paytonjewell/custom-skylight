# White Lotus HQ (dashboard)

The family dashboard: React + TypeScript (Vite) in `src/`, a Cloudflare Worker with D1 and R2 in
`worker/`, deployed to https://home-dashboard.piercefam.workers.dev (behind a PIN). It runs full
screen on a Skylight Calendar 2 through the kiosk app in `kiosk/`, and as a phone web app.

## Commands

- `npm run dev`: usually **already running** on :5173. Check before starting another.
- `npm run check` before committing: typecheck, Biome (lint + format), tests and knip (unused
  code). `npm run lint:fix` formats and applies safe lint fixes. CI (`.github/workflows/dashboard.yml`)
  runs the same checks on every push.
- `npm run deploy`: builds, applies new migrations to the remote database, then deploys. For the dev
  server, apply them with `npm run db:migrate:local`.
- `npm run frame` / `npm run frame:shot -- out.png '#tasks' --js "<code>"`: see below.

## The frame is Chrome 124

The kiosk draws the page with Android WebView 124, which never updates. Newer desktop Chrome can
hide layout bugs the frame has (e.g. Chrome 124 gives `<button>` `align-items: flex-start`).

- Dev mode shows the app in a 1280×720 box, the frame's exact viewport (`?fit` turns it off).
- Check UI changes in Chrome 124: `npm run frame:shot` (headless screenshot, can run JS first) or
  `npm run frame` (a window). Both pose as the kiosk.
- The real frame: `adb` over Wi-Fi (`~/Library/Android/sdk/platform-tools/adb`; find the port with
  `adb mdns services`; if it isn't listed, ask for a new pairing code from the frame's Wireless
  debugging screen). Screenshot: `adb exec-out screencap -p`. Reload after a deploy:
  `adb shell am force-stop com.wesbos.homehq && adb shell am start -n com.wesbos.homehq/.MainActivity`.
- Kiosk changes need a rebuild and reinstall: `KIOSK_URL=https://home-dashboard.piercefam.workers.dev/`
  with JDK 17 (`/opt/homebrew/opt/openjdk@17`) and `ANDROID_HOME=~/Library/Android/sdk`, then
  `bash kiosk/build.sh` and `adb install -r kiosk/build/homehq.apk`.

## Data and settings

- Household settings are Worker secrets (`worker/home.ts`; local copies in `.dev.vars`). Profiles
  are in `FAMILY`: `"tasks": false` is calendar-only, `"calendar": false` is tasks-only (shown after
  Anyone). Production secrets can't be read back: change them with `wrangler secret put`, from the
  local value, only when asked.
- Refreshing local data from production: back up `.wrangler/state`, export with
  `wrangler d1 export --remote`, import locally, then **strip** the Google tokens in
  `google_accounts` and delete `push_subs`/`push_sent`, so local changes can't write to the real
  Google Calendar or notify phones. Keep the local `devices` rows (sign-ins). Copy R2 photos too.
- Never sign in to Google from the local app.

## Code

- Styles: CSS modules beside each component; theme tokens in `css/tokens.css`. Phone styles sit
  inside each rule under `:global(.phone) &`.
- Comments explain why, in plain sentences; keep the style of the file you're in.
- Data: read it with `useData('tasks', 'taskDone')`, naming only the keys the component uses; helpers it's
  passed to take `Pick<Data, …>`. Each kind of data syncs through `createSync` (`src/data/sync.ts`);
  everything starts once from `src/app/start.ts`.
- React Compiler memoizes components, so there's no need for `useMemo`/`useCallback`. A component it
  can't compile is printed as `[react-compiler] skipped …` by the dev server and build: keep that at zero.
- Shared pieces live in `src/ui/` (`Chip`/`DateChip`, `PersonPicker`, `SheetHeader`…): reuse them
  rather than copying markup and CSS between sheets.
- Dragging: `ui/useDragDrop.tsx` (drop onto targets) and `ui/useHoldReorder.ts` (reorder in place),
  both press-and-hold. Swipe rows: `ui/SwipeRow.tsx`.
