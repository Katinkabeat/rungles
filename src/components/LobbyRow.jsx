import React, { Fragment } from 'react'
import { timeAgo } from '../../../rae-side-quest/packages/sq-ui/index.js'

export default function LobbyRow({
  game,
  myUserId,
  usernameById,
  canNudge,
  onNudge,
  onJoin,
  onResume,
  onCancel,
  cancelDisabled,
  onDecline,
  declineDisabled,
  isInviteToMe,
}) {
  const players = (game.rg_players ?? []).slice().sort((a, b) => a.player_idx - b.player_idx)
  const isMine = players.some(p => p.user_id === myUserId)
  const isActive = game.status === 'active'
  const isInviteByMe =
    game.status === 'waiting' &&
    game.invited_user_id != null &&
    game.created_by === myUserId

  const sinceIso = game.turn_started_at ?? game.created_at
  let subText
  if (isInviteToMe) {
    const inviter = usernameById[game.created_by] ?? '?'
    subText = `📨 ${inviter} invited you · ${game.total_rungs} rungs`
  } else if (isInviteByMe) {
    const invitee = usernameById[game.invited_user_id] ?? 'friend'
    subText = `📨 Invited ${invitee} · ${game.total_rungs} rungs`
  } else if (isActive) {
    subText = `${game.total_rungs} rungs · ${timeAgo(sinceIso)}`
  } else {
    subText = `${game.total_rungs} rungs · ⏳ Waiting for players`
  }

  // For invite-to-me rows the players array only has the creator (1
  // chip), so we synthesize a "you" placeholder chip on the right.
  const totalChips = players.length + (isInviteToMe ? 1 : 0)
  const wrapAfter = totalChips === 4 ? 2 : null

  const actionLabel = isInviteToMe ? 'Accept' : (isMine ? 'Resume' : 'Join')
  const actionHandler = () => isInviteToMe || !isMine ? onJoin(game.id) : onResume(game.id)

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 bg-white dark:bg-[#1f1240] border-rungles-100 dark:border-[#2d1b55]">
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
          {isInviteToMe && (
            <span className="lobby-chip lobby-chip-current">
              <span className="lobby-chip-name">You</span>
            </span>
          )}
          <span className="lobby-chip-count">({players.length + (isInviteToMe ? 1 : 0)}/{game.max_players})</span>
        </div>
        <p className="text-xs text-rungles-500 dark:text-rungles-400 mt-1">{subText}</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelDisabled}
            className="w-7 h-7 grid place-items-center rounded-full text-rungles-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40 transition-colors"
            aria-label="Cancel game"
            title="Cancel game"
          >
            ✕
          </button>
        )}
        {onDecline && (
          <button
            type="button"
            onClick={onDecline}
            disabled={declineDisabled}
            className="w-7 h-7 grid place-items-center rounded-full text-rungles-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40 transition-colors"
            aria-label="Decline invite"
            title="Decline invite"
          >
            ✕
          </button>
        )}
        <button
          type="button"
          className={`btn-primary text-sm shrink-0 ${isInviteToMe ? 'bg-amber-500 hover:bg-amber-600' : ''}`}
          onClick={actionHandler}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  )
}
