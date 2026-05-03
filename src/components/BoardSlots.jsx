import React from 'react'
import Tile, { EmptySlot } from './Tile.jsx'

const MAX_WORD_LEN = 7

// Renders the 7-slot play area shared by Solo and Multi. Each slot is either
// a placed Tile (with premium-hit highlight when applicable) or an EmptySlot
// marking the bonus square. The flash-animation wrapper lives in the parent
// (Solo uses it for valid/invalid feedback; Multi doesn't), so callers wrap
// this with their own outer div.
export default function BoardSlots({
  selected,
  premiumPos,
  onSlotTap,
  tileDisabled = false,
  wrapperClassName = 'flex justify-center gap-1',
}) {
  return (
    <div className={wrapperClassName}>
      {Array.from({ length: MAX_WORD_LEN }, (_, slot) => {
        const entry = selected[slot]
        const isPremium = (slot + 1) === premiumPos
        if (entry) {
          const isPremiumHit = isPremium && entry.source === 'rack'
          return (
            <Tile
              key={slot}
              letter={entry.letter}
              variant="in-word"
              premium={isPremiumHit}
              carried={entry.source === 'carried'}
              onClick={() => onSlotTap(slot)}
              disabled={tileDisabled}
            />
          )
        }
        return (
          <EmptySlot
            key={slot}
            premium={isPremium}
            onClick={() => onSlotTap(slot)}
            ariaLabel={`Slot ${slot + 1}${isPremium ? ' (2× bonus)' : ''}`}
          />
        )
      })}
    </div>
  )
}
