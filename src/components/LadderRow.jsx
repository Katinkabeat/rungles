import React from 'react'
import Tile from './Tile.jsx'

// One row in the ladder display. `rung` is { word, rungScore, premiumPos, sources }.
// Tiles are rendered at the same size as the play area + rack so all three
// surfaces line up visually when centered. Label sits above the row.
export default function LadderRow({ rung, label, onClick }) {
  const letters = rung.word.toUpperCase().split('')
  const tappable = !!onClick
  return (
    <div
      role={tappable ? 'button' : undefined}
      tabIndex={tappable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (!tappable) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() }
      }}
      className={`py-1.5 px-1 ${tappable ? 'cursor-pointer hover:bg-rungles-50 dark:hover:bg-rungles-900/30 rounded-md' : ''}`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-rungles-500">{label}</span>
        <span className="text-rungles-700 dark:text-rungles-200 font-semibold text-sm">
          +{rung.rungScore}
        </span>
      </div>
      <div className="flex gap-1">
        {letters.map((ch, i) => {
          const fromCarried = rung.sources && rung.sources[i] === 'carried'
          const isPremium  = rung.premiumPos && (i + 1) === rung.premiumPos
          return (
            <Tile
              key={i}
              letter={ch}
              variant="in-word"
              carried={fromCarried}
              premium={!fromCarried && isPremium}
            />
          )
        })}
      </div>
    </div>
  )
}
