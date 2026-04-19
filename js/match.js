// Rungles multiplayer match controller. Owns one active rg_games row.
// Server is the source of truth: rack, bag, scores, ladder, premium position.

import { supabase } from './supabase-client.js';
import { LETTER_VALUES } from './tiles.js';

const MIN_WORD_LEN = 4;
const CARRY_REQUIRED = 3;

const els = {
  view:        () => document.querySelector('.match-mode'),
  scoreYou:    () => document.querySelector('.match-score-you'),
  scoreOpp:    () => document.querySelector('.match-score-opp'),
  turn:        () => document.querySelector('.match-turn'),
  rungInfo:    () => document.querySelector('.match-rung-info'),
  ladder:      () => document.querySelector('.match-ladder'),
  premium:     () => document.querySelector('.match-premium'),
  wordInput:   () => document.querySelector('.match-word-input'),
  carried:     () => document.querySelector('.match-carried'),
  rack:        () => document.querySelector('.match-rack-tiles'),
  status:      () => document.querySelector('.match-status'),
  submitBtn:   () => document.querySelector('.match-submit'),
  clearBtn:    () => document.querySelector('.match-clear'),
  shuffleBtn:  () => document.querySelector('.match-shuffle'),
  skipBtn:     () => document.querySelector('.match-skip'),
  giveUpBtn:   () => document.querySelector('.match-giveup'),
  leaveBtn:    () => document.querySelector('.match-leave'),
  endModal:    () => document.querySelector('.endgame-modal'),
  endTitle:    () => document.querySelector('.endgame-modal .endgame-title'),
  endNumber:   () => document.querySelector('.endgame-modal .endgame-number'),
  endScoreLbl: () => document.querySelector('.endgame-modal .endgame-score'),
  endRungs:    () => document.querySelector('.endgame-modal .endgame-rungs'),
  endPlayAgain:() => document.querySelector('.endgame-modal .btn-playagain'),
};

let state = null;        // see resetState
let onLeave = null;      // callback to return to lobby
let channel = null;      // realtime subscription

function resetState(gameId, mySession) {
  state = {
    gameId,
    me: { userId: mySession.user.id, playerIdx: null, score: 0 },
    opponent: { userId: null, playerIdx: null, score: 0, username: 'Opponent' },
    game: null,                    // last rg_games row
    rack: [],                      // my tiles
    rungs: [],                     // all rg_rungs rows, sorted by rung_number asc
    selected: [],                  // [{ source: 'rack'|'carried', idx, letter }]
    premiumPos: null,              // for next rung (server-derived)
    submitting: false,
  };
}

// ---------- helpers ----------

function isMyTurn() {
  return state?.game?.status === 'active'
      && state.game.current_player_idx === state.me.playerIdx;
}

function carriedLetters() {
  if (state.rungs.length === 0) {
    // Rung 1 carries from the game's seed word, so it's symmetric with rung 2+.
    return (state.game?.seed_word ?? '').split('');
  }
  return state.rungs[state.rungs.length - 1].word.split('');
}

function currentWord() {
  return state.selected.map(s => s.letter).join('');
}

function carriedUsedCount() {
  return state.selected.filter(s => s.source === 'carried').length;
}

function nextRungNumber() {
  return state.rungs.length + 1;
}

// ---------- tile factory (duplicated from solo for now) ----------

function makeTile(letter, { ghost = false, premium = false, small = false } = {}) {
  const tile = document.createElement('button');
  tile.className = 'tile'
    + (ghost ? ' tile-ghost' : '')
    + (premium ? ' tile-premium' : '')
    + (small ? ' tile-small' : '');
  tile.type = 'button';
  tile.setAttribute('aria-label',
    letter === '_' ? 'Blank tile' : `Tile ${letter}, ${LETTER_VALUES[letter] ?? 0} points`);
  const face = document.createElement('span');
  face.className = 'tile-letter';
  face.textContent = letter === '_' ? '' : letter;
  const value = document.createElement('span');
  value.className = 'tile-value';
  value.textContent = LETTER_VALUES[letter] ?? 0;
  tile.append(face, value);
  return tile;
}

// ---------- render ----------

function render() {
  renderHeader();
  renderLadder();
  renderCurrent();
  renderRack();
  renderActions();
  renderStatus();
}

function renderHeader() {
  els.scoreYou().textContent = `You: ${state.me.score}`;
  els.scoreOpp().textContent = `${state.opponent.username}: ${state.opponent.score}`;
  if (state.game?.status === 'complete') {
    const youWon = state.game.winner_player_idx === state.me.playerIdx;
    els.turn().textContent = youWon ? '🎉 You won!' : `${state.opponent.username} won.`;
    els.turn().className = 'match-turn match-turn-done';
  } else if (isMyTurn()) {
    els.turn().textContent = 'Your turn';
    els.turn().className = 'match-turn match-turn-yours';
  } else {
    els.turn().textContent = `Waiting for ${state.opponent.username}...`;
    els.turn().className = 'match-turn match-turn-theirs';
  }
  els.rungInfo().textContent = `Rung ${Math.min(nextRungNumber(), state.game?.total_rungs ?? 10)} / ${state.game?.total_rungs ?? 10}`;
}

function renderLadder() {
  // Mid-game we only need the most recent rung (the carryover source) plus
  // the seed (which is the carryover source for rung 1). The endgame modal
  // shows the full ladder when the game ends.
  const ladder = els.ladder();
  ladder.innerHTML = '';
  if (state.rungs.length > 0) {
    const last = state.rungs[state.rungs.length - 1];
    const row = document.createElement('div');
    row.className = 'ladder-row';
    const who = last.player_user_id === state.me.userId ? 'You' : state.opponent.username;
    const label = document.createElement('span');
    label.className = 'ladder-label';
    label.textContent = `Rung ${last.rung_number} (${who})`;
    const word = document.createElement('span');
    word.className = 'ladder-word';
    word.textContent = last.word;
    const score = document.createElement('span');
    score.className = 'ladder-score';
    score.textContent = `+${last.rung_score}`;
    row.append(label, word, score);
    ladder.append(row);
  }
  // Seed word at the bottom.
  if (state.game?.seed_word) {
    const seedRow = document.createElement('div');
    seedRow.className = 'ladder-row ladder-seed';
    const label = document.createElement('span');
    label.className = 'ladder-label';
    label.textContent = 'Seed';
    const word = document.createElement('span');
    word.className = 'ladder-word';
    word.textContent = state.game.seed_word;
    const score = document.createElement('span');
    score.className = 'ladder-score';
    score.textContent = '—';
    seedRow.append(label, word, score);
    ladder.append(seedRow);
  }
}

function renderCurrent() {
  // Premium label
  els.premium().textContent = state.premiumPos ? `2× slot: position ${state.premiumPos}` : '2× slot: —';

  // Word input
  const input = els.wordInput();
  input.innerHTML = '';
  if (state.selected.length === 0) {
    const ph = document.createElement('span');
    ph.className = 'word-placeholder';
    ph.textContent = isMyTurn() ? 'Tap tiles to build a word' : 'Waiting for opponent...';
    input.append(ph);
  } else {
    state.selected.forEach((entry, pos) => {
      const isPremium = (pos + 1) === state.premiumPos && entry.source === 'rack';
      const tile = makeTile(entry.letter, { premium: isPremium });
      tile.classList.add('tile-in-word');
      if (entry.source === 'carried') tile.classList.add('tile-in-word-carried');
      tile.addEventListener('click', () => {
        if (!isMyTurn() || state.submitting) return;
        state.selected.splice(pos, 1);
        render();
      });
      input.append(tile);
    });
  }

  // Carried letters
  const carriedC = els.carried();
  carriedC.innerHTML = '';
  const carried = carriedLetters();
  if (carried.length === 0) {
    const lbl = document.createElement('div');
    lbl.className = 'carried-label';
    lbl.textContent = 'Carried: — (no source available)';
    carriedC.append(lbl);
  } else {
    const lbl = document.createElement('div');
    lbl.className = 'carried-label';
    const fromSeed = state.rungs.length === 0;
    lbl.textContent = fromSeed
      ? `Carried from seed (need ${CARRY_REQUIRED}):`
      : `Carried (need ${CARRY_REQUIRED}):`;
    carriedC.append(lbl);
    const row = document.createElement('div');
    row.className = 'carried-row';
    const usedIdxs = new Set(state.selected.filter(s => s.source === 'carried').map(s => s.idx));
    carried.forEach((letter, idx) => {
      const used = usedIdxs.has(idx);
      const tile = makeTile(letter, { ghost: used, small: true });
      tile.classList.add('tile-carried');
      tile.addEventListener('click', () => {
        if (used || !isMyTurn() || state.submitting) return;
        state.selected.push({ source: 'carried', idx, letter });
        render();
      });
      row.append(tile);
    });
    carriedC.append(row);
  }
}

function renderRack() {
  const container = els.rack();
  container.innerHTML = '';
  const usedIdxs = new Set(state.selected.filter(s => s.source === 'rack').map(s => s.idx));
  state.rack.forEach((letter, idx) => {
    const inWord = usedIdxs.has(idx);
    const tile = makeTile(letter, { ghost: inWord });
    tile.addEventListener('click', async () => {
      if (inWord || !isMyTurn() || state.submitting) return;
      let resolved = letter;
      if (letter === '_') {
        resolved = await pickBlankLetter();
        if (!resolved) return;
      }
      state.selected.push({ source: 'rack', idx, letter: resolved });
      render();
    });
    container.append(tile);
  });
}

function pickBlankLetter() {
  // Reuse the solo-mode blank modal; it's a bare <dialog> with a letter grid.
  return new Promise(resolve => {
    const modal = document.querySelector('.blank-modal');
    const grid = modal.querySelector('.letter-grid');
    grid.innerHTML = '';
    let settled = false;
    const finish = (letter) => {
      if (settled) return;
      settled = true;
      modal.close();
      resolve(letter);
    };
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'letter-btn';
      btn.textContent = letter;
      btn.addEventListener('click', () => finish(letter));
      grid.append(btn);
    }
    modal.querySelector('.modal-dismiss').onclick = () => finish(null);
    modal.addEventListener('close', () => finish(null), { once: true });
    modal.showModal();
  });
}

function renderActions() {
  const active = state.game?.status === 'active';
  const playable = isMyTurn() && active && !state.submitting;
  els.submitBtn().disabled = !playable;
  els.clearBtn().disabled = !playable || state.selected.length === 0;
  els.skipBtn().disabled = !playable;
  // Give Up only enabled while the game is live (either turn).
  els.giveUpBtn().disabled = !active || state.submitting;
  // Reset the give-up confirm state when the game ends.
  if (!active) resetGiveUpArm();
}

function renderStatus(msg, kind) {
  const s = els.status();
  if (!msg) { s.textContent = ''; s.className = 'match-status'; return; }
  s.textContent = msg;
  s.className = 'match-status ' + (kind === 'ok' ? 'banner-ok' : 'banner-bad');
}

// ---------- actions ----------

async function handleSubmit() {
  if (!isMyTurn() || state.submitting) return;
  const word = currentWord();
  if (word.length < MIN_WORD_LEN) {
    renderStatus(`Too short. Minimum ${MIN_WORD_LEN} letters.`, 'bad');
    return;
  }
  if (nextRungNumber() > 1 && carriedUsedCount() < CARRY_REQUIRED) {
    renderStatus(`Use at least ${CARRY_REQUIRED} carried letters (you used ${carriedUsedCount()}).`, 'bad');
    return;
  }

  // Build word_sources: 0 for carried, 1-based rack index otherwise.
  const sources = state.selected.map(s => s.source === 'carried' ? 0 : (s.idx + 1));

  state.submitting = true;
  renderActions();
  renderStatus('Submitting...', 'ok');

  const { data, error } = await supabase.rpc('rg_submit_rung', {
    p_game_id: state.gameId,
    p_word: word,
    p_word_sources: sources,
  });

  state.submitting = false;

  if (error) {
    renderStatus(error.message, 'bad');
    renderActions();
    return;
  }

  // Server accepted. Clear selection; realtime subscriptions will refresh
  // ladder, rack, scores, and turn.
  state.selected = [];
  renderStatus(`✓ ${word} +${data}`, 'ok');
  render();
}

function handleClear() {
  if (state.selected.length === 0) return;
  state.selected = [];
  render();
}

// Reorder rack tiles in place (visual only, no server effect). Tiles already
// pulled into the word builder keep their original index; only the unselected
// rack slots are shuffled, so the selected positions don't get scrambled.
function handleShuffle() {
  const selectedIdxs = new Set(state.selected.filter(s => s.source === 'rack').map(s => s.idx));
  const freeIdxs = state.rack.map((_, i) => i).filter(i => !selectedIdxs.has(i));
  const freeLetters = freeIdxs.map(i => state.rack[i]);
  for (let i = freeLetters.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [freeLetters[i], freeLetters[j]] = [freeLetters[j], freeLetters[i]];
  }
  freeIdxs.forEach((idx, k) => state.rack[idx] = freeLetters[k]);
  render();
}

async function handleSkip() {
  if (!isMyTurn() || state.submitting) return;
  state.submitting = true;
  renderActions();
  renderStatus('Skipping...', 'ok');
  const { error } = await supabase.rpc('rg_skip_turn', { p_game_id: state.gameId });
  state.submitting = false;
  if (error) {
    renderStatus(error.message, 'bad');
    renderActions();
    return;
  }
  state.selected = [];
  renderStatus('Turn skipped.', 'ok');
  render();
}

// Give Up uses the same double-tap confirm pattern as solo mode.
let giveUpArmed = false;
let giveUpTimer = null;
function resetGiveUpArm() {
  giveUpArmed = false;
  if (giveUpTimer) { clearTimeout(giveUpTimer); giveUpTimer = null; }
  const btn = els.giveUpBtn();
  if (btn) btn.textContent = 'Give Up';
}

async function handleGiveUp() {
  if (state.game?.status !== 'active' || state.submitting) return;
  if (!giveUpArmed) {
    giveUpArmed = true;
    const btn = els.giveUpBtn();
    if (btn) btn.textContent = 'Tap again to confirm';
    giveUpTimer = setTimeout(() => resetGiveUpArm(), 2500);
    return;
  }
  resetGiveUpArm();
  state.submitting = true;
  renderActions();
  const { error } = await supabase.rpc('rg_give_up', { p_game_id: state.gameId });
  state.submitting = false;
  if (error) {
    renderStatus(error.message, 'bad');
    renderActions();
    return;
  }
  // Realtime UPDATE on rg_games will fire status='complete' and trigger the modal.
}

function showEndgameModal() {
  const modal = els.endModal();
  if (!modal) return;
  const youWon = state.game.winner_player_idx === state.me.playerIdx;
  els.endTitle().textContent = youWon ? '🎉 You won!' : `${state.opponent.username} won.`;
  els.endScoreLbl().textContent = 'Final score';
  els.endNumber().textContent = `${state.me.score} vs ${state.opponent.score}`;

  const rungsContainer = els.endRungs();
  rungsContainer.innerHTML = '';
  state.rungs.forEach(r => {
    const row = document.createElement('div');
    row.className = 'endgame-rung-row';
    const who = r.player_user_id === state.me.userId ? 'You' : state.opponent.username;
    const left = document.createElement('span');
    // DOM-build instead of innerHTML to avoid XSS via username.
    const labelTxt = document.createTextNode(`Rung ${r.rung_number} (${who}): `);
    const wordEl = document.createElement('strong');
    wordEl.textContent = r.word;
    left.append(labelTxt, wordEl);
    const right = document.createElement('span');
    right.textContent = `+${r.rung_score}`;
    row.append(left, right);
    rungsContainer.append(row);
  });

  // Repurpose the Play Again button to send the user back to the lobby.
  const playAgain = els.endPlayAgain();
  if (playAgain) {
    playAgain.textContent = 'Back to lobby';
    playAgain.onclick = () => {
      modal.close();
      handleLeave();
    };
  }

  if (!modal.open) modal.showModal();
}

// ---------- data loading ----------

async function loadAll() {
  // Game row
  const { data: game, error: gErr } = await supabase
    .from('rg_games').select('*').eq('id', state.gameId).single();
  if (gErr) { renderStatus(`Couldn't load game: ${gErr.message}`); return; }
  state.game = game;

  // Players + their usernames
  const { data: players } = await supabase
    .from('rg_players')
    .select('user_id, player_idx, score')
    .eq('game_id', state.gameId);
  const ids = (players ?? []).map(p => p.user_id);
  const { data: profiles } = await supabase
    .from('profiles').select('id, username').in('id', ids);
  const nameById = Object.fromEntries((profiles ?? []).map(p => [p.id, p.username]));

  for (const p of (players ?? [])) {
    if (p.user_id === state.me.userId) {
      state.me.playerIdx = p.player_idx;
      state.me.score = p.score;
    } else {
      state.opponent.userId = p.user_id;
      state.opponent.playerIdx = p.player_idx;
      state.opponent.score = p.score;
      state.opponent.username = nameById[p.user_id] ?? 'Opponent';
    }
  }

  // My rack
  const { data: rack } = await supabase
    .from('rg_racks').select('rack')
    .eq('game_id', state.gameId).eq('user_id', state.me.userId).maybeSingle();
  state.rack = rack?.rack ?? [];

  // Ladder
  const { data: rungs } = await supabase
    .from('rg_rungs').select('*')
    .eq('game_id', state.gameId).order('rung_number', { ascending: true });
  state.rungs = rungs ?? [];

  // Premium position for the next rung (deterministic helper on the server)
  await loadPremium();

  render();
  if (state.game?.status === 'complete') showEndgameModal();
}

async function loadPremium() {
  const { data, error } = await supabase.rpc('rg_premium_pos', {
    p_game_id: state.gameId,
    p_rung_number: nextRungNumber(),
  });
  if (!error) state.premiumPos = data;
}

// ---------- realtime ----------

function subscribe() {
  unsubscribe();
  channel = supabase.channel(`rg_match_${state.gameId}`)
    // New rungs (anyone's)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'rg_rungs', filter: `game_id=eq.${state.gameId}` },
      payload => {
        // Insert in order, then refresh derived state.
        const newRung = payload.new;
        if (!state.rungs.find(r => r.id === newRung.id)) {
          state.rungs.push(newRung);
          state.rungs.sort((a, b) => a.rung_number - b.rung_number);
        }
        loadPremium().then(render);
      })
    // Game state (turn, status, winner)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'rg_games', filter: `id=eq.${state.gameId}` },
      payload => {
        const wasComplete = state.game?.status === 'complete';
        state.game = payload.new;
        // Reload rack on turn change (server may have refilled it).
        refreshRack().then(() => {
          render();
          if (state.game.status === 'complete' && !wasComplete) showEndgameModal();
        });
      })
    // Score updates
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'rg_players', filter: `game_id=eq.${state.gameId}` },
      payload => {
        const p = payload.new;
        if (p.user_id === state.me.userId) state.me.score = p.score;
        else if (p.user_id === state.opponent.userId) state.opponent.score = p.score;
        render();
      })
    .subscribe();
}

function unsubscribe() {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
}

async function refreshRack() {
  const { data } = await supabase
    .from('rg_racks').select('rack')
    .eq('game_id', state.gameId).eq('user_id', state.me.userId).maybeSingle();
  state.rack = data?.rack ?? [];
}

// ---------- public api ----------

export async function startMatch(gameId, session, leaveCallback) {
  resetState(gameId, session);
  onLeave = leaveCallback;
  els.view().classList.remove('hidden');

  // Wire buttons (idempotent: avoid double-binding by checking dataset flag).
  const submit = els.submitBtn();
  if (!submit.dataset.bound) {
    submit.addEventListener('click', handleSubmit);
    els.clearBtn().addEventListener('click', handleClear);
    els.shuffleBtn().addEventListener('click', handleShuffle);
    els.skipBtn().addEventListener('click', handleSkip);
    els.giveUpBtn().addEventListener('click', handleGiveUp);
    els.leaveBtn().addEventListener('click', handleLeave);
    submit.dataset.bound = '1';
  }

  await loadAll();
  subscribe();
}

export function stopMatch() {
  unsubscribe();
  els.view()?.classList.add('hidden');
  state = null;
}

function handleLeave() {
  stopMatch();
  if (onLeave) onLeave();
}
