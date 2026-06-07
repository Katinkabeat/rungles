-- =====================================================================
-- Rungles migration 018: claim-inactive-win
--
-- Lets the off-turn player end a match that's been stalled on an inactive
-- opponent for 7+ days, claiming the win — matching Yahdle/Snibble/Wordy.
--
-- Reuses the existing rg_games.turn_started_at (added in the nudge
-- migration, stamped on every turn advance) as the inactivity clock, so no
-- schema change is needed. The stalled current player is recorded as the
-- forfeiter; the caller becomes the winner — same end-state shape as
-- rg_give_up, just initiated by the opponent.
--
-- Additive: one new RPC. Safe to re-run.
--
-- HOW TO RUN: paste into Supabase → SQL Editor → New Query.
-- =====================================================================

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

  -- The stalled current player forfeits; the caller wins. Same end-state
  -- as rg_give_up (status complete, current_player_idx NULL, forfeit row).
  SELECT user_id INTO v_stalled_user
    FROM rg_players WHERE game_id = p_game_id AND player_idx = v_cur_idx;

  UPDATE rg_games SET
    status             = 'complete',
    current_player_idx = NULL,
    finished_at        = now(),
    winner_player_idx  = v_my_idx,
    forfeit_user_id    = v_stalled_user
    WHERE id = p_game_id AND status = 'active';
END;
$func$;

GRANT EXECUTE ON FUNCTION rg_claim_inactive_win(uuid) TO authenticated;
