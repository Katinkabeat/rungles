// Data layer for an active rg_games match. Server is source of truth.
// Pure functions only — React component owns state and subscriptions.

import { supabase, rpcWithRetry } from './supabase.js'
import { subscribeTopic, unsubscribeTopic } from './realtimeBroadcast.js'

// Load everything we need to render the match. Returns
// { game, players: [{userId, playerIdx, score, username}], rack, rungs, premiumPos }.
//
// Independent queries fan out in parallel; only profiles (needs player ids)
// and premiumPos (needs rung count) wait on a prior result.
export async function loadMatch(gameId, myUserId) {
  const [gameRes, playersRes, rackRes, rungsRes] = await Promise.all([
    supabase.from('rg_games').select('*').eq('id', gameId).single(),
    supabase.from('rg_players')
      .select('user_id, player_idx, score, dismissed_at').eq('game_id', gameId),
    supabase.from('rg_racks').select('rack')
      .eq('game_id', gameId).eq('user_id', myUserId).maybeSingle(),
    supabase.from('rg_rungs').select('*').eq('game_id', gameId)
      .order('rung_number', { ascending: true }),
  ])

  if (gameRes.error) throw gameRes.error
  const game = gameRes.data
  const players = playersRes.data ?? []
  const rack = rackRes.data?.rack ?? []
  const rungs = rungsRes.data ?? []

  const ids = players.map(p => p.user_id)
  const [profilesRes, premiumPos] = await Promise.all([
    ids.length
      ? supabase.from('profiles').select('id, username').in('id', ids)
      : Promise.resolve({ data: [] }),
    fetchPremium(gameId, rungs.length + 1),
  ])
  const usernameById = Object.fromEntries(
    (profilesRes.data ?? []).map(p => [p.id, p.username])
  )

  const enrichedPlayers = players.map(p => ({
    userId: p.user_id,
    playerIdx: p.player_idx,
    score: p.score,
    dismissedAt: p.dismissed_at,
    username: usernameById[p.user_id] ?? '?',
  }))

  return { game, players: enrichedPlayers, rack, rungs, premiumPos }
}

export async function fetchPremium(gameId, rungNumber) {
  const { data, error } = await rpcWithRetry(() =>
    supabase.rpc('rg_premium_pos', {
      p_game_id: gameId, p_rung_number: rungNumber,
    })
  )
  if (error) return null
  return data
}

export async function refreshRack(gameId, myUserId) {
  const { data } = await supabase
    .from('rg_racks').select('rack')
    .eq('game_id', gameId).eq('user_id', myUserId).maybeSingle()
  return data?.rack ?? []
}

// Submit a rung. Returns the score awarded.
// word_sources: 0 for carried, 1-based rack index otherwise.
export async function submitRung(gameId, word, sources) {
  const { data, error } = await rpcWithRetry(() =>
    supabase.rpc('rg_submit_rung', {
      p_game_id: gameId, p_word: word, p_word_sources: sources,
    })
  )
  if (error) throw error
  return data
}

export async function skipTurn(gameId) {
  const { error } = await rpcWithRetry(() =>
    supabase.rpc('rg_skip_turn', { p_game_id: gameId })
  )
  if (error) throw error
}

export async function giveUpMatch(gameId) {
  const { error } = await rpcWithRetry(() =>
    supabase.rpc('rg_give_up', { p_game_id: gameId })
  )
  if (error) throw error
}

// Claim the win when it's been the opponent's turn for 7+ days (c153).
// Server enforces: caller is a player, it's NOT their turn, and
// rg_games.turn_started_at is older than 7 days. The stalled opponent is
// recorded as the forfeiter; the caller wins.
export async function claimInactiveWin(gameId) {
  const { error } = await rpcWithRetry(() =>
    supabase.rpc('rg_claim_inactive_win', { p_game_id: gameId })
  )
  if (error) throw error
}

// Game-status subscription used by the waiting room (waiting -> active).
// Private Broadcast topic rungles:game:<id> (supabase/realtime_broadcast.sql);
// payload.new is the full rg_games row on UPDATE.
export function subscribeGameStatus(gameId, onUpdate) {
  return subscribeTopic(`rungles:game:${gameId}`, payload => {
    if (payload?.table === 'rg_games' && payload.event === 'UPDATE') onUpdate(payload.new)
  })
}

// Active-match subscription. Routes the game topic's 'change' payloads by
// payload.table to the three callbacks.
export function subscribeMatch(gameId, { onRungInsert, onGameUpdate, onPlayerUpdate }) {
  return subscribeTopic(`rungles:game:${gameId}`, payload => {
    if (payload?.table === 'rg_rungs' && payload.event === 'INSERT') onRungInsert?.(payload.new)
    else if (payload?.table === 'rg_games' && payload.event === 'UPDATE') onGameUpdate?.(payload.new)
    else if (payload?.table === 'rg_players' && payload.event === 'UPDATE') onPlayerUpdate?.(payload.new)
  })
}

export function unsubscribe(handle) {
  unsubscribeTopic(handle)
}

// Carry-highlight: returns an array of booleans (length=word) marking which
// letters were carried from prevWord by pool-matching. Mirrors the legacy
// appendWordWithCarryHighlight function — used for ladder display where we
// don't have per-letter source info from the server.
export function highlightCarried(word, prevWord) {
  const pool = (prevWord || '').toUpperCase().split('')
  return (word || '').toUpperCase().split('').map(ch => {
    const idx = pool.indexOf(ch)
    if (idx !== -1) { pool[idx] = null; return true }
    return false
  })
}
