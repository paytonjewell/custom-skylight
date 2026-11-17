// Everything that starts once when the app loads: the syncs that keep each kind of data in step with
// the Worker, and the checks for what the app was opened with (a Google sign-in coming back, a recipe
// link or photos shared to it). Called from main.tsx, not from an effect, so it runs exactly once
// (StrictMode runs effects twice in development).
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
import { IS_KIOSK } from './layout';

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
  checkGoogleReturn();
  checkSharedRecipe();
  // Photos shared to the installed app from another app (public/sw.js)
  if (!IS_KIOSK) void receiveSharedPhotos();
}
