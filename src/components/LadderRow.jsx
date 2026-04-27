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
      <span className="text-xs text-rungles-500 dark:text-rungles-400 min-w-[3.5rem]">{label}</span>
      <span className="font-bold tracking-wider flex-1 text-sm">
        {letters.map((ch, i) => {
          const fromCarried = rung.sources && rung.sources[i] === 'carried'
          const isPremium  = rung.premiumPos && (i + 1) === rung.premiumPos
          let cls = 'inline-block text-rungles-700 dark:text-rungles-200 font-extrabold'
          if (fromCarried) cls = 'inline-block text-neutral-500 dark:text-neutral-400 font-extrabold'
          else if (isPremium) cls = 'inline-block text-amber-600 dark:text-amber-400 font-extrabold'
          return <span key={i} className={cls}>{ch}</span>
        })}
      </span>
      <span className="text-rungles-700 dark:text-rungles-300 font-semibold text-sm">
        +{rung.rungScore}
      </span>
    </div>
  )
}
