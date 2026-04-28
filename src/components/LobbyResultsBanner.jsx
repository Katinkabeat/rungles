import React from 'react'

// Persistent banner of finished games this user hasn't dismissed yet.
// "View Game" button (right of subtext, left of ✕) opens the final board.
// ✕ button → dismiss (server + localStorage). No auto-dismiss on view.
export default function LobbyResultsBanner({ results, onView, onDismiss }) {
  if (!results || results.length === 0) return null

  return (
    <div className="space-y-2">
      {results.map(r => {
        const headline = r.isForfeit
          ? (r.gaveUp ? '🏳️ You gave up' : `🏳️ ${r.opponentName} gave up`)
          : (r.isWinner ? '🏆 You won!' : `🏆 ${r.winnerName} won`)
        const subtext = `You ${r.myScore} · ${r.opponentName} ${r.opponentScore}`
        return (
          <div
            key={r.gameId}
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 bg-gradient-to-r from-rungles-100 to-rose-50 border border-rungles-200 dark:from-rungles-900/40 dark:to-purple-900/30 dark:border-rungles-700"
          >
            <div className="flex-1 min-w-0">
              <div className="font-display text-sm text-rungles-700 dark:text-rungles-100 truncate">
                {headline}
              </div>
              <div className="text-xs text-rungles-500 dark:text-rungles-300 truncate">
                {subtext}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onView(r.gameId)}
              className="shrink-0 text-xs font-bold text-rungles-700 dark:text-rungles-200 underline hover:no-underline"
            >
              View Game
            </button>
            <button
              type="button"
              onClick={() => onDismiss(r.gameId)}
              aria-label="Dismiss result"
              className="shrink-0 w-7 h-7 rounded-full text-rungles-500 hover:text-rungles-700 hover:bg-white/60 dark:text-rungles-300 dark:hover:bg-black/20 flex items-center justify-center text-sm"
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
