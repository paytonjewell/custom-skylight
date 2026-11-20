// Secrets not in worker-configuration.d.ts (it's generated from .dev.vars, which may not have them yet).
// Google Calendar's OAuth client, from Google Cloud: `wrangler secret put GOOGLE_CLIENT_ID` (and _SECRET).
// The household's own settings (worker/home.ts): HOME_PLACE, HOME_LAT, HOME_LON, HOME_TZ, FAMILY, LOCAL_NEWS.
// APP_UPLOAD_TOKEN: lets GitHub Actions publish phone app builds (worker/app.ts); the same value is the
// repo's APP_UPLOAD_TOKEN Actions secret.
// FCM_SERVICE_ACCOUNT: the Firebase service account's JSON key, for reminders to the phone app (worker/fcm.ts).
interface Env {
  APP_UPLOAD_TOKEN?: string;
  FCM_SERVICE_ACCOUNT?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  HOME_PLACE?: string;
  HOME_LAT?: string;
  HOME_LON?: string;
  HOME_TZ?: string;
  FAMILY?: string;
  LOCAL_NEWS?: string;
}
