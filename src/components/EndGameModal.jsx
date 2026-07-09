import React, { useEffect, useRef } from 'react'
import LadderRow from './LadderRow.jsx'

export default function EndGameModal({ open, ladder, totalScore, gaveUp, saveState, onRetrySave, onViewLeaderboard, onBackToLobby, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  const title = gaveUp
    ? (ladder.length === 0 ? 'Ladder abandoned' : 'Ladder ended early')
    : 'Ladder complete!'

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="dropdown-surface rounded-2xl p-0 max-w-[420px] w-[90vw] backdrop:bg-black/40"
    >
      <div className="p-5 max-h-[85vh] overflow-y-auto text-center">
        <h2 className="font-display text-2xl text-rungles-700 dark:text-rungles-200 mb-1">
          {title}
        </h2>
        <p className="text-sm text-rungles-600 dark:text-rungles-300 mb-1">Final score</p>
        <p className="font-display text-5xl text-rungles-700 dark:text-rungles-100 mb-4">
          {totalScore}
        </p>

        <div className="text-left divide-y divide-rungles-100 dark:divide-rungles-900 mb-4">
          {ladder.length === 0 ? (
            <p className="text-sm text-rungles-500 italic py-2">No rungs played.</p>
          ) : (
            ladder.map((rung, i) => (
              <LadderRow key={i} rung={rung} label={`Rung ${i + 1}`} />
            ))
          )}
        </div>

        <SaveStatus saveState={saveState} onRetrySave={onRetrySave} />

        <p className="text-xs text-rungles-500 mb-3">
          One play a day — come back tomorrow for a fresh ladder.
        </p>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary flex-1" onClick={onBackToLobby}>
            ← Lobby
          </button>
          <button type="button" className="btn-primary flex-1" onClick={onViewLeaderboard}>
            🏆 Leaderboard
          </button>
        </div>
      </div>
    </dialog>
  )
}

// Reflect the real save state of the daily result. A silent failure here both
// loses the score and reopens today's daily for replay, so on a hard failure
// we show a retry instead of pretending it saved.
function SaveStatus({ saveState, onRetrySave }) {
  if (saveState === 'error') {
    return (
      <div className="mb-3">
        <p className="text-sm font-semibold text-rose-600 dark:text-rose-300">
          Couldn't save your score.
        </p>
        <button type="button" className="btn-primary mt-2" onClick={onRetrySave}>
          Retry saving
        </button>
      </div>
    )
  }
  if (saveState === 'saving') {
    return <p className="text-xs text-rungles-500 mb-1">Saving your score…</p>
  }
  return null
}
