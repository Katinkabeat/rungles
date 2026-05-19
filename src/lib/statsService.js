// Pure data layer for the stats modal: fetch personal solo-game history +
// leaderboards from rg_solo_games, plus personal multiplayer stats derived
// from rg_players / rg_games / rg_rungs. UI lives in StatsModal.jsx.

import { supabase } from './supabase.js'

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
export async function fetchMyMultiplayerStats(userId) {
  const [playersRes, bestRungRes] = await Promise.all([
    supabase
      .from('rg_players')
      .select('player_idx, score, rg_games!inner(status, winner_player_idx)')
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

  const rows = playersRes.data ?? []
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
export async function fetchBestRungEver() {
  const { data, error } = await supabase
    .from('rg_solo_games')
    .select('user_id, best_word, best_rung_score, played_at')
    .not('best_rung_score', 'is', null)
    .order('best_rung_score', { ascending: false })
    .limit(1)
  if (error) throw error
  const row = (data ?? [])[0]
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
