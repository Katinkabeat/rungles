import React from 'react'
import { LETTER_VALUES } from '../lib/tiles.js'

// Reusable Rungles tile.
// variant: 'rack' (default), 'small' (carried), 'in-word'
// state flags: ghost, premium, selected, carried
// All theming lives in index.css under .tile / .dark .tile rules so dark-mode
// styling can be overridden centrally (parallels Wordy's tile system).
export default function Tile({
  letter,
  variant = 'rack',
  ghost = false,
  premium = false,
  selected = false,
  carried = false,
  onClick,
  ariaLabel,
  disabled = false,
}) {
  const value = LETTER_VALUES[letter] ?? 0
  const isBlank = letter === '_'

  // Sizes match Wordy's TileRack so 7 fit on a single line at 480px max-width.
  const sizeClass =
    variant === 'small'
      ? 'w-8 h-9 text-base'
      : variant === 'in-word'
      ? 'w-10 h-11 text-lg'
      : 'w-10 h-11 text-lg'

  const stateClasses = [
    sizeClass,
    'tile',
    premium && 'tile-premium',
    carried && !premium && 'tile-carried',
    ghost && 'tile-ghost',
    selected && 'tile-selected',
  ].filter(Boolean).join(' ')

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || ghost}
      aria-label={ariaLabel ?? (isBlank ? 'Blank tile' : `Tile ${letter}, ${value} points`)}
      className={`${stateClasses} shrink-0`}
    >
      <span className="font-display">{isBlank ? '' : letter}</span>
      {value > 0 && <span className="tile-value">{value}</span>}
    </button>
  )
}

// Empty word slot — visual sibling of .tile, with dashed border.
export function EmptySlot({ premium = false, onClick, ariaLabel }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`w-10 h-11 tile-empty shrink-0 ${premium ? 'tile-empty-premium' : ''}`}
    >
      {premium ? '2×' : ''}
    </button>
  )
}
