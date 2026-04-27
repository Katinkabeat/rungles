// Pure data layer for the stats modal: fetch personal solo-game history +
// leaderboards from rg_solo_games. UI lives in StatsModal.jsx.

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

// ── leaderboard ──────────────────────────────────────────────────
function startOfThisWeek() {
  const now = new Date()
  const dow = now.getDay()
  const daysSinceMon = (dow + 6) % 7
  const monday = new Date(now)
  monday.setDate(now.getDate() - daysSinceMon)
  monday.setHours(0, 0, 0, 0)
  return monday
}

export async function fetchLeaderboard() {
  const weekStart = startOfThisWeek().toISOString()
  const [allTimeRes, weekRes, bestRungRes] = await Promise.all([
    supabase
      .from('rg_solo_games')
      .select('user_id, total_score, played_at')
      .order('total_score', { ascending: false })
      .limit(10),
    supabase
      .from('rg_solo_games')
      .select('user_id, total_score, played_at')
      .gte('played_at', weekStart)
      .order('total_score', { ascending: false })
      .limit(10),
    supabase
      .from('rg_solo_games')
      .select('user_id, best_word, best_rung_score, played_at')
      .not('best_rung_score', 'is', null)
      .order('best_rung_score', { ascending: false })
      .limit(1),
  ])

  if (allTimeRes.error) throw allTimeRes.error

  const allTime = allTimeRes.data ?? []
  const thisWeek = weekRes.data ?? []
  const bestRung = (bestRungRes.data ?? [])[0] ?? null

  const ids = new Set()
  allTime.forEach(r => ids.add(r.user_id))
  thisWeek.forEach(r => ids.add(r.user_id))
  if (bestRung) ids.add(bestRung.user_id)

  let nameById = {}
  if (ids.size) {
    const { data: profiles } = await supabase
      .from('profiles').select('id, username').in('id', [...ids])
    nameById = Object.fromEntries((profiles ?? []).map(p => [p.id, p.username]))
  }
  return { allTime, thisWeek, bestRung, nameById }
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
