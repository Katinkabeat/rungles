// Shared rack-order utilities. Used by both Solo and Multi to keep a visual
// permutation of rack server-indices without mutating the underlying rack.
// Solo's state.rack stays in deal/refill order; Multi's stays anchored to
// server identity. Both render via state.rackOrder[i] -> rack[serverIdx].

export function identityOrder(length) {
  return Array.from({ length }, (_, i) => i)
}

// Swap the visual positions of two server indices in `order`.
// Pure: returns a new array (or the same one if no-op).
export function swapInOrder(order, fromServerIdx, toServerIdx) {
  if (fromServerIdx === toServerIdx) return order
  const cur = order.slice()
  const from = cur.indexOf(fromServerIdx)
  const to = cur.indexOf(toServerIdx)
  if (from === -1 || to === -1) return order
  ;[cur[from], cur[to]] = [cur[to], cur[from]]
  return cur
}

// Shuffle the positions of any server indices NOT in lockedServerIdxs.
// Used for the Shuffle button — keeps tiles already placed in the word
// visually anchored, randomizes the rest.
export function shuffleOrder(order, lockedServerIdxs) {
  const cur = order.slice()
  const lockedSet = new Set(lockedServerIdxs)
  const freePositions = cur.map((_, p) => p).filter(p => !lockedSet.has(cur[p]))
  const freeValues = freePositions.map(p => cur[p])
  for (let i = freeValues.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[freeValues[i], freeValues[j]] = [freeValues[j], freeValues[i]]
  }
  freePositions.forEach((p, k) => { cur[p] = freeValues[k] })
  return cur
}

// Validate that a saved rackOrder still matches the current rack length and
// is a valid permutation of [0..length-1]. If not, return identity.
export function normalizeOrder(order, length) {
  if (!Array.isArray(order) || order.length !== length) return identityOrder(length)
  const seen = new Set()
  for (const v of order) {
    if (typeof v !== 'number' || v < 0 || v >= length || seen.has(v)) {
      return identityOrder(length)
    }
    seen.add(v)
  }
  return order
}
