import React, { useEffect, useState, useCallback } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase.js'

// Minimal admin panel — Close Games view only. Admin management
// (granting/revoking permissions) lives in Wordy's panel; Rungles
// shares the same `admins` table.
export default function AdminPanel() {
  const [games, setGames]         = useState([])
  const [closingId, setClosingId] = useState(null)
  const [loading, setLoading]     = useState(true)

  const loadGames = useCallback(async () => {
    const { data, error } = await supabase.rpc('rg_admin_list_open_games')
    if (error) {
      console.error('rg_admin_list_open_games failed:', error)
      toast.error(`Couldn't load games: ${error.message}`)
    }
    setGames(data ?? [])
  }, [])

  useEffect(() => {
    setLoading(true)
    loadGames().finally(() => setLoading(false))
  }, [loadGames])

  async function closeGame(gameId) {
    setClosingId(gameId)
    try {
      const { error } = await supabase.rpc('rg_admin_close_game', { p_game_id: gameId })
      if (error) throw error
      toast.success('Game closed.')
      setGames(prev => prev.filter(g => g.id !== gameId))
    } catch (err) {
      toast.error(err.message)
    } finally {
      setClosingId(null)
    }
  }

  if (loading) {
    return (
      <section className="card">
        <p className="text-rungles-500 text-sm">Loading admin panel…</p>
      </section>
    )
  }

  return (
    <section className="card">
      <h2 className="font-display text-xl text-rungles-700 dark:text-rungles-200 mb-1">
        🔒 Close Games
      </h2>
      <p className="text-sm text-rungles-600 dark:text-rungles-300 mb-3">
        Close old or stuck games. They'll stop appearing in the lobby and no
        winner will be attributed.
      </p>
      {games.length === 0 ? (
        <p className="text-sm text-rungles-500 italic">No open games to close.</p>
      ) : (
        <ul className="space-y-2">
          {games.map(g => (
            <li
              key={g.id}
              className="flex items-center gap-2 rounded-xl px-3 py-2.5 bg-white border border-rungles-100 dark:bg-[#1f1240] dark:border-[#2d1b55]"
            >
              <div className="flex-1 min-w-0">
                <div className="font-display text-sm text-rungles-700 dark:text-rungles-100 truncate">
                  {(g.player_names ?? []).join(' · ') || '(no players)'}
                </div>
                <div className="text-xs text-rungles-500 dark:text-rungles-300">
                  {g.status} · {new Date(g.created_at).toLocaleDateString()}
                </div>
              </div>
              <button
                type="button"
                onClick={() => closeGame(g.id)}
                disabled={closingId === g.id}
                className="shrink-0 text-xs font-bold text-rose-600 dark:text-rose-300 hover:underline disabled:opacity-50"
              >
                {closingId === g.id ? '…' : '✕ Close'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
