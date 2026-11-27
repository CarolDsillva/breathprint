// @ts-check
/// <reference lib="webworker" />
/**
 * Offline support. Network first (so people always get the latest version online), falling
 * back to the cached app when offline. API calls are never cached: forecasts and AI answers
 * must be fresh, and they may contain the family's plan.
 */
const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));
const CACHE = 'breathprint-v3';
const SHELL = [
  '/',
  '/styles.css',
  '/manifest.webmanifest',
  '/icon.svg',
  '/fonts/Geist-Variable.woff2',
  '/fonts/GeistMono-Variable.woff2',
  '/js/app.js',
  '/js/api.js',
  '/js/dom.js',
  '/js/types.js',
  '/js/state.js',
  '/js/components.js',
  '/js/editor.js',
  '/js/editor-cards.js',
  '/js/editor-fields.js',
  '/js/home-settings.js',
  '/js/forecast-panel.js',
  '/js/budget-view.js',
  '/js/budget-panel.js',
  '/js/ripple-panel.js',
  '/js/briefing-panel.js',
  '/js/whatif-panel.js',
  '/js/room-panel.js',
  '/js/scan.js',
  '/engine/index.js',
  '/engine/constants.js',
  '/engine/time.js',
  '/engine/dose.js',
  '/engine/emissions.js',
  '/engine/scenario.js',
  '/engine/optimizer.js',
  '/engine/room.js',
  '/engine/intent.js',
  '/engine/validate.js',
  '/engine/sample.js',
  '/engine/impact.js',
  '/engine/scan.js',
];

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== sw.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(
        async () =>
          (await caches.match(req)) ??
          (req.mode === 'navigate' ? await caches.match('/') : undefined) ??
          Response.error(),
      ),
  );
});
