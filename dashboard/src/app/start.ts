// Everything that starts once when the app loads: the syncs that keep each kind of data in step with
// the Worker, and the checks for what the app was opened with (a Google sign-in coming back, a recipe
// link or photos shared to it). Called from main.tsx, not from an effect, so it runs exactly once
// (StrictMode runs effects twice in development).
import { startAppUpdate } from '../data/appUpdate';
import { startCalendarSync } from '../data/calendarSync';
import { startFamilySync } from '../data/familySync';
import { startGrocerySync } from '../data/grocerySync';
import { startKitchenSync } from '../data/kitchenSync';
import { startListSync } from '../data/listSync';
import { startNewsSync } from '../data/newsSync';
import { startPhotoSync } from '../data/photoSync';
import { startPush } from '../data/push';
import { startTaskSync } from '../data/taskSync';
import { startWeatherSync } from '../data/weatherSync';
import { checkGoogleReturn } from '../views/calendar/CalendarSettings';
import { receiveSharedPhotos } from '../views/Photos';
import { checkSharedRecipe } from '../views/recipes/AddRecipeSheet';
import { IS_APP, IS_KIOSK } from './layout';
import { startAppShare } from './share';
import { startWidgetRefresh } from './widgets';

export function startApp(): void {
  startFamilySync();
  startPhotoSync();
  startNewsSync();
  startWeatherSync();
  startListSync();
  startGrocerySync();
  startTaskSync();
  startPush();
  startCalendarSync();
  startKitchenSync();
  // The phone app's own updates (only does anything in the app)
  void startAppUpdate();
  checkGoogleReturn();
  checkSharedRecipe();
  // Photos and links shared from another app: to the phone app (src/app/share.ts), or to the
  // installed web app (public/sw.js)
  if (IS_APP) void startAppShare();
  else if (!IS_KIOSK) void receiveSharedPhotos();
  // The phone app's home screen widgets: refresh when tasks change here (src/app/widgets.ts)
  if (IS_APP) void startWidgetRefresh();
}
