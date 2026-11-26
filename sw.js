/* Offline app shell. Bump VERSION whenever you deploy changes so devices pick them up. */
const VERSION = 'jd-v2.0.0';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './css/base.css', './css/lock.css', './css/app.css', './css/chat.css',
  './js/main.js', './js/config.js', './js/state.js', './js/utils.js', './js/firebase.js', './js/fx.js',
  './js/notify.js', './js/recorder.js', './js/auth.js', './js/home.js', './js/memories.js', './js/chat.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
/* Same-origin files: stale-while-revalidate. Firebase, fonts, images and video always go to the network. */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const cached = await cache.match(req);
    const net = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => cached);
    return cached || net;
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./');
  }));
});
