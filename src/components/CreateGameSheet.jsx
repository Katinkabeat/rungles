// ────────────────────────────────────────────────────────────
//  CreateGameSheet — pick how the match is posted.
//
//  Two modes inside one sheet:
//    🌍 Open       — match goes to everyone's lobby. Auto-cancels
//                     after 7 days if nobody joins.
//    👥 With a friend — only the picked friend can see/join. Auto-
//                     cancels after 3 days if they don't accept.
//
//  Friend list comes from the SQ hub's `friendships` table via
//  useFriends. Search input filters by username as you type.
// ────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useFriends } from '../hooks/useFriends.js'
import { createGame } from '../lib/lobbyService.js'

export default function CreateGameSheet({ user, onClose, onCreated }) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [mode, setMode] = useState('open')
  const [search, setSearch] = useState('')
  const [selectedFriendId, setSelectedFriendId] = useState(null)
  const { friends, loading: friendsLoading } = useFriends(user?.id)

  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const filteredFriends = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return friends
    return friends.filter(f => f.username?.toLowerCase().includes(q))
  }, [friends, search])

  const selectedFriend = friends.find(f => f.id === selectedFriendId) ?? null

  async function handlePostOpen() {
    if (submitting) return
    setSubmitting(true)
    try {
      const gameId = await createGame({ totalRungs: 10 })
      toast.success('Game posted — waiting for an opponent.')
      onCreated(gameId)
    } catch (err) {
      console.error('[createGame open] failed', err)
      toast.error(err.message || 'Failed to create game')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSendInvite() {
    if (submitting || !selectedFriendId) return
    setSubmitting(true)
    try {
      const gameId = await createGame({ totalRungs: 10, invitedUserId: selectedFriendId })
      toast.success(`Invite sent to ${selectedFriend.username}.`)
      onCreated(gameId)
    } catch (err) {
      console.error('[createGame invite] failed', err)
      toast.error(err.message || 'Failed to send invite')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className={`fixed inset-0 z-50 grid place-items-center p-4 bg-black/40 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0'}`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`relative card p-6 w-full max-w-sm transition-all duration-300 ease-out ${
          open ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
        }`}
        style={{ transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 grid place-items-center rounded-full bg-rungles-100 text-rungles-700 hover:bg-rungles-200 transition-colors"
          aria-label="Close"
        >
          ×
        </button>

        <h2 className="font-display text-xl text-rungles-800 dark:text-rungles-100 mb-1">
          Start a game
        </h2>
        <p className="text-xs text-rungles-500 mb-4">
          Pick how you want to play.
        </p>

        <div className="flex bg-rungles-100 rounded-full p-1 mb-4">
          <button
            type="button"
            onClick={() => setMode('open')}
            className={`flex-1 px-3 py-2 rounded-full text-sm font-display transition-all ${
              mode === 'open'
                ? 'bg-white text-rungles-800 shadow-sm'
                : 'text-rungles-600 hover:text-rungles-800'
            }`}
          >
            🌍 Open
          </button>
          <button
            type="button"
            onClick={() => setMode('friend')}
            className={`flex-1 px-3 py-2 rounded-full text-sm font-display transition-all ${
              mode === 'friend'
                ? 'bg-white text-rungles-800 shadow-sm'
                : 'text-rungles-600 hover:text-rungles-800'
            }`}
          >
            👥 With a friend
          </button>
        </div>

        {mode === 'open' && (
          <>
            <div className="text-xs text-rungles-700 dark:text-rungles-200 bg-rungles-50 dark:bg-[#1f1240] border border-dashed border-rungles-200 rounded-lg px-3 py-2 mb-4">
              Anyone in Rungles can join your match from their lobby. Auto-cancels after 7 days.
            </div>
            <button
              onClick={handlePostOpen}
              disabled={submitting}
              className="btn-primary w-full text-sm font-display disabled:opacity-60"
            >
              {submitting ? '⏳ Posting…' : '✨ Post open match'}
            </button>
          </>
        )}

        {mode === 'friend' && (
          <>
            <div className="text-xs text-rungles-700 dark:text-rungles-200 bg-rungles-50 dark:bg-[#1f1240] border border-dashed border-rungles-200 rounded-lg px-3 py-2 mb-3">
              Only the friend you pick can join. Auto-cancels after 24 hours if they don't accept.
            </div>

            {friendsLoading ? (
              <p className="text-xs text-rungles-500 italic text-center py-4">Loading friends…</p>
            ) : friends.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-sm text-rungles-600 mb-1">No friends yet.</p>
                <p className="text-xs text-rungles-500 italic">Add friends in the Side Quest hub settings.</p>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search friends by name…"
                  className="w-full px-3 py-2 rounded-lg border border-rungles-200 bg-rungles-50 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-rungles-400"
                />

                <div className="max-h-44 overflow-y-auto rounded-lg border border-rungles-100 mb-3">
                  {filteredFriends.length === 0 ? (
                    <p className="text-xs text-rungles-500 italic text-center py-3">No friends match.</p>
                  ) : (
                    filteredFriends.map(f => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setSelectedFriendId(prev => prev === f.id ? null : f.id)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 border-b border-rungles-100 last:border-b-0 transition-colors ${
                          selectedFriendId === f.id ? 'bg-rungles-100' : 'hover:bg-rungles-50'
                        }`}
                      >
                        <span
                          className="w-8 h-8 rounded-full grid place-items-center text-white font-display text-xs shrink-0"
                          style={{ background: `hsl(${f.avatar_hue ?? 280}, 70%, 55%)` }}
                        >
                          {(f.username ?? '?').slice(0, 2).toUpperCase()}
                        </span>
                        <span className="flex-1 text-left font-bold text-sm text-rungles-800 truncate">
                          {f.username ?? 'unknown'}
                        </span>
                        <span
                          className={`w-5 h-5 rounded-full border-2 grid place-items-center text-white text-[10px] shrink-0 ${
                            selectedFriendId === f.id
                              ? 'bg-rungles-600 border-rungles-600'
                              : 'border-rungles-300'
                          }`}
                        >
                          {selectedFriendId === f.id ? '✓' : ''}
                        </span>
                      </button>
                    ))
                  )}
                </div>

                <button
                  onClick={handleSendInvite}
                  disabled={submitting || !selectedFriendId}
                  className="btn-primary w-full text-sm font-display disabled:opacity-50"
                >
                  {submitting
                    ? '⏳ Sending…'
                    : selectedFriend
                      ? `📨 Send invite to ${selectedFriend.username}`
                      : '📨 Pick a friend first'}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
