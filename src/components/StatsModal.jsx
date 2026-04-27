import React, { useEffect, useRef, useState } from 'react'
import {
  fetchMyStats, summarizeStats,
  fetchLeaderboard, formatPlayedAt,
} from '../lib/statsService.js'

export default function StatsModal({ open, myUserId, onClose }) {
  const ref = useRef(null)
  const [tab, setTab] = useState('me')
  const [meRows, setMeRows] = useState(null)
  const [meErr, setMeErr] = useState(null)
  const [board, setBoard] = useState(null)
  const [boardErr, setBoardErr] = useState(null)

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  // Lazy-load when first opened, refresh on each open.
  useEffect(() => {
    if (!open || !myUserId) return
    setMeRows(null); setMeErr(null)
    setBoard(null); setBoardErr(null)
    fetchMyStats(myUserId).then(setMeRows).catch(e => setMeErr(e.message ?? String(e)))
    fetchLeaderboard().then(setBoard).catch(e => setBoardErr(e.message ?? String(e)))
  }, [open, myUserId])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose() }}
      className="dropdown-surface rounded-2xl p-0 max-w-[480px] w-[92vw] backdrop:bg-black/40"
    >
      <div className="p-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-xl text-rungles-700 dark:text-rungles-200">Stats</h2>
          <button
            type="button"
            className="text-rungles-500 hover:text-rungles-700 text-xl leading-none"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex gap-1 mb-3 border-b border-rungles-100 dark:border-rungles-900">
          <Tab active={tab === 'me'} onClick={() => setTab('me')}>👤 Me</Tab>
          <Tab active={tab === 'board'} onClick={() => setTab('board')}>🏆 Leaderboard</Tab>
        </div>

        {tab === 'me' && <MyStatsBody rows={meRows} err={meErr} />}
        {tab === 'board' && <LeaderboardBody board={board} err={boardErr} myUserId={myUserId} />}
      </div>
    </dialog>
  )
}

function Tab({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={`px-3 py-1.5 text-sm font-semibold border-b-2 -mb-px ${
        active
          ? 'border-rungles-500 text-rungles-700 dark:text-rungles-100'
          : 'border-transparent text-rungles-500 hover:text-rungles-700 dark:hover:text-rungles-200'
      }`}
    >
      {children}
    </button>
  )
}

function MyStatsBody({ rows, err }) {
  if (err) return <p className="text-sm text-rose-600">Couldn't load stats: {err}</p>
  if (rows == null) return <p className="text-sm text-rungles-500 italic">Loading…</p>
  if (rows.length === 0) return <p className="text-sm text-rungles-500 italic">No games yet — go climb a ladder!</p>

  const s = summarizeStats(rows)
  const items = [
    ['Best score', s.bestScore],
    ['Games completed', `${s.completedCount} / ${s.totalCount}`],
    ['Average score (completed)', s.avgScore ?? '—'],
    ['Avg rung score', s.avgRungScore ?? '—'],
    ['Best single rung', s.bestRung ? `${s.bestRung.best_word} (+${s.bestRung.best_rung_score})` : '—'],
  ]

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        {items.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between text-sm py-1">
            <span className="text-rungles-600 dark:text-rungles-300">{label}</span>
            <span className="font-bold text-rungles-700 dark:text-rungles-100">{value}</span>
          </div>
        ))}
      </div>
      <h3 className="font-display text-sm text-rungles-700 dark:text-rungles-200 mt-3">
        Last 10 games
      </h3>
      <div className="divide-y divide-rungles-100 dark:divide-rungles-900">
        {s.recent.map((r, i) => (
          <div key={i} className="flex items-center justify-between text-sm py-1.5">
            <span className="text-rungles-500 text-xs">{formatPlayedAt(r.played_at)}</span>
            <span className="flex items-center gap-2">
              <span className="font-bold text-rungles-700 dark:text-rungles-100">{r.total_score}</span>
              <span className="text-xs text-rungles-500">
                {r.gave_up ? `🏳️ rung ${r.rungs_completed + 1}` : '🏁 complete'}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function LeaderboardBody({ board, err, myUserId }) {
  if (err) return <p className="text-sm text-rose-600">Couldn't load leaderboard: {err}</p>
  if (board == null) return <p className="text-sm text-rungles-500 italic">Loading…</p>
  const { allTime, thisWeek, bestRung, nameById } = board
  if (allTime.length === 0) return <p className="text-sm text-rungles-500 italic">No games played yet.</p>

  return (
    <div className="space-y-4">
      <Section title="🏆 All-time top 10" rows={allTime} nameById={nameById} myUserId={myUserId} />
      <Section
        title="📅 This week"
        rows={thisWeek}
        nameById={nameById}
        myUserId={myUserId}
        emptyMessage="No games this week yet — be the first!"
      />
      {bestRung && (
        <div>
          <h3 className="font-display text-sm text-rungles-700 dark:text-rungles-200 mb-1">
            🎯 Best single rung ever
          </h3>
          <div className="flex items-center justify-between text-sm py-1">
            <span>
              <strong className={bestRung.user_id === myUserId ? 'text-rungles-700 dark:text-rungles-100 underline' : ''}>
                {nameById[bestRung.user_id] ?? '…'}
              </strong>
              <span className="text-rungles-500"> · {bestRung.best_word}</span>
            </span>
            <span className="font-bold text-rungles-700 dark:text-rungles-100">+{bestRung.best_rung_score}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, rows, nameById, myUserId, emptyMessage }) {
  return (
    <div>
      <h3 className="font-display text-sm text-rungles-700 dark:text-rungles-200 mb-1">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-rungles-500 italic">{emptyMessage ?? 'No games yet.'}</p>
      ) : (
        <div className="divide-y divide-rungles-100 dark:divide-rungles-900">
          {rows.map((r, i) => {
            const isMe = r.user_id === myUserId
            return (
              <div key={i} className="flex items-center justify-between text-sm py-1.5">
                <span>
                  <span className="text-rungles-500 mr-1">{i + 1}.</span>
                  <span className={isMe ? 'font-bold text-rungles-700 dark:text-rungles-100 underline' : 'text-rungles-700 dark:text-rungles-200'}>
                    {nameById[r.user_id] ?? '…'}
                  </span>
                </span>
                <span className="font-bold text-rungles-700 dark:text-rungles-100">{r.total_score}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
