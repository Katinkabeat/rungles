import React from 'react'

// One row in the ladder display. `rung` is { word, rungScore, premiumPos, sources }.
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
      className={`flex items-center gap-2 py-1.5 px-1 ${tappable ? 'cursor-pointer hover:bg-rungles-50 dark:hover:bg-rungles-900/30 rounded-md' : ''}`}
    >
      <span className="text-xs text-rungles-500 min-w-[3.5rem]">{label}</span>
      <span className="font-bold tracking-wider flex-1 text-sm">
        {letters.map((ch, i) => {
          const fromCarried = rung.sources && rung.sources[i] === 'carried'
          const isPremium  = rung.premiumPos && (i + 1) === rung.premiumPos
          let cls = 'ladder-letter'
          if (fromCarried) cls = 'ladder-letter ladder-letter-carried'
          else if (isPremium) cls = 'ladder-letter ladder-letter-premium'
          return <span key={i} className={cls}>{ch}</span>
        })}
      </span>
      <span className="text-rungles-700 font-semibold text-sm">
        +{rung.rungScore}
      </span>
    </div>
  )
}
