import React, { useEffect, useRef } from 'react'
import LadderRow from './LadderRow.jsx'

export default function HistoryModal({ open, ladder, onClose }) {
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
          {ladder.map((rung, i) => (
            <LadderRow key={i} rung={rung} label={`Rung ${i + 1}`} />
          ))}
        </div>
        <button type="button" className="btn-secondary w-full" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  )
}
