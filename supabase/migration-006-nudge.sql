-- =====================================================================
-- Rungles migration 004: turn timestamps + nudge ("reminder") feature
--
-- Mirrors Wordy's nudge: when an active game's current_player_idx hasn't
-- changed in >12h, the off-turn opponent can press 🔔 to send a push
-- "It's your turn!" reminder. Cooldown is 12h between nudges per game.
--
-- Additive: only ALTERs rg_games (new nullable columns) and CREATEs a new
-- RPC. Re-running is safe.
--
-- HOW TO RUN: paste into Supabase → SQL Editor → New Query. If the
-- preprocessor balks at the function body, run PARTs 1 and 2 separately.
-- =====================================================================

-- ----- PART 1: schema -----

ALTER TABLE rg_games
  ADD COLUMN IF NOT EXISTS turn_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_nudged_at  timestamptz;

-- Backfill turn_started_at on existing active games. Without this they'd
-- look like a brand-new turn (NULL → "0h ago") and never become nudgeable.
UPDATE rg_games
   SET turn_started_at = now()
 WHERE status = 'active' AND turn_started_at IS NULL;

-- Update the turn-advancing RPCs to stamp turn_started_at whenever
-- current_player_idx changes. Same SECURITY DEFINER bodies as before, just
-- with an extra column written.

-- ----- PART 2: rg_join_game (sets turn_started_at when game activates) -----

CREATE OR REPLACE FUNCTION rg_join_game(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $rg_join$
DECLARE
  v_user_id uuid := auth.uid();
  v_player_count int;
  v_max int;
  v_rack text[];
  v_bag text[];
  v_first_player int;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT max_players INTO v_max
    FROM rg_games
    WHERE id = p_game_id AND status = 'waiting'
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'game not available to join'; END IF;

  IF EXISTS (SELECT 1 FROM rg_players WHERE game_id = p_game_id AND user_id = v_user_id) THEN
    RAISE EXCEPTION 'already joined this game';
  END IF;

  SELECT count(*) INTO v_player_count FROM rg_players WHERE game_id = p_game_id;
  IF v_player_count >= v_max THEN RAISE EXCEPTION 'game is full'; END IF;

  SELECT tile_bag INTO v_bag FROM rg_game_secrets WHERE game_id = p_game_id FOR UPDATE;
  v_rack := v_bag[1:7];
  v_bag := v_bag[8:array_length(v_bag, 1)];

  INSERT INTO rg_players (game_id, user_id, player_idx)
    VALUES (p_game_id, v_user_id, v_player_count);
  INSERT INTO rg_racks (game_id, user_id, rack)
    VALUES (p_game_id, v_user_id, v_rack);
  UPDATE rg_game_secrets SET tile_bag = v_bag WHERE game_id = p_game_id;

  IF v_player_count + 1 >= v_max THEN
    v_first_player := floor(random() * v_max)::int;
    UPDATE rg_games
      SET status = 'active',
          current_player_idx = v_first_player,
          turn_started_at = now()
      WHERE id = p_game_id;
  END IF;
END;
$rg_join$;

-- ----- PART 3: rg_submit_rung (stamp turn_started_at on turn advance) -----

CREATE OR REPLACE FUNCTION rg_submit_rung(
  p_game_id uuid,
  p_word text,
  p_word_sources int[]
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
AS $rg_submit$
DECLARE
  v_user_id uuid := auth.uid();
  v_player_idx int;
  v_game rg_games%ROWTYPE;
  v_rack text[];
  v_rack_len int;
  v_new_rack text[];
  v_bag text[];
  v_draw_count int;
  v_next_rung_num int;
  v_next_turn int;
  v_winner int;
  v_word text;
  v_word_len int;
  v_prev_word text;
  v_prev_pool text[];
  v_used_rack_indices int[] := ARRAY[]::int[];
  v_blank_positions int[] := ARRAY[]::int[];
  v_carried_count int := 0;
  v_premium_pos int;
  v_score int := 0;
  v_letter text;
  v_letter_val int;
  v_rack_idx int;
  v_rack_tile text;
  v_pos int;
  v_idx int;
  i int;
BEGIN
  v_word := upper(p_word);
  v_word_len := length(v_word);

  IF v_word_len < 4 THEN
    RAISE EXCEPTION 'word must be at least 4 letters';
  END IF;
  IF COALESCE(array_length(p_word_sources, 1), 0) <> v_word_len THEN
    RAISE EXCEPTION 'word_sources length (%) must match word length (%)',
      COALESCE(array_length(p_word_sources, 1), 0), v_word_len;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM rg_words WHERE word = v_word) THEN
    RAISE EXCEPTION '% is not in the dictionary', v_word;
  END IF;

  SELECT * INTO v_game FROM rg_games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND OR v_game.status <> 'active' THEN RAISE EXCEPTION 'game not active'; END IF;

  SELECT player_idx INTO v_player_idx
    FROM rg_players WHERE game_id = p_game_id AND user_id = v_user_id;
  IF v_player_idx IS NULL THEN RAISE EXCEPTION 'not a player in this game'; END IF;
  IF v_player_idx <> v_game.current_player_idx THEN RAISE EXCEPTION 'not your turn'; END IF;

  SELECT rack INTO v_rack
    FROM rg_racks WHERE game_id = p_game_id AND user_id = v_user_id FOR UPDATE;
  v_rack_len := COALESCE(array_length(v_rack, 1), 0);

  SELECT count(*) + 1 INTO v_next_rung_num FROM rg_rungs WHERE game_id = p_game_id;

  IF v_next_rung_num > 1 THEN
    SELECT word INTO v_prev_word FROM rg_rungs
      WHERE game_id = p_game_id AND rung_number = v_next_rung_num - 1;
  ELSE
    v_prev_word := v_game.seed_word;
  END IF;
  v_prev_pool := string_to_array(v_prev_word, NULL);

  FOR v_pos IN 1..v_word_len LOOP
    v_letter := substr(v_word, v_pos, 1);
    v_rack_idx := p_word_sources[v_pos];

    IF v_rack_idx = 0 THEN
      v_idx := array_position(v_prev_pool, v_letter);
      IF v_idx IS NULL THEN
        RAISE EXCEPTION 'letter % at position % not available from %',
          v_letter, v_pos,
          CASE WHEN v_next_rung_num = 1 THEN 'the seed word' ELSE 'the previous rung' END;
      END IF;
      v_prev_pool[v_idx] := NULL;
      v_carried_count := v_carried_count + 1;
    ELSE
      IF v_rack_idx < 1 OR v_rack_idx > v_rack_len THEN
        RAISE EXCEPTION 'rack index % out of range (rack size %)', v_rack_idx, v_rack_len;
      END IF;
      IF v_rack_idx = ANY(v_used_rack_indices) THEN
        RAISE EXCEPTION 'rack index % used more than once', v_rack_idx;
      END IF;
      v_rack_tile := upper(v_rack[v_rack_idx]);
      IF v_rack_tile <> v_letter AND v_rack_tile <> '_' THEN
        RAISE EXCEPTION 'rack tile % at index % cannot supply letter %',
          v_rack_tile, v_rack_idx, v_letter;
      END IF;
      v_used_rack_indices := array_append(v_used_rack_indices, v_rack_idx);
      IF v_rack_tile = '_' THEN
        v_blank_positions := array_append(v_blank_positions, v_pos);
      END IF;
    END IF;
  END LOOP;

  IF v_carried_count < 3 THEN
    RAISE EXCEPTION 'rung % requires at least 3 carried letters from %, got %',
      v_next_rung_num,
      CASE WHEN v_next_rung_num = 1 THEN 'the seed word' ELSE 'the previous rung' END,
      v_carried_count;
  END IF;

  v_premium_pos := rg_premium_pos(p_game_id, v_next_rung_num);

  FOR v_pos IN 1..v_word_len LOOP
    IF p_word_sources[v_pos] <> 0 AND NOT (v_pos = ANY(v_blank_positions)) THEN
      v_letter := substr(v_word, v_pos, 1);
      v_letter_val := rg_letter_value(v_letter);
      IF v_pos = v_premium_pos THEN
        v_letter_val := v_letter_val * 2;
      END IF;
      v_score := v_score + v_letter_val;
    END IF;
  END LOOP;

  IF v_word_len > 4 THEN
    v_score := v_score + (v_word_len - 4) * 2;
  END IF;

  v_new_rack := ARRAY[]::text[];
  FOR i IN 1..v_rack_len LOOP
    IF NOT (i = ANY(v_used_rack_indices)) THEN
      v_new_rack := array_append(v_new_rack, v_rack[i]);
    END IF;
  END LOOP;

  v_draw_count := 7 - COALESCE(array_length(v_new_rack, 1), 0);
  IF v_draw_count > 0 THEN
    SELECT tile_bag INTO v_bag FROM rg_game_secrets WHERE game_id = p_game_id FOR UPDATE;
    IF COALESCE(array_length(v_bag, 1), 0) >= v_draw_count THEN
      v_new_rack := v_new_rack || v_bag[1:v_draw_count];
      v_bag := v_bag[(v_draw_count + 1):array_length(v_bag, 1)];
    ELSE
      v_new_rack := v_new_rack || COALESCE(v_bag, ARRAY[]::text[]);
      v_bag := ARRAY[]::text[];
    END IF;
    UPDATE rg_game_secrets SET tile_bag = v_bag WHERE game_id = p_game_id;
  END IF;

  UPDATE rg_racks SET rack = v_new_rack
    WHERE game_id = p_game_id AND user_id = v_user_id;

  INSERT INTO rg_rungs
    (game_id, rung_number, player_idx, player_user_id, word, rung_score, premium_pos, blank_positions)
  VALUES
    (p_game_id, v_next_rung_num, v_player_idx, v_user_id, v_word, v_score, v_premium_pos, v_blank_positions);

  UPDATE rg_players SET score = score + v_score
    WHERE game_id = p_game_id AND user_id = v_user_id;

  v_next_turn := (v_player_idx + 1) % v_game.max_players;

  IF v_next_rung_num >= v_game.total_rungs THEN
    SELECT player_idx INTO v_winner
      FROM rg_players WHERE game_id = p_game_id ORDER BY score DESC LIMIT 1;
    UPDATE rg_games SET
      status = 'complete',
      current_player_idx = NULL,
      finished_at = now(),
      consecutive_skips = 0,
      winner_player_idx = v_winner
      WHERE id = p_game_id;
  ELSE
    UPDATE rg_games SET
      current_player_idx = v_next_turn,
      consecutive_skips = 0,
      turn_started_at = now()
      WHERE id = p_game_id;
  END IF;

  RETURN v_score;
END;
$rg_submit$;

-- ----- PART 4: rg_skip_turn (stamp turn_started_at on turn advance) -----

CREATE OR REPLACE FUNCTION rg_skip_turn(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $rg_skip$
DECLARE
  v_user_id uuid := auth.uid();
  v_player_idx int;
  v_game rg_games%ROWTYPE;
  v_next_turn int;
  v_winner int;
BEGIN
  SELECT * INTO v_game FROM rg_games WHERE id = p_game_id FOR UPDATE;
  IF v_game.status <> 'active' THEN RAISE EXCEPTION 'game not active'; END IF;

  SELECT player_idx INTO v_player_idx
    FROM rg_players WHERE game_id = p_game_id AND user_id = v_user_id;
  IF v_player_idx IS NULL THEN RAISE EXCEPTION 'not a player in this game'; END IF;
  IF v_player_idx <> v_game.current_player_idx THEN RAISE EXCEPTION 'not your turn'; END IF;

  v_next_turn := (v_player_idx + 1) % v_game.max_players;

  IF v_game.consecutive_skips + 1 >= v_game.max_players THEN
    SELECT player_idx INTO v_winner
      FROM rg_players WHERE game_id = p_game_id ORDER BY score DESC LIMIT 1;
    UPDATE rg_games SET
      status = 'complete',
      current_player_idx = NULL,
      finished_at = now(),
      consecutive_skips = v_game.consecutive_skips + 1,
      winner_player_idx = v_winner
      WHERE id = p_game_id;
  ELSE
    UPDATE rg_games SET
      current_player_idx = v_next_turn,
      consecutive_skips = v_game.consecutive_skips + 1,
      turn_started_at = now()
      WHERE id = p_game_id;
  END IF;
END;
$rg_skip$;

-- ----- PART 5: rg_nudge RPC -----
-- Server-side cooldown anchor + caller-must-be-in-game check.
-- Client follows this with a fire-and-forget POST to the edge function
-- to actually deliver the push notification.

CREATE OR REPLACE FUNCTION rg_nudge(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $rg_nudge$
DECLARE
  v_user_id uuid := auth.uid();
  v_game rg_games%ROWTYPE;
  v_player_idx int;
  v_cooldown interval := interval '12 hours';
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO v_game FROM rg_games WHERE id = p_game_id FOR UPDATE;
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

  UPDATE rg_games SET last_nudged_at = now() WHERE id = p_game_id;
END;
$rg_nudge$;

GRANT EXECUTE ON FUNCTION rg_nudge(uuid) TO authenticated;
