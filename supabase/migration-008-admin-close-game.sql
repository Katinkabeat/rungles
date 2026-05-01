-- ============================================================
-- RUNGLES — Admin close-game support
-- Run in Supabase → SQL Editor → New Query
-- Reuses the shared `admins` table (lives in this same DB
-- with Wordy) for permission checks.
-- ============================================================

-- ── 1. closed_by_admin column ─────────────────────────────────
-- Marks a game closed via rg_admin_close_game so the lobby +
-- end-game UI can render "🛑 Game closed by admin" without
-- attributing a winner.
ALTER TABLE public.rg_games
  ADD COLUMN IF NOT EXISTS closed_by_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. rg_admin_close_game ────────────────────────────────────
-- SECURITY DEFINER bypasses RLS so the admin can close games
-- they aren't a player in. Permission check enforced inside.
CREATE OR REPLACE FUNCTION public.rg_admin_close_game(p_game_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admins
    WHERE user_id = auth.uid()
      AND 'close_games' = ANY(permissions)
  ) THEN
    RAISE EXCEPTION 'Unauthorized: you do not have the close_games permission';
  END IF;

  UPDATE public.rg_games
  SET status = 'complete',
      finished_at = NOW(),
      closed_by_admin = TRUE
  WHERE id = p_game_id
    AND status IN ('waiting', 'active');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found or is already closed';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rg_admin_close_game(UUID) TO authenticated;

-- ── 3. rg_admin_list_open_games ───────────────────────────────
-- Returns all waiting/active games for the admin panel, with
-- player usernames, regardless of the admin's player membership.
CREATE OR REPLACE FUNCTION public.rg_admin_list_open_games()
RETURNS TABLE (
  id           UUID,
  status       TEXT,
  max_players  INT,
  created_at   TIMESTAMPTZ,
  player_names TEXT[]
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    g.id,
    g.status,
    g.max_players,
    g.created_at,
    COALESCE(
      ARRAY_AGG(p.username ORDER BY rp.player_idx) FILTER (WHERE p.username IS NOT NULL),
      ARRAY[]::TEXT[]
    ) AS player_names
  FROM public.rg_games g
  LEFT JOIN public.rg_players rp ON rp.game_id = g.id
  LEFT JOIN public.profiles p    ON p.id = rp.user_id
  WHERE g.status IN ('waiting', 'active')
  GROUP BY g.id
  ORDER BY g.created_at DESC
$$;

GRANT EXECUTE ON FUNCTION public.rg_admin_list_open_games() TO authenticated;
