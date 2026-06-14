-- migration-020-solo-daily.sql
-- ============================================================
-- Rungles — Solo becomes a DAILY (card c215)
--
-- Solo used to allow unlimited replays. It is now a once-a-day daily
-- puzzle: one shared board per Atlantic day, exactly one scored play per
-- user per day, no practice mode.
--
-- Enforcement:
--   • `play_date` (Atlantic YYYY-MM-DD) stamped on each daily row.
--   • Partial UNIQUE index on (user_id, play_date) WHERE play_date IS NOT
--     NULL — guarantees one row per user per day going forward WITHOUT
--     touching historical free-play rows (they keep play_date = NULL, so
--     the partial index never sees them — non-destructive).
--   • rg_record_daily_solo() is the authoritative write: it computes the
--     Atlantic day server-side (clients can't spoof it) and no-ops on a
--     second submit the same day.
--
-- The existing rg_solo_leaderboard()/rg_solo_my_rank() (migration-015)
-- need no change: they already rank per-user-best in a Halifax-tz window,
-- and a daily means each user has at most one row per day anyway.
-- ============================================================

ALTER TABLE public.rg_solo_games
  ADD COLUMN IF NOT EXISTS play_date date;

-- One daily row per user per day. Partial so the pre-daily history
-- (play_date IS NULL) is left untouched and can't block the index.
CREATE UNIQUE INDEX IF NOT EXISTS rg_solo_games_user_day_uniq
  ON public.rg_solo_games (user_id, play_date)
  WHERE play_date IS NOT NULL;

-- ── Authoritative daily write ────────────────────────────────
-- Returns counted=true only on the FIRST play of the day; counted=false
-- (and the existing day) if the user already played today.
CREATE OR REPLACE FUNCTION public.rg_record_daily_solo(
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
  v_uid      uuid := auth.uid();
  v_day      date := (now() AT TIME ZONE 'America/Halifax')::date;
  v_inserted int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  INSERT INTO public.rg_solo_games
    (user_id, total_score, rungs_completed, gave_up, best_word, best_rung_score, play_date)
  VALUES
    (v_uid, p_total_score, p_rungs_completed, p_gave_up, p_best_word, p_best_rung_score, v_day)
  ON CONFLICT (user_id, play_date) WHERE play_date IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN QUERY SELECT (v_inserted > 0), v_day;
END;
$$;

REVOKE ALL ON FUNCTION public.rg_record_daily_solo(int, int, boolean, text, int) FROM public;
GRANT EXECUTE ON FUNCTION public.rg_record_daily_solo(int, int, boolean, text, int) TO authenticated;
