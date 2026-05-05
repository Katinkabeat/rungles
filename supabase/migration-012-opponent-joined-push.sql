-- =====================================================================
-- Rungles migration 012: opponent-joined push notifications
--
-- When a second player joins one of your Rungles games, the creator
-- gets a push: "Someone joined your match — time to play!"
--
-- Mirrors Snibble's opponent_joined pattern (DB trigger → pg_net →
-- rungles-push-notification edge function), filling a gap left when
-- Rungles multiplayer was added — turn-change pushes existed but the
-- "they joined" moment did not.
--
-- Idempotent / re-runnable. URL + anon key match migration-003-push.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.rg_notify_opponent_joined()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_creator_id uuid;
BEGIN
  -- Skip the creator's own auto-insert when they create a game.
  SELECT created_by INTO v_creator_id
    FROM public.rg_games
   WHERE id = NEW.game_id;

  IF v_creator_id IS NULL OR v_creator_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/rungles-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'type',       'opponent_joined',
        'game_id',    NEW.game_id,
        'joiner_id',  NEW.user_id,
        'creator_id', v_creator_id
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Rungles opponent_joined trigger failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_rg_opponent_joined ON public.rg_players;
CREATE TRIGGER on_rg_opponent_joined
AFTER INSERT ON public.rg_players
FOR EACH ROW
EXECUTE FUNCTION public.rg_notify_opponent_joined();
