// Pure data layer for the stats modal: fetch personal solo-game history +
// leaderboards from rg_solo_games, plus personal multiplayer stats derived
// from rg_players / rg_games / rg_rungs. UI lives in StatsModal.jsx.

import { supabase, rpcWithRetry } from './supabase.js'

// ── personal stats ────────────────────────────────────────────────
export async function fetchMyStats(userId) {
  const { data: rows, error } = await supabase
    .from('rg_solo_games')
    .select('total_score, rungs_completed, gave_up, best_word, best_rung_score, played_at')
    .eq('user_id', userId)
    .order('played_at', { ascending: false })
  if (error) throw error
  return rows ?? []
}

export function summarizeStats(rows) {
  if (!rows || rows.length === 0) return null
  const completed = rows.filter(r => !r.gave_up)
  const bestScore = Math.max(...rows.map(r => r.total_score))
  const avgScore = completed.length
    ? Math.round(completed.reduce((s, r) => s + r.total_score, 0) / completed.length)
    : null
  const totalRungs = rows.reduce((s, r) => s + r.rungs_completed, 0)
  const totalRungScore = rows.reduce((s, r) => s + r.total_score, 0)
  const avgRungScore = totalRungs ? Math.round(totalRungScore / totalRungs) : null
  let bestRung = null
  for (const r of rows) {
    if (r.best_rung_score != null && (!bestRung || r.best_rung_score > bestRung.best_rung_score)) {
      bestRung = r
    }
  }
  return {
    bestScore,
    completedCount: completed.length,
    totalCount: rows.length,
    avgScore,
    avgRungScore,
    bestRung,
    recent: rows.slice(0, 10),
  }
}

// ── personal multiplayer stats ───────────────────────────────────
// c332: any completed game with a test-account member seated is ignored for
// BOTH players' win/loss/stats — not just the member's own. So we can't
// filter by userId alone: we have to know every seat in each of the
// caller's games and drop the whole game if any seat is a member.
export async function fetchMyMultiplayerStats(userId) {
  const [playersRes, bestRungRes] = await Promise.all([
    supabase
      .from('rg_players')
      .select('game_id, player_idx, score, rg_games!inner(status, winner_player_idx)')
      .eq('user_id', userId)
      .eq('rg_games.status', 'complete'),
    supabase
      .from('rg_rungs')
      .select('word, rung_score')
      .eq('player_user_id', userId)
      .order('rung_score', { ascending: false })
      .limit(1),
  ])
  if (playersRes.error) throw playersRes.error
  if (bestRungRes.error) throw bestRungRes.error

  let rows = playersRes.data ?? []
  if (rows.length === 0) {
    return { matches: 0, wins: 0, avgScore: null, bestRung: null }
  }

  const gameIds = [...new Set(rows.map(r => r.game_id))]
  const { data: allSeats, error: seatsErr } = await supabase
    .from('rg_players')
    .select('game_id, user_id')
    .in('game_id', gameIds)
  if (seatsErr) throw seatsErr

  const allUserIds = [...new Set((allSeats ?? []).map(s => s.user_id))]
  const { data: testIds, error: testErr } = await supabase.rpc('sq_test_account_ids', { uids: allUserIds })
  if (testErr) throw testErr
  const testIdSet = new Set(testIds ?? [])

  const excludedGameIds = new Set(
    (allSeats ?? []).filter(s => testIdSet.has(s.user_id)).map(s => s.game_id)
  )
  rows = rows.filter(r => !excludedGameIds.has(r.game_id))

  if (rows.length === 0) {
    return { matches: 0, wins: 0, avgScore: null, bestRung: null }
  }
  const wins = rows.filter(r => r.player_idx === r.rg_games?.winner_player_idx).length
  const totalScore = rows.reduce((s, r) => s + (r.score ?? 0), 0)
  const avgScore = Math.round(totalScore / rows.length)
  const best = (bestRungRes.data ?? [])[0] ?? null
  return {
    matches: rows.length,
    wins,
    avgScore,
    bestRung: best ? { word: best.word, score: best.rung_score } : null,
  }
}

// ── daily (c215) ─────────────────────────────────────────────────
// The caller's daily row for `date` (Atlantic YYYY-MM-DD), or null if they
// haven't played today. Used to gate the once-a-day solo.
export async function fetchTodayDaily(userId, date) {
  const { data, error } = await supabase
    .from('rg_solo_games')
    .select('total_score, rungs_completed, gave_up, best_word, best_rung_score, played_at')
    .eq('user_id', userId)
    .eq('play_date', date)
    .maybeSingle()
  if (error) throw error
  return data ?? null
}

// Authoritative daily write. `playDate` is the board the run was actually
// played on (state.dayKey); the server rejects it unless it's still the current
// Atlantic day, so a ladder that crosses midnight is refused rather than
// re-dated onto today's board (c257). No-ops on a second play. Returns
// { counted, playDay }.
export async function recordDailySolo({ playDate, totalScore, rungsCompleted, gaveUp, bestWord, bestRungScore }) {
  // rpcWithRetry covers the iOS-Safari network-layer race; the caller
  // (finishGame) layers a refreshSession()-and-retry on top for stale-token
  // 401s after a backgrounded tab. Together they keep a finished daily from
  // being silently dropped (which also reopened the day for replay).
  const { data, error } = await rpcWithRetry(() => supabase.rpc('rg_record_daily_solo', {
    p_play_date: playDate,
    p_total_score: totalScore,
    p_rungs_completed: rungsCompleted,
    p_gave_up: gaveUp,
    p_best_word: bestWord ?? null,
    p_best_rung_score: bestRungScore ?? null,
  }))
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return { counted: !!row?.counted, playDay: row?.play_day ?? null }
}

// ── leaderboard (c92: timeframe-aware via RPCs) ──────────────────
// Fetches the top-10 leaderboard for the requested window, plus the
// caller's best-game rank if they're outside the top 10. Per-game
// ranking — a user can appear multiple times in the top 10.
export async function fetchSoloLeaderboard({ timeframe, date }) {
  const [lbRes, rankRes] = await Promise.all([
    supabase.rpc('rg_solo_leaderboard', { p_timeframe: timeframe, p_date: date }),
    supabase.rpc('rg_solo_my_rank',     { p_timeframe: timeframe, p_date: date }),
  ])
  if (lbRes.error)   throw lbRes.error
  if (rankRes.error) throw rankRes.error

  const rows = (lbRes.data ?? []).map(r => ({
    userId: r.user_id,
    username: r.username ?? 'anonymous',
    totalScore: r.total_score,
    bestWord: r.best_word,
    bestRungScore: r.best_rung_score,
    playedAt: r.played_at,
  }))
  const rankRow = Array.isArray(rankRes.data) ? rankRes.data[0] : rankRes.data
  return { rows, myRank: rankRow ?? null }
}

// Permanent all-time "best single rung ever" badge — separate from the
// windowed leaderboard so it doesn't change per timeframe.
// c332: a test-account member's runs never surface here. Rather than a
// second RPC, over-fetch a small candidate page and filter client-side —
// simple and correct at this table's size, and avoids a bespoke SQL function
// for one badge.
export async function fetchBestRungEver() {
  const { data, error } = await supabase
    .from('rg_solo_games')
    .select('user_id, best_word, best_rung_score, played_at')
    .not('best_rung_score', 'is', null)
    .order('best_rung_score', { ascending: false })
    .limit(20)
  if (error) throw error
  const rows = data ?? []
  if (rows.length === 0) return null

  const candidateIds = [...new Set(rows.map(r => r.user_id))]
  const { data: testIds, error: testErr } = await supabase.rpc('sq_test_account_ids', { uids: candidateIds })
  if (testErr) throw testErr
  const testIdSet = new Set(testIds ?? [])

  const row = rows.find(r => !testIdSet.has(r.user_id))
  if (!row) return null

  const { data: prof } = await supabase
    .from('profiles').select('username').eq('id', row.user_id).maybeSingle()
  return {
    userId: row.user_id,
    username: prof?.username ?? '…',
    bestWord: row.best_word,
    bestRungScore: row.best_rung_score,
    playedAt: row.played_at,
  }
}

export function formatPlayedAt(iso) {
  const d = new Date(iso)
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  const opts = sameYear
    ? { month: 'short', day: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric' }
  return d.toLocaleDateString(undefined, opts)
}
