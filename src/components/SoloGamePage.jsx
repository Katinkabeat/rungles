import React, { useEffect, useRef, useState } from 'react'
import Tile, { EmptySlot } from './Tile.jsx'
import LadderRow from './LadderRow.jsx'
import BlankPickerModal from './BlankPickerModal.jsx'
import HistoryModal from './HistoryModal.jsx'
import EndGameModal from './EndGameModal.jsx'
import { useGameActions } from '../contexts/GameActionsContext.jsx'
import {
  TOTAL_RUNGS, MAX_WORD_LEN, CARRY_REQUIRED, HINT_COST,
  newGameState, loadState, saveState, clearSave,
  selectionMatches, withSelection, clearSelection, placeTileInSlot,
  returnTileFromSlot, reorderRack, shuffleRack, clearWord,
  validateSubmit, applySubmit, applyHint, giveUp,
  filledSlotCount, lastFilledSlot, currentWord, currentWordLetters,
  carriedUsedCount, previewScore, tryTypeLetter, popLastSlot,
  bestRung,
} from '../lib/soloGame.js'
import { supabase } from '../lib/supabase.js'

export default function SoloGamePage({ onBack }) {
  const [state, setState] = useState(() => loadState() ?? newGameState())
  const [banner, setBanner] = useState({ text: '', tone: '' })
  const [flash, setFlash] = useState('')
  const [scorePulse, setScorePulse] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [endgameOpen, setEndgameOpen] = useState(false)
  const [endgameGaveUp, setEndgameGaveUp] = useState(false)
  const [pendingBlank, setPendingBlank] = useState(null)
  const [giveUpArmed, setGiveUpArmed] = useState(false)
  const giveUpTimer = useRef(null)
  const { setHintAction } = useGameActions()
  // Keep a ref so the registered hint callback always reads the latest state
  // (otherwise the captured closure would see stale state from mount).
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])

  useEffect(() => { saveState(state) }, [state])

  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'hidden') saveState(state) }
    const onHide = () => saveState(state)
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', onHide)
    }
  }, [state])

  // Register hint with the global Settings dropdown.
  useEffect(() => {
    setHintAction(doHintFromContext)
    return () => setHintAction(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function doHintFromContext() {
    const s = stateRef.current
    if (s.gameOver) return
    const { state: next, word } = applyHint(s)
    if (!word) {
      setBanner({ text: 'No valid word found — try Give Up.', tone: 'bad' })
      return
    }
    setState(next)
    pulseScore()
    setBanner({ text: `💡 Try: ${word}  (−${HINT_COST} pts)`, tone: 'ok' })
  }

  // Keyboard.
  useEffect(() => {
    function onKey(e) {
      if (state.gameOver) return
      if (document.querySelector('dialog[open]')) return
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (e.key === 'Enter') { e.preventDefault(); doSubmit(); return }
      if (e.key === 'Backspace') {
        if (lastFilledSlot(state) >= 0) { e.preventDefault(); setState(prev => popLastSlot(prev)) }
        return
      }
      if (e.key === 'Escape') {
        if (state.selection) { e.preventDefault(); setState(prev => clearSelection(prev)); return }
        if (filledSlotCount(state) > 0) { e.preventDefault(); setState(prev => clearWord(prev)) }
        return
      }
      if (/^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault()
        const letter = e.key.toUpperCase()
        setState(prev => tryTypeLetter(prev, letter))
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  function handleSourceTap(source, idx) {
    if (!state.selection) { setState(withSelection(state, source, idx)); return }
    if (selectionMatches(state, source, idx)) { setState(clearSelection(state)); return }
    const sel = state.selection
    if (sel.source === 'rack' && source === 'rack') {
      setState(reorderRack(state, sel.idx, idx))
      return
    }
    setState(withSelection(state, source, idx))
  }

  function handleSlotTap(slot) {
    const entry = state.selected[slot]
    if (!state.selection) {
      if (entry) setState(returnTileFromSlot(state, slot))
      return
    }
    const sel = state.selection
    if (sel.source === 'rack') {
      const letter = state.rack[sel.idx]
      if (letter === '_') { setPendingBlank({ slot, srcIdx: sel.idx }); return }
      setState(placeTileInSlot(state, slot, letter, 'rack', sel.idx))
    } else {
      const letter = state.carried[sel.idx].letter
      setState(placeTileInSlot(state, slot, letter, 'carried', sel.idx))
    }
  }

  function handleBlankPick(letter) {
    if (!pendingBlank) return
    const { slot, srcIdx } = pendingBlank
    setPendingBlank(null)
    if (!letter) return
    setState(placeTileInSlot(state, slot, letter, 'rack', srcIdx))
  }

  function flashInput(valid, message) {
    setFlash(valid ? 'valid' : 'invalid')
    setBanner({ text: message, tone: valid ? 'ok' : 'bad' })
    setTimeout(() => setFlash(''), 700)
  }

  function pulseScore() {
    setScorePulse(true)
    setTimeout(() => setScorePulse(false), 350)
  }

  function doSubmit() {
    const v = validateSubmit(state)
    if (!v.ok) { flashInput(false, v.error); return }
    const { state: next, scored } = applySubmit(state)
    setState(next)
    pulseScore()
    flashInput(true, `✓ ${scored.word} +${scored.rungScore}`)
    if (scored.gameEnded) finishGame(next, false)
  }

  function doGiveUp() {
    if (state.gameOver) return
    if (!giveUpArmed) {
      setGiveUpArmed(true)
      giveUpTimer.current = setTimeout(() => setGiveUpArmed(false), 2500)
      return
    }
    clearTimeout(giveUpTimer.current)
    setGiveUpArmed(false)
    const next = giveUp(state)
    setState(next)
    finishGame(next, true)
  }

  function finishGame(finalState, gaveUp) {
    setEndgameGaveUp(gaveUp)
    setEndgameOpen(true)
    clearSave()
    recordSoloGame(finalState, gaveUp).catch(e => console.warn('Stats record failed', e))
  }

  function startNewGame() {
    setEndgameOpen(false)
    setBanner({ text: '', tone: '' })
    setGiveUpArmed(false)
    setState(newGameState())
  }

  const usedRackIdxs = new Set(state.selected.filter(e => e && e.source === 'rack').map(e => e.idx))
  const usedCarriedIdxs = new Set(state.selected.filter(e => e && e.source === 'carried').map(e => e.idx))
  const filled = filledSlotCount(state)
  const preview = filled > 0 ? previewScore(state) : null
  const submitDisabled = state.gameOver || filled < 1
  const lastRung = state.ladder.length > 0 ? state.ladder[state.ladder.length - 1] : null

  return (
    <main className="max-w-[480px] mx-auto px-4 py-3 flex flex-col min-h-[calc(100vh-64px)]">
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={onBack}
          className="text-rungles-400 hover:text-rungles-700 dark:hover:text-rungles-300 text-sm font-bold"
        >
          ← Lobby
        </button>
        <span className="font-display text-sm text-rungles-700">
          Rung {Math.min(state.rungNumber, TOTAL_RUNGS)} / {TOTAL_RUNGS}
        </span>
        <span
          className={`font-display text-sm text-rungles-700 transition-transform ${scorePulse ? 'scale-125' : ''}`}
        >
          Score: {state.totalScore}
        </span>
      </div>

      {banner.text && (
        <div
          role="status"
          className={`text-sm font-semibold rounded-lg px-3 py-2 mb-2 ${
            banner.tone === 'ok'
              ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-200'
              : 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200'
          }`}
        >
          {banner.text}
        </div>
      )}

      {/* Last played word sits above the play area. */}
      {lastRung && (
        <section className="card !p-3 mb-2" aria-label="Previous rung">
          <LadderRow
            rung={lastRung}
            label={`Rung ${state.ladder.length}`}
            onClick={state.ladder.length > 1 ? () => setHistoryOpen(true) : undefined}
          />
        </section>
      )}

      <section className="card !p-3 space-y-2 mb-2" aria-label="Current rung">
        <div
          className={`flex justify-center gap-1 transition-all ${
            flash === 'valid'
              ? 'animate-pulse'
              : flash === 'invalid'
              ? 'animate-[shake_0.4s]'
              : ''
          }`}
        >
          {Array.from({ length: MAX_WORD_LEN }, (_, slot) => {
            const entry = state.selected[slot]
            const isPremium = (slot + 1) === state.premiumPos
            if (entry) {
              const isPremiumHit = isPremium && entry.source === 'rack'
              return (
                <Tile
                  key={slot}
                  letter={entry.letter}
                  variant="in-word"
                  premium={isPremiumHit}
                  carried={entry.source === 'carried'}
                  onClick={() => handleSlotTap(slot)}
                />
              )
            }
            return (
              <EmptySlot
                key={slot}
                premium={isPremium}
                onClick={() => handleSlotTap(slot)}
                ariaLabel={`Slot ${slot + 1}${isPremium ? ' (2× bonus)' : ''}`}
              />
            )
          })}
        </div>

        <div className="flex items-center justify-end text-xs">
          <span className={`font-display text-rungles-700 ${preview ? 'opacity-100' : 'opacity-0'}`}>
            {preview != null ? `+${preview} pts` : ''}
          </span>
        </div>

        {state.carried.length === 0 ? (
          <p className="text-xs text-rungles-500 italic">Carried: — (rung 1: no carryover)</p>
        ) : (
          <div className="space-y-1">
            <p className="text-xs text-rungles-600 dark:text-rungles-300">
              Carried (need {CARRY_REQUIRED}):
            </p>
            <div className="flex gap-1 flex-wrap">
              {state.carried.map((c, idx) => {
                const used = usedCarriedIdxs.has(idx)
                return (
                  <Tile
                    key={idx}
                    letter={c.letter}
                    variant="small"
                    carried
                    ghost={used}
                    selected={selectionMatches(state, 'carried', idx)}
                    onClick={() => !used && handleSourceTap('carried', idx)}
                  />
                )
              })}
            </div>
          </div>
        )}
      </section>

      <section className="card !p-3 mb-2" aria-label="Your tile rack">
        <div className="flex items-center justify-center gap-1 flex-nowrap">
          {state.rack.map((letter, idx) => {
            const inWord = usedRackIdxs.has(idx)
            return (
              <Tile
                key={idx}
                letter={letter}
                ghost={inWord}
                selected={selectionMatches(state, 'rack', idx)}
                onClick={() => !inWord && handleSourceTap('rack', idx)}
              />
            )
          })}
        </div>
      </section>

      {/* Spacer pushes the action bar to the bottom of the page. */}
      <div className="flex-1" />

      <section className="action-bar-sticky space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <ActionButton emoji="✅" label="Submit" onClick={doSubmit} variant="primary" disabled={submitDisabled} />
          <ActionButton
            emoji="↩️"
            label="Clear"
            onClick={() => setState(clearWord(state))}
            variant="secondary"
            disabled={filled === 0 && !state.selection}
          />
          <ActionButton
            emoji="🔀"
            label="Shuffle"
            onClick={() => setState(shuffleRack(state))}
            variant="secondary"
            disabled={state.gameOver}
          />
        </div>
        <ActionButton
          emoji="🏳️"
          label={giveUpArmed ? 'Tap again to confirm' : 'Give Up'}
          onClick={doGiveUp}
          variant="danger"
          disabled={state.gameOver}
          fullWidth
        />
      </section>

      <BlankPickerModal
        open={!!pendingBlank}
        onPick={handleBlankPick}
        onCancel={() => handleBlankPick(null)}
      />
      <HistoryModal
        open={historyOpen}
        ladder={state.ladder}
        onClose={() => setHistoryOpen(false)}
      />
      <EndGameModal
        open={endgameOpen}
        ladder={state.ladder}
        totalScore={state.totalScore}
        gaveUp={endgameGaveUp}
        onPlayAgain={startNewGame}
        onClose={() => setEndgameOpen(false)}
      />
    </main>
  )
}

function ActionButton({ emoji, label, onClick, variant, disabled, fullWidth = false }) {
  const variantCls =
    variant === 'primary'
      ? 'btn-icon btn-icon-primary'
      : variant === 'danger'
      ? 'btn-icon btn-icon-danger'
      : 'btn-icon btn-icon-secondary'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${variantCls} ${fullWidth ? 'w-full' : ''}`}
    >
      <span className="btn-icon-emoji">{emoji}</span>
      <span className="btn-icon-label">{label}</span>
    </button>
  )
}

async function recordSoloGame(state, gaveUp) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const best = bestRung(state)
  await supabase.from('rg_solo_games').insert({
    user_id: user.id,
    total_score: state.totalScore,
    rungs_completed: state.ladder.length,
    gave_up: gaveUp,
    best_word: best?.word ?? null,
    best_rung_score: best?.rungScore ?? null,
  })
}
