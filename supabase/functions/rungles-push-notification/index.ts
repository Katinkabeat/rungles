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

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json()
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

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

    const result = await sendPushToUser(supabase, currentPlayer.user_id, {
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
