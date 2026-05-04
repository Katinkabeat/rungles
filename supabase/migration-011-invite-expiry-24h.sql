-- ============================================================
-- RUNGLES — shorten invite expiry from 3d to 1d (2026-05-03)
--
-- Open games stay at 7d (cleanup hygiene only). Invited games
-- now auto-cancel after 24h to keep the friend-invite loop fast.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rg_set_game_expiry()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.expires_at IS NULL THEN
    IF NEW.invited_user_id IS NOT NULL THEN
      NEW.expires_at := NEW.created_at + INTERVAL '1 day';
    ELSE
      NEW.expires_at := NEW.created_at + INTERVAL '7 days';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
