// ────────────────────────────────────────────────────────────
//  StatsPage — full-page Stats view. Mirrors Yahdle/Snibble chrome
//  (SQLobbyShell + back-to-lobby + tab bar) so all three solo SQ
//  games present stats the same way.
//
//  Tab 1: 🏆 Leaderboard — timeframe-aware (Day/Week/Month/All-time)
//                          with date stepper. Per-user BEST game per
//                          window — one row per user.
//  Tab 2: 👤 Me           — solo + multiplayer stats + last 10 games.
// ────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react'
import { SQLobbyShell } from '../../../rae-side-quest/packages/sq-ui/index.js'
import RunglesHeader from './RunglesHeader.jsx'
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

export default function StatsPage({ session, profile, isAdmin, onBack }) {
  const [tab, setTab] = useState('board')
  const [meRows, setMeRows] = useState(null)
  const [meErr, setMeErr] = useState(null)
  const [mpStats, setMpStats] = useState(null)
  const [mpErr, setMpErr] = useState(null)
  const userId = session?.user?.id

  useEffect(() => {
    if (!userId) return
    setMeRows(null); setMeErr(null)
    setMpStats(null); setMpErr(null)
    fetchMyStats(userId).then(setMeRows).catch(e => setMeErr(e.message ?? String(e)))
    fetchMyMultiplayerStats(userId).then(setMpStats).catch(e => setMpErr(e.message ?? String(e)))
  }, [userId])

  return (
    <SQLobbyShell
      header={<RunglesHeader profile={profile} onOpenStats={() => {}} isAdmin={isAdmin} />}
    >
      <button
        onClick={onBack}
        className="text-sm opacity-80 hover:opacity-100 self-start"
      >
        ← Back to lobby
      </button>

      <div className="flex border-b border-white/10 mb-4">
        <TabButton active={tab === 'board'} onClick={() => setTab('board')}>🏆 Leaderboard</TabButton>
        <TabButton active={tab === 'me'}    onClick={() => setTab('me')}>👤 Me</TabButton>
      </div>

      {tab === 'board' && <LeaderboardTab myUserId={userId} />}
      {tab === 'me'    && <MyStatsTab rows={meRows} err={meErr} mpStats={mpStats} mpErr={mpErr} />}
    </SQLobbyShell>
  )
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-3 px-4 font-display text-sm transition-colors ${
        active
          ? 'text-white border-b-2 border-white'
          : 'text-white/60 hover:text-white/80'
      }`}
    >
      {children}
    </button>
  )
}

// ─── Leaderboard tab ─────────────────────────────────────────
function LeaderboardTab({ myUserId }) {
  const today = useMemo(() => todayInHalifax(), [])
  const [timeframe, setTimeframe] = useState('day')
  const [activeDate, setActiveDate] = useState(today)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (timeframe !== 'day') setActiveDate(today)
  }, [timeframe, today])

  const queryDate = timeframe === 'day' ? activeDate : today

  useEffect(() => {
    let active = true
    setData(null); setErr(null)
    fetchSoloLeaderboard({ timeframe, date: queryDate })
      .then(r => { if (active) setData(r) })
      .catch(e => { if (active) setErr(e.message ?? String(e)) })
    return () => { active = false }
  }, [timeframe, queryDate])

  const isToday = activeDate === today
  const rows = data?.rows ?? []
  const myRank = data?.myRank ?? null
  const youInTop = rows.some(r => r.userId === myUserId)
  const showMyRankRow = !youInTop && myRank && myRank.rank > 10

  return (
    <div className="space-y-4">
      <SegmentedControl options={TIMEFRAMES} value={timeframe} onChange={setTimeframe} />

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

      {err && <p className="text-rose-400 text-sm text-center py-6">{err}</p>}
      {!err && data == null && <p className="italic opacity-70 py-6 text-sm text-center">Loading…</p>}

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

// ─── Me tab ──────────────────────────────────────────────────
function MyStatsTab({ rows, err, mpStats, mpErr }) {
  if (err) return <p className="text-rose-400 text-sm py-6">{err}</p>
  if (rows == null) return <p className="italic opacity-70 py-6 text-sm">Loading…</p>

  const hasSolo = rows.length > 0
  const hasMp = mpStats && mpStats.matches > 0
  if (!hasSolo && !hasMp && !mpErr && mpStats != null) {
    return <p className="italic opacity-70 py-6 text-sm text-center">No games yet — go climb a ladder!</p>
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
    <div className="space-y-5">
      {hasSolo && (
        <Section title="🧗 Solo">
          {soloItems.map(([label, value]) => (
            <StatRow key={label} label={label} value={value} />
          ))}
        </Section>
      )}

      <Section title="🎮 Multiplayer">
        {mpErr ? (
          <p className="text-rose-400 text-sm">{mpErr}</p>
        ) : mpStats == null ? (
          <p className="italic opacity-70 text-sm">Loading…</p>
        ) : !hasMp ? (
          <p className="italic opacity-60 text-xs">No multiplayer games yet.</p>
        ) : (
          mpItems.map(([label, value]) => <StatRow key={label} label={label} value={value} />)
        )}
      </Section>

      {hasSolo && (
        <Section title="Last 10 solo games">
          <div className="divide-y divide-white/10">
            {s.recent.map((r, i) => (
              <div key={i} className="flex items-center justify-between text-sm py-1.5">
                <span className="opacity-60 text-xs">{formatPlayedAt(r.played_at)}</span>
                <span className="flex items-center gap-2">
                  <span className="font-bold">{r.total_score}</span>
                  <span className="text-xs opacity-60">
                    {r.gave_up ? `🏳️ rung ${r.rungs_completed + 1}` : '🏁 complete'}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section>
      <h3 className="font-display text-xs uppercase tracking-wider opacity-70 mb-2 px-1">{title}</h3>
      <div>{children}</div>
    </section>
  )
}

function StatRow({ label, value }) {
  return (
    <div className="flex justify-between items-center py-2 border-t border-white/10 text-sm first:border-t-0">
      <span className="opacity-80">{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  )
}
