// Secrets not in worker-configuration.d.ts (it's generated from .dev.vars, which may not have them yet).
// Google Calendar's OAuth client, from Google Cloud: `wrangler secret put GOOGLE_CLIENT_ID` (and _SECRET).
// The household's own settings (worker/home.ts): HOME_PLACE, HOME_LAT, HOME_LON, HOME_TZ, FAMILY, LOCAL_NEWS.
interface Env {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  HOME_PLACE?: string;
  HOME_LAT?: string;
  HOME_LON?: string;
  HOME_TZ?: string;
  FAMILY?: string;
  LOCAL_NEWS?: string;
}
