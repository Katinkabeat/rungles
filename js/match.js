// Rungles multiplayer match controller. Owns one active rg_games row.
// Server is the source of truth: rack, bag, scores, ladder, premium position.

import { supabase } from './supabase-client.js';
import { LETTER_VALUES } from './tiles.js';
import { scoreRung } from './scoring.js';

const MIN_WORD_LEN = 4;
const MAX_WORD_LEN = 7;
const CARRY_REQUIRED = 3;

function emptyWord() { return new Array(MAX_WORD_LEN).fill(null); }

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
  leaveBtn:    () => document.querySelector('.match-back'),
  preview:     () => document.querySelector('.match-preview'),
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
    selected: emptyWord(),         // length-MAX_WORD_LEN sparse; each slot null or { source, idx, letter }
    selection: null,               // { source: 'rack'|'carried', idx } — picked-up tile from rack/carried
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

function currentWordLetters() { return state.selected.filter(Boolean); }
function currentWord()        { return currentWordLetters().map(s => s.letter).join(''); }
function carriedUsedCount()   { return state.selected.filter(e => e && e.source === 'carried').length; }
function filledSlotCount()    { return state.selected.filter(Boolean).length; }
function lastFilledSlot()     { for (let i = MAX_WORD_LEN - 1; i >= 0; i--) if (state.selected[i]) return i; return -1; }
function hasGap()             { const last = lastFilledSlot(); return last >= 0 && last + 1 !== filledSlotCount(); }

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
  renderPreview();
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

// Paint each letter of `word` into `container`. Letters that could have been
// carried from `prevWord` (by pool-matching with multiplicity) get the
// carried-letter class so they render green. Used for ladder rows where we
// don't have the player's exact word_sources (opponent rungs, or historic
// rungs before the client joined).
function appendWordWithCarryHighlight(container, word, prevWord, premiumPos) {
  const pool = (prevWord || '').toUpperCase().split('');
  const letters = (word || '').toUpperCase().split('');
  letters.forEach((ch, i) => {
    const span = document.createElement('span');
    span.className = 'ladder-letter';
    span.textContent = ch;
    const poolIdx = pool.indexOf(ch);
    if (poolIdx !== -1) {
      span.classList.add('ladder-letter-carried');
      pool[poolIdx] = null;
    } else if (premiumPos && (i + 1) === premiumPos) {
      span.classList.add('ladder-letter-premium');
    }
    container.append(span);
  });
}

// Mid-game ladder history popup for multi. Includes the seed at the bottom.
function openMatchHistoryModal() {
  const modal = document.querySelector('.history-modal');
  if (!modal) return;
  const rungs = modal.querySelector('.history-rungs');
  rungs.innerHTML = '';
  state.rungs.forEach((r, i) => {
    const prev = r.rung_number === 1
      ? (state.game?.seed_word ?? '')
      : (state.rungs[i - 1]?.word ?? '');
    const row = document.createElement('div');
    row.className = 'ladder-row';
    const who = r.player_user_id === state.me.userId ? 'You' : state.opponent.username;
    const label = document.createElement('span');
    label.className = 'ladder-label';
    label.textContent = `Rung ${r.rung_number} (${who})`;
    const word = document.createElement('span');
    word.className = 'ladder-word';
    appendWordWithCarryHighlight(word, r.word, prev, r.premium_pos);
    const score = document.createElement('span');
    score.className = 'ladder-score';
    score.textContent = `+${r.rung_score}`;
    row.append(label, word, score);
    rungs.append(row);
  });
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
    rungs.append(seedRow);
  }
  const closeBtn = modal.querySelector('.history-close');
  closeBtn.onclick = () => modal.close();
  modal.showModal();
}

function renderPreview() {
  const el = els.preview();
  if (!el) return;
  if (filledSlotCount() === 0) {
    el.textContent = '';
    el.classList.remove('score-preview-active');
    return;
  }
  const pts = scoreRung(state.selected, state.premiumPos);
  el.textContent = `+${pts} pts`;
  el.classList.add('score-preview-active');
}

function renderLadder() {
  // Mid-game we only need the most recent rung (the carryover source) plus
  // the seed (which is the carryover source for rung 1). The endgame modal
  // shows the full ladder when the game ends.
  const ladder = els.ladder();
  ladder.innerHTML = '';
  if (state.rungs.length > 0) {
    const last = state.rungs[state.rungs.length - 1];
    const prev = last.rung_number === 1
      ? (state.game?.seed_word ?? '')
      : (state.rungs[state.rungs.length - 2]?.word ?? '');
    const row = document.createElement('div');
    row.className = 'ladder-row';
    if (state.rungs.length > 1) {
      row.classList.add('ladder-tappable');
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      row.setAttribute('aria-label', 'Show all played rungs');
      const open = () => openMatchHistoryModal();
      row.addEventListener('click', open);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
    }
    const who = last.player_user_id === state.me.userId ? 'You' : state.opponent.username;
    const label = document.createElement('span');
    label.className = 'ladder-label';
    label.textContent = `Rung ${last.rung_number} (${who})`;
    const word = document.createElement('span');
    word.className = 'ladder-word';
    appendWordWithCarryHighlight(word, last.word, prev, last.premium_pos);
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

  // Word input: 7 fixed slots, empty or filled.
  const input = els.wordInput();
  input.innerHTML = '';
  input.classList.add('word-slots');
  input.onclick = null;
  for (let slot = 0; slot < MAX_WORD_LEN; slot++) {
    const entry = state.selected[slot];
    const isPremium = (slot + 1) === state.premiumPos;
    if (entry) {
      const isPremiumHit = isPremium && entry.source === 'rack';
      const tile = makeTile(entry.letter, { premium: isPremiumHit });
      tile.classList.add('tile-in-word');
      if (entry.source === 'carried') tile.classList.add('tile-in-word-carried');
      tile.addEventListener('click', () => {
        if (!isMyTurn() || state.submitting) return;
        handleWordSlotTap(slot);
      });
      input.append(tile);
    } else {
      const empty = document.createElement('button');
      empty.type = 'button';
      empty.className = 'empty-slot' + (isPremium ? ' empty-slot-premium' : '');
      empty.textContent = isPremium ? '2×' : '';
      empty.setAttribute('aria-label', `Slot ${slot + 1}${isPremium ? ' (2× bonus)' : ''}`);
      empty.addEventListener('click', () => {
        if (!isMyTurn() || state.submitting) return;
        handleWordSlotTap(slot);
      });
      input.append(empty);
    }
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
    const usedIdxs = new Set(state.selected.filter(e => e && e.source === 'carried').map(e => e.idx));
    carried.forEach((letter, idx) => {
      const used = usedIdxs.has(idx);
      const tile = makeTile(letter, { ghost: used, small: true });
      tile.classList.add('tile-carried');
      if (selectionMatches('carried', idx)) tile.classList.add('tile-selected');
      tile.addEventListener('click', () => {
        if (used || !isMyTurn() || state.submitting) return;
        handleSourceTap('carried', idx);
      });
      row.append(tile);
    });
    carriedC.append(row);
  }
}

function rackDisplayOrder() {
  // state.rack is the server's canonical order and MUST NOT be mutated
  // client-side — word_sources indices are 1-based into that array. Shuffle
  // only reorders this visual permutation.
  if (!Array.isArray(state.rackOrder) || state.rackOrder.length !== state.rack.length) {
    state.rackOrder = state.rack.map((_, i) => i);
  }
  return state.rackOrder;
}

function renderRack() {
  const container = els.rack();
  container.innerHTML = '';
  const usedIdxs = new Set(state.selected.filter(e => e && e.source === 'rack').map(e => e.idx));
  rackDisplayOrder().forEach(serverIdx => {
    const letter = state.rack[serverIdx];
    const inWord = usedIdxs.has(serverIdx);
    const tile = makeTile(letter, { ghost: inWord });
    if (selectionMatches('rack', serverIdx)) tile.classList.add('tile-selected');
    tile.addEventListener('click', () => {
      if (inWord || !isMyTurn() || state.submitting) return;
      handleSourceTap('rack', serverIdx);
    });
    container.append(tile);
  });
}

// ---------- tile interaction (tap-to-select, tap-to-place) ----------

function selectionMatches(source, idx) {
  return state.selection
    && state.selection.source === source
    && state.selection.idx === idx;
}

function clearSelection() { state.selection = null; }

function handleSourceTap(source, idx) {
  if (!state.selection) {
    state.selection = { source, idx };
    render();
    return;
  }
  if (selectionMatches(source, idx)) {
    clearSelection();
    render();
    return;
  }
  const sel = state.selection;
  if (sel.source === 'rack' && source === 'rack') {
    reorderRack(sel.idx, idx);
    clearSelection();
    render();
    return;
  }
  state.selection = { source, idx };
  render();
}

function handleWordSlotTap(slot) {
  const entry = state.selected[slot];
  if (!state.selection) {
    if (entry) {
      state.selected[slot] = null;
      render();
    }
    return;
  }
  const sel = state.selection;
  if (sel.source === 'rack') {
    const letter = state.rack[sel.idx];
    if (letter === '_') {
      pickBlankLetter().then(picked => {
        if (!picked) return;
        state.selected[slot] = { source: 'rack', idx: sel.idx, letter: picked };
        clearSelection();
        render();
      });
      return;
    }
    state.selected[slot] = { source: 'rack', idx: sel.idx, letter };
  } else if (sel.source === 'carried') {
    const letter = carriedLetters()[sel.idx];
    state.selected[slot] = { source: 'carried', idx: sel.idx, letter };
  }
  clearSelection();
  render();
}

// Reorder is purely visual: permute state.rackOrder, not state.rack.
// state.selected idx references stay valid because they point at serverIdx.
function reorderRack(fromServerIdx, toServerIdx) {
  const order = rackDisplayOrder();
  const fromDisplayPos = order.indexOf(fromServerIdx);
  const toDisplayPos = order.indexOf(toServerIdx);
  if (fromDisplayPos === -1 || toDisplayPos === -1 || fromDisplayPos === toDisplayPos) return;
  const newOrder = [...order];
  const [moved] = newOrder.splice(fromDisplayPos, 1);
  const insertAt = fromDisplayPos < toDisplayPos ? toDisplayPos - 1 : toDisplayPos;
  newOrder.splice(insertAt, 0, moved);
  state.rackOrder = newOrder;
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
  els.clearBtn().disabled = !playable || filledSlotCount() === 0;
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
  if (hasGap()) {
    renderStatus('Fill the empty slot(s) before submitting.', 'bad');
    return;
  }
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
  const sources = currentWordLetters().map(s => s.source === 'carried' ? 0 : (s.idx + 1));

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
  state.selected = emptyWord();
  state.selection = null;
  renderStatus(`✓ ${word} +${data}`, 'ok');
  render();
}

function handleClear() {
  if (filledSlotCount() === 0 && !state.selection) return;
  state.selected = emptyWord();
  state.selection = null;
  render();
}

// Reorder rack tiles visually; server's rack order is untouched. Selected
// tiles keep their slot so the word-builder positions stay stable.
function handleShuffle() {
  const order = [...rackDisplayOrder()];
  const selectedIdxs = new Set(state.selected.filter(e => e && e.source === 'rack').map(e => e.idx));
  const freePositions = order.map((_, p) => p).filter(p => !selectedIdxs.has(order[p]));
  const freeValues = freePositions.map(p => order[p]);
  for (let i = freeValues.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [freeValues[i], freeValues[j]] = [freeValues[j], freeValues[i]];
  }
  freePositions.forEach((p, k) => { order[p] = freeValues[k]; });
  state.rackOrder = order;
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
  state.selected = emptyWord();
  state.selection = null;
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
  state.rungs.forEach((r, i) => {
    const prev = r.rung_number === 1
      ? (state.game?.seed_word ?? '')
      : (state.rungs[i - 1]?.word ?? '');
    const row = document.createElement('div');
    row.className = 'endgame-rung-row';
    const who = r.player_user_id === state.me.userId ? 'You' : state.opponent.username;
    const left = document.createElement('span');
    // DOM-build instead of innerHTML to avoid XSS via username.
    const labelTxt = document.createTextNode(`Rung ${r.rung_number} (${who}): `);
    const wordEl = document.createElement('span');
    wordEl.className = 'ladder-word';
    appendWordWithCarryHighlight(wordEl, r.word, prev, r.premium_pos);
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
  state.rackOrder = null;

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
  state.rackOrder = null;
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
