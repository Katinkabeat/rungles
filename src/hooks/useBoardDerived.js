import { useMemo } from 'react'

const MAX_WORD_LEN = 7

// Pure derivations from a `selected` array (entries are { source, idx, letter }
// or null). Used by both Solo and Multi to avoid two slightly-different
// implementations of the same computations drifting out of sync.
export function useBoardDerived(selected) {
  return useMemo(() => {
    let filled = 0
    let lastFilledSlot = -1
    let currentWord = ''
    const usedRackIdxs = new Set()
    const usedCarriedIdxs = new Set()

    for (let i = 0; i < selected.length; i++) {
      const entry = selected[i]
      if (!entry) continue
      filled++
      lastFilledSlot = i
      currentWord += entry.letter
      if (entry.source === 'rack') usedRackIdxs.add(entry.idx)
      else if (entry.source === 'carried') usedCarriedIdxs.add(entry.idx)
    }

    const hasGap = lastFilledSlot >= 0 && lastFilledSlot + 1 !== filled

    return { filled, lastFilledSlot, hasGap, currentWord, usedRackIdxs, usedCarriedIdxs }
  }, [selected])
}

export { MAX_WORD_LEN }
