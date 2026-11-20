#!/usr/bin/env bash
# Builds the phone app (Capacitor, android/) and, with "install", puts it on the phone over adb.
#   npm run app            -> android/app/build/outputs/apk/release/app-release.apk
#   npm run app:install    -> builds, then installs on the one phone adb sees (or ANDROID_SERIAL)
#
# Builds are release builds, signed with the app's one key (android/keystore.properties, see
# android/app/build.gradle), so they install over the ones GitHub Actions publishes and vice versa.
#
# The app is a shell that loads the live dashboard (server.url in capacitor.config.json), so changes
# to the web app reach it with `npm run deploy`. Only changes under android/ or capacitor.config.json
# need a new build.
#
# Gradle runs on Android Studio's bundled Java (25), which is why gradle-wrapper.properties pins
# Gradle 9.5.x: older Gradle can't run on Java 25, and newer (9.6+) dropped an API that the Android
# Gradle plugin 8.x still uses. Override with JAVA_HOME=... if needed.
set -euo pipefail
cd "$(dirname "$0")/.."

export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
[ -x "$JAVA_HOME/bin/java" ] || { echo "No Java at $JAVA_HOME (set JAVA_HOME)" >&2; exit 1; }

[ -n "${ANDROID_KEYSTORE_FILE:-}" ] || [ -f android/keystore.properties ] || {
  echo "No signing key: android/keystore.properties is missing (see android/app/build.gradle)" >&2
  exit 1
}

npx cap sync android
(cd android && ./gradlew assembleRelease --console=plain -q)
APK=android/app/build/outputs/apk/release/app-release.apk
echo "Built $APK"

if [ "${1:-}" = "install" ]; then
  "$ANDROID_HOME/platform-tools/adb" install -r "$APK"
  "$ANDROID_HOME/platform-tools/adb" shell am start -n com.piercefam.whitelotushq/.MainActivity
fi
