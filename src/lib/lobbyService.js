import { supabase, rpcWithRetry, SUPABASE_URL, SUPABASE_ANON } from './supabase.js'

const NUDGE_COOLDOWN_MS = 12 * 60 * 60 * 1000

// Returns { games, usernameById } where games are the visible rows
// (waiting + active-where-I'm-a-player). Lazy-sweeps any expired
// waiting games before reading. Includes invited_user_id so callers
// can route invited matches into the right lobby section.
export async function fetchLobby(myUserId) {
  // Cheap server-side sweep — only updates rows that are actually
  // past their expires_at deadline. Non-fatal if it fails.
  try { await rpcWithRetry(() => supabase.rpc('rg_expire_stale_games')) } catch { /* ignore */ }

  const { data: games, error } = await supabase
    .from('rg_games')
    .select(`
      id, status, created_at, total_rungs, max_players,
      current_player_idx, turn_started_at, last_nudged_at,
      invited_user_id, expires_at, cancelled_at, created_by,
      rg_players ( user_id, player_idx )
    `)
    .in('status', ['waiting', 'active'])
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error

  // Hide invited games from non-participants. RLS already enforces
  // this server-side; the filter here is defense-in-depth.
  const visible = (games ?? []).filter(g => {
    const iAmParticipant =
      g.created_by === myUserId ||
      g.invited_user_id === myUserId ||
      (g.rg_players ?? []).some(p => p.user_id === myUserId)
    if (g.status === 'waiting') {
      return g.invited_user_id == null || iAmParticipant
    }
    return g.status === 'active' && iAmParticipant
  })

  const userIds = new Set()
  for (const g of visible) {
    for (const p of (g.rg_players ?? [])) userIds.add(p.user_id)
    if (g.invited_user_id) userIds.add(g.invited_user_id)
    if (g.created_by) userIds.add(g.created_by)
  }
  let usernameById = {}
  if (userIds.size > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username')
      .in('id', [...userIds])
    usernameById = Object.fromEntries((profiles ?? []).map(p => [p.id, p.username]))
  }

  return { games: visible, usernameById }
}

// Subscribes to rg_games + rg_players changes scoped to this user.
// Returns the channel — caller is responsible for
// `supabase.removeChannel(channel)` on cleanup.
//
// Tradeoff: filters are server-side, so we only fire onChange for rows
// that touch this user (games I created, games I'm invited to, and my
// player rows). Open public games created by others won't push live;
// they appear on the next manual refresh / navigation. Without this
// scoping, every move on the platform triggered a full lobby rebuild.
export function subscribeLobby(myUserId, onChange) {
  return supabase
    .channel(`lobby_rg_games_${myUserId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'rg_games',
        filter: `created_by=eq.${myUserId}` }, onChange)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'rg_games',
        filter: `invited_user_id=eq.${myUserId}` }, onChange)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'rg_players',
        filter: `user_id=eq.${myUserId}` }, onChange)
    .subscribe()
}

// Returns the user's last 10 finished games (most recent first).
// Each entry: { gameId, finishedAt, isWinner, isForfeit, gaveUp,
//   winnerUserId, winnerName, opponentName, myScore, opponentScore }.
export async function fetchUnseenResults(myUserId) {
  // Query rg_games as the parent so order-by finished_at sorts the rows we
  // limit on (ordering by a joined column only sorts the embed).
  const { data: gms, error } = await supabase
    .from('rg_games')
    .select(`
      id, status, finished_at, winner_player_idx, forfeit_user_id, closed_by_admin,
      rg_players!inner ( user_id, player_idx, score )
    `)
    .eq('status', 'complete')
    .eq('rg_players.user_id', myUserId)
    .order('finished_at', { ascending: false })
    .limit(10)
  if (error) throw error

  const unseen = (gms ?? []).map(g => ({
    game_id: g.id,
    rg_games: g,
  }))
  if (unseen.length === 0) return []

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
    const isAdminClosed = !!game?.closed_by_admin
    return {
      gameId: r.game_id,
      finishedAt: game?.finished_at,
      isWinner: !isAdminClosed && winner?.user_id === myUserId,
      isForfeit,
      gaveUp,
      isAdminClosed,
      winnerUserId: isAdminClosed ? null : winner?.user_id,
      winnerName: isAdminClosed ? null : (usernameById[winner?.user_id] ?? '?'),
      opponentName: usernameById[opponent?.user_id] ?? '?',
      myScore: me?.score ?? 0,
      opponentScore: opponent?.score ?? 0,
    }
  })
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

/**
 * Create a new game. Pass `invitedUserId` to make it a private friend
 * invite (only that user can see/join, auto-cancels in 3 days). Omit
 * for an open match (anyone joins, auto-cancels in 7 days).
 */
export async function createGame({ totalRungs = 10, invitedUserId = null } = {}) {
  const { data, error } = await rpcWithRetry(() =>
    supabase.rpc('rg_create_game', {
      p_total_rungs: totalRungs,
      p_invited_user_id: invitedUserId,
    })
  )
  if (error) throw error
  return data // game id
}

export async function joinGame(gameId) {
  const { error } = await rpcWithRetry(() =>
    supabase.rpc('rg_join_game', { p_game_id: gameId })
  )
  if (error) throw error
}

/**
 * Cancel a game the current user created. Server enforces:
 *   - caller is the creator
 *   - status is 'waiting' or 'active'
 *   - no rungs have been played
 */
export async function cancelGame(gameId) {
  const { error } = await rpcWithRetry(() =>
    supabase.rpc('rg_cancel_game', { p_game_id: gameId })
  )
  if (error) throw error
}

/**
 * Decline a 1v1 invite. Server enforces the caller is the invited user
 * of a 'waiting' game, then closes it with close_reason='Invite declined'.
 */
export async function declineInvite(gameId) {
  const { error } = await rpcWithRetry(() =>
    supabase.rpc('rg_decline_invite', { p_game_id: gameId })
  )
  if (error) throw error
}

export async function sendNudge(gameId, nudgerName) {
  const { error: rpcErr } = await rpcWithRetry(() =>
    supabase.rpc('rg_nudge', { p_game_id: gameId })
  )
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
