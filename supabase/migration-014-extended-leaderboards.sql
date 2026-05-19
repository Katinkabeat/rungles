-- migration-014-extended-leaderboards.sql
-- ============================================================
-- Rungles — Extended solo leaderboards (card c92)
--
-- Adds two RPCs that replace the direct rg_solo_games queries that
-- statsService.fetchLeaderboard() used to do:
--   rg_solo_leaderboard(p_timeframe, p_date)  — top 10 games in window
--   rg_solo_my_rank(p_timeframe, p_date)      — caller's best game's rank
--
-- Per-game ranking (each row is one game), not per-user sums — matches
-- the existing Rungles "hall of fame" UX and the explicit card tie-break
-- `total_score DESC, played_at ASC`. A user can appear multiple times
-- in the top 10 if they have several top games in the window.
--
-- played_at is timestamptz, so the window is computed in Halifax tz and
-- converted back to timestamptz so we hit the existing
-- rg_solo_games_score_idx / rg_solo_games_user_played_idx indexes.
--
-- "Best single rung ever" stays as a separate query (it's a permanent
-- all-time badge, not window-aware).
-- ============================================================

CREATE OR REPLACE FUNCTION public.rg_solo_leaderboard(
  p_timeframe text,
  p_date      date DEFAULT current_date
)
RETURNS TABLE (
  user_id          uuid,
  username         text,
  total_score      int,
  best_word        text,
  best_rung_score  int,
  played_at        timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_start_d  date;
  v_end_d    date;
  v_start_ts timestamptz;
  v_end_ts   timestamptz;
BEGIN
  CASE p_timeframe
    WHEN 'day'   THEN v_start_d := p_date;                            v_end_d := p_date + 1;
    WHEN 'week'  THEN v_start_d := date_trunc('week',  p_date)::date; v_end_d := v_start_d + 7;
    WHEN 'month' THEN v_start_d := date_trunc('month', p_date)::date; v_end_d := (v_start_d + interval '1 month')::date;
    WHEN 'all'   THEN v_start_d := NULL;                              v_end_d := NULL;
    ELSE RAISE EXCEPTION 'Invalid p_timeframe: %', p_timeframe;
  END CASE;

  IF v_start_d IS NOT NULL THEN
    v_start_ts := (v_start_d::timestamp AT TIME ZONE 'America/Halifax');
    v_end_ts   := (v_end_d::timestamp   AT TIME ZONE 'America/Halifax');
  END IF;

  RETURN QUERY
    SELECT
      g.user_id,
      p.username,
      g.total_score,
      g.best_word,
      g.best_rung_score,
      g.played_at
    FROM public.rg_solo_games g
    JOIN public.profiles p ON p.id = g.user_id
    WHERE (v_start_ts IS NULL OR g.played_at >= v_start_ts)
      AND (v_end_ts   IS NULL OR g.played_at <  v_end_ts)
    ORDER BY g.total_score DESC, g.played_at ASC
    LIMIT 10;
END;
$$;

REVOKE ALL ON FUNCTION public.rg_solo_leaderboard(text, date) FROM public;
GRANT EXECUTE ON FUNCTION public.rg_solo_leaderboard(text, date) TO authenticated;

-- ── My rank ──────────────────────────────────────────────────
-- Returns the caller's BEST game's rank/score in the window. If the
-- caller has multiple games that would rank, the highest one is used —
-- mirrors how "your rank" reads in a per-game leaderboard.
CREATE OR REPLACE FUNCTION public.rg_solo_my_rank(
  p_timeframe text,
  p_date      date DEFAULT current_date
)
RETURNS TABLE (rank int, score int)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_start_d  date;
  v_end_d    date;
  v_start_ts timestamptz;
  v_end_ts   timestamptz;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  CASE p_timeframe
    WHEN 'day'   THEN v_start_d := p_date;                            v_end_d := p_date + 1;
    WHEN 'week'  THEN v_start_d := date_trunc('week',  p_date)::date; v_end_d := v_start_d + 7;
    WHEN 'month' THEN v_start_d := date_trunc('month', p_date)::date; v_end_d := (v_start_d + interval '1 month')::date;
    WHEN 'all'   THEN v_start_d := NULL;                              v_end_d := NULL;
    ELSE RAISE EXCEPTION 'Invalid p_timeframe: %', p_timeframe;
  END CASE;

  IF v_start_d IS NOT NULL THEN
    v_start_ts := (v_start_d::timestamp AT TIME ZONE 'America/Halifax');
    v_end_ts   := (v_end_d::timestamp   AT TIME ZONE 'America/Halifax');
  END IF;

  RETURN QUERY
    WITH ranked AS (
      SELECT
        g.user_id            AS uid,
        g.total_score        AS game_score,
        rank() OVER (ORDER BY g.total_score DESC, g.played_at ASC) AS rk
      FROM public.rg_solo_games g
      WHERE (v_start_ts IS NULL OR g.played_at >= v_start_ts)
        AND (v_end_ts   IS NULL OR g.played_at <  v_end_ts)
    )
    SELECT rk::int, game_score::int
    FROM ranked
    WHERE uid = v_uid
    ORDER BY rk ASC
    LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.rg_solo_my_rank(text, date) FROM public;
GRANT EXECUTE ON FUNCTION public.rg_solo_my_rank(text, date) TO authenticated;
