// Rungles multiplayer: lobby, waiting room, view orchestration.
// Authentication is owned by the SideQuest hub at /games/ — unauthed users
// are redirected there on boot. The username/logout helpers below assume a
// session is always present by the time render() runs.

import { supabase } from './supabase-client.js';
import { startMatch, stopMatch } from './match.js';
// Push notification opt-in lives in the SideQuest hub
// (rae-side-quest/src/lib/pushNotifications.js). Rungles no longer renders
// its own notification banner — friends are auto-migrated to the unified
// SideQuest subscription on their next hub visit.
import { openStatsModal } from './game.js';

const els = {
  authUser:   () => document.querySelector('.auth-username'),
  authLogout: () => document.querySelector('.auth-logout'),
  userBar:    () => document.querySelector('.settings-wrap'),
  landing:    () => document.querySelector('.landing'),
  playSolo:   () => document.querySelector('.play-solo'),
  soloMode:   () => document.querySelector('.solo-mode'),
  soloBack:   () => document.querySelector('.solo-mode .menu-back'),
  multiMode:  () => document.querySelector('.multi-mode'),
  lobbyList:  () => document.querySelector('.lobby-list'),
  lobbyEmpty: () => document.querySelector('.lobby-empty'),
  lobbyCreate:() => document.querySelector('.lobby-create'),
  waiting:    () => document.querySelector('.waiting-room'),
  waitingMsg: () => document.querySelector('.waiting-message'),
  waitingLeave:() => document.querySelector('.waiting-leave'),
};

const state = {
  session: null,
  profile: null,
  view: 'menu',           // 'menu' | 'solo' | 'multi'. Multi is any in-game state (waiting or active).
  currentGameId: null,    // game we've created/joined while waiting OR playing
  matchActive: false,     // true once status='active' and match view is up
  lobbySub: null,         // realtime channel subscription on rg_games
  gameSub: null,          // realtime channel for our specific waiting game
};

// ---------- view orchestration ----------

// Top-level view state. Auth gates everything: nothing else renders until signed in.
function render() {
  // Phase 2: auth is owned by the SideQuest hub, so by the time render()
  // runs we always have a session. Keep the .authed-only/.anon-only toggles
  // so any legacy markup behaves correctly during the brief window between
  // page load and the redirect-to-hub for an unauthed visitor.
  const authed = !!state.session;

  document.querySelectorAll('.authed-only').forEach(el => el.classList.toggle('hidden', !authed));
  document.querySelectorAll('.anon-only').forEach(el => el.classList.toggle('hidden', authed));

  els.landing().classList.toggle('hidden', !authed || state.view !== 'menu');
  els.soloMode().classList.toggle('hidden', !authed || state.view !== 'solo');
  els.multiMode().classList.toggle('hidden', !authed || state.view !== 'multi');

  if (!authed) return;

  if (state.view === 'menu') {
    refreshLobby();
  } else if (state.view === 'multi') {
    // Waiting room only when we're in a game but not yet in active play.
    els.waiting().classList.toggle('hidden', !state.currentGameId || state.matchActive);
  }
}

function setView(view) {
  state.view = view;
  render();
}

function goToMenu() {
  state.currentGameId = null;
  state.matchActive = false;
  unsubscribeGame();
  stopMatch();
  setView('menu');
}

function startSolo() {
  // Solo game auto-deals on page load and preserves state across menu visits.
  // Play Again (in the endgame modal) is the way to start a fresh hand.
  setView('solo');
}

// ---------- auth ----------

async function loadProfile() {
  if (!state.session) return;
  const { data } = await supabase
    .from('profiles')
    .select('username, avatar_hue')
    .eq('id', state.session.user.id)
    .maybeSingle();
  state.profile = data
    ? { ...data, avatar_hue: data.avatar_hue ?? 270 }
    : { username: state.session.user.email, avatar_hue: 270 };
  if (els.authUser()) els.authUser().textContent = state.profile.username;
  updateAvatar();

  // Push notification opt-in is handled by the SideQuest hub, not here.
}

// ---------- avatar ----------

const AVATAR_HUES = [270, 330, 190, 30, 160, 10];

function getInitials(name) {
  return (name || '?').slice(0, 2).toUpperCase();
}

function updateAvatar() {
  const hue = state.profile?.avatar_hue ?? 270;
  const name = state.profile?.username ?? '…';
  const initials = getInitials(name);
  const bg = `hsl(${hue}, 70%, 55%)`;

  const btn = document.querySelector('.avatar-btn');
  if (btn) btn.style.background = bg;
  const ini = document.querySelector('.avatar-initials');
  if (ini) ini.textContent = initials;
  const preview = document.querySelector('.avatar-preview');
  if (preview) { preview.style.background = bg; preview.textContent = initials; }
  const nameLabel = document.querySelector('.avatar-dropdown-name');
  if (nameLabel) nameLabel.textContent = name;
  updateHuePickerSelection();
}

function updateHuePickerSelection() {
  const current = state.profile?.avatar_hue ?? 270;
  document.querySelectorAll('.hue-swatch').forEach(b => {
    b.classList.toggle('selected', Number(b.dataset.hue) === current);
  });
}

function wireAvatar() {
  const wrap = document.querySelector('.avatar-wrap');
  const btn = wrap?.querySelector('.avatar-btn');
  const menu = wrap?.querySelector('.avatar-dropdown');
  const picker = wrap?.querySelector('.hue-picker');
  const statsBtn = wrap?.querySelector('.avatar-stats-btn');
  const settingsWrap = document.querySelector('.settings-wrap');
  const settingsMenu = settingsWrap?.querySelector('.settings-dropdown');
  const settingsToggle = settingsWrap?.querySelector('.settings-toggle');
  if (!wrap || !btn || !menu || !picker) return;

  picker.innerHTML = AVATAR_HUES.map(h =>
    `<button class="hue-swatch" type="button" data-hue="${h}" style="background: hsl(${h}, 70%, 55%)" aria-label="Hue ${h}"></button>`
  ).join('');
  updateHuePickerSelection();

  const closeAvatar = () => {
    menu.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
  };
  const openAvatar = () => {
    menu.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
    // Close settings if open
    settingsMenu?.classList.add('hidden');
    settingsToggle?.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.contains('hidden') ? openAvatar() : closeAvatar();
  });
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) closeAvatar();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAvatar();
  });

  picker.addEventListener('click', async (e) => {
    const swatch = e.target.closest('.hue-swatch');
    if (!swatch || !state.session) return;
    const hue = Number(swatch.dataset.hue);
    const prev = state.profile?.avatar_hue ?? 270;
    state.profile.avatar_hue = hue;
    updateAvatar();
    const { error } = await supabase
      .from('profiles')
      .update({ avatar_hue: hue })
      .eq('id', state.session.user.id);
    if (error) {
      state.profile.avatar_hue = prev;
      updateAvatar();
    }
  });

  statsBtn?.addEventListener('click', () => {
    closeAvatar();
    openStatsModal().catch(err => console.error(err));
  });
}

async function handleLogout() {
  await supabase.auth.signOut();
  // The onAuthStateChange listener (registered at the bottom of
  // initMultiplayer) sees the cleared session and redirects to the SideQuest
  // hub. No need to clean up local state — we're navigating away.
}

// ---------- lobby ----------

async function refreshLobby() {
  // rg_players.user_id references auth.users (not profiles), so PostgREST can't
  // auto-join to profiles. Fetch usernames in a second query and merge.
  // Pull both 'waiting' games (for joining) and 'active' games (for resuming
  // matches you're already in after a refresh).
  const { data: games, error } = await supabase
    .from('rg_games')
    .select(`
      id, status, created_at, total_rungs, max_players,
      rg_players ( user_id, player_idx )
    `)
    .in('status', ['waiting', 'active'])
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('refreshLobby:', error);
    const list = els.lobbyList();
    list.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'lobby-error';
    p.textContent = `Couldn't load games: ${error.message}`;
    list.append(p);
    return;
  }

  // Active games are only relevant if you're a player (otherwise they're
  // someone else's match and there's nothing to do with them).
  const me = state.session.user.id;
  const visible = (games ?? []).filter(g =>
    g.status === 'waiting' ||
    (g.status === 'active' && (g.rg_players ?? []).some(p => p.user_id === me))
  );

  const userIds = [...new Set(visible.flatMap(g => (g.rg_players ?? []).map(p => p.user_id)))];
  let usernameById = {};
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username')
      .in('id', userIds);
    usernameById = Object.fromEntries((profiles ?? []).map(p => [p.id, p.username]));
  }

  renderLobby(visible, usernameById);
}

function renderLobby(games, usernameById = {}) {
  const list = els.lobbyList();
  list.innerHTML = '';
  if (games.length === 0) {
    els.lobbyEmpty().classList.remove('hidden');
    return;
  }
  els.lobbyEmpty().classList.add('hidden');

  games.forEach(g => {
    const row = document.createElement('div');
    row.className = 'lobby-row';

    const me = state.session.user.id;
    const players = g.rg_players ?? [];
    const isMine = players.some(p => p.user_id === me);
    const creator = players.find(p => p.player_idx === 0);
    const creatorName = usernameById[creator?.user_id] ?? 'Someone';

    const meta = document.createElement('div');
    meta.className = 'lobby-meta';
    const statusLabel = g.status === 'active' ? 'In progress' : `${players.length}/${g.max_players}`;
    meta.innerHTML = `
      <span class="lobby-creator">${escapeHtml(creatorName)}</span>
      <span class="lobby-detail">${g.total_rungs} rungs · ${statusLabel}</span>
      <span class="lobby-time">${timeAgo(g.created_at)}</span>
    `;

    const action = document.createElement('button');
    action.className = 'btn btn-primary lobby-action';
    action.type = 'button';
    if (isMine) {
      action.textContent = 'Resume';
      action.addEventListener('click', () => enterWaitingRoom(g.id, 'Resuming…'));
    } else {
      action.textContent = 'Join';
      action.addEventListener('click', () => handleJoin(g.id));
    }

    row.append(meta, action);
    list.append(row);
  });
}

async function handleCreate() {
  els.lobbyCreate().disabled = true;
  const { data, error } = await supabase.rpc('rg_create_game', { p_total_rungs: 10 });
  els.lobbyCreate().disabled = false;
  if (error) {
    alert(`Couldn't create game: ${error.message}`);
    return;
  }
  enterWaitingRoom(data, 'Waiting for opponent…');
}

async function handleJoin(gameId) {
  const { error } = await supabase.rpc('rg_join_game', { p_game_id: gameId });
  if (error) {
    alert(`Couldn't join: ${error.message}`);
    refreshLobby();
    return;
  }
  enterWaitingRoom(gameId, 'Joined! Starting…');
}

// ---------- waiting room ----------

async function enterWaitingRoom(gameId, message) {
  state.currentGameId = gameId;
  state.matchActive = false;
  state.view = 'multi';
  els.waitingMsg().textContent = message;
  render();
  // If the game is already active (we just joined the second slot), jump straight in.
  const { data: game } = await supabase
    .from('rg_games').select('status').eq('id', gameId).maybeSingle();
  if (game?.status === 'active') {
    enterMatch(gameId);
  } else {
    subscribeGame(gameId);
  }
}

function leaveWaitingRoom() {
  goToMenu();
}

function enterMatch(gameId) {
  unsubscribeGame();
  state.matchActive = true;
  state.view = 'multi';
  els.waiting().classList.add('hidden');
  startMatch(gameId, state.session, () => goToMenu());
  render();
}

// ---------- realtime ----------

function subscribeLobby() {
  unsubscribeLobby();
  state.lobbySub = supabase
    .channel('lobby_rg_games')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'rg_games' },
      () => { if (!state.currentGameId) refreshLobby(); })
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'rg_players' },
      () => { if (!state.currentGameId) refreshLobby(); })
    .subscribe();
}

function unsubscribeLobby() {
  if (state.lobbySub) {
    supabase.removeChannel(state.lobbySub);
    state.lobbySub = null;
  }
}

function subscribeGame(gameId) {
  unsubscribeGame();
  state.gameSub = supabase
    .channel(`rg_game_${gameId}`)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'rg_games', filter: `id=eq.${gameId}` },
      payload => {
        if (payload.new.status === 'active') enterMatch(gameId);
      })
    .subscribe();
}

function unsubscribeGame() {
  if (state.gameSub) {
    supabase.removeChannel(state.gameSub);
    state.gameSub = null;
  }
}

// ---------- helpers ----------

function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// ---------- deep-link handling ----------

async function handleDeepLink() {
  if (!state.session) return;
  const params = new URLSearchParams(window.location.search);
  const gameId = params.get('game');
  if (!gameId) return;
  // Clear the query param so a later refresh doesn't re-trigger it.
  const clean = window.location.pathname + window.location.hash;
  window.history.replaceState({}, '', clean);
  // Enter waiting room; if the game's already active it'll jump straight to match.
  enterWaitingRoom(gameId, 'Loading game…');
}

// ---------- boot ----------

function redirectToSqLogin() {
  const ret = window.location.pathname + window.location.search;
  const url = `${window.location.origin}/games/?return=${encodeURIComponent(ret)}`;
  window.location.replace(url);
}

export async function initMultiplayer() {
  // Pick up an existing session (shared across all SideQuest games via
  // localStorage on this origin). Phase 2: with no in-app login form left,
  // unauthed users are unconditionally routed to the SQ hub.
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    redirectToSqLogin();
    return;
  }
  state.session = data.session;

  // Wire up menu / back buttons.
  els.playSolo().addEventListener('click', startSolo);
  els.soloBack().addEventListener('click', goToMenu);

  // Logout is reachable from the in-app settings dropdown.
  els.authLogout().addEventListener('click', handleLogout);

  // Lobby + waiting room buttons.
  els.lobbyCreate().addEventListener('click', handleCreate);
  els.waitingLeave().addEventListener('click', leaveWaitingRoom);

  // Wire up avatar button + hue picker + stats link.
  wireAvatar();

  await loadProfile();
  subscribeLobby();

  // Deep-link: push notifications carry ?game=<id> so tapping one drops you
  // straight into that match (if you're authed and in it).
  await handleDeepLink();
  render();

  // SW posts NAVIGATE when the user taps a notification while the tab is open.
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'NAVIGATE' && e.data.url) {
      const match = e.data.url.match(/[?&]game=([0-9a-f-]+)/i);
      if (match && state.session) enterWaitingRoom(match[1], 'Resuming…');
    }
  });
  // Real render is in charge now; drop the prepaint hint so toggling panels
  // (sign in / log out / mode switch) isn't fighting !important rules.
  delete document.documentElement.dataset.prepaint;

  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session) {
      // Logout or session loss bounces the user to the SQ hub login. The
      // ?return= param brings them back here on re-authentication.
      redirectToSqLogin();
      return;
    }
    state.session = session;
    render();
  });
}
