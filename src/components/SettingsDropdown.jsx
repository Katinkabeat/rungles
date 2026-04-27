import React, { useEffect, useRef, useState } from 'react'
import { useTheme } from '../contexts/ThemeContext.jsx'
import { useGameActions } from '../contexts/GameActionsContext.jsx'
import { supabase } from '../lib/supabase.js'
import RulesModal from './RulesModal.jsx'

export default function SettingsDropdown({ open, onClose }) {
  const ref = useRef(null)
  const { isDark, toggle } = useTheme()
  const { hintAction } = useGameActions()
  const [rulesOpen, setRulesOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  async function handleLogout() {
    onClose()
    await supabase.auth.signOut()
    const ret = window.location.pathname + window.location.search
    window.location.replace(`${window.location.origin}/games/?return=${encodeURIComponent(ret)}`)
  }

  function handleHint() {
    onClose()
    hintAction?.()
  }

  return (
    <>
      {open && (
        <div
          ref={ref}
          role="menu"
          className="dropdown-surface absolute right-2 top-12 z-20 min-w-[220px] rounded-2xl shadow-xl p-2"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => { onClose(); setRulesOpen(true) }}
            className="w-full text-left px-3 py-2 rounded-lg text-sm font-semibold text-rungles-700 hover:bg-rungles-50 dark:hover:bg-rungles-900/40"
          >
            📖 How to play
          </button>
          {hintAction && (
            <button
              type="button"
              role="menuitem"
              onClick={handleHint}
              className="w-full text-left px-3 py-2 rounded-lg text-sm font-semibold text-rungles-700 hover:bg-rungles-50 dark:hover:bg-rungles-900/40"
            >
              💡 Get a hint <span className="text-rungles-500">(−5)</span>
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => { toggle() }}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-semibold text-rungles-700 hover:bg-rungles-50 dark:hover:bg-rungles-900/40"
          >
            <span>{isDark ? '🌙 Dark' : '☀️ Light'}</span>
            <span className="text-xs text-rungles-500">tap to switch</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            className="w-full text-left px-3 py-2 rounded-lg text-sm font-semibold text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/30"
          >
            🚪 Log out
          </button>
        </div>
      )}

      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </>
  )
}
