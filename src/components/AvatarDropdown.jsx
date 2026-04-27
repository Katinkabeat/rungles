import React, { useEffect, useRef } from 'react'

function initialsOf(name) {
  return (name || '?').slice(0, 2).toUpperCase()
}

// Floating panel anchored under the avatar button.
// Opening is controlled by parent; this renders nothing when !open.
export default function AvatarDropdown({ open, profile, onClose, onOpenStats }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  const hue = profile?.avatar_hue ?? 270
  const name = profile?.username ?? '…'
  const bg = `hsl(${hue}, 70%, 55%)`

  return (
    <div
      ref={ref}
      role="menu"
      className="dropdown-surface absolute left-2 top-12 z-20 min-w-[220px] rounded-2xl shadow-xl p-3"
    >
      <div className="flex items-center gap-3 mb-2 px-1">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center font-display text-lg text-white border-2 border-black/5"
          style={{ background: bg }}
        >
          {initialsOf(name)}
        </div>
        <div className="min-w-0">
          <div className="font-display text-base text-rungles-700 dark:text-rungles-100 truncate">
            {name}
          </div>
        </div>
      </div>
      <button
        type="button"
        role="menuitem"
        className="w-full text-left px-3 py-2 rounded-lg text-sm font-semibold text-rungles-700 dark:text-rungles-200 hover:bg-rungles-50 dark:hover:bg-rungles-900/40"
        onClick={() => { onClose(); onOpenStats() }}
      >
        📊 Stats
      </button>
    </div>
  )
}
