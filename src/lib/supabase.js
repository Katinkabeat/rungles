// Supabase client for Rungles. Same project as Wordy — accounts are shared.
// The anon key is public-by-design (browser-bundled); RLS protects data.

import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = 'https://yyhewndblruwxsrqzart.supabase.co'
export const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON)

// Detects a fetch-layer failure as opposed to a server-returned error.
// On iOS Safari this surfaces as "Load failed"; on Chrome as "Failed to
// fetch". postgrest-js v2 catches the underlying TypeError and repackages
// it as a plain object whose .message starts with "FetchError:" — so we
// match on the message string rather than relying on `instanceof TypeError`.
function isNetworkFail(e) {
  return e instanceof TypeError
    || /load failed|failed to fetch|fetcherror|networkerror/i.test(e?.message ?? '')
}

// Retry an RPC once on network-layer failure. Server errors (bad word, not
// your turn, etc.) come back through the normal `error` channel and are NOT
// retried. Mitigates an iOS Safari issue where the first action after the
// app wakes up (push notification, foreground after backgrounding) can race
// against the realtime websocket handshake or supabase auth-token refresh
// and get killed by the OS at the network layer.
//
// Inspects BOTH thrown exceptions and the returned { error } object — because
// postgrest-js v2 wraps fetch failures into the latter rather than throwing.
export async function rpcWithRetry(fn) {
  try {
    const result = await fn()
    if (result?.error && isNetworkFail(result.error)) {
      await new Promise(r => setTimeout(r, 400))
      return await fn()
    }
    return result
  } catch (e) {
    if (isNetworkFail(e)) {
      await new Promise(r => setTimeout(r, 400))
      return await fn()
    }
    throw e
  }
}
