// Rungles — main game controller.

import { dealOpeningHand, refillRack, LETTER_VALUES, RACK_SIZE } from './tiles.js';
import { loadDictionary, isValidWord, dictionarySize, canFormAnyWord, findHintWord } from './dictionary.js';
import { scoreRung } from './scoring.js';

const TOTAL_RUNGS = 7;
const MIN_WORD_LEN = 4;
const CARRY_REQUIRED = 3;
const HINT_COST = 5;

const state = {
  bag: [],
  rack: [],
  rungNumber: 1,
  totalScore: 0,
  ladder: [],               // [{ word, rungScore, premiumPos }]
  prevWord: null,           // string of letters from previous rung
  carried: [],              // [{ letter, used: boolean }] — letters available from prev word
  selected: [],             // [{ source: 'rack'|'carried', idx, letter }] — current word builder
  selection: null,          // { source: 'rack'|'carried'|'word', idx } — tile the user has picked up
  premiumPos: null,         // 1-based or null
  gameOver: false,
};

// ---------- helpers ----------

function pickPremiumPos() {
  // Random 2..6 so short words can sometimes miss the premium (per design).
  return 2 + Math.floor(Math.random() * 5);
}

function currentWord() {
  return state.selected.map(s => s.letter).join('');
}

function carriedUsedCount() {
  return state.selected.filter(s => s.source === 'carried').length;
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
    state.selected.filter(s => s.source === 'carried').map(s => s.idx)
  );
  state.carried.forEach((c, idx) => {
    const used = usedCarriedIdxs.has(idx);
    const tile = makeTile(c.letter, { ghost: used, small: true });
    tile.classList.add('tile-carried');
    tile.dataset.carriedIndex = String(idx);
    if (selectionMatches('carried', idx)) tile.classList.add('tile-selected');
    tile.addEventListener('click', () => {
      if (used) return;
      handleTileTap('carried', idx);
    });
    row.append(tile);
  });
  carriedContainer.append(row);
}

function renderWordInput() {
  const input = document.querySelector('.word-input');
  input.innerHTML = '';
  // Shrink tiles when the row is long so it stays on one line on phone widths.
  const totalSlots = Math.max(state.selected.length, state.premiumPos || 0);
  input.classList.toggle('word-long', totalSlots >= 7);
  input.classList.toggle('word-xlong', totalSlots >= 10);
  if (state.selected.length === 0 && !state.premiumPos) {
    const ph = document.createElement('span');
    ph.className = 'word-placeholder';
    ph.textContent = state.selection
      ? 'Tap here to place at the end'
      : 'Tap tiles to build a word';
    input.append(ph);
    // Whole empty input acts as append-zone when something's selected.
    input.onclick = (e) => { if (e.target === input || e.target === ph) handleAppendZoneTap(); };
    return;
  }
  input.onclick = null;
  state.selected.forEach((entry, pos) => {
    const isPremium = (pos + 1) === state.premiumPos && entry.source === 'rack';
    const tile = makeTile(entry.letter, { premium: isPremium });
    tile.classList.add('tile-in-word');
    if (entry.source === 'carried') tile.classList.add('tile-in-word-carried');
    if (selectionMatches('word', pos)) tile.classList.add('tile-selected');
    tile.addEventListener('click', () => { handleTileTap('word', pos); });
    input.append(tile);
  });
  // If the premium slot hasn't been reached yet, preview empty slots up to and including it.
  if (state.premiumPos && state.selected.length < state.premiumPos) {
    for (let pos = state.selected.length + 1; pos <= state.premiumPos; pos++) {
      const slot = document.createElement('div');
      const isPremium = (pos === state.premiumPos);
      slot.className = 'empty-slot' + (isPremium ? ' empty-slot-premium' : '');
      slot.textContent = isPremium ? '2×' : '';
      slot.setAttribute('aria-hidden', 'true');
      input.append(slot);
    }
  }
  // Trailing append-zone so the user can place at the very end of the word.
  const appendZone = document.createElement('button');
  appendZone.type = 'button';
  appendZone.className = 'append-zone';
  appendZone.setAttribute('aria-label', 'Place at end');
  appendZone.textContent = state.selection ? '+' : '';
  appendZone.addEventListener('click', handleAppendZoneTap);
  input.append(appendZone);
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
  const selectedRackIdxs = new Set(
    state.selected.filter(s => s.source === 'rack').map(s => s.idx)
  );
  state.rack.forEach((letter, idx) => {
    const inWord = selectedRackIdxs.has(idx);
    const tile = makeTile(letter, { ghost: inWord });
    tile.dataset.rackIndex = String(idx);
    if (selectionMatches('rack', idx)) tile.classList.add('tile-selected');
    tile.addEventListener('click', () => {
      if (inWord) return;
      handleTileTap('rack', idx);
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

function handleTileTap(targetSource, targetIdx) {
  // No selection yet: tapping any tile picks it up.
  if (!state.selection) {
    state.selection = { source: targetSource, idx: targetIdx };
    renderAll();
    return;
  }

  // Same tile tapped again: deselect.
  if (selectionMatches(targetSource, targetIdx)) {
    clearSelection();
    renderAll();
    return;
  }

  const sel = state.selection;

  // Placement into the word (either insert or move).
  if (targetSource === 'word') {
    if (sel.source === 'rack') {
      placeRackIntoWord(sel.idx, targetIdx);
    } else if (sel.source === 'carried') {
      insertCarriedIntoWord(sel.idx, targetIdx);
      clearSelection();
      renderAll();
    } else if (sel.source === 'word') {
      moveWordTile(sel.idx, targetIdx);
      clearSelection();
      renderAll();
    }
    return;
  }

  // Target is a rack tile.
  if (targetSource === 'rack') {
    if (sel.source === 'rack') {
      reorderRack(sel.idx, targetIdx);
      clearSelection();
      renderAll();
      return;
    }
    if (sel.source === 'word') {
      // Remove from word (no rack move — rack stays as-is). Reorder rack
      // separately if you want.
      state.selected.splice(sel.idx, 1);
      clearSelection();
      renderAll();
      return;
    }
    // carried -> rack: switch selection (carried can't be placed in rack).
    state.selection = { source: 'rack', idx: targetIdx };
    renderAll();
    return;
  }

  // Target is a carried tile — only valid "placement" is switching selection.
  if (targetSource === 'carried') {
    if (sel.source === 'word') {
      state.selected.splice(sel.idx, 1);
      clearSelection();
    } else {
      state.selection = { source: 'carried', idx: targetIdx };
    }
    renderAll();
    return;
  }
}

function handleAppendZoneTap() {
  if (!state.selection) return;
  const sel = state.selection;
  const endPos = state.selected.length;
  if (sel.source === 'rack') {
    placeRackIntoWord(sel.idx, endPos);
    return;
  }
  if (sel.source === 'carried') {
    insertCarriedIntoWord(sel.idx, endPos);
  } else if (sel.source === 'word') {
    moveWordTile(sel.idx, endPos);
  }
  clearSelection();
  renderAll();
}

// Synchronous for normal tiles; async only when a blank needs a letter picked.
function placeRackIntoWord(rackIdx, pos) {
  const letter = state.rack[rackIdx];
  if (letter === '_') {
    pickBlankLetter().then(picked => {
      if (!picked) return;
      state.selected.splice(pos, 0, { source: 'rack', idx: rackIdx, letter: picked });
      clearSelection();
      renderAll();
    });
    return;
  }
  state.selected.splice(pos, 0, { source: 'rack', idx: rackIdx, letter });
  clearSelection();
  renderAll();
}

function insertCarriedIntoWord(carriedIdx, pos) {
  const entry = state.carried[carriedIdx];
  state.selected.splice(pos, 0, { source: 'carried', idx: carriedIdx, letter: entry.letter });
}

function moveWordTile(fromPos, toPos) {
  if (fromPos === toPos) return;
  const [entry] = state.selected.splice(fromPos, 1);
  const insertAt = fromPos < toPos ? toPos - 1 : toPos;
  state.selected.splice(insertAt, 0, entry);
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
  state.selected = state.selected.map(s =>
    s.source === 'rack' ? { ...s, idx: remap[s.idx] } : s
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
    if (last.sources && last.sources[i] === 'carried') {
      span.classList.add('ladder-letter-carried');
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
  if (!state.selected || state.selected.length === 0) {
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

  const rungScore = scoreRung(state.selected, state.premiumPos);
  state.totalScore += rungScore;
  state.ladder.push({
    word,
    rungScore,
    premiumPos: state.premiumPos,
    sources: state.selected.map(s => s.source),
  });
  pulseScore();

  // Consume rack tiles — remove used rack indices and refill from bag.
  const usedRackIdxs = state.selected
    .filter(s => s.source === 'rack')
    .map(s => s.idx)
    .sort((a, b) => b - a);
  for (const idx of usedRackIdxs) state.rack.splice(idx, 1);
  refillRack(state.rack, state.bag);

  // Advance.
  state.prevWord = word;
  state.rungNumber += 1;
  state.selected = [];
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
      if (rung.sources && rung.sources[j] === 'carried') {
        span.classList.add('ladder-letter-carried');
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
  if (state.selected.length === 0 && !state.selection) return;
  state.selected = [];
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
    if (state.selected.length > 0) {
      e.preventDefault();
      state.selected.pop();
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
    if (state.selected.length > 0) {
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
  // Prefer carried letters (free) over rack tiles.
  const usedCarriedIdxs = new Set(state.selected.filter(s => s.source === 'carried').map(s => s.idx));
  const carriedMatch = state.carried.findIndex((c, i) => c.letter === letter && !usedCarriedIdxs.has(i));
  if (carriedMatch !== -1) {
    state.selected.push({ source: 'carried', idx: carriedMatch, letter });
    renderAll();
    return;
  }
  const usedRackIdxs = new Set(state.selected.filter(s => s.source === 'rack').map(s => s.idx));
  const rackMatch = state.rack.findIndex((l, i) => l === letter && !usedRackIdxs.has(i));
  if (rackMatch !== -1) {
    state.selected.push({ source: 'rack', idx: rackMatch, letter });
    renderAll();
  }
  // If no match: silently ignore. (Could flash a subtle feedback, but don't spam.)
}

// ---------- shuffle ----------

function handleShuffle() {
  // Shuffle only the rack tiles that aren't currently selected; keep selected-tile positions stable.
  const selectedIdxs = new Set(state.selected.filter(s => s.source === 'rack').map(s => s.idx));
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
  state.selected = [];
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
      newGame();
    })
    .catch(err => {
      console.error('Dictionary load failed', err);
      newGame(); // still deal something so the UI isn't empty
    });

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
