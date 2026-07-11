-- c264 (c248/c260/c261 follow-up): only start the 12h nudge cooldown once the
-- push actually delivers. rg_nudge previously stamped last_nudged_at up-front
-- (validate + stamp in one RPC), so a failed push — dead subscription, timeout,
-- or a 200 { sent:false } for an unsubscribed recipient — burned the cooldown
-- and the nudger's retry then hit "already nudged recently" instead of a real
-- retry. Split into: rg_nudge (validate only) + rg_mark_nudged (stamp), and the
-- client stamps ONLY after postNudge reports delivered:true. Mirrors Yahdle's
-- yahdle_nudge / yahdle_mark_nudged split.
--
-- Re-specify SET search_path: CREATE OR REPLACE clears the SET clause that
-- secdef_hardening.sql applied, so it must be restated or the SECDEF hardening
-- silently regresses. Execute grants persist across CREATE OR REPLACE.

-- rg_nudge: validate eligibility + cooldown, but NO LONGER stamp. Stays
-- RETURNS void — the client resolves the recipient itself and the edge fn
-- derives the target from game_id, so no target uuid is returned.
CREATE OR REPLACE FUNCTION public.rg_nudge(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $rg_nudge$
DECLARE
  v_user_id uuid := auth.uid();
  v_game rg_games%ROWTYPE;
  v_player_idx int;
  v_cooldown interval := interval '12 hours';
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- Read-only now (validate does not write), so no FOR UPDATE — mirrors Yahdle.
  SELECT * INTO v_game FROM rg_games WHERE id = p_game_id;
  IF NOT FOUND OR v_game.status <> 'active' THEN
    RAISE EXCEPTION 'game not active';
  END IF;

  SELECT player_idx INTO v_player_idx
    FROM rg_players WHERE game_id = p_game_id AND user_id = v_user_id;
  IF v_player_idx IS NULL THEN RAISE EXCEPTION 'not a player in this game'; END IF;
  IF v_player_idx = v_game.current_player_idx THEN
    RAISE EXCEPTION 'cannot nudge yourself';
  END IF;
  IF v_game.turn_started_at IS NULL OR (now() - v_game.turn_started_at) < v_cooldown THEN
    RAISE EXCEPTION 'turn too fresh to nudge';
  END IF;
  IF v_game.last_nudged_at IS NOT NULL AND (now() - v_game.last_nudged_at) < v_cooldown THEN
    RAISE EXCEPTION 'already nudged recently';
  END IF;

  -- c264: stamp moved to rg_mark_nudged, called only after the push lands.
END;
$rg_nudge$;

-- rg_mark_nudged: stamp the 12h cooldown. Called by the client ONLY after the
-- nudge push has been delivered, so a failed send never burns the cooldown.
-- Re-checks the same eligibility gate (participant in an active game, not the
-- current player) so it can't be used to stamp a cooldown out of context.
CREATE OR REPLACE FUNCTION public.rg_mark_nudged(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $rg_mark_nudged$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM rg_players p
      JOIN rg_games g ON g.id = p.game_id
     WHERE p.game_id = p_game_id
       AND p.user_id = v_user_id
       AND g.status = 'active'
       AND p.player_idx <> g.current_player_idx
  ) THEN
    RAISE EXCEPTION 'not eligible to mark nudged';
  END IF;
  UPDATE rg_games SET last_nudged_at = now() WHERE id = p_game_id;
END;
$rg_mark_nudged$;

-- Match the hardened ACL rg_nudge already carries (anon/public revoked).
REVOKE EXECUTE ON FUNCTION public.rg_nudge(uuid)        FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rg_mark_nudged(uuid)  FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.rg_nudge(uuid)        TO authenticated;
GRANT  EXECUTE ON FUNCTION public.rg_mark_nudged(uuid)  TO authenticated;
