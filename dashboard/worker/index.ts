// White Lotus HQ Worker: PIN gate in front of everything, the photo, list, grocery, task and news APIs, and the app's
// static files.
import { authenticate, signIn, signOut, type Device } from './auth';
import { signInPage } from './signin-page';
import { privacyPage } from './privacy-page';
import { getNews, refreshNews } from './news/news';
import {
  addGrocery,
  clearGroceries,
  clearPurchased,
  deleteGrocery,
  editGrocery,
  getGroceries,
  orderGroceries,
} from './groceries';
import {
  addItem,
  addList,
  deleteItem,
  deleteList,
  editItem,
  editList,
  getLists,
  orderItems,
  orderLists,
} from './lists';
import { addTask, deleteTask, editTask, getTasks, markDone, unmarkDone } from './tasks';
import {
  addEvent,
  callback,
  connect,
  deleteEvent,
  disconnect,
  editCalendar,
  editEvent,
  getCalendars,
  getEvents,
  refreshCalendarLists,
  refreshCalendars,
  restoreEvent,
  syncCalendars,
} from './google';
import { deletePush, getPush, prunePushSent, savePush, sendReminders, testPush } from './push';
import { getVerse, getWeather, refreshWeather } from './weather';
import { getFamily } from './home';
import { kitchenRoute } from './kitchen';
import { isDay } from '../src/lib/repeat';
import { getAppRelease, serveApk, uploadApk } from './app';
import { addPhoto, deletePhoto, knownPhotos, listPhotos, reorderPhotos, servePhoto } from './photos';
import { json, pathParts } from './http';
import { UUID, isId } from './validate';

// The service worker script is public too: it holds no data, and the browser checks it for updates
// on its own schedule.
const PUBLIC = new Set([
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
  '/sw.js',
]);

async function shareFallback(req: Request): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const link = ['url', 'text', 'title']
    .map((k) => String(form?.get(k) ?? '').match(/https?:\/\/\S+/)?.[0])
    .find(Boolean);
  const to = link ? '/?recipe=' + encodeURIComponent(link) + '#kitchen' : '/#photos';
  return Response.redirect(new URL(to, req.url).toString(), 303);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;
    const isData = path.startsWith('/api/') || path.startsWith('/media/');
    try {
      return await handle(req, env, ctx, path, isData);
    } catch (e) {
      // An uncaught error would otherwise show Cloudflare's own error page (1101)
      console.error(req.method, path, e);
      return json({ error: 'Server error' }, 500);
    }
  },

  // Cron trigger (wrangler.jsonc): send task reminders to phones, and keep the news fresh even when
  // no screen is asking
  async scheduled(controller, env, ctx) {
    // Runs every minute (so reminders are on time); news only every 5
    const at = new Date(controller.scheduledTime);
    const minute = at.getUTCMinutes();
    if (minute % 5 === 0) ctx.waitUntil(refreshNews(env));
    // Weather every 15 minutes (worker/weather.ts)
    if (minute % 15 === 2) ctx.waitUntil(refreshWeather(env).catch((e) => console.error('Weather', e)));
    // Google Calendar: events every 15 minutes even with no screen open; the calendar list hourly
    if (minute % 15 === 7)
      ctx.waitUntil(syncCalendars(env, 10 * 60 * 1000).catch((e) => console.error('Calendar sync', e)));
    if (minute === 3) ctx.waitUntil(refreshCalendarLists(env).catch((e) => console.error('Calendar lists', e)));
    ctx.waitUntil(sendReminders(env, at).catch((e) => console.error('Reminders', e)));
    // Once a day, at a quiet hour (04:00 UTC is late evening to early morning across the US), tidy up
    if (minute === 0 && at.getUTCHours() === 4) {
      ctx.waitUntil(prunePushSent(env, at).catch((e) => console.error('Prune reminders', e)));
      ctx.waitUntil(clearPurchased(env, at.getTime()).catch((e) => console.error('Clear groceries', e)));
    }
  },
} satisfies ExportedHandler<Env>;

async function handle(req: Request, env: Env, ctx: ExecutionContext, path: string, isData: boolean): Promise<Response> {
  if (path === '/signin' && req.method === 'POST') return signIn(req, env);
  // Browsers fetch the web app manifest and its icons without cookies, so these must be public for
  // the app to install. They hold nothing private.
  if (PUBLIC.has(path)) return env.ASSETS.fetch(req);
  // Google asks for a public privacy policy (worker/privacy-page.ts)
  if (path === '/privacy' && req.method === 'GET') return privacyPage();
  // A share that reached the server means the phone's service worker wasn't running yet to catch it
  // (e.g. the app hadn't been opened since install). A link opens Kitchen importing it (as
  // public/sw.js does); photos just open the app (they'd need the service worker).
  if (path === '/share' && req.method === 'POST') return shareFallback(req);
  // New phone app builds from GitHub Actions, which has a token instead of a device cookie (worker/app.ts)
  if (path === '/api/app/upload' && req.method === 'PUT') return uploadApk(req, env);

  // Changes must come from the app's own pages. The device cookie is SameSite=Lax, which already keeps
  // it off most cross-site requests; this also refuses any that slip through. Browsers send Origin on
  // every non-GET fetch (the app's, and the service worker's "Done" on a reminder), always this one;
  // a request without it isn't from a web page at all (curl, a script), so the cookie still decides.
  const origin = req.headers.get('Origin');
  if (
    path.startsWith('/api/') &&
    req.method !== 'GET' &&
    req.method !== 'HEAD' &&
    origin &&
    origin !== new URL(req.url).origin
  )
    return json({ error: 'Cross-origin request' }, 403);

  const auth = await authenticate(req, env);
  // Signed out: data requests get a 401 (the app reloads into the sign-in page); everything else
  // gets the sign-in page itself
  if (!auth) return isData ? json({ error: 'Signed out' }, 401) : signInPage(req);

  let res =
    (await route(req, env, ctx, path, auth.device)) ??
    (isData ? json({ error: 'Not found' }, 404) : await env.ASSETS.fetch(req));
  if (!auth.setCookie) return res;
  res = new Response(res.body, res); // asset responses have immutable headers
  res.headers.append('Set-Cookie', auth.setCookie);
  return res;
}

async function route(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  path: string,
  device: Device,
): Promise<Response | null> {
  const m = req.method;
  if (path === '/api/news' && m === 'GET') return getNews(env, ctx);
  if (path === '/api/weather' && m === 'GET') return getWeather(env, ctx);
  if (path === '/api/family' && m === 'GET') return getFamily(env);
  if (
    path === '/api/kitchen' ||
    path.startsWith('/api/recipes') ||
    path.startsWith('/api/plan/') ||
    path.startsWith('/api/inventory') ||
    path === '/api/aliases'
  ) {
    return kitchenRoute(req, env, path, m);
  }
  if (path === '/api/verse' && m === 'GET') return getVerse(env);
  if (path.startsWith('/api/lists')) return listRoute(req, env, path, m);
  if (path.startsWith('/api/groceries')) return groceryRoute(req, env, path, m);
  if (path.startsWith('/api/tasks')) return taskRoute(req, env, path, m);
  if (path === '/api/push') {
    if (m === 'GET') return getPush(env, device);
    if (m === 'PUT') return savePush(req, env, device);
    if (m === 'DELETE') return deletePush(req, env, device);
  }
  if (path === '/api/push/test' && m === 'POST') return testPush(req, env, device);
  if (path.startsWith('/api/google/') || path.startsWith('/api/calendars') || path.startsWith('/api/events'))
    return calendarRoute(req, env, ctx, path, m);
  if (path === '/api/photos') {
    if (m === 'GET') return listPhotos(env);
    if (m === 'POST') return addPhoto(req, env, device);
  }
  if (path === '/api/photos/order' && m === 'PUT') return reorderPhotos(req, env);
  if (path === '/api/photos/known' && m === 'POST') return knownPhotos(req, env);
  const [photo] = pathParts(path, '/api/photos/*', (p) => UUID.test(p)) ?? [];
  if (photo && m === 'DELETE') return deletePhoto(env, photo);
  const [id, size] = pathParts(path, '/media/*/*', (p, i) => (i ? p === 'full' || p === 'thumb' : UUID.test(p))) ?? [];
  if (id && (m === 'GET' || m === 'HEAD')) return servePhoto(req, env, id, size as 'full' | 'thumb');
  // The phone app's own updates (worker/app.ts)
  if (path === '/api/app' && m === 'GET') return getAppRelease(env);
  if (path === '/api/app/apk' && m === 'GET') return serveApk(env);
  if (path === '/api/signout' && m === 'POST') return signOut(req, env, device);
  return null;
}

// Google's ids are checked where they're used (worker/google.ts)
const any = () => true;

/** /api/lists… (worker/lists.ts) */
async function listRoute(req: Request, env: Env, path: string, m: string): Promise<Response | null> {
  if (path === '/api/lists') {
    if (m === 'GET') return getLists(env);
    if (m === 'POST') return addList(req, env);
  }
  if (path === '/api/lists/order' && m === 'PUT') return orderLists(req, env);
  const [list] = pathParts(path, '/api/lists/*', isId) ?? [];
  if (list && m === 'PATCH') return editList(req, env, list);
  if (list && m === 'DELETE') return deleteList(env, list);
  const [to] = pathParts(path, '/api/lists/*/items', isId) ?? [];
  if (to && m === 'POST') return addItem(req, env, to);
  const [ordered] = pathParts(path, '/api/lists/*/items/order', isId) ?? [];
  if (ordered && m === 'PUT') return orderItems(req, env, ordered);
  const [listId, item] = pathParts(path, '/api/lists/*/items/*', isId) ?? [];
  if (item && m === 'PATCH') return editItem(req, env, listId, item);
  if (item && m === 'DELETE') return deleteItem(env, listId, item);
  return null;
}

/** /api/tasks… (worker/tasks.ts) */
async function taskRoute(req: Request, env: Env, path: string, m: string): Promise<Response | null> {
  if (path === '/api/tasks') {
    if (m === 'GET') return getTasks(env);
    if (m === 'POST') return addTask(req, env);
  }
  const [task] = pathParts(path, '/api/tasks/*', isId) ?? [];
  if (task && m === 'PATCH') return editTask(req, env, task);
  if (task && m === 'DELETE') return deleteTask(env, task);
  const [id, day] = pathParts(path, '/api/tasks/*/done/*', (p, i) => (i ? isDay(p) : isId(p))) ?? [];
  if (day && m === 'PUT') return markDone(req, env, id, day);
  if (day && m === 'DELETE') return unmarkDone(env, id, day);
  return null;
}

/** Google Calendar: /api/google/…, /api/calendars…, /api/events… (worker/google.ts) */
async function calendarRoute(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  path: string,
  m: string,
): Promise<Response | null> {
  if (path === '/api/google/connect' && m === 'GET') return connect(req, env);
  if (path === '/api/google/callback' && m === 'GET') return callback(req, env);
  const [account] = pathParts(path, '/api/google/accounts/*', any) ?? [];
  if (account && m === 'DELETE') return disconnect(env, account);
  if (path === '/api/calendars' && m === 'GET') return getCalendars(env);
  if (path === '/api/calendars/refresh' && m === 'POST') return refreshCalendars(env);
  const [cal] = pathParts(path, '/api/calendars/*', any) ?? [];
  if (cal && m === 'PATCH') return editCalendar(req, env, cal);
  if (path === '/api/events') {
    if (m === 'GET') return getEvents(env, ctx);
    if (m === 'POST') return addEvent(req, env);
  }
  const [evCal, gid] = pathParts(path, '/api/events/*/*', any) ?? [];
  if (gid && m === 'PATCH') return editEvent(req, env, evCal, gid);
  if (gid && m === 'DELETE') return deleteEvent(env, evCal, gid);
  const [rCal, rGid] = pathParts(path, '/api/events/*/*/restore', any) ?? [];
  if (rGid && m === 'POST') return restoreEvent(req, env, rCal, rGid);
  return null;
}

/** /api/groceries… (worker/groceries.ts) */
async function groceryRoute(req: Request, env: Env, path: string, m: string): Promise<Response | null> {
  if (path === '/api/groceries') {
    if (m === 'GET') return getGroceries(env);
    if (m === 'POST') return addGrocery(req, env);
  }
  if (path === '/api/groceries/order' && m === 'PUT') return orderGroceries(req, env);
  if (path === '/api/groceries/clear' && m === 'POST') return clearGroceries(req, env);
  const [id] = pathParts(path, '/api/groceries/*', isId) ?? [];
  if (id && m === 'PATCH') return editGrocery(req, env, id);
  if (id && m === 'DELETE') return deleteGrocery(env, id);
  return null;
}
