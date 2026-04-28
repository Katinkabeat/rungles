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

// Returns finished games this user was in and hasn't dismissed yet.
// Each entry: { gameId, finishedAt, isWinner, isForfeit, gaveUp,
//   winnerUserId, winnerName, opponentName, myScore, opponentScore }.
// localStorage cache (keyed per user) gives instant filtering even before
// the server's dismissed_at write lands.
export async function fetchUnseenResults(myUserId) {
  const seenKey = `rungles_seen_results_${myUserId}`
  const seen = new Set(JSON.parse(localStorage.getItem(seenKey) ?? '[]'))

  // My player rows for finished games where I haven't dismissed.
  const { data: myRows, error } = await supabase
    .from('rg_players')
    .select(`
      game_id, player_idx, score, dismissed_at,
      rg_games!inner ( id, status, finished_at, winner_player_idx, forfeit_user_id )
    `)
    .eq('user_id', myUserId)
    .is('dismissed_at', null)
    .eq('rg_games.status', 'complete')
    .limit(50)
  if (error) throw error

  const unseen = (myRows ?? []).filter(r => !seen.has(r.game_id))
  if (unseen.length === 0) return []

  // Sort newest-first by finished_at (client-side; ordering on a foreign-table
  // column via supabase-js can be flaky).
  unseen.sort((a, b) =>
    (b.rg_games?.finished_at ?? '').localeCompare(a.rg_games?.finished_at ?? '')
  )

  const gameIds = unseen.map(r => r.game_id)
  const { data: allPlayers } = await supabase
    .from('rg_players')
    .select('game_id, user_id, player_idx, score')
    .in('game_id', gameIds)

  const userIds = [...new Set((allPlayers ?? []).map(p => p.user_id))]
  let usernameById = {}
  if (userIds.length) {
    const { data: profs } = await supabase
      .from('profiles').select('id, username').in('id', userIds)
    usernameById = Object.fromEntries((profs ?? []).map(p => [p.id, p.username]))
  }

  const playersByGame = {}
  for (const p of (allPlayers ?? [])) {
    if (!playersByGame[p.game_id]) playersByGame[p.game_id] = []
    playersByGame[p.game_id].push(p)
  }

  return unseen.map(r => {
    const game = r.rg_games
    const all = playersByGame[r.game_id] ?? []
    const me = all.find(p => p.user_id === myUserId)
    const opponent = all.find(p => p.user_id !== myUserId)
    const winner = all.find(p => p.player_idx === game?.winner_player_idx)
    const isForfeit = !!game?.forfeit_user_id
    const gaveUp = isForfeit && game.forfeit_user_id === myUserId
    return {
      gameId: r.game_id,
      finishedAt: game?.finished_at,
      isWinner: winner?.user_id === myUserId,
      isForfeit,
      gaveUp,
      winnerUserId: winner?.user_id,
      winnerName: usernameById[winner?.user_id] ?? '?',
      opponentName: usernameById[opponent?.user_id] ?? '?',
      myScore: me?.score ?? 0,
      opponentScore: opponent?.score ?? 0,
    }
  })
}

// Mark a finished game's result as dismissed (won't appear in the banner
// next time). Server-of-truth via RPC; localStorage for instant UI cache.
export async function dismissResult(myUserId, gameId) {
  const seenKey = `rungles_seen_results_${myUserId}`
  const seen = new Set(JSON.parse(localStorage.getItem(seenKey) ?? '[]'))
  seen.add(gameId)
  localStorage.setItem(seenKey, JSON.stringify([...seen]))

  const { error } = await supabase.rpc('rg_dismiss_result', { p_game_id: gameId })
  if (error) throw error
}

// Lobby-scoped subscription that fires onFinish(gameId) when any rg_games row
// flips to status='complete'. Caller filters to "games I'm in" using its own
// player-membership snapshot (we don't have that info in the payload).
export function subscribeFinishes(onFinish) {
  return supabase
    .channel('lobby_rg_finishes')
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'rg_games' },
      (payload) => {
        if (payload.new?.status === 'complete' && payload.old?.status !== 'complete') {
          onFinish(payload.new)
        }
      })
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
