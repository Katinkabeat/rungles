import React, { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import LobbyRow from './LobbyRow.jsx'
import LobbyResultsBanner from './LobbyResultsBanner.jsx'
import {
  fetchLobby, subscribeLobby, joinGame, sendNudge, canNudgeGame,
  fetchUnseenResults, dismissResult, subscribeFinishes,
} from '../lib/lobbyService.js'
import { supabase } from '../lib/supabase.js'

export default function LobbyList({ myUserId, myUsername, onEnterGame }) {
  const [games, setGames] = useState([])
  const [usernameById, setUsernameById] = useState({})
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const recentlyNudgedRef = useRef(new Set())
  const [, forceTick] = useState(0)

  // Track which games I'm a player in, so the global finish-subscription can
  // ignore other people's games (we don't get player rows in the payload).
  const myGameIdsRef = useRef(new Set())
  useEffect(() => {
    myGameIdsRef.current = new Set(
      games.filter(g => (g.rg_players ?? []).some(p => p.user_id === myUserId)).map(g => g.id)
    )
  }, [games, myUserId])

  async function refresh() {
    try {
      const { games, usernameById } = await fetchLobby(myUserId)
      setGames(games)
      setUsernameById(usernameById)
      setLoading(false)
      setError(null)
    } catch (e) {
      setError(e.message ?? String(e))
      setLoading(false)
    }
  }

  const refreshResults = useCallback(async () => {
    try {
      const r = await fetchUnseenResults(myUserId)
      setResults(r)
    } catch (e) {
      console.error('fetchUnseenResults failed:', e)
    }
  }, [myUserId])

  useEffect(() => {
    let alive = true
    refresh()
    refreshResults()
    const channel = subscribeLobby(() => { if (alive) refresh() })
    const finishChannel = subscribeFinishes(async (newGame) => {
      if (!alive) return
      if (!myGameIdsRef.current.has(newGame.id)) return

      // Show toast immediately; refresh banner list after a short delay so
      // winner_player_idx is settled in the DB.
      const headline = newGame.forfeit_user_id
        ? (newGame.forfeit_user_id === myUserId ? '🏳️ You gave up' : '🏳️ Opponent gave up')
        : '🏆 Game over'
      toast(
        (t) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontWeight: 'bold' }}>{headline}</span>
            <button
              onClick={() => { onEnterGame(newGame.id); toast.dismiss(t.id) }}
              style={{ fontSize: 12, textDecoration: 'underline', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              View final board →
            </button>
          </div>
        ),
        { duration: 15000 }
      )
      setTimeout(() => { if (alive) refreshResults() }, 1000)
    })
    return () => {
      alive = false
      supabase.removeChannel(channel)
      supabase.removeChannel(finishChannel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUserId])

  async function handleDismissResult(gameId) {
    setResults(prev => prev.filter(r => r.gameId !== gameId))
    try {
      await dismissResult(myUserId, gameId)
    } catch (e) {
      toast.error(`Couldn't dismiss: ${e.message ?? e}`)
      refreshResults()
    }
  }

  async function handleJoin(gameId) {
    try {
      await joinGame(gameId)
      onEnterGame(gameId)
    } catch (e) {
      toast.error(`Couldn't join: ${e.message ?? e}`)
      refresh()
    }
  }

  function handleResume(gameId) {
    onEnterGame(gameId)
  }

  async function handleNudge(gameId) {
    if (recentlyNudgedRef.current.has(gameId)) return
    recentlyNudgedRef.current.add(gameId)
    forceTick(n => n + 1)
    try {
      await sendNudge(gameId, myUsername)
      toast.success('Reminder sent')
    } catch (e) {
      recentlyNudgedRef.current.delete(gameId)
      forceTick(n => n + 1)
      toast.error(`Couldn't send reminder: ${e.message ?? e}`)
    }
    refresh()
  }

  if (loading) {
    return <p className="text-sm text-rungles-500 dark:text-rungles-400">Loading lobby…</p>
  }
  if (error) {
    return <p className="text-sm text-rose-600">Couldn't load games: {error}</p>
  }

  return (
    <div>
      <LobbyResultsBanner
        results={results}
        onView={onEnterGame}
        onDismiss={handleDismissResult}
      />
      {games.length === 0 ? (
        <div className="text-center py-8 text-rungles-300">
          <div className="text-4xl mb-2">🟣</div>
          <p className="font-display">No open games yet — create one!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {games.map(g => (
            <LobbyRow
              key={g.id}
              game={g}
              myUserId={myUserId}
              usernameById={usernameById}
              canNudge={canNudgeGame(g, myUserId, recentlyNudgedRef.current)}
              onNudge={handleNudge}
              onJoin={handleJoin}
              onResume={handleResume}
            />
          ))}
        </div>
      )}
    </div>
  )
}
