import React, { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Tile, { EmptySlot } from './Tile.jsx'
import BlankPickerModal from './BlankPickerModal.jsx'
import MultiLadderRow, { SeedRow } from './MultiLadderRow.jsx'
import MultiHistoryModal from './MultiHistoryModal.jsx'
import MultiEndGameModal from './MultiEndGameModal.jsx'
import {
  loadMatch, fetchPremium, refreshRack,
  submitRung, skipTurn, giveUpMatch,
  subscribeMatch, subscribeGameStatus, unsubscribe,
} from '../lib/matchService.js'
import { scoreRung } from '../lib/scoring.js'
import RunglesHeader from './RunglesHeader.jsx'
import { SQBoardShell, SQBoardHeader } from '../../../rae-side-quest/packages/sq-ui/index.js'

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
  const [giveUpArmed, setGiveUpArmed] = useState(false)
  const giveUpTimer = useRef(null)
  const wasComplete = useRef(false) // track status transitions

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
        setRackOrder(null)
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

  const carriedLetters = (() => {
    if (rungs.length === 0) return (game?.seed_word ?? '').split('')
    return rungs[rungs.length - 1].word.split('')
  })()
  const fromSeed = rungs.length === 0

  const filled = selected.filter(Boolean).length
  const carriedUsed = selected.filter(e => e && e.source === 'carried').length
  const currentWord = selected.filter(Boolean).map(e => e.letter).join('')
  const previewPts = filled > 0 ? scoreRung(selected, premiumPos) : null

  const lastFilledSlot = (() => {
    for (let i = MAX_WORD_LEN - 1; i >= 0; i--) if (selected[i]) return i
    return -1
  })()
  const hasGap = lastFilledSlot >= 0 && lastFilledSlot + 1 !== filled

  const order = (() => {
    if (Array.isArray(rackOrder) && rackOrder.length === rack.length) return rackOrder
    return rack.map((_, i) => i)
  })()

  const usedRackIdxs = new Set(selected.filter(e => e && e.source === 'rack').map(e => e.idx))
  const usedCarriedIdxs = new Set(selected.filter(e => e && e.source === 'carried').map(e => e.idx))

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
    if (!playable) return
    if (!selection) { setSelection({ source, idx }); return }
    if (selectionMatches(source, idx)) { setSelection(null); return }
    if (selection.source === 'rack' && source === 'rack') {
      reorderRackVisual(selection.idx, idx)
      setSelection(null)
      return
    }
    setSelection({ source, idx })
  }

  function reorderRackVisual(fromServerIdx, toServerIdx) {
    const cur = order.slice()
    const from = cur.indexOf(fromServerIdx)
    const to = cur.indexOf(toServerIdx)
    if (from === -1 || to === -1 || from === to) return
    const [moved] = cur.splice(from, 1)
    const insertAt = from < to ? to - 1 : to
    cur.splice(insertAt, 0, moved)
    setRackOrder(cur)
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
    if (!playable) return
    const cur = order.slice()
    const selectedSet = new Set([...usedRackIdxs])
    const freePositions = cur.map((_, p) => p).filter(p => !selectedSet.has(cur[p]))
    const freeValues = freePositions.map(p => cur[p])
    for (let i = freeValues.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[freeValues[i], freeValues[j]] = [freeValues[j], freeValues[i]]
    }
    freePositions.forEach((p, k) => { cur[p] = freeValues[k] })
    setRackOrder(cur)
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

  function doGiveUp() {
    if (!game || game.status !== 'active' || submitting) return
    if (!giveUpArmed) {
      setGiveUpArmed(true)
      giveUpTimer.current = setTimeout(() => setGiveUpArmed(false), 2500)
      return
    }
    clearTimeout(giveUpTimer.current)
    setGiveUpArmed(false)
    setSubmitting(true)
    giveUpMatch(gameId)
      .catch(e => setStatus({ text: e.message ?? String(e), tone: 'bad' }))
      .finally(() => setSubmitting(false))
  }

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

  if (loading) {
    return renderShell(
      <p className="text-center text-rungles-700 dark:text-rungles-200">Loading match…</p>
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
  const isComplete = game?.status === 'complete'

  return (
    <SQBoardShell
      width="narrow"
      header={<RunglesHeader profile={profile} onOpenStats={onOpenStats} />}
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
          <div className="flex justify-center gap-1">
            {Array.from({ length: MAX_WORD_LEN }, (_, slot) => {
              const entry = selected[slot]
              const isPremium = (slot + 1) === premiumPos
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
                    disabled={!playable}
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
            <span className={`font-display text-rungles-700 ${previewPts != null ? 'opacity-100' : 'opacity-0'}`}>
              {previewPts != null ? `+${previewPts} pts` : ''}
            </span>
          </div>

          {carriedLetters.length === 0 ? (
            <p className="text-xs text-rungles-500 italic">Carried: — (no source available)</p>
          ) : (
            /* Width matches the 7-slot play area above (7×40px + 6×4px gap)
               and is mx-auto centered, so the first carried tile sits
               directly under the first play-area slot. */
            <div className="space-y-1 mx-auto" style={{ width: '304px' }}>
              <p className="text-xs text-rungles-600 dark:text-rungles-300">
                {fromSeed ? `Carried from seed (need ${CARRY_REQUIRED}):` : `Carried (need ${CARRY_REQUIRED}):`}
              </p>
              <div className="flex gap-1 flex-wrap">
                {carriedLetters.map((letter, idx) => {
                  const used = usedCarriedIdxs.has(idx)
                  return (
                    <Tile
                      key={idx}
                      letter={letter}
                      variant="in-word"
                      carried
                      ghost={used}
                      selected={selectionMatches('carried', idx)}
                      onClick={() => !used && handleSourceTap('carried', idx)}
                      disabled={!playable}
                    />
                  )
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {!isComplete && (
        <section className="card !p-3 mb-2" aria-label="Your tile rack">
          <div className="flex items-center justify-center gap-1 flex-nowrap">
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
                  disabled={!playable}
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
            <ActionButton emoji="🔀" label="Shuffle" onClick={handleShuffle} variant="secondary" disabled={!playable} />
            <ActionButton emoji="⏩" label="Skip" onClick={doSkip} variant="secondary" disabled={!playable} />
          </div>
          <ActionButton
            emoji="🏳️"
            label={giveUpArmed ? 'Tap again to confirm' : 'Give Up'}
            onClick={doGiveUp}
            variant="danger"
            disabled={submitting}
            fullWidth
          />
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
