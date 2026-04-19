// Minimal service worker for PWA installability.
// Doesn't cache anything yet; we let the browser HTTP cache do its job.
// Bump CACHE_VERSION later if we add a cache layer and need to bust it.

const CACHE_VERSION = 'rungles-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Pass-through fetch handler. Required for the install prompt criteria
// even though we're not actually caching anything.
self.addEventListener('fetch', () => {
  // Let the browser handle it normally.
});
