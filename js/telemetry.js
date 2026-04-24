// Fire-and-forget telemetry for Rungles.
// Writes to public.sq_events if signed in; silent no-op otherwise.
// See rae-side-quest/SQ_PHASED_PLAN.md (Phase 2) for the broader plan.

import { supabase } from './supabase-client.js';

const GAME = 'rungles';

export function logEvent(event, payload = {}) {
  (async () => {
    try {
      const { data } = await supabase.auth.getUser();
      const userId = data?.user?.id;
      if (!userId) return;
      await supabase.from('sq_events').insert({
        user_id: userId,
        game: GAME,
        event,
        payload,
      });
    } catch {
      // Telemetry must never break gameplay.
    }
  })();
}
