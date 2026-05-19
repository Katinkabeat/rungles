import React, { useEffect, useState } from 'react'
import { Toaster } from 'react-hot-toast'
import { ThemeProvider } from './contexts/ThemeContext.jsx'
import { GameActionsProvider } from './contexts/GameActionsContext.jsx'
import RunglesHeader from './components/RunglesHeader.jsx'
import LandingPage from './components/LandingPage.jsx'
import { SQLobbyShell } from '../../rae-side-quest/packages/sq-ui/index.js'
import SoloGamePage from './components/SoloGamePage.jsx'
import MultiGamePage from './components/MultiGamePage.jsx'
import StatsPage from './components/StatsPage.jsx'
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
  const [adminRecord, setAdminRecord] = useState(null) // null = not admin
  const [lobbyTab, setLobbyTab] = useState('lobby') // 'lobby' | 'admin'
  // view: 'landing' | 'solo' | 'multi' | 'stats'
  const [view, setView] = useState('landing')
  const [currentGameId, setCurrentGameId] = useState(null)
  const [statsReturnView, setStatsReturnView] = useState('landing')

  useEffect(() => {
    let alive = true
    let initialized = false

    // Wait for Supabase's auth subsystem to fire its first state event before
    // marking boot ready. On iOS Safari, getSession() can resolve before the
    // JWT is actually attached to outbound requests, causing the first RPC
    // call to fail with "TypeError: Load failed". onAuthStateChange's
    // INITIAL_SESSION event confirms auth is fully wired.
    const handleSession = async (sess) => {
      if (!alive || initialized) return
      initialized = true
      if (!sess) {
        if (import.meta.env.DEV) {
          setSession({ user: { id: '00000000-0000-0000-0000-000000000000', email: 'dev@local' } })
          setProfile({ username: 'dev-user', avatar_hue: 270 })
          setBoot('ready')
          return
        }
        redirectToSqLogin()
        return
      }
      setSession(sess)
      const { data: prof } = await supabase
        .from('profiles')
        .select('username, avatar_hue')
        .eq('id', sess.user.id)
        .maybeSingle()
      if (!alive) return
      setProfile(prof ?? { username: sess.user.email, avatar_hue: 270 })
      // Load admin record (lives in shared `admins` table). Non-admins
      // get null and never see the admin panel toggle.
      const { data: adminRow } = await supabase
        .from('admins')
        .select('user_id, permissions, is_master')
        .eq('user_id', sess.user.id)
        .maybeSingle()
      if (!alive) return
      setAdminRecord(adminRow ?? null)
      setBoot('ready')
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      handleSession(sess)
    })

    loadDictionary().catch(() => {})
    return () => { alive = false; sub?.subscription?.unsubscribe() }
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

  // Open the full-page Stats view. Remember where we came from so the
  // "← Back to lobby" button can return to it (e.g. mid-multiplayer).
  const openStats = () => { setStatsReturnView(view); setView('stats') }
  const closeStats = () => setView(statsReturnView)

  return (
    <>
      {view === 'landing' && (
        <SQLobbyShell
          header={
            <RunglesHeader
              profile={profile}
              onOpenStats={openStats}
              isAdmin={!!adminRecord}
              lobbyTab={lobbyTab}
              onToggleAdmin={() => setLobbyTab(t => t === 'admin' ? 'lobby' : 'admin')}
            />
          }
          className="text-rungles-900 dark:text-rungles-100 font-body"
        >
          <LandingPage
            profile={profile}
            user={session?.user}
            myUserId={session?.user?.id}
            isAdmin={!!adminRecord}
            lobbyTab={lobbyTab}
            onPlaySolo={() => setView('solo')}
            onEnterGame={(gameId) => { setCurrentGameId(gameId); setView('multi') }}
          />
        </SQLobbyShell>
      )}

      {view === 'solo' && (
        <SoloGamePage
          profile={profile}
          onOpenStats={openStats}
          onBack={() => setView('landing')}
        />
      )}

      {view === 'multi' && currentGameId && (
        <MultiGamePage
          gameId={currentGameId}
          myUserId={session?.user?.id}
          profile={profile}
          onOpenStats={openStats}
          onLeave={() => { setCurrentGameId(null); setView('landing') }}
        />
      )}

      {view === 'stats' && (
        <StatsPage
          session={session}
          profile={profile}
          isAdmin={!!adminRecord}
          onBack={closeStats}
        />
      )}

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
