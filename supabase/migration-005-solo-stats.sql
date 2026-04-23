-- migration-005-solo-stats.sql
-- Persists one row per solo game ended (completed or given up) so we can
-- power a personal stats view now and a cross-account leaderboard later.

CREATE TABLE IF NOT EXISTS rg_solo_games (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  total_score      int         NOT NULL,
  rungs_completed  int         NOT NULL,   -- how many rungs submitted (0..7)
  gave_up          boolean     NOT NULL DEFAULT false,
  best_word        text,                   -- word with highest rung score (null if no rungs played)
  best_rung_score  int,                    -- its score (null if no rungs played)
  played_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rg_solo_games_user_played_idx
  ON rg_solo_games (user_id, played_at DESC);

CREATE INDEX IF NOT EXISTS rg_solo_games_score_idx
  ON rg_solo_games (total_score DESC);

ALTER TABLE rg_solo_games ENABLE ROW LEVEL SECURITY;

-- Each user can insert their own rows only.
CREATE POLICY rg_solo_games_insert_own ON rg_solo_games
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- All authenticated users can read all rows (needed for the cross-account
-- leaderboard in Phase 2; harmless for Phase 1 since the "Me" tab just
-- filters by user_id anyway).
CREATE POLICY rg_solo_games_select_all ON rg_solo_games
  FOR SELECT TO authenticated
  USING (true);
