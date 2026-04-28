-- =====================================================================
-- Rungles migration 007: end-game discoverability
--
-- Two additions, both required for the lobby "unseen results" banner +
-- toast feature (Wordy parity):
--
--   1. rg_players.dismissed_at — per-user ack of a finished game's result.
--      NULL = banner still showing for that user. Mutated only via the
--      new rg_dismiss_result RPC so it follows the project's "writes only
--      via SECURITY DEFINER" convention.
--
--   2. rg_games.forfeit_user_id — records WHICH player gave up, so the
--      lobby/end-game UI can surface "🏳️ X gave up — Y wins!" instead of
--      a generic win banner. rg_give_up is updated to populate this.
--
-- Additive: only ALTERs (with IF NOT EXISTS), CREATE OR REPLACE on RPCs,
-- and a new RPC. Safe to re-run.
--
-- HOW TO RUN: paste into Supabase → SQL Editor → New Query.
-- =====================================================================

-- ----- PART 1: schema -----

ALTER TABLE rg_players
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;

ALTER TABLE rg_games
  ADD COLUMN IF NOT EXISTS forfeit_user_id uuid REFERENCES auth.users(id);

-- ----- PART 2: rg_dismiss_result -----
-- Lets the calling user mark their own rg_players row's dismissed_at = now()
-- for a given finished game. No-op on games they're not in or already dismissed.

CREATE OR REPLACE FUNCTION rg_dismiss_result(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  UPDATE rg_players
     SET dismissed_at = now()
   WHERE game_id = p_game_id
     AND user_id = v_user_id
     AND dismissed_at IS NULL;
END;
$func$;

GRANT EXECUTE ON FUNCTION rg_dismiss_result(uuid) TO authenticated;

-- ----- PART 3: rg_give_up (patched to record forfeit_user_id) -----

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
    forfeit_user_id = v_user_id
    WHERE id = p_game_id AND status = 'active';
END;
$func$;

GRANT EXECUTE ON FUNCTION rg_give_up(uuid) TO authenticated;
