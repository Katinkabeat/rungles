import React, { Fragment } from 'react'
import { timeAgo } from '../lib/timeAgo.js'

export default function LobbyRow({
  game,
  myUserId,
  usernameById,
  canNudge,
  onNudge,
  onJoin,
  onResume,
}) {
  const players = (game.rg_players ?? []).slice().sort((a, b) => a.player_idx - b.player_idx)
  const isMine = players.some(p => p.user_id === myUserId)
  const isActive = game.status === 'active'

  const sinceIso = game.turn_started_at ?? game.created_at
  const subText = isActive
    ? `${game.total_rungs} rungs · ${timeAgo(sinceIso)}`
    : `${game.total_rungs} rungs · ⏳ Waiting for players`

  const totalChips = players.length // chip count (no count-pill counted)
  const wrapAfter = totalChips === 4 ? 2 : null // sq-conventions: 4-player → 2-per-line

  return (
    <div className="flex items-center justify-between gap-3 bg-white dark:bg-[#1f1240] rounded-xl border border-rungles-100 dark:border-[#2d1b55] px-3 py-2.5">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          {players.map((p, i) => {
            const isCurrent = isActive && p.player_idx === game.current_player_idx
            const showBell = isCurrent && canNudge
            const chip = (
              <span
                key={p.user_id}
                className={`lobby-chip ${isCurrent ? 'lobby-chip-current' : ''}`}
              >
                {showBell && (
                  <button
                    type="button"
                    className="lobby-nudge"
                    title="Send a reminder"
                    onClick={(e) => { e.stopPropagation(); onNudge(game.id) }}
                  >
                    🔔
                  </button>
                )}
                <span className="lobby-chip-name">{usernameById[p.user_id] ?? '?'}</span>
              </span>
            )
            // Force a row break after chip 2 for 4-player rows so chips wrap 2/line.
            if (wrapAfter && i === wrapAfter - 1) {
              return (
                <Fragment key={p.user_id + '-wrap'}>
                  {chip}
                  <span className="basis-full h-0" />
                </Fragment>
              )
            }
            return chip
          })}
          <span className="lobby-chip-count">({players.length}/{game.max_players})</span>
        </div>
        <p className="text-xs text-rungles-500 dark:text-rungles-400 mt-1">{subText}</p>
      </div>
      <button
        type="button"
        className="btn-primary text-sm shrink-0"
        onClick={() => isMine ? onResume(game.id) : onJoin(game.id)}
      >
        {isMine ? 'Resume' : 'Join'}
      </button>
    </div>
  )
}
