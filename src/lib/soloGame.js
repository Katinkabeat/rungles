// Pure state + helpers for the solo Rungles game. UI lives in SoloGamePage.jsx.
// State shape mirrors legacy js/game.js so the localStorage save key
// `rungles:solo:v1` survives the cutover.

import { dealOpeningHand, refillRack, LETTER_VALUES, RACK_SIZE } from './tiles.js'
import { isValidWord, canFormAnyWord, findHintWord } from './dictionary.js'
import { scoreRung } from './scoring.js'
import { identityOrder, swapInOrder, shuffleOrder, normalizeOrder } from './rackOrder.js'
import { rngFromSeed, dailySeedString, atlanticYMD } from './rng.js'

export const TOTAL_RUNGS = 7
export const MIN_WORD_LEN = 4
export const MAX_WORD_LEN = 7
export const CARRY_REQUIRED = 3
export const HINT_COST = 5
// Save key is per Atlantic day — the solo game is now a daily, so a save from
// a previous day must never resume into today's puzzle. saveKeyFor() builds
// the dated key; OLD_SAVE_KEY is the pre-daily key we clean up on load.
const OLD_SAVE_KEY = 'rungles:solo:v1'
function saveKeyFor(dayKey) { return `rungles:solo:${dayKey ?? atlanticYMD()}` }

export function emptyWord() { return new Array(MAX_WORD_LEN).fill(null) }

export function pickPremiumPos(rng = Math.random) {
  // 2..6 inclusive — short words can sometimes miss the premium (per design).
  return 2 + Math.floor(rng() * 5)
}

export function initialState() {
  return {
    bag: [],
    rack: [],
    rackOrder: [],      // visual permutation of rack server-indices
    rungNumber: 1,
    totalScore: 0,
    ladder: [],         // [{ word, rungScore, premiumPos, sources: ['rack'|'carried',…] }]
    prevWord: null,
    carried: [],        // [{ letter, used: false }]
    selected: emptyWord(),
    selection: null,    // { source: 'rack'|'carried', idx } — picked-up tile
    premiumPos: null,
    premiumPositions: [], // all TOTAL_RUNGS premium positions, pre-rolled from the daily seed
    dayKey: null,         // Atlantic YYYY-MM-DD this board belongs to
    gameOver: false,
  }
}

// Build today's daily board. Everything random is derived from the daily seed
// so all players get the same board and the same per-rung premium positions —
// the deal AND the 7 premium slots are pre-rolled up front, so no randomness is
// consumed during play (refills just pop the already-shuffled bag).
export function newGameState(seedString = dailySeedString()) {
  const rng = rngFromSeed(seedString)
  const hand = dealOpeningHand(canFormAnyWord, rng)
  const s = initialState()
  s.bag = hand.bag
  s.rack = hand.rack
  s.rackOrder = identityOrder(s.rack.length)
  s.premiumPositions = Array.from({ length: TOTAL_RUNGS }, () => pickPremiumPos(rng))
  s.premiumPos = s.premiumPositions[0]
  s.dayKey = atlanticYMD()
  return s
}

// ── derived helpers ────────────────────────────────────────────────
export function currentWordLetters(s) { return s.selected.filter(Boolean) }
export function carriedUsedCount(s)   { return s.selected.filter(e => e && e.source === 'carried').length }
export function filledSlotCount(s)    { return s.selected.filter(Boolean).length }
export function lastFilledSlot(s) {
  for (let i = MAX_WORD_LEN - 1; i >= 0; i--) if (s.selected[i]) return i
  return -1
}
export function hasGap(s) {
  const last = lastFilledSlot(s)
  return last >= 0 && last + 1 !== filledSlotCount(s)
}
export function firstEmptySlot(s) {
  for (let i = 0; i < MAX_WORD_LEN; i++) if (!s.selected[i]) return i
  return -1
}
export function currentWord(s) {
  return currentWordLetters(s).map(e => e.letter).join('')
}
export function selectionMatches(s, source, idx) {
  return s.selection && s.selection.source === source && s.selection.idx === idx
}
export function previewScore(s) {
  return scoreRung(s.selected, s.premiumPos)
}

// ── actions: each returns a new state object (or { state, error } on validate) ──

export function withSelection(s, source, idx) {
  return { ...s, selection: { source, idx } }
}
export function clearSelection(s) {
  return { ...s, selection: null }
}

export function placeTileInSlot(s, slot, letter, source, srcIdx) {
  const next = { ...s, selected: s.selected.slice(), selection: null }
  next.selected[slot] = { source, idx: srcIdx, letter }
  return next
}

export function returnTileFromSlot(s, slot) {
  if (!s.selected[slot]) return s
  const next = { ...s, selected: s.selected.slice() }
  next.selected[slot] = null
  return next
}

// Swap two rack server-indices in the visual order. Pure: rack stays in
// deal/refill order, only rackOrder changes — so selected[].idx references
// (which are server-idx) remain valid without any remap.
export function reorderRack(s, fromServerIdx, toServerIdx) {
  if (fromServerIdx === toServerIdx) return clearSelection(s)
  const nextOrder = swapInOrder(s.rackOrder, fromServerIdx, toServerIdx)
  return { ...s, rackOrder: nextOrder, selection: null }
}

export function shuffleRack(s) {
  const lockedIdxs = s.selected.filter(e => e && e.source === 'rack').map(e => e.idx)
  const nextOrder = shuffleOrder(s.rackOrder, lockedIdxs)
  return { ...s, rackOrder: nextOrder }
}

export function clearWord(s) {
  return { ...s, selected: emptyWord(), selection: null }
}

// Type-to-place: prefer a free carried tile, otherwise a free rack tile.
export function tryTypeLetter(s, letter) {
  const slot = firstEmptySlot(s)
  if (slot === -1) return s

  const usedCarriedIdxs = new Set(s.selected.filter(e => e && e.source === 'carried').map(e => e.idx))
  const carriedMatch = s.carried.findIndex((c, i) => c.letter === letter && !usedCarriedIdxs.has(i))
  if (carriedMatch !== -1) {
    return placeTileInSlot(s, slot, letter, 'carried', carriedMatch)
  }

  const usedRackIdxs = new Set(s.selected.filter(e => e && e.source === 'rack').map(e => e.idx))
  const rackMatch = s.rack.findIndex((l, i) => l === letter && !usedRackIdxs.has(i))
  if (rackMatch !== -1) {
    return placeTileInSlot(s, slot, letter, 'rack', rackMatch)
  }
  return s
}

// Pop the last filled slot (Backspace).
export function popLastSlot(s) {
  const last = lastFilledSlot(s)
  if (last < 0) return s
  const next = { ...s, selected: s.selected.slice() }
  next.selected[last] = null
  return next
}

// Validate a submission. Returns { ok: true, state } or { ok: false, error }.
export function validateSubmit(s) {
  if (s.gameOver) return { ok: false, error: 'Game is over' }
  if (hasGap(s)) return { ok: false, error: 'Fill the empty slot(s) before submitting' }
  const word = currentWord(s)
  if (word.length < MIN_WORD_LEN) return { ok: false, error: `Too short — minimum ${MIN_WORD_LEN} letters` }
  if (!isValidWord(word)) return { ok: false, error: `"${word}" not in dictionary` }
  if (s.rungNumber > 1 && carriedUsedCount(s) < CARRY_REQUIRED) {
    return { ok: false, error: `Use at least ${CARRY_REQUIRED} carried letters (you used ${carriedUsedCount(s)})` }
  }
  return { ok: true, word }
}

// Apply a validated submission. Returns { state, scored: { word, rungScore, gameEnded } }.
export function applySubmit(s) {
  const compact = currentWordLetters(s)
  const word = compact.map(e => e.letter).join('')
  const rungScore = scoreRung(s.selected, s.premiumPos)
  const usedRackIdxs = compact
    .filter(e => e.source === 'rack')
    .map(e => e.idx)
    .sort((a, b) => b - a)

  const newRack = s.rack.slice()
  for (const idx of usedRackIdxs) newRack.splice(idx, 1)
  const newBag = s.bag.slice()
  refillRack(newRack, newBag)

  const newLadder = s.ladder.concat([{
    word,
    rungScore,
    premiumPos: s.premiumPos,
    sources: compact.map(e => e.source),
  }])
  const nextRungNumber = s.rungNumber + 1
  const gameEnded = nextRungNumber > TOTAL_RUNGS

  const next = {
    ...s,
    bag: newBag,
    rack: newRack,
    // Rack composition changed — reset visual order to identity. The user's
    // previous arrangement is no longer meaningful for the new tile set.
    rackOrder: identityOrder(newRack.length),
    rungNumber: nextRungNumber,
    totalScore: s.totalScore + rungScore,
    ladder: newLadder,
    prevWord: word,
    selected: emptyWord(),
    selection: null,
    carried: gameEnded ? [] : word.split('').map(letter => ({ letter, used: false })),
    // Pre-rolled from the daily seed at deal time — same premium for everyone.
    premiumPos: gameEnded ? null : s.premiumPositions[nextRungNumber - 1],
    gameOver: gameEnded,
  }
  return { state: next, scored: { word, rungScore, gameEnded } }
}

export function applyHint(s) {
  const minCarried = s.rungNumber > 1 ? CARRY_REQUIRED : 0
  const carriedLetters = s.carried.map(c => c.letter)
  const word = findHintWord(s.rack, carriedLetters, minCarried)
  if (!word) return { state: s, word: null }
  return { state: { ...s, totalScore: s.totalScore - HINT_COST }, word }
}

export function giveUp(s) {
  return { ...s, gameOver: true }
}

// Best word/rung for the recordSoloGame Supabase insert.
export function bestRung(state) {
  let best = null
  for (const rung of state.ladder) {
    if (!best || rung.rungScore > best.rungScore) best = rung
  }
  return best
}

// ── persistence ────────────────────────────────────────────────────
export function saveState(state) {
  try {
    const key = saveKeyFor(state.dayKey)
    if (state.gameOver) { localStorage.removeItem(key); return }
    const snapshot = { ...state, selection: null }
    localStorage.setItem(key, JSON.stringify(snapshot))
  } catch { /* quota / disabled storage — silent */ }
}

export function loadState() {
  try {
    localStorage.removeItem(OLD_SAVE_KEY) // drop pre-daily free-play save
    const today = atlanticYMD()
    const raw = localStorage.getItem(saveKeyFor(today))
    if (!raw) return null
    const saved = JSON.parse(raw)
    if (!saved || saved.gameOver) return null
    // A save from a previous day must not resume into today's puzzle.
    if (saved.dayKey && saved.dayKey !== today) return null
    // Backward compat: older saves predate rackOrder. Default to identity if
    // missing or invalid (wrong length, bad values).
    const rackOrder = normalizeOrder(saved.rackOrder, (saved.rack ?? []).length)
    return { ...saved, rackOrder, selection: null }
  } catch { return null }
}

// Pass the finished board's dayKey. A ladder that crossed midnight was saved
// under its own day's key, so defaulting to today would orphan it (c257).
export function clearSave(dayKey) {
  try { localStorage.removeItem(saveKeyFor(dayKey)) } catch {}
}

export { LETTER_VALUES, RACK_SIZE }
