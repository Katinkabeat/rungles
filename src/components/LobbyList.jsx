import React, { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import LobbyRow from './LobbyRow.jsx'
import {
  fetchLobby, subscribeLobby, joinGame, sendNudge, canNudgeGame, cancelGame, declineInvite,
} from '../lib/lobbyService.js'
import { supabase } from '../lib/supabase.js'

// Active multiplayer games (waiting + active-where-I'm-a-player). Open
// joinable games come first so users see "things to join" before their
// own active games. Finished games live in CompletedGamesSection.
//
// Invited games are split out:
//   - "Invited to you" sits at the top (most prominent)
//   - "Invited by you" rows render with a 📨 subtext + ✕ cancel button
export default function LobbyList({ myUserId, myUsername, onEnterGame }) {
  const [games, setGames] = useState([])
  const [usernameById, setUsernameById] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [cancellingId, setCancellingId] = useState(null)
  const [decliningId, setDecliningId] = useState(null)
  const recentlyNudgedRef = useRef(new Set())
  const [, forceTick] = useState(0)

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

  useEffect(() => {
    let alive = true
    refresh()
    const channel = subscribeLobby(myUserId, () => { if (alive) refresh() })
    return () => { alive = false; supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUserId])

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

  async function handleCancel(gameId) {
    if (cancellingId) return
    if (!confirm('Cancel this game?')) return
    setCancellingId(gameId)
    try {
      await cancelGame(gameId)
      toast.success('Game cancelled.')
    } catch (e) {
      toast.error(`Couldn't cancel: ${e.message ?? e}`)
    } finally {
      setCancellingId(null)
      refresh()
    }
  }

  async function handleDecline(gameId) {
    if (decliningId) return
    if (!confirm('Decline this invite?')) return
    setDecliningId(gameId)
    try {
      await declineInvite(gameId)
      toast.success('Invite declined.')
    } catch (e) {
      toast.error(`Couldn't decline: ${e.message ?? e}`)
    } finally {
      setDecliningId(null)
      refresh()
    }
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

  // Bucket games so invitations sort to the top.
  const buckets = useMemo(() => {
    const invitedToYou = []
    const others = []
    for (const g of games) {
      if (g.status === 'waiting' && g.invited_user_id === myUserId && g.created_by !== myUserId) {
        invitedToYou.push(g)
      } else {
        others.push(g)
      }
    }
    return { invitedToYou, others }
  }, [games, myUserId])

  if (loading) {
    return <p className="text-sm text-rungles-500 dark:text-rungles-400">Loading lobby…</p>
  }
  if (error) {
    return <p className="text-sm text-rose-600">Couldn't load games: {error}</p>
  }
  if (games.length === 0) {
    return (
      <div className="text-center py-8 text-rungles-300">
        <div className="text-4xl mb-2">🟣</div>
        <p className="font-display">No open games yet — create one!</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {buckets.invitedToYou.map(g => (
        <LobbyRow
          key={g.id}
          game={g}
          myUserId={myUserId}
          usernameById={usernameById}
          canNudge={false}
          onNudge={handleNudge}
          onJoin={handleJoin}
          onResume={handleResume}
          onDecline={() => handleDecline(g.id)}
          declineDisabled={decliningId === g.id}
          isInviteToMe
        />
      ))}
      {buckets.others.map(g => (
        <LobbyRow
          key={g.id}
          game={g}
          myUserId={myUserId}
          usernameById={usernameById}
          canNudge={canNudgeGame(g, myUserId, recentlyNudgedRef.current)}
          onNudge={handleNudge}
          onJoin={handleJoin}
          onResume={handleResume}
          onCancel={
            g.status === 'waiting' && g.created_by === myUserId
              ? () => handleCancel(g.id)
              : undefined
          }
          cancelDisabled={cancellingId === g.id}
        />
      ))}
    </div>
  )
}
