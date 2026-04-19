-- =====================================================================
-- Rungles migration 002: seed word for rung 1
--
-- Why: previously rung 1 had no carryover requirement, so the first
-- player scored on every rack tile. Rungs 2+ require 3 carried letters
-- (which don't score), so player 1 had a structural scoring advantage.
-- A per-game seed word fixes this: rung 1 must carry 3+ from the seed,
-- making rung 1 symmetric with every other rung.
--
-- Additive: does NOT drop or recreate any existing tables. Safe to run
-- on the live shared-with-Wordy database.
--
-- HOW TO RUN: the Supabase SQL editor's preprocessor occasionally trips
-- over multiple long plpgsql function bodies in one paste. If you get an
-- "unterminated dollar-quoted string" error, run the three sections
-- below as separate queries (split at the "----- PART N -----" markers).
-- =====================================================================

-- ----- PART 1: schema + backfill -----

-- ---- Schema --------------------------------------------------------

ALTER TABLE rg_games
  ADD COLUMN IF NOT EXISTS seed_word text NOT NULL DEFAULT '';

-- Backfill existing rows that don't have a seed yet. Active/complete
-- games already played their rung 1, so the value here doesn't affect
-- anything historical, but waiting games need a real seed before play.
UPDATE rg_games
   SET seed_word = (
     SELECT word FROM rg_words
     WHERE length(word) BETWEEN 4 AND 7
     ORDER BY random()
     LIMIT 1
   )
 WHERE seed_word = '';

-- ----- PART 2: rg_create_game (run separately if PART 1+2+3 together fails) -----

CREATE OR REPLACE FUNCTION rg_create_game(p_total_rungs int DEFAULT 10)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
AS $rg_create$
DECLARE
  v_game_id uuid;
  v_bag text[];
  v_rack text[];
  v_seed text;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  v_bag := rg_make_bag();
  v_rack := v_bag[1:7];
  v_bag := v_bag[8:array_length(v_bag, 1)];

  SELECT word INTO v_seed
    FROM rg_words
    WHERE length(word) BETWEEN 4 AND 7
    ORDER BY random()
    LIMIT 1;
  IF v_seed IS NULL THEN RAISE EXCEPTION 'no seed word available'; END IF;

  INSERT INTO rg_games (created_by, total_rungs, max_players, status, seed_word)
  VALUES (v_user_id, p_total_rungs, 2, 'waiting', v_seed)
  RETURNING id INTO v_game_id;

  INSERT INTO rg_game_secrets (game_id, tile_bag) VALUES (v_game_id, v_bag);
  INSERT INTO rg_players (game_id, user_id, player_idx) VALUES (v_game_id, v_user_id, 0);
  INSERT INTO rg_racks (game_id, user_id, rack) VALUES (v_game_id, v_user_id, v_rack);

  RETURN v_game_id;
END;
$rg_create$;

-- ----- PART 3: rg_submit_rung (run separately if needed) -----
-- (Body identical to migration 001 except for the carryover-source
-- block and the carryover-rule wording.)

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

  -- Carryover source: rung 1 carries from the game's seed word; rungs 2+ carry
  -- from the previous rung's word. Either way, every rung needs 3+ carried.
  IF v_next_rung_num > 1 THEN
    SELECT word INTO v_prev_word FROM rg_rungs
      WHERE game_id = p_game_id AND rung_number = v_next_rung_num - 1;
  ELSE
    v_prev_word := v_game.seed_word;
  END IF;
  v_prev_pool := string_to_array(v_prev_word, NULL);

  -- Validate every position in the word against rack or carried-letter pool.
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

  -- Carryover rule applies to every rung now (rung 1 carries from seed).
  IF v_carried_count < 3 THEN
    RAISE EXCEPTION 'rung % requires at least 3 carried letters from %, got %',
      v_next_rung_num,
      CASE WHEN v_next_rung_num = 1 THEN 'the seed word' ELSE 'the previous rung' END,
      v_carried_count;
  END IF;

  -- Compute score: rack tiles only, premium 2× on rack tiles, length bonus.
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

  -- Rebuild rack excluding consumed indices.
  v_new_rack := ARRAY[]::text[];
  FOR i IN 1..v_rack_len LOOP
    IF NOT (i = ANY(v_used_rack_indices)) THEN
      v_new_rack := array_append(v_new_rack, v_rack[i]);
    END IF;
  END LOOP;

  -- Refill from bag.
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
      consecutive_skips = 0
      WHERE id = p_game_id;
  END IF;

  RETURN v_score;
END;
$rg_submit$;
