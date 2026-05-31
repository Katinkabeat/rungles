-- Migration 017: notify creator when a decline closes their game (Phase 2)
-- CREATE OR REPLACE of rg_decline_invite (from migration-016) to also fire
-- an 'invite_declined' push to the creator. Rungles invites are 1v1, so a
-- decline always closes the game → always notify. Gated per-recipient in
-- the edge fn via sq_notification_enabled('rungles','invite_declined') —
-- default OFF. Idempotent.

CREATE OR REPLACE FUNCTION public.rg_decline_invite(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_invited uuid;
  v_status  text;
  v_creator uuid;
BEGIN
  SELECT invited_user_id, status, created_by INTO v_invited, v_status, v_creator
  FROM public.rg_games WHERE id = p_game_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found';
  END IF;
  IF v_status <> 'waiting' THEN
    RAISE EXCEPTION 'Game has already started or closed';
  END IF;
  IF v_invited IS NULL OR v_invited <> v_uid THEN
    RAISE EXCEPTION 'You were not invited to this game';
  END IF;

  UPDATE public.rg_games
  SET status       = 'cancelled',
      cancelled_at = now(),
      finished_at  = now(),
      close_reason = 'Invite declined'
  WHERE id = p_game_id;

  BEGIN
    PERFORM net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/rungles-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'type', 'invite_declined',
        'game_id', p_game_id,
        'creator_id', v_creator,
        'decliner_id', v_uid
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Rungles invite_declined push failed: %', SQLERRM;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rg_decline_invite(uuid) TO authenticated;
