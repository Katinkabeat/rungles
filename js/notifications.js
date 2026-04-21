// Web Push client for Rungles. Mirrors Wordy's flow:
//   1. Register the service worker (sw.js already handles push events).
//   2. Ask for Notification permission.
//   3. Subscribe via pushManager with the same VAPID public key Wordy uses
//      (same Supabase project = same VAPID pair).
//   4. Upsert the subscription into the shared push_subscriptions table.
//
// Exposed through window.rgNotifications so the vanilla multiplayer module
// can call it without ES-module plumbing.

import { supabase } from './supabase-client.js';

// Public key — this is safe to embed in the client (that's how Web Push works).
// It matches Wordy's VITE_VAPID_PUBLIC_KEY since both apps share the Supabase
// project and therefore share the VAPID keypair.
const VAPID_PUBLIC_KEY = 'BCIDqV3c-WrF0HXoeZDJMWCDwr8Ho8L0kOrKdok4LB1cjUpiilEYfiASeqM5kIoKU1J03L-UoS7TJfPZw9f40Ck';

// 'unsupported' | 'granted' | 'denied' | 'default'
export function getPushPermissionState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  return Notification.permission;
}

export async function hasActivePushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  try {
    const sw = await navigator.serviceWorker.ready;
    const sub = await sw.pushManager.getSubscription();
    return !!sub;
  } catch { return false; }
}

export async function subscribeToPush(userId) {
  if (!userId) return false;
  try {
    // sw.js is registered by sw-update.js already; just wait for ready.
    const sw = await navigator.serviceWorker.ready;
    let sub = await sw.pushManager.getSubscription();
    if (!sub) {
      sub = await sw.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    return await saveSubscription(userId, sub);
  } catch (err) {
    console.error('rg subscribeToPush failed:', err);
    return false;
  }
}

export async function unsubscribeFromPush(userId) {
  try {
    const sw = await navigator.serviceWorker.ready;
    const sub = await sw.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    if (userId) await supabase.from('push_subscriptions').delete().eq('user_id', userId);
    return true;
  } catch (err) {
    console.error('rg unsubscribeFromPush failed:', err);
    return false;
  }
}

// Endpoints can silently change (browser update, PWA reinstall) — upsert the
// current subscription so the server always has the fresh one.
export async function resyncPushSubscription(userId) {
  if (!userId || !('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  try {
    const sw = await navigator.serviceWorker.ready;
    const sub = await sw.pushManager.getSubscription();
    if (!sub) return false;
    return await saveSubscription(userId, sub);
  } catch (err) {
    console.error('rg resyncPushSubscription failed:', err);
    return false;
  }
}

async function saveSubscription(userId, subscription) {
  const json = subscription.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: userId,
    endpoint: json.endpoint,
    keys_p256dh: json.keys.p256dh,
    keys_auth: json.keys.auth,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) {
    console.error('rg saveSubscription failed:', error);
    return false;
  }
  return true;
}

// ── iOS install detection ──────────────────────────────────────

export function isIOS() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  // iPad on iOS 13+ pretends to be Mac, use touch-point heuristic.
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
  return false;
}

export function isInStandaloneMode() {
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  if (navigator.standalone === true) return true;
  return false;
}

export function isSafariBrowser() {
  const ua = navigator.userAgent;
  const isSafari = /Safari/.test(ua);
  const isOther = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(ua);
  return isSafari && !isOther;
}

// ── Banner UI ──────────────────────────────────────────────────
// Renders two possible prompts into #rg-notif-mount:
//   1. iOS install prompt (only if iOS Safari + not installed + not dismissed)
//   2. Push permission prompt (only if supported + not denied + not dismissed)
// Call init() once after sign-in; it handles show/hide/re-render itself.

const PUSH_DISMISS_KEY = 'rungles-push-dismissed';
const IOS_DISMISS_KEY  = 'rungles-ios-install-dismissed';

export async function initNotificationBanner(userId) {
  const mount = document.querySelector('.rg-notif-mount');
  if (!mount) return;

  async function render() {
    mount.innerHTML = '';

    // iOS install prompt takes priority: push won't work on iOS until PWA is installed.
    if (isIOS() && !isInStandaloneMode() && localStorage.getItem(IOS_DISMISS_KEY) !== 'true') {
      mount.append(renderIosPrompt());
      return;
    }

    const perm = getPushPermissionState();
    if (perm === 'unsupported' || perm === 'denied') return;

    let active = await hasActivePushSubscription();

    // Heal: if permission is still granted but there's no local subscription,
    // the SW was likely unregistered at some point (or the browser dropped
    // the sub). Silently re-subscribe so the user doesn't have to tap Enable
    // again — their intent hasn't changed.
    if (!active && perm === 'granted' && userId) {
      active = await subscribeToPush(userId);
    }

    if (active) {
      if (userId) resyncPushSubscription(userId);
      mount.append(renderEnabled(async () => {
        await unsubscribeFromPush(userId);
        render();
      }));
      return;
    }

    if (localStorage.getItem(PUSH_DISMISS_KEY) === 'true') {
      mount.append(renderMiniPrompt(async () => {
        const ok = await subscribeToPush(userId);
        if (ok) render();
      }));
      return;
    }

    mount.append(renderFullPrompt(
      async () => { if (await subscribeToPush(userId)) render(); },
      () => { localStorage.setItem(PUSH_DISMISS_KEY, 'true'); render(); }
    ));
  }

  render();
}

function card(extraClass = '') {
  const el = document.createElement('div');
  el.className = ('card notif-card ' + extraClass).trim();
  return el;
}

function renderFullPrompt(onEnable, onDismiss) {
  const el = card();
  el.innerHTML = `
    <div class="notif-row">
      <span class="notif-icon">🔔</span>
      <div class="notif-body">
        <p class="notif-title">Never miss your turn!</p>
        <p class="notif-sub">Get a ping when your opponent plays.</p>
        <div class="notif-actions">
          <button type="button" class="btn btn-primary notif-enable">Enable notifications</button>
          <button type="button" class="notif-skip">Not now</button>
        </div>
      </div>
    </div>`;
  el.querySelector('.notif-enable').addEventListener('click', onEnable);
  el.querySelector('.notif-skip').addEventListener('click', onDismiss);
  return el;
}

function renderMiniPrompt(onEnable) {
  const el = document.createElement('div');
  el.className = 'notif-mini';
  el.innerHTML = `<button type="button" class="notif-mini-btn">🔔 Enable turn notifications</button>`;
  el.querySelector('.notif-mini-btn').addEventListener('click', onEnable);
  return el;
}

function renderEnabled(onDisable) {
  const el = card('notif-card-on');
  el.innerHTML = `
    <div class="notif-row notif-row-compact">
      <span class="notif-icon">🔔</span>
      <span class="notif-title">Notifications are on</span>
      <button type="button" class="notif-off">Turn off</button>
    </div>`;
  el.querySelector('.notif-off').addEventListener('click', onDisable);
  return el;
}

function renderIosPrompt() {
  const el = card();
  const safari = isSafariBrowser();
  if (!safari) {
    el.innerHTML = `
      <div class="notif-row">
        <span class="notif-icon">📲</span>
        <div class="notif-body">
          <p class="notif-title">Want notifications on your iPhone?</p>
          <p class="notif-sub">Open Rungles in <strong>Safari</strong> to install it to your Home Screen. Push notifications only work from the Home Screen app on iOS.</p>
          <div class="notif-actions">
            <button type="button" class="notif-skip">Dismiss</button>
          </div>
        </div>
      </div>`;
  } else {
    el.innerHTML = `
      <div class="notif-row">
        <span class="notif-icon">📲</span>
        <div class="notif-body">
          <p class="notif-title">Install Rungles for notifications!</p>
          <p class="notif-sub">Add Rungles to your Home Screen to get push notifications when it's your turn.</p>
          <ol class="notif-steps">
            <li>Tap the <strong>Share</strong> button ⬆ at the bottom of Safari.</li>
            <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
            <li>Tap <strong>Add</strong> in the top-right.</li>
            <li>Open Rungles from your Home Screen and enable notifications.</li>
          </ol>
          <div class="notif-actions">
            <button type="button" class="notif-skip">Don't show again</button>
          </div>
        </div>
      </div>`;
  }
  el.querySelector('.notif-skip').addEventListener('click', () => {
    localStorage.setItem(IOS_DISMISS_KEY, 'true');
    const mount = document.querySelector('.rg-notif-mount');
    if (mount) mount.innerHTML = '';
  });
  return el;
}

// ── util ───────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
