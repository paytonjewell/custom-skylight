# Skylight Calendar 2 (MediaTek MT8786): getting the dashboard on it

Running notes from putting the family dashboard ([dashboard/](../dashboard/)) on a Skylight Calendar 2.
This is a different unit from the Skylight 150-CAL in [next-session.md](next-session.md) and
[skylight-d156.md](skylight-d156.md) (RK3566, Android 12). Verify anything from those docs on this
device before following it.

## Device facts

Read over ADB on 2026-11-16.

| | |
|---|---|
| Model (`ro.product.model`) | `tb8786p1_64_k66_wifi` |
| USB manufacturer | HUAQIN (VID `0x0e8d` MediaTek, PID `0x201c`) |
| SoC | MediaTek MT8786 (`ro.hardware` = `mt6768`) |
| Android | 15, security patch 2025-01-05 |
| Build | `AY7222B-mt8786_15_inch-build-20260928193323` |
| Build flags | `ro.debuggable=0`, `ro.secure=1` (user build, `test-keys`) |
| Fingerprint | `alps/vnd_tb8786p1_64_k66_wifi/tb8786p1_64_k66_wifi:15/AY7222B-mt8786_15_inch-build-20260928193323/skylightOS-cal2_15-mt8786-user-prod-20260928193305:user/test-keys` |
| Boot | A/B slots, bootloader locked (`ro.boot.flash.locked=1`), verified boot `green` |
| Root | None. No `su`; the ADB shell is uid 2000 |
| Screen | 1920x1080, density 240 |
| WebView | `com.android.webview` (AOSP) **124.0.6367.219**, the only WebView provider |
| Google apps | None: no Play Store, no GMS, no Chrome |
| Skylight packages | `com.skylight` 26.33.0 (the HOME launcher, `odesk.johnlife.skylight.activity.MainActivity`), `skylight.watchdog` 3.7.2, `skylight.keyboard` 1.5.0 (default IME) |

## Connecting

- Plug in over USB-C. The Mac shows an "Allow accessory to connect?" prompt; allow it.
- **ADB is reachable from the stock UI.** The owner opened Android Settings → About and tapped Build number
  7 times to unlock Developer options, then turned on USB debugging. After that, `adb devices` listed it
  with no RSA prompt seen. USB PID with ADB on: `0x201c`. Wireless debugging was off (`adb_wifi_enabled=0`).
- With ADB off, a Calendar 2 enumerates as MTP only (PID `0x2008`), as in
  [wesbos/photo-frame-dashboard#88](https://github.com/wesbos/photo-frame-dashboard/issues/88), where the
  owner was stuck at the hidden manufacturer-code dialog. Try Settings → About → Build number before that route.
- The shell is uid 2000 (`shell`), not root.
- It does **not** show up in Finder. That's expected, because macOS has no MTP support. Use `adb`.
- **Getting into Android Settings.** On this unit the earlier route (hold Power for the power menu, then
  drag two fingers down from the top for Quick Settings → gear) worked once, then stopped working by
  2026-11-16. A guess: the auto-updated `com.skylight` 26.33.0 (2026-11-11) blocks it. With ADB on,
  `adb shell am start -a android.settings.SETTINGS` (or `android.settings.WIFI_SETTINGS`) opens Settings
  on the panel without any gesture.
- On this Mac, `adb` lives at `~/Library/Android/sdk/platform-tools/adb` (not on PATH by default).

## Navigation and buttons

- **No navigation bar.** All three SystemUI navbar overlays (three-button, gestural, transparent) are
  disabled, so there's no Back or Home anywhere. Once you're in Android Settings, there's no on-screen
  way out. Only a status bar (36 px) is shown.
- **Power button** (`dumpsys window policy`): a short press goes to sleep mode; waking returns to the
  top app (Skylight, while it's HOME). A long press opens the power menu.
  **A very long press is `VERY_LONG_PRESS_POWER_FACTORY_RESET`**. Don't hold Power.
- The kiosk's two-finger hold works on this panel (confirmed by hand on 2026-11-16, also on the offline
  screen), and its **Android settings** item reached Settings → Apps.
- Fix for the missing Back/Home: the kiosk's optional accessibility service (floating **Back** and
  **Dashboard** buttons; see `dashboard/kiosk/README.md`).

## Boot screens (can't be changed)

- The Skylight boot animation is `/system/media/bootanimation.zip` (plus `bootanimation_v.zip` for
  portrait). Backed up. `/system` is read-only under verified boot, and there's no root.
- The earliest power-on image is likely in the MediaTek `logo` partition (`/dev/block/by-name/logo`); unverified.
- `ro.oem_unlock_supported=0`: the bootloader can't be unlocked from Developer options, so neither can be
  replaced. Treat the Skylight boot logo as permanent on this unit.
- What we control: the kiosk's own launch screen, which appears after the boot animation. The kiosk now
  shows the dashboard lotus (white vector, `kiosk/res/drawable/lotus.xml`, from `public/icon.svg`) on #111 until
  the dashboard first finishes loading, or for 60 s at most, so a boot doesn't flash "Connect to Wi-Fi?".

## Dashboard compatibility

- The Vite build targets `chrome106` (JS) and `chrome61` (CSS). WebView 124 is newer than both, so the
  current bundle should run as is.
- WebView 124 has native CSS nesting, `:has()`, container queries, and so on. The conservative targets
  exist for the older BIUFRAME (WebView 106). Leave them alone unless that frame is retired.
- No Chrome on the device, so a kiosk app must use the system WebView (that's fine; it's 124).
- AOSP WebView isn't updated by Play. It stays at 124 unless a Skylight OTA bumps it.

## skylight.watchdog

Observed (read-only, 2026-11-16):

- Runs as **uid 1000 (system)**, privileged, in `/system_ext/priv-app/Skylight_watchdog`, with an
  updated copy in `/data/app` (3.7.2, updated 2026-10-20).
- It is the **installer of record** for `com.skylight` and `skylight.keyboard`, and updated both in the
  week before we connected. So it's Skylight's over-the-air app updater.
- Holds `INSTALL_PACKAGES`, `REBOOT`, `RECOVERY`, `WRITE_SETTINGS`, `MANAGE_EXTERNAL_STORAGE`,
  `CLEAR_APP_USER_DATA` and `SCHEDULE_EXACT_ALARM`, among others.
- Receivers: `BootReceiver` (BOOT_COMPLETED / QUICKBOOT_POWERON), `SkyframeAppCrashReceiver`
  (`skyframe_app_crash_reported`), `DatadogLoggingReceiver`, plus WorkManager constraint proxies
  (network, charging, storage, battery), so periodic background jobs.
- Telemetry: Sentry and Datadog SDKs.
- `com.skylight` also runs as uid 1000.

### What the code does (jadx, watchdog 3.7.2)

Decompiled from the APK pulled off this unit. Class names are obfuscated; the app's own code is in
`skylight/watchdog/`.

- **Phones home.** It POSTs `status_reports` to `https://app.ourskylight.com/hq/` with the serial number,
  app/watchdog/keyboard versions, OS build, disk and RAM use, uptime, timezone, the APK signing-key MD5
  and eMMC wear. Crashes also go to Sentry.
- **The server's reply controls it** (`data/api/Meta.java`):
  - `nextApplicationVersion`, `nextSkyboardVersion`, `nextWatchdogVersion`: each is an APK URL, MD5 and
    **package name**, installed silently through `PackageInstaller` (`t2/b.java`). It runs as system
    with `INSTALL_PACKAGES`, so the server can push an APK of any name.
  - `reinstallApplication`: forces a reinstall of the Skylight app.
  - `nextFirmwareOtaPackage`: a full **firmware OTA**, applied with A/B `UpdateEngine`
    (`ota/UpdateManager.java`), then a reboot, either right away or at a scheduled time (`RebootReceiver`).
  - `pollIntervalMinutes`: how often it checks in.
- **When it runs.** `BootReceiver` starts `AppService` on every boot. `SkyframeAppCrashReceiver` restarts
  the service when the Skylight app reports a crash. The service broadcasts `RESTART_SERVICE` when it's
  destroyed, so it brings itself back.
- **Not found in its code:** launching `com.skylight`, changing `adb_enabled` or other settings, or
  enabling/disabling packages. Relaunching Skylight seems to come from `com.skylight` being the HOME app,
  not from the watchdog. (This is based on a grep of obfuscated code, so a firmware OTA could still
  change any of it.)

Implication: while it's enabled and online, Skylight can silently install any APK or new firmware and
reboot the frame. A firmware OTA is the real risk to our setup: it could turn off ADB or change what the
shell is allowed to do. The plan is to `pm disable-user` the watchdog once the kiosk is installed and
proven, then turn Wi-Fi back on. This is a write and needs the owner's approval. Undo:
`pm enable skylight.watchdog`. Until then, keep Wi-Fi off.

## Backups

No root and a locked bootloader, so a flash image isn't possible. Instead we kept the APKs (current
and factory), `getprop`, all `settings`, the package list with enabled states, and the HOME resolver,
so every userspace change can be undone. A factory reset is the last-resort undo. Planned changes stay
in userspace (install an app, change HOME, disable packages).

## Building the kiosk (macOS, Apple silicon)

What this Mac needed for `dashboard/kiosk/build.sh`:

- JDK 17: `brew install openjdk@17`, then `export JAVA_HOME=/opt/homebrew/opt/openjdk@17` and put
  `$JAVA_HOME/bin` on PATH. No Java was installed before.
- `build-tools;34.0.0` and `platforms;android-34`, through `sdkmanager --sdk_root=$HOME/Library/Android/sdk`.
  Only 36/37 were installed. `brew install --cask android-commandlinetools` refused without a
  system Java, but an existing `sdkmanager` worked.
- Build: `ANDROID_HOME=$HOME/Library/Android/sdk bash kiosk/build.sh` from `dashboard/`. The first build
  creates `~/.android/debug.keystore`. Keep it: later `adb install -r` updates must be signed by the same key.
- `kiosk/test-lifecycle.py` failed to compile until its fakes got a `CookieManager` stub (the kiosk
  flushes the sign-in cookie on pause). Both host tests pass now.

Screen: 1920×1080 at density 240 gives the page a 1280×720 CSS viewport. No `wm density` change needed.

**Stage overflow (fixed in `useStageFit`, src/app/App.tsx).** On this WebView, `innerWidth`/`innerHeight`
read **1315×740** while the visible area (`documentElement.clientWidth/Height`, `visualViewport`) is
1280×720. The layout viewport grows to fit the stage's own overflow before its `scale()` applies. Sizing the
stage from `innerWidth` cut about 35 CSS px off each side (the rail was clipped on the left). Fixed by sizing
from `documentElement.clientWidth/Height`, verified live over WebView remote debugging
(`am start -n com.wesbos.homehq/.MainActivity --ez debug true`, then `adb forward tcp:9333
localabstract:webview_devtools_remote_<pid>`). Debugging turns off again at the next normal launch.

## Plan

1. ~~Decompile the watchdog~~ (done, above). Keep Wi-Fi off until step 3.
2. Install `dashboard/kiosk` (White Lotus HQ, `com.wesbos.homehq`) with `adb install`. It already defaults to
   the deployed dashboard URL.
3. Make it the HOME app (`cmd package set-home-activity …`). Prove by hand that Settings → Apps is
   reachable from the kiosk (README rule 9). Then `pm disable-user` `skylight.watchdog`, and finally
   `com.skylight`.
4. Point it at the deployed dashboard; handle the PIN, keep the screen awake, and survive reboots.

## Issues / log

- 2026-11-16: Connected; ADB worked immediately. Took the userspace backup. Inspected the watchdog
  (read-only). Checked upstream: no MT8786 docs or PRs; #88 has the only other Calendar 2 report.
  Decompiled the watchdog: it's a remote APK installer and firmware OTA client (details above).
  Nothing changed on the device by us.
- 2026-11-16: Two-finger Quick Settings gesture no longer works. Opened Wi-Fi settings over ADB; owner
  turned Wi-Fi off on the panel to keep the watchdog offline.
- 2026-11-16: `adb install` of the kiosk (1.2, target SDK 28) succeeded; no Android 15 SDK refusal. Launched
  over ADB: full screen 1920×1080, no "built for an older version" dialog in the screenshot, and the offline
  "Connect to Wi-Fi?" screen as expected with Wi-Fi off. HOME is still `com.skylight`.
- 2026-11-16: Owner test: two-finger hold → Android settings → Apps works. With no nav bar, there was no way
  back from Settings; a short Power press (sleep, then wake) landed on Skylight, the current HOME.
- 2026-11-16: Enabled the kiosk's navigation service over ADB (`enabled_accessibility_services`,
  `accessibility_enabled=1`) and granted `WRITE_SECURE_SETTINGS`. `dumpsys accessibility` shows it bound.
- 2026-11-16: Owner test passed: two-finger hold → Android settings → Apps, then the floating Back/Dashboard
  buttons returned to the kiosk. README rule 9 satisfied while Skylight is still HOME.
- 2026-11-16: `--ez home true`, then `cmd package set-home-activity com.wesbos.homehq/.Home` answered `Success`
  first time (no "Failed to set default home"). The HOME resolver still pointed at the kiosk 30 s later.
- 2026-11-16: Rebooted with the kiosk as HOME: it booted into the kiosk (no Skylight takeover). But **Wi-Fi came
  back on by itself**: logcat shows `setWifiEnabled package=com.skylight uid=1000 enable=true` about 3 s
  after boot. Skylight's app forces Wi-Fi on at boot even when it isn't HOME, so turning Wi-Fi off in
  Settings doesn't keep this frame offline across a reboot. The watchdog started and stopped its
  service while online. Afterwards, app versions and the firmware build were unchanged.
- 2026-11-16: `pm disable-user --user 0` on `skylight.watchdog` and `com.skylight` from the ADB shell: both
  answered `new state: disabled-user`, and both processes were gone a few seconds later. The shell is allowed
  to disable these uid-1000 system_ext apps. `skylight.keyboard` was left enabled as the only IME.
- 2026-11-16: Boot after disabling Skylight: animation → kiosk, but WebView's "Webpage not available" page
  flashed briefly. Log: first load failed (`ERR_INTERNET_DISCONNECTED`) at +1.6 s, Wi-Fi joined 0.4 s later,
  and the kiosk retried. A late `onPageFinished` for the error page then looked like success and hid the
  lotus. The kiosk now checks `location.protocol` (`chrome-error:` on WebView's error page) before
  hiding the lotus or the offline screen.
- 2026-11-16: Clean reboot: animation → lotus → dashboard, no error page. Time zone was **GMT** with automatic
  zone detection on, but the frame has no telephony or geolocation detection, so nothing sets it once Skylight is
  disabled. On Android 15 the ADB shell can't set it (`cmd time_zone_detector suggest_manual_time_zone` →
  SecurityException, no `SUGGEST_MANUAL_TIME_AND_ZONE`). Set it by hand instead:
  `am start -a android.settings.DATE_SETTINGS`, automatic zone off, then pick the zone.
