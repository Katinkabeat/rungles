import React from 'react'
import Tile from './Tile.jsx'
import { highlightCarried } from '../lib/matchService.js'

// Ladder row for multi: server rungs don't store per-letter sources, so we
// pool-match against the previous word to highlight carried letters.
// Tiles match the play area + rack size so rows line up centered.
export default function MultiLadderRow({ rung, prevWord, label, onClick }) {
  const letters = (rung.word || '').toUpperCase().split('')
  const carriedFlags = highlightCarried(rung.word, prevWord)
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
          +{rung.rung_score}
        </span>
      </div>
      <div className="flex gap-1">
        {letters.map((ch, i) => {
          const isCarried = carriedFlags[i]
          const isPremium = !isCarried && rung.premium_pos && (i + 1) === rung.premium_pos
          return (
            <Tile
              key={i}
              letter={ch}
              variant="in-word"
              carried={isCarried}
              premium={isPremium}
            />
          )
        })}
      </div>
    </div>
  )
}

// Seed row sitting at the bottom of the ladder. Tiles match the rest of
// the ladder for visual consistency.
export function SeedRow({ word }) {
  const letters = (word || '').toUpperCase().split('')
  return (
    <div className="py-1.5 px-1 opacity-70">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-rungles-500">Seed</span>
        <span className="text-rungles-500 text-sm">—</span>
      </div>
      <div className="flex gap-1">
        {letters.map((ch, i) => (
          <Tile key={i} letter={ch} variant="in-word" />
        ))}
      </div>
    </div>
  )
}
