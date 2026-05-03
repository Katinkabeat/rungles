import React from 'react'

// Banner list of the user's last 10 finished games.
// "View Game" button opens the final board.
export default function LobbyResultsBanner({ results, onView }) {
  if (!results || results.length === 0) return null

  return (
    <div className="space-y-2">
      {results.map(r => {
        const headline = r.isAdminClosed
          ? '🛑 Game closed by admin'
          : r.isForfeit
            ? (r.gaveUp ? '🏳️ You gave up' : `🏳️ ${r.opponentName} gave up`)
            : r.winnerUserId
              ? (r.isWinner ? '🏆 You won!' : `🏆 ${r.winnerName} won`)
              : "🤝 It's a tie!"
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
          </div>
        )
      })}
    </div>
  )
}
