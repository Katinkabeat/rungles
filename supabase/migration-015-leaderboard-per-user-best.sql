-- migration-015-leaderboard-per-user-best.sql
-- ============================================================
-- Rungles — Leaderboard switches from per-game to per-user-BEST (c92 polish)
--
-- Each row in the leaderboard now represents one USER's best game in
-- the window (vs. the previous per-game ranking where a single user
-- could appear multiple times). Same shape as Yahdle/Snibble — one row
-- per user — but the metric stays "best single game" rather than "sum",
-- matching Rungles' existing "best rung ever" framing and the fact that
-- Rungles allows many plays per day.
--
-- Tie-break: best-game total_score DESC, then earliest played_at ASC.
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
    WITH per_user_best AS (
      SELECT DISTINCT ON (g.user_id)
        g.user_id          AS uid,
        g.total_score      AS user_score,
        g.played_at        AS user_played_at,
        g.best_word        AS user_best_word,
        g.best_rung_score  AS user_best_rung_score
      FROM public.rg_solo_games g
      WHERE (v_start_ts IS NULL OR g.played_at >= v_start_ts)
        AND (v_end_ts   IS NULL OR g.played_at <  v_end_ts)
      ORDER BY g.user_id, g.total_score DESC, g.played_at ASC
    )
    SELECT
      pub.uid,
      p.username,
      pub.user_score,
      pub.user_best_word,
      pub.user_best_rung_score,
      pub.user_played_at
    FROM per_user_best pub
    JOIN public.profiles p ON p.id = pub.uid
    ORDER BY pub.user_score DESC, pub.user_played_at ASC
    LIMIT 10;
END;
$$;

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
    WITH per_user_best AS (
      SELECT DISTINCT ON (g.user_id)
        g.user_id      AS uid,
        g.total_score  AS user_score,
        g.played_at    AS user_played_at
      FROM public.rg_solo_games g
      WHERE (v_start_ts IS NULL OR g.played_at >= v_start_ts)
        AND (v_end_ts   IS NULL OR g.played_at <  v_end_ts)
      ORDER BY g.user_id, g.total_score DESC, g.played_at ASC
    ),
    ranked AS (
      SELECT
        uid,
        user_score,
        rank() OVER (ORDER BY user_score DESC, user_played_at ASC) AS rk
      FROM per_user_best
    )
    SELECT rk::int, user_score::int
    FROM ranked
    WHERE uid = v_uid;
END;
$$;
