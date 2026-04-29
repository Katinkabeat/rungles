import React from 'react'
import { highlightCarried } from '../lib/matchService.js'

// Ladder row for multi: server rungs don't store per-letter sources, so we
// pool-match against the previous word to highlight carried letters.
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
      className={`flex items-center gap-2 py-1.5 px-1 ${tappable ? 'cursor-pointer hover:bg-rungles-50 dark:hover:bg-rungles-900/30 rounded-md' : ''}`}
    >
      <span className="text-xs text-rungles-500 min-w-[5.5rem]">{label}</span>
      <span className="font-bold tracking-wider flex-1 text-sm">
        {letters.map((ch, i) => {
          const isCarried = carriedFlags[i]
          const isPremium = !isCarried && rung.premium_pos && (i + 1) === rung.premium_pos
          let cls = 'ladder-letter'
          if (isCarried) cls = 'ladder-letter ladder-letter-carried'
          else if (isPremium) cls = 'ladder-letter ladder-letter-premium'
          return <span key={i} className={cls}>{ch}</span>
        })}
      </span>
      <span className="text-rungles-700 font-semibold text-sm">
        +{rung.rung_score}
      </span>
    </div>
  )
}

// Seed row sitting at the bottom of the ladder.
export function SeedRow({ word }) {
  return (
    <div className="flex items-center gap-2 py-1.5 px-1 opacity-70">
      <span className="text-xs text-rungles-500 min-w-[5.5rem]">Seed</span>
      <span className="font-bold tracking-wider flex-1 text-sm">
        {(word || '').toUpperCase().split('').map((ch, i) => (
          <span key={i} className="ladder-letter">{ch}</span>
        ))}
      </span>
      <span className="text-rungles-500 text-sm">—</span>
    </div>
  )
}
