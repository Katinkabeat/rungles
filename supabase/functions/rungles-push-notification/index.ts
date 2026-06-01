// Supabase Edge Function: rungles-push-notification
// Called by the rg_games trigger whenever current_player_idx changes.
// Looks up the next player's push subscription and sends a Web Push.
//
// Reuses Wordy's push_subscriptions table (one sub per user covers both
// games). VAPID env vars are shared with Wordy's function.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const VAPID_PRIVATE_KEY    = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_PUBLIC_KEY     = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_SUBJECT        = Deno.env.get('VAPID_SUBJECT')!
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Helper: respect the recipient's notification prefs before sending.
// Calls sq_notification_enabled(user, app, topic) — if false, skip
// the send entirely. Fail-open on RPC error so a transient DB blip
// doesn't break the platform.
async function sendIfOptedIn(
  supabase: any,
  userId: string,
  app: string,
  topic: string,
  payload: { title: string; body: string; tag: string; url: string; icon?: string }
): Promise<{ sent: boolean; reason?: string; via?: string }> {
  const { data: enabled, error } = await supabase.rpc('sq_notification_enabled', {
    p_user_id: userId,
    p_app: app,
    p_topic: topic,
  })
  if (error) {
    console.error('sq_notification_enabled failed (fail-open):', error)
  } else if (enabled === false) {
    return { sent: false, reason: 'opted out' }
  }
  return sendPushToUser(supabase, userId, payload)
}

// Tries the SideQuest hub subscription first (so users who enabled
// notifications in SideQuest get a single consolidated notification),
// falls back to the user's Rungles-specific subscription otherwise.
async function sendPushToUser(
  supabase: any,
  userId: string,
  payload: { title: string; body: string; tag: string; url: string; icon?: string }
): Promise<{ sent: boolean; reason?: string; via?: string }> {
  const apps = ['sidequest', 'rungles']

  for (const app of apps) {
    const { data: sub } = await supabase
      .from('push_subscriptions')
      .select('endpoint, keys_p256dh, keys_auth')
      .eq('user_id', userId)
      .eq('app', app)
      .maybeSingle()

    if (!sub) continue

    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
    }

    try {
      await webpush.sendNotification(pushSubscription, JSON.stringify(payload), { TTL: 86400 })
      return { sent: true, via: app }
    } catch (pushErr: any) {
      if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('app', app)
        // Fall through to the next app (fallback)
        continue
      }
      throw pushErr
    }
  }

  return { sent: false, reason: 'no push subscription' }
}

// Rotating quips for the invite_declined push — funny / bird / dog / ADHD
// flavoured, all warm rather than blunt. One picked at random per send.
// Rae-approved set (2026-05-31).
function declineBody(name: string, emoji: string): string {
  const quips = [
    `${name} flew the coop.`,
    `${name} chickened out.`,
    `${name} ducked out.`,
    `${name}'s not your wingman today.`,
    `${name} chased a squirrel instead.`,
    `${name} rolled over and bailed.`,
    `${name}'s in the doghouse.`,
    `${name} buried this one in the yard.`,
    `${name} got distracted by something shiny.`,
    `${name}'s brain changed the channel.`,
    `Ooh, squirrel — ${name}'s gone.`,
    `${name} flew south for this one.`,
  ]
  const quip = quips[Math.floor(Math.random() * quips.length)]
  return `${quip} Tap to start another. ${emoji}`
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json()
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // ── game_invited (from rg_games AFTER INSERT trigger) ───────
    if (payload.type === 'game_invited') {
      const { record } = payload
      if (!record?.id || !record.created_by || !record.invited_user_id) {
        return new Response(JSON.stringify({ skipped: 'missing fields' }), { status: 200, headers: corsHeaders })
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', record.created_by)
        .maybeSingle()
      const inviterName = profile?.username ?? 'Someone'

      const result = await sendIfOptedIn(supabase, record.invited_user_id, 'rungles', 'invite', {
        title: 'Rungles — match invite',
        body: `${inviterName} invited you to a Rungles match. Tap to play! 🪜`,
        tag: `rungles-invite-${record.id}`,
        url: `/rungles/?game=${record.id}`,
        icon: '/rungles/favicon.svg',
      })
      return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
    }

    // ── invite_declined (from rg_decline_invite RPC) ───────────
    // Rungles invites are 1v1, so a decline always closes the game.
    // Gated by the creator's 'invite_declined' pref (default OFF).
    if (payload.type === 'invite_declined') {
      const { game_id, creator_id, decliner_id } = payload
      if (!creator_id) {
        return new Response(JSON.stringify({ skipped: 'no creator' }), { status: 200, headers: corsHeaders })
      }
      let declinerName = 'A friend'
      if (decliner_id) {
        const { data: dp } = await supabase
          .from('profiles').select('username').eq('id', decliner_id).maybeSingle()
        if (dp?.username) declinerName = dp.username
      }
      const result = await sendIfOptedIn(supabase, creator_id, 'rungles', 'invite_declined', {
        title: 'Rungles',
        body: declineBody(declinerName, '🪜'),
        tag: `rungles-declined-${game_id}`,
        url: `/rungles/`,
        icon: '/rungles/favicon.svg',
      })
      return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
    }

    // ── opponent_joined: rg_players AFTER INSERT trigger ────────
    if (payload.type === 'opponent_joined') {
      const { game_id, joiner_id, creator_id } = payload
      if (!game_id || !joiner_id || !creator_id) {
        return new Response(JSON.stringify({ skipped: 'missing fields' }), { status: 200, headers: corsHeaders })
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', joiner_id)
        .maybeSingle()
      const joinerName = profile?.username ?? 'Someone'

      const result = await sendIfOptedIn(supabase, creator_id, 'rungles', 'opponent_joined', {
        title: 'Rungles — opponent joined!',
        body: `${joinerName} joined your match. Time to play! 🪜`,
        tag: `rungles-join-${game_id}`,
        url: `/rungles/?game=${game_id}`,
        icon: '/rungles/favicon.svg',
      })
      return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
    }

    // ── nudge (from client) ─────────────────────────────────────
    // Client has already updated rg_games.last_nudged_at via the rg_nudge
    // RPC (which enforces cooldown + caller-in-game). This branch just
    // delivers the push to whoever's turn it currently is.
    if (payload.type === 'nudge') {
      const { game_id, nudger_name } = payload

      const { data: game } = await supabase
        .from('rg_games')
        .select('current_player_idx, status')
        .eq('id', game_id)
        .single()

      if (!game || game.status !== 'active') {
        return new Response(JSON.stringify({ skipped: 'game not active' }), { status: 200, headers: corsHeaders })
      }

      const { data: currentPlayer } = await supabase
        .from('rg_players')
        .select('user_id')
        .eq('game_id', game_id)
        .eq('player_idx', game.current_player_idx)
        .single()

      if (!currentPlayer) {
        return new Response(JSON.stringify({ skipped: 'player not found' }), { status: 200, headers: corsHeaders })
      }

      const result = await sendIfOptedIn(supabase, currentPlayer.user_id, 'rungles', 'nudge', {
        title: "Rungles — it's your turn!",
        body: `${nudger_name || 'Someone'} is waiting for your move! 🔔`,
        tag: `rungles-nudge-${game_id}`,
        url: `/rungles/?game=${game_id}`,
        icon: '/rungles/favicon.svg',
      })

      return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
    }

    // ── turn_change (from rg_games DB trigger) ──────────────────
    const { record, old_record } = payload

    if (!record || record.status !== 'active') {
      return new Response(JSON.stringify({ skipped: 'game not active' }), { status: 200, headers: corsHeaders })
    }
    if (old_record && record.current_player_idx === old_record.current_player_idx) {
      return new Response(JSON.stringify({ skipped: 'turn did not change' }), { status: 200, headers: corsHeaders })
    }

    const gameId           = record.id
    const currentPlayerIdx = record.current_player_idx

    // Who's up now?
    const { data: currentPlayer, error: playerErr } = await supabase
      .from('rg_players')
      .select('user_id')
      .eq('game_id', gameId)
      .eq('player_idx', currentPlayerIdx)
      .single()

    if (playerErr || !currentPlayer) {
      return new Response(JSON.stringify({ skipped: 'player not found' }), { status: 200, headers: corsHeaders })
    }

    // Who just moved? (optional — for nicer wording)
    let moverName = 'Opponent'
    if (old_record && old_record.current_player_idx != null) {
      const { data: mover } = await supabase
        .from('rg_players')
        .select('user_id')
        .eq('game_id', gameId)
        .eq('player_idx', old_record.current_player_idx)
        .single()
      if (mover) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', mover.user_id)
          .single()
        if (profile?.username) moverName = profile.username
      }
    }

    const result = await sendIfOptedIn(supabase, currentPlayer.user_id, 'rungles', 'your_turn', {
      title: 'Rungles — your turn!',
      body: `${moverName} played. Your move! 🪜`,
      tag: `rungles-turn-${gameId}`,
      url: `/rungles/?game=${gameId}`,
      icon: '/rungles/favicon.svg',
    })

    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
  } catch (err: any) {
    console.error('Rungles push notification error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders })
  }
})
