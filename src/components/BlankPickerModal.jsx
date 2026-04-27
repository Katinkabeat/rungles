import React, { useEffect, useRef } from 'react'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

export default function BlankPickerModal({ open, onPick, onCancel }) {
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
      onClose={onCancel}
      onClick={(e) => { if (e.target === ref.current) onCancel() }}
      className="dropdown-surface rounded-2xl p-0 max-w-[360px] backdrop:bg-black/40"
    >
      <div className="p-5">
        <h2 className="font-display text-lg text-rungles-700 dark:text-rungles-200 mb-1">
          Blank tile — pick a letter
        </h2>
        <p className="text-xs text-rungles-600 dark:text-rungles-300 mb-3">
          Once chosen, this tile is locked as that letter for the rest of the game.
        </p>
        <div className="grid grid-cols-6 gap-1.5 mb-3">
          {LETTERS.map(l => (
            <button
              key={l}
              type="button"
              onClick={() => onPick(l)}
              className="py-2 rounded-lg font-display text-sm border border-rungles-200 dark:border-rungles-700 bg-white dark:bg-[#1a1130] text-rungles-700 dark:text-rungles-200 hover:bg-rungles-50 dark:hover:bg-rungles-900/40 active:translate-y-px"
            >
              {l}
            </button>
          ))}
        </div>
        <button type="button" className="btn-secondary w-full" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </dialog>
  )
}
