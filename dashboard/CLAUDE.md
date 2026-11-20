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

## The phone app (Capacitor)

`android/` is a Capacitor shell that loads the live site (`server.url` in `capacitor.config.json`), so
web changes reach it with `npm run deploy`; only changes to `android/` or the config need a new APK.
Its WebView adds `WhiteLotusApp/` to the user agent, which keeps it out of `IS_KIOSK` (the frame is a
WebView too). `native/www/offline.html` shows when the site can't be reached.

- `npm run app` builds the signed `android/app/build/outputs/apk/release/app-release.apk`;
  `npm run app:install` also installs it over adb (set `ANDROID_SERIAL` when the frame is connected
  too). Uses Android Studio's bundled Java; Gradle is pinned to 9.5.x for it (see `scripts/app.sh`).
- Updates: pushing changes to `android/`, `native/` or the config runs `.github/workflows/android.yml`,
  which builds, signs and uploads the APK to the Worker (`worker/app.ts`, token `APP_UPLOAD_TOKEN`).
  The app compares its version (the git commit count) with `/api/app` and shows `UpdateBanner`.
- Every build must be signed with the one release key (`~/.android/white-lotus-release.jks`, password
  in the git-ignored `android/keystore.properties`; backed up in Proton Pass; GitHub secrets
  `ANDROID_KEYSTORE_*`). A build signed with any other key can't update installed apps.
- Reminders in the app come through Firebase Cloud Messaging, not Web Push: the app saves its FCM
  token in `push_subs` (`kind = 'app'`), `worker/fcm.ts` sends data-only messages (secret
  `FCM_SERVICE_ACCOUNT`), and `Reminders.java` draws them on a high-importance channel with Done.
  `android/app/google-services.json` is git-ignored (Actions secret `GOOGLE_SERVICES_JSON` on CI).
- The phone has two displays: `adb exec-out screencap -p -d <id>` (ids from
  `adb shell dumpsys SurfaceFlinger --display-id`).

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
- Type sizes come from the scale in `css/tokens.css` (`--fs-2xs` … `--fs-5xl`); each token has a
  frame and a phone value, so a rule rarely needs its own phone size. No px font sizes, except
  display numbers (clock, temperatures) and emoji sized to their tile. Radii: `--r` for cards,
  `--r-sm` for what sits inside one, 999px (or half the height) for pills. Add + buttons with
  `ui/Fab.tsx`.
- Comments explain why, in plain sentences; keep the style of the file you're in.
- Data: read it with `useData('tasks', 'taskDone')`, naming only the keys the component uses; helpers it's
  passed to take `Pick<Data, …>`. Each kind of data syncs through `createSync` (`src/data/sync.ts`);
  everything starts once from `src/app/start.ts`.
- React Compiler memoizes components, so there's no need for `useMemo`/`useCallback`. A component it
  can't compile is printed as `[react-compiler] skipped …` by the dev server and build: keep that at zero.
- Shared pieces live in `src/ui/` (`Chip`/`DateChip`, `EmojiTitle`, `Stepper`, `AddBar`, `SwipeRow`,
  `PersonPicker`, `SheetHeader`…): reuse them rather than copying markup and CSS between sheets.
  Something tapped as a whole that holds buttons of its own gets `role="button" tabIndex={0}` and
  `tappable()` (`ui/tappable.ts`).
- Dragging: `ui/useDragDrop.tsx` (drop onto targets) and `ui/useHoldReorder.ts` (reorder in place),
  both press-and-hold through `ui/hold.ts`. Swipe rows: `ui/SwipeRow.tsx` (actions per side).
- Worker: answer with `json<T>()` / `bad()` / `done()` from `worker/http.ts`, naming the answer's type
  from `src/data/types.ts` (the app reads the same type); ids and other input checks are in
  `worker/validate.ts`; fetches to URLs from users go through `worker/outbound.ts`. Lists of values
  go to D1 as one JSON parameter (`json_each(?)`): D1 allows only 100 bound parameters.
- Tests (Vitest): `test/*.test.ts` run in Node (pure functions from `src/` and `worker/`);
  `test/worker/` runs the Worker itself against a real local D1 and R2 with the migrations applied.
