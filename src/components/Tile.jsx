import React from 'react'
import { LETTER_VALUES } from '../lib/tiles.js'

// Reusable Rungles tile.
// variant: 'rack' (default), 'small' (carried), 'in-word'
// state flags: ghost, premium, selected, carried (visually distinct from carried-in-word)
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

  const sizeClass =
    variant === 'small'
      ? 'w-8 h-9 text-base'
      : variant === 'in-word'
      ? 'w-10 h-11 text-lg'
      : 'w-11 h-12 text-xl'

  const baseBg = premium
    ? 'linear-gradient(135deg, #fbbf24, #d97706)'
    : carried
    ? 'linear-gradient(135deg, #e5e7eb, #cbd5e1)'
    : 'linear-gradient(135deg, #c084fc, #9333ea)'
  const textColor = carried && !premium ? '#374151' : '#fff'
  const valueColor = carried && !premium ? '#525252' : '#f3e8ff'

  const inlineStyle = {
    background: baseBg,
    border: '1.5px solid ' + (carried && !premium ? '#94a3b8' : '#7e22ce'),
    boxShadow: ghost
      ? 'none'
      : selected
      ? '0 0 0 3px #f472b6, 2px 3px 0px rgba(88,28,135,0.4)'
      : '2px 3px 0px rgba(88,28,135,0.4)',
    color: textColor,
    opacity: ghost ? 0.35 : 1,
    transform: selected ? 'translateY(-3px)' : undefined,
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || ghost}
      aria-label={ariaLabel ?? (isBlank ? 'Blank tile' : `Tile ${letter}, ${value} points`)}
      style={inlineStyle}
      className={`
        relative flex items-center justify-center rounded-lg font-display select-none
        transition-all duration-100
        ${sizeClass}
        ${ghost ? 'cursor-default' : 'cursor-pointer active:translate-y-0.5'}
      `}
    >
      <span>{isBlank ? '' : letter}</span>
      {value > 0 && (
        <span
          className="absolute font-bold leading-none"
          style={{ fontSize: 9, bottom: 2, right: 3, color: valueColor }}
        >
          {value}
        </span>
      )}
    </button>
  )
}

// Empty word slot — clickable when handler provided.
export function EmptySlot({ premium = false, onClick, ariaLabel }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`
        w-10 h-11 rounded-lg flex items-center justify-center
        text-xs font-bold transition-all duration-100
        border-2 border-dashed
        ${premium
          ? 'border-amber-400 text-amber-600 bg-amber-50 dark:bg-amber-900/20'
          : 'border-rungles-300 text-rungles-300 bg-white dark:bg-[#1a1130] dark:border-rungles-700'}
      `}
    >
      {premium ? '2×' : ''}
    </button>
  )
}
