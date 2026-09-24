/* OOC reviewer app – service worker.
   Network first for the page, code and design, so every update reaches reviewers on their next open;
   the cached copy is used only without a connection. Supabase (data, login, voice notes) is never cached. */
const VERSION = 'ooc-review-v7';
const SHELL = ['/', '/app.js?v=7', '/app.css?v=7', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('ooc-review') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
const networkFirst = (req, key) => fetch(req).then(res => {
  if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(key || req, copy)); }
  return res;
}).catch(() => caches.match(key || req));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return;   // live data only
  if (req.mode === 'navigate') { e.respondWith(networkFirst(req, '/')); return; }
  if (url.origin === location.origin) {
    if (req.destination === 'script' || req.destination === 'style') { e.respondWith(networkFirst(req)); return; }
    e.respondWith(caches.match(req).then(hit => hit || networkFirst(req)));                  // icons, manifest
    return;
  }
  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {             // pinned library + fonts
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    })));
  }
});
