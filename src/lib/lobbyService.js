import { supabase, SUPABASE_URL, SUPABASE_ANON } from './supabase.js'

const NUDGE_COOLDOWN_MS = 12 * 60 * 60 * 1000

// Returns { games, usernameById } where games are the visible rows
// (waiting + active-where-I'm-a-player).
export async function fetchLobby(myUserId) {
  const { data: games, error } = await supabase
    .from('rg_games')
    .select(`
      id, status, created_at, total_rungs, max_players,
      current_player_idx, turn_started_at, last_nudged_at,
      rg_players ( user_id, player_idx )
    `)
    .in('status', ['waiting', 'active'])
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error

  const visible = (games ?? []).filter(g =>
    g.status === 'waiting' ||
    (g.status === 'active' && (g.rg_players ?? []).some(p => p.user_id === myUserId))
  )

  const userIds = [...new Set(visible.flatMap(g => (g.rg_players ?? []).map(p => p.user_id)))]
  let usernameById = {}
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username')
      .in('id', userIds)
    usernameById = Object.fromEntries((profiles ?? []).map(p => [p.id, p.username]))
  }

  return { games: visible, usernameById }
}

// Subscribes to rg_games + rg_players changes. Returns the channel — caller
// is responsible for `supabase.removeChannel(channel)` on cleanup.
export function subscribeLobby(onChange) {
  return supabase
    .channel('lobby_rg_games')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'rg_games' }, onChange)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'rg_players' }, onChange)
    .subscribe()
}

export async function createGame({ totalRungs = 10 } = {}) {
  const { data, error } = await supabase.rpc('rg_create_game', { p_total_rungs: totalRungs })
  if (error) throw error
  return data // game id
}

export async function joinGame(gameId) {
  const { error } = await supabase.rpc('rg_join_game', { p_game_id: gameId })
  if (error) throw error
}

export async function sendNudge(gameId, nudgerName) {
  const { error: rpcErr } = await supabase.rpc('rg_nudge', { p_game_id: gameId })
  if (rpcErr) throw rpcErr

  // Fire-and-forget push delivery — don't block on it.
  const url = `${SUPABASE_URL}/functions/v1/rungles-push-notification`
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON}`,
      apikey: SUPABASE_ANON,
    },
    body: JSON.stringify({ type: 'nudge', game_id: gameId, nudger_name: nudgerName }),
  }).catch(() => {})
}

export function canNudgeGame(game, myUserId, recentlyNudgedSet) {
  const players = (game.rg_players ?? [])
  const isMine = players.some(p => p.user_id === myUserId)
  const isActive = game.status === 'active'
  const currentPlayer = players.find(p => p.player_idx === game.current_player_idx)
  const isMyTurn = currentPlayer?.user_id === myUserId
  const now = Date.now()
  const turnAge = game.turn_started_at ? now - new Date(game.turn_started_at).getTime() : 0
  const nudgeAge = game.last_nudged_at ? now - new Date(game.last_nudged_at).getTime() : Infinity
  return isActive
    && isMine
    && !isMyTurn
    && turnAge > NUDGE_COOLDOWN_MS
    && nudgeAge > NUDGE_COOLDOWN_MS
    && !recentlyNudgedSet.has(game.id)
}
