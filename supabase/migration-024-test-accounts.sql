-- migration-024-test-accounts.sql
-- ============================================================
-- Rungles — Test Accounts group (card c332)
--
-- Members of the shared "test-accounts" group (public.sq_is_test_account /
-- public.sq_test_account_ids, already live) get two carve-outs here:
--
--   1. Solo leaderboard/rank never surface a member's result. Excluded
--      inside the per-user-best CTE in both rg_solo_leaderboard and
--      rg_solo_my_rank, so a member never occupies a rank slot (and a
--      member calling rg_solo_my_rank for themself gets an empty result —
--      that's fine, there's no rank to report).
--
--   2. The daily solo write-guard (migration-021) stays strict for
--      everyone else, but for a member it now OVERWRITES that day's row
--      instead of no-op'ing, so they can replay the daily as many times
--      as they like and have the latest run stick. played_at is bumped to
--      the write time so "latest run" is unambiguous. Membership is
--      re-checked server-side on every call (never trust the client) —
--      see SoloGamePage.jsx / soloGame.js for the client-side replay UX
--      that this backs.
--
-- Multiplayer win/loss/stats exclusion for games with a member seated
-- (rule 2) is handled entirely client-side in statsService.js
-- (fetchMyMultiplayerStats / fetchBestRungEver) — there's no server-side
-- multiplayer aggregate RPC in Rungles to patch. The platform-wide Rook
-- stats (rook_wins_by_game, rook_games_total, rook_weekly_leaderboards,
-- rook_weekly_points) already carry their own c332 exclusions and are out
-- of scope for this migration.
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
        AND NOT public.sq_is_test_account(g.user_id)  -- c332
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
        AND NOT public.sq_is_test_account(g.user_id)  -- c332: a member never
        -- occupies a rank slot; if the caller IS a member this also means
        -- `uid = v_uid` below matches nothing, so they get an empty result.
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

CREATE OR REPLACE FUNCTION public.rg_record_daily_solo(
  p_play_date       date,
  p_total_score     int,
  p_rungs_completed int,
  p_gave_up         boolean,
  p_best_word       text,
  p_best_rung_score int
)
RETURNS TABLE (counted boolean, play_day date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_today     date := (now() AT TIME ZONE 'America/Halifax')::date;
  v_is_test   boolean;
  v_inserted  int;
  v_updated   int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Past days are immutable (c237) and future days are nonsense. Note this
  -- rejects the cross-midnight finisher on purpose: their board's day is over,
  -- so the score belongs to no board we're willing to write.
  IF p_play_date <> v_today THEN
    RAISE EXCEPTION 'play_date % is not today (%); past/future writes are not allowed',
      p_play_date, v_today;
  END IF;

  -- c332: test-account members may replay the daily as many times as they
  -- like; each finished run overwrites the day's row. Everyone else keeps
  -- the one-per-day guard below unchanged. Re-checked here, server-side,
  -- on every call — the client button is convenience only.
  v_is_test := public.sq_is_test_account(v_uid);

  IF v_is_test THEN
    INSERT INTO public.rg_solo_games
      (user_id, total_score, rungs_completed, gave_up, best_word, best_rung_score, play_date, played_at)
    VALUES
      (v_uid, p_total_score, p_rungs_completed, p_gave_up, p_best_word, p_best_rung_score, v_today, now())
    ON CONFLICT (user_id, play_date) WHERE play_date IS NOT NULL DO UPDATE SET
      total_score      = EXCLUDED.total_score,
      rungs_completed  = EXCLUDED.rungs_completed,
      gave_up          = EXCLUDED.gave_up,
      best_word        = EXCLUDED.best_word,
      best_rung_score  = EXCLUDED.best_rung_score,
      played_at        = EXCLUDED.played_at;

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    RETURN QUERY SELECT (v_updated > 0), v_today;
    RETURN;
  END IF;

  INSERT INTO public.rg_solo_games
    (user_id, total_score, rungs_completed, gave_up, best_word, best_rung_score, play_date)
  VALUES
    (v_uid, p_total_score, p_rungs_completed, p_gave_up, p_best_word, p_best_rung_score, v_today)
  ON CONFLICT (user_id, play_date) WHERE play_date IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN QUERY SELECT (v_inserted > 0), v_today;
END;
$$;
