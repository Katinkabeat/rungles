-- =====================================================================
-- Rungles migration 019: game-end push (c188)
--
-- GAP: the only push trigger fires on a turn change (status still 'active').
-- A claim / give-up sets status='complete', so the loser (or surprise winner)
-- never got a push. This adds the missing game-end push, matching the unified
-- SQ contract (end_reason marker + AFTER UPDATE trigger + edge-fn handler).
--
-- Also fixes rg_give_up to record forfeit_user_id (it previously set only the
-- winner), so the edge fn can identify who gave up.
--
-- Additive + idempotent. HOW TO RUN: paste into Supabase → SQL Editor.
-- =====================================================================

-- ── 1. End-reason marker ──────────────────────────────────────
ALTER TABLE rg_games
  ADD COLUMN IF NOT EXISTS end_reason TEXT;

-- ── 2. rg_claim_inactive_win stamps end_reason='claim' ────────
CREATE OR REPLACE FUNCTION rg_claim_inactive_win(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
  v_user_id      uuid := auth.uid();
  v_my_idx       int;
  v_cur_idx      int;
  v_turn_started timestamptz;
  v_stalled_user uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT current_player_idx, turn_started_at
    INTO v_cur_idx, v_turn_started
    FROM rg_games
    WHERE id = p_game_id AND status = 'active'
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'game not active'; END IF;

  SELECT player_idx INTO v_my_idx
    FROM rg_players WHERE game_id = p_game_id AND user_id = v_user_id;
  IF v_my_idx IS NULL THEN RAISE EXCEPTION 'not a player in this game'; END IF;

  IF v_my_idx = v_cur_idx THEN
    RAISE EXCEPTION 'it is your turn — you cannot claim';
  END IF;
  IF v_turn_started IS NULL OR v_turn_started > now() - interval '7 days' THEN
    RAISE EXCEPTION 'opponent still has time';
  END IF;

  SELECT user_id INTO v_stalled_user
    FROM rg_players WHERE game_id = p_game_id AND player_idx = v_cur_idx;

  UPDATE rg_games SET
    status             = 'complete',
    current_player_idx = NULL,
    finished_at        = now(),
    winner_player_idx  = v_my_idx,
    forfeit_user_id    = v_stalled_user,
    end_reason         = 'claim'
    WHERE id = p_game_id AND status = 'active';
END;
$func$;

GRANT EXECUTE ON FUNCTION rg_claim_inactive_win(uuid) TO authenticated;

-- ── 3. rg_give_up records the forfeiter + end_reason='forfeit' ─
CREATE OR REPLACE FUNCTION rg_give_up(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
  v_user_id uuid := auth.uid();
  v_player_idx int;
  v_opponent_idx int;
BEGIN
  SELECT player_idx INTO v_player_idx
    FROM rg_players WHERE game_id = p_game_id AND user_id = v_user_id;
  IF v_player_idx IS NULL THEN RAISE EXCEPTION 'not a player in this game'; END IF;

  SELECT player_idx INTO v_opponent_idx
    FROM rg_players WHERE game_id = p_game_id AND player_idx <> v_player_idx LIMIT 1;

  UPDATE rg_games SET
    status = 'complete',
    current_player_idx = NULL,
    finished_at = now(),
    winner_player_idx = v_opponent_idx,
    forfeit_user_id = v_user_id,
    end_reason = 'forfeit'
    WHERE id = p_game_id AND status = 'active';
END;
$func$;

GRANT EXECUTE ON FUNCTION rg_give_up(uuid) TO authenticated;

-- ── 4. Game-end push trigger ──────────────────────────────────
-- Fires only on a claim/forfeit finish (end_reason set). Normal completion
-- and admin-close leave end_reason NULL, so they stay silent.
CREATE OR REPLACE FUNCTION public.rg_notify_game_finished()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/rungles-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'type', 'game_finished',
        'record', row_to_json(NEW)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Rungles game-end push trigger failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_rg_game_finished ON rg_games;
CREATE TRIGGER on_rg_game_finished
AFTER UPDATE ON rg_games
FOR EACH ROW
WHEN (OLD.status = 'active' AND NEW.status = 'complete' AND NEW.end_reason IS NOT NULL)
EXECUTE FUNCTION public.rg_notify_game_finished();
