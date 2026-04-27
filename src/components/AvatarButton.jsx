import React from 'react'

function initialsOf(name) {
  return (name || '?').slice(0, 2).toUpperCase()
}

// Phase 3a: visual avatar button only. The dropdown content lands in Phase 3e.
export default function AvatarButton({ profile, onClick }) {
  const hue = profile?.avatar_hue ?? 270
  const name = profile?.username ?? '…'
  const bg = `hsl(${hue}, 70%, 55%)`
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Profile and stats"
      className="w-8 h-8 rounded-full border-2 border-black/5 text-white font-display text-xs flex items-center justify-center leading-none hover:brightness-110 focus-visible:outline-none focus-visible:brightness-110"
      style={{ background: bg }}
    >
      {initialsOf(name)}
    </button>
  )
}
