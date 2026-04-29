import React, { useEffect, useState } from 'react'
import { Toaster } from 'react-hot-toast'
import { ThemeProvider } from './contexts/ThemeContext.jsx'
import { GameActionsProvider } from './contexts/GameActionsContext.jsx'
import RunglesHeader from './components/RunglesHeader.jsx'
import LandingPage from './components/LandingPage.jsx'
import { SQLobbyShell } from '../../rae-side-quest/packages/sq-ui/index.js'
import SoloGamePage from './components/SoloGamePage.jsx'
import MultiGamePage from './components/MultiGamePage.jsx'
import StatsModal from './components/StatsModal.jsx'
import { supabase } from './lib/supabase.js'
import { loadDictionary } from './lib/dictionary.js'

function redirectToSqLogin() {
  const ret = window.location.pathname + window.location.search
  const url = `${window.location.origin}/games/?return=${encodeURIComponent(ret)}`
  window.location.replace(url)
}

function AppInner() {
  const [boot, setBoot] = useState('checking')   // 'checking' | 'ready'
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  // view: 'landing' | 'solo' | 'multi'
  const [view, setView] = useState('landing')
  const [currentGameId, setCurrentGameId] = useState(null)
  const [statsOpen, setStatsOpen] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await supabase.auth.getSession()
      if (!alive) return
      if (!data.session) {
        if (import.meta.env.DEV) {
          setSession({ user: { id: '00000000-0000-0000-0000-000000000000', email: 'dev@local' } })
          setProfile({ username: 'dev-user', avatar_hue: 270 })
          setBoot('ready')
          return
        }
        redirectToSqLogin()
        return
      }
      setSession(data.session)
      const userId = data.session.user.id
      const { data: prof } = await supabase
        .from('profiles')
        .select('username, avatar_hue')
        .eq('id', userId)
        .maybeSingle()
      if (!alive) return
      setProfile(prof ?? { username: data.session.user.email, avatar_hue: 270 })
      setBoot('ready')
    })()
    loadDictionary().catch(() => {})
    return () => { alive = false }
  }, [])

  // Deep-link: ?game=<id> jumps straight into multiplayer.
  useEffect(() => {
    if (boot !== 'ready') return
    const params = new URLSearchParams(window.location.search)
    const gameId = params.get('game')
    if (gameId) {
      window.history.replaceState({}, '', window.location.pathname + window.location.hash)
      setCurrentGameId(gameId)
      setView('multi')
    }
  }, [boot])

  if (boot === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-rungles-50 text-rungles-700 font-body">
        <p>Loading…</p>
      </div>
    )
  }

  return (
    <>
      {view === 'landing' ? (
        <SQLobbyShell
          header={<RunglesHeader profile={profile} onOpenStats={() => setStatsOpen(true)} />}
          className="text-rungles-900 dark:text-rungles-100 font-body"
        >
          <LandingPage
            profile={profile}
            myUserId={session?.user?.id}
            onPlaySolo={() => setView('solo')}
            onEnterGame={(gameId) => { setCurrentGameId(gameId); setView('multi') }}
          />
        </SQLobbyShell>
      ) : (
        <div className="min-h-screen bg-gradient-to-br from-rungles-50 via-pink-50 to-rungles-100 dark:bg-[#0f0a1e] dark:bg-none text-rungles-900 dark:text-rungles-100 font-body">
          <RunglesHeader
            profile={profile}
            onOpenStats={() => setStatsOpen(true)}
          />

          {view === 'solo' && (
            <SoloGamePage onBack={() => setView('landing')} />
          )}

          {view === 'multi' && currentGameId && (
            <MultiGamePage
              gameId={currentGameId}
              myUserId={session?.user?.id}
              onLeave={() => { setCurrentGameId(null); setView('landing') }}
            />
          )}
        </div>
      )}

      <StatsModal
        open={statsOpen}
        myUserId={session?.user?.id}
        onClose={() => setStatsOpen(false)}
      />

      <Toaster position="top-center" />
    </>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <GameActionsProvider>
        <AppInner />
      </GameActionsProvider>
    </ThemeProvider>
  )
}
