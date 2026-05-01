import React, { lazy, Suspense, useState } from 'react'
import toast from 'react-hot-toast'
import LobbyList from './LobbyList.jsx'
import CompletedGamesSection from './CompletedGamesSection.jsx'
import { createGame } from '../lib/lobbyService.js'

// Lazy-loaded so non-admins never download the admin panel code.
const AdminPanel = lazy(() => import('./AdminPanel.jsx'))

export default function LandingPage({ profile, myUserId, isAdmin, lobbyTab, onPlaySolo, onEnterGame }) {
  const [creating, setCreating] = useState(false)

  if (lobbyTab === 'admin' && isAdmin) {
    return (
      <Suspense fallback={<p className="text-sm text-rungles-500">Loading admin panel…</p>}>
        <AdminPanel />
      </Suspense>
    )
  }

  async function handleCreate() {
    setCreating(true)
    try {
      await createGame({ totalRungs: 10 })
      toast.success('Game created — waiting for an opponent')
    } catch (e) {
      toast.error(`Couldn't create game: ${e.message ?? e}`)
    } finally {
      setCreating(false)
    }
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
          🪜 Multiplayer
        </h2>
        <p className="text-sm text-rungles-700 dark:text-rungles-300 mb-3">
          Create a game or jump into an open one.
        </p>
        <button
          type="button"
          className="btn-primary mb-4"
          onClick={handleCreate}
          disabled={creating}
        >
          {creating ? '⏳ Creating…' : '✨ Create game'}
        </button>
        <LobbyList
          myUserId={myUserId}
          myUsername={profile?.username}
          onEnterGame={onEnterGame}
        />
      </section>

      <CompletedGamesSection
        myUserId={myUserId}
        onEnterGame={onEnterGame}
      />
    </>
  )
}
