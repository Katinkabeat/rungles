// Data layer for an active rg_games match. Server is source of truth.
// Pure functions only — React component owns state and subscriptions.

import { supabase } from './supabase.js'

// Load everything we need to render the match. Returns
// { game, players: [{userId, playerIdx, score, username}], rack, rungs, premiumPos }.
export async function loadMatch(gameId, myUserId) {
  const { data: game, error: gErr } = await supabase
    .from('rg_games').select('*').eq('id', gameId).single()
  if (gErr) throw gErr

  const { data: rawPlayers } = await supabase
    .from('rg_players').select('user_id, player_idx, score').eq('game_id', gameId)
  const players = rawPlayers ?? []

  let usernameById = {}
  const ids = players.map(p => p.user_id)
  if (ids.length) {
    const { data: profiles } = await supabase
      .from('profiles').select('id, username').in('id', ids)
    usernameById = Object.fromEntries((profiles ?? []).map(p => [p.id, p.username]))
  }

  const { data: rackRow } = await supabase
    .from('rg_racks').select('rack')
    .eq('game_id', gameId).eq('user_id', myUserId).maybeSingle()
  const rack = rackRow?.rack ?? []

  const { data: rungs } = await supabase
    .from('rg_rungs').select('*').eq('game_id', gameId)
    .order('rung_number', { ascending: true })

  const premiumPos = await fetchPremium(gameId, (rungs?.length ?? 0) + 1)

  const enrichedPlayers = players.map(p => ({
    userId: p.user_id,
    playerIdx: p.player_idx,
    score: p.score,
    username: usernameById[p.user_id] ?? '?',
  }))

  return { game, players: enrichedPlayers, rack, rungs: rungs ?? [], premiumPos }
}

export async function fetchPremium(gameId, rungNumber) {
  const { data, error } = await supabase.rpc('rg_premium_pos', {
    p_game_id: gameId, p_rung_number: rungNumber,
  })
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
  const { data, error } = await supabase.rpc('rg_submit_rung', {
    p_game_id: gameId, p_word: word, p_word_sources: sources,
  })
  if (error) throw error
  return data
}

export async function skipTurn(gameId) {
  const { error } = await supabase.rpc('rg_skip_turn', { p_game_id: gameId })
  if (error) throw error
}

export async function giveUpMatch(gameId) {
  const { error } = await supabase.rpc('rg_give_up', { p_game_id: gameId })
  if (error) throw error
}

// Game-status subscription used by the waiting room (waiting -> active).
export function subscribeGameStatus(gameId, onUpdate) {
  return supabase
    .channel(`rg_game_${gameId}`)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'rg_games', filter: `id=eq.${gameId}` },
      payload => onUpdate(payload.new))
    .subscribe()
}

// Active-match subscription. Fires three callbacks for the three event streams.
export function subscribeMatch(gameId, { onRungInsert, onGameUpdate, onPlayerUpdate }) {
  return supabase
    .channel(`rg_match_${gameId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'rg_rungs', filter: `game_id=eq.${gameId}` },
      payload => onRungInsert?.(payload.new))
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'rg_games', filter: `id=eq.${gameId}` },
      payload => onGameUpdate?.(payload.new))
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'rg_players', filter: `game_id=eq.${gameId}` },
      payload => onPlayerUpdate?.(payload.new))
    .subscribe()
}

export function unsubscribe(channel) {
  if (channel) supabase.removeChannel(channel)
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
