-- =====================================================================
-- Rungles — initial multiplayer schema
--
-- Run this in the Wordy Supabase SQL editor (same project reused).
-- Idempotent: re-running drops existing rg_* objects and recreates them.
-- Every mutation goes through a SECURITY DEFINER RPC so the shared tile
-- bag stays hidden from clients, and the per-player rack stays private.
-- =====================================================================

BEGIN;

-- ---- Clean up if re-running ------------------------------------------
DROP FUNCTION IF EXISTS rg_create_game CASCADE;
DROP FUNCTION IF EXISTS rg_join_game CASCADE;
DROP FUNCTION IF EXISTS rg_submit_rung CASCADE;
DROP FUNCTION IF EXISTS rg_skip_turn CASCADE;
DROP FUNCTION IF EXISTS rg_give_up CASCADE;
DROP FUNCTION IF EXISTS rg_make_bag CASCADE;
DROP FUNCTION IF EXISTS rg_letter_value CASCADE;
DROP FUNCTION IF EXISTS rg_premium_pos CASCADE;

DROP TABLE IF EXISTS rg_rungs CASCADE;
DROP TABLE IF EXISTS rg_racks CASCADE;
DROP TABLE IF EXISTS rg_players CASCADE;
DROP TABLE IF EXISTS rg_game_secrets CASCADE;
DROP TABLE IF EXISTS rg_games CASCADE;
-- rg_words is intentionally NOT dropped: re-running the migration shouldn't
-- wipe the loaded dictionary. CREATE TABLE below uses IF NOT EXISTS.

-- ---- Tables ----------------------------------------------------------

CREATE TABLE rg_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'active', 'complete')),
  max_players int NOT NULL DEFAULT 2,
  total_rungs int NOT NULL DEFAULT 10,
  current_player_idx int,
  consecutive_skips int NOT NULL DEFAULT 0,
  winner_player_idx int,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX rg_games_status_idx ON rg_games(status);

-- Tile bag lives in its own table, locked down — no client SELECT policy.
CREATE TABLE rg_game_secrets (
  game_id uuid PRIMARY KEY REFERENCES rg_games(id) ON DELETE CASCADE,
  tile_bag text[] NOT NULL
);

CREATE TABLE rg_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES rg_games(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  player_idx int NOT NULL,
  score int NOT NULL DEFAULT 0,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, user_id),
  UNIQUE (game_id, player_idx)
);
CREATE INDEX rg_players_game_idx ON rg_players(game_id);

-- Per-player rack, locked to the owning user via RLS.
CREATE TABLE rg_racks (
  game_id uuid NOT NULL REFERENCES rg_games(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  rack text[] NOT NULL,
  PRIMARY KEY (game_id, user_id)
);

CREATE TABLE rg_rungs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES rg_games(id) ON DELETE CASCADE,
  rung_number int NOT NULL,
  player_idx int NOT NULL,
  player_user_id uuid NOT NULL REFERENCES auth.users(id),
  word text NOT NULL,
  rung_score int NOT NULL,
  premium_pos int,
  -- 1-based positions in `word` that were originally blank tiles. Lets the UI
  -- render them differently (lowercase / marked) and makes "blanks score 0"
  -- auditable after the fact.
  blank_positions int[] NOT NULL DEFAULT ARRAY[]::int[],
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, rung_number)
);
CREATE INDEX rg_rungs_game_idx ON rg_rungs(game_id);

-- Dictionary table. NOT dropped on re-run (see note above). Loaded separately
-- via `\copy rg_words FROM 'words.txt'` (see rungles/supabase/load-words.md).
CREATE TABLE IF NOT EXISTS rg_words (
  word text PRIMARY KEY
);

-- ---- Row-level security ---------------------------------------------

ALTER TABLE rg_games         ENABLE ROW LEVEL SECURITY;
ALTER TABLE rg_game_secrets  ENABLE ROW LEVEL SECURITY;
ALTER TABLE rg_players       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rg_racks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE rg_rungs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE rg_words         ENABLE ROW LEVEL SECURITY;

-- rg_games: any authenticated user can see; writes only via RPC (SECURITY DEFINER).
CREATE POLICY "games_select_all" ON rg_games
  FOR SELECT TO authenticated USING (true);

-- rg_game_secrets: no client policy at all — RPCs are SECURITY DEFINER and bypass RLS.

-- rg_players: visible to any authenticated user (both players see each other's scores).
CREATE POLICY "players_select_all" ON rg_players
  FOR SELECT TO authenticated USING (true);

-- rg_racks: only the owner can SELECT.
CREATE POLICY "racks_select_own" ON rg_racks
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- rg_rungs: visible to all authenticated users.
CREATE POLICY "rungs_select_all" ON rg_rungs
  FOR SELECT TO authenticated USING (true);

-- rg_words: readable by any authenticated user (clients can use it for
-- autocomplete / hint generation). Writes only via direct DB access.
DROP POLICY IF EXISTS "words_select_all" ON rg_words;
CREATE POLICY "words_select_all" ON rg_words
  FOR SELECT TO authenticated USING (true);

-- ---- Scoring helpers -------------------------------------------------

-- Standard Scrabble letter values. Blank ('_') scores 0.
CREATE OR REPLACE FUNCTION rg_letter_value(p_letter text)
RETURNS int
LANGUAGE sql IMMUTABLE
AS $func$
  SELECT CASE upper(p_letter)
    WHEN 'A' THEN 1  WHEN 'B' THEN 3  WHEN 'C' THEN 3  WHEN 'D' THEN 2
    WHEN 'E' THEN 1  WHEN 'F' THEN 4  WHEN 'G' THEN 2  WHEN 'H' THEN 4
    WHEN 'I' THEN 1  WHEN 'J' THEN 8  WHEN 'K' THEN 5  WHEN 'L' THEN 1
    WHEN 'M' THEN 3  WHEN 'N' THEN 1  WHEN 'O' THEN 1  WHEN 'P' THEN 3
    WHEN 'Q' THEN 10 WHEN 'R' THEN 1  WHEN 'S' THEN 1  WHEN 'T' THEN 1
    WHEN 'U' THEN 1  WHEN 'V' THEN 4  WHEN 'W' THEN 4  WHEN 'X' THEN 8
    WHEN 'Y' THEN 4  WHEN 'Z' THEN 10 WHEN '_' THEN 0
    ELSE 0
  END
$func$;

-- Deterministic premium position (1..7) per (game, rung). Client can call this
-- to render the premium slot before the player submits; server uses the same
-- formula at submit time so the client can't move it under a high-value tile.
CREATE OR REPLACE FUNCTION rg_premium_pos(p_game_id uuid, p_rung_number int)
RETURNS int
LANGUAGE sql IMMUTABLE
AS $func$
  SELECT 1 + (abs(hashtext(p_game_id::text || ':' || p_rung_number::text)) % 7);
$func$;

-- ---- Tile bag helper -------------------------------------------------

CREATE OR REPLACE FUNCTION rg_make_bag()
RETURNS text[]
LANGUAGE plpgsql
AS $func$
DECLARE
  v_bag text[] := ARRAY[]::text[];
  v_counts jsonb := '{
    "A":9,"B":2,"C":2,"D":4,"E":12,"F":2,"G":3,"H":2,"I":9,"J":1,
    "K":1,"L":4,"M":2,"N":6,"O":8,"P":2,"Q":1,"R":6,"S":4,"T":6,
    "U":4,"V":2,"W":2,"X":1,"Y":2,"Z":1,"_":2
  }'::jsonb;
  v_letter text;
  v_count int;
  i int;
BEGIN
  FOR v_letter, v_count IN SELECT * FROM jsonb_each_text(v_counts) LOOP
    FOR i IN 1..v_count::int LOOP
      v_bag := array_append(v_bag, v_letter);
    END LOOP;
  END LOOP;
  SELECT array_agg(x ORDER BY random()) INTO v_bag FROM unnest(v_bag) x;
  RETURN v_bag;
END;
$func$;

-- ---- RPCs -------------------------------------------------------------

-- Create a new game. Caller becomes player 0.
CREATE OR REPLACE FUNCTION rg_create_game(p_total_rungs int DEFAULT 10)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
  v_game_id uuid;
  v_bag text[];
  v_rack text[];
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  v_bag := rg_make_bag();
  v_rack := v_bag[1:7];
  v_bag := v_bag[8:array_length(v_bag, 1)];

  INSERT INTO rg_games (created_by, total_rungs, max_players, status)
  VALUES (v_user_id, p_total_rungs, 2, 'waiting')
  RETURNING id INTO v_game_id;

  INSERT INTO rg_game_secrets (game_id, tile_bag) VALUES (v_game_id, v_bag);
  INSERT INTO rg_players (game_id, user_id, player_idx) VALUES (v_game_id, v_user_id, 0);
  INSERT INTO rg_racks (game_id, user_id, rack) VALUES (v_game_id, v_user_id, v_rack);

  RETURN v_game_id;
END;
$func$;

-- Join a waiting game. Starts the game if full.
CREATE OR REPLACE FUNCTION rg_join_game(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
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
      SET status = 'active', current_player_idx = v_first_player
      WHERE id = p_game_id;
  END IF;
END;
$func$;

-- Submit a rung. Client provides the word and a per-position source map:
--   p_word_sources[i] = 0  → letter at position i was carried from previous rung
--   p_word_sources[i] = N  → letter at position i came from rack tile N (1-based)
-- Server validates the layout against the rack + previous rung, computes the
-- score from scratch (rack letters only, premium 2× on newly-played tiles,
-- length bonus +2 per letter beyond 4), and returns the score.
CREATE OR REPLACE FUNCTION rg_submit_rung(
  p_game_id uuid,
  p_word text,
  p_word_sources int[]
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
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

  -- Build a mutable pool of previous-rung letters. Positions consumed for
  -- carryover get nulled out so each carried letter is only matched once.
  IF v_next_rung_num > 1 THEN
    SELECT word INTO v_prev_word FROM rg_rungs
      WHERE game_id = p_game_id AND rung_number = v_next_rung_num - 1;
    v_prev_pool := string_to_array(v_prev_word, NULL);
  ELSE
    v_prev_pool := ARRAY[]::text[];
  END IF;

  -- Validate every position in the word against rack or carried-letter pool.
  FOR v_pos IN 1..v_word_len LOOP
    v_letter := substr(v_word, v_pos, 1);
    v_rack_idx := p_word_sources[v_pos];

    IF v_rack_idx = 0 THEN
      v_idx := array_position(v_prev_pool, v_letter);
      IF v_idx IS NULL THEN
        RAISE EXCEPTION 'letter % at position % not available from previous rung', v_letter, v_pos;
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

  -- Carryover rule: rung 2+ must reuse at least 3 letters from previous rung.
  IF v_next_rung_num >= 2 AND v_carried_count < 3 THEN
    RAISE EXCEPTION 'rung % requires at least 3 carried letters (got %)',
      v_next_rung_num, v_carried_count;
  END IF;

  -- Compute score from scratch. Only newly-played (rack) tiles score, and
  -- the 2× premium only triggers when a rack tile lands on the premium slot.
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
$func$;

-- Skip your turn (no score change). If everyone skips in a row, the game ends.
CREATE OR REPLACE FUNCTION rg_skip_turn(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
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
      consecutive_skips = v_game.consecutive_skips + 1
      WHERE id = p_game_id;
  END IF;
END;
$func$;

-- Give up. Opponent wins regardless of score.
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
    winner_player_idx = v_opponent_idx
    WHERE id = p_game_id AND status = 'active';
END;
$func$;

-- ---- Grants ----------------------------------------------------------

GRANT EXECUTE ON FUNCTION rg_create_game(int)                  TO authenticated;
GRANT EXECUTE ON FUNCTION rg_join_game(uuid)                   TO authenticated;
GRANT EXECUTE ON FUNCTION rg_submit_rung(uuid, text, int[])    TO authenticated;
GRANT EXECUTE ON FUNCTION rg_skip_turn(uuid)                   TO authenticated;
GRANT EXECUTE ON FUNCTION rg_give_up(uuid)                     TO authenticated;
GRANT EXECUTE ON FUNCTION rg_letter_value(text)                TO authenticated;
GRANT EXECUTE ON FUNCTION rg_premium_pos(uuid, int)            TO authenticated;

-- ---- Realtime --------------------------------------------------------

-- Expose these tables for realtime subscriptions so clients can watch turns, scores, and rungs.
ALTER PUBLICATION supabase_realtime ADD TABLE rg_games;
ALTER PUBLICATION supabase_realtime ADD TABLE rg_players;
ALTER PUBLICATION supabase_realtime ADD TABLE rg_rungs;
ALTER PUBLICATION supabase_realtime ADD TABLE rg_racks;

COMMIT;
