// Service worker registration. The SW itself (sw.js) handles PWA install
// + Web Push events; version updates are applied by the user via
// Settings → Reload app (see settings toggle in index.html), so no banner
// or auto-reload logic lives here anymore.

(function () {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.warn('Service worker registration failed:', err);
    });
  });
})();
