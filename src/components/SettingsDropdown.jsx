import { useEffect, useRef, useState } from 'react'
import { useTheme } from '../contexts/ThemeContext.jsx'
import { useGameActions } from '../contexts/GameActionsContext.jsx'
import { supabase } from '../lib/supabase.js'
import { SQReportPlayer, SQSettingsRow } from '../../../rae-side-quest/packages/sq-ui/index.js'
import RulesModal from './RulesModal.jsx'

// `gameRows` — optional render-prop `(close) => ReactNode` for game-specific
// rows (Claim win / Give up on the board). Called with a function that closes
// the menu, so injected rows can dismiss it after acting.
export default function SettingsDropdown({ open, onClose, isAdmin, lobbyTab, onToggleAdmin, gameRows = null }) {
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
        <div ref={ref} role="menu" className="settings-dropdown card">
          {/* Canonical SQ order: Theme → How to play → Admin → game rows → Report → Log out */}
          <SQSettingsRow
            label="Theme"
            control={isDark ? '☀️ Light' : '🌙 Dark'}
            onClick={() => toggle()}
          />
          <SQSettingsRow
            label="How to play"
            control="📖 Open"
            onClick={() => { onClose(); setRulesOpen(true) }}
          />
          {isAdmin && onToggleAdmin && (
            <SQSettingsRow
              label="Admin panel"
              control={lobbyTab === 'admin' ? '← Lobby' : 'Open'}
              onClick={() => { onClose(); onToggleAdmin() }}
            />
          )}
          {hintAction && (
            <SQSettingsRow
              label="Get a hint"
              control="(−5)"
              onClick={handleHint}
            />
          )}
          {gameRows && gameRows(onClose)}
          <SQReportPlayer supabase={supabase} game="rungles" />
          <SQSettingsRow label="Log out" danger onClick={handleLogout} />
        </div>
      )}

      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </>
  )
}
