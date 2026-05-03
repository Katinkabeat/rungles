-- ============================================================
-- RUNGLES — Track who closed a game and why
-- Run AFTER migration-008-admin-close-game.sql.
-- Idempotent: safe to re-run.
-- ============================================================

-- ── 1. NEW COLUMNS ────────────────────────────────────────────
ALTER TABLE public.rg_games
  ADD COLUMN IF NOT EXISTS closed_by    UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS close_reason TEXT;

-- ── 2. UPDATED rg_admin_close_game ────────────────────────────
-- Reason is REQUIRED — empty/null raises an exception.
DROP FUNCTION IF EXISTS public.rg_admin_close_game(UUID);

CREATE OR REPLACE FUNCTION public.rg_admin_close_game(
  p_game_id UUID,
  p_reason  TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_reason TEXT := NULLIF(BTRIM(p_reason), '');
BEGIN
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required to close a game';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.admins
    WHERE user_id = auth.uid()
      AND 'close_games' = ANY(permissions)
  ) THEN
    RAISE EXCEPTION 'Unauthorized: you do not have the close_games permission';
  END IF;

  UPDATE public.rg_games
  SET status          = 'complete',
      finished_at     = NOW(),
      closed_by_admin = TRUE,
      closed_by       = auth.uid(),
      close_reason    = v_reason
  WHERE id = p_game_id
    AND status IN ('waiting', 'active');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found or is already closed';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rg_admin_close_game(UUID, TEXT) TO authenticated;

-- ── 3. ADMIN VIEW: recently closed games ─────────────────────
CREATE OR REPLACE FUNCTION public.rg_admin_list_closed_games(p_limit INT DEFAULT 50)
RETURNS TABLE (
  id              UUID,
  finished_at     TIMESTAMPTZ,
  close_reason    TEXT,
  closed_by_name  TEXT,
  player_names    TEXT[]
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    g.id,
    g.finished_at,
    g.close_reason,
    cb.username AS closed_by_name,
    COALESCE(
      ARRAY_AGG(p.username ORDER BY rp.player_idx) FILTER (WHERE p.username IS NOT NULL),
      ARRAY[]::TEXT[]
    ) AS player_names
  FROM public.rg_games g
  LEFT JOIN public.rg_players rp ON rp.game_id = g.id
  LEFT JOIN public.profiles p    ON p.id = rp.user_id
  LEFT JOIN public.profiles cb   ON cb.id = g.closed_by
  WHERE g.closed_by_admin = TRUE
  GROUP BY g.id, g.finished_at, g.close_reason, cb.username
  ORDER BY g.finished_at DESC
  LIMIT p_limit
$$;

GRANT EXECUTE ON FUNCTION public.rg_admin_list_closed_games(INT) TO authenticated;
