// Service worker for PWA installability + update notification.
// Bump CACHE_VERSION on every deploy that changes user-visible code so the
// browser detects the SW as new and installs it in the waiting state. The
// page (sw-update.js) listens for that, shows a banner, and lets the user
// trigger SKIP_WAITING when they're ready to reload into the new version.

const CACHE_VERSION = 'rungles-v4';

self.addEventListener('install', () => {
  // Intentionally NOT calling skipWaiting() — wait for the page to ask. That
  // way the user controls when an update lands instead of getting reloaded
  // mid-turn.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Pass-through fetch handler — required for the install prompt criteria.
self.addEventListener('fetch', () => {});
