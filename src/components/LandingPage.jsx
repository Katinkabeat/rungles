import React, { lazy, Suspense, useEffect, useState } from 'react'
import LobbyList from './LobbyList.jsx'
import CompletedGamesSection from './CompletedGamesSection.jsx'
import CreateGameSheet from './CreateGameSheet.jsx'
import { atlanticYMD } from '../lib/rng.js'
import { fetchTodayDaily } from '../lib/statsService.js'

// Lazy-loaded so non-admins never download the admin panel code.
const AdminPanel = lazy(() => import('./AdminPanel.jsx'))

export default function LandingPage({ profile, user, myUserId, isAdmin, lobbyTab, onPlaySolo, onEnterGame }) {
  const [showSheet, setShowSheet] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  const [playedToday, setPlayedToday] = useState(false)

  // Solo is a daily — reflect whether today's ladder is already done.
  useEffect(() => {
    if (!myUserId) return
    let alive = true
    fetchTodayDaily(myUserId, atlanticYMD())
      .then(row => { if (alive) setPlayedToday(!!row) })
      .catch(() => {})
    return () => { alive = false }
  }, [myUserId])

  if (lobbyTab === 'admin' && isAdmin) {
    return (
      <Suspense fallback={<p className="text-sm text-rungles-500">Loading admin panel…</p>}>
        <AdminPanel />
      </Suspense>
    )
  }

  return (
    <>
      <section className="card relative">
        {playedToday && (
          <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rungles-200 text-rungles-700 text-xs font-bold">
            ✓ Played today
          </span>
        )}
        <h2 className="font-display text-xl text-rungles-700 dark:text-rungles-200 mb-1">
          🎯 Today's Rungles
        </h2>
        <p className="text-sm text-rungles-700 dark:text-rungles-300 mb-3">
          Climb today's 7-rung ladder — one play a day, same board for everyone.
        </p>
        <button type="button" className="btn-primary" onClick={onPlaySolo}>
          {playedToday ? '↗ View today\'s result' : '▶ Play today'}
        </button>
      </section>

      <section className="card">
        <h2 className="font-display text-xl text-rungles-700 dark:text-rungles-200 mb-1">
          🪜 Two-Player Match
        </h2>
        <p className="text-sm text-rungles-700 dark:text-rungles-300 mb-3">
          Create a game or jump into an open one.
        </p>
        <button
          type="button"
          className="btn-primary mb-4"
          onClick={() => setShowSheet(true)}
        >
          ✨ Create game
        </button>
        <LobbyList
          key={reloadTick}
          myUserId={myUserId}
          myUsername={profile?.username}
          onEnterGame={onEnterGame}
        />
      </section>

      <CompletedGamesSection
        myUserId={myUserId}
        onEnterGame={onEnterGame}
      />

      {showSheet && (
        <CreateGameSheet
          user={user ?? { id: myUserId }}
          onClose={() => setShowSheet(false)}
          onCreated={() => {
            setShowSheet(false)
            setReloadTick(t => t + 1)
          }}
        />
      )}
    </>
  )
}
