// Shared private Broadcast-from-database channels (see
// supabase/realtime_broadcast.sql). supabase-js reuses a channel object per
// topic and refuses new .on() calls after subscribe(), so several consumers of
// one topic (lobby list + finish toasts; waiting room -> active match) share a
// single ref-counted channel that fans 'change' payloads out to listeners.
import { supabase } from './supabase.js'

const entries = new Map() // topic -> { channel, listeners:Set, timer }
const GRACE_MS = 1500     // keep an idle channel briefly so status flips reuse it

// Returns a handle; pass it to unsubscribeTopic().
export function subscribeTopic(topic, listener) {
  let e = entries.get(topic)
  if (e?.timer) { clearTimeout(e.timer); e.timer = null }
  if (!e) {
    const listeners = new Set()
    const channel = supabase
      .channel(topic, { config: { private: true } })
      .on('broadcast', { event: 'change' }, ({ payload }) => {
        for (const l of [...listeners]) {
          try { l(payload) } catch (err) { console.error('realtime listener failed:', err) }
        }
      })
      .subscribe()
    e = { channel, listeners, timer: null }
    entries.set(topic, e)
  }
  e.listeners.add(listener)
  return { topic, listener }
}

export function unsubscribeTopic(handle) {
  if (!handle) return
  const e = entries.get(handle.topic)
  if (!e) return
  e.listeners.delete(handle.listener)
  if (e.listeners.size === 0 && !e.timer) {
    e.timer = setTimeout(() => {
      if (e.listeners.size === 0 && entries.get(handle.topic) === e) {
        entries.delete(handle.topic)
        supabase.removeChannel(e.channel)
      }
    }, GRACE_MS)
  }
}
