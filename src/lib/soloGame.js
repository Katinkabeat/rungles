// Pure state + helpers for the solo Rungles game. UI lives in SoloGamePage.jsx.
// State shape mirrors legacy js/game.js so the localStorage save key
// `rungles:solo:v1` survives the cutover.

import { dealOpeningHand, refillRack, LETTER_VALUES, RACK_SIZE } from './tiles.js'
import { isValidWord, canFormAnyWord, findHintWord } from './dictionary.js'
import { scoreRung } from './scoring.js'

export const TOTAL_RUNGS = 7
export const MIN_WORD_LEN = 4
export const MAX_WORD_LEN = 7
export const CARRY_REQUIRED = 3
export const HINT_COST = 5
export const SAVE_KEY = 'rungles:solo:v1'

export function emptyWord() { return new Array(MAX_WORD_LEN).fill(null) }

export function pickPremiumPos() {
  // 2..6 inclusive — short words can sometimes miss the premium (per design).
  return 2 + Math.floor(Math.random() * 5)
}

export function initialState() {
  return {
    bag: [],
    rack: [],
    rungNumber: 1,
    totalScore: 0,
    ladder: [],         // [{ word, rungScore, premiumPos, sources: ['rack'|'carried',…] }]
    prevWord: null,
    carried: [],        // [{ letter, used: false }]
    selected: emptyWord(),
    selection: null,    // { source: 'rack'|'carried', idx } — picked-up tile
    premiumPos: null,
    gameOver: false,
  }
}

export function newGameState() {
  const hand = dealOpeningHand(canFormAnyWord)
  const s = initialState()
  s.bag = hand.bag
  s.rack = hand.rack
  s.premiumPos = pickPremiumPos()
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

export function reorderRack(s, fromIdx, toIdx) {
  if (fromIdx === toIdx) return clearSelection(s)
  const newRack = [...s.rack]
  const [letter] = newRack.splice(fromIdx, 1)
  const insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx
  newRack.splice(insertAt, 0, letter)

  // Old idx -> new idx so any in-word rack references remain valid.
  const oldInNew = []
  for (let i = 0; i < s.rack.length; i++) if (i !== fromIdx) oldInNew.push(i)
  oldInNew.splice(insertAt, 0, fromIdx)
  const remap = {}
  oldInNew.forEach((oldIdx, newIdx) => { remap[oldIdx] = newIdx })

  const newSelected = s.selected.map(e =>
    (e && e.source === 'rack') ? { ...e, idx: remap[e.idx] } : e
  )
  return { ...s, rack: newRack, selected: newSelected, selection: null }
}

export function shuffleRack(s) {
  const selectedIdxs = new Set(s.selected.filter(e => e && e.source === 'rack').map(e => e.idx))
  const freeIdxs = s.rack.map((_, i) => i).filter(i => !selectedIdxs.has(i))
  const freeLetters = freeIdxs.map(i => s.rack[i])
  for (let i = freeLetters.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[freeLetters[i], freeLetters[j]] = [freeLetters[j], freeLetters[i]]
  }
  const newRack = s.rack.slice()
  freeIdxs.forEach((idx, k) => { newRack[idx] = freeLetters[k] })
  return { ...s, rack: newRack }
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
    rungNumber: nextRungNumber,
    totalScore: s.totalScore + rungScore,
    ladder: newLadder,
    prevWord: word,
    selected: emptyWord(),
    selection: null,
    carried: gameEnded ? [] : word.split('').map(letter => ({ letter, used: false })),
    premiumPos: gameEnded ? null : pickPremiumPos(),
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
    if (state.gameOver) { localStorage.removeItem(SAVE_KEY); return }
    const snapshot = { ...state, selection: null }
    localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot))
  } catch { /* quota / disabled storage — silent */ }
}

export function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw)
    if (!saved || saved.gameOver) return null
    return { ...saved, selection: null }
  } catch { return null }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY) } catch {}
}

export { LETTER_VALUES, RACK_SIZE }
