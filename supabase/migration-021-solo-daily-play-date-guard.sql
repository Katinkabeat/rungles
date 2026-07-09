-- migration-021-solo-daily-play-date-guard.sql
-- ============================================================
-- Rungles — the daily write must name the day it was played (card c257)
--
-- migration-020's rg_record_daily_solo() takes no date: it stamps
-- `(now() AT TIME ZONE 'America/Halifax')::date` at write time. c237 read that
-- as "safe" — and it IS safe against the padding exploit, since a past-dated
-- write is structurally impossible. But it is exactly what breaks the honest
-- player who starts a ladder at 11:50pm and finishes at 12:05am:
--
--   • yesterday's score is inserted under TODAY's play_date (misattributed
--     onto a board they never played), and
--   • `ON CONFLICT DO NOTHING` then reads as "already played today", so
--     today's real ladder is locked out with no explanation.
--
-- Fix: the client sends the board's seed date (`state.dayKey`) as p_play_date.
-- The server still owns the truth of what "today" is and rejects anything else,
-- matching yahdle_record_daily_solo / oublex_record_solo_result. The client
-- date is the CLAIM; the server is the AUTHORITY. A cross-midnight run is now
-- refused rather than re-dated, and the client shows a "day ended" note instead
-- of writing at all.
--
-- Rollout is zero-downtime, mirroring c237:
--   1. apply this (adds the p_play_date overload; the old signature still works)
--   2. deploy the client that calls the new signature
--   3. confirm live, then run the DROP at the bottom
-- ============================================================

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
  v_uid      uuid := auth.uid();
  v_today    date := (now() AT TIME ZONE 'America/Halifax')::date;
  v_inserted int;
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

  INSERT INTO public.rg_solo_games
    (user_id, total_score, rungs_completed, gave_up, best_word, best_rung_score, play_date)
  VALUES
    (v_uid, p_total_score, p_rungs_completed, p_gave_up, p_best_word, p_best_rung_score, v_today)
  ON CONFLICT (user_id, play_date) WHERE play_date IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN QUERY SELECT (v_inserted > 0), v_today;
END;
$$;

REVOKE ALL ON FUNCTION public.rg_record_daily_solo(date, int, int, boolean, text, int) FROM public;
GRANT EXECUTE ON FUNCTION public.rg_record_daily_solo(date, int, int, boolean, text, int) TO authenticated;

-- ── Step 3, AFTER the new client is live ─────────────────────
-- Retires the dateless signature so the misattributing path can't be called.
-- Left commented so applying this file mid-rollout can't 404 an in-flight
-- client that still calls the old overload.
--
-- DROP FUNCTION IF EXISTS public.rg_record_daily_solo(int, int, boolean, text, int);
