import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchMyStats, summarizeStats,
  fetchMyMultiplayerStats,
  fetchSoloLeaderboard, formatPlayedAt,
} from '../lib/statsService.js'

const TIMEFRAMES = [
  { key: 'day',   label: 'Day'      },
  { key: 'week',  label: 'Week'     },
  { key: 'month', label: 'Month'    },
  { key: 'all',   label: 'All-time' },
]

const WINDOW_LABEL = {
  week:  'This week (Mon–Sun)',
  month: 'This month',
  all:   'All-time, since launch',
}

// UTC formatter — iso date strings represent calendar dates, not
// instants. Without timeZone: 'UTC' an Atlantic client renders the
// previous day.
const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
})

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

function formatIso(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return DATE_FMT.format(new Date(Date.UTC(y, m - 1, d)))
}

function todayInHalifax() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Halifax',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return fmt.format(new Date())
}

export default function StatsModal({ open, myUserId, onClose }) {
  const ref = useRef(null)
  const [tab, setTab] = useState('board')
  const [meRows, setMeRows] = useState(null)
  const [meErr, setMeErr] = useState(null)
  const [mpStats, setMpStats] = useState(null)
  const [mpErr, setMpErr] = useState(null)

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  useEffect(() => {
    if (!open || !myUserId) return
    setMeRows(null); setMeErr(null)
    setMpStats(null); setMpErr(null)
    fetchMyStats(myUserId).then(setMeRows).catch(e => setMeErr(e.message ?? String(e)))
    fetchMyMultiplayerStats(myUserId).then(setMpStats).catch(e => setMpErr(e.message ?? String(e)))
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
          <Tab active={tab === 'board'} onClick={() => setTab('board')}>🏆 Leaderboard</Tab>
          <Tab active={tab === 'me'} onClick={() => setTab('me')}>👤 Me</Tab>
        </div>

        {tab === 'me' && <MyStatsBody rows={meRows} err={meErr} mpStats={mpStats} mpErr={mpErr} />}
        {tab === 'board' && <LeaderboardBody myUserId={myUserId} open={open} />}
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

function MyStatsBody({ rows, err, mpStats, mpErr }) {
  if (err) return <p className="text-sm text-rose-600">Couldn't load stats: {err}</p>
  if (rows == null) return <p className="text-sm text-rungles-500 italic">Loading…</p>

  const hasSolo = rows.length > 0
  const hasMp = mpStats && mpStats.matches > 0
  if (!hasSolo && !hasMp && !mpErr && mpStats != null) {
    return <p className="text-sm text-rungles-500 italic">No games yet — go climb a ladder!</p>
  }

  const s = hasSolo ? summarizeStats(rows) : null
  const soloItems = s ? [
    ['Best score', s.bestScore],
    ['Games completed', `${s.completedCount} / ${s.totalCount}`],
    ['Average score (completed)', s.avgScore ?? '—'],
    ['Avg rung score', s.avgRungScore ?? '—'],
    ['Best single rung', s.bestRung ? `${s.bestRung.best_word} (+${s.bestRung.best_rung_score})` : '—'],
  ] : []

  const winRate = hasMp ? Math.round((mpStats.wins / mpStats.matches) * 100) : null
  const mpItems = hasMp ? [
    ['Matches played', mpStats.matches],
    ['Win rate', `${winRate}% (${mpStats.wins}/${mpStats.matches})`],
    ['Best rung', mpStats.bestRung ? `${mpStats.bestRung.word} (+${mpStats.bestRung.score})` : '—'],
    ['Avg score / match', mpStats.avgScore ?? '—'],
  ] : []

  return (
    <div className="space-y-4">
      {hasSolo && (
        <div>
          <h3 className="font-display text-sm text-rungles-700 dark:text-rungles-200 mb-1">
            🧗 Solo
          </h3>
          <div className="space-y-1">
            {soloItems.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between text-sm py-1">
                <span className="text-rungles-600 dark:text-rungles-300">{label}</span>
                <span className="font-bold text-rungles-700 dark:text-rungles-100">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="font-display text-sm text-rungles-700 dark:text-rungles-200 mb-1">
          🎮 Multiplayer
        </h3>
        {mpErr ? (
          <p className="text-sm text-rose-600">Couldn't load multiplayer stats: {mpErr}</p>
        ) : mpStats == null ? (
          <p className="text-sm text-rungles-500 italic">Loading…</p>
        ) : !hasMp ? (
          <p className="text-xs text-rungles-500 italic">No multiplayer games yet.</p>
        ) : (
          <div className="space-y-1">
            {mpItems.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between text-sm py-1">
                <span className="text-rungles-600 dark:text-rungles-300">{label}</span>
                <span className="font-bold text-rungles-700 dark:text-rungles-100">{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {hasSolo && (
        <div>
          <h3 className="font-display text-sm text-rungles-700 dark:text-rungles-200 mb-1">
            Last 10 solo games
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
      )}
    </div>
  )
}

function LeaderboardBody({ myUserId, open }) {
  const today = useMemo(() => todayInHalifax(), [])
  const [timeframe, setTimeframe] = useState('day')
  const [activeDate, setActiveDate] = useState(today)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)

  // Re-anchor date to today when leaving the Day tab so re-entry doesn't
  // strand the user on a stale past day.
  useEffect(() => {
    if (timeframe !== 'day') setActiveDate(today)
  }, [timeframe, today])

  const queryDate = timeframe === 'day' ? activeDate : today

  // Fetch leaderboard for the active timeframe/date.
  useEffect(() => {
    if (!open) return
    let active = true
    setData(null); setErr(null)
    fetchSoloLeaderboard({ timeframe, date: queryDate })
      .then(r => { if (active) setData(r) })
      .catch(e => { if (active) setErr(e.message ?? String(e)) })
    return () => { active = false }
  }, [open, timeframe, queryDate])

  const isToday = activeDate === today
  const rows = data?.rows ?? []
  const myRank = data?.myRank ?? null
  const youInTop = rows.some(r => r.userId === myUserId)
  const showMyRankRow = !youInTop && myRank && myRank.rank > 10

  return (
    <div className="space-y-4">
      <SegmentedControl
        options={TIMEFRAMES}
        value={timeframe}
        onChange={setTimeframe}
      />

      {timeframe === 'day' ? (
        <DateStepper
          isoDate={activeDate}
          isToday={isToday}
          onPrev={() => setActiveDate(addDays(activeDate, -1))}
          onNext={() => !isToday && setActiveDate(addDays(activeDate, 1))}
        />
      ) : (
        <p className="text-center text-xs opacity-60 -mt-1">{WINDOW_LABEL[timeframe]}</p>
      )}

      {err && <p className="text-sm text-rose-600">Couldn't load leaderboard: {err}</p>}
      {!err && data == null && <p className="italic opacity-70 py-6 text-sm">Loading…</p>}

      {!err && data && rows.length === 0 && (
        <p className="italic opacity-70 py-6 text-sm text-center">
          {timeframe === 'day'
            ? (isToday ? 'No games yet today — be the first!' : 'No games on this day.')
            : 'No games in this window yet.'}
        </p>
      )}

      {!err && data && rows.length > 0 && (
        <ol className="space-y-1.5">
          {rows.map((r, i) => (
            <LeaderboardRow key={i} rank={i + 1} row={r} isMe={r.userId === myUserId} />
          ))}
          {showMyRankRow && (
            <>
              <li className="pt-2 text-center text-[10px] uppercase tracking-wider opacity-50 border-t border-white/10 mt-2">
                your rank
              </li>
              <LeaderboardRow
                rank={myRank.rank}
                row={{ userId: myUserId, username: 'You', totalScore: myRank.score }}
                isMe
              />
            </>
          )}
        </ol>
      )}
    </div>
  )
}

function LeaderboardRow({ rank, row, isMe }) {
  return (
    <li className={`flex items-center gap-3 px-3 py-2 rounded-xl ${
      isMe ? 'bg-white/15 ring-1 ring-white/30' : 'bg-white/5'
    }`}>
      <div className="w-9 text-center font-display text-sm">#{rank}</div>
      <div className="flex-1 min-w-0 truncate text-sm">
        <span className="font-bold">{row.username ?? '…'}</span>
        {isMe && <span className="ml-2 text-[10px] opacity-60">← you</span>}
      </div>
      <div className="font-display text-sm">{row.totalScore} pts</div>
    </li>
  )
}

function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="flex gap-1 p-1 rounded-xl bg-white/5 border border-white/10">
      {options.map(opt => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-bold transition-colors ${
            value === opt.key
              ? 'bg-white/15 text-white ring-1 ring-white/30'
              : 'text-white/60 hover:text-white/80'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function DateStepper({ isoDate, isToday, onPrev, onNext }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-white/5 border border-white/10">
      <button
        type="button"
        onClick={onPrev}
        aria-label="Previous day"
        className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/15 text-white"
      >
        ‹
      </button>
      <div className="text-sm font-bold flex items-center gap-2">
        {formatIso(isoDate)}
        {isToday && (
          <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-pink-500 text-white">
            Today
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onNext}
        disabled={isToday}
        aria-label="Next day"
        className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/15 text-white disabled:opacity-30 disabled:hover:bg-white/5 disabled:cursor-not-allowed"
      >
        ›
      </button>
    </div>
  )
}
