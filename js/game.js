// Rungles — main game controller.

import { dealOpeningHand, refillRack, LETTER_VALUES, RACK_SIZE } from './tiles.js';
import { loadDictionary, isValidWord, dictionarySize, canFormAnyWord, findHintWord } from './dictionary.js';
import { scoreRung } from './scoring.js';

const TOTAL_RUNGS = 7;
const MIN_WORD_LEN = 4;
const MAX_WORD_LEN = 7;
const CARRY_REQUIRED = 3;
const HINT_COST = 5;

function emptyWord() { return new Array(MAX_WORD_LEN).fill(null); }

// ---------- persistence ----------
// Autosave the solo game to localStorage so reloads, tab-closes, PWA
// relaunches, and switching to a multiplayer game don't wipe progress.
const SAVE_KEY = 'rungles:solo:v1';

function saveState() {
  try {
    if (state.gameOver) { localStorage.removeItem(SAVE_KEY); return; }
    // Drop `selection` (the picked-up tile) so the user isn't stranded mid-drag after a reload.
    const snapshot = { ...state, selection: null };
    localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
  } catch { /* quota or disabled storage — silently skip */ }
}

function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved || saved.gameOver) return false;
    Object.assign(state, saved, { selection: null });
    return true;
  } catch { return false; }
}

const state = {
  bag: [],
  rack: [],
  rungNumber: 1,
  totalScore: 0,
  ladder: [],               // [{ word, rungScore, premiumPos }]
  prevWord: null,           // string of letters from previous rung
  carried: [],              // [{ letter, used: boolean }] — letters available from prev word
  selected: emptyWord(),    // length-MAX_WORD_LEN sparse array; each slot is null or { source, idx, letter }
  selection: null,          // { source: 'rack'|'carried', idx } — tile the user has picked up from rack/carried
  premiumPos: null,         // 1-based or null
  gameOver: false,
};

function currentWordLetters() { return state.selected.filter(Boolean); }
function carriedUsedCount()   { return state.selected.filter(e => e && e.source === 'carried').length; }
function filledSlotCount()    { return state.selected.filter(Boolean).length; }
function lastFilledSlot()     { for (let i = MAX_WORD_LEN - 1; i >= 0; i--) if (state.selected[i]) return i; return -1; }
function hasGap()             { const last = lastFilledSlot(); return last >= 0 && last + 1 !== filledSlotCount(); }
function firstEmptySlot()     { for (let i = 0; i < MAX_WORD_LEN; i++) if (!state.selected[i]) return i; return -1; }

// ---------- helpers ----------

function pickPremiumPos() {
  // Random 2..6 so short words can sometimes miss the premium (per design).
  return 2 + Math.floor(Math.random() * 5);
}

function currentWord() {
  return currentWordLetters().map(s => s.letter).join('');
}

// ---------- tile factory ----------

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

function renderInfoBar() {
  document.querySelector('.info-rung').textContent = `Rung ${Math.min(state.rungNumber, TOTAL_RUNGS)} / ${TOTAL_RUNGS}`;
  document.querySelector('.info-score').textContent = `Score: ${state.totalScore}`;
}

function renderPremiumIndicator() {
  const label = document.querySelector('.premium-label');
  if (!label) return;
  if (state.premiumPos) {
    label.textContent = `2× slot: position ${state.premiumPos}`;
  } else {
    label.textContent = '2× slot: —';
  }
}

function renderCarried() {
  const carriedContainer = document.querySelector('.carried-letters');
  carriedContainer.innerHTML = '';

  const label = document.createElement('div');
  label.className = 'carried-label';
  if (state.carried.length === 0) {
    label.textContent = 'Carried: — (rung 1: no carryover)';
    carriedContainer.append(label);
    return;
  }
  label.textContent = `Carried (need ${CARRY_REQUIRED}):`;
  carriedContainer.append(label);

  const row = document.createElement('div');
  row.className = 'carried-row';
  const usedCarriedIdxs = new Set(
    state.selected.filter(e => e && e.source === 'carried').map(e => e.idx)
  );
  state.carried.forEach((c, idx) => {
    const used = usedCarriedIdxs.has(idx);
    const tile = makeTile(c.letter, { ghost: used, small: true });
    tile.classList.add('tile-carried');
    tile.dataset.carriedIndex = String(idx);
    if (selectionMatches('carried', idx)) tile.classList.add('tile-selected');
    tile.addEventListener('click', () => {
      if (used) return;
      handleSourceTap('carried', idx);
    });
    row.append(tile);
  });
  carriedContainer.append(row);
}

function renderWordInput() {
  const input = document.querySelector('.word-input');
  input.innerHTML = '';
  input.classList.add('word-slots');
  for (let slot = 0; slot < MAX_WORD_LEN; slot++) {
    const entry = state.selected[slot];
    const isPremium = (slot + 1) === state.premiumPos;
    if (entry) {
      const isPremiumHit = isPremium && entry.source === 'rack';
      const tile = makeTile(entry.letter, { premium: isPremiumHit });
      tile.classList.add('tile-in-word');
      if (entry.source === 'carried') tile.classList.add('tile-in-word-carried');
      tile.addEventListener('click', () => handleWordSlotTap(slot));
      input.append(tile);
    } else {
      const empty = document.createElement('button');
      empty.type = 'button';
      empty.className = 'empty-slot' + (isPremium ? ' empty-slot-premium' : '');
      empty.textContent = isPremium ? '2×' : '';
      empty.setAttribute('aria-label', `Slot ${slot + 1}${isPremium ? ' (2× bonus)' : ''}`);
      empty.addEventListener('click', () => handleWordSlotTap(slot));
      input.append(empty);
    }
  }
}

// Count letters shared between two words as a multiset intersection.
function multisetIntersect(a, b) {
  const counts = {};
  for (const ch of a) counts[ch] = (counts[ch] ?? 0) + 1;
  let n = 0;
  for (const ch of b) {
    if ((counts[ch] ?? 0) > 0) { counts[ch]--; n++; }
  }
  return n;
}

function renderRack() {
  const container = document.querySelector('.rack-tiles');
  container.innerHTML = '';
  const usedRackIdxs = new Set(
    state.selected.filter(e => e && e.source === 'rack').map(e => e.idx)
  );
  state.rack.forEach((letter, idx) => {
    const inWord = usedRackIdxs.has(idx);
    const tile = makeTile(letter, { ghost: inWord });
    tile.dataset.rackIndex = String(idx);
    if (selectionMatches('rack', idx)) tile.classList.add('tile-selected');
    tile.addEventListener('click', () => {
      if (inWord) return;
      handleSourceTap('rack', idx);
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

// Handles taps on rack or carried tiles (the "source" pools).
function handleSourceTap(source, idx) {
  if (!state.selection) {
    state.selection = { source, idx };
    renderAll();
    return;
  }
  if (selectionMatches(source, idx)) {
    clearSelection();
    renderAll();
    return;
  }
  const sel = state.selection;

  // Rack -> rack: reorder the rack.
  if (sel.source === 'rack' && source === 'rack') {
    reorderRack(sel.idx, idx);
    clearSelection();
    renderAll();
    return;
  }

  // Any other cross-source tap just switches selection.
  state.selection = { source, idx };
  renderAll();
}

// Handles taps on one of the 7 word slots (empty or filled).
function handleWordSlotTap(slot) {
  const entry = state.selected[slot];

  // Nothing selected: tapping a filled slot returns the tile to its origin.
  if (!state.selection) {
    if (entry) {
      state.selected[slot] = null;
      renderAll();
    }
    return;
  }

  // Selected tile drops into the slot; any displaced tile goes back to origin
  // automatically because state.selected is the only thing keeping it "in use".
  const sel = state.selection;

  if (sel.source === 'rack') {
    const letter = state.rack[sel.idx];
    if (letter === '_') {
      // Blank: ask for a letter, then place.
      pickBlankLetter().then(picked => {
        if (!picked) return;
        state.selected[slot] = { source: 'rack', idx: sel.idx, letter: picked };
        clearSelection();
        renderAll();
      });
      return;
    }
    state.selected[slot] = { source: 'rack', idx: sel.idx, letter };
  } else if (sel.source === 'carried') {
    const letter = state.carried[sel.idx].letter;
    state.selected[slot] = { source: 'carried', idx: sel.idx, letter };
  }

  clearSelection();
  renderAll();
}

function reorderRack(fromIdx, toIdx) {
  if (fromIdx === toIdx) return;
  const newRack = [...state.rack];
  const [letter] = newRack.splice(fromIdx, 1);
  const insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
  newRack.splice(insertAt, 0, letter);

  // Build oldIdx -> newIdx map so state.selected rack references stay valid.
  const oldInNew = [];
  for (let i = 0; i < state.rack.length; i++) if (i !== fromIdx) oldInNew.push(i);
  oldInNew.splice(insertAt, 0, fromIdx);
  const remap = {};
  oldInNew.forEach((oldIdx, newIdx) => { remap[oldIdx] = newIdx; });

  state.rack = newRack;
  state.selected = state.selected.map(e =>
    (e && e.source === 'rack') ? { ...e, idx: remap[e.idx] } : e
  );
}

function pickBlankLetter() {
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
    const dismiss = modal.querySelector('.modal-dismiss');
    dismiss.onclick = () => finish(null);
    modal.addEventListener('close', () => finish(null), { once: true });
    modal.showModal();
  });
}

function renderLadder() {
  // Solo only shows the most recent rung mid-game — that's all you need for
  // the carryover. The endgame modal lists the full ladder when the game ends.
  const ladder = document.querySelector('.ladder');
  ladder.innerHTML = '';
  if (state.ladder.length === 0) {
    const p = document.createElement('p');
    p.className = 'ladder-empty';
    p.textContent = 'Your played words will appear here.';
    ladder.append(p);
    return;
  }
  const last = state.ladder[state.ladder.length - 1];
  const row = document.createElement('div');
  row.className = 'ladder-row';
  if (state.ladder.length > 1) {
    row.classList.add('ladder-tappable');
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-label', 'Show all played rungs');
    const open = () => openHistoryModal();
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  }
  const label = document.createElement('span');
  label.className = 'ladder-label';
  label.textContent = `Rung ${state.ladder.length}`;
  const word = document.createElement('span');
  word.className = 'ladder-word';
  // Paint each letter; carried positions get the green class so players can
  // see at a glance which letters came from the previous rung.
  const letters = last.word.toUpperCase().split('');
  letters.forEach((ch, i) => {
    const span = document.createElement('span');
    span.className = 'ladder-letter';
    span.textContent = ch;
    const fromCarried = last.sources && last.sources[i] === 'carried';
    if (fromCarried) {
      span.classList.add('ladder-letter-carried');
    } else if (last.premiumPos && (i + 1) === last.premiumPos) {
      span.classList.add('ladder-letter-premium');
    }
    word.append(span);
  });
  const score = document.createElement('span');
  score.className = 'ladder-score';
  score.textContent = `+${last.rungScore}`;
  row.append(label, word, score);
  ladder.append(row);
}

function renderPreview() {
  const el = document.querySelector('.solo-preview');
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

function renderAll() {
  renderInfoBar();
  renderPremiumIndicator();
  renderCarried();
  renderWordInput();
  renderRack();
  renderLadder();
  renderPreview();
  saveState();
}

// ---------- flash feedback ----------

function flashInput(valid, message) {
  const input = document.querySelector('.word-input');
  input.classList.remove('flash-valid', 'flash-invalid');
  void input.offsetWidth;
  input.classList.add(valid ? 'flash-valid' : 'flash-invalid');
  const banner = document.querySelector('.status-banner');
  if (banner) {
    banner.textContent = message;
    banner.className = 'status-banner ' + (valid ? 'banner-ok' : 'banner-bad');
  }
  setTimeout(() => input.classList.remove('flash-valid', 'flash-invalid'), 700);
}

function clearBanner() {
  const banner = document.querySelector('.status-banner');
  if (banner) { banner.textContent = ''; banner.className = 'status-banner'; }
}

function pulseScore() {
  const el = document.querySelector('.info-score');
  if (!el) return;
  el.classList.remove('score-pulse');
  void el.offsetWidth;
  el.classList.add('score-pulse');
}

// ---------- submit ----------

function handleSubmit() {
  if (state.gameOver) return;
  if (hasGap()) {
    flashInput(false, 'Fill the empty slot(s) before submitting');
    return;
  }
  const word = currentWord();
  if (word.length < MIN_WORD_LEN) {
    flashInput(false, `Too short — minimum ${MIN_WORD_LEN} letters`);
    return;
  }
  if (!isValidWord(word)) {
    flashInput(false, `"${word}" not in dictionary`);
    return;
  }
  if (state.rungNumber > 1 && carriedUsedCount() < CARRY_REQUIRED) {
    flashInput(false, `Use at least ${CARRY_REQUIRED} carried letters (you used ${carriedUsedCount()})`);
    return;
  }

  const compact = currentWordLetters();
  const rungScore = scoreRung(state.selected, state.premiumPos);
  state.totalScore += rungScore;
  state.ladder.push({
    word,
    rungScore,
    premiumPos: state.premiumPos,
    sources: compact.map(s => s.source),
  });
  pulseScore();

  // Consume rack tiles — remove used rack indices and refill from bag.
  const usedRackIdxs = compact
    .filter(s => s.source === 'rack')
    .map(s => s.idx)
    .sort((a, b) => b - a);
  for (const idx of usedRackIdxs) state.rack.splice(idx, 1);
  refillRack(state.rack, state.bag);

  // Advance.
  state.prevWord = word;
  state.rungNumber += 1;
  state.selected = emptyWord();
  state.selection = null;

  if (state.rungNumber > TOTAL_RUNGS) {
    endGame();
    return;
  }

  // Set up next rung.
  state.carried = word.split('').map(letter => ({ letter, used: false }));
  state.premiumPos = pickPremiumPos();

  flashInput(true, `✓ ${word} +${rungScore}`);
  renderAll();
}

function endGame({ gaveUp = false } = {}) {
  state.gameOver = true;
  renderAll();
  document.querySelectorAll('.actions .btn').forEach(b => b.disabled = true);
  const newBtn = document.querySelector('.btn-newgame');
  if (newBtn) newBtn.disabled = false;
  showEndGameModal({ gaveUp });
}

// Mid-game ladder history popup. Renders every rung played so far with
// carry highlights so the player can revisit earlier words.
function openHistoryModal() {
  const modal = document.querySelector('.history-modal');
  if (!modal) return;
  const rungs = modal.querySelector('.history-rungs');
  rungs.innerHTML = '';
  state.ladder.forEach((rung, i) => {
    const row = document.createElement('div');
    row.className = 'ladder-row';
    const label = document.createElement('span');
    label.className = 'ladder-label';
    label.textContent = `Rung ${i + 1}`;
    const word = document.createElement('span');
    word.className = 'ladder-word';
    rung.word.toUpperCase().split('').forEach((ch, j) => {
      const span = document.createElement('span');
      span.className = 'ladder-letter';
      span.textContent = ch;
      const fromCarried = rung.sources && rung.sources[j] === 'carried';
      if (fromCarried) {
        span.classList.add('ladder-letter-carried');
      } else if (rung.premiumPos && (j + 1) === rung.premiumPos) {
        span.classList.add('ladder-letter-premium');
      }
      word.append(span);
    });
    const score = document.createElement('span');
    score.className = 'ladder-score';
    score.textContent = `+${rung.rungScore}`;
    row.append(label, word, score);
    rungs.append(row);
  });
  const closeBtn = modal.querySelector('.history-close');
  closeBtn.onclick = () => modal.close();
  modal.showModal();
}

function showEndGameModal({ gaveUp }) {
  const modal = document.querySelector('.endgame-modal');
  const title = modal.querySelector('.endgame-title');
  title.textContent = gaveUp
    ? (state.ladder.length === 0 ? 'Ladder abandoned' : 'Ladder ended early')
    : 'Ladder complete!';
  modal.querySelector('.endgame-number').textContent = state.totalScore;

  const rungsContainer = modal.querySelector('.endgame-rungs');
  rungsContainer.innerHTML = '';
  if (state.ladder.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No rungs played.';
    empty.style.margin = '8px 0';
    empty.style.color = 'var(--ink-soft)';
    rungsContainer.append(empty);
  } else {
    state.ladder.forEach((rung, i) => {
      const row = document.createElement('div');
      row.className = 'endgame-rung-row';
      const left = document.createElement('span');
      const labelTxt = document.createTextNode(`Rung ${i + 1}: `);
      const wordEl = document.createElement('strong');
      wordEl.textContent = rung.word;
      left.append(labelTxt, wordEl);
      const right = document.createElement('span');
      right.textContent = `+${rung.rungScore}`;
      row.append(left, right);
      rungsContainer.append(row);
    });
  }
  modal.showModal();
}

// ---------- give up (double-click) ----------

let giveUpArmed = false;
let giveUpTimer = null;
function handleGiveUp() {
  if (state.gameOver) return;
  if (!giveUpArmed) {
    giveUpArmed = true;
    const btn = document.querySelector('.btn-danger');
    if (btn) btn.textContent = 'Tap again to confirm';
    giveUpTimer = setTimeout(() => {
      giveUpArmed = false;
      if (btn) btn.textContent = 'Give Up';
    }, 2500);
    return;
  }
  clearTimeout(giveUpTimer);
  giveUpArmed = false;
  endGame({ gaveUp: true });
}

function handleClear() {
  if (filledSlotCount() === 0 && !state.selection) return;
  state.selected = emptyWord();
  clearSelection();
  renderAll();
}

function handleHint() {
  if (state.gameOver) return;
  const minCarried = state.rungNumber > 1 ? CARRY_REQUIRED : 0;
  const carriedLetters = state.carried.map(c => c.letter);
  const word = findHintWord(state.rack, carriedLetters, minCarried);
  const banner = document.querySelector('.status-banner');
  if (!word) {
    if (banner) {
      banner.textContent = 'No valid word found — try Skip or Give Up.';
      banner.className = 'status-banner banner-bad';
    }
    return;
  }
  state.totalScore -= HINT_COST;
  pulseScore();
  if (banner) {
    banner.textContent = `💡 Try: ${word}  (−${HINT_COST} pts)`;
    banner.className = 'status-banner banner-ok';
  }
  renderInfoBar();
}

function handleKeydown(e) {
  if (state.gameOver) return;
  // Ignore keys while a modal is open or the user is typing in an input.
  if (document.querySelector('dialog[open]')) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  if (e.key === 'Enter') {
    e.preventDefault();
    handleSubmit();
    return;
  }
  if (e.key === 'Backspace') {
    const last = lastFilledSlot();
    if (last >= 0) {
      e.preventDefault();
      state.selected[last] = null;
      renderAll();
    }
    return;
  }
  if (e.key === 'Escape') {
    if (state.selection) {
      e.preventDefault();
      clearSelection();
      renderAll();
      return;
    }
    if (filledSlotCount() > 0) {
      e.preventDefault();
      handleClear();
    }
    return;
  }
  if (/^[a-zA-Z]$/.test(e.key)) {
    e.preventDefault();
    tryTypeLetter(e.key.toUpperCase());
  }
}

function tryTypeLetter(letter) {
  const slot = firstEmptySlot();
  if (slot === -1) return; // all 7 slots full
  // Prefer carried letters (free) over rack tiles.
  const usedCarriedIdxs = new Set(state.selected.filter(e => e && e.source === 'carried').map(e => e.idx));
  const carriedMatch = state.carried.findIndex((c, i) => c.letter === letter && !usedCarriedIdxs.has(i));
  if (carriedMatch !== -1) {
    state.selected[slot] = { source: 'carried', idx: carriedMatch, letter };
    renderAll();
    return;
  }
  const usedRackIdxs = new Set(state.selected.filter(e => e && e.source === 'rack').map(e => e.idx));
  const rackMatch = state.rack.findIndex((l, i) => l === letter && !usedRackIdxs.has(i));
  if (rackMatch !== -1) {
    state.selected[slot] = { source: 'rack', idx: rackMatch, letter };
    renderAll();
  }
  // If no match: silently ignore. (Could flash a subtle feedback, but don't spam.)
}

// ---------- shuffle ----------

function handleShuffle() {
  // Shuffle only the rack tiles that aren't currently in the word; keep in-word positions stable.
  const selectedIdxs = new Set(state.selected.filter(e => e && e.source === 'rack').map(e => e.idx));
  const freeIdxs = state.rack.map((_, i) => i).filter(i => !selectedIdxs.has(i));
  const freeLetters = freeIdxs.map(i => state.rack[i]);
  for (let i = freeLetters.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [freeLetters[i], freeLetters[j]] = [freeLetters[j], freeLetters[i]];
  }
  freeIdxs.forEach((idx, k) => state.rack[idx] = freeLetters[k]);
  renderAll();
}

// ---------- new game ----------

function newGame() {
  const hand = dealOpeningHand(canFormAnyWord);
  state.bag = hand.bag;
  state.rack = hand.rack;
  state.rungNumber = 1;
  state.totalScore = 0;
  state.ladder = [];
  state.prevWord = null;
  state.carried = [];
  state.selected = emptyWord();
  state.selection = null;
  state.premiumPos = pickPremiumPos();
  state.gameOver = false;
  clearBanner();
  document.querySelectorAll('.actions .btn').forEach(b => b.disabled = false);
  renderAll();
}

// ---------- boot ----------

document.addEventListener('DOMContentLoaded', () => {
  // Kick off dictionary load, then deal the opening hand (so rack-playability check works on first deal).
  loadDictionary()
    .then(() => {
      console.log(`Dictionary loaded: ${dictionarySize()} words`);
      if (loadState()) renderAll(); else newGame();
    })
    .catch(err => {
      console.error('Dictionary load failed', err);
      if (loadState()) renderAll(); else newGame();
    });

  // Belt-and-suspenders saves for PWA/mobile backgrounding.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveState();
  });
  window.addEventListener('pagehide', saveState);

  // Scope solo-mode button bindings to the .solo-mode subtree so they don't
  // collide with .btn-primary / .btn-secondary buttons elsewhere on the page
  // (auth gate, lobby, waiting room).
  const solo = document.querySelector('.solo-mode');
  solo?.querySelector('.btn-primary')?.addEventListener('click', handleSubmit);
  solo?.querySelector('.btn-clear')?.addEventListener('click', handleClear);
  solo?.querySelector('.hint-btn')?.addEventListener('click', handleHint);
  document.querySelectorAll('.btn-rules').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelector('.rules-modal')?.showModal();
    });
  });
  document.querySelector('.btn-rules-close')?.addEventListener('click', () => {
    document.querySelector('.rules-modal')?.close();
  });
  // Shuffle: the only solo-mode .btn-secondary that isn't .btn-clear or .btn-newgame.
  solo?.querySelectorAll('.btn-secondary').forEach(btn => {
    if (!btn.classList.contains('btn-clear') && !btn.classList.contains('btn-newgame')) {
      btn.addEventListener('click', handleShuffle);
    }
  });
  solo?.querySelector('.btn-danger')?.addEventListener('click', handleGiveUp);
  solo?.querySelector('.btn-newgame')?.addEventListener('click', () => {
    document.querySelector('.endgame-modal')?.close();
    newGame();
  });
  document.querySelector('.btn-playagain')?.addEventListener('click', () => {
    document.querySelector('.endgame-modal')?.close();
    newGame();
  });
  document.addEventListener('keydown', handleKeydown);
});
