import React, { useEffect, useRef, useState } from 'react'
import Tile from './Tile.jsx'
import BoardSlots from './BoardSlots.jsx'
import CarriedTiles from './CarriedTiles.jsx'
import LadderRow from './LadderRow.jsx'
import BlankPickerModal from './BlankPickerModal.jsx'
import HistoryModal from './HistoryModal.jsx'
import EndGameModal from './EndGameModal.jsx'
import { useGameActions } from '../contexts/GameActionsContext.jsx'
import { useBoardDerived } from '../hooks/useBoardDerived.js'
import {
  TOTAL_RUNGS, MAX_WORD_LEN, CARRY_REQUIRED, HINT_COST,
  newGameState, loadState, saveState, clearSave,
  selectionMatches, withSelection, clearSelection, placeTileInSlot,
  returnTileFromSlot, reorderRack, shuffleRack, clearWord,
  validateSubmit, applySubmit, applyHint, giveUp,
  lastFilledSlot, previewScore, tryTypeLetter, popLastSlot,
  bestRung,
} from '../lib/soloGame.js'
import { dailySeedString, atlanticYMD } from '../lib/rng.js'
import { fetchTodayDaily, recordDailySolo } from '../lib/statsService.js'
import RunglesHeader from './RunglesHeader.jsx'
import { SQBoardShell, SQBoardHeader } from '../../../rae-side-quest/packages/sq-ui/index.js'

export default function SoloGamePage({ onBack, profile, onOpenStats, myUserId }) {
  // Solo is a daily (c215): one shared board per Atlantic day, one scored
  // play per user per day. Gate on whether they've already played today.
  const today = atlanticYMD()
  const [daily, setDaily] = useState('checking') // 'checking' | 'playable' | { ...row } already played
  const [state, setState] = useState(() => loadState() ?? newGameState(dailySeedString()))
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

  // Daily gate: on mount, check whether the user already played today.
  useEffect(() => {
    let alive = true
    if (!myUserId) { setDaily('playable'); return } // dev / no auth — allow, won't record
    fetchTodayDaily(myUserId, today)
      .then(row => { if (alive) setDaily(row ?? 'playable') })
      .catch(() => { if (alive) setDaily('playable') })
    return () => { alive = false }
  }, [myUserId, today])

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
        if (lastFilledSlot(state) >= 0) { e.preventDefault(); setState(prev => clearWord(prev)) }
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
    const best = bestRung(finalState)
    // The EndGameModal (ladder + final score, with Lobby/Leaderboard actions)
    // is the post-game surface for THIS session. The already-played panel only
    // gates re-entry (fetchTodayDaily on the next mount), so we don't flip to
    // it here — that would yank the modal away the instant the write returns.
    recordDailySolo({
      totalScore: finalState.totalScore,
      rungsCompleted: finalState.ladder.length,
      gaveUp,
      bestWord: best?.word ?? null,
      bestRungScore: best?.rungScore ?? null,
    }).catch(e => console.warn('Daily record failed', e)) // dev / no auth — silent
  }

  const { filled, usedRackIdxs, usedCarriedIdxs } = useBoardDerived(state.selected)
  const preview = filled > 0 ? previewScore(state) : null
  const submitDisabled = state.gameOver || filled < 1
  const lastRung = state.ladder.length > 0 ? state.ladder[state.ladder.length - 1] : null

  // ── Daily gate ───────────────────────────────────────────────
  if (daily === 'checking') {
    return (
      <DailyShell profile={profile} onOpenStats={onOpenStats} onBack={onBack}>
        <p className="text-sm text-rungles-600 dark:text-rungles-300 text-center py-8">Loading today's puzzle…</p>
      </DailyShell>
    )
  }
  if (daily !== 'playable') {
    return (
      <DailyShell profile={profile} onOpenStats={onOpenStats} onBack={onBack}>
        <DailyPlayedPanel row={daily} onOpenStats={onOpenStats} onBack={onBack} />
      </DailyShell>
    )
  }

  return (
    <SQBoardShell
      width="narrow"
      header={<RunglesHeader profile={profile} onOpenStats={onOpenStats} />}
      subHeader={
        <SQBoardHeader
          backLabel="← Lobby"
          onBackClick={onBack}
          rightSlot={
            <span className="font-display text-sm text-rungles-700 dark:text-rungles-200">
              Rung {Math.min(state.rungNumber, TOTAL_RUNGS)} / {TOTAL_RUNGS}
            </span>
          }
        />
      }
    >
      {/* Total score — pulses on each increment so the player can watch
          their score grow without a dedicated card. */}
      <div className="flex justify-end mb-2">
        <span
          className={`font-display text-sm text-rungles-700 dark:text-rungles-200 bg-rungles-100 dark:bg-[#2d1b55] px-3 py-1 rounded-full transition-transform ${scorePulse ? 'scale-125' : ''}`}
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
        <BoardSlots
          selected={state.selected}
          premiumPos={state.premiumPos}
          onSlotTap={handleSlotTap}
          wrapperClassName={`flex justify-center gap-1 transition-all ${
            flash === 'valid'
              ? 'animate-pulse'
              : flash === 'invalid'
              ? 'animate-[shake_0.4s]'
              : ''
          }`}
        />

        <div className="flex items-center justify-end text-xs">
          <span className={`font-display text-rungles-700 ${preview ? 'opacity-100' : 'opacity-0'}`}>
            {preview != null ? `+${preview} pts` : ''}
          </span>
        </div>

        <CarriedTiles
          letters={state.carried.map(c => c.letter)}
          usedIdxs={usedCarriedIdxs}
          isSelected={(idx) => selectionMatches(state, 'carried', idx)}
          onTileTap={(idx) => handleSourceTap('carried', idx)}
          emptyMessage="Carried: — (rung 1: no carryover)"
          label={`Carried (need ${CARRY_REQUIRED}):`}
        />
      </section>

      <section className="card !p-3 mb-2" aria-label="Your tile rack">
        <div className="grid grid-cols-7 gap-1 max-w-[304px] mx-auto">
          {state.rackOrder.map(serverIdx => {
            const letter = state.rack[serverIdx]
            const inWord = usedRackIdxs.has(serverIdx)
            return (
              <Tile
                key={serverIdx}
                letter={letter}
                ghost={inWord}
                selected={selectionMatches(state, 'rack', serverIdx)}
                onClick={() => !inWord && handleSourceTap('rack', serverIdx)}
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
        onViewLeaderboard={onOpenStats}
        onBackToLobby={onBack}
        onClose={() => setEndgameOpen(false)}
      />
    </SQBoardShell>
  )
}

// Shell for the daily gate states (checking / already played) — reuses the
// solo chrome so the header + back button match the game view.
function DailyShell({ profile, onOpenStats, onBack, children }) {
  return (
    <SQBoardShell
      width="narrow"
      header={<RunglesHeader profile={profile} onOpenStats={onOpenStats} />}
      subHeader={<SQBoardHeader backLabel="← Lobby" onBackClick={onBack} />}
    >
      {children}
    </SQBoardShell>
  )
}

// Shown when the user has already played today's daily.
function DailyPlayedPanel({ row, onOpenStats, onBack }) {
  return (
    <section className="card text-center space-y-3">
      <h2 className="font-display text-xl text-rungles-700 dark:text-rungles-200">
        ✅ You've climbed today's ladder
      </h2>
      <p className="text-sm text-rungles-600 dark:text-rungles-300">
        One play a day — come back tomorrow for a fresh ladder.
      </p>
      <div>
        <p className="text-xs uppercase tracking-wider text-rungles-500 mb-1">Today's score</p>
        <p className="font-display text-5xl text-rungles-700 dark:text-rungles-100">{row.total_score}</p>
        <p className="text-xs text-rungles-500 mt-1">
          {row.gave_up ? `🏳️ gave up on rung ${row.rungs_completed + 1}` : '🏁 complete'}
          {row.best_word ? ` · best: ${row.best_word} (+${row.best_rung_score})` : ''}
        </p>
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" className="btn-secondary flex-1" onClick={onBack}>← Lobby</button>
        <button type="button" className="btn-primary flex-1" onClick={onOpenStats}>🏆 Leaderboard</button>
      </div>
    </section>
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
