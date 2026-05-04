import React, { lazy, Suspense, useState } from 'react'
import LobbyList from './LobbyList.jsx'
import CompletedGamesSection from './CompletedGamesSection.jsx'
import CreateGameSheet from './CreateGameSheet.jsx'

// Lazy-loaded so non-admins never download the admin panel code.
const AdminPanel = lazy(() => import('./AdminPanel.jsx'))

export default function LandingPage({ profile, user, myUserId, isAdmin, lobbyTab, onPlaySolo, onEnterGame }) {
  const [showSheet, setShowSheet] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)

  if (lobbyTab === 'admin' && isAdmin) {
    return (
      <Suspense fallback={<p className="text-sm text-rungles-500">Loading admin panel…</p>}>
        <AdminPanel />
      </Suspense>
    )
  }

  return (
    <>
      <section className="card">
        <h2 className="font-display text-xl text-rungles-700 dark:text-rungles-200 mb-1">
          🎯 Solo
        </h2>
        <p className="text-sm text-rungles-700 dark:text-rungles-300 mb-3">
          Climb a 7-rung ladder on your own.
        </p>
        <button type="button" className="btn-primary" onClick={onPlaySolo}>
          ▶ Play Solo
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
