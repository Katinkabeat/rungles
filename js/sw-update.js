// Service worker registration + "new version available" update banner.
// When sw.js changes (bumped CACHE_VERSION on deploy), the browser installs it
// in the waiting state and we show a banner the user can tap to reload.

(function () {
  if (!('serviceWorker' in navigator)) return;

  let bannerShown = false;
  let refreshing = false;

  function showUpdateBanner(worker) {
    if (bannerShown) return;
    bannerShown = true;

    const banner = document.createElement('div');
    banner.className = 'update-banner';
    banner.setAttribute('role', 'status');

    const msg = document.createElement('span');
    msg.className = 'update-banner-msg';
    msg.textContent = 'New version available';
    banner.appendChild(msg);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'update-banner-btn';
    btn.textContent = 'Update';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = 'Updating…';
      worker.postMessage({ type: 'SKIP_WAITING' });
    });
    banner.appendChild(btn);

    document.body.appendChild(banner);
  }

  // When the new SW takes control, reload the page to pick up fresh HTML/JS.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      // Already-waiting case: the new SW finished installing while the page
      // was closed, so it's sitting in waiting state on first load.
      if (reg.waiting && navigator.serviceWorker.controller) {
        showUpdateBanner(reg.waiting);
      }

      // Live case: a new SW starts installing while the page is open.
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner(newWorker);
          }
        });
      });
    }).catch(err => {
      console.warn('Service worker registration failed:', err);
    });
  });
})();
