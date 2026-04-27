import React, { useEffect, useRef } from 'react'
import { useTheme } from '../contexts/ThemeContext.jsx'
import { supabase } from '../lib/supabase.js'

export default function SettingsDropdown({ open, onClose }) {
  const ref = useRef(null)
  const { isDark, toggle } = useTheme()

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
    // App.jsx will detect the cleared session and bounce to the SQ hub login.
    const ret = window.location.pathname + window.location.search
    window.location.replace(`${window.location.origin}/games/?return=${encodeURIComponent(ret)}`)
  }

  if (!open) return null

  return (
    <div
      ref={ref}
      role="menu"
      className="dropdown-surface absolute right-2 top-12 z-20 min-w-[200px] rounded-2xl shadow-xl p-2"
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => { toggle() }}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-semibold text-rungles-700 dark:text-rungles-200 hover:bg-rungles-50 dark:hover:bg-rungles-900/40"
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
  )
}
