import React, { useEffect, useRef } from 'react'
import MultiLadderRow, { SeedRow } from './MultiLadderRow.jsx'

export default function MultiHistoryModal({ open, rungs, seedWord, myUserId, opponentName, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose() }}
      className="dropdown-surface rounded-2xl p-0 max-w-[420px] w-[90vw] backdrop:bg-black/40"
    >
      <div className="p-5 max-h-[80vh] overflow-y-auto">
        <h2 className="font-display text-lg text-rungles-700 dark:text-rungles-200 mb-3">
          Ladder so far
        </h2>
        <div className="divide-y divide-rungles-100 dark:divide-rungles-900 mb-3">
          {rungs.map((rung, i) => {
            const prevWord = rung.rung_number === 1
              ? (seedWord ?? '')
              : (rungs[i - 1]?.word ?? '')
            const who = rung.player_user_id === myUserId ? 'You' : opponentName
            return (
              <MultiLadderRow
                key={rung.id ?? i}
                rung={rung}
                prevWord={prevWord}
                label={`Rung ${rung.rung_number} (${who})`}
              />
            )
          })}
          {seedWord && <SeedRow word={seedWord} />}
        </div>
        <button type="button" className="btn-secondary w-full" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  )
}
