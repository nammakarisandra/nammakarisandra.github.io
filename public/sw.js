// Service worker: app shell works offline; ward data falls back to the last copy seen.
const VERSION = 'nw-v2';
const SHELL = [
  // Relative paths so the app also works from a sub-folder (GitHub Pages).
  './', 'index.html', 'css/app.css', 'js/app.js', 'js/api.js', 'js/i18n.js', 'js/core.js', 'js/mode.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // POSTs go to the network; the app keeps its own outbox
  const url = new URL(req.url);

  // API and map tiles: network first, fall back to cache.
  if (url.pathname.includes('/api/') || url.pathname.endsWith('/data/wards.json') || url.hostname.endsWith('tile.openstreetmap.org')) {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION + '-data').then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || new Response('{"error":"offline"}', { status: 503, headers: { 'Content-Type': 'application/json' } }))));
    return;
  }
  // Page navigations: serve the shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('index.html')));
    return;
  }
  // Static files: network first so releases show at once, cache when offline.
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req)));
});
