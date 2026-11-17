// White Lotus HQ service worker. Two jobs:
// 1. Task reminders (worker/push.ts sends them): show the notification; "Done" ticks the task without
//    opening the app, and tapping it opens Tasks.
// 2. Receive what's shared to the installed app from another app ("Share → White Lotus HQ"). Android
//    posts it to /share (see share_target in manifest.webmanifest).
//    - Photos (from Google Photos): held in a cache on the phone and the app is opened on Photos, where
//      it adds them like the Add photos button does (src/views/Photos.tsx, receiveSharedPhotos).
//    - A link (a recipe page from the browser): the app opens on Kitchen with the New recipe form
//      importing it (src/views/recipes/AddRecipeSheet.tsx, checkSharedRecipe).
// Every other request goes straight to the network, untouched.

const INBOX = 'share-inbox';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let m = {};
  try {
    m = e.data ? e.data.json() : {};
  } catch {
    /* not JSON: show a plain reminder */
  }
  e.waitUntil(
    self.registration.showNotification(m.title || 'Reminder', {
      body: m.body || '',
      tag: m.tag,
      // Alert again when it replaces one with the same tag (a second test), and vibrate: some
      // Android versions only show a banner for notifications that make a sound or vibrate
      renotify: !!m.tag,
      silent: false,
      vibrate: [200, 100, 200],
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { task: m.task, day: m.day, by: m.by ?? null },
      actions: m.task ? [{ action: 'done', title: 'Done' }] : [],
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  const { task, day, by } = e.notification.data || {};
  e.notification.close();
  if (e.action === 'done' && task && day) {
    e.waitUntil(markDone(task, day, by));
    return;
  }
  e.waitUntil(openTasks());
});

async function markDone(task, day, by) {
  try {
    const res = await fetch(`/api/tasks/${encodeURIComponent(task)}/done/${encodeURIComponent(day)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ at: new Date().toISOString(), by }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    // An open app shows it at once
    for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ type: 'tasks-changed' });
  } catch {
    // Couldn't save (offline, signed out): open the app so it can be ticked there
    await openTasks();
  }
}

async function openTasks() {
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const open = all.find((c) => new URL(c.url).origin === location.origin);
  if (open) {
    await open.focus();
    open.postMessage({ type: 'open', view: 'tasks' });
    return;
  }
  await self.clients.openWindow('/#tasks');
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.origin === location.origin && url.pathname === '/share') {
    e.respondWith(receive(e.request));
  }
});

/** The first web link in a share's url, text or title */
function sharedLink(form) {
  for (const k of ['url', 'text', 'title']) {
    const m = String(form.get(k) || '').match(/https?:\/\/\S+/);
    if (m) return m[0];
  }
  return null;
}

async function receive(request) {
  try {
    const form = await request.formData();
    const files = form.getAll('photos').filter((f) => f instanceof File && f.size > 0);
    // No photos: a link (browsers often put it in the text, not the url field)
    if (!files.length) {
      const link = sharedLink(form);
      if (link) return Response.redirect('/?recipe=' + encodeURIComponent(link) + '#kitchen', 303);
    }
    const cache = await caches.open(INBOX);
    const batch = Date.now();
    await Promise.all(
      files.map((f, i) =>
        cache.put(
          `/share-inbox/${batch}-${String(i).padStart(4, '0')}`,
          new Response(f, {
            headers: {
              'Content-Type': f.type || 'application/octet-stream',
              'X-Name': encodeURIComponent(f.name || 'photo'),
              'X-Modified': String(f.lastModified || Date.now()),
            },
          }),
        ),
      ),
    );
  } catch (err) {
    console.warn('Share failed', err);
  }
  // 303: open the app with a normal GET
  return Response.redirect('/#photos', 303);
}
