-- ============================================================
-- RUNGLES — invite-a-friend feature (2026-05-03)
--
-- Adds invited_user_id, expires_at, cancelled_at to rg_games.
-- Updates rg_create_game to accept p_invited_user_id and rg_join_game
-- to refuse non-invitees on private invite games.
-- Adds rg_cancel_game (creator-only, blocked once a rung exists)
-- and rg_expire_stale_games (lazy sweep).
-- Replaces games_select_all RLS with a hide-invited-from-randos policy.
-- Adds an AFTER-INSERT push trigger for invite notifications.
-- ============================================================

BEGIN;

-- ── columns ──────────────────────────────────────────────────
ALTER TABLE public.rg_games
  ADD COLUMN IF NOT EXISTS invited_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expires_at      timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at    timestamptz;

CREATE INDEX IF NOT EXISTS rg_games_invited_idx ON public.rg_games(invited_user_id);

-- ── status check update ──────────────────────────────────────
ALTER TABLE public.rg_games DROP CONSTRAINT IF EXISTS rg_games_status_check;
ALTER TABLE public.rg_games ADD CONSTRAINT rg_games_status_check
  CHECK (status IN ('waiting', 'active', 'complete', 'cancelled', 'expired'));

-- ── auto-set expires_at on insert ────────────────────────────
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

DROP TRIGGER IF EXISTS on_rg_game_set_expiry ON public.rg_games;
CREATE TRIGGER on_rg_game_set_expiry
BEFORE INSERT ON public.rg_games
FOR EACH ROW
EXECUTE FUNCTION public.rg_set_game_expiry();

-- ── RLS: hide invited games from non-participants ────────────
-- After joining, the invitee is still pinned by invited_user_id, so
-- the policy continues to grant them read access. No need to check
-- rg_players (avoids cross-table RLS recursion).
DROP POLICY IF EXISTS "games_select_all" ON public.rg_games;

CREATE POLICY "games_select_visible" ON public.rg_games
  FOR SELECT TO authenticated USING (
    invited_user_id IS NULL
    OR auth.uid() = created_by
    OR auth.uid() = invited_user_id
  );

-- ── rg_create_game: optional p_invited_user_id ───────────────
-- Drop the old single-arg version so callers must use the new sig.
DROP FUNCTION IF EXISTS public.rg_create_game(int);

CREATE OR REPLACE FUNCTION public.rg_create_game(
  p_total_rungs int DEFAULT 10,
  p_invited_user_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
  v_game_id uuid;
  v_bag text[];
  v_rack text[];
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_invited_user_id IS NOT NULL AND p_invited_user_id = v_user_id THEN
    RAISE EXCEPTION 'cannot invite yourself';
  END IF;

  v_bag := rg_make_bag();
  v_rack := v_bag[1:7];
  v_bag := v_bag[8:array_length(v_bag, 1)];

  INSERT INTO rg_games (created_by, total_rungs, max_players, status, invited_user_id)
  VALUES (v_user_id, p_total_rungs, 2, 'waiting', p_invited_user_id)
  RETURNING id INTO v_game_id;

  INSERT INTO rg_game_secrets (game_id, tile_bag) VALUES (v_game_id, v_bag);
  INSERT INTO rg_players (game_id, user_id, player_idx) VALUES (v_game_id, v_user_id, 0);
  INSERT INTO rg_racks (game_id, user_id, rack) VALUES (v_game_id, v_user_id, v_rack);

  RETURN v_game_id;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.rg_create_game(int, uuid) TO authenticated;

-- ── rg_join_game: refuse non-invitees on private games ───────
CREATE OR REPLACE FUNCTION public.rg_join_game(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
  v_user_id uuid := auth.uid();
  v_player_count int;
  v_max int;
  v_invited uuid;
  v_rack text[];
  v_bag text[];
  v_first_player int;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT max_players, invited_user_id INTO v_max, v_invited
    FROM rg_games
    WHERE id = p_game_id AND status = 'waiting'
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'game not available to join'; END IF;

  IF v_invited IS NOT NULL AND v_invited <> v_user_id THEN
    RAISE EXCEPTION 'this match is invited-only';
  END IF;

  IF EXISTS (SELECT 1 FROM rg_players WHERE game_id = p_game_id AND user_id = v_user_id) THEN
    RAISE EXCEPTION 'already joined this game';
  END IF;

  SELECT count(*) INTO v_player_count FROM rg_players WHERE game_id = p_game_id;
  IF v_player_count >= v_max THEN RAISE EXCEPTION 'game is full'; END IF;

  SELECT tile_bag INTO v_bag FROM rg_game_secrets WHERE game_id = p_game_id FOR UPDATE;
  v_rack := v_bag[1:7];
  v_bag := v_bag[8:array_length(v_bag, 1)];

  INSERT INTO rg_players (game_id, user_id, player_idx)
    VALUES (p_game_id, v_user_id, v_player_count);
  INSERT INTO rg_racks (game_id, user_id, rack)
    VALUES (p_game_id, v_user_id, v_rack);
  UPDATE rg_game_secrets SET tile_bag = v_bag WHERE game_id = p_game_id;

  IF v_player_count + 1 >= v_max THEN
    v_first_player := floor(random() * v_max)::int;
    UPDATE rg_games
      SET status = 'active', current_player_idx = v_first_player
      WHERE id = p_game_id;
  END IF;
END;
$func$;

-- ── rg_cancel_game: creator-only, blocked once a rung exists ──
CREATE OR REPLACE FUNCTION public.rg_cancel_game(p_game_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_creator uuid;
  v_status  text;
  v_rungs   int;
BEGIN
  SELECT created_by, status INTO v_creator, v_status
    FROM rg_games WHERE id = p_game_id;

  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'game not found';
  END IF;

  IF v_creator <> auth.uid() THEN
    RAISE EXCEPTION 'only the creator can cancel this game';
  END IF;

  IF v_status NOT IN ('waiting', 'active') THEN
    RAISE EXCEPTION 'game is not active';
  END IF;

  SELECT count(*) INTO v_rungs FROM rg_rungs WHERE game_id = p_game_id;
  IF v_rungs > 0 THEN
    RAISE EXCEPTION 'cannot cancel after a rung has been played';
  END IF;

  UPDATE rg_games
  SET status = 'cancelled',
      cancelled_at = now(),
      finished_at = now()
  WHERE id = p_game_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rg_cancel_game(uuid) TO authenticated;

-- ── rg_expire_stale_games: lazy sweep ────────────────────────
CREATE OR REPLACE FUNCTION public.rg_expire_stale_games()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_count int;
BEGIN
  WITH updated AS (
    UPDATE rg_games
    SET status = 'expired', finished_at = now()
    WHERE status = 'waiting'
      AND expires_at IS NOT NULL
      AND expires_at < now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM updated;
  RETURN COALESCE(v_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rg_expire_stale_games() TO authenticated;

-- ── Push trigger: notify invitee when match created with invite ──
CREATE OR REPLACE FUNCTION public.rg_notify_game_invited()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/rungles-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'type', 'game_invited',
        'record', row_to_json(NEW)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Rungles game_invited push trigger failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_rg_game_invited ON public.rg_games;
CREATE TRIGGER on_rg_game_invited
AFTER INSERT ON public.rg_games
FOR EACH ROW
WHEN (NEW.invited_user_id IS NOT NULL)
EXECUTE FUNCTION public.rg_notify_game_invited();

COMMIT;
