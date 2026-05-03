import React from 'react'
import Tile from './Tile.jsx'

// Renders the row of carried letters available for the current rung. Solo
// passes letters as strings (extracted from `state.carried[i].letter`), Multi
// passes them as raw strings already. Caller normalizes both shapes to
// `letters: string[]` so this component stays simple.
//
// Width matches the 7-slot play area (7×40px + 6×4px gap = 304px) and is
// mx-auto centered, so the first carried tile sits directly under the first
// play-area slot.
export default function CarriedTiles({
  letters,
  usedIdxs,
  isSelected,
  onTileTap,
  tileDisabled = false,
  emptyMessage,
  label,
}) {
  if (letters.length === 0) {
    return <p className="text-xs text-rungles-500 italic">{emptyMessage}</p>
  }
  return (
    <div className="space-y-1 mx-auto" style={{ width: '304px' }}>
      <p className="text-xs text-rungles-600 dark:text-rungles-300">{label}</p>
      <div className="flex gap-1 flex-wrap">
        {letters.map((letter, idx) => {
          const used = usedIdxs.has(idx)
          return (
            <Tile
              key={idx}
              letter={letter}
              variant="in-word"
              carried
              ghost={used}
              selected={isSelected(idx)}
              onClick={() => !used && onTileTap(idx)}
              disabled={tileDisabled}
            />
          )
        })}
      </div>
    </div>
  )
}
