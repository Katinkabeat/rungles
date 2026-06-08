import React, { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Tile from './Tile.jsx'
import BoardSlots from './BoardSlots.jsx'
import CarriedTiles from './CarriedTiles.jsx'
import BlankPickerModal from './BlankPickerModal.jsx'
import MultiLadderRow, { SeedRow } from './MultiLadderRow.jsx'
import MultiHistoryModal from './MultiHistoryModal.jsx'
import MultiEndGameModal from './MultiEndGameModal.jsx'
import {
  loadMatch, fetchPremium, refreshRack,
  submitRung, skipTurn, giveUpMatch, claimInactiveWin,
  subscribeMatch, subscribeGameStatus, unsubscribe,
} from '../lib/matchService.js'
import { joinGame as joinGameRpc } from '../lib/lobbyService.js'
import { scoreRung } from '../lib/scoring.js'
import { identityOrder, swapInOrder, shuffleOrder, normalizeOrder } from '../lib/rackOrder.js'
import { useBoardDerived } from '../hooks/useBoardDerived.js'
import RunglesHeader from './RunglesHeader.jsx'
import { SQBoardShell, SQBoardHeader, SQSettingsRow } from '../../../rae-side-quest/packages/sq-ui/index.js'

const RACK_ORDER_STORAGE_PREFIX = 'rungles:multi:rackOrder:'

function rackOrderKey(gameId) { return RACK_ORDER_STORAGE_PREFIX + gameId }

function loadSavedRackOrder(gameId, rackLength) {
  try {
    const raw = localStorage.getItem(rackOrderKey(gameId))
    if (!raw) return null
    const arr = JSON.parse(raw)
    return normalizeOrder(arr, rackLength)
  } catch { return null }
}

function saveSavedRackOrder(gameId, order) {
  try {
    if (!Array.isArray(order) || order.length === 0) {
      localStorage.removeItem(rackOrderKey(gameId))
    } else {
      localStorage.setItem(rackOrderKey(gameId), JSON.stringify(order))
    }
  } catch { /* quota / disabled — silent */ }
}

const MAX_WORD_LEN = 7
const MIN_WORD_LEN = 4
const CARRY_REQUIRED = 3

function emptyWord() { return new Array(MAX_WORD_LEN).fill(null) }

export default function MultiGamePage({ gameId, myUserId, onLeave, profile, onOpenStats }) {
  // Top-level data
  const [game, setGame] = useState(null)
  const [players, setPlayers] = useState([])
  const [rack, setRack] = useState([])
  const [rungs, setRungs] = useState([])
  const [premiumPos, setPremiumPos] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  // Word-builder state. selected[slot] = { source, idx (serverIdx for rack), letter } | null
  const [selected, setSelected] = useState(emptyWord())
  const [selection, setSelection] = useState(null) // { source, idx }
  const [rackOrder, setRackOrder] = useState(null) // visual permutation of serverIdx; null = identity

  // UI state
  const [status, setStatus] = useState({ text: '', tone: '' })
  const [submitting, setSubmitting] = useState(false)
  const [pendingBlank, setPendingBlank] = useState(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [endgameOpen, setEndgameOpen] = useState(false)
  const wasComplete = useRef(false) // track status transitions
  const [autoJoining, setAutoJoining] = useState(false)
  const autoJoinAttemptedRef = useRef(false)

  // Initial load.
  useEffect(() => {
    let alive = true
    setLoading(true)
    loadMatch(gameId, myUserId)
      .then(data => {
        if (!alive) return
        setGame(data.game)
        setPlayers(data.players)
        setRack(data.rack)
        setRungs(data.rungs)
        setPremiumPos(data.premiumPos)
        // Restore the user's saved visual rack order if it's still valid
        // (matches current rack length). Survives reload / app close.
        setRackOrder(loadSavedRackOrder(gameId, data.rack.length))
        wasComplete.current = data.game.status === 'complete'
        // Auto-open the end-game modal on cold load if the game's already
        // finished and this user hasn't dismissed the result yet (e.g. they
        // navigated here from the lobby banner or finish toast).
        if (data.game.status === 'complete') {
          const meRow = data.players.find(p => p.userId === myUserId)
          if (meRow && meRow.dismissedAt == null) setEndgameOpen(true)
        }
        setLoading(false)
      })
      .catch(e => {
        if (!alive) return
        setLoadError(e.message ?? String(e))
        setLoading(false)
      })
    return () => { alive = false }
  }, [gameId, myUserId])

  // Auto-accept invite when arriving from a notification deep-link.
  // The notification URL goes straight to /?game=<id>, so an invitee who
  // hasn't formally joined yet (no rg_players row) lands on a game they
  // can't play. Detect that state and join on their behalf.
  useEffect(() => {
    if (!game || autoJoinAttemptedRef.current || autoJoining) return
    const iAmPlayer = (players ?? []).some(p => p.userId === myUserId)
    if (iAmPlayer) return

    if (game.invited_user_id !== myUserId || game.status !== 'waiting') {
      autoJoinAttemptedRef.current = true
      toast.error("You're not in this game.")
      onLeave?.()
      return
    }

    autoJoinAttemptedRef.current = true
    setAutoJoining(true)
    ;(async () => {
      try {
        await joinGameRpc(gameId)
        toast.success('🎯 Joined! Good luck!')
        const data = await loadMatch(gameId, myUserId)
        setGame(data.game)
        setPlayers(data.players)
        setRack(data.rack)
        setRungs(data.rungs)
        setPremiumPos(data.premiumPos)
      } catch (err) {
        toast.error(err.message ?? "Couldn't join game")
        onLeave?.()
      } finally {
        setAutoJoining(false)
      }
    })()
  }, [game, players, myUserId, autoJoining, gameId, onLeave])

  // Waiting-room subscription: jump to active when status flips.
  useEffect(() => {
    if (!game || game.status !== 'waiting') return
    const ch = subscribeGameStatus(gameId, async (newGame) => {
      if (newGame.status === 'active') {
        // Reload everything (rack, players, premium) since status flipped.
        try {
          const data = await loadMatch(gameId, myUserId)
          setGame(data.game)
          setPlayers(data.players)
          setRack(data.rack)
          setRungs(data.rungs)
          setPremiumPos(data.premiumPos)
        } catch (e) {
          toast.error(`Couldn't load match: ${e.message ?? e}`)
        }
      } else {
        setGame(newGame)
      }
    })
    return () => unsubscribe(ch)
  }, [game?.status, gameId, myUserId])

  // Persist the user's visual rack order so closing the app and coming back
  // doesn't reset their tile arrangement. Runs on every change; null clears
  // the entry. Only saves once we have a rack to be ordered against.
  useEffect(() => {
    if (rack.length === 0) return
    saveSavedRackOrder(gameId, rackOrder)
  }, [gameId, rackOrder, rack.length])

  // Active-match subscription.
  useEffect(() => {
    if (!game || game.status !== 'active') return
    const ch = subscribeMatch(gameId, {
      onRungInsert: (newRung) => {
        setRungs(prev => {
          if (prev.find(r => r.id === newRung.id)) return prev
          return [...prev, newRung].sort((a, b) => a.rung_number - b.rung_number)
        })
        // Refresh premium for the next rung.
        fetchPremium(gameId, (rungs.length + 1) + 1).then(setPremiumPos).catch(() => {})
      },
      onGameUpdate: async (newGame) => {
        const wasC = wasComplete.current
        setGame(newGame)
        // Server may have refilled rack on turn change.
        try {
          const r = await refreshRack(gameId, myUserId)
          setRack(r)
          // Rack composition changed — discard saved visual order, it no
          // longer maps to a meaningful tile arrangement.
          setRackOrder(null)
        } catch {}
        if (newGame.status === 'complete' && !wasC) {
          wasComplete.current = true
          // Show endgame modal to whoever made the final move; the other
          // player sees the status banner and pill.
          // We can't reliably know "did I just submit" from inside this
          // callback, so we always open it — Close + pill let them dismiss.
          setEndgameOpen(true)
        }
      },
      onPlayerUpdate: (newPlayer) => {
        setPlayers(prev => prev.map(p =>
          p.userId === newPlayer.user_id
            ? { ...p, score: newPlayer.score }
            : p
        ))
      },
    })
    return () => unsubscribe(ch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.status, gameId, myUserId])

  // ── derived helpers ─────────────────────────────────────────
  const me = players.find(p => p.userId === myUserId)
  const opponent = players.find(p => p.userId !== myUserId)
  const myTurn = !!game && game.status === 'active' && me && game.current_player_idx === me.playerIdx
  const playable = myTurn && !submitting

  // Claim the win when the opponent has been sitting on their turn for 7+
  // days (c153). turn_started_at is the inactivity clock (shared with nudge).
  const canClaim = !!(
    game && game.status === 'active' && me &&
    game.current_player_idx !== me.playerIdx &&
    game.turn_started_at &&
    Date.now() - new Date(game.turn_started_at).getTime() > 7 * 24 * 60 * 60 * 1000
  )

  const carriedLetters = (() => {
    if (rungs.length === 0) return (game?.seed_word ?? '').split('')
    return rungs[rungs.length - 1].word.split('')
  })()
  const fromSeed = rungs.length === 0

  const { filled, hasGap, currentWord, usedRackIdxs, usedCarriedIdxs } = useBoardDerived(selected)
  const carriedUsed = usedCarriedIdxs.size
  const previewPts = filled > 0 ? scoreRung(selected, premiumPos) : null

  const order = (() => {
    if (Array.isArray(rackOrder) && rackOrder.length === rack.length) return rackOrder
    return rack.map((_, i) => i)
  })()

  const nextRungNumber = rungs.length + 1
  const totalRungs = game?.total_rungs ?? 10

  // ── interactions ────────────────────────────────────────────
  function clearWord() {
    setSelected(emptyWord())
    setSelection(null)
  }

  function selectionMatches(source, idx) {
    return selection && selection.source === source && selection.idx === idx
  }

  function handleSourceTap(source, idx) {
    // Rack-only interactions (selecting a rack tile, swapping two rack tiles)
    // are always allowed — purely visual prep, no server effect. Carried tiles
    // and slot placement still require it to be your turn.
    if (!selection) {
      if (source === 'rack' || playable) setSelection({ source, idx })
      return
    }
    if (selectionMatches(source, idx)) { setSelection(null); return }
    if (selection.source === 'rack' && source === 'rack') {
      setRackOrder(swapInOrder(order, selection.idx, idx))
      setSelection(null)
      return
    }
    if (!playable) return
    setSelection({ source, idx })
  }

  function handleSlotTap(slot) {
    if (!playable) return
    const entry = selected[slot]
    if (!selection) {
      if (entry) {
        const next = selected.slice()
        next[slot] = null
        setSelected(next)
      }
      return
    }
    if (selection.source === 'rack') {
      const letter = rack[selection.idx]
      if (letter === '_') {
        setPendingBlank({ slot, srcIdx: selection.idx })
        return
      }
      placeAtSlot(slot, letter, 'rack', selection.idx)
    } else {
      const letter = carriedLetters[selection.idx]
      placeAtSlot(slot, letter, 'carried', selection.idx)
    }
  }

  function placeAtSlot(slot, letter, source, srcIdx) {
    const next = selected.slice()
    next[slot] = { source, idx: srcIdx, letter }
    setSelected(next)
    setSelection(null)
  }

  function handleBlankPick(letter) {
    if (!pendingBlank) return
    const { slot, srcIdx } = pendingBlank
    setPendingBlank(null)
    if (!letter) return
    placeAtSlot(slot, letter, 'rack', srcIdx)
  }

  function handleShuffle() {
    // Shuffling the rack is purely visual — allow even when waiting for opponent.
    setRackOrder(shuffleOrder(order, [...usedRackIdxs]))
  }

  async function doSubmit() {
    if (!playable) return
    if (hasGap) { setStatus({ text: 'Fill the empty slot(s) before submitting.', tone: 'bad' }); return }
    if (currentWord.length < MIN_WORD_LEN) {
      setStatus({ text: `Too short. Minimum ${MIN_WORD_LEN} letters.`, tone: 'bad' })
      return
    }
    if (nextRungNumber > 1 && carriedUsed < CARRY_REQUIRED) {
      setStatus({ text: `Use at least ${CARRY_REQUIRED} carried letters (you used ${carriedUsed}).`, tone: 'bad' })
      return
    }
    const sources = selected.filter(Boolean).map(e => e.source === 'carried' ? 0 : (e.idx + 1))
    setSubmitting(true)
    setStatus({ text: 'Submitting…', tone: 'ok' })
    try {
      const score = await submitRung(gameId, currentWord, sources)
      setStatus({ text: `✓ ${currentWord} +${score}`, tone: 'ok' })
      clearWord()
    } catch (e) {
      setStatus({ text: e.message ?? String(e), tone: 'bad' })
    } finally {
      setSubmitting(false)
    }
  }

  async function doSkip() {
    if (!playable) return
    setSubmitting(true)
    setStatus({ text: 'Skipping…', tone: 'ok' })
    try {
      await skipTurn(gameId)
      setStatus({ text: 'Turn skipped.', tone: 'ok' })
      clearWord()
    } catch (e) {
      setStatus({ text: e.message ?? String(e), tone: 'bad' })
    } finally {
      setSubmitting(false)
    }
  }

  function doClaim() {
    if (submitting || !canClaim) return
    if (!window.confirm('Claim the win? Your opponent has been inactive for 7+ days.')) return
    setSubmitting(true)
    setStatus({ text: 'Claiming…', tone: 'ok' })
    claimInactiveWin(gameId)
      .then(() => setStatus({ text: '🏆 Game claimed.', tone: 'ok' }))
      .catch(e => setStatus({ text: e.message ?? String(e), tone: 'bad' }))
      .finally(() => setSubmitting(false))
  }

  // Give up now lives in the cog menu (c153 revision); a menu row can't do the
  // two-tap arm pattern cleanly, so confirm with a dialog instead.
  function doGiveUp() {
    if (!game || game.status !== 'active' || submitting) return
    if (!window.confirm('Forfeit this game? You’ll take a loss.')) return
    setSubmitting(true)
    giveUpMatch(gameId)
      .catch(e => setStatus({ text: e.message ?? String(e), tone: 'bad' }))
      .finally(() => setSubmitting(false))
  }

  // Game-specific cog rows (Claim win / Forfeit), injected into the shared
  // settings dropdown via SQSettingsRow so they're identical across SQ games
  // (c201). Claim is ALWAYS shown (so it's consistently discoverable) and
  // greyed out unless actually claimable — opponent's turn, idle 7+ days.
  const isComplete = game?.status === 'complete'
  const cogGameRows = (game && game.status === 'active' && !isComplete)
    ? (close) => (
        <>
          <SQSettingsRow
            label="🏆 Claim win (opponent inactive)"
            disabled={!canClaim || submitting}
            title={canClaim
              ? 'Claim the win — opponent inactive 7+ days'
              : 'Available once your opponent has been inactive for 7 days'}
            onClick={() => { close(); doClaim() }}
          />
          <SQSettingsRow
            label="🏳️ Forfeit game"
            danger
            onClick={() => { close(); doGiveUp() }}
          />
        </>
      )
    : null

  // ── render ──────────────────────────────────────────────────
  // Helper: shell wrapper for transient states (loading / error / waiting)
  // so they get the same chrome as the active game view.
  const renderShell = (content) => (
    <SQBoardShell
      width="narrow"
      header={<RunglesHeader profile={profile} onOpenStats={onOpenStats} />}
      subHeader={<SQBoardHeader backLabel="← Lobby" onBackClick={onLeave} />}
    >
      {content}
    </SQBoardShell>
  )

  if (loading || autoJoining) {
    return renderShell(
      <p className="text-center text-rungles-700 dark:text-rungles-200">
        {autoJoining ? 'Joining match…' : 'Loading match…'}
      </p>
    )
  }
  if (loadError) {
    return renderShell(
      <div className="card text-rose-700">Couldn't load match: {loadError}</div>
    )
  }

  if (game?.status === 'waiting') {
    return renderShell(
      <div className="card text-center space-y-2">
        <h2 className="font-display text-xl text-rungles-700 dark:text-rungles-200">
          Waiting room
        </h2>
        <p className="text-sm text-rungles-700 dark:text-rungles-300">
          Waiting for opponent…
        </p>
        <p className="text-xs text-rungles-500 dark:text-rungles-400">
          Players: {players.map(p => p.username).join(', ') || '—'}
        </p>
      </div>
    )
  }

  const lastRung = rungs.length > 0 ? rungs[rungs.length - 1] : null
  const lastPrev = lastRung
    ? (lastRung.rung_number === 1 ? (game?.seed_word ?? '') : rungs[rungs.length - 2]?.word ?? '')
    : null
  const lastWho = lastRung
    ? (lastRung.player_user_id === myUserId ? 'You' : (opponent?.username ?? 'Opponent'))
    : null

  return (
    <SQBoardShell
      width="narrow"
      header={<RunglesHeader profile={profile} onOpenStats={onOpenStats} gameRows={cogGameRows} />}
      subHeader={
        <SQBoardHeader
          backLabel="← Lobby"
          onBackClick={onLeave}
          rightSlot={
            <span className="font-display text-sm text-rungles-700 dark:text-rungles-200">
              Rung {Math.min(nextRungNumber, totalRungs)} / {totalRungs}
            </span>
          }
        />
      }
    >
      <section className="card !p-3 space-y-1 mb-2">
        <div className="flex items-center justify-between">
          <span className="font-display text-sm text-rungles-700">
            You: {me?.score ?? 0}
          </span>
          <span className="font-display text-sm text-rungles-700">
            {opponent?.username ?? 'Opponent'}: {opponent?.score ?? 0}
          </span>
        </div>
        <div className="text-center text-sm">
          {isComplete ? (
            <span className="font-bold text-rungles-700">
              {game.forfeit_user_id
                ? (game.forfeit_user_id === myUserId
                    ? `🏳️ You gave up — ${opponent?.username ?? 'Opponent'} wins`
                    : `🏳️ ${opponent?.username ?? 'Opponent'} gave up — you win!`)
                : (game.winner_player_idx === me?.playerIdx ? '🎉 You won!' : `${opponent?.username ?? 'Opponent'} won.`)}
            </span>
          ) : myTurn ? (
            <span className="font-bold text-green-700 dark:text-green-300">Your turn</span>
          ) : (
            <span className="text-rungles-500">Waiting for {opponent?.username ?? 'opponent'}…</span>
          )}
        </div>
        {/* Claim win + Give up now live in the cog menu (c153 revision). */}
      </section>

      {status.text && (
        <div
          role="status"
          className={`text-sm font-semibold rounded-lg px-3 py-2 mb-2 ${
            status.tone === 'ok'
              ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-200'
              : 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200'
          }`}
        >
          {status.text}
        </div>
      )}

      {/* Last played word + seed live above the play area. */}
      {(lastRung || game?.seed_word) && (
        <section className="card !p-3 mb-2" aria-label="Previous rung">
          {lastRung && (
            <MultiLadderRow
              rung={lastRung}
              prevWord={lastPrev}
              label={`Rung ${lastRung.rung_number} (${lastWho})`}
              onClick={rungs.length > 1 ? () => setHistoryOpen(true) : undefined}
            />
          )}
          {game?.seed_word && <SeedRow word={game.seed_word} />}
        </section>
      )}

      {!isComplete && (
        <section className="card !p-3 space-y-2 mb-2" aria-label="Current rung">
          <div className="text-xs text-rungles-500">
            {premiumPos ? `2× slot: position ${premiumPos}` : '2× slot: —'}
          </div>
          <BoardSlots
            selected={selected}
            premiumPos={premiumPos}
            onSlotTap={handleSlotTap}
            tileDisabled={!playable}
          />

          <div className="flex items-center justify-end text-xs">
            <span className={`font-display text-rungles-700 ${previewPts != null ? 'opacity-100' : 'opacity-0'}`}>
              {previewPts != null ? `+${previewPts} pts` : ''}
            </span>
          </div>

          <CarriedTiles
            letters={carriedLetters}
            usedIdxs={usedCarriedIdxs}
            isSelected={(idx) => selectionMatches('carried', idx)}
            onTileTap={(idx) => handleSourceTap('carried', idx)}
            tileDisabled={!playable}
            emptyMessage="Carried: — (no source available)"
            label={fromSeed ? `Carried from seed (need ${CARRY_REQUIRED}):` : `Carried (need ${CARRY_REQUIRED}):`}
          />
        </section>
      )}

      {!isComplete && (
        <section className="card !p-3 mb-2" aria-label="Your tile rack">
          <div className="grid grid-cols-7 gap-1 max-w-[304px] mx-auto">
            {order.map(serverIdx => {
              const letter = rack[serverIdx]
              const inWord = usedRackIdxs.has(serverIdx)
              return (
                <Tile
                  key={serverIdx}
                  letter={letter}
                  ghost={inWord}
                  selected={selectionMatches('rack', serverIdx)}
                  onClick={() => !inWord && handleSourceTap('rack', serverIdx)}
                />
              )
            })}
          </div>
        </section>
      )}

      {/* Spacer pushes action bar to bottom. */}
      <div className="flex-1" />

      {!isComplete && (
        <section className="action-bar-sticky space-y-2">
          <div className="grid grid-cols-4 gap-2">
            <ActionButton emoji="✅" label="Submit" onClick={doSubmit} variant="primary" disabled={!playable || filled === 0} />
            <ActionButton emoji="↩️" label="Clear" onClick={clearWord} variant="secondary" disabled={!playable || (filled === 0 && !selection)} />
            <ActionButton emoji="🔀" label="Shuffle" onClick={handleShuffle} variant="secondary" />
            <ActionButton emoji="⏩" label="Skip" onClick={doSkip} variant="secondary" disabled={!playable} />
          </div>
          {/* Give Up moved to the cog menu (c153 revision). */}
        </section>
      )}

      {isComplete && (
        <button
          type="button"
          className="btn-primary w-full"
          onClick={() => setEndgameOpen(true)}
        >
          🏁 Show final score
        </button>
      )}

      <BlankPickerModal
        open={!!pendingBlank}
        onPick={handleBlankPick}
        onCancel={() => handleBlankPick(null)}
      />
      <MultiHistoryModal
        open={historyOpen}
        rungs={rungs}
        seedWord={game?.seed_word}
        myUserId={myUserId}
        opponentName={opponent?.username ?? 'Opponent'}
        onClose={() => setHistoryOpen(false)}
      />
      <MultiEndGameModal
        open={endgameOpen}
        rungs={rungs}
        seedWord={game?.seed_word}
        me={me}
        opponent={opponent}
        winnerPlayerIdx={game?.winner_player_idx}
        forfeitUserId={game?.forfeit_user_id}
        closedByAdmin={!!game?.closed_by_admin}
        onBackToLobby={() => { setEndgameOpen(false); onLeave() }}
        onClose={() => setEndgameOpen(false)}
      />
    </SQBoardShell>
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
