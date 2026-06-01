-- ============================================================
-- RUNGLES — invite-expiry baseline (card c151)
--
-- Brings Rungles onto the SQ invite-expiry baseline (Yahdle c150 /
-- sq-game-starter c152). Rungles is 1v1, so there's no short-handed
-- start — the only expiry case is "the opponent never joined":
--   • Friend-invite window 1 day → 3 days (open games stay 7 days).
--   • At expiry, instead of silently flipping a waiting game to 'expired'
--     and never showing it again, we still set status='expired' BUT also
--     stamp close_reason='no_other_players' and fire one 'game_closed'
--     push to the creator. The lobby's completed-games list now surfaces
--     'expired' rows with an "invite expired" blurb (client change), so
--     the game no longer just vanishes.
--
-- Reuses the existing close_reason column (migration-009). Setting a
-- 'waiting' row to 'expired' fires no triggers (on_rg_turn_change requires
-- status='active'), and we never call any finalize, so no stats are
-- written. Idempotent.
-- ============================================================

BEGIN;

-- ── 1. Expiry window: friend invites 1 day → 3 days ──────────
CREATE OR REPLACE FUNCTION public.rg_set_game_expiry()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.expires_at IS NULL THEN
    IF NEW.invited_user_id IS NOT NULL THEN
      NEW.expires_at := NEW.created_at + INTERVAL '3 days';
    ELSE
      NEW.expires_at := NEW.created_at + INTERVAL '7 days';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2. Expire sweep: close-with-reason + push (was a silent flip) ─
CREATE OR REPLACE FUNCTION public.rg_expire_stale_games()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  g       RECORD;
  v_count int := 0;
BEGIN
  FOR g IN
    SELECT id, created_by FROM public.rg_games
     WHERE status = 'waiting'
       AND expires_at IS NOT NULL
       AND expires_at < now()
     FOR UPDATE
  LOOP
    UPDATE public.rg_games
       SET status = 'expired',
           close_reason = 'no_other_players',
           finished_at = now()
     WHERE id = g.id;

    -- One push to the creator (the only notification in this flow).
    BEGIN
      PERFORM net.http_post(
        url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/rungles-push-notification',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
        ),
        body := jsonb_build_object(
          'type', 'game_closed',
          'record', jsonb_build_object(
            'id', g.id,
            'created_by', g.created_by,
            'close_reason', 'no_other_players'
          )
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Rungles game_closed push failed: %', SQLERRM;
    END;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rg_expire_stale_games() TO authenticated;

COMMIT;
