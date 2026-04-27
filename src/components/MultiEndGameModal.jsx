import React, { useEffect, useRef } from 'react'
import MultiLadderRow from './MultiLadderRow.jsx'

export default function MultiEndGameModal({
  open, rungs, seedWord, me, opponent, winnerPlayerIdx, onBackToLobby, onClose,
}) {
  const ref = useRef(null)

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  const youWon = winnerPlayerIdx != null && winnerPlayerIdx === me?.playerIdx
  const title = youWon ? '🎉 You won!' : `${opponent?.username ?? 'Opponent'} won.`

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
        <p className="font-display text-3xl text-rungles-700 dark:text-rungles-100 mb-4">
          {me?.score ?? 0} <span className="text-rungles-400 text-xl">vs</span> {opponent?.score ?? 0}
        </p>

        <div className="text-left divide-y divide-rungles-100 dark:divide-rungles-900 mb-4">
          {rungs.length === 0 ? (
            <p className="text-sm text-rungles-500 italic py-2">No rungs played.</p>
          ) : (
            rungs.map((rung, i) => {
              const prevWord = rung.rung_number === 1
                ? (seedWord ?? '')
                : (rungs[i - 1]?.word ?? '')
              const who = rung.player_user_id === me?.userId ? 'You' : (opponent?.username ?? 'Opponent')
              return (
                <MultiLadderRow
                  key={rung.id ?? i}
                  rung={rung}
                  prevWord={prevWord}
                  label={`Rung ${rung.rung_number} (${who})`}
                />
              )
            })
          )}
        </div>

        <div className="flex gap-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn-primary flex-1" onClick={onBackToLobby}>
            ← Back to lobby
          </button>
        </div>
      </div>
    </dialog>
  )
}
