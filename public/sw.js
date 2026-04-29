// Service worker for PWA installability + push notifications.
// Bump CACHE_VERSION on every deploy that changes user-visible code so the
// browser detects the SW as new and activates it. Phase 4 of the React port
// switches to skipWaiting + clients.claim so users get the new version on
// the first reload after install — no two-reload dance.

const CACHE_VERSION = 'rungles-v18';

self.addEventListener('install', (event) => {
  // Take over from the previous SW immediately on the next reload.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
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
