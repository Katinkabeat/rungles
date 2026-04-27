import React, { useEffect, useRef } from 'react'
import LadderRow from './LadderRow.jsx'

export default function EndGameModal({ open, ladder, totalScore, gaveUp, onPlayAgain, onClose }) {
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

        <div className="flex gap-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn-primary flex-1" onClick={onPlayAgain}>
            ▶ Play Again
          </button>
        </div>
      </div>
    </dialog>
  )
}
