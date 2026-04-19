// Rungles multiplayer: auth, lobby, waiting room. Phase A is lobby only.
// Turn-by-turn play (rg_submit_rung wiring) is the next chunk.

import { supabase } from './supabase-client.js';
import { startMatch, stopMatch } from './match.js';

const els = {
  authGate:   () => document.querySelector('.auth-gate'),
  authForm:   () => document.querySelector('.auth-form'),
  authEmail:  () => document.querySelector('.auth-email'),
  authPass:   () => document.querySelector('.auth-password'),
  authError:  () => document.querySelector('.auth-error'),
  authUser:   () => document.querySelector('.auth-username'),
  authLogout: () => document.querySelector('.auth-logout'),
  userBar:    () => document.querySelector('.user-bar'),
  modeToggle: () => document.querySelector('.mode-toggle'),
  modeSolo:   () => document.querySelector('[data-mode="solo"]'),
  modeMulti:  () => document.querySelector('[data-mode="multi"]'),
  soloMode:   () => document.querySelector('.solo-mode'),
  multiMode:  () => document.querySelector('.multi-mode'),
  lobby:      () => document.querySelector('.lobby-panel'),
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
  mode: 'solo',           // last selected mode, restored on sign-in
  currentGameId: null,    // game we've created/joined while waiting OR playing
  matchActive: false,     // true once status='active' and match view is up
  lobbySub: null,         // realtime channel subscription on rg_games
  gameSub: null,          // realtime channel for our specific waiting game
  captchaToken: null,     // Turnstile token, required by Supabase auth on this project
};

// Cloudflare Turnstile callbacks (the widget invokes these on the global scope).
window.rgTurnstileCb = (token) => { state.captchaToken = token; };
window.rgTurnstileExpired = () => { state.captchaToken = null; };

// Shared with Wordy. Cloudflare locks site keys to allowed hostnames, so
// localhost / new deploy domains must be added to this key's allow-list in the
// Cloudflare Turnstile dashboard or the widget fails with error 110200.
const TURNSTILE_SITE_KEY = '0x4AAAAAACrUqndWqt4-0ExK';

function mountTurnstile() {
  const mount = document.querySelector('.auth-turnstile-mount');
  if (!mount || mount.dataset.mounted) return;
  // Wait until the API has loaded; it's async/defer.
  if (!window.turnstile) {
    setTimeout(mountTurnstile, 200);
    return;
  }
  window.turnstile.render(mount, {
    sitekey: TURNSTILE_SITE_KEY,
    callback: window.rgTurnstileCb,
    'expired-callback': window.rgTurnstileExpired,
    'error-callback': window.rgTurnstileExpired,
  });
  mount.dataset.mounted = '1';
}

// ---------- view orchestration ----------

// Top-level view state. Auth gates everything: nothing else renders until signed in.
function render() {
  const authed = !!state.session;

  els.authGate().classList.toggle('hidden', authed);
  els.userBar().classList.toggle('hidden', !authed);
  els.modeToggle().classList.toggle('hidden', !authed);
  els.soloMode().classList.toggle('hidden', !authed || state.mode !== 'solo');
  els.multiMode().classList.toggle('hidden', !authed || state.mode !== 'multi');

  if (!authed) return;

  els.modeSolo().classList.toggle('active', state.mode === 'solo');
  els.modeMulti().classList.toggle('active', state.mode === 'multi');

  if (state.mode === 'multi') {
    const inGame = !!state.currentGameId;
    els.lobby().classList.toggle('hidden', inGame);
    // Waiting room only when we're in a game but not yet in active play.
    els.waiting().classList.toggle('hidden', !inGame || state.matchActive);
    if (!inGame) refreshLobby();
  }
}

function setMode(mode) {
  state.mode = mode;
  render();
}

// ---------- auth ----------

async function loadProfile() {
  if (!state.session) return;
  const { data } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', state.session.user.id)
    .maybeSingle();
  state.profile = data ?? { username: state.session.user.email };
  if (els.authUser()) els.authUser().textContent = state.profile.username;
}

async function handleSignIn(e) {
  e.preventDefault();
  const email = els.authEmail().value.trim();
  const password = els.authPass().value;
  els.authError().textContent = '';
  // Token can come from either the JS callback (state.captchaToken) or the
  // hidden input the widget injects. Prefer the input since it's authoritative.
  const tokenInput = document.querySelector('.auth-turnstile-mount input[name="cf-turnstile-response"]');
  const captchaToken = tokenInput?.value || state.captchaToken;
  if (!captchaToken) {
    els.authError().textContent = 'Please complete the CAPTCHA check first.';
    return;
  }
  const { data, error } = await supabase.auth.signInWithPassword({
    email, password,
    options: { captchaToken },
  });
  state.captchaToken = null;
  if (window.turnstile) window.turnstile.reset();
  if (error) {
    els.authError().textContent = error.message;
    return;
  }
  state.session = data.session;
  await loadProfile();
  render();
  subscribeLobby();
}

async function handleLogout() {
  await supabase.auth.signOut();
  state.session = null;
  state.profile = null;
  state.currentGameId = null;
  unsubscribeLobby();
  unsubscribeGame();
  render();
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
  state.currentGameId = null;
  state.matchActive = false;
  unsubscribeGame();
  stopMatch();
  render();
}

function enterMatch(gameId) {
  unsubscribeGame();
  state.matchActive = true;
  els.waiting().classList.add('hidden');
  els.lobby().classList.add('hidden');
  startMatch(gameId, state.session, () => leaveWaitingRoom());
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

// ---------- boot ----------

export async function initMultiplayer() {
  // Wire up mode toggle (works even before auth).
  els.modeSolo().addEventListener('click', () => setMode('solo'));
  els.modeMulti().addEventListener('click', () => setMode('multi'));

  // Wire up auth form / logout.
  els.authForm().addEventListener('submit', handleSignIn);
  els.authLogout().addEventListener('click', handleLogout);

  // Lobby + waiting room buttons.
  els.lobbyCreate().addEventListener('click', handleCreate);
  els.waitingLeave().addEventListener('click', leaveWaitingRoom);

  // Render the CAPTCHA widget into the form.
  mountTurnstile();

  // Pick up an existing session (e.g. from a previous Wordy login on this origin).
  // Cross-origin needs a separate sign-in.
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    state.session = data.session;
    await loadProfile();
    subscribeLobby();
  }
  render();
  // Real render is in charge now; drop the prepaint hint so toggling panels
  // (sign in / log out / mode switch) isn't fighting !important rules.
  delete document.documentElement.dataset.prepaint;

  supabase.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    if (!session) {
      state.profile = null;
      state.currentGameId = null;
    }
    render();
  });
}
