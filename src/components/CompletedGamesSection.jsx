import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import LobbyResultsBanner from './LobbyResultsBanner.jsx'
import {
  fetchUnseenResults, dismissResult, subscribeFinishes,
} from '../lib/lobbyService.js'
import { supabase } from '../lib/supabase.js'
import { SQCompletedGamesCard } from '../../../rae-side-quest/packages/sq-ui/index.js'

// Self-contained section that fetches the user's unseen finished games,
// renders them as dismissable banners, and shows a toast when a new game
// finishes. Owned by LandingPage so the layout can place it as its own
// section card below Multiplayer.
export default function CompletedGamesSection({ myUserId, onEnterGame }) {
  const [results, setResults] = useState([])

  const refreshResults = useCallback(async () => {
    try {
      const r = await fetchUnseenResults(myUserId)
      setResults(r)
      return r
    } catch (e) {
      console.error('fetchUnseenResults failed:', e)
      return []
    }
  }, [myUserId])

  useEffect(() => {
    let alive = true
    refreshResults()

    const finishChannel = subscribeFinishes(async (newGame) => {
      if (!alive) return
      // Wait briefly so winner_player_idx and forfeit_user_id are settled,
      // then refresh. The freshly-fetched results tell us authoritatively
      // whether this user was in that game (otherwise it won't appear).
      setTimeout(async () => {
        if (!alive) return
        const after = await refreshResults()
        if (!after.find(r => r.gameId === newGame.id)) return

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
      }, 1000)
    })

    return () => {
      alive = false
      supabase.removeChannel(finishChannel)
    }
  }, [myUserId, refreshResults, onEnterGame])

  async function handleDismiss(gameId) {
    setResults(prev => prev.filter(r => r.gameId !== gameId))
    try {
      await dismissResult(myUserId, gameId)
    } catch (e) {
      toast.error(`Couldn't dismiss: ${e.message ?? e}`)
      refreshResults()
    }
  }

  return (
    <SQCompletedGamesCard>
      {results.length > 0 ? (
        <LobbyResultsBanner
          results={results}
          onView={onEnterGame}
          onDismiss={handleDismiss}
        />
      ) : null}
    </SQCompletedGamesCard>
  )
}
