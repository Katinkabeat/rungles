-- Migration 016: Decline a friend invite (Rungles)
-- Lets an invited player decline a waiting 1v1 invite. Rungles invites
-- are strictly 1v1 (single invited_user_id), so a decline always closes
-- the game — there's no short-handed multi-seat case here.
--
-- Behavior (per SQ decline decision, card c167):
--   • Caller must be the invited_user_id of a 'waiting' game.
--   • The game is closed: status='cancelled', close_reason='Invite declined'.
--   • We don't silently strand the invite and we don't convert a private
--     friend invite into a public open game.
--
-- Notifying the creator on decline is Phase 2 (per-game opt-in), not here.
-- Idempotent: safe to re-run.

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
BEGIN
  SELECT invited_user_id, status INTO v_invited, v_status
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
END;
$$;

GRANT EXECUTE ON FUNCTION public.rg_decline_invite(uuid) TO authenticated;
