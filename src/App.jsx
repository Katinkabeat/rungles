import React, { useEffect, useState } from 'react'
import { Toaster } from 'react-hot-toast'
import { ThemeProvider } from './contexts/ThemeContext.jsx'
import RunglesHeader from './components/RunglesHeader.jsx'
import { supabase } from './lib/supabase.js'
import { loadDictionary, dictionarySize } from './lib/dictionary.js'

function redirectToSqLogin() {
  const ret = window.location.pathname + window.location.search
  const url = `${window.location.origin}/games/?return=${encodeURIComponent(ret)}`
  window.location.replace(url)
}

function AppInner() {
  const [boot, setBoot] = useState('checking')   // 'checking' | 'ready'
  const [profile, setProfile] = useState(null)
  const [dictReady, setDictReady] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await supabase.auth.getSession()
      if (!alive) return
      if (!data.session) {
        // Dev escape hatch: standalone Vite has no hub to redirect to.
        // Render with a stub profile so we can verify UI in isolation.
        // Production (and the hub-fronted dev:all flow) still gates strictly.
        if (import.meta.env.DEV) {
          setProfile({ username: 'dev-user', avatar_hue: 270 })
          setBoot('ready')
          return
        }
        redirectToSqLogin()
        return
      }
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
    loadDictionary().then(() => alive && setDictReady(true)).catch(() => {})
    return () => { alive = false }
  }, [])

  if (boot === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-rungles-50 text-rungles-700 font-body">
        <p>Loading…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-rungles-50 via-pink-50 to-rungles-100 dark:bg-[#0f0a1e] dark:bg-none text-rungles-900 dark:text-rungles-100 font-body">
      <RunglesHeader
        profile={profile}
        onAvatarClick={() => { /* Phase 3e */ }}
        onSettingsClick={() => { /* Phase 3e */ }}
      />
      <main className="max-w-[480px] mx-auto px-4 py-6 space-y-4">
        <section className="bg-white rounded-xl p-4 shadow-tile dark:bg-[#241640] dark:border dark:border-[#6d28d9]">
          <h2 className="font-display text-xl text-rungles-700 dark:text-rungles-200 mb-2">
            Phase 3a — Header ✓
          </h2>
          <p className="text-sm text-rungles-700 dark:text-rungles-300">
            Signed in as <span className="font-semibold">{profile?.username}</span>.
            Dictionary: {dictReady ? `${dictionarySize().toLocaleString()} words ready` : 'loading…'}.
          </p>
          <p className="text-xs text-rungles-500 dark:text-rungles-400 mt-2">
            Landing, solo, multi, and dropdowns land in Phases 3b–3e.
          </p>
        </section>
      </main>
      <Toaster position="top-center" />
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  )
}
