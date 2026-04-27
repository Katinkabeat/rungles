import React, { createContext, useContext, useState, useCallback } from 'react'

// Lets in-game pages (SoloGamePage) register actions that should appear in
// the global Settings dropdown — currently just the Hint button. Pages call
// `setHintAction(fn)` on mount and `setHintAction(null)` on unmount.
const GameActionsContext = createContext({
  hintAction: null,
  setHintAction: () => {},
})

export function GameActionsProvider({ children }) {
  const [hintAction, setHintActionState] = useState(null)
  // Wrap in useCallback so the setter identity is stable across renders.
  const setHintAction = useCallback(fn => setHintActionState(() => fn), [])
  return (
    <GameActionsContext.Provider value={{ hintAction, setHintAction }}>
      {children}
    </GameActionsContext.Provider>
  )
}

export const useGameActions = () => useContext(GameActionsContext)
