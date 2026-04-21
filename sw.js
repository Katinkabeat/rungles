// Service worker for PWA installability + update notification.
// Bump CACHE_VERSION on every deploy that changes user-visible code so the
// browser detects the SW as new and installs it in the waiting state. The
// page (sw-update.js) listens for that, shows a banner, and lets the user
// trigger SKIP_WAITING when they're ready to reload into the new version.

const CACHE_VERSION = 'rungles-v6';

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

// ── Push notifications ─────────────────────────────────────────
// Fires when the server sends a Web Push. Shows an OS-level notification
// unless the user is already focused on the game this push is about.

self.addEventListener('push', (event) => {
  let data = { title: 'Rungles', body: 'Your turn!' };
  try { if (event.data) data = event.data.json(); } catch (_) {}

  const tag = data.tag || 'rungles-turn';
  const options = {
    body: data.body,
    icon: '/rungles/favicon.svg',
    badge: '/rungles/favicon.svg',
    tag,
    renotify: true,
    data: { url: data.url || '/rungles/' },
  };

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      // Don't re-alert if the user is already looking at the specific game page.
      const targetUrl = data.url || '';
      const focused = wins.some(c =>
        c.visibilityState === 'visible' && c.focused
        && targetUrl && c.url.includes(targetUrl)
      );
      if (focused) return;
      return self.registration.showNotification(data.title, options);
    })
  );
});

// Tapping a notification focuses the right tab (or opens one).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/rungles/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      for (const client of wins) {
        if (client.url.includes('/rungles/') && 'focus' in client) {
          return client.focus().then(c => c.postMessage({ type: 'NAVIGATE', url: targetUrl }));
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
